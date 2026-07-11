import {
  AppointmentStatus,
  PaymentStatus,
  Prisma,
  PrismaClient,
  RescheduleRequestStatus,
  SlotHoldStatus
} from "@doctobook/database";

export type ExpirePaymentHoldsResult = {
  scanned: number;
  converted: number;
  expired: number;
  rescheduleExpired: number;
};

export async function expirePaymentHolds(
  prisma: PrismaClient,
  now = new Date()
): Promise<ExpirePaymentHoldsResult> {
  return prisma.$transaction(async (tx) => {
    const expiredHoldRows = await tx.$queryRaw<{ id: string; appointment_id: string }[]>`
      SELECT hold."id"
           , hold."appointment_id"
      FROM "appointment_slot_holds" hold
      INNER JOIN "appointments" appointment ON appointment."id" = hold."appointment_id"
      WHERE hold."status" = 'active'::slot_hold_status
        AND hold."expires_at" <= ${now}
        AND appointment."status" = 'pending_payment'::appointment_status
      ORDER BY hold."expires_at" ASC
      LIMIT 100
    `;

    let converted = 0;
    let expired = 0;
    let rescheduleExpired = 0;
    let scanned = 0;

    for (const expiredHoldRow of expiredHoldRows) {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "payments"
        WHERE "appointment_id" = CAST(${expiredHoldRow.appointment_id} AS uuid)
        ORDER BY "id"
        FOR UPDATE
      `;
      await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "appointments"
        WHERE "id" = CAST(${expiredHoldRow.appointment_id} AS uuid)
        FOR UPDATE
      `;
      await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "appointment_slot_holds"
        WHERE "id" = CAST(${expiredHoldRow.id} AS uuid)
        FOR UPDATE
      `;

      const hold = await tx.appointmentSlotHold.findUnique({
        where: { id: expiredHoldRow.id },
        include: {
          appointment: {
            include: {
              payments: true
            }
          }
        }
      });

      if (
        !hold ||
        hold.status !== SlotHoldStatus.ACTIVE ||
        hold.expiresAt > now ||
        hold.appointment?.status !== AppointmentStatus.PENDING_PAYMENT
      ) {
        continue;
      }

      scanned += 1;
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
        await tx.appointment.update({
          where: { id: hold.appointment.id },
          data: {
            status: AppointmentStatus.CONFIRMED
          }
        });
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: hold.appointment.id,
            fromStatus: AppointmentStatus.PENDING_PAYMENT,
            toStatus: AppointmentStatus.CONFIRMED,
            reason: "Payment completed before hold expiration",
            metadata: toJson({
              source: "payment_hold_expiration_worker"
            }) as Prisma.InputJsonValue
          }
        });
        converted += 1;
        continue;
      }

      await tx.appointmentSlotHold.update({
        where: { id: hold.id },
        data: {
          status: SlotHoldStatus.EXPIRED,
          resolvedAt: now
        }
      });

      if (hold.appointment) {
        await tx.appointment.update({
          where: { id: hold.appointment.id },
          data: {
            status: AppointmentStatus.EXPIRED
          }
        });
        await tx.appointmentStatusHistory.create({
          data: {
            appointmentId: hold.appointment.id,
            fromStatus: AppointmentStatus.PENDING_PAYMENT,
            toStatus: AppointmentStatus.EXPIRED,
            reason: "Payment hold expired",
            metadata: toJson({
              source: "payment_hold_expiration_worker"
            }) as Prisma.InputJsonValue
          }
        });
      }

      expired += 1;
    }

    const rescheduleResult = await expireRescheduleHolds(tx, now);

    rescheduleExpired += rescheduleResult.expired;
    scanned += rescheduleResult.scanned;

    return {
      scanned,
      converted,
      expired,
      rescheduleExpired
    };
  });
}

async function expireRescheduleHolds(tx: Prisma.TransactionClient, now: Date) {
  const expiredHoldRows = await tx.$queryRaw<{ id: string; reschedule_request_id: string }[]>`
    SELECT hold."id"
         , hold."reschedule_request_id"
    FROM "appointment_slot_holds" hold
    INNER JOIN "appointment_reschedule_requests" request
      ON request."id" = hold."reschedule_request_id"
    WHERE hold."status" = 'active'::slot_hold_status
      AND hold."expires_at" <= ${now}
      AND request."status" = 'requested'::reschedule_request_status
    ORDER BY hold."expires_at" ASC
    LIMIT 100
  `;

  let scanned = 0;
  let expired = 0;

  for (const expiredHoldRow of expiredHoldRows) {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "appointment_reschedule_requests"
      WHERE "id" = CAST(${expiredHoldRow.reschedule_request_id} AS uuid)
      FOR UPDATE
    `;
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "appointment_slot_holds"
      WHERE "id" = CAST(${expiredHoldRow.id} AS uuid)
      FOR UPDATE
    `;
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "payments"
      WHERE "reschedule_request_id" = CAST(${expiredHoldRow.reschedule_request_id} AS uuid)
      ORDER BY "id"
      FOR UPDATE
    `;

    const request = await tx.appointmentRescheduleRequest.findUnique({
      where: { id: expiredHoldRow.reschedule_request_id },
      include: {
        holds: {
          where: { id: expiredHoldRow.id }
        },
        payments: true
      }
    });
    const hold = request?.holds[0] ?? null;

    if (
      !request ||
      !hold ||
      request.status !== RescheduleRequestStatus.REQUESTED ||
      hold.status !== SlotHoldStatus.ACTIVE ||
      hold.expiresAt > now
    ) {
      continue;
    }

    scanned += 1;

    await tx.appointmentSlotHold.update({
      where: { id: hold.id },
      data: {
        status: SlotHoldStatus.EXPIRED,
        resolvedAt: now
      }
    });
    await tx.payment.updateMany({
      where: {
        rescheduleRequestId: request.id,
        status: { in: [PaymentStatus.INITIATED, PaymentStatus.PENDING] }
      },
      data: {
        status: PaymentStatus.CANCELLED
      }
    });
    await tx.appointmentRescheduleRequest.update({
      where: { id: request.id },
      data: {
        status: RescheduleRequestStatus.CANCELLED,
        resolvedAt: now,
        reason: "Reschedule difference payment hold expired"
      }
    });
    await tx.auditLog.create({
      data: {
        actionCode: "appointment.reschedule.expired",
        entityType: "appointment_reschedule_request",
        entityId: request.id,
        metadata: toJson({
          source: "payment_hold_expiration_worker",
          appointmentId: request.appointmentId,
          holdId: hold.id
        }) as Prisma.InputJsonValue
      }
    });

    expired += 1;
  }

  return { scanned, expired };
}

function toJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    )
  ) as T;
}
