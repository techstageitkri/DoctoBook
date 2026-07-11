import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@doctobook/database";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";

const appointmentInclude = {
  doctor: {
    include: {
      user: { select: { fullName: true } }
    }
  },
  clinic: { select: { name: true, slug: true } },
  clinicLocation: { select: { name: true, address: true, city: true, timezone: true } },
  payments: {
    orderBy: { createdAt: "desc" },
    take: 1
  },
  refunds: {
    orderBy: { requestedAt: "desc" },
    take: 5
  },
  rescheduleRequests: {
    orderBy: { createdAt: "desc" },
    take: 3,
    include: {
      holds: {
        orderBy: { createdAt: "desc" },
        take: 1
      },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  },
  review: true
} satisfies Prisma.AppointmentInclude;

@Injectable()
export class PatientService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(actor: AuthenticatedUser) {
    this.assertPatientActor(actor);
    const patient = await this.getPatient(actor.id);

    return {
      patient: {
        id: patient.id,
        userId: patient.userId,
        fullName: patient.user.fullName,
        email: patient.user.email,
        phone: patient.user.phone
      }
    };
  }

  async listAppointments(actor: AuthenticatedUser) {
    this.assertPatientActor(actor);
    const patient = await this.getPatient(actor.id);
    const appointments = await this.prisma.appointment.findMany({
      where: { patientId: patient.id },
      orderBy: { startsAt: "desc" },
      take: 50,
      include: appointmentInclude
    });

    return {
      appointments: appointments.map((appointment) => this.serializeAppointment(appointment))
    };
  }

  async getAppointment(actor: AuthenticatedUser, appointmentId: string) {
    this.assertPatientActor(actor);
    const patient = await this.getPatient(actor.id);
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        patientId: patient.id
      },
      include: appointmentInclude
    });

    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    return {
      appointment: this.serializeAppointment(appointment)
    };
  }

  private assertPatientActor(actor: AuthenticatedUser) {
    if (!actor.roles.includes("patient")) {
      throw new ForbiddenException("Patient account is required");
    }
  }

  private async getPatient(userId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true
          }
        }
      }
    });

    if (!patient) {
      throw new ForbiddenException("Patient profile is required");
    }

    return patient;
  }

  private serializeAppointment(appointment: AppointmentRecord) {
    const payment = appointment.payments[0] ?? null;

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
      doctorName: appointment.doctor.user.fullName,
      clinicName: appointment.clinic.name,
      clinicSlug: appointment.clinic.slug,
      clinicLocationName: appointment.clinicLocation.name,
      clinicAddress: appointment.clinicLocation.address,
      clinicCity: appointment.clinicLocation.city,
      clinicTimezone: appointment.clinicLocation.timezone,
      payment: payment
        ? {
            id: payment.id,
            status: payment.status.toLowerCase(),
            provider: payment.provider,
            amountMinor: payment.amountMinor.toString(),
            currency: payment.currency
          }
        : null,
      review: appointment.review
        ? {
            id: appointment.review.id,
            rating: appointment.review.rating,
            title: appointment.review.title,
            comment: appointment.review.comment,
            status: appointment.review.status.toLowerCase(),
            moderationReason: appointment.review.moderationReason,
            createdAt: appointment.review.createdAt.toISOString(),
            updatedAt: appointment.review.updatedAt.toISOString()
          }
        : null,
      refunds: appointment.refunds.map((refund) => ({
        id: refund.id,
        paymentId: refund.paymentId,
        status: refund.status.toLowerCase(),
        provider: refund.provider,
        providerRefundId: refund.providerRefundId,
        amountMinor: refund.amountMinor.toString(),
        currency: refund.currency,
        reason: refund.reason,
        requestedAt: refund.requestedAt.toISOString(),
        processedAt: refund.processedAt?.toISOString() ?? null
      })),
      rescheduleRequests: appointment.rescheduleRequests.map((request) => {
        const requestPayment = request.payments[0] ?? null;
        const hold = request.holds[0] ?? null;

        return {
          id: request.id,
          status: request.status.toLowerCase(),
          oldStartsAt: request.oldStartsAt.toISOString(),
          oldEndsAt: request.oldEndsAt.toISOString(),
          newStartsAt: request.newStartsAt.toISOString(),
          newEndsAt: request.newEndsAt.toISOString(),
          oldFeeMinor: request.oldFeeMinor.toString(),
          newFeeMinor: request.newFeeMinor.toString(),
          differenceFeeMinor: request.differenceFeeMinor.toString(),
          currency: request.currency,
          createdAt: request.createdAt.toISOString(),
          resolvedAt: request.resolvedAt?.toISOString() ?? null,
          hold: hold
            ? {
                status: hold.status.toLowerCase(),
                expiresAt: hold.expiresAt.toISOString()
              }
            : null,
          payment: requestPayment
            ? {
                id: requestPayment.id,
                status: requestPayment.status.toLowerCase(),
                amountMinor: requestPayment.amountMinor.toString(),
                currency: requestPayment.currency
              }
            : null
        };
      })
    };
  }
}

type AppointmentRecord = Prisma.AppointmentGetPayload<{
  include: typeof appointmentInclude;
}>;
