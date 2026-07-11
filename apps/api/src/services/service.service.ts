import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  ClinicAssociationStatus,
  PaymentMode,
  Prisma,
  ScopeType
} from "@doctobook/database";
import { AuditService } from "../audit/audit.service.js";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { SlotQueueService } from "../slots/slot-queue.service.js";
import {
  CreateClinicServiceInput,
  CreateDoctorClinicServiceInput,
  CreateMasterServiceInput,
  UpdateClinicServiceInput,
  UpdateDoctorClinicServiceInput,
  UpdateMasterServiceInput
} from "./service.schemas.js";

@Injectable()
export class AppointmentServiceConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly slotQueueService: SlotQueueService
  ) {}

  async listMasterServices() {
    const services = await this.prisma.service.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }]
    });

    return { services };
  }

  async createMasterService(
    actor: AuthenticatedUser,
    input: CreateMasterServiceInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "service.manage", "platform", null);

    try {
      const service = await this.prisma.service.create({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description,
          defaultDurationMinutes: input.defaultDurationMinutes,
          isActive: input.isActive
        }
      });

      await this.auditService.record({
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode: "service.create",
        entityType: "service",
        entityId: service.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        afterData: this.toJson(service)
      });

      return service;
    } catch (error) {
      this.throwIfUniqueConflict(error, "Service slug is already in use");
      throw error;
    }
  }

  async updateMasterService(
    actor: AuthenticatedUser,
    serviceId: string,
    input: UpdateMasterServiceInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "service.manage", "platform", null);
    await this.getMasterService(serviceId);

    try {
      const service = await this.prisma.service.update({
        where: { id: serviceId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.defaultDurationMinutes !== undefined
            ? { defaultDurationMinutes: input.defaultDurationMinutes }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
        }
      });

      await this.auditService.record({
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode: "service.update",
        entityType: "service",
        entityId: service.id,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        afterData: this.toJson(service)
      });

      return service;
    } catch (error) {
      this.throwIfUniqueConflict(error, "Service slug is already in use");
      throw error;
    }
  }

  async listClinicServices(actor: AuthenticatedUser, clinicId: string) {
    await this.assertCan(actor, "service.read", "clinic", clinicId);
    await this.assertClinicExists(clinicId);

    const clinicServices = await this.prisma.clinicService.findMany({
      where: { clinicId },
      include: { service: true },
      orderBy: [{ createdAt: "desc" }]
    });

    return { clinicServices };
  }

  async createClinicService(
    actor: AuthenticatedUser,
    clinicId: string,
    input: CreateClinicServiceInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "service.manage", "clinic", clinicId);
    await this.assertClinicExists(clinicId);
    const service = await this.getMasterService(input.serviceId);

    if (!service.isActive) {
      throw new BadRequestException("Inactive master service cannot be enabled for a clinic");
    }

    try {
      const clinicService = await this.prisma.clinicService.create({
        data: {
          clinicId,
          serviceId: input.serviceId,
          displayName: input.displayName,
          description: input.description,
          isActive: input.isActive
        },
        include: { service: true }
      });

      await this.auditService.record({
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode: "clinic_service.create",
        entityType: "clinic_service",
        entityId: clinicService.id,
        clinicId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        afterData: this.toJson(clinicService)
      });

      await this.slotQueueService.enqueueClinicService(clinicService.id, { reason: "service_changed" });

      return clinicService;
    } catch (error) {
      this.throwIfUniqueConflict(error, "Service is already enabled for this clinic");
      throw error;
    }
  }

  async updateClinicService(
    actor: AuthenticatedUser,
    clinicId: string,
    clinicServiceId: string,
    input: UpdateClinicServiceInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "service.manage", "clinic", clinicId);
    await this.getClinicService(clinicId, clinicServiceId);

    const clinicService = await this.prisma.clinicService.update({
      where: { id: clinicServiceId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      },
      include: { service: true }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic_service.update",
      entityType: "clinic_service",
      entityId: clinicService.id,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      afterData: this.toJson(clinicService)
    });

    await this.slotQueueService.enqueueClinicService(clinicService.id, { reason: "service_changed" });

    return clinicService;
  }

  async listMyDoctorClinicServices(actor: AuthenticatedUser, associationId: string) {
    const association = await this.getOwnedDoctorAssociation(actor, associationId);

    return this.listDoctorClinicServicesForAssociation(association.id);
  }

  async createMyDoctorClinicService(
    actor: AuthenticatedUser,
    associationId: string,
    input: CreateDoctorClinicServiceInput,
    context: RequestContext
  ) {
    const association = await this.getOwnedDoctorAssociation(actor, associationId);

    return this.createDoctorClinicService(actor, association, input, context);
  }

  async updateMyDoctorClinicService(
    actor: AuthenticatedUser,
    doctorClinicServiceId: string,
    input: UpdateDoctorClinicServiceInput,
    context: RequestContext
  ) {
    const doctorClinicService = await this.getDoctorClinicServiceForDoctor(
      actor,
      doctorClinicServiceId
    );

    return this.updateDoctorClinicService(actor, doctorClinicService, input, context);
  }

  async deleteMyDoctorClinicService(
    actor: AuthenticatedUser,
    doctorClinicServiceId: string,
    context: RequestContext
  ) {
    const doctorClinicService = await this.getDoctorClinicServiceForDoctor(
      actor,
      doctorClinicServiceId
    );

    return this.deleteDoctorClinicService(actor, doctorClinicService, context);
  }

  async listClinicDoctorServices(
    actor: AuthenticatedUser,
    clinicId: string,
    associationId: string
  ) {
    await this.assertCan(actor, "service.read", "clinic", clinicId);
    const association = await this.getClinicAssociation(clinicId, associationId);

    return this.listDoctorClinicServicesForAssociation(association.id);
  }

  async createClinicDoctorService(
    actor: AuthenticatedUser,
    clinicId: string,
    associationId: string,
    input: CreateDoctorClinicServiceInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "service.manage", "clinic", clinicId);
    const association = await this.getClinicAssociation(clinicId, associationId);

    return this.createDoctorClinicService(actor, association, input, context);
  }

  async updateClinicDoctorService(
    actor: AuthenticatedUser,
    clinicId: string,
    doctorClinicServiceId: string,
    input: UpdateDoctorClinicServiceInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "service.manage", "clinic", clinicId);
    const doctorClinicService = await this.getDoctorClinicServiceForClinic(
      clinicId,
      doctorClinicServiceId
    );

    return this.updateDoctorClinicService(actor, doctorClinicService, input, context);
  }

  private async listDoctorClinicServicesForAssociation(doctorClinicId: string) {
    const doctorClinicServices = await this.prisma.doctorClinicService.findMany({
      where: {
        doctorClinicId,
        deletedAt: null
      },
      include: this.doctorClinicServiceInclude(),
      orderBy: [{ createdAt: "desc" }]
    });

    return this.serializeDoctorClinicServices(doctorClinicServices);
  }

  private async createDoctorClinicService(
    actor: AuthenticatedUser,
    association: DoctorClinicRecord,
    input: CreateDoctorClinicServiceInput,
    context: RequestContext
  ) {
    this.assertApprovedAssociation(association);
    this.assertDoctorServiceValues(input);
    const clinicService = await this.getActiveClinicService(association.clinicId, input.clinicServiceId);

    try {
      const doctorClinicService = await this.prisma.doctorClinicService.create({
        data: {
          doctorClinicId: association.id,
          clinicServiceId: clinicService.id,
          durationMinutes: input.durationMinutes,
          feeMinor:
            input.feeMinor === null || input.feeMinor === undefined
              ? null
              : BigInt(input.feeMinor),
          currency: input.currency,
          paymentMode: input.paymentMode,
          cancellationWindowMinutes: input.cancellationWindowMinutes,
          rescheduleWindowMinutes: input.rescheduleWindowMinutes,
          maxReschedules: input.maxReschedules,
          isActive: input.isActive
        },
        include: this.doctorClinicServiceInclude()
      });

      await this.auditService.record({
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode: "doctor_clinic_service.create",
        entityType: "doctor_clinic_service",
        entityId: doctorClinicService.id,
        clinicId: association.clinicId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        afterData: this.toAuditJson(doctorClinicService)
      });

      await this.slotQueueService.enqueueAssociation(association.id, { reason: "service_changed" });

      return this.serializeDoctorClinicService(doctorClinicService);
    } catch (error) {
      this.throwIfUniqueConflict(error, "Doctor service is already configured for this clinic service");
      throw error;
    }
  }

  private async updateDoctorClinicService(
    actor: AuthenticatedUser,
    existing: DoctorClinicServiceRecord,
    input: UpdateDoctorClinicServiceInput,
    context: RequestContext
  ) {
    this.assertApprovedAssociation(existing.doctorClinic);
    this.assertDoctorServiceValues(input);

    const doctorClinicService = await this.prisma.doctorClinicService.update({
      where: { id: existing.id },
      data: {
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.feeMinor !== undefined
          ? { feeMinor: input.feeMinor === null ? null : BigInt(input.feeMinor) }
          : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.paymentMode !== undefined ? { paymentMode: input.paymentMode } : {}),
        ...(input.cancellationWindowMinutes !== undefined
          ? { cancellationWindowMinutes: input.cancellationWindowMinutes }
          : {}),
        ...(input.rescheduleWindowMinutes !== undefined
          ? { rescheduleWindowMinutes: input.rescheduleWindowMinutes }
          : {}),
        ...(input.maxReschedules !== undefined ? { maxReschedules: input.maxReschedules } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      },
      include: this.doctorClinicServiceInclude()
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor_clinic_service.update",
      entityType: "doctor_clinic_service",
      entityId: doctorClinicService.id,
      clinicId: doctorClinicService.doctorClinic.clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      afterData: this.toAuditJson(doctorClinicService)
    });

    await this.slotQueueService.enqueueAssociation(doctorClinicService.doctorClinicId, {
      reason: "service_changed"
    });

    return this.serializeDoctorClinicService(doctorClinicService);
  }

  private async deleteDoctorClinicService(
    actor: AuthenticatedUser,
    existing: DoctorClinicServiceRecord,
    context: RequestContext
  ) {
    const doctorClinicService = await this.prisma.doctorClinicService.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        deletedAt: new Date()
      },
      include: this.doctorClinicServiceInclude()
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor_clinic_service.delete",
      entityType: "doctor_clinic_service",
      entityId: doctorClinicService.id,
      clinicId: doctorClinicService.doctorClinic.clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    await this.slotQueueService.enqueueAssociation(doctorClinicService.doctorClinicId, {
      reason: "service_changed"
    });

    return this.serializeDoctorClinicService(doctorClinicService);
  }

  private async getMasterService(serviceId: string) {
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId }
    });

    if (!service) {
      throw new NotFoundException("Service not found");
    }

    return service;
  }

  private async assertClinicExists(clinicId: string) {
    const clinic = await this.prisma.clinic.findFirst({
      where: {
        id: clinicId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!clinic) {
      throw new NotFoundException("Clinic not found");
    }
  }

  private async getClinicService(clinicId: string, clinicServiceId: string) {
    const clinicService = await this.prisma.clinicService.findFirst({
      where: {
        id: clinicServiceId,
        clinicId
      },
      include: { service: true }
    });

    if (!clinicService) {
      throw new NotFoundException("Clinic service not found");
    }

    return clinicService;
  }

  private async getActiveClinicService(clinicId: string, clinicServiceId: string) {
    const clinicService = await this.getClinicService(clinicId, clinicServiceId);

    if (!clinicService.isActive || !clinicService.service.isActive) {
      throw new BadRequestException("Inactive clinic service cannot be assigned to a doctor");
    }

    return clinicService;
  }

  private async getClinicAssociation(clinicId: string, associationId: string) {
    const association = await this.prisma.doctorClinic.findFirst({
      where: {
        id: associationId,
        clinicId,
        deletedAt: null
      },
      include: {
        clinic: { select: { defaultPaymentMode: true } },
        doctor: { select: { userId: true, status: true } }
      }
    });

    if (!association) {
      throw new NotFoundException("Doctor clinic association not found");
    }

    return association;
  }

  private async getOwnedDoctorAssociation(actor: AuthenticatedUser, associationId: string) {
    const allowed = await this.authorizationService.can(actor, "doctor.profile.update", {
      scope: "doctor_clinic",
      scopeId: associationId
    });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }

    const association = await this.prisma.doctorClinic.findFirst({
      where: {
        id: associationId,
        doctor: { userId: actor.id },
        deletedAt: null
      },
      include: {
        clinic: { select: { defaultPaymentMode: true } },
        doctor: { select: { userId: true, status: true } }
      }
    });

    if (!association) {
      throw new NotFoundException("Doctor clinic association not found");
    }

    return association;
  }

  private async getDoctorClinicServiceForDoctor(
    actor: AuthenticatedUser,
    doctorClinicServiceId: string
  ) {
    const doctorClinicService = await this.prisma.doctorClinicService.findFirst({
      where: {
        id: doctorClinicServiceId,
        deletedAt: null,
        doctorClinic: {
          deletedAt: null,
          doctor: { userId: actor.id }
        }
      },
      include: this.doctorClinicServiceInclude()
    });

    if (!doctorClinicService) {
      throw new NotFoundException("Doctor service configuration not found");
    }

    const allowed = await this.authorizationService.can(actor, "doctor.profile.update", {
      scope: "doctor_clinic",
      scopeId: doctorClinicService.doctorClinicId
    });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }

    return doctorClinicService;
  }

  private async getDoctorClinicServiceForClinic(clinicId: string, doctorClinicServiceId: string) {
    const doctorClinicService = await this.prisma.doctorClinicService.findFirst({
      where: {
        id: doctorClinicServiceId,
        deletedAt: null,
        doctorClinic: {
          clinicId,
          deletedAt: null
        }
      },
      include: this.doctorClinicServiceInclude()
    });

    if (!doctorClinicService) {
      throw new NotFoundException("Doctor service configuration not found");
    }

    return doctorClinicService;
  }

  private assertApprovedAssociation(association: DoctorClinicRecord) {
    if (association.status !== ClinicAssociationStatus.APPROVED) {
      throw new BadRequestException(
        "Doctor service can only be configured for an approved clinic association"
      );
    }
  }

  private assertDoctorServiceValues(
    input: CreateDoctorClinicServiceInput | UpdateDoctorClinicServiceInput
  ) {
    if (input.durationMinutes !== undefined && input.durationMinutes <= 0) {
      throw new BadRequestException("Duration must be greater than zero");
    }

    if (input.feeMinor !== undefined && input.feeMinor !== null && input.feeMinor < 0) {
      throw new BadRequestException("Fee cannot be negative");
    }
  }

  private async assertCan(
    actor: AuthenticatedUser,
    permissionCode: string,
    scope: "platform" | "clinic",
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

  private doctorClinicServiceInclude() {
    return {
      clinicService: {
        include: {
          service: true
        }
      },
      doctorClinic: {
        include: {
          clinic: { select: { defaultPaymentMode: true } },
          doctor: { select: { userId: true, status: true } }
        }
      }
    } satisfies Prisma.DoctorClinicServiceInclude;
  }

  private async serializeDoctorClinicServices(doctorClinicServices: DoctorClinicServiceRecord[]) {
    const platformPaymentMode = await this.getPlatformDefaultPaymentMode();

    return {
      doctorClinicServices: doctorClinicServices.map((doctorClinicService) =>
        this.serializeDoctorClinicServiceWithFallback(doctorClinicService, platformPaymentMode)
      )
    };
  }

  private async serializeDoctorClinicService(doctorClinicService: DoctorClinicServiceRecord) {
    return this.serializeDoctorClinicServiceWithFallback(
      doctorClinicService,
      await this.getPlatformDefaultPaymentMode()
    );
  }

  private serializeDoctorClinicServiceWithFallback(
    doctorClinicService: DoctorClinicServiceRecord,
    platformPaymentMode: PaymentMode
  ) {
    const effectivePaymentMode =
      doctorClinicService.paymentMode ??
      doctorClinicService.doctorClinic.paymentMode ??
      doctorClinicService.doctorClinic.clinic.defaultPaymentMode ??
      platformPaymentMode;

    return this.toJson({
      ...doctorClinicService,
      effectivePaymentMode
    });
  }

  private async getPlatformDefaultPaymentMode() {
    const setting = await this.prisma.systemSetting.findFirst({
      where: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        key: "booking.default_payment_mode"
      },
      select: { value: true }
    });
    const value =
      setting?.value && typeof setting.value === "object" && "value" in setting.value
        ? setting.value.value
        : null;

    if (value === "online_required" || value === PaymentMode.ONLINE_REQUIRED) {
      return PaymentMode.ONLINE_REQUIRED;
    }

    if (value === "pay_at_clinic" || value === PaymentMode.PAY_AT_CLINIC) {
      return PaymentMode.PAY_AT_CLINIC;
    }

    return PaymentMode.ONLINE_OPTIONAL;
  }

  private throwIfUniqueConflict(error: unknown, message: string) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictException(message);
    }
  }

  private toJson<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
      )
    ) as T;
  }

  private toAuditJson(value: unknown): Prisma.InputJsonValue {
    return this.toJson(value) as Prisma.InputJsonValue;
  }
}

type DoctorClinicRecord = Prisma.DoctorClinicGetPayload<{
  include: {
    clinic: { select: { defaultPaymentMode: true } };
    doctor: { select: { userId: true; status: true } };
  };
}>;

type DoctorClinicServiceRecord = Prisma.DoctorClinicServiceGetPayload<{
  include: {
    clinicService: {
      include: {
        service: true;
      };
    };
    doctorClinic: {
      include: {
        clinic: { select: { defaultPaymentMode: true } };
        doctor: { select: { userId: true; status: true } };
      };
    };
  };
}>;
