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
  Prisma
} from "@doctobook/database";
import { AuditService } from "../audit/audit.service.js";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CreateAvailabilityBreakInput,
  CreateAvailabilityRuleInput,
  CreateDoctorTimeOffInput,
  UpdateAvailabilityRuleInput
} from "./availability.schemas.js";

@Injectable()
export class DoctorAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService
  ) {}

  async listMyAvailability(actor: AuthenticatedUser, associationId: string) {
    const association = await this.getOwnedAssociation(actor, associationId, "availability.read");

    return this.listAvailabilityForAssociation(association);
  }

  async createMyAvailabilityRule(
    actor: AuthenticatedUser,
    associationId: string,
    input: CreateAvailabilityRuleInput,
    context: RequestContext
  ) {
    const association = await this.getOwnedAssociation(actor, associationId, "availability.manage");

    return this.createAvailabilityRule(actor, association, input, context);
  }

  async updateMyAvailabilityRule(
    actor: AuthenticatedUser,
    ruleId: string,
    input: UpdateAvailabilityRuleInput,
    context: RequestContext
  ) {
    const rule = await this.getOwnedRule(actor, ruleId, "availability.manage");

    return this.updateAvailabilityRule(actor, rule, input, context);
  }

  async deleteMyAvailabilityRule(
    actor: AuthenticatedUser,
    ruleId: string,
    context: RequestContext
  ) {
    const rule = await this.getOwnedRule(actor, ruleId, "availability.manage");

    return this.deleteAvailabilityRule(actor, rule, context);
  }

  async createMyAvailabilityBreak(
    actor: AuthenticatedUser,
    ruleId: string,
    input: CreateAvailabilityBreakInput,
    context: RequestContext
  ) {
    const rule = await this.getOwnedRule(actor, ruleId, "availability.manage");

    return this.createAvailabilityBreak(actor, rule, input, context);
  }

  async deleteMyAvailabilityBreak(
    actor: AuthenticatedUser,
    breakId: string,
    context: RequestContext
  ) {
    const availabilityBreak = await this.getOwnedBreak(actor, breakId, "availability.manage");

    return this.deleteAvailabilityBreak(actor, availabilityBreak, context);
  }

  async listMyTimeOff(actor: AuthenticatedUser, associationId: string) {
    const association = await this.getOwnedAssociation(actor, associationId, "availability.read");

    return this.listTimeOffForAssociation(association.id);
  }

  async createMyTimeOff(
    actor: AuthenticatedUser,
    associationId: string,
    input: CreateDoctorTimeOffInput,
    context: RequestContext
  ) {
    const association = await this.getOwnedAssociation(actor, associationId, "availability.manage");

    return this.createTimeOff(actor, association, input, context);
  }

  async deleteMyTimeOff(actor: AuthenticatedUser, timeOffId: string, context: RequestContext) {
    const timeOff = await this.getOwnedTimeOff(actor, timeOffId, "availability.manage");

    return this.deleteTimeOff(actor, timeOff, context);
  }

  async listClinicAvailability(
    actor: AuthenticatedUser,
    clinicId: string,
    associationId: string
  ) {
    await this.assertCan(actor, "availability.read", "clinic", clinicId);
    const association = await this.getClinicAssociation(clinicId, associationId);

    return this.listAvailabilityForAssociation(association);
  }

  async createClinicAvailabilityRule(
    actor: AuthenticatedUser,
    clinicId: string,
    associationId: string,
    input: CreateAvailabilityRuleInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "availability.manage", "clinic", clinicId);
    const association = await this.getClinicAssociation(clinicId, associationId);

    return this.createAvailabilityRule(actor, association, input, context);
  }

  async updateClinicAvailabilityRule(
    actor: AuthenticatedUser,
    clinicId: string,
    ruleId: string,
    input: UpdateAvailabilityRuleInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "availability.manage", "clinic", clinicId);
    const rule = await this.getClinicRule(clinicId, ruleId);

    return this.updateAvailabilityRule(actor, rule, input, context);
  }

  async deleteClinicAvailabilityRule(
    actor: AuthenticatedUser,
    clinicId: string,
    ruleId: string,
    context: RequestContext
  ) {
    await this.assertCan(actor, "availability.manage", "clinic", clinicId);
    const rule = await this.getClinicRule(clinicId, ruleId);

    return this.deleteAvailabilityRule(actor, rule, context);
  }

  async createClinicAvailabilityBreak(
    actor: AuthenticatedUser,
    clinicId: string,
    ruleId: string,
    input: CreateAvailabilityBreakInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "availability.manage", "clinic", clinicId);
    const rule = await this.getClinicRule(clinicId, ruleId);

    return this.createAvailabilityBreak(actor, rule, input, context);
  }

  async deleteClinicAvailabilityBreak(
    actor: AuthenticatedUser,
    clinicId: string,
    breakId: string,
    context: RequestContext
  ) {
    await this.assertCan(actor, "availability.manage", "clinic", clinicId);
    const availabilityBreak = await this.getClinicBreak(clinicId, breakId);

    return this.deleteAvailabilityBreak(actor, availabilityBreak, context);
  }

  async listClinicTimeOff(actor: AuthenticatedUser, clinicId: string, associationId: string) {
    await this.assertCan(actor, "availability.read", "clinic", clinicId);
    const association = await this.getClinicAssociation(clinicId, associationId);

    return this.listTimeOffForAssociation(association.id);
  }

  async createClinicTimeOff(
    actor: AuthenticatedUser,
    clinicId: string,
    associationId: string,
    input: CreateDoctorTimeOffInput,
    context: RequestContext
  ) {
    await this.assertCan(actor, "availability.manage", "clinic", clinicId);
    const association = await this.getClinicAssociation(clinicId, associationId);

    return this.createTimeOff(actor, association, input, context);
  }

  async deleteClinicTimeOff(
    actor: AuthenticatedUser,
    clinicId: string,
    timeOffId: string,
    context: RequestContext
  ) {
    await this.assertCan(actor, "availability.manage", "clinic", clinicId);
    const timeOff = await this.getClinicTimeOff(clinicId, timeOffId);

    return this.deleteTimeOff(actor, timeOff, context);
  }

  private async listAvailabilityForAssociation(association: AssociationRecord) {
    const [availabilityRules, clinicHours, clinicClosures] = await Promise.all([
      this.prisma.doctorAvailabilityRule.findMany({
        where: { doctorClinicId: association.id },
        include: { breaks: { orderBy: { startsAt: "asc" } } },
        orderBy: [{ dayOfWeek: "asc" }, { startsAt: "asc" }]
      }),
      this.prisma.clinicLocationHour.findMany({
        where: { locationId: association.clinicLocationId },
        orderBy: [{ dayOfWeek: "asc" }, { opensAt: "asc" }]
      }),
      this.prisma.clinicLocationClosure.findMany({
        where: { locationId: association.clinicLocationId, endsAt: { gte: new Date() } },
        orderBy: { startsAt: "asc" }
      })
    ]);

    return {
      clinicTimezone: association.clinicLocation.timezone,
      availabilityRules,
      clinicHours,
      clinicClosures
    };
  }

  private async createAvailabilityRule(
    actor: AuthenticatedUser,
    association: AssociationRecord,
    input: CreateAvailabilityRuleInput,
    context: RequestContext
  ) {
    this.assertApprovedAssociation(association);
    await this.assertAvailabilityFitsClinicHours(association, input);
    await this.assertNoAvailabilityOverlap(association.id, input);

    try {
      const availabilityRule = await this.prisma.doctorAvailabilityRule.create({
        data: this.mapAvailabilityCreateInput(association.id, input),
        include: { breaks: true }
      });

      await this.auditService.record({
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode: "doctor_availability.create",
        entityType: "doctor_availability_rule",
        entityId: availabilityRule.id,
        clinicId: association.clinicId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        afterData: this.toJson(availabilityRule)
      });

      return availabilityRule;
    } catch (error) {
      this.throwAvailabilityConstraint(error);
      throw error;
    }
  }

  private async updateAvailabilityRule(
    actor: AuthenticatedUser,
    existingRule: RuleRecord,
    input: UpdateAvailabilityRuleInput,
    context: RequestContext
  ) {
    this.assertApprovedAssociation(existingRule.doctorClinic);
    const merged = this.mergeAvailabilityRule(existingRule, input);

    if (merged.isActive) {
      await this.assertAvailabilityFitsClinicHours(existingRule.doctorClinic, merged);
      await this.assertNoAvailabilityOverlap(existingRule.doctorClinicId, merged, existingRule.id);
    }

    try {
      const availabilityRule = await this.prisma.doctorAvailabilityRule.update({
        where: { id: existingRule.id },
        data: this.mapAvailabilityUpdateInput(input),
        include: { breaks: { orderBy: { startsAt: "asc" } } }
      });

      await this.auditService.record({
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode: "doctor_availability.update",
        entityType: "doctor_availability_rule",
        entityId: availabilityRule.id,
        clinicId: existingRule.doctorClinic.clinicId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        afterData: this.toJson(availabilityRule)
      });

      return availabilityRule;
    } catch (error) {
      this.throwAvailabilityConstraint(error);
      throw error;
    }
  }

  private async deleteAvailabilityRule(
    actor: AuthenticatedUser,
    rule: RuleRecord,
    context: RequestContext
  ) {
    await this.prisma.doctorAvailabilityRule.delete({ where: { id: rule.id } });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor_availability.delete",
      entityType: "doctor_availability_rule",
      entityId: rule.id,
      clinicId: rule.doctorClinic.clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return { deleted: true };
  }

  private async createAvailabilityBreak(
    actor: AuthenticatedUser,
    rule: RuleRecord,
    input: CreateAvailabilityBreakInput,
    context: RequestContext
  ) {
    this.assertApprovedAssociation(rule.doctorClinic);
    await this.assertBreakFitsRule(rule, input);

    const availabilityBreak = await this.prisma.doctorAvailabilityBreak.create({
      data: {
        ruleId: rule.id,
        startsAt: this.timeToDate(input.startsAt),
        endsAt: this.timeToDate(input.endsAt)
      }
    });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor_availability.break.create",
      entityType: "doctor_availability_break",
      entityId: availabilityBreak.id,
      clinicId: rule.doctorClinic.clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      afterData: this.toJson(availabilityBreak)
    });

    return availabilityBreak;
  }

  private async deleteAvailabilityBreak(
    actor: AuthenticatedUser,
    availabilityBreak: BreakRecord,
    context: RequestContext
  ) {
    await this.prisma.doctorAvailabilityBreak.delete({ where: { id: availabilityBreak.id } });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor_availability.break.delete",
      entityType: "doctor_availability_break",
      entityId: availabilityBreak.id,
      clinicId: availabilityBreak.rule.doctorClinic.clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return { deleted: true };
  }

  private async listTimeOffForAssociation(doctorClinicId: string) {
    const timeOff = await this.prisma.doctorTimeOff.findMany({
      where: { doctorClinicId },
      orderBy: { startsAt: "asc" }
    });

    return { timeOff };
  }

  private async createTimeOff(
    actor: AuthenticatedUser,
    association: AssociationRecord,
    input: CreateDoctorTimeOffInput,
    context: RequestContext
  ) {
    this.assertApprovedAssociation(association);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException("Time off end must be after start");
    }

    if (input.doctorClinicServiceId) {
      await this.assertDoctorClinicServiceBelongsToAssociation(
        association.id,
        input.doctorClinicServiceId
      );
    }

    try {
      const timeOff = await this.prisma.doctorTimeOff.create({
        data: {
          doctorClinicId: association.id,
          doctorClinicServiceId: input.doctorClinicServiceId,
          startsAt,
          endsAt,
          reason: input.reason,
          createdByUserId: actor.id
        }
      });

      await this.auditService.record({
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode: "doctor_time_off.create",
        entityType: "doctor_time_off",
        entityId: timeOff.id,
        clinicId: association.clinicId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        afterData: this.toJson(timeOff)
      });

      return timeOff;
    } catch (error) {
      this.throwTimeOffConstraint(error);
      throw error;
    }
  }

  private async deleteTimeOff(
    actor: AuthenticatedUser,
    timeOff: TimeOffRecord,
    context: RequestContext
  ) {
    await this.prisma.doctorTimeOff.delete({ where: { id: timeOff.id } });

    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.roles[0] ?? null,
      actionCode: "doctor_time_off.delete",
      entityType: "doctor_time_off",
      entityId: timeOff.id,
      clinicId: timeOff.doctorClinic.clinicId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent
    });

    return { deleted: true };
  }

  private async getOwnedAssociation(
    actor: AuthenticatedUser,
    associationId: string,
    permissionCode: string
  ) {
    const allowed = await this.authorizationService.can(actor, permissionCode, {
      scope: "doctor_clinic",
      scopeId: associationId
    });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }

    const association = await this.prisma.doctorClinic.findFirst({
      where: {
        id: associationId,
        deletedAt: null,
        doctor: { userId: actor.id }
      },
      include: this.associationInclude()
    });

    if (!association) {
      throw new NotFoundException("Doctor clinic association not found");
    }

    return association;
  }

  private async getClinicAssociation(clinicId: string, associationId: string) {
    const association = await this.prisma.doctorClinic.findFirst({
      where: {
        id: associationId,
        clinicId,
        deletedAt: null
      },
      include: this.associationInclude()
    });

    if (!association) {
      throw new NotFoundException("Doctor clinic association not found");
    }

    return association;
  }

  private async getOwnedRule(actor: AuthenticatedUser, ruleId: string, permissionCode: string) {
    const rule = await this.prisma.doctorAvailabilityRule.findFirst({
      where: {
        id: ruleId,
        doctorClinic: {
          deletedAt: null,
          doctor: { userId: actor.id }
        }
      },
      include: this.ruleInclude()
    });

    if (!rule) {
      throw new NotFoundException("Availability rule not found");
    }

    const allowed = await this.authorizationService.can(actor, permissionCode, {
      scope: "doctor_clinic",
      scopeId: rule.doctorClinicId
    });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }

    return rule;
  }

  private async getClinicRule(clinicId: string, ruleId: string) {
    const rule = await this.prisma.doctorAvailabilityRule.findFirst({
      where: {
        id: ruleId,
        doctorClinic: {
          clinicId,
          deletedAt: null
        }
      },
      include: this.ruleInclude()
    });

    if (!rule) {
      throw new NotFoundException("Availability rule not found");
    }

    return rule;
  }

  private async getOwnedBreak(actor: AuthenticatedUser, breakId: string, permissionCode: string) {
    const availabilityBreak = await this.prisma.doctorAvailabilityBreak.findFirst({
      where: {
        id: breakId,
        rule: {
          doctorClinic: {
            deletedAt: null,
            doctor: { userId: actor.id }
          }
        }
      },
      include: this.breakInclude()
    });

    if (!availabilityBreak) {
      throw new NotFoundException("Availability break not found");
    }

    const allowed = await this.authorizationService.can(actor, permissionCode, {
      scope: "doctor_clinic",
      scopeId: availabilityBreak.rule.doctorClinicId
    });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }

    return availabilityBreak;
  }

  private async getClinicBreak(clinicId: string, breakId: string) {
    const availabilityBreak = await this.prisma.doctorAvailabilityBreak.findFirst({
      where: {
        id: breakId,
        rule: {
          doctorClinic: {
            clinicId,
            deletedAt: null
          }
        }
      },
      include: this.breakInclude()
    });

    if (!availabilityBreak) {
      throw new NotFoundException("Availability break not found");
    }

    return availabilityBreak;
  }

  private async getOwnedTimeOff(actor: AuthenticatedUser, timeOffId: string, permissionCode: string) {
    const timeOff = await this.prisma.doctorTimeOff.findFirst({
      where: {
        id: timeOffId,
        doctorClinic: {
          deletedAt: null,
          doctor: { userId: actor.id }
        }
      },
      include: this.timeOffInclude()
    });

    if (!timeOff) {
      throw new NotFoundException("Time off not found");
    }

    const allowed = await this.authorizationService.can(actor, permissionCode, {
      scope: "doctor_clinic",
      scopeId: timeOff.doctorClinicId
    });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }

    return timeOff;
  }

  private async getClinicTimeOff(clinicId: string, timeOffId: string) {
    const timeOff = await this.prisma.doctorTimeOff.findFirst({
      where: {
        id: timeOffId,
        doctorClinic: {
          clinicId,
          deletedAt: null
        }
      },
      include: this.timeOffInclude()
    });

    if (!timeOff) {
      throw new NotFoundException("Time off not found");
    }

    return timeOff;
  }

  private assertApprovedAssociation(association: AssociationRecord) {
    if (
      association.status !== ClinicAssociationStatus.APPROVED ||
      association.doctor.status !== DoctorStatus.APPROVED
    ) {
      throw new BadRequestException(
        "Availability can only be managed for an approved doctor-clinic association"
      );
    }
  }

  private async assertAvailabilityFitsClinicHours(
    association: AssociationRecord,
    input: AvailabilityWindowInput
  ) {
    this.assertAvailabilityWindow(input);
    const hours = await this.prisma.clinicLocationHour.findMany({
      where: {
        locationId: association.clinicLocationId,
        dayOfWeek: input.dayOfWeek,
        isClosed: false
      }
    });
    const startsAt = this.timeInputToMinutes(input.startsAt);
    const endsAt = this.timeInputToMinutes(input.endsAt);
    const effectiveFrom = this.optionalDateInput(input.effectiveFrom);
    const effectiveTo = this.optionalDateInput(input.effectiveTo);
    const isContained = hours.some((hour) => {
      if (!hour.opensAt || !hour.closesAt) {
        return false;
      }

      return (
        this.timeDateToMinutes(hour.opensAt) <= startsAt &&
        this.timeDateToMinutes(hour.closesAt) >= endsAt &&
        this.dateRangeContains(
          hour.effectiveFrom,
          hour.effectiveTo,
          effectiveFrom,
          effectiveTo
        )
      );
    });

    if (!isContained) {
      throw new BadRequestException("Availability must fall inside clinic operating hours");
    }
  }

  private assertAvailabilityWindow(input: AvailabilityWindowInput) {
    if (this.timeInputToMinutes(input.startsAt) >= this.timeInputToMinutes(input.endsAt)) {
      throw new BadRequestException("Availability end must be after start");
    }

    const effectiveFrom = this.optionalDateInput(input.effectiveFrom);
    const effectiveTo = this.optionalDateInput(input.effectiveTo);

    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException("Availability effective end must be after effective start");
    }
  }

  private async assertNoAvailabilityOverlap(
    doctorClinicId: string,
    input: AvailabilityWindowInput,
    excludingRuleId?: string
  ) {
    const rules = await this.prisma.doctorAvailabilityRule.findMany({
      where: {
        doctorClinicId,
        dayOfWeek: input.dayOfWeek,
        isActive: true,
        ...(excludingRuleId ? { id: { not: excludingRuleId } } : {})
      }
    });
    const startsAt = this.timeInputToMinutes(input.startsAt);
    const endsAt = this.timeInputToMinutes(input.endsAt);
    const effectiveFrom = this.optionalDateInput(input.effectiveFrom);
    const effectiveTo = this.optionalDateInput(input.effectiveTo);

    const hasOverlap = rules.some(
      (rule) =>
        this.rangesOverlap(startsAt, endsAt, this.timeDateToMinutes(rule.startsAt), this.timeDateToMinutes(rule.endsAt)) &&
        this.dateRangesOverlap(effectiveFrom, effectiveTo, rule.effectiveFrom, rule.effectiveTo)
    );

    if (hasOverlap) {
      throw new ConflictException("Doctor availability overlaps an existing rule");
    }
  }

  private async assertBreakFitsRule(rule: RuleRecord, input: CreateAvailabilityBreakInput) {
    const startsAt = this.timeInputToMinutes(input.startsAt);
    const endsAt = this.timeInputToMinutes(input.endsAt);

    if (startsAt >= endsAt) {
      throw new BadRequestException("Break end must be after start");
    }

    if (
      startsAt < this.timeDateToMinutes(rule.startsAt) ||
      endsAt > this.timeDateToMinutes(rule.endsAt)
    ) {
      throw new BadRequestException("Break must fall inside availability rule");
    }

    const hasOverlap = rule.breaks.some((existingBreak) =>
      this.rangesOverlap(
        startsAt,
        endsAt,
        this.timeDateToMinutes(existingBreak.startsAt),
        this.timeDateToMinutes(existingBreak.endsAt)
      )
    );

    if (hasOverlap) {
      throw new ConflictException("Break overlaps an existing break");
    }
  }

  private async assertDoctorClinicServiceBelongsToAssociation(
    doctorClinicId: string,
    doctorClinicServiceId: string
  ) {
    const doctorClinicService = await this.prisma.doctorClinicService.findFirst({
      where: {
        id: doctorClinicServiceId,
        doctorClinicId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!doctorClinicService) {
      throw new BadRequestException("Doctor clinic service does not belong to this association");
    }
  }

  private async assertCan(
    actor: AuthenticatedUser,
    permissionCode: string,
    scope: "clinic" | "doctor_clinic",
    scopeId: string
  ) {
    const allowed = await this.authorizationService.can(actor, permissionCode, {
      scope,
      scopeId
    });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }
  }

  private associationInclude() {
    return {
      clinicLocation: { select: { timezone: true } },
      doctor: { select: { userId: true, status: true } }
    } satisfies Prisma.DoctorClinicInclude;
  }

  private ruleInclude() {
    return {
      breaks: { orderBy: { startsAt: "asc" } },
      doctorClinic: { include: this.associationInclude() }
    } satisfies Prisma.DoctorAvailabilityRuleInclude;
  }

  private breakInclude() {
    return {
      rule: { include: this.ruleInclude() }
    } satisfies Prisma.DoctorAvailabilityBreakInclude;
  }

  private timeOffInclude() {
    return {
      doctorClinic: { include: this.associationInclude() }
    } satisfies Prisma.DoctorTimeOffInclude;
  }

  private mapAvailabilityCreateInput(
    doctorClinicId: string,
    input: CreateAvailabilityRuleInput
  ): Prisma.DoctorAvailabilityRuleUncheckedCreateInput {
    return {
      doctorClinicId,
      dayOfWeek: input.dayOfWeek,
      startsAt: this.timeToDate(input.startsAt),
      endsAt: this.timeToDate(input.endsAt),
      slotIntervalMinutes: input.slotIntervalMinutes,
      maxPatients: input.maxPatients,
      effectiveFrom: input.effectiveFrom ? this.dateToDate(input.effectiveFrom) : null,
      effectiveTo: input.effectiveTo ? this.dateToDate(input.effectiveTo) : null,
      isActive: input.isActive
    };
  }

  private mapAvailabilityUpdateInput(
    input: UpdateAvailabilityRuleInput
  ): Prisma.DoctorAvailabilityRuleUncheckedUpdateInput {
    return {
      ...(input.dayOfWeek !== undefined ? { dayOfWeek: input.dayOfWeek } : {}),
      ...(input.startsAt !== undefined ? { startsAt: this.timeToDate(input.startsAt) } : {}),
      ...(input.endsAt !== undefined ? { endsAt: this.timeToDate(input.endsAt) } : {}),
      ...(input.slotIntervalMinutes !== undefined
        ? { slotIntervalMinutes: input.slotIntervalMinutes }
        : {}),
      ...(input.maxPatients !== undefined ? { maxPatients: input.maxPatients } : {}),
      ...(input.effectiveFrom !== undefined
        ? { effectiveFrom: input.effectiveFrom ? this.dateToDate(input.effectiveFrom) : null }
        : {}),
      ...(input.effectiveTo !== undefined
        ? { effectiveTo: input.effectiveTo ? this.dateToDate(input.effectiveTo) : null }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
    };
  }

  private mergeAvailabilityRule(
    rule: RuleRecord,
    input: UpdateAvailabilityRuleInput
  ): AvailabilityWindowInput & { isActive: boolean } {
    return {
      dayOfWeek: input.dayOfWeek ?? rule.dayOfWeek,
      startsAt: input.startsAt ?? rule.startsAt,
      endsAt: input.endsAt ?? rule.endsAt,
      effectiveFrom: input.effectiveFrom !== undefined ? input.effectiveFrom : rule.effectiveFrom,
      effectiveTo: input.effectiveTo !== undefined ? input.effectiveTo : rule.effectiveTo,
      isActive: input.isActive ?? rule.isActive
    };
  }

  private timeToDate(value: string) {
    const normalized = value.length === 5 ? `${value}:00` : value;

    return new Date(`1970-01-01T${normalized}.000Z`);
  }

  private dateToDate(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private timeInputToMinutes(value: string | Date) {
    return typeof value === "string" ? this.timeStringToMinutes(value) : this.timeDateToMinutes(value);
  }

  private timeStringToMinutes(value: string) {
    const [hours, minutes, seconds = "0"] = value.split(":");

    return Number(hours) * 60 + Number(minutes) + Number(seconds) / 60;
  }

  private timeDateToMinutes(value: Date) {
    return value.getUTCHours() * 60 + value.getUTCMinutes() + value.getUTCSeconds() / 60;
  }

  private optionalDateInput(value: string | Date | null | undefined) {
    if (!value) {
      return null;
    }

    return typeof value === "string" ? this.dateToDate(value) : value;
  }

  private dateRangeContains(
    outerStart: Date | null,
    outerEnd: Date | null,
    innerStart: Date | null,
    innerEnd: Date | null
  ) {
    const startsInside = !outerStart || (innerStart !== null && outerStart <= innerStart);
    const endsInside = !outerEnd || (innerEnd !== null && outerEnd >= innerEnd);

    return startsInside && endsInside;
  }

  private rangesOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number) {
    return firstStart < secondEnd && secondStart < firstEnd;
  }

  private dateRangesOverlap(
    firstStart: Date | null,
    firstEnd: Date | null,
    secondStart: Date | null,
    secondEnd: Date | null
  ) {
    const firstStartMs = firstStart?.getTime() ?? Number.NEGATIVE_INFINITY;
    const firstEndMs = firstEnd?.getTime() ?? Number.POSITIVE_INFINITY;
    const secondStartMs = secondStart?.getTime() ?? Number.NEGATIVE_INFINITY;
    const secondEndMs = secondEnd?.getTime() ?? Number.POSITIVE_INFINITY;

    return firstStartMs <= secondEndMs && secondStartMs <= firstEndMs;
  }

  private throwAvailabilityConstraint(error: unknown) {
    const message = String(error);

    if (message.includes("doctor availability overlaps")) {
      throw new ConflictException("Doctor availability overlaps an existing rule");
    }

    if (message.includes("doctor_availability_rules_time_chk")) {
      throw new BadRequestException("Availability end must be after start");
    }
  }

  private throwTimeOffConstraint(error: unknown) {
    const message = String(error);

    if (
      message.includes("time off service does not belong") ||
      message.includes("doctor_time_off_service_consistency")
    ) {
      throw new BadRequestException("Doctor clinic service does not belong to this association");
    }

    if (message.includes("doctor_time_off_time_chk")) {
      throw new BadRequestException("Time off end must be after start");
    }
  }

  private toJson<T>(value: T): Prisma.InputJsonValue {
    return JSON.parse(
      JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
      )
    ) as Prisma.InputJsonValue;
  }
}

