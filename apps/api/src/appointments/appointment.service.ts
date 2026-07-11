import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AppointmentSource,
  AppointmentStatus,
  ClinicAssociationStatus,
  ClinicStatus,
  DoctorStatus,
  PaymentMode,
  PaymentStatus,
  Prisma,
  ScopeType,
  SlotHoldStatus
} from "@doctobook/database";
import { AuthenticatedUser, RequestContext } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { CreatePatientAppointmentInput } from "./appointment.schemas.js";
import { PaymentQueueService } from "./payment-queue.service.js";

const blockingAppointmentStatuses = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CHECKED_IN,
  AppointmentStatus.WAITING,
  AppointmentStatus.IN_PROGRESS
];

@Injectable()
export class AppointmentBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentQueueService: PaymentQueueService,
    private readonly notificationService: NotificationService
  ) {}

  async createPatientAppointment(
    actor: AuthenticatedUser,
    input: CreatePatientAppointmentInput,
    idempotencyKey: string,
    context: RequestContext
  ) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(this.prisma, actor.id);
    const requestHash = this.hashBookingRequest(input);
    const existingAppointment = await this.findIdempotentAppointment(
      this.prisma,
      patient.id,
      idempotencyKey
    );

    if (existingAppointment) {
      this.assertSameRequestHash(existingAppointment, requestHash);
      return this.serializeBookingResponse(existingAppointment, true);
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lockSlot(tx, input.appointmentSlotId);
        const existingInsideTransaction = await this.findIdempotentAppointment(
          tx,
          patient.id,
          idempotencyKey
        );

        if (existingInsideTransaction) {
          this.assertSameRequestHash(existingInsideTransaction, requestHash);
          return {
            appointment: existingInsideTransaction,
            shouldEnqueuePayment: false
          };
        }

        const now = await this.getDatabaseNow(tx);
        const slot = await this.getLockedSlot(tx, input.appointmentSlotId);

        this.assertSlotIsBookable(slot, now);
        await this.resolveExpiredHoldsForSlot(tx, slot.id, now, actor.id);
        await this.assertNoActiveHold(tx, slot.id, now);
        await this.assertNoActiveAppointmentForSlot(tx, slot.id);

        const attending = await this.resolveAttendingPerson(tx, patient.id, input);
        const platformPaymentMode = await this.getPlatformDefaultPaymentMode(tx);
        const snapshots = this.resolveBookingSnapshots(slot, platformPaymentMode);
        const paymentPlan = this.resolvePaymentPlan(snapshots.paymentMode, input.paymentPreference, snapshots.feeMinor);
        const appointment = await tx.appointment.create({
          data: {
            appointmentNumber: this.createAppointmentNumber(),
            patientId: patient.id,
            doctorId: slot.doctorClinic.doctorId,
            clinicId: slot.doctorClinic.clinicId,
            clinicLocationId: slot.doctorClinic.clinicLocationId,
            doctorClinicId: slot.doctorClinicId,
            doctorClinicServiceId: slot.doctorClinicServiceId,
            slotId: slot.id,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            status: paymentPlan.appointmentStatus,
            source: AppointmentSource.PATIENT_WEB,
            paymentMode: snapshots.paymentMode,
            serviceNameSnapshot: snapshots.serviceName,
            serviceDurationMinutes: snapshots.durationMinutes,
            feeMinor: snapshots.feeMinor,
            currency: snapshots.currency,
            attendingPatientId: attending.patientId,
            attendingDependentId: attending.dependentId,
            attendingNameSnapshot: attending.name,
            attendingRelationship: attending.relationship,
            reasonForVisit: input.reasonForVisit ?? null,
            bookingNotes: input.bookingNotes ?? null,
            bookingIdempotencyKey: idempotencyKey,
            bookingRequestHash: requestHash,
            createdByUserId: actor.id
          }
        });

        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: appointment.id,
            fromStatus: null,
            toStatus: appointment.status,
            changedByUserId: actor.id,
            reason: "Patient booking created",
            metadata: { source: "patient_booking" }
          }
        });

        let paymentId: string | null = null;

        if (paymentPlan.requiresPaymentRecord) {
          const holdExpiresAt = new Date(
            now.getTime() + (await this.getActiveHoldMinutes(tx)) * 60 * 1000
          );

          await tx.appointmentSlotHold.create({
            data: {
              slotId: slot.id,
              userId: actor.id,
              appointmentId: appointment.id,
              idempotencyKey: this.createDerivedIdempotencyKey("hold", patient.id, idempotencyKey),
              status: SlotHoldStatus.ACTIVE,
              expiresAt: holdExpiresAt
            }
          });

          const payment = await tx.payment.create({
            data: {
              appointmentId: appointment.id,
              patientId: patient.id,
              provider: "pending_gateway",
              idempotencyKey: this.createDerivedIdempotencyKey("payment", patient.id, idempotencyKey),
              amountMinor: snapshots.feeMinor,
              currency: snapshots.currency,
              status: PaymentStatus.INITIATED
            }
          });
          paymentId = payment.id;
        }

        await tx.auditLog.create({
          data: {
            actorUserId: actor.id,
            actorRole: actor.roles[0] ?? null,
            actionCode: "appointment.create",
            entityType: "appointment",
            entityId: appointment.id,
            clinicId: appointment.clinicId,
            patientId: appointment.patientId,
            ipAddress: context.ipAddress ?? null,
            userAgent: context.userAgent ?? null,
            metadata: this.toJson({
              source: "patient_booking",
              slotId: slot.id,
              paymentPreference: input.paymentPreference,
              paymentMode: snapshots.paymentMode,
              paymentId
            }) as Prisma.InputJsonValue
          }
        });

        const appointmentWithPayments = await this.getAppointmentForResponse(tx, appointment.id);

        return {
          appointment: appointmentWithPayments,
          shouldEnqueuePayment: Boolean(paymentId),
          paymentId
        };
      });

      if (result.shouldEnqueuePayment && result.paymentId) {
        await this.paymentQueueService.enqueuePaymentInitiation({
          paymentId: result.paymentId,
          appointmentId: result.appointment.id
        });
      }
      await this.safeNotify(() =>
        this.notificationService.enqueueAppointmentEvent(result.appointment.id, "appointment.booked", {
          audiences: ["patient", "doctor"],
          idempotencyKeySuffix: result.appointment.id
        })
      );

      if (result.appointment.status === AppointmentStatus.PENDING_PAYMENT && result.paymentId) {
        await this.safeNotify(() =>
          this.notificationService.enqueuePaymentEvent(result.paymentId!, "payment.required")
        );
      }

      return this.serializeBookingResponse(result.appointment, false);
    } catch (error) {
      const existingAfterConflict = await this.tryResolveIdempotencyConflict(
        error,
        patient.id,
        idempotencyKey,
        requestHash
      );

      if (existingAfterConflict) {
        return this.serializeBookingResponse(existingAfterConflict, true);
      }

      this.throwMappedDatabaseError(error);
      throw error;
    }
  }

  async getAppointmentPayment(actor: AuthenticatedUser, appointmentId: string) {
    this.assertPatientActor(actor);
    const patient = await this.getPatientForActor(this.prisma, actor.id);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        patientId: patient.id
      },
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    return {
      appointmentId: appointment.id,
      payment: appointment.payments[0] ? this.serializePayment(appointment.payments[0]) : null
    };
  }

  private assertPatientActor(actor: AuthenticatedUser) {
    if (!actor.roles.includes("patient")) {
      throw new ForbiddenException("Patient account is required");
    }
  }

  private async getPatientForActor(tx: PrismaExecutor, userId: string) {
    const patient = await tx.patient.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true
          }
        }
      }
    });

    if (!patient) {
      throw new ForbiddenException("Patient profile is required");
    }

    return patient;
  }

  private async findIdempotentAppointment(
    tx: PrismaExecutor,
    patientId: string,
    idempotencyKey: string
  ) {
    return tx.appointment.findFirst({
      where: {
        patientId,
        bookingIdempotencyKey: idempotencyKey
      },
      include: this.appointmentResponseInclude()
    });
  }

  private assertSameRequestHash(appointment: AppointmentResponseRecord, requestHash: string) {
    if (appointment.bookingRequestHash !== requestHash) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "Idempotency key was already used with a different request"
      });
    }
  }

  private async lockSlot(tx: Prisma.TransactionClient, slotId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "appointment_slots"
      WHERE "id" = CAST(${slotId} AS uuid)
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException("Appointment slot not found");
    }
  }

  private async getLockedSlot(tx: Prisma.TransactionClient, slotId: string) {
    const slot = await tx.appointmentSlot.findUnique({
      where: { id: slotId },
      include: {
        doctorClinic: {
          include: {
            clinic: true,
            clinicLocation: true,
            doctor: true
          }
        },
        doctorClinicService: {
          include: {
            clinicService: {
              include: {
                service: true
              }
            }
          }
        }
      }
    });

    if (!slot) {
      throw new NotFoundException("Appointment slot not found");
    }

    return slot;
  }

  private assertSlotIsBookable(slot: LockedSlotRecord, now: Date) {
    if (!slot.isActive || slot.startsAt <= now) {
      throw new ConflictException({
        code: "SLOT_NOT_BOOKABLE",
        message: "Appointment slot is not available"
      });
    }

    if (
      slot.doctorClinic.status !== ClinicAssociationStatus.APPROVED ||
      slot.doctorClinic.deletedAt ||
      slot.doctorClinic.clinic.status !== ClinicStatus.ACTIVE ||
      slot.doctorClinic.clinic.deletedAt ||
      slot.doctorClinic.clinicLocation.status !== ClinicStatus.ACTIVE ||
      slot.doctorClinic.clinicLocation.deletedAt ||
      slot.doctorClinic.doctor.status !== DoctorStatus.APPROVED ||
      slot.doctorClinic.doctor.deletedAt ||
      !slot.doctorClinicService.isActive ||
      slot.doctorClinicService.deletedAt ||
      !slot.doctorClinicService.clinicService.isActive ||
      !slot.doctorClinicService.clinicService.service.isActive
    ) {
      throw new ConflictException({
        code: "SLOT_NOT_BOOKABLE",
        message: "Doctor, clinic, or service is no longer available"
      });
    }
  }

  private async resolveExpiredHoldsForSlot(
    tx: Prisma.TransactionClient,
    slotId: string,
    now: Date,
    actorUserId: string
  ) {
    const expiredHolds = await tx.appointmentSlotHold.findMany({
      where: {
        slotId,
        status: SlotHoldStatus.ACTIVE,
        expiresAt: { lte: now }
      },
      include: {
        appointment: {
          include: {
            payments: true
          }
        }
      }
    });

    for (const hold of expiredHolds) {
      const hasSuccessfulPayment = hold.appointment?.payments.some(
        (payment) => payment.status === PaymentStatus.SUCCESSFUL
      );

      if (hasSuccessfulPayment && hold.appointment) {
        await tx.appointmentSlotHold.update({
          where: { id: hold.id },
          data: {
            status: SlotHoldStatus.CONVERTED,
            resolvedAt: now
          }
        });

        if (hold.appointment.status === AppointmentStatus.PENDING_PAYMENT) {
          await tx.appointment.update({
            where: { id: hold.appointment.id },
            data: { status: AppointmentStatus.CONFIRMED }
          });
          await tx.appointmentStatusHistory.create({
            data: {
              appointmentId: hold.appointment.id,
              fromStatus: AppointmentStatus.PENDING_PAYMENT,
              toStatus: AppointmentStatus.CONFIRMED,
              changedByUserId: actorUserId,
              reason: "Payment completed before hold expiration"
            }
          });
        }
        continue;
      }

      await tx.appointmentSlotHold.update({
        where: { id: hold.id },
        data: {
          status: SlotHoldStatus.EXPIRED,
          resolvedAt: now
        }
      });

      if (hold.appointment?.status === AppointmentStatus.PENDING_PAYMENT) {
        await tx.appointment.update({
          where: { id: hold.appointment.id },
          data: { status: AppointmentStatus.EXPIRED }
        });
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: hold.appointment.id,
            fromStatus: AppointmentStatus.PENDING_PAYMENT,
            toStatus: AppointmentStatus.EXPIRED,
            changedByUserId: actorUserId,
            reason: "Payment hold expired"
          }
        });
      }
    }
  }

  private async assertNoActiveHold(tx: Prisma.TransactionClient, slotId: string, now: Date) {
    const activeHold = await tx.appointmentSlotHold.findFirst({
      where: {
        slotId,
        status: SlotHoldStatus.ACTIVE,
        expiresAt: { gt: now }
      },
      select: { id: true }
    });

    if (activeHold) {
      throw new ConflictException({
        code: "SLOT_TEMPORARILY_HELD",
        message: "Appointment slot is temporarily held"
      });
    }
  }

  private async assertNoActiveAppointmentForSlot(tx: Prisma.TransactionClient, slotId: string) {
    const appointment = await tx.appointment.findFirst({
      where: {
        slotId,
        status: { in: blockingAppointmentStatuses }
      },
      select: { id: true }
    });

    if (appointment) {
      throw new ConflictException({
        code: "SLOT_ALREADY_BOOKED",
        message: "Appointment slot is already booked"
      });
    }
  }

  private async resolveAttendingPerson(
    tx: Prisma.TransactionClient,
    patientId: string,
    input: CreatePatientAppointmentInput
  ) {
    if (input.attendingPatientId) {
      if (input.attendingPatientId !== patientId) {
        throw new BadRequestException({
          code: "INVALID_ATTENDING_PATIENT",
          message: "Attending patient must match the authenticated patient"
        });
      }

      const patient = await tx.patient.findUnique({
        where: { id: patientId },
        include: { user: { select: { fullName: true } } }
      });

      if (!patient) {
        throw new ForbiddenException("Patient profile is required");
      }

      return {
        patientId,
        dependentId: null,
        name: patient.user.fullName,
        relationship: null
      };
    }

    const dependent = await tx.patientDependent.findFirst({
      where: {
        id: input.attendingDependentId ?? "",
        patientId,
        isActive: true
      }
    });

    if (!dependent) {
      throw new BadRequestException({
        code: "INVALID_ATTENDING_DEPENDENT",
        message: "Dependent must belong to the booking patient"
      });
    }

    return {
      patientId: null,
      dependentId: dependent.id,
      name: dependent.fullName,
      relationship: dependent.relationship
    };
  }

  private resolveBookingSnapshots(slot: LockedSlotRecord, platformPaymentMode: PaymentMode) {
    const doctorClinic = slot.doctorClinic;
    const doctorClinicService = slot.doctorClinicService;
    const feeMinor =
      doctorClinicService.feeMinor ?? doctorClinic.defaultConsultationFeeMinor ?? 0n;
    const currency =
      doctorClinicService.feeMinor === null && doctorClinic.defaultConsultationFeeMinor !== null
        ? doctorClinic.currency
        : doctorClinicService.currency;
    const paymentMode =
      doctorClinicService.paymentMode ??
      doctorClinic.paymentMode ??
      doctorClinic.clinic.defaultPaymentMode ??
      platformPaymentMode;

    return {
      serviceName:
        doctorClinicService.clinicService.displayName ??
        doctorClinicService.clinicService.service.name,
      durationMinutes: doctorClinicService.durationMinutes,
      feeMinor,
      currency,
      paymentMode
    };
  }

  private resolvePaymentPlan(
    paymentMode: PaymentMode,
    paymentPreference: CreatePatientAppointmentInput["paymentPreference"],
    feeMinor: bigint
  ) {
    if (paymentMode === PaymentMode.PAY_AT_CLINIC && paymentPreference === "online") {
      throw new ConflictException({
        code: "PAYMENT_MODE_UNAVAILABLE",
        message: "Online payment is not available for this appointment"
      });
    }

    if (paymentMode === PaymentMode.ONLINE_REQUIRED && paymentPreference !== "online") {
      throw new ConflictException({
        code: "PAYMENT_MODE_REQUIRES_ONLINE",
        message: "Online payment is required for this appointment"
      });
    }

    const requiresPaymentRecord =
      feeMinor > 0n &&
      (paymentMode === PaymentMode.ONLINE_REQUIRED ||
        (paymentMode === PaymentMode.ONLINE_OPTIONAL && paymentPreference === "online"));

    return {
      appointmentStatus: requiresPaymentRecord
        ? AppointmentStatus.PENDING_PAYMENT
        : AppointmentStatus.CONFIRMED,
      requiresPaymentRecord
    };
  }

  private async getPlatformDefaultPaymentMode(tx: PrismaExecutor) {
    const setting = await tx.systemSetting.findFirst({
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

  private async getActiveHoldMinutes(tx: PrismaExecutor) {
    const setting = await tx.systemSetting.findFirst({
      where: {
        scopeType: ScopeType.PLATFORM,
        scopeId: null,
        key: "booking.max_active_slot_hold_minutes"
      },
      select: { value: true }
    });
    const value =
      setting?.value && typeof setting.value === "object" && "value" in setting.value
        ? Number(setting.value.value)
        : NaN;

    return Number.isFinite(value) && value > 0 ? value : 10;
  }

  private async getDatabaseNow(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT now()::timestamptz AS "now"`;

    return rows[0]?.now ?? new Date();
  }

  private async getAppointmentForResponse(tx: PrismaExecutor, appointmentId: string) {
    return tx.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: this.appointmentResponseInclude()
    });
  }

  private appointmentResponseInclude() {
    return {
      payments: {
        orderBy: { createdAt: "desc" }
      }
    } satisfies Prisma.AppointmentInclude;
  }

  private async tryResolveIdempotencyConflict(
    error: unknown,
    patientId: string,
    idempotencyKey: string,
    requestHash: string
  ) {
    if (!this.isAppointmentIdempotencyUniqueConflict(error)) {
      return null;
    }

    const existingAppointment = await this.findIdempotentAppointment(
      this.prisma,
      patientId,
      idempotencyKey
    );

    if (!existingAppointment) {
      return null;
    }

    this.assertSameRequestHash(existingAppointment, requestHash);
    return existingAppointment;
  }

  private throwMappedDatabaseError(error: unknown): never | void {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const target = this.getDatabaseErrorTarget(error);
      const message = String(error.meta?.message ?? error.message);

      if (
        error.code === "P2002" &&
        (target.includes("appointment_slot_holds") ||
          target.includes("appointment_slot_holds_one_active_per_slot_uidx"))
      ) {
        throw new ConflictException({
          code: "SLOT_TEMPORARILY_HELD",
          message: "Appointment slot is temporarily held"
        });
      }

      if (
        error.code === "P2002" &&
        (target.includes("booking_idempotency_key") ||
          target.includes("uq_appointments_booking_idempotency"))
      ) {
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency key was already used with a different request"
        });
      }

      if (
        message.includes("appointments_doctor_no_overlap_excl") ||
        message.includes("conflicting key value violates exclusion constraint")
      ) {
        throw new ConflictException({
          code: "DOCTOR_TIME_CONFLICT",
          message: "Doctor already has an appointment at this time"
        });
      }
    }

    if (error instanceof Prisma.PrismaClientUnknownRequestError) {
      if (
        error.message.includes("appointments_doctor_no_overlap_excl") ||
        error.message.includes("SQLSTATE 23P01")
      ) {
        throw new ConflictException({
          code: "DOCTOR_TIME_CONFLICT",
          message: "Doctor already has an appointment at this time"
        });
      }
    }
  }

  private isAppointmentIdempotencyUniqueConflict(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    const target = this.getDatabaseErrorTarget(error);

    return (
      error.code === "P2002" &&
      (target.includes("booking_idempotency_key") ||
        target.includes("uq_appointments_booking_idempotency"))
    );
  }

  private getDatabaseErrorTarget(error: Prisma.PrismaClientKnownRequestError) {
    const rawTarget = error.meta?.target;

    if (Array.isArray(rawTarget)) {
      return rawTarget.join(",");
    }

    return `${String(rawTarget ?? "")} ${String(error.meta?.message ?? "")} ${error.message}`;
  }

  private hashBookingRequest(input: CreatePatientAppointmentInput) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          appointmentSlotId: input.appointmentSlotId,
          attendingPatientId: input.attendingPatientId ?? null,
          attendingDependentId: input.attendingDependentId ?? null,
          reasonForVisit: input.reasonForVisit ?? null,
          bookingNotes: input.bookingNotes ?? null,
          paymentPreference: input.paymentPreference
        })
      )
      .digest("hex");
  }

  private createDerivedIdempotencyKey(prefix: string, patientId: string, idempotencyKey: string) {
    return `${prefix}|${createHash("sha256")
      .update(`${patientId}|${idempotencyKey}`)
      .digest("hex")
      .slice(0, 56)}`;
  }

  private createAppointmentNumber() {
    const date = new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");

    return `APT-${year}${month}${day}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private serializeBookingResponse(appointment: AppointmentResponseRecord, idempotentReplay: boolean) {
    const payment = appointment.payments[0] ?? null;

    return {
      appointmentId: appointment.id,
      appointmentNumber: appointment.appointmentNumber,
      status: this.toWireAppointmentStatus(appointment.status),
      idempotentReplay,
      payment: payment ? this.serializePayment(payment) : null
    };
  }

  private serializePayment(payment: PaymentRecord) {
    return {
      paymentId: payment.id,
      status: this.toWirePaymentStatus(payment.status),
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
      redirectPending: payment.status === PaymentStatus.INITIATED
    };
  }

  private toWireAppointmentStatus(status: AppointmentStatus) {
    return status.toLowerCase();
  }

  private toWirePaymentStatus(status: PaymentStatus) {
    return status.toLowerCase();
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
      console.warn("Notification enqueue failed", error);
    }
  }
}

type PrismaExecutor = PrismaService | Prisma.TransactionClient;

type LockedSlotRecord = Prisma.AppointmentSlotGetPayload<{
  include: {
    doctorClinic: {
      include: {
        clinic: true;
        clinicLocation: true;
        doctor: true;
      };
    };
    doctorClinicService: {
      include: {
        clinicService: {
          include: {
            service: true;
          };
        };
      };
    };
  };
}>;

type AppointmentResponseRecord = Prisma.AppointmentGetPayload<{
  include: {
    payments: {
      orderBy: {
        createdAt: "desc";
      };
    };
  };
}>;

type PaymentRecord = Prisma.PaymentGetPayload<Record<string, never>>;
