import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  ClinicAssociationStatus,
  DoctorStatus,
  FileVisibility,
  Prisma,
  UserStatus
} from "@doctobook/database";
import { AuditService } from "../audit/audit.service.js";
import { AuthService } from "../auth/auth.service.js";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { PasswordService } from "../auth/password.service.js";
import { TokenService } from "../auth/token.service.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { SlotQueueService } from "../slots/slot-queue.service.js";
import {
  AssociationDecisionInput,
  ClinicDocumentReviewInput,
  CreateDoctorDocumentInput,
  DoctorStatusReasonInput,
  InviteDoctorInput,
  ListDoctorAssociationsQuery,
  ListDoctorsQuery,
  RegisterDoctorInput,
  RejectDoctorInput,
  RequestClinicAssociationInput,
  UpdateDoctorProfileInput
} from "./doctor.schemas.js";

@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly authService: AuthService,
    private readonly slotQueueService: SlotQueueService,
    private readonly notificationService: NotificationService
  ) {}

  async registerDoctor(input: RegisterDoctorInput, context: RequestContext) {
    const existingUser = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: input.email }, ...(input.phone ? [{ phone: input.phone }] : [])]
      },
      select: { id: true }
    });

    if (existingUser) {
      throw new ConflictException("An account already exists for this email or phone");
    }

    await this.assertLicenseAvailable(input.licenseNumber);
    const passwordHash = await this.passwordService.hash(input.password);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertSpecialtiesExist(tx, input.specialtyIds);

      const role = await tx.role.findUnique({
        where: { code: "doctor" },
        select: { id: true }
      });

      if (!role) {
        throw new BadRequestException("Missing seeded role: doctor");
      }

      const user = await tx.user.create({
        data: {
          email: input.email,
          phone: input.phone,
          fullName: input.fullName,
          passwordHash,
          status: UserStatus.PENDING_VERIFICATION
        },
        select: {
          id: true,
          email: true,
          phone: true,
          fullName: true,
          status: true
        }
      });

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id
        }
      });

      const doctor = await tx.doctor.create({
        data: {
          userId: user.id,
          slug: this.createDoctorSlug(input.fullName),
          licenseNumber: input.licenseNumber,
          qualifications: input.qualifications,
          bio: input.bio,
          yearsExperience: input.yearsExperience,
          languages: input.languages,
          status: DoctorStatus.PENDING_APPROVAL,
          specialties: {
            create: input.specialtyIds.map((specialtyId, index) => ({
              specialtyId,
              isPrimary: index === 0
            }))
          }
        },
        include: this.doctorInclude()
      });

      const verificationToken = await this.createVerificationToken(tx, {
        purpose: "email_verification",
        userId: user.id,
        email: input.email,
        expiresAt: this.addMinutes(new Date(), 60)
      });

      return { user, doctor, verificationToken };
    });

    await this.auditService.record({
      actorUserId: result.user.id,
      actorRole: "doctor",
      actionCode: "doctor.register",
      entityType: "doctor",
      entityId: result.doctor.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { specialtyCount: input.specialtyIds.length }
    });
    await this.safeNotify(() =>
      this.notificationService.enqueueUserEvent({
        eventCode: "auth.email_verification",
        userId: result.user.id,
        variables: {
          verification: {
            token: this.exposeDevelopmentToken(result.verificationToken) ?? "",
            expiresInMinutes: 60
          }
        },
        idempotencyKeySuffix: result.verificationToken
      })
    );

    return this.serialize({
      user: result.user,
      doctor: result.doctor,
      verificationToken: this.exposeDevelopmentToken(result.verificationToken)
    });
  }

  async listSpecialties() {
    const specialties = await this.prisma.specialty.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true
      }
    });

    return { specialties };
  }

  async getMyProfile(actor: AuthenticatedUser) {
    const doctor = await this.getDoctorByUser(actor.id);

    await this.assertCan(actor, "doctor.read", "doctor", doctor.id);

    return this.serialize(doctor);
  }

  async updateMyProfile(
    actor: AuthenticatedUser,
    input: UpdateDoctorProfileInput,
    context: RequestContext
  ) {
    const existingDoctor = await this.getDoctorByUser(actor.id);
    await this.assertCan(actor, "doctor.profile.update", "doctor", existingDoctor.id);

    if (input.licenseNumber) {
      await this.assertLicenseAvailable(input.licenseNumber, existingDoctor.id);
    }

    const doctor = await this.prisma.$transaction(async (tx) => {
      if (input.specialtyIds) {
        await this.assertSpecialtiesExist(tx, input.specialtyIds);
        await tx.doctorSpecialty.deleteMany({ where: { doctorId: existingDoctor.id } });
        await tx.doctorSpecialty.createMany({
          data: input.specialtyIds.map((specialtyId, index) => ({
            doctorId: existingDoctor.id,
            specialtyId,
            isPrimary: index === 0
          }))
        });
      }

      return tx.doctor.update({
        where: { id: existingDoctor.id },
        data: {
          ...(input.licenseNumber !== undefined ? { licenseNumber: input.licenseNumber } : {}),
          ...(input.qualifications !== undefined ? { qualifications: input.qualifications } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(input.yearsExperience !== undefined
            ? { yearsExperience: input.yearsExperience }
            : {}),
          ...(input.languages !== undefined ? { languages: input.languages } : {}),
          ...(existingDoctor.status === DoctorStatus.REJECTED
            ? { status: DoctorStatus.PENDING_APPROVAL, rejectionReason: null }
            : {})
        },
        include: this.doctorInclude()
      });
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor.profile.update",
      entityType: "doctor",
      entityId: doctor.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      afterData: this.toJson(doctor)
    });

    return this.serialize(doctor);
  }

  async createMyDocument(
    actor: AuthenticatedUser,
    input: CreateDoctorDocumentInput,
    context: RequestContext
  ) {
    const doctor = await this.getDoctorByUser(actor.id);
    await this.assertCan(actor, "doctor.documents.upload", "doctor", doctor.id);

    const document = await this.prisma.$transaction(async (tx) => {
      const file = await tx.uploadedFile.create({
        data: {
          uploadedByUserId: actor.id,
          storageProvider: input.storageProvider,
          bucket: input.bucket,
          objectKey: input.objectKey,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: BigInt(input.sizeBytes),
          checksum: input.checksum,
          visibility: FileVisibility.PRIVATE
        }
      });

      return tx.doctorDocument.create({
        data: {
          doctorId: doctor.id,
          fileId: file.id,
          documentType: input.documentType
        },
        include: {
          file: true
        }
      });
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor.document.upload",
      entityType: "doctor_document",
      entityId: document.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { documentType: input.documentType }
    });

    return this.serialize(document);
  }

  async deleteMyDocument(actor: AuthenticatedUser, documentId: string, context: RequestContext) {
    const doctor = await this.getDoctorByUser(actor.id);
    const document = await this.prisma.doctorDocument.findFirst({
      where: { id: documentId, doctorId: doctor.id },
      select: { id: true, fileId: true }
    });

    if (!document) {
      throw new NotFoundException("Doctor document not found");
    }

    await this.prisma.$transaction([
      this.prisma.doctorDocument.delete({ where: { id: document.id } }),
      this.prisma.uploadedFile.update({
        where: { id: document.fileId },
        data: { deletedAt: new Date() }
      })
    ]);

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor.document.delete",
      entityType: "doctor_document",
      entityId: document.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return { deleted: true };
  }

  async listDoctors(actor: AuthenticatedUser, query: ListDoctorsQuery) {
    await this.assertCan(actor, "doctor.read", "platform", null);

    const doctors = await this.prisma.doctor.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { slug: { contains: query.search, mode: "insensitive" } },
                { licenseNumber: { contains: query.search, mode: "insensitive" } },
                { user: { fullName: { contains: query.search, mode: "insensitive" } } },
                { user: { email: { contains: query.search, mode: "insensitive" } } }
              ]
            }
          : {})
      },
      orderBy: [{ createdAt: "desc" }],
      include: this.doctorInclude()
    });

    return this.serialize({ doctors });
  }

  async getDoctor(actor: AuthenticatedUser, doctorId: string) {
    await this.assertCan(actor, "doctor.read", "doctor", doctorId);

    const doctor = await this.prisma.doctor.findFirst({
      where: {
        id: doctorId,
        deletedAt: null
      },
      include: this.doctorInclude(true)
    });

    if (!doctor) {
      throw new NotFoundException("Doctor not found");
    }

    return this.serialize(doctor);
  }

  async approveDoctor(actor: AuthenticatedUser, doctorId: string, context: RequestContext) {
    await this.assertCan(actor, "doctor.account.verify", "platform", null);
    const doctor = await this.getExistingDoctor(doctorId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: doctor.userId },
        data: { status: UserStatus.ACTIVE }
      });

      return tx.doctor.update({
        where: { id: doctor.id },
        data: {
          status: DoctorStatus.APPROVED,
          approvedByUserId: actor.id,
          approvedAt: new Date(),
          rejectionReason: null
        },
        include: this.doctorInclude(true)
      });
    });

    await this.auditDoctorStatus(actor, updated.id, "doctor.approve", context);
    await this.slotQueueService.enqueueDoctor(updated.id, { reason: "doctor_clinic_changed" });
    await this.safeNotify(() =>
      this.notificationService.enqueueUserEvent({
        eventCode: "doctor.approved",
        userId: updated.userId,
        variables: {
          doctor: {
            id: updated.id,
            name: updated.user.fullName
          }
        },
        idempotencyKeySuffix: updated.approvedAt?.toISOString() ?? updated.id
      })
    );

    return this.serialize(updated);
  }

  async rejectDoctor(
    actor: AuthenticatedUser,
    doctorId: string,
    input: RejectDoctorInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "doctor.account.verify", "platform", null);
    if (!input.reason.trim()) {
      throw new BadRequestException("Rejection reason is required");
    }

    const doctor = await this.getExistingDoctor(doctorId);

    const updated = await this.prisma.doctor.update({
      where: { id: doctor.id },
      data: {
        status: DoctorStatus.REJECTED,
        approvedByUserId: null,
        approvedAt: null,
        rejectionReason: input.reason
      },
      include: this.doctorInclude(true)
    });

    await this.auditDoctorStatus(actor, updated.id, "doctor.reject", context, {
      reason: input.reason
    });
    await this.slotQueueService.enqueueDoctor(updated.id, { reason: "doctor_clinic_changed" });
    await this.safeNotify(() =>
      this.notificationService.enqueueUserEvent({
        eventCode: "doctor.rejected",
        userId: updated.userId,
        variables: {
          doctor: {
            id: updated.id,
            name: updated.user.fullName,
            rejectionReason: input.reason
          }
        },
        idempotencyKeySuffix: `${updated.id}|${updated.updatedAt.toISOString()}`
      })
    );

    return this.serialize(updated);
  }

  async suspendDoctor(
    actor: AuthenticatedUser,
    doctorId: string,
    input: DoctorStatusReasonInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "doctor.account.suspend", "platform", null);
    const doctor = await this.getExistingDoctor(doctorId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: doctor.userId },
        data: { status: UserStatus.SUSPENDED }
      });

      return tx.doctor.update({
        where: { id: doctor.id },
        data: { status: DoctorStatus.SUSPENDED },
        include: this.doctorInclude(true)
      });
    });

    await this.authService.revokeUserSessions(doctor.userId, actor, context);
    await this.auditDoctorStatus(actor, updated.id, "doctor.suspend", context, {
      reason: input.reason ?? null
    });
    await this.slotQueueService.enqueueDoctor(updated.id, { reason: "doctor_clinic_changed" });

    return this.serialize(updated);
  }

  async reactivateDoctor(actor: AuthenticatedUser, doctorId: string, context: RequestContext) {
    await this.assertCan(actor, "doctor.account.suspend", "platform", null);
    const doctor = await this.getExistingDoctor(doctorId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: doctor.userId },
        data: { status: UserStatus.ACTIVE }
      });

      return tx.doctor.update({
        where: { id: doctor.id },
        data: {
          status: DoctorStatus.APPROVED,
          rejectionReason: null
        },
        include: this.doctorInclude(true)
      });
    });

    await this.auditDoctorStatus(actor, updated.id, "doctor.reactivate", context);
    await this.slotQueueService.enqueueDoctor(updated.id, { reason: "doctor_clinic_changed" });

    return this.serialize(updated);
  }

  async requestClinicAssociation(
    actor: AuthenticatedUser,
    input: RequestClinicAssociationInput,
    context: RequestContext
  ) {
    const doctor = await this.getDoctorByUser(actor.id);
    await this.assertCan(actor, "doctor_clinic.request", "doctor", doctor.id);

    const location = await this.prisma.clinicLocation.findFirst({
      where: {
        id: input.clinicLocationId,
        clinicId: input.clinicId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!location) {
      throw new BadRequestException("Clinic location does not belong to clinic");
    }

    const association = await this.prisma.doctorClinic.create({
      data: {
        doctorId: doctor.id,
        clinicId: input.clinicId,
        clinicLocationId: input.clinicLocationId,
        status: ClinicAssociationStatus.PENDING,
        defaultConsultationFeeMinor:
          input.defaultConsultationFeeMinor === null ||
          input.defaultConsultationFeeMinor === undefined
            ? null
            : BigInt(input.defaultConsultationFeeMinor),
        currency: input.currency,
        paymentMode: input.paymentMode,
        defaultSlotIntervalMinutes: input.defaultSlotIntervalMinutes,
        bufferMinutes: input.bufferMinutes
      },
      include: this.associationInclude()
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor_clinic.request",
      entityType: "doctor_clinic",
      entityId: association.id,
      clinicId: association.clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { doctorId: doctor.id }
    });

    return this.serialize(association);
  }

  async listMyAssociations(actor: AuthenticatedUser, query: ListDoctorAssociationsQuery) {
    const doctor = await this.getDoctorByUser(actor.id);

    const associations = await this.prisma.doctorClinic.findMany({
      where: {
        doctorId: doctor.id,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {})
      },
      orderBy: { createdAt: "desc" },
      include: this.associationInclude()
    });

    return this.serialize({ associations });
  }

  async removeMyAssociation(
    actor: AuthenticatedUser,
    associationId: string,
    context: RequestContext
  ) {
    const doctor = await this.getDoctorByUser(actor.id);
    const association = await this.prisma.doctorClinic.findFirst({
      where: {
        id: associationId,
        doctorId: doctor.id,
        deletedAt: null
      }
    });

    if (!association) {
      throw new NotFoundException("Doctor clinic association not found");
    }

    await this.assertNoFutureAppointments({ doctorClinicId: association.id });
    const updated = await this.prisma.doctorClinic.update({
      where: { id: association.id },
      data: {
        status: ClinicAssociationStatus.REMOVED,
        deletedAt: new Date()
      }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor_clinic.remove",
      entityType: "doctor_clinic",
      entityId: updated.id,
      clinicId: updated.clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    await this.slotQueueService.enqueueAssociation(updated.id, { reason: "doctor_clinic_changed" });

    return this.serialize(updated);
  }

  async listClinicAssociations(
    actor: AuthenticatedUser,
    clinicId: string,
    query: ListDoctorAssociationsQuery
  ) {
    await this.assertCan(actor, "doctor.read", "clinic", clinicId);

    const associations = await this.prisma.doctorClinic.findMany({
      where: {
        clinicId,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {})
      },
      orderBy: { createdAt: "desc" },
      include: this.associationInclude(true)
    });

    return this.serialize({ associations });
  }

  async approveClinicAssociation(
    actor: AuthenticatedUser,
    clinicId: string,
    associationId: string,
    context: RequestContext
  ) {
    await this.assertCan(actor, "doctor_clinic.approve", "clinic", clinicId);
    const association = await this.getClinicAssociation(clinicId, associationId);

    if (association.doctor.status !== DoctorStatus.APPROVED) {
      throw new ConflictException("Doctor identity must be approved first");
    }

    const updated = await this.prisma.doctorClinic.update({
      where: { id: association.id },
      data: {
        status: ClinicAssociationStatus.APPROVED,
        approvedByUserId: actor.id,
        approvedAt: new Date()
      },
      include: this.associationInclude(true)
    });

    await this.auditAssociationDecision(actor, updated.id, "doctor_clinic.approve", context);
    await this.slotQueueService.enqueueAssociation(updated.id, { reason: "doctor_clinic_changed" });

    return this.serialize(updated);
  }

  async rejectClinicAssociation(
    actor: AuthenticatedUser,
    clinicId: string,
    associationId: string,
    input: AssociationDecisionInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "doctor_clinic.approve", "clinic", clinicId);
    const association = await this.getClinicAssociation(clinicId, associationId);

    const updated = await this.prisma.doctorClinic.update({
      where: { id: association.id },
      data: {
        status: ClinicAssociationStatus.REJECTED,
        approvedByUserId: null,
        approvedAt: null
      },
      include: this.associationInclude(true)
    });

    await this.auditAssociationDecision(actor, updated.id, "doctor_clinic.reject", context, {
      reason: input.reason ?? null
    });
    await this.slotQueueService.enqueueAssociation(updated.id, { reason: "doctor_clinic_changed" });

    return this.serialize(updated);
  }

  async inviteDoctor(
    actor: AuthenticatedUser,
    clinicId: string,
    input: InviteDoctorInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "doctor_clinic.approve", "clinic", clinicId);

    if (input.clinicLocationId) {
      const location = await this.prisma.clinicLocation.findFirst({
        where: {
          id: input.clinicLocationId,
          clinicId,
          deletedAt: null
        },
        select: { id: true }
      });

      if (!location) {
        throw new BadRequestException("Clinic location does not belong to clinic");
      }
    }

    const inviteToken = await this.createVerificationToken(this.prisma, {
      purpose: "doctor_invitation",
      email: input.email ?? null,
      phone: input.phone ?? null,
      expiresAt: this.addDays(new Date(), 14),
      metadata: {
        clinicId,
        clinicLocationId: input.clinicLocationId ?? null
      }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor.invite",
      entityType: "clinic",
      entityId: clinicId,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { email: input.email ?? null, phone: input.phone ?? null }
    });

    return {
      invited: true,
      inviteToken: this.exposeDevelopmentToken(inviteToken)
    };
  }

  async reviewClinicDocument(
    actor: AuthenticatedUser,
    clinicId: string,
    associationId: string,
    documentId: string,
    input: ClinicDocumentReviewInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "doctor.documents.review_for_clinic", "clinic", clinicId);
    const association = await this.getClinicAssociation(clinicId, associationId);

    const document = await this.prisma.doctorDocument.findFirst({
      where: {
        id: documentId,
        doctorId: association.doctorId
      },
      select: { id: true }
    });

    if (!document) {
      throw new NotFoundException("Doctor document not found for this association");
    }

    const review = await this.prisma.doctorDocumentClinicReview.upsert({
      where: {
        doctorDocumentId_doctorClinicId: {
          doctorDocumentId: documentId,
          doctorClinicId: associationId
        }
      },
      update: {
        status: input.status,
        reason: input.reason,
        reviewedByUserId: actor.id,
        reviewedAt: new Date()
      },
      create: {
        doctorDocumentId: documentId,
        clinicId,
        doctorClinicId: associationId,
        status: input.status,
        reason: input.reason,
        reviewedByUserId: actor.id,
        reviewedAt: new Date()
      }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor.document.clinic_review",
      entityType: "doctor_document_clinic_review",
      entityId: review.id,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { documentId, associationId, status: input.status }
    });

    return this.serialize(review);
  }

  private async getDoctorByUser(userId: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: {
        userId,
        deletedAt: null
      },
      include: this.doctorInclude(true)
    });

    if (!doctor) {
      throw new NotFoundException("Doctor profile not found");
    }

    return doctor;
  }

  private async getExistingDoctor(doctorId: string) {
    const doctor = await this.prisma.doctor.findFirst({
      where: {
        id: doctorId,
        deletedAt: null
      },
      select: {
        id: true,
        userId: true,
        status: true
      }
    });

    if (!doctor) {
      throw new NotFoundException("Doctor not found");
    }

    return doctor;
  }

  private async getClinicAssociation(clinicId: string, associationId: string) {
    const association = await this.prisma.doctorClinic.findFirst({
      where: {
        id: associationId,
        clinicId,
        deletedAt: null
      },
      include: {
        doctor: true
      }
    });

    if (!association) {
      throw new NotFoundException("Doctor clinic association not found");
    }

    return association;
  }

  private async assertLicenseAvailable(licenseNumber: string, currentDoctorId?: string) {
    const existing = await this.prisma.doctor.findFirst({
      where: {
        licenseNumber,
        deletedAt: null,
        ...(currentDoctorId ? { id: { not: currentDoctorId } } : {})
      },
      select: { id: true }
    });

    if (existing) {
      throw new ConflictException("Doctor license number is already registered");
    }
  }

  private async assertSpecialtiesExist(
    client: Prisma.TransactionClient | PrismaService,
    specialtyIds: string[]
  ) {
    if (specialtyIds.length === 0) {
      return;
    }

    const uniqueSpecialtyIds = [...new Set(specialtyIds)];
    const specialties = await client.specialty.findMany({
      where: {
        id: { in: uniqueSpecialtyIds },
        isActive: true
      },
      select: { id: true }
    });

    if (specialties.length !== uniqueSpecialtyIds.length) {
      throw new BadRequestException("One or more specialties are invalid");
    }
  }

  private async assertNoFutureAppointments(input: { doctorClinicId: string }) {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        doctorClinicId: input.doctorClinicId,
        startsAt: { gt: new Date() }
      },
      select: { id: true }
    });

    if (appointment) {
      throw new ConflictException("Cannot remove association with future appointments");
    }
  }

  private async assertCan(
    actor: AuthenticatedUser,
    permissionCode: string,
    scope: "platform" | "clinic" | "doctor",
    scopeId: string | null
  ) {
    const allowed = await this.authorizationService.can(actor, permissionCode, {
      scope,
      scopeId
    });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }
  }

  private async auditDoctorStatus(
    actor: AuthenticatedUser,
    doctorId: string,
    actionCode: string,
    context: RequestContext,
    metadata?: Prisma.InputJsonValue
  ) {
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode,
      entityType: "doctor",
      entityId: doctorId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata
    });
  }

  private async auditAssociationDecision(
    actor: AuthenticatedUser,
    associationId: string,
    actionCode: string,
    context: RequestContext,
    metadata?: Prisma.InputJsonValue
  ) {
    const association = await this.prisma.doctorClinic.findUnique({
      where: { id: associationId },
      select: { clinicId: true }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode,
      entityType: "doctor_clinic",
      entityId: associationId,
      clinicId: association?.clinicId ?? null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata
    });
  }

  private async createVerificationToken(
    client: Prisma.TransactionClient | PrismaService,
    input: {
      purpose: string;
      userId?: string | null;
      email?: string | null;
      phone?: string | null;
      metadata?: Prisma.InputJsonValue;
      expiresAt: Date;
    }
  ) {
    const token = this.tokenService.createOpaqueToken();

    await client.verificationToken.create({
      data: {
        userId: input.userId,
        email: input.email,
        phone: input.phone,
        purpose: input.purpose,
        tokenHash: this.tokenService.hashToken(token),
        metadata: input.metadata,
        expiresAt: input.expiresAt
      }
    });

    return token;
  }

  private doctorInclude(includeAssociations = false) {
    return {
      user: {
        select: {
          id: true,
          email: true,
          phone: true,
          fullName: true,
          status: true,
          emailVerifiedAt: true
        }
      },
      specialties: {
        include: {
          specialty: true
        },
        orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }]
      },
      documents: {
        include: {
          file: {
            select: {
              id: true,
              originalFilename: true,
              mimeType: true,
              sizeBytes: true,
              visibility: true,
              createdAt: true
            }
          }
        },
        orderBy: { createdAt: "desc" as const }
      },
      ...(includeAssociations
        ? {
            clinics: {
              where: { deletedAt: null },
              include: this.associationInclude(),
              orderBy: { createdAt: "desc" as const }
            }
          }
        : {})
    };
  }

  private associationInclude(includeDoctor = false) {
    return {
      clinic: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true
        }
      },
      clinicLocation: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          status: true
        }
      },
      ...(includeDoctor
        ? {
            doctor: {
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    phone: true,
                    fullName: true,
                    status: true
                  }
                },
                specialties: {
                  include: { specialty: true }
                }
              }
            }
          }
        : {})
    };
  }

  private createDoctorSlug(fullName: string): string {
    const base = fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    const suffix = this.tokenService.createOpaqueToken(6).toLowerCase();

    return `${base || "doctor"}-${suffix}`;
  }

  private exposeDevelopmentToken(token: string) {
    return process.env.NODE_ENV === "production" ? undefined : token;
  }

  private async safeNotify(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      console.warn("Notification enqueue failed", error);
    }
  }

  private addMinutes(date: Date, minutes: number) {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  private addDays(date: Date, days: number) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, innerValue) =>
        typeof innerValue === "bigint" ? innerValue.toString() : innerValue
      )
    ) as T;
  }

  private toJson(value: unknown) {
    return this.serialize(value) as Prisma.InputJsonObject;
  }
}