type AvailabilityWindowInput = {
  dayOfWeek: number;
  startsAt: string | Date;
  endsAt: string | Date;
  effectiveFrom?: string | Date | null;
  effectiveTo?: string | Date | null;
};

type AssociationRecord = Prisma.DoctorClinicGetPayload<{
  include: {
    clinicLocation: { select: { timezone: true } };
    doctor: { select: { userId: true; status: true } };
  };
}>;

type RuleRecord = Prisma.DoctorAvailabilityRuleGetPayload<{
  include: {
    breaks: { orderBy: { startsAt: "asc" } };
    doctorClinic: {
      include: {
        clinicLocation: { select: { timezone: true } };
        doctor: { select: { userId: true; status: true } };
      };
    };
  };
}>;

type BreakRecord = Prisma.DoctorAvailabilityBreakGetPayload<{
  include: {
    rule: {
      include: {
        breaks: { orderBy: { startsAt: "asc" } };
        doctorClinic: {
          include: {
            clinicLocation: { select: { timezone: true } };
            doctor: { select: { userId: true; status: true } };
          };
        };
      };
    };
  };
}>;

type TimeOffRecord = Prisma.DoctorTimeOffGetPayload<{
  include: {
    doctorClinic: {
      include: {
        clinicLocation: { select: { timezone: true } };
        doctor: { select: { userId: true; status: true } };
      };
    };
  };
}>;
