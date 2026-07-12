import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AppointmentStatus,
  ClinicAssociationStatus,
  PaymentMode,
  PaymentStatus,
  Prisma,
  RefundStatus,
  ScopeType,
  SlotHoldStatus
} from "@doctobook/database";
import { createLogger } from "@doctobook/observability";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { ReviewService } from "../reviews/review.service.js";
import {
  CancelAppointmentInput,
  ListAppointmentsQuery,
  RecordOfflinePaymentInput,
  UpdateAppointmentStatusInput
} from "./appointment-operations.schemas.js";

const terminalAppointmentStatuses: AppointmentStatus[] = [
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CANCELLED_BY_PATIENT,
  AppointmentStatus.CANCELLED_BY_CLINIC,
  AppointmentStatus.CANCELLED_BY_ADMIN,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.EXPIRED
];

const cancellablePaymentStatuses: PaymentStatus[] = [
  PaymentStatus.INITIATED,
  PaymentStatus.PENDING
];

const ignoredRefundStatuses: RefundStatus[] = [RefundStatus.REJECTED, RefundStatus.FAILED];

const allowedTransitions: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  [AppointmentStatus.PENDING_PAYMENT]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.EXPIRED,
    AppointmentStatus.CANCELLED_BY_PATIENT,
    AppointmentStatus.CANCELLED_BY_CLINIC,
    AppointmentStatus.CANCELLED_BY_ADMIN
  ],
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.CANCELLED_BY_PATIENT,
    AppointmentStatus.CANCELLED_BY_CLINIC,
    AppointmentStatus.CANCELLED_BY_ADMIN,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.COMPLETED
  ],
  [AppointmentStatus.CHECKED_IN]: [
    AppointmentStatus.WAITING,
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED_BY_CLINIC,
    AppointmentStatus.CANCELLED_BY_ADMIN
  ],
  [AppointmentStatus.WAITING]: [
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED_BY_CLINIC,
    AppointmentStatus.CANCELLED_BY_ADMIN
  ],
  [AppointmentStatus.IN_PROGRESS]: [AppointmentStatus.COMPLETED]
};

const appointmentOperationsInclude = {
  patient: {
    include: {
      user: {
        select: {
          fullName: true,
          email: true,
          phone: true
        }
      }
    }
  },
  doctor: {
    include: {
      user: {
        select: {
          fullName: true,
          email: true
        }
      }
    }
  },
  clinic: {
    select: {
      name: true,
      slug: true,
      cancellationWindowMinutes: true
    }
  },
  clinicLocation: {
    select: {
      name: true,
      address: true,
      city: true,
      timezone: true
    }
  },
  doctorClinicService: {
    select: {
      cancellationWindowMinutes: true,
      rescheduleWindowMinutes: true,
      maxReschedules: true
    }
  },
  payments: {
    orderBy: { createdAt: "desc" }
  },
  refunds: {
    orderBy: { requestedAt: "desc" }
  },
  statusHistory: {
    orderBy: { createdAt: "asc" }
  },
  holds: {
    orderBy: { createdAt: "desc" }
  }
} satisfies Prisma.AppointmentInclude;

