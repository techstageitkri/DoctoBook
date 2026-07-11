import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@doctobook/database";
import { AuthenticatedUser } from "../auth/auth.types.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { ReportQuery } from "./report.schemas.js";

type ReportScope = {
  clinicId?: string;
  doctorId?: string;
};

type NormalizedReportQuery = {
  from: string;
  to: string;
  clinicId?: string;
  clinicLocationId?: string;
  doctorId?: string;
  serviceId?: string;
  doctorClinicServiceId?: string;
  status?: string;
  groupBy: "day" | "week" | "month";
  timezone: string;
  limit: number;
};

type AppointmentSummaryRow = {
  totalAppointments: bigint;
  completedAppointments: bigint;
  cancelledAppointments: bigint;
  noShowAppointments: bigint;
  pendingPaymentAppointments: bigint;
  expiredAppointments: bigint;
  eligibleBookedAppointments: bigint;
  reachedScheduledTimeAppointments: bigint;
};

type AppointmentSeriesRow = {
  period: string;
  appointments: bigint;
  completedAppointments: bigint;
  cancelledAppointments: bigint;
  noShowAppointments: bigint;
};

type StatusRow = {
  status: string;
  count: bigint;
};

type RevenueRow = {
  currency: string;
  onlineRevenueMinor: bigint | null;
  offlineRevenueMinor: bigint | null;
  refundMinor: bigint | null;
  netRevenueMinor: bigint | null;
};

type RevenueSeriesRow = RevenueRow & {
  period: string;
};

type DoctorReportRow = {
  doctorId: string;
  doctorName: string;
  appointmentCount: bigint;
  completedAppointments: bigint;
  noShowAppointments: bigint;
  bookedMinutes: number | null;
  averageRating: Prisma.Decimal | number | string | null;
  reviewCount: number | bigint | null;
};

type AvailabilityRow = {
  doctorId: string;
  availableMinutes: number | null;
};

type ServiceReportRow = {
  serviceName: string;
  appointmentCount: bigint;
  completedAppointments: bigint;
  revenueMinor: bigint | null;
  currency: string;
};

type NotificationSummaryRow = {
  totalNotifications: bigint;
  sentNotifications: bigint;
  failedNotifications: bigint;
  queuedNotifications: bigint;
};

type NotificationSeriesRow = {
  period: string;
  totalNotifications: bigint;
  sentNotifications: bigint;
  failedNotifications: bigint;
};

type NotificationStatusRow = {
  status: string;
  count: bigint;
};

type RatingSummaryRow = {
  averageRating: Prisma.Decimal | number | string | null;
  reviewCount: bigint;
};

type ReviewRow = {
  id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  patientName: string;
  clinicName: string;
  createdAt: Date;
};

const cacheTtlMs = 120_000;
const cancelledStatuses = ["cancelled_by_patient", "cancelled_by_clinic", "cancelled_by_admin"];
const bookedStatuses = [
  "confirmed",
  "checked_in",
  "waiting",
  "in_progress",
  "completed",
  "no_show",
  ...cancelledStatuses
];

