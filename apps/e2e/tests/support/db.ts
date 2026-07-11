import { e2eConfig } from "./env.js";

export type OnlinePaymentDbSnapshot = {
  appointmentStatus: string;
  paymentStatus: string;
  provider: string;
  paymentId: string;
  gatewayResponse: unknown;
  activeHoldCount: number;
  convertedHoldCount: number;
  pendingAppointmentHistoryCount: number;
  confirmedAppointmentHistoryCount: number;
  pendingPaymentHistoryCount: number;
  successfulPaymentHistoryCount: number;
};

export async function getOnlinePaymentDbSnapshot(appointmentId: string) {
  if (!e2eConfig.databaseUrl) {
    return null;
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = e2eConfig.databaseUrl;
  const { PrismaClient } = await import("@doctobook/database");
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.$queryRaw<OnlinePaymentDbSnapshot[]>`
      SELECT
        a.status::text AS "appointmentStatus",
        p.status::text AS "paymentStatus",
        p.provider AS "provider",
        p.id::text AS "paymentId",
        p.gateway_response AS "gatewayResponse",
        (
          SELECT COUNT(*)::int
          FROM appointment_slot_holds h
          WHERE h.appointment_id = a.id
            AND h.status::text = 'active'
        ) AS "activeHoldCount",
        (
          SELECT COUNT(*)::int
          FROM appointment_slot_holds h
          WHERE h.appointment_id = a.id
            AND h.status::text = 'converted'
        ) AS "convertedHoldCount",
        (
          SELECT COUNT(*)::int
          FROM appointment_status_history ash
          WHERE ash.appointment_id = a.id
            AND ash.to_status::text = 'pending_payment'
        ) AS "pendingAppointmentHistoryCount",
        (
          SELECT COUNT(*)::int
          FROM appointment_status_history ash
          WHERE ash.appointment_id = a.id
            AND ash.to_status::text = 'confirmed'
        ) AS "confirmedAppointmentHistoryCount",
        (
          SELECT COUNT(*)::int
          FROM payment_status_history psh
          WHERE psh.payment_id = p.id
            AND psh.to_status::text = 'pending'
        ) AS "pendingPaymentHistoryCount",
        (
          SELECT COUNT(*)::int
          FROM payment_status_history psh
          WHERE psh.payment_id = p.id
            AND psh.to_status::text = 'successful'
        ) AS "successfulPaymentHistoryCount"
      FROM appointments a
      JOIN payments p ON p.appointment_id = a.id
      WHERE a.id = CAST(${appointmentId} AS uuid)
      ORDER BY p.created_at DESC
      LIMIT 1
    `;

    return rows[0] ?? null;
  } finally {
    await prisma.$disconnect();

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
}