@Injectable()
export class AppointmentOperationsService {
  private readonly logger = createLogger({
    service: "api",
    environment: process.env.NODE_ENV ?? "development"
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly notificationService: NotificationService,
    private readonly reviewService: ReviewService
  ) {}

  async listDoctorAppointments(actor: AuthenticatedUser, query: ListAppointmentsQuery) {
    const doctor = await this.getDoctorForActor(actor);
    await this.assertCan(actor, "appointment.read", "doctor", doctor.id);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        doctorId: doctor.id,
        ...this.buildAppointmentFilters(query)
      },
      orderBy: { startsAt: "asc" },
      take: query.limit,
      include: appointmentOperationsInclude
    });

    return {
      appointments: appointments.map((appointment) => this.serializeAppointment(appointment))
    };
  }

  async getDoctorAppointment(actor: AuthenticatedUser, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        doctor: {
          userId: actor.id
        }
      },
      include: appointmentOperationsInclude
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    await this.assertCan(actor, "appointment.read", "appointment", appointment.id);

    return {
      appointment: this.serializeAppointment(appointment)
    };
  }

  async updateDoctorAppointmentStatus(
    actor: AuthenticatedUser,
    appointmentId: string,
    input: UpdateAppointmentStatusInput,
    context: RequestContext
  ) {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        doctor: {
          userId: actor.id
        }
      },
      select: { id: true }
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    return this.updateAppointmentStatus(actor, appointmentId, input, context);
  }

  async listClinicAppointments(
    actor: AuthenticatedUser,
    clinicId: string,
    query: ListAppointmentsQuery
  ) {
    await this.assertCan(actor, "appointment.read", "clinic", clinicId);
    const scopedLocationId = await this.getReceptionistScopedLocationId(actor, clinicId);
    const appointments = await this.prisma.appointment.findMany({
      where: {
        clinicId,
        ...(scopedLocationId ? { clinicLocationId: scopedLocationId } : {}),
        ...this.buildAppointmentFilters(query)
      },
      orderBy: { startsAt: "asc" },
      take: query.limit,
      include: appointmentOperationsInclude
    });

    return {
      appointments: appointments.map((appointment) => this.serializeAppointment(appointment))
    };
  }

  async getClinicAppointment(actor: AuthenticatedUser, clinicId: string, appointmentId: string) {
    const appointment = await this.getClinicScopedAppointment(actor, clinicId, appointmentId);
    await this.assertCan(actor, "appointment.read", "appointment", appointment.id);

    return {
      appointment: this.serializeAppointment(appointment)
    };
  }

  async checkInClinicAppointment(
    actor: AuthenticatedUser,
    clinicId: string,
    appointmentId: string,
    input: Pick<UpdateAppointmentStatusInput, "reason" | "queueNumber" | "internalNotes">,
    context: RequestContext
  ) {
    await this.getClinicScopedAppointment(actor, clinicId, appointmentId);

    return this.updateAppointmentStatus(
      actor,
      appointmentId,
      {
        status: "checked_in",
        reason: input.reason,
        queueNumber: input.queueNumber,
        internalNotes: input.internalNotes
      },
      context
    );
  }

  async updateClinicAppointmentStatus(
    actor: AuthenticatedUser,
    clinicId: string,
    appointmentId: string,
    input: UpdateAppointmentStatusInput,
    context: RequestContext
  ) {
    await this.getClinicScopedAppointment(actor, clinicId, appointmentId);

    return this.updateAppointmentStatus(actor, appointmentId, input, context);
  }

  async cancelPatientAppointment(
    actor: AuthenticatedUser,
    appointmentId: string,
    input: CancelAppointmentInput,
    context: RequestContext
  ) {
    const patient = await this.getPatientForActor(actor);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        patientId: patient.id
      },
      select: { id: true }
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    await this.assertCan(actor, "appointment.cancel", "appointment", appointmentId);

    const result = await this.cancelAppointment(
      actor,
      appointmentId,
      AppointmentStatus.CANCELLED_BY_PATIENT,
      input,
      {
        enforceCancellationWindow: true,
        source: "patient"
      },
      context
    );

    if (result.changed) {
      await this.safeNotify(() =>
        this.notificationService.enqueueAppointmentEvent(appointmentId, "appointment.cancelled", {
          audiences: ["patient", "doctor"],
          idempotencyKeySuffix: `${appointmentId}|patient`
        })
      );
    }

    return result;
  }

  async cancelClinicAppointment(
    actor: AuthenticatedUser,
    clinicId: string,
    appointmentId: string,
    input: CancelAppointmentInput,
    context: RequestContext
  ) {
    await this.getClinicScopedAppointment(actor, clinicId, appointmentId);
    await this.assertCan(actor, "appointment.cancel", "appointment", appointmentId);

    const result = await this.cancelAppointment(
      actor,
      appointmentId,
      AppointmentStatus.CANCELLED_BY_CLINIC,
      input,
      {
        enforceCancellationWindow: false,
        source: "clinic"
      },
      context
    );

    if (result.changed) {
      await this.safeNotify(() =>
        this.notificationService.enqueueAppointmentEvent(appointmentId, "appointment.cancelled", {
          audiences: ["patient", "doctor"],
          idempotencyKeySuffix: `${appointmentId}|clinic`
        })
      );
    }

    return result;
  }

  async recordOfflinePayment(
    actor: AuthenticatedUser,
    clinicId: string,
    appointmentId: string,
    input: RecordOfflinePaymentInput,
    context: RequestContext
  ) {
    await this.getClinicScopedAppointment(actor, clinicId, appointmentId);
    await this.assertCan(actor, "payment.offline_mark", "appointment", appointmentId);

    return this.prisma.$transaction(async (tx) => {
      await this.lockAppointment(tx, appointmentId);
      const appointment = await this.getAppointmentForOperation(tx, appointmentId);

      if (appointment.clinicId !== clinicId) {
        throw new NotFoundException("Appointment not found");
      }

      if (terminalAppointmentStatuses.includes(appointment.status)) {
        throw new ConflictException({
          code: "APPOINTMENT_TERMINAL",
          message: "Cannot record payment for a terminal appointment"
        });
      }

      if (appointment.paymentMode === PaymentMode.ONLINE_REQUIRED) {
        throw new ConflictException({
          code: "OFFLINE_PAYMENT_NOT_ALLOWED",
          message: "This appointment requires online payment"
        });
      }

      const successfulPayment = appointment.payments.find(
        (payment) => payment.status === PaymentStatus.SUCCESSFUL
      );

      if (successfulPayment) {
        throw new ConflictException({
          code: "PAYMENT_ALREADY_RECORDED",
          message: "Appointment already has a successful payment"
        });
      }

      const now = await this.getDatabaseNow(tx);
      const amountMinor = input.amountMinor ?? appointment.feeMinor;
      const payment = await tx.payment.create({
        data: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          provider: "offline",
          paymentPurpose: "APPOINTMENT",
          amountMinor,
          currency: appointment.currency,
          status: PaymentStatus.SUCCESSFUL,
          paymentMethod: input.paymentMethod,
          paidAt: now
        }
      });

      await tx.paymentStatusHistory.create({
        data: {
          paymentId: payment.id,
          fromStatus: null,
          toStatus: PaymentStatus.SUCCESSFUL,
          actorUserId: actor.id,
          reason: input.reason ?? "Offline payment recorded",
          metadata: this.toJson({
            source: "clinic_offline_payment"
          }) as Prisma.InputJsonValue
        }
      });
      await this.writeAudit(tx, actor, "payment.offline_recorded", appointment, context, {
        paymentId: payment.id,
        amountMinor: amountMinor.toString(),
        paymentMethod: input.paymentMethod
      });

      const updated = await this.getAppointmentForOperation(tx, appointmentId);

      return {
        appointment: this.serializeAppointment(updated)
      };
    });
  }

  private async updateAppointmentStatus(
    actor: AuthenticatedUser,
    appointmentId: string,
    input: UpdateAppointmentStatusInput,
    context: RequestContext
  ) {
    const nextStatus = this.toAppointmentStatus(input.status);
    await this.assertCan(actor, this.permissionForStatus(nextStatus), "appointment", appointmentId);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockAppointment(tx, appointmentId);
      const appointment = await this.getAppointmentForOperation(tx, appointmentId);

      if (appointment.status === nextStatus) {
        return {
          appointment: this.serializeAppointment(appointment),
          changed: false
        };
      }

      this.assertTransitionAllowed(appointment.status, nextStatus);
      const now = await this.getDatabaseNow(tx);
      this.assertStatusTimingAllowed(appointment, nextStatus, now);
      const updateData: Prisma.AppointmentUncheckedUpdateInput = {
        status: nextStatus,
        updatedByUserId: actor.id,
        ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {})
      };

      if (nextStatus === AppointmentStatus.CHECKED_IN) {
        const queue = await this.resolveQueueMetadata(tx, appointment, input.queueNumber);
        updateData.checkedInAt = appointment.checkedInAt ?? now;
        updateData.queueDate = appointment.queueDate ?? queue.queueDate;
        updateData.queueNumber = appointment.queueNumber ?? queue.queueNumber;
      }

      if (nextStatus === AppointmentStatus.IN_PROGRESS) {
        updateData.consultationStartedAt = appointment.consultationStartedAt ?? now;
      }

      if (nextStatus === AppointmentStatus.COMPLETED) {
        updateData.completedAt = appointment.completedAt ?? now;
      }

      await tx.appointment.update({
        where: { id: appointment.id },
        data: updateData
      });
      await this.writeStatusHistory(tx, actor, appointment, nextStatus, input.reason, {
        source: "appointment_status_update"
      });
      await this.writeAudit(tx, actor, "appointment.status.update", appointment, context, {
        fromStatus: appointment.status,
        toStatus: nextStatus,
        reason: input.reason ?? null
      });

      const updated = await this.getAppointmentForOperation(tx, appointmentId);

      return {
        appointment: this.serializeAppointment(updated),
        changed: true
      };
    });

    if (result.changed && nextStatus === AppointmentStatus.COMPLETED) {
      await this.safeNotify(() => this.reviewService.enqueueReviewInvitation(appointmentId));
    }

    return result;
  }

  private async cancelAppointment(
    actor: AuthenticatedUser,
    appointmentId: string,
    nextStatus: AppointmentStatus,
    input: CancelAppointmentInput,
    options: {
      enforceCancellationWindow: boolean;
      source: "patient" | "clinic";
    },
    context: RequestContext
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockAppointment(tx, appointmentId);
      const appointment = await this.getAppointmentForOperation(tx, appointmentId);

      if (appointment.status === nextStatus) {
        return {
          appointment: this.serializeAppointment(appointment),
          changed: false
        };
      }

      this.assertTransitionAllowed(appointment.status, nextStatus);
      const now = await this.getDatabaseNow(tx);

      if (options.enforceCancellationWindow) {
        await this.assertCancellationWindowOpen(tx, appointment, now);
      }

      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: nextStatus,
          cancelledAt: now,
          cancelledByUserId: actor.id,
          cancellationReason: input.reason,
          updatedByUserId: actor.id
        }
      });
      await tx.appointmentSlotHold.updateMany({
        where: {
          appointmentId: appointment.id,
          status: SlotHoldStatus.ACTIVE
        },
        data: {
          status: SlotHoldStatus.CANCELLED,
          resolvedAt: now
        }
      });
      await this.cancelUnpaidPayments(tx, actor, appointment, input.reason);
      await this.requestRefundsForSuccessfulPayments(tx, actor, appointment, input.reason);
      await this.writeStatusHistory(tx, actor, appointment, nextStatus, input.reason, {
        source: `${options.source}_cancellation`
      });
      await this.writeAudit(tx, actor, "appointment.cancel", appointment, context, {
        fromStatus: appointment.status,
        toStatus: nextStatus,
        reason: input.reason,
        source: options.source
      });

      const updated = await this.getAppointmentForOperation(tx, appointmentId);

      return {
        appointment: this.serializeAppointment(updated),
        changed: true
      };
    });
  }

  private async getClinicScopedAppointment(
    actor: AuthenticatedUser,
    clinicId: string,
    appointmentId: string
  ) {
    const scopedLocationId = await this.getReceptionistScopedLocationId(actor, clinicId);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        clinicId,
        ...(scopedLocationId ? { clinicLocationId: scopedLocationId } : {})
      },
      include: appointmentOperationsInclude
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    return appointment;
  }

  private async getPatientForActor(actor: AuthenticatedUser) {
    if (!actor.roles.includes("patient")) {
      throw new ForbiddenException("Patient account is required");
    }

    const patient = await this.prisma.patient.findUnique({
      where: { userId: actor.id },
      select: { id: true }
    });

    if (!patient) {
      throw new ForbiddenException("Patient profile is required");
    }

    return patient;
  }

  private async getDoctorForActor(actor: AuthenticatedUser) {
    if (!actor.roles.includes("doctor")) {
      throw new ForbiddenException("Doctor account is required");
    }

    const doctor = await this.prisma.doctor.findUnique({
      where: { userId: actor.id },
      select: { id: true }
    });

    if (!doctor) {
      throw new ForbiddenException("Doctor profile is required");
    }

    return doctor;
  }

  private async getReceptionistScopedLocationId(actor: AuthenticatedUser, clinicId: string) {
    if (
      !actor.roles.includes("receptionist") ||
      actor.roles.includes("super_admin") ||
      actor.roles.includes("clinic_admin")
    ) {
      return null;
    }

    const receptionist = await this.prisma.receptionist.findUnique({
      where: {
        clinicId_userId: {
          clinicId,
          userId: actor.id
        }
      },
      select: {
        status: true,
        clinicLocationId: true
      }
    });

    if (receptionist?.status !== ClinicAssociationStatus.APPROVED) {
      return null;
    }

    return receptionist.clinicLocationId;
  }

  private buildAppointmentFilters(query: ListAppointmentsQuery): Prisma.AppointmentWhereInput {
    return {
      ...(query.status ? { status: this.toAppointmentStatus(query.status) } : {}),
      ...(query.doctorId ? { doctorId: query.doctorId } : {}),
      ...(query.clinicLocationId ? { clinicLocationId: query.clinicLocationId } : {}),
      ...(this.buildDateFilter(query) ?? {})
    };
  }

  private buildDateFilter(query: ListAppointmentsQuery): Prisma.AppointmentWhereInput | null {
    const fromDate = query.date ?? query.fromDate;
    const toDate = query.date ?? query.toDate;

    if (!fromDate && !toDate) {
      return null;
    }

    const startsAt: Prisma.DateTimeFilter = {};

    if (fromDate) {
      startsAt.gte = this.dateBoundary(fromDate);
    }

    if (toDate) {
      const endExclusive = this.dateBoundary(toDate);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      startsAt.lt = endExclusive;
    }

    if (startsAt.gte && startsAt.lt && startsAt.gte >= startsAt.lt) {
      throw new BadRequestException("Invalid appointment date range");
    }

    return { startsAt };
  }

  private dateBoundary(date: string) {
    return new Date(`${date}T00:00:00.000Z`);
  }

  private async lockAppointment(tx: Prisma.TransactionClient, appointmentId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "appointments"
      WHERE "id" = CAST(${appointmentId} AS uuid)
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException("Appointment not found");
    }
  }

  private async getAppointmentForOperation(tx: PrismaExecutor, appointmentId: string) {
    return tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: appointmentOperationsInclude
    });
  }

  private async assertCan(
    actor: AuthenticatedUser,
    permissionCode: string,
    scope: "appointment" | "clinic" | "doctor",
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

  private permissionForStatus(status: AppointmentStatus) {
    if (status === AppointmentStatus.CHECKED_IN) {
      return "appointment.status.check_in";
    }

    if (status === AppointmentStatus.COMPLETED) {
      return "appointment.status.complete";
    }

    return "appointment.queue.manage";
  }

  private assertTransitionAllowed(fromStatus: AppointmentStatus, toStatus: AppointmentStatus) {
    if (terminalAppointmentStatuses.includes(fromStatus)) {
      throw new ConflictException({
        code: "APPOINTMENT_TERMINAL",
        message: "Terminal appointments cannot change status"
      });
    }

    if (!allowedTransitions[fromStatus]?.includes(toStatus)) {
      throw new ConflictException({
        code: "INVALID_APPOINTMENT_STATUS_TRANSITION",
        message: `Cannot move appointment from ${fromStatus.toLowerCase()} to ${toStatus.toLowerCase()}`
      });
    }
  }

  private async assertCancellationWindowOpen(
    tx: Prisma.TransactionClient,
    appointment: AppointmentOperationRecord,
    now: Date
  ) {
    const windowMinutes = await this.resolveCancellationWindowMinutes(tx, appointment);
    const deadline = new Date(appointment.startsAt.getTime() - windowMinutes * 60 * 1000);

    if (now > deadline) {
      throw new ConflictException({
        code: "CANCELLATION_WINDOW_CLOSED",
        message: "Appointment can no longer be cancelled by the patient"
      });
    }
  }

  private async resolveCancellationWindowMinutes(
    tx: Prisma.TransactionClient,
    appointment: AppointmentOperationRecord
  ) {
    if (appointment.doctorClinicService.cancellationWindowMinutes !== null) {
      return appointment.doctorClinicService.cancellationWindowMinutes;
    }

    if (appointment.clinic.cancellationWindowMinutes !== null) {
      return appointment.clinic.cancellationWindowMinutes;
    }

    const setting = await tx.systemSetting.findFirst({
      where: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        key: "booking.cancellation_window_minutes"
      },
      select: { value: true }
    });
    const value =
      setting?.value && typeof setting.value === "object" && "value" in setting.value
        ? Number(setting.value.value)
        : NaN;

    return Number.isFinite(value) && value >= 0 ? value : 30;
  }

  private async resolveQueueMetadata(
    tx: Prisma.TransactionClient,
    appointment: AppointmentOperationRecord,
    requestedQueueNumber: number | undefined
  ) {
    const queueDate = appointment.queueDate ?? this.localDateInTimeZone(
      appointment.startsAt,
      appointment.clinicLocation.timezone
    );

    if (requestedQueueNumber) {
      return { queueDate, queueNumber: requestedQueueNumber };
    }

    const aggregate = await tx.appointment.aggregate({
      where: {
        clinicLocationId: appointment.clinicLocationId,
        queueDate
      },
      _max: {
        queueNumber: true
      }
    });

    return {
      queueDate,
      queueNumber: (aggregate._max.queueNumber ?? 0) + 1
    };
  }

  private localDateInTimeZone(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (!year || !month || !day) {
      return this.dateBoundary(date.toISOString().slice(0, 10));
    }

    return this.dateBoundary(`${year}-${month}-${day}`);
  }

  private async cancelUnpaidPayments(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    appointment: AppointmentOperationRecord,
    reason: string
  ) {
    const unpaidPayments = appointment.payments.filter((payment) =>
      cancellablePaymentStatuses.includes(payment.status)
    );

    for (const payment of unpaidPayments) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.CANCELLED
        }
      });
      await tx.paymentStatusHistory.create({
        data: {
          paymentId: payment.id,
          fromStatus: payment.status,
          toStatus: PaymentStatus.CANCELLED,
          actorUserId: actor.id,
          reason
        }
      });
    }
  }

  private async requestRefundsForSuccessfulPayments(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    appointment: AppointmentOperationRecord,
    reason: string
  ) {
    const successfulPayments = appointment.payments.filter(
      (payment) => payment.status === PaymentStatus.SUCCESSFUL && payment.amountMinor > 0n
    );

    for (const payment of successfulPayments) {
      const existingRefundedAmount = appointment.refunds
        .filter(
          (refund) =>
            refund.paymentId === payment.id &&
            !ignoredRefundStatuses.includes(refund.status)
        )
        .reduce((total, refund) => total + refund.amountMinor, 0n);
      const refundAmount = payment.amountMinor - existingRefundedAmount;

      if (refundAmount <= 0n) {
        continue;
      }

      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          appointmentId: appointment.id,
          requestedByUserId: actor.id,
          provider: payment.provider,
          amountMinor: refundAmount,
          currency: payment.currency,
          status: RefundStatus.REQUESTED,
          reason
        }
      });
      await tx.refundStatusHistory.create({
        data: {
          refundId: refund.id,
          fromStatus: null,
          toStatus: RefundStatus.REQUESTED,
          actorUserId: actor.id,
          reason,
          metadata: this.toJson({
            source: "appointment_cancellation",
            paymentId: payment.id
          }) as Prisma.InputJsonValue
        }
      });
    }
  }

  private async writeStatusHistory(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    appointment: AppointmentOperationRecord,
    toStatus: AppointmentStatus,
    reason: string | null | undefined,
    metadata: Record<string, unknown>
  ) {
    await tx.appointmentStatusHistory.create({
      data: {
        appointmentId: appointment.id,
        fromStatus: appointment.status,
        toStatus,
        changedByUserId: actor.id,
        reason: reason ?? null,
        metadata: this.toJson(metadata) as Prisma.InputJsonValue
      }
    });
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    actionCode: string,
    appointment: AppointmentOperationRecord,
    context: RequestContext,
    metadata: Record<string, unknown>
  ) {
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id,
        actorRole: actor.roles[0] ?? null,
        actionCode,
        entityType: "appointment",
        entityId: appointment.id,
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        metadata: this.toJson(metadata) as Prisma.InputJsonValue
      }
    });
  }

  private async getDatabaseNow(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT now()::timestamptz AS "now"`;

    return rows[0]?.now ?? new Date();
  }

  private assertStatusTimingAllowed(
    appointment: Pick<AppointmentOperationRecord, "startsAt">,
    toStatus: AppointmentStatus,
    now: Date
  ) {
    if (toStatus === AppointmentStatus.COMPLETED && appointment.startsAt > now) {
      throw new ConflictException({
        code: "APPOINTMENT_NOT_STARTED",
        message: "Cannot complete an appointment before its scheduled start time"
      });
    }
  }

  private toAppointmentStatus(status: string) {
    const normalized = status.toUpperCase() as keyof typeof AppointmentStatus;
    const value = AppointmentStatus[normalized];

    if (!value) {
      throw new BadRequestException("Invalid appointment status");
    }

    return value;
  }

  private serializeAppointment(appointment: AppointmentOperationRecord) {
    return {
      id: appointment.id,
      appointmentNumber: appointment.appointmentNumber,
      status: appointment.status.toLowerCase(),
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      serviceName: appointment.serviceNameSnapshot,
      serviceDurationMinutes: appointment.serviceDurationMinutes,
      feeMinor: appointment.feeMinor.toString(),
      currency: appointment.currency,
      paymentMode: appointment.paymentMode.toLowerCase(),
      attendingName: appointment.attendingNameSnapshot,
      reasonForVisit: appointment.reasonForVisit,
      bookingNotes: appointment.bookingNotes,
      internalNotes: appointment.internalNotes,
      queueDate: appointment.queueDate?.toISOString().slice(0, 10) ?? null,
      queueNumber: appointment.queueNumber,
      checkedInAt: appointment.checkedInAt?.toISOString() ?? null,
      consultationStartedAt: appointment.consultationStartedAt?.toISOString() ?? null,
      completedAt: appointment.completedAt?.toISOString() ?? null,
      cancelledAt: appointment.cancelledAt?.toISOString() ?? null,
      cancellationReason: appointment.cancellationReason,
      patient: {
        id: appointment.patientId,
        fullName: appointment.patient.user.fullName,
        email: appointment.patient.user.email,
        phone: appointment.patient.user.phone
      },
      doctor: {
        id: appointment.doctorId,
        fullName: appointment.doctor.user.fullName,
        email: appointment.doctor.user.email
      },
      clinic: {
        id: appointment.clinicId,
        name: appointment.clinic.name,
        slug: appointment.clinic.slug
      },
      clinicLocation: {
        id: appointment.clinicLocationId,
        name: appointment.clinicLocation.name,
        address: appointment.clinicLocation.address,
        city: appointment.clinicLocation.city,
        timezone: appointment.clinicLocation.timezone
      },
      payments: appointment.payments.map((payment) => ({
        id: payment.id,
        status: payment.status.toLowerCase(),
        provider: payment.provider,
        amountMinor: payment.amountMinor.toString(),
        currency: payment.currency,
        paymentMethod: payment.paymentMethod,
        paidAt: payment.paidAt?.toISOString() ?? null
      })),
      refunds: appointment.refunds.map((refund) => ({
        id: refund.id,
        paymentId: refund.paymentId,
        status: refund.status.toLowerCase(),
        provider: refund.provider,
        amountMinor: refund.amountMinor.toString(),
        currency: refund.currency,
        reason: refund.reason,
        requestedAt: refund.requestedAt.toISOString(),
        processedAt: refund.processedAt?.toISOString() ?? null
      })),
      statusHistory: appointment.statusHistory.map((history) => ({
        id: history.id,
        fromStatus: history.fromStatus?.toLowerCase() ?? null,
        toStatus: history.toStatus.toLowerCase(),
        reason: history.reason,
        createdAt: history.createdAt.toISOString()
      }))
    };
  }

  private toJson<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
      )
    ) as T;
  }

  private async safeNotify(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      this.logger.error("notification.enqueue_failed", {}, error);
    }
  }
}

type PrismaExecutor = PrismaService | Prisma.TransactionClient;

type AppointmentOperationRecord = Prisma.AppointmentGetPayload<{
  include: typeof appointmentOperationsInclude;
}>;