@Injectable()
export class ReportService {
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService
  ) {}

  async getAdminOverview(actor: AuthenticatedUser, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "platform", null);
    const filters = this.normalizeQuery(query);

    return this.cached(["admin-overview", actor.id, filters], async () => {
      const [platform, appointments, revenue, notifications, rating] = await Promise.all([
        this.getPlatformCounts(),
        this.getAppointmentReport(filters, {}),
        this.getRevenueReport(filters, {}),
        this.getNotificationReport(filters),
        this.getRatingAggregate(filters, {})
      ]);

      return {
        filters,
        summary: {
          ...platform,
          ...appointments.summary,
          revenueByCurrency: revenue.summary,
          averagePlatformRating: rating.averageRating,
          platformReviewCount: rating.reviewCount,
          notificationDelivery: notifications.summary
        },
        appointmentSeries: appointments.series,
        revenueSeries: revenue.series,
        appointmentStatusDistribution: appointments.statusDistribution,
        notificationStatusDistribution: notifications.statusDistribution
      };
    });
  }

  async getAdminAppointments(actor: AuthenticatedUser, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "platform", null);
    const filters = this.normalizeQuery(query);

    return this.cached(["admin-appointments", actor.id, filters], () =>
      this.getAppointmentReport(filters, {})
    );
  }

  async getAdminRevenue(actor: AuthenticatedUser, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "platform", null);
    const filters = this.normalizeQuery(query);

    return this.cached(["admin-revenue", actor.id, filters], () => this.getRevenueReport(filters, {}));
  }

  async getAdminDoctors(actor: AuthenticatedUser, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "platform", null);
    const filters = this.normalizeQuery(query);

    return this.cached(["admin-doctors", actor.id, filters], () =>
      this.getDoctorReport(filters, {})
    );
  }

  async getAdminNotifications(actor: AuthenticatedUser, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "platform", null);
    const filters = this.normalizeQuery(query);

    return this.cached(["admin-notifications", actor.id, filters], () =>
      this.getNotificationReport(filters)
    );
  }

  async getClinicOverview(actor: AuthenticatedUser, clinicId: string, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "clinic", clinicId);
    const filters = this.normalizeQuery(query, { clinicId });
    const scope = { clinicId };

    return this.cached(["clinic-overview", actor.id, clinicId, filters], async () => {
      const [appointments, revenue, doctors, services, rating] = await Promise.all([
        this.getAppointmentReport(filters, scope),
        this.getRevenueReport(filters, scope),
        this.getDoctorReport(filters, scope),
        this.getServiceReport(filters, scope),
        this.getRatingAggregate(filters, scope)
      ]);

      return {
        filters,
        summary: {
          ...appointments.summary,
          revenueByCurrency: revenue.summary,
          doctorCount: doctors.doctors.length,
          serviceCount: services.services.length,
          averageRating: rating.averageRating,
          reviewCount: rating.reviewCount
        },
        appointmentSeries: appointments.series,
        revenueSeries: revenue.series,
        appointmentStatusDistribution: appointments.statusDistribution,
        doctors: doctors.doctors,
        services: services.services
      };
    });
  }

  async getClinicAppointments(actor: AuthenticatedUser, clinicId: string, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "clinic", clinicId);
    const filters = this.normalizeQuery(query, { clinicId });

    return this.cached(["clinic-appointments", actor.id, clinicId, filters], () =>
      this.getAppointmentReport(filters, { clinicId })
    );
  }

  async getClinicRevenue(actor: AuthenticatedUser, clinicId: string, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "clinic", clinicId);
    const filters = this.normalizeQuery(query, { clinicId });

    return this.cached(["clinic-revenue", actor.id, clinicId, filters], () =>
      this.getRevenueReport(filters, { clinicId })
    );
  }

  async getClinicDoctors(actor: AuthenticatedUser, clinicId: string, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "clinic", clinicId);
    const filters = this.normalizeQuery(query, { clinicId });

    return this.cached(["clinic-doctors", actor.id, clinicId, filters], () =>
      this.getDoctorReport(filters, { clinicId })
    );
  }

  async getClinicServices(actor: AuthenticatedUser, clinicId: string, query: ReportQuery) {
    await this.assertCan(actor, "report.read", "clinic", clinicId);
    const filters = this.normalizeQuery(query, { clinicId });

    return this.cached(["clinic-services", actor.id, clinicId, filters], () =>
      this.getServiceReport(filters, { clinicId })
    );
  }

  async getDoctorOverview(actor: AuthenticatedUser, query: ReportQuery) {
    const doctor = await this.getDoctorForActor(actor);
    await this.assertCan(actor, "report.read", "doctor", doctor.id);
    const filters = this.normalizeQuery(query, { doctorId: doctor.id });
    const scope = { doctorId: doctor.id };

    return this.cached(["doctor-overview", actor.id, filters], async () => {
      const [appointments, revenue, ratings, doctors] = await Promise.all([
        this.getAppointmentReport(filters, scope),
        this.getRevenueReport(filters, scope),
        this.getDoctorRatingReport(filters, doctor.id),
        this.getDoctorReport(filters, scope)
      ]);

      return {
        filters,
        doctor,
        summary: {
          ...appointments.summary,
          revenueByCurrency: revenue.summary,
          averageRating: ratings.summary.averageRating,
          reviewCount: ratings.summary.reviewCount,
          uniquePatients: await this.getUniquePatientCount(filters, scope),
          utilizationPercent: doctors.doctors[0]?.utilizationPercent ?? null
        },
        appointmentSeries: appointments.series,
        revenueSeries: revenue.series,
        appointmentStatusDistribution: appointments.statusDistribution,
        clinicBreakdown: await this.getDoctorClinicBreakdown(filters, doctor.id),
        serviceBreakdown: await this.getDoctorServiceBreakdown(filters, doctor.id),
        recentReviews: ratings.recentReviews
      };
    });
  }

  async getDoctorAppointments(actor: AuthenticatedUser, query: ReportQuery) {
    const doctor = await this.getDoctorForActor(actor);
    await this.assertCan(actor, "report.read", "doctor", doctor.id);
    const filters = this.normalizeQuery(query, { doctorId: doctor.id });

    return this.cached(["doctor-appointments", actor.id, filters], () =>
      this.getAppointmentReport(filters, { doctorId: doctor.id })
    );
  }

  async getDoctorRatings(actor: AuthenticatedUser, query: ReportQuery) {
    const doctor = await this.getDoctorForActor(actor);
    await this.assertCan(actor, "report.read", "doctor", doctor.id);
    const filters = this.normalizeQuery(query, { doctorId: doctor.id });

    return this.cached(["doctor-ratings", actor.id, filters], () =>
      this.getDoctorRatingReport(filters, doctor.id)
    );
  }

  private async getPlatformCounts() {
    const [clinics, doctors, patients] = await Promise.all([
      this.prisma.clinic.groupBy({
        by: ["status"],
        _count: { _all: true }
      }),
      this.prisma.doctor.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { _all: true }
      }),
      this.prisma.patient.count()
    ]);

    const clinicTotal = clinics.reduce((sum, row) => sum + row._count._all, 0);
    const doctorTotal = doctors.reduce((sum, row) => sum + row._count._all, 0);

    return {
      totalClinics: clinicTotal,
      activeClinics: clinics.find((row) => row.status === "ACTIVE")?._count._all ?? 0,
      totalDoctors: doctorTotal,
      approvedDoctors: doctors.find((row) => row.status === "APPROVED")?._count._all ?? 0,
      pendingDoctorApprovals:
        doctors.find((row) => row.status === "PENDING_APPROVAL")?._count._all ?? 0,
      totalPatients: patients
    };
  }

  private async getAppointmentReport(filters: NormalizedReportQuery, scope: ReportScope) {
    const where = this.appointmentWhere(filters, scope);
    const whereSql = this.whereSql(where);
    const summaryRows = await this.prisma.$queryRaw<AppointmentSummaryRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS "totalAppointments",
        COUNT(*) FILTER (WHERE a.status = 'completed')::bigint AS "completedAppointments",
        COUNT(*) FILTER (
          WHERE a.status IN ('cancelled_by_patient', 'cancelled_by_clinic', 'cancelled_by_admin')
        )::bigint AS "cancelledAppointments",
        COUNT(*) FILTER (WHERE a.status = 'no_show')::bigint AS "noShowAppointments",
        COUNT(*) FILTER (WHERE a.status = 'pending_payment')::bigint AS "pendingPaymentAppointments",
        COUNT(*) FILTER (WHERE a.status = 'expired')::bigint AS "expiredAppointments",
        COUNT(*) FILTER (
          WHERE a.status NOT IN ('pending_payment', 'expired')
        )::bigint AS "eligibleBookedAppointments",
        COUNT(*) FILTER (
          WHERE a.starts_at <= NOW() AND a.status NOT IN ('pending_payment', 'expired')
        )::bigint AS "reachedScheduledTimeAppointments"
      FROM appointments a
      JOIN clinic_locations cl ON cl.id = a.clinic_location_id
      ${whereSql}
    `);
    const statusRows = await this.prisma.$queryRaw<StatusRow[]>(Prisma.sql`
      SELECT a.status::text AS status, COUNT(*)::bigint AS count
      FROM appointments a
      JOIN clinic_locations cl ON cl.id = a.clinic_location_id
      ${whereSql}
      GROUP BY a.status
      ORDER BY a.status
    `);
    const seriesRows = await this.prisma.$queryRaw<AppointmentSeriesRow[]>(Prisma.sql`
      SELECT
        date_trunc(
          ${filters.groupBy},
          a.starts_at AT TIME ZONE COALESCE(cl.timezone, ${filters.timezone})
        )::date::text AS period,
        COUNT(*)::bigint AS appointments,
        COUNT(*) FILTER (WHERE a.status = 'completed')::bigint AS "completedAppointments",
        COUNT(*) FILTER (
          WHERE a.status IN ('cancelled_by_patient', 'cancelled_by_clinic', 'cancelled_by_admin')
        )::bigint AS "cancelledAppointments",
        COUNT(*) FILTER (WHERE a.status = 'no_show')::bigint AS "noShowAppointments"
      FROM appointments a
      JOIN clinic_locations cl ON cl.id = a.clinic_location_id
      ${whereSql}
      GROUP BY period
      ORDER BY period
    `);
    const summary = summaryRows[0] ?? {
      totalAppointments: 0n,
      completedAppointments: 0n,
      cancelledAppointments: 0n,
      noShowAppointments: 0n,
      pendingPaymentAppointments: 0n,
      expiredAppointments: 0n,
      eligibleBookedAppointments: 0n,
      reachedScheduledTimeAppointments: 0n
    };
    const eligibleBooked = this.toNumber(summary.eligibleBookedAppointments);
    const reached = this.toNumber(summary.reachedScheduledTimeAppointments);

    return {
      filters,
      summary: {
        totalAppointments: this.toNumber(summary.totalAppointments),
        completedAppointments: this.toNumber(summary.completedAppointments),
        cancelledAppointments: this.toNumber(summary.cancelledAppointments),
        noShowAppointments: this.toNumber(summary.noShowAppointments),
        pendingPaymentAppointments: this.toNumber(summary.pendingPaymentAppointments),
        expiredAppointments: this.toNumber(summary.expiredAppointments),
        cancellationRate:
          eligibleBooked > 0
            ? this.roundRate(this.toNumber(summary.cancelledAppointments) / eligibleBooked)
            : 0,
        noShowRate:
          reached > 0 ? this.roundRate(this.toNumber(summary.noShowAppointments) / reached) : 0
      },
      statusDistribution: statusRows.map((row) => ({
        status: row.status,
        count: this.toNumber(row.count)
      })),
      series: this.fillAppointmentSeries(filters, seriesRows)
    };
  }

  private async getRevenueReport(filters: NormalizedReportQuery, scope: ReportScope) {
    const paymentWhere = this.paymentWhere(filters, scope);
    const refundWhere = this.refundWhere(filters, scope);
    const paymentWhereSql = this.whereSql(paymentWhere);
    const refundWhereSql = this.whereSql(refundWhere);
    const summaryRows = await this.prisma.$queryRaw<RevenueRow[]>(Prisma.sql`
      WITH payment_totals AS (
        SELECT
          p.currency,
          COALESCE(SUM(p.amount_minor) FILTER (WHERE p.provider <> 'offline'), 0)::bigint
            AS online_revenue_minor,
          COALESCE(SUM(p.amount_minor) FILTER (WHERE p.provider = 'offline'), 0)::bigint
            AS offline_revenue_minor
        FROM payments p
        JOIN appointments a ON a.id = p.appointment_id
        JOIN clinic_locations cl ON cl.id = a.clinic_location_id
        ${paymentWhereSql}
        GROUP BY p.currency
      ),
      refund_totals AS (
        SELECT
          r.currency,
          COALESCE(SUM(r.amount_minor), 0)::bigint AS refund_minor
        FROM refunds r
        JOIN appointments a ON a.id = r.appointment_id
        JOIN clinic_locations cl ON cl.id = a.clinic_location_id
        ${refundWhereSql}
        GROUP BY r.currency
      )
      SELECT
        COALESCE(p.currency, r.currency) AS currency,
        COALESCE(p.online_revenue_minor, 0)::bigint AS "onlineRevenueMinor",
        COALESCE(p.offline_revenue_minor, 0)::bigint AS "offlineRevenueMinor",
        COALESCE(r.refund_minor, 0)::bigint AS "refundMinor",
        (
          COALESCE(p.online_revenue_minor, 0)
          + COALESCE(p.offline_revenue_minor, 0)
          - COALESCE(r.refund_minor, 0)
        )::bigint AS "netRevenueMinor"
      FROM payment_totals p
      FULL OUTER JOIN refund_totals r ON r.currency = p.currency
      ORDER BY currency
    `);
    const seriesRows = await this.prisma.$queryRaw<RevenueSeriesRow[]>(Prisma.sql`
      WITH revenue_events AS (
        SELECT
          date_trunc(
            ${filters.groupBy},
            p.paid_at AT TIME ZONE COALESCE(cl.timezone, ${filters.timezone})
          )::date::text AS period,
          p.currency,
          COALESCE(SUM(p.amount_minor) FILTER (WHERE p.provider <> 'offline'), 0)::bigint
            AS online_revenue_minor,
          COALESCE(SUM(p.amount_minor) FILTER (WHERE p.provider = 'offline'), 0)::bigint
            AS offline_revenue_minor,
          0::bigint AS refund_minor
        FROM payments p
        JOIN appointments a ON a.id = p.appointment_id
        JOIN clinic_locations cl ON cl.id = a.clinic_location_id
        ${paymentWhereSql}
        GROUP BY period, p.currency
        UNION ALL
        SELECT
          date_trunc(
            ${filters.groupBy},
            r.processed_at AT TIME ZONE COALESCE(cl.timezone, ${filters.timezone})
          )::date::text AS period,
          r.currency,
          0::bigint AS online_revenue_minor,
          0::bigint AS offline_revenue_minor,
          COALESCE(SUM(r.amount_minor), 0)::bigint AS refund_minor
        FROM refunds r
        JOIN appointments a ON a.id = r.appointment_id
        JOIN clinic_locations cl ON cl.id = a.clinic_location_id
        ${refundWhereSql}
        GROUP BY period, r.currency
      )
      SELECT
        period,
        currency,
        SUM(online_revenue_minor)::bigint AS "onlineRevenueMinor",
        SUM(offline_revenue_minor)::bigint AS "offlineRevenueMinor",
        SUM(refund_minor)::bigint AS "refundMinor",
        (
          SUM(online_revenue_minor) + SUM(offline_revenue_minor) - SUM(refund_minor)
        )::bigint AS "netRevenueMinor"
      FROM revenue_events
      GROUP BY period, currency
      ORDER BY period, currency
    `);

    return {
      filters,
      summary: summaryRows.map((row) => this.serializeRevenue(row)),
      series: seriesRows.map((row) => ({
        period: row.period,
        ...this.serializeRevenue(row)
      }))
    };
  }

  private async getDoctorReport(filters: NormalizedReportQuery, scope: ReportScope) {
    const whereSql = this.whereSql([
      ...this.appointmentWhere(filters, scope, "a", "cl", {
        includeStatus: true
      }),
      ...this.doctorScopeWhere(filters, scope)
    ]);
    const rows = await this.prisma.$queryRaw<DoctorReportRow[]>(Prisma.sql`
      SELECT
        d.id AS "doctorId",
        u.full_name AS "doctorName",
        COUNT(a.id)::bigint AS "appointmentCount",
        COUNT(a.id) FILTER (WHERE a.status = 'completed')::bigint AS "completedAppointments",
        COUNT(a.id) FILTER (WHERE a.status = 'no_show')::bigint AS "noShowAppointments",
        COALESCE(
          SUM(EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 60)
            FILTER (WHERE a.status::text IN (${Prisma.join(bookedStatuses)})),
          0
        )::float AS "bookedMinutes",
        drs.average_rating AS "averageRating",
        drs.review_count AS "reviewCount"
      FROM doctors d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN doctor_rating_summaries drs ON drs.doctor_id = d.id
      JOIN appointments a ON a.doctor_id = d.id
      JOIN clinic_locations cl ON cl.id = a.clinic_location_id
      ${whereSql}
      GROUP BY d.id, u.full_name, drs.average_rating, drs.review_count
      HAVING COUNT(a.id) > 0
      ORDER BY "appointmentCount" DESC, u.full_name ASC
      LIMIT ${filters.limit}
    `);
    const availability = await this.getAvailabilityMinutes(filters, scope);
    const availabilityByDoctor = new Map(
      availability.map((row) => [row.doctorId, Number(row.availableMinutes ?? 0)])
    );

    return {
      filters,
      doctors: rows.map((row) => {
        const bookedMinutes = Math.round(Number(row.bookedMinutes ?? 0));
        const availableMinutes = Math.round(availabilityByDoctor.get(row.doctorId) ?? 0);

        return {
          doctorId: row.doctorId,
          doctorName: row.doctorName,
          appointmentCount: this.toNumber(row.appointmentCount),
          completedAppointments: this.toNumber(row.completedAppointments),
          noShowAppointments: this.toNumber(row.noShowAppointments),
          bookedMinutes,
          availableMinutes,
          utilizationPercent:
            availableMinutes > 0 ? this.roundRate(bookedMinutes / availableMinutes) : null,
          averageRating: this.toDecimalNumber(row.averageRating),
          reviewCount: this.toNumber(row.reviewCount ?? 0)
        };
      })
    };
  }

  private async getServiceReport(filters: NormalizedReportQuery, scope: ReportScope) {
    const where = this.appointmentWhere(filters, scope);
    const whereSql = this.whereSql(where);
    const rows = await this.prisma.$queryRaw<ServiceReportRow[]>(Prisma.sql`
      SELECT
        a.service_name_snapshot AS "serviceName",
        a.currency,
        COUNT(*)::bigint AS "appointmentCount",
        COUNT(*) FILTER (WHERE a.status = 'completed')::bigint AS "completedAppointments",
        COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status = 'successful'), 0)::bigint
          AS "revenueMinor"
      FROM appointments a
      JOIN clinic_locations cl ON cl.id = a.clinic_location_id
      LEFT JOIN payments p ON p.appointment_id = a.id
      ${whereSql}
      GROUP BY a.service_name_snapshot, a.currency
      ORDER BY "appointmentCount" DESC, "serviceName" ASC
      LIMIT ${filters.limit}
    `);

    return {
      filters,
      services: rows.map((row) => ({
        serviceName: row.serviceName,
        appointmentCount: this.toNumber(row.appointmentCount),
        completedAppointments: this.toNumber(row.completedAppointments),
        revenueMinor: this.toBigInt(row.revenueMinor).toString(),
        currency: row.currency
      }))
    };
  }

  private async getNotificationReport(filters: NormalizedReportQuery) {
    const where = this.notificationWhere(filters);
    const whereSql = this.whereSql(where);
    const summaryRows = await this.prisma.$queryRaw<NotificationSummaryRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS "totalNotifications",
        COUNT(*) FILTER (WHERE status = 'sent')::bigint AS "sentNotifications",
        COUNT(*) FILTER (WHERE status = 'failed')::bigint AS "failedNotifications",
        COUNT(*) FILTER (WHERE status IN ('queued', 'processing'))::bigint AS "queuedNotifications"
      FROM notification_logs nl
      ${whereSql}
    `);
    const statusRows = await this.prisma.$queryRaw<NotificationStatusRow[]>(Prisma.sql`
      SELECT status::text, COUNT(*)::bigint AS count
      FROM notification_logs nl
      ${whereSql}
      GROUP BY status
      ORDER BY status
    `);
    const seriesRows = await this.prisma.$queryRaw<NotificationSeriesRow[]>(Prisma.sql`
      SELECT
        date_trunc(${filters.groupBy}, nl.created_at AT TIME ZONE ${filters.timezone})::date::text
          AS period,
        COUNT(*)::bigint AS "totalNotifications",
        COUNT(*) FILTER (WHERE status = 'sent')::bigint AS "sentNotifications",
        COUNT(*) FILTER (WHERE status = 'failed')::bigint AS "failedNotifications"
      FROM notification_logs nl
      ${whereSql}
      GROUP BY period
      ORDER BY period
    `);
    const summary = summaryRows[0] ?? {
      totalNotifications: 0n,
      sentNotifications: 0n,
      failedNotifications: 0n,
      queuedNotifications: 0n
    };
    const total = this.toNumber(summary.totalNotifications);

    return {
      filters,
      summary: {
        totalNotifications: total,
        sentNotifications: this.toNumber(summary.sentNotifications),
        failedNotifications: this.toNumber(summary.failedNotifications),
        queuedNotifications: this.toNumber(summary.queuedNotifications),
        successRate:
          total > 0 ? this.roundRate(this.toNumber(summary.sentNotifications) / total) : 0,
        failureRate:
          total > 0 ? this.roundRate(this.toNumber(summary.failedNotifications) / total) : 0
      },
      statusDistribution: statusRows.map((row) => ({
        status: row.status,
        count: this.toNumber(row.count)
      })),
      series: this.fillNotificationSeries(filters, seriesRows)
    };
  }

  private async getRatingAggregate(filters: NormalizedReportQuery, scope: ReportScope) {
    const conditions = [
      Prisma.sql`r.status = 'approved'`,
      ...this.reviewScopeConditions(filters, scope)
    ];
    const rows = await this.prisma.$queryRaw<RatingSummaryRow[]>(Prisma.sql`
      SELECT
        COALESCE(AVG(r.rating), 0) AS "averageRating",
        COUNT(*)::bigint AS "reviewCount"
      FROM reviews r
      ${this.whereSql(conditions)}
    `);
    const row = rows[0];

    return {
      averageRating: this.toDecimalNumber(row?.averageRating ?? 0),
      reviewCount: this.toNumber(row?.reviewCount ?? 0)
    };
  }

  private async getDoctorRatingReport(filters: NormalizedReportQuery, doctorId: string) {
    const summary = await this.getRatingAggregate(filters, { doctorId });
    const rows = await this.prisma.$queryRaw<ReviewRow[]>(Prisma.sql`
      SELECT
        r.id,
        r.rating,
        r.title,
        r.comment,
        u.full_name AS "patientName",
        c.name AS "clinicName",
        r.created_at AS "createdAt"
      FROM reviews r
      JOIN patients p ON p.id = r.patient_id
      JOIN users u ON u.id = p.user_id
      JOIN clinics c ON c.id = r.clinic_id
      WHERE r.status = 'approved'
        AND r.doctor_id = ${doctorId}::uuid
      ORDER BY r.created_at DESC
      LIMIT ${filters.limit}
    `);

    return {
      filters,
      summary,
      recentReviews: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        title: row.title,
        comment: row.comment,
        patientDisplayName: this.anonymizeName(row.patientName),
        clinicName: row.clinicName,
        createdAt: row.createdAt.toISOString()
      }))
    };
  }

  private async getUniquePatientCount(filters: NormalizedReportQuery, scope: ReportScope) {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT a.patient_id)::bigint AS count
      FROM appointments a
      JOIN clinic_locations cl ON cl.id = a.clinic_location_id
      ${this.whereSql(this.appointmentWhere(filters, scope))}
    `);

    return this.toNumber(rows[0]?.count ?? 0);
  }

  private async getDoctorClinicBreakdown(filters: NormalizedReportQuery, doctorId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ clinicId: string; clinicName: string; appointmentCount: bigint }>
    >(Prisma.sql`
      SELECT
        c.id AS "clinicId",
        c.name AS "clinicName",
        COUNT(*)::bigint AS "appointmentCount"
      FROM appointments a
      JOIN clinics c ON c.id = a.clinic_id
      JOIN clinic_locations cl ON cl.id = a.clinic_location_id
      ${this.whereSql(this.appointmentWhere(filters, { doctorId }))}
      GROUP BY c.id, c.name
      ORDER BY "appointmentCount" DESC, c.name ASC
    `);

    return rows.map((row) => ({
      clinicId: row.clinicId,
      clinicName: row.clinicName,
      appointmentCount: this.toNumber(row.appointmentCount)
    }));
  }

  private async getDoctorServiceBreakdown(filters: NormalizedReportQuery, doctorId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{ serviceName: string; appointmentCount: bigint }>
    >(Prisma.sql`
      SELECT
        a.service_name_snapshot AS "serviceName",
        COUNT(*)::bigint AS "appointmentCount"
      FROM appointments a
      JOIN clinic_locations cl ON cl.id = a.clinic_location_id
      ${this.whereSql(this.appointmentWhere(filters, { doctorId }))}
      GROUP BY a.service_name_snapshot
      ORDER BY "appointmentCount" DESC, "serviceName" ASC
    `);

    return rows.map((row) => ({
      serviceName: row.serviceName,
      appointmentCount: this.toNumber(row.appointmentCount)
    }));
  }

  private async getAvailabilityMinutes(filters: NormalizedReportQuery, scope: ReportScope) {
    const conditions = [
      Prisma.sql`dar.is_active = true`,
      Prisma.sql`dc.deleted_at IS NULL`,
      ...(scope.clinicId ? [Prisma.sql`dc.clinic_id = ${scope.clinicId}::uuid`] : []),
      ...(scope.doctorId ? [Prisma.sql`dc.doctor_id = ${scope.doctorId}::uuid`] : []),
      ...(filters.clinicLocationId
        ? [Prisma.sql`dc.clinic_location_id = ${filters.clinicLocationId}::uuid`]
        : []),
      ...(filters.doctorId ? [Prisma.sql`dc.doctor_id = ${filters.doctorId}::uuid`] : [])
    ];

    return this.prisma.$queryRaw<AvailabilityRow[]>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(
          CAST(${filters.from} AS date),
          CAST(${filters.to} AS date),
          INTERVAL '1 day'
        )::date AS day
      )
      SELECT
        dc.doctor_id AS "doctorId",
        COALESCE(
          SUM(
            GREATEST(
              EXTRACT(EPOCH FROM (dar.ends_at - dar.starts_at)) / 60
              - COALESCE(b.break_minutes, 0),
              0
            )
          ),
          0
        )::float AS "availableMinutes"
      FROM days
      JOIN doctor_availability_rules dar
        ON dar.day_of_week = EXTRACT(DOW FROM days.day)::int
       AND (dar.effective_from IS NULL OR dar.effective_from <= days.day)
       AND (dar.effective_to IS NULL OR dar.effective_to >= days.day)
      JOIN doctor_clinics dc ON dc.id = dar.doctor_clinic_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (dab.ends_at - dab.starts_at)) / 60), 0)
          AS break_minutes
        FROM doctor_availability_breaks dab
        WHERE dab.rule_id = dar.id
      ) b ON true
      ${this.whereSql(conditions)}
      GROUP BY dc.doctor_id
    `);
  }

  private appointmentWhere(
    filters: NormalizedReportQuery,
    scope: ReportScope,
    appointmentAlias = "a",
    locationAlias = "cl",
    options: { includeStatus?: boolean } = {}
  ) {
    const a = Prisma.raw(appointmentAlias);
    const cl = Prisma.raw(locationAlias);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`(${a}.starts_at AT TIME ZONE COALESCE(${cl}.timezone, ${filters.timezone}))::date >= CAST(${filters.from} AS date)`,
      Prisma.sql`(${a}.starts_at AT TIME ZONE COALESCE(${cl}.timezone, ${filters.timezone}))::date <= CAST(${filters.to} AS date)`,
      ...(scope.clinicId ? [Prisma.sql`${a}.clinic_id = ${scope.clinicId}::uuid`] : []),
      ...(scope.doctorId ? [Prisma.sql`${a}.doctor_id = ${scope.doctorId}::uuid`] : []),
      ...(filters.clinicId ? [Prisma.sql`${a}.clinic_id = ${filters.clinicId}::uuid`] : []),
      ...(filters.clinicLocationId
        ? [Prisma.sql`${a}.clinic_location_id = ${filters.clinicLocationId}::uuid`]
        : []),
      ...(filters.doctorId ? [Prisma.sql`${a}.doctor_id = ${filters.doctorId}::uuid`] : []),
      ...(filters.doctorClinicServiceId
        ? [Prisma.sql`${a}.doctor_clinic_service_id = ${filters.doctorClinicServiceId}::uuid`]
        : []),
      ...(filters.serviceId
        ? [
            Prisma.sql`EXISTS (
              SELECT 1
              FROM doctor_clinic_services dcs_filter
              JOIN clinic_services cs_filter ON cs_filter.id = dcs_filter.clinic_service_id
              WHERE dcs_filter.id = ${a}.doctor_clinic_service_id
                AND cs_filter.service_id = ${filters.serviceId}::uuid
            )`
          ]
        : [])
    ];

    if (options.includeStatus !== false && filters.status) {
      conditions.push(Prisma.sql`${a}.status = ${filters.status}::appointment_status`);
    }

    return conditions;
  }

  private paymentWhere(filters: NormalizedReportQuery, scope: ReportScope) {
    return [
      Prisma.sql`p.status = 'successful'`,
      Prisma.sql`p.paid_at IS NOT NULL`,
      Prisma.sql`(p.paid_at AT TIME ZONE COALESCE(cl.timezone, ${filters.timezone}))::date >= CAST(${filters.from} AS date)`,
      Prisma.sql`(p.paid_at AT TIME ZONE COALESCE(cl.timezone, ${filters.timezone}))::date <= CAST(${filters.to} AS date)`,
      ...this.appointmentScopeOnly(filters, scope)
    ];
  }

  private refundWhere(filters: NormalizedReportQuery, scope: ReportScope) {
    return [
      Prisma.sql`r.status = 'processed'`,
      Prisma.sql`r.processed_at IS NOT NULL`,
      Prisma.sql`(r.processed_at AT TIME ZONE COALESCE(cl.timezone, ${filters.timezone}))::date >= CAST(${filters.from} AS date)`,
      Prisma.sql`(r.processed_at AT TIME ZONE COALESCE(cl.timezone, ${filters.timezone}))::date <= CAST(${filters.to} AS date)`,
      ...this.appointmentScopeOnly(filters, scope)
    ];
  }

  private appointmentScopeOnly(filters: NormalizedReportQuery, scope: ReportScope) {
    return [
      ...(scope.clinicId ? [Prisma.sql`a.clinic_id = ${scope.clinicId}::uuid`] : []),
      ...(scope.doctorId ? [Prisma.sql`a.doctor_id = ${scope.doctorId}::uuid`] : []),
      ...(filters.clinicId ? [Prisma.sql`a.clinic_id = ${filters.clinicId}::uuid`] : []),
      ...(filters.clinicLocationId
        ? [Prisma.sql`a.clinic_location_id = ${filters.clinicLocationId}::uuid`]
        : []),
      ...(filters.doctorId ? [Prisma.sql`a.doctor_id = ${filters.doctorId}::uuid`] : []),
      ...(filters.status ? [Prisma.sql`a.status = ${filters.status}::appointment_status`] : []),
      ...(filters.doctorClinicServiceId
        ? [Prisma.sql`a.doctor_clinic_service_id = ${filters.doctorClinicServiceId}::uuid`]
        : []),
      ...(filters.serviceId
        ? [
            Prisma.sql`EXISTS (
              SELECT 1
              FROM doctor_clinic_services dcs_filter
              JOIN clinic_services cs_filter ON cs_filter.id = dcs_filter.clinic_service_id
              WHERE dcs_filter.id = a.doctor_clinic_service_id
                AND cs_filter.service_id = ${filters.serviceId}::uuid
            )`
          ]
        : [])
    ];
  }

  private doctorScopeWhere(filters: NormalizedReportQuery, scope: ReportScope) {
    return [
      Prisma.sql`d.deleted_at IS NULL`,
      ...(scope.doctorId ? [Prisma.sql`d.id = ${scope.doctorId}::uuid`] : []),
      ...(filters.doctorId ? [Prisma.sql`d.id = ${filters.doctorId}::uuid`] : []),
      ...(scope.clinicId || filters.clinicId || filters.clinicLocationId
        ? [
            Prisma.sql`EXISTS (
              SELECT 1
              FROM doctor_clinics dc_scope
              WHERE dc_scope.doctor_id = d.id
                AND dc_scope.deleted_at IS NULL
                ${scope.clinicId ? Prisma.sql`AND dc_scope.clinic_id = ${scope.clinicId}::uuid` : Prisma.empty}
                ${filters.clinicId ? Prisma.sql`AND dc_scope.clinic_id = ${filters.clinicId}::uuid` : Prisma.empty}
                ${filters.clinicLocationId ? Prisma.sql`AND dc_scope.clinic_location_id = ${filters.clinicLocationId}::uuid` : Prisma.empty}
            )`
          ]
        : [])
    ];
  }

  private notificationWhere(filters: NormalizedReportQuery) {
    return [
      Prisma.sql`(nl.created_at AT TIME ZONE ${filters.timezone})::date >= CAST(${filters.from} AS date)`,
      Prisma.sql`(nl.created_at AT TIME ZONE ${filters.timezone})::date <= CAST(${filters.to} AS date)`
    ];
  }

  private reviewScopeConditions(filters: NormalizedReportQuery, scope: ReportScope) {
    return [
      ...(scope.clinicId ? [Prisma.sql`r.clinic_id = ${scope.clinicId}::uuid`] : []),
      ...(scope.doctorId ? [Prisma.sql`r.doctor_id = ${scope.doctorId}::uuid`] : []),
      ...(filters.clinicId ? [Prisma.sql`r.clinic_id = ${filters.clinicId}::uuid`] : []),
      ...(filters.doctorId ? [Prisma.sql`r.doctor_id = ${filters.doctorId}::uuid`] : [])
    ];
  }

  private whereSql(conditions: Prisma.Sql[]) {
    return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  }

  private normalizeQuery(query: ReportQuery, enforcedScope: ReportScope = {}): NormalizedReportQuery {
    const today = new Date();
    const defaultTo = this.toDateKey(today);
    const defaultFromDate = new Date(today);
    defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);

    return {
      from: query.from ?? this.toDateKey(defaultFromDate),
      to: query.to ?? defaultTo,
      clinicId: enforcedScope.clinicId ?? query.clinicId,
      clinicLocationId: query.clinicLocationId,
      doctorId: enforcedScope.doctorId ?? query.doctorId,
      serviceId: query.serviceId,
      doctorClinicServiceId: query.doctorClinicServiceId,
      status: query.status,
      groupBy: query.groupBy,
      timezone: query.timezone,
      limit: query.limit
    };
  }

  private async getDoctorForActor(actor: AuthenticatedUser) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId: actor.id },
      select: {
        id: true,
        slug: true,
        user: {
          select: { fullName: true }
        }
      }
    });

    if (!doctor) {
      throw new NotFoundException("Doctor profile not found");
    }

    return {
      id: doctor.id,
      slug: doctor.slug,
      fullName: doctor.user.fullName
    };
  }

  private async assertCan(
    actor: AuthenticatedUser,
    permissionCode: string,
    scope: Parameters<AuthorizationService["can"]>[2]["scope"],
    scopeId: string | null
  ) {
    const allowed = await this.authorizationService.can(actor, permissionCode, { scope, scopeId });

    if (!allowed) {
      throw new ForbiddenException("Missing required permission");
    }
  }

  private cached<T>(keyParts: unknown[], producer: () => Promise<T>): Promise<T> {
    const key = JSON.stringify(keyParts);
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.value as T);
    }

    return producer().then((value) => {
      this.cache.set(key, { expiresAt: Date.now() + cacheTtlMs, value });
      return value;
    });
  }

  private serializeRevenue(row: RevenueRow) {
    return {
      currency: row.currency,
      onlineRevenueMinor: this.toBigInt(row.onlineRevenueMinor).toString(),
      offlineRevenueMinor: this.toBigInt(row.offlineRevenueMinor).toString(),
      refundMinor: this.toBigInt(row.refundMinor).toString(),
      netRevenueMinor: this.toBigInt(row.netRevenueMinor).toString()
    };
  }

  private fillAppointmentSeries(filters: NormalizedReportQuery, rows: AppointmentSeriesRow[]) {
    const rowByPeriod = new Map(rows.map((row) => [row.period, row]));

    return this.periodsBetween(filters.from, filters.to, filters.groupBy).map((period) => {
      const row = rowByPeriod.get(period);

      return {
        period,
        appointments: this.toNumber(row?.appointments ?? 0),
        completedAppointments: this.toNumber(row?.completedAppointments ?? 0),
        cancelledAppointments: this.toNumber(row?.cancelledAppointments ?? 0),
        noShowAppointments: this.toNumber(row?.noShowAppointments ?? 0)
      };
    });
  }

  private fillNotificationSeries(filters: NormalizedReportQuery, rows: NotificationSeriesRow[]) {
    const rowByPeriod = new Map(rows.map((row) => [row.period, row]));

    return this.periodsBetween(filters.from, filters.to, filters.groupBy).map((period) => {
      const row = rowByPeriod.get(period);

      return {
        period,
        totalNotifications: this.toNumber(row?.totalNotifications ?? 0),
        sentNotifications: this.toNumber(row?.sentNotifications ?? 0),
        failedNotifications: this.toNumber(row?.failedNotifications ?? 0)
      };
    });
  }

  private periodsBetween(from: string, to: string, groupBy: "day" | "week" | "month") {
    const periods: string[] = [];
    const current = this.periodStart(new Date(`${from}T00:00:00.000Z`), groupBy);
    const end = this.periodStart(new Date(`${to}T00:00:00.000Z`), groupBy);

    while (current <= end) {
      periods.push(this.toDateKey(current));

      if (groupBy === "month") {
        current.setUTCMonth(current.getUTCMonth() + 1);
      } else if (groupBy === "week") {
        current.setUTCDate(current.getUTCDate() + 7);
      } else {
        current.setUTCDate(current.getUTCDate() + 1);
      }
    }

    return periods;
  }

  private periodStart(date: Date, groupBy: "day" | "week" | "month") {
    const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

    if (groupBy === "month") {
      result.setUTCDate(1);
      return result;
    }

    if (groupBy === "week") {
      const day = result.getUTCDay();
      const daysFromMonday = (day + 6) % 7;
      result.setUTCDate(result.getUTCDate() - daysFromMonday);
    }

    return result;
  }

  private toDateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private toNumber(value: bigint | number | null | undefined) {
    if (typeof value === "bigint") {
      return Number(value);
    }

    return Number(value ?? 0);
  }

  private toBigInt(value: bigint | number | null | undefined) {
    if (typeof value === "bigint") {
      return value;
    }

    return BigInt(Math.trunc(Number(value ?? 0)));
  }

  private toDecimalNumber(value: Prisma.Decimal | number | string | null | undefined) {
    return Number(value ?? 0);
  }

  private roundRate(value: number) {
    return Math.round(value * 10_000) / 100;
  }

  private anonymizeName(fullName: string) {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      return "Verified patient";
    }

    const first = parts[0] ?? "Patient";
    const lastInitial = parts[1]?.[0]?.toUpperCase();

    return lastInitial ? `${first} ${lastInitial}.` : first;
  }
}
