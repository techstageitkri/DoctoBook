import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { ClinicAssociationStatus, ClinicStatus, Prisma, UserStatus } from "@doctobook/database";
import { AuditService } from "../audit/audit.service.js";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { SlotQueueService } from "../slots/slot-queue.service.js";
import {
  AssignClinicAdminInput,
  CreateClinicInput,
  CreateClinicLocationInput,
  CreateClosureInput,
  ListClinicsQuery,
  SetLocationHoursInput,
  UpdateClinicInput,
  UpdateClinicLocationInput,
  UpdateClinicStatusInput
} from "./clinic.schemas.js";

@Injectable()
export class ClinicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly slotQueueService: SlotQueueService
  ) {}

  async createClinic(actor: AuthenticatedUser, input: CreateClinicInput, context: RequestContext) {
    await this.assertCan(actor, "clinic.create", "platform", null);

    const clinic = await this.prisma.clinic.create({
      data: {
        ...this.mapClinicCreateInput(input),
        status: ClinicStatus.DRAFT,
        createdByUserId: actor.id
      }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.create",
      entityType: "clinic",
      entityId: clinic.id,
      clinicId: clinic.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      afterData: this.toJson(clinic)
    });

    return clinic;
  }

  async listClinics(actor: AuthenticatedUser, query: ListClinicsQuery) {
    const canReadPlatform = await this.authorizationService.can(actor, "clinic.read", {
      scope: "platform"
    });
    const where: Prisma.ClinicWhereInput = {
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } }
            ]
          }
        : {})
    };

    if (!canReadPlatform) {
      where.OR = await this.buildScopedClinicFilters(actor);
    }

    const clinics = await this.prisma.clinic.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        locations: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
        }
      }
    });

    return { clinics };
  }

  async getClinic(actor: AuthenticatedUser, clinicId: string) {
    await this.assertCan(actor, "clinic.read", "clinic", clinicId);

    const clinic = await this.prisma.clinic.findFirst({
      where: {
        id: clinicId,
        deletedAt: null
      },
      include: {
        locations: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          include: {
            hours: {
              orderBy: [{ dayOfWeek: "asc" }, { opensAt: "asc" }]
            },
            closures: {
              orderBy: { startsAt: "desc" }
            }
          }
        },
        admins: {
          where: { status: ClinicAssociationStatus.APPROVED },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                phone: true,
                fullName: true,
                status: true
              }
            }
          }
        }
      }
    });

    if (!clinic) {
      throw new NotFoundException("Clinic not found");
    }

    return clinic;
  }

  async updateClinic(
    actor: AuthenticatedUser,
    clinicId: string,
    input: UpdateClinicInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "clinic.update", "clinic", clinicId);
    await this.getExistingClinic(clinicId);

    const clinic = await this.prisma.clinic.update({
      where: { id: clinicId },
      data: this.mapClinicUpdateInput(input)
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.update",
      entityType: "clinic",
      entityId: clinic.id,
      clinicId: clinic.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      afterData: this.toJson(clinic)
    });

    return clinic;
  }

  async updateClinicStatus(
    actor: AuthenticatedUser,
    clinicId: string,
    input: UpdateClinicStatusInput,
    context: RequestContext
  ) {
    const permission = input.status === ClinicStatus.SUSPENDED ? "clinic.suspend" : "clinic.update";
    await this.assertCan(actor, permission, "clinic", clinicId);
    await this.getExistingClinic(clinicId);

    const clinic = await this.prisma.clinic.update({
      where: { id: clinicId },
      data: { status: input.status }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.status.update",
      entityType: "clinic",
      entityId: clinic.id,
      clinicId: clinic.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { status: input.status, reason: input.reason ?? null }
    });

    await this.slotQueueService.enqueueClinic(clinic.id, { reason: "doctor_clinic_changed" });

    return clinic;
  }

  async deleteClinic(actor: AuthenticatedUser, clinicId: string, context: RequestContext) {
    await this.assertCan(actor, "clinic.suspend", "clinic", clinicId);
    await this.getExistingClinic(clinicId);
    await this.assertNoFutureAppointments({ clinicId });

    const clinic = await this.prisma.clinic.update({
      where: { id: clinicId },
      data: {
        status: ClinicStatus.CLOSED,
        deletedAt: new Date()
      }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.delete",
      entityType: "clinic",
      entityId: clinic.id,
      clinicId: clinic.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    await this.slotQueueService.enqueueClinic(clinic.id, { reason: "doctor_clinic_changed" });

    return clinic;
  }

  async createLocation(
    actor: AuthenticatedUser,
    clinicId: string,
    input: CreateClinicLocationInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "clinic.location.manage", "clinic", clinicId);
    await this.getExistingClinic(clinicId);

    const location = await this.prisma.$transaction(async (tx) => {
      const existingLocations = await tx.clinicLocation.count({
        where: {
          clinicId,
          deletedAt: null
        }
      });
      const shouldBePrimary = input.isPrimary || existingLocations === 0;

      if (shouldBePrimary) {
        await tx.clinicLocation.updateMany({
          where: { clinicId, deletedAt: null },
          data: { isPrimary: false }
        });
      }

      return tx.clinicLocation.create({
        data: this.mapLocationCreateInput(clinicId, input, shouldBePrimary)
      });
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.location.create",
      entityType: "clinic_location",
      entityId: location.id,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      afterData: this.toJson(location)
    });

    await this.slotQueueService.enqueueLocation(location.id, { reason: "clinic_hours_changed" });

    return location;
  }

  async listLocations(actor: AuthenticatedUser, clinicId: string) {
    await this.assertCan(actor, "clinic.read", "clinic", clinicId);
    await this.getExistingClinic(clinicId);

    const locations = await this.prisma.clinicLocation.findMany({
      where: {
        clinicId,
        deletedAt: null
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
    });

    return { locations };
  }

  async updateLocation(
    actor: AuthenticatedUser,
    clinicId: string,
    locationId: string,
    input: UpdateClinicLocationInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "clinic.location.manage", "clinic", clinicId);
    await this.getExistingLocation(clinicId, locationId);

    const location = await this.prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.clinicLocation.updateMany({
          where: { clinicId, deletedAt: null, id: { not: locationId } },
          data: { isPrimary: false }
        });
      }

      return tx.clinicLocation.update({
        where: { id: locationId },
        data: this.mapLocationUpdateInput(input)
      });
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.location.update",
      entityType: "clinic_location",
      entityId: location.id,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      afterData: this.toJson(location)
    });

    return location;
  }

  async deleteLocation(
    actor: AuthenticatedUser,
    clinicId: string,
    locationId: string,
    context: RequestContext
  ) {
    await this.assertCan(actor, "clinic.location.manage", "clinic", clinicId);
    await this.getExistingLocation(clinicId, locationId);
    await this.assertNoFutureAppointments({ clinicLocationId: locationId });

    const location = await this.prisma.clinicLocation.update({
      where: { id: locationId },
      data: {
        deletedAt: new Date(),
        status: ClinicStatus.CLOSED,
        isPrimary: false
      }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.location.delete",
      entityType: "clinic_location",
      entityId: location.id,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    await this.slotQueueService.enqueueLocation(location.id, { reason: "clinic_hours_changed" });

    return location;
  }

  async setLocationHours(
    actor: AuthenticatedUser,
    clinicId: string,
    locationId: string,
    input: SetLocationHoursInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "clinic.location.manage", "clinic", clinicId);
    await this.getExistingLocation(clinicId, locationId);

    const hours = await this.prisma.$transaction(async (tx) => {
      await tx.clinicLocationHour.deleteMany({ where: { locationId } });

      const created = [];

      for (const hour of input.hours) {
        created.push(
          await tx.clinicLocationHour.create({
            data: {
              locationId,
              dayOfWeek: hour.dayOfWeek,
              opensAt: hour.opensAt ? this.timeToDate(hour.opensAt) : null,
              closesAt: hour.closesAt ? this.timeToDate(hour.closesAt) : null,
              isClosed: hour.isClosed,
              effectiveFrom: hour.effectiveFrom ? this.dateToDate(hour.effectiveFrom) : null,
              effectiveTo: hour.effectiveTo ? this.dateToDate(hour.effectiveTo) : null
            }
          })
        );
      }

      return created;
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.location.hours.update",
      entityType: "clinic_location",
      entityId: locationId,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { count: hours.length }
    });

    await this.slotQueueService.enqueueLocation(locationId, { reason: "clinic_hours_changed" });

    return { hours };
  }

  async createClosure(
    actor: AuthenticatedUser,
    clinicId: string,
    locationId: string,
    input: CreateClosureInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "clinic.location.manage", "clinic", clinicId);
    await this.getExistingLocation(clinicId, locationId);

    const closure = await this.prisma.clinicLocationClosure.create({
      data: {
        locationId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        reason: input.reason,
        createdByUserId: actor.id
      }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.location.closure.create",
      entityType: "clinic_location_closure",
      entityId: closure.id,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      afterData: this.toJson(closure)
    });

    await this.slotQueueService.enqueueLocation(locationId, { reason: "clinic_closure_changed" });

    return closure;
  }

  async deleteClosure(
    actor: AuthenticatedUser,
    clinicId: string,
    locationId: string,
    closureId: string,
    context: RequestContext
  ) {
    await this.assertCan(actor, "clinic.location.manage", "clinic", clinicId);
    await this.getExistingLocation(clinicId, locationId);
    const closure = await this.prisma.clinicLocationClosure.findFirst({
      where: { id: closureId, locationId }
    });

    if (!closure) {
      throw new NotFoundException("Closure not found");
    }

    await this.prisma.clinicLocationClosure.delete({
      where: { id: closureId }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.location.closure.delete",
      entityType: "clinic_location_closure",
      entityId: closureId,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    await this.slotQueueService.enqueueLocation(locationId, { reason: "clinic_closure_changed" });

    return { deleted: true };
  }

  async assignClinicAdmin(
    actor: AuthenticatedUser,
    clinicId: string,
    input: AssignClinicAdminInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "clinic.admin.manage", "clinic", clinicId);
    await this.getExistingClinic(clinicId);

    const user = await this.prisma.user.findFirst({
      where: {
        id: input.userId,
        deletedAt: null,
        status: { not: UserStatus.DEACTIVATED }
      },
      select: { id: true }
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    const adminRole = await this.prisma.role.findUnique({
      where: { code: "clinic_admin" },
      select: { id: true }
    });

    if (!adminRole) {
      throw new ConflictException("Missing clinic_admin role seed");
    }

    const admin = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.upsert({
        where: {
          userId_roleId: {
            userId: input.userId,
            roleId: adminRole.id
          }
        },
        update: {},
        create: {
          userId: input.userId,
          roleId: adminRole.id
        }
      });

      return tx.clinicAdmin.upsert({
        where: {
          clinicId_userId: {
            clinicId,
            userId: input.userId
          }
        },
        update: { status: ClinicAssociationStatus.APPROVED },
        create: {
          clinicId,
          userId: input.userId,
          status: ClinicAssociationStatus.APPROVED
        }
      });
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.admin.assign",
      entityType: "clinic_admin",
      entityId: admin.id,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { userId: input.userId }
    });

    return admin;
  }

  async removeClinicAdmin(
    actor: AuthenticatedUser,
    clinicId: string,
    userId: string,
    context: RequestContext
  ) {
    await this.assertCan(actor, "clinic.admin.manage", "clinic", clinicId);

    const admin = await this.prisma.clinicAdmin.findUnique({
      where: {
        clinicId_userId: {
          clinicId,
          userId
        }
      }
    });

    if (!admin) {
      throw new NotFoundException("Clinic admin assignment not found");
    }

    const updated = await this.prisma.clinicAdmin.update({
      where: { id: admin.id },
      data: { status: ClinicAssociationStatus.REMOVED }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "clinic.admin.remove",
      entityType: "clinic_admin",
      entityId: updated.id,
      clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { userId }
    });

    return updated;
  }

  private async getExistingClinic(clinicId: string) {
    const clinic = await this.prisma.clinic.findFirst({
      where: {
        id: clinicId,
        deletedAt: null
      }
    });

    if (!clinic) {
      throw new NotFoundException("Clinic not found");
    }

    return clinic;
  }

  private async getExistingLocation(clinicId: string, locationId: string) {
    const location = await this.prisma.clinicLocation.findFirst({
      where: {
        id: locationId,
        clinicId,
        deletedAt: null
      }
    });

    if (!location) {
      throw new NotFoundException("Clinic location not found");
    }

    return location;
  }

  private async assertNoFutureAppointments(input: {
    clinicId?: string;
    clinicLocationId?: string;
  }) {
    const futureAppointment = await this.prisma.appointment.findFirst({
      where: {
        startsAt: { gt: new Date() },
        ...(input.clinicId ? { clinicId: input.clinicId } : {}),
        ...(input.clinicLocationId ? { clinicLocationId: input.clinicLocationId } : {})
      },
      select: { id: true }
    });

    if (futureAppointment) {
      throw new ConflictException("Cannot delete record with future appointments");
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

  private async buildScopedClinicFilters(
    actor: AuthenticatedUser
  ): Promise<Prisma.ClinicWhereInput[]> {
    const filters: Prisma.ClinicWhereInput[] = [];

    if (actor.roles.includes("clinic_admin")) {
      filters.push({
        admins: {
          some: {
            userId: actor.id,
            status: ClinicAssociationStatus.APPROVED
          }
        }
      });
    }

    if (actor.roles.includes("receptionist")) {
      filters.push({
        receptionists: {
          some: {
            userId: actor.id,
            status: ClinicAssociationStatus.APPROVED
          }
        }
      });
    }

    if (actor.roles.includes("doctor")) {
      filters.push({
        doctorClinics: {
          some: {
            doctor: {
              userId: actor.id
            },
            status: {
              in: [ClinicAssociationStatus.PENDING, ClinicAssociationStatus.APPROVED]
            }
          }
        }
      });
    }

    if (filters.length === 0) {
      filters.push({ status: ClinicStatus.ACTIVE, deletedAt: null });
    }

    return filters;
  }

  private mapClinicCreateInput(input: CreateClinicInput): Prisma.ClinicUncheckedCreateInput {
    return {
      name: input.name,
      slug: input.slug,
      description: input.description,
      email: input.email,
      phone: input.phone,
      websiteUrl: input.websiteUrl,
      defaultPaymentMode: input.defaultPaymentMode,
      cancellationWindowMinutes: input.cancellationWindowMinutes,
      refundProcessingDays: input.refundProcessingDays
    };
  }

  private mapClinicUpdateInput(input: UpdateClinicInput): Prisma.ClinicUncheckedUpdateInput {
    return {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl } : {}),
      ...(input.defaultPaymentMode !== undefined
        ? { defaultPaymentMode: input.defaultPaymentMode }
        : {}),
      ...(input.cancellationWindowMinutes !== undefined
        ? { cancellationWindowMinutes: input.cancellationWindowMinutes }
        : {}),
      ...(input.refundProcessingDays !== undefined
        ? { refundProcessingDays: input.refundProcessingDays }
        : {})
    };
  }

  private mapLocationCreateInput(
    clinicId: string,
    input: CreateClinicLocationInput,
    isPrimary: boolean
  ): Prisma.ClinicLocationUncheckedCreateInput {
    return {
      clinicId,
      name: input.name,
      address: input.address,
      city: input.city,
      district: input.district,
      province: input.province,
      country: input.country,
      timezone: input.timezone,
      latitude: input.latitude,
      longitude: input.longitude,
      phone: input.phone,
      isPrimary,
      status: input.status
    };
  }

  private mapLocationUpdateInput(
    input: UpdateClinicLocationInput
  ): Prisma.ClinicLocationUncheckedUpdateInput {
    return {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.district !== undefined ? { district: input.district } : {}),
      ...(input.province !== undefined ? { province: input.province } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
      ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
      ...(input.status !== undefined ? { status: input.status } : {})
    };
  }

  private timeToDate(value: string) {
    return new Date(`1970-01-01T${value.length === 5 ? `${value}:00` : value}.000Z`);
  }

  private dateToDate(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private toJson(value: unknown) {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
  }
}
