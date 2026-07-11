"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type ReportMode = "admin" | "clinic" | "doctor";

type RevenueRow = {
  currency: string;
  onlineRevenueMinor: string;
  offlineRevenueMinor: string;
  refundMinor: string;
  netRevenueMinor: string;
};

type AppointmentSeriesRow = {
  period: string;
  appointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
};

type StatusDistributionRow = {
  status: string;
  count: number;
};

type DoctorRow = {
  doctorId: string;
  doctorName: string;
  appointmentCount: number;
  completedAppointments: number;
  noShowAppointments: number;
  bookedMinutes: number;
  availableMinutes: number;
  utilizationPercent: number | null;
  averageRating: number;
  reviewCount: number;
};

type ServiceRow = {
  serviceName: string;
  appointmentCount: number;
  completedAppointments: number;
  revenueMinor: string;
  currency: string;
};

type NotificationSummary = {
  totalNotifications: number;
  sentNotifications: number;
  failedNotifications: number;
  queuedNotifications: number;
  successRate: number;
  failureRate: number;
};

type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  patientDisplayName: string;
  clinicName: string;
  createdAt: string;
};

type ReportOverview = {
  filters: {
    from: string;
    to: string;
    groupBy: string;
  };
  summary: Record<string, unknown> & {
    totalAppointments?: number;
    completedAppointments?: number;
    cancelledAppointments?: number;
    noShowAppointments?: number;
    cancellationRate?: number;
    noShowRate?: number;
    revenueByCurrency?: RevenueRow[];
    notificationDelivery?: NotificationSummary;
    averageRating?: number;
    averagePlatformRating?: number;
    reviewCount?: number;
    platformReviewCount?: number;
    uniquePatients?: number;
    utilizationPercent?: number | null;
  };
  appointmentSeries?: AppointmentSeriesRow[];
  revenueSeries?: Array<RevenueRow & { period: string }>;
  appointmentStatusDistribution?: StatusDistributionRow[];
  notificationStatusDistribution?: StatusDistributionRow[];
  doctors?: DoctorRow[];
  services?: ServiceRow[];
  recentReviews?: ReviewRow[];
  clinicBreakdown?: Array<{ clinicName: string; appointmentCount: number }>;
  serviceBreakdown?: Array<{ serviceName: string; appointmentCount: number }>;
};

type DetailReports = {
  doctors?: { doctors: DoctorRow[] };
  services?: { services: ServiceRow[] };
  notifications?: {
    summary: NotificationSummary;
    statusDistribution: StatusDistributionRow[];
    series: Array<{
      period: string;
      totalNotifications: number;
      sentNotifications: number;
      failedNotifications: number;
    }>;
  };
  ratings?: {
    summary: { averageRating: number; reviewCount: number };
    recentReviews: ReviewRow[];
  };
};

const today = new Date();
const defaultTo = today.toISOString().slice(0, 10);
const defaultFromDate = new Date(today);
defaultFromDate.setDate(defaultFromDate.getDate() - 29);
const defaultFrom = defaultFromDate.toISOString().slice(0, 10);

export function ReportDashboard({
  apiUrl,
  appName,
  mode,
  clinicId,
  accessTokenOverride,
  embedded = false
}: {
  apiUrl: string;
  appName: string;
  mode: ReportMode;
  clinicId?: string;
  accessTokenOverride?: string;
  embedded?: boolean;
}) {
  const [accessToken, setAccessToken] = useState(accessTokenOverride ?? "");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("day");
  const [overview, setOverview] = useState<ReportOverview | null>(null);
  const [details, setDetails] = useState<DetailReports>({});
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const tokenStorageKey = mode === "doctor" ? "doctobook_doctor_access_token" : "doctobook_access_token";
  const title = mode === "admin" ? "Platform reports" : mode === "clinic" ? "Clinic reports" : "Doctor reports";
  const basePath = useMemo(() => {
    if (mode === "admin") {
      return "/v1/admin/reports";
    }

    if (mode === "clinic") {
      return `/v1/clinics/${clinicId}/reports`;
    }

    return "/v1/doctors/me/reports";
  }, [clinicId, mode]);

  useEffect(() => {
    if (accessTokenOverride) {
      setAccessToken(accessTokenOverride);
      return;
    }

    const storedToken = window.sessionStorage.getItem(tokenStorageKey);

    if (storedToken) {
      setAccessToken(storedToken);
    }
  }, [accessTokenOverride, tokenStorageKey]);

  useEffect(() => {
    if (accessToken && !accessTokenOverride) {
      window.sessionStorage.setItem(tokenStorageKey, accessToken);
    }
  }, [accessToken, accessTokenOverride, tokenStorageKey]);

  async function apiRequest<T>(path: string) {
    if (!accessToken.trim()) {
      throw new Error("Access token is required");
    }

    const response = await fetch(`${apiUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken.trim()}`
      }
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: unknown;
        error?: unknown;
      } | null;
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : typeof payload?.error === "string"
            ? payload.error
            : `Request failed with ${response.status}`;

      throw new Error(message);
    }

    return (await response.json()) as T;
  }

  async function loadReports(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setIsLoading(true);
    setNotice("");
    setError("");

    try {
      const params = new URLSearchParams({ from, to, groupBy, timezone: "Asia/Colombo" });
      const overviewResponse = await apiRequest<ReportOverview>(
        `${basePath}/overview?${params.toString()}`
      );
      const nextDetails: DetailReports = {};

      if (mode === "admin") {
        nextDetails.doctors = await apiRequest<{ doctors: DoctorRow[] }>(
          `${basePath}/doctors?${params.toString()}`
        );
        nextDetails.notifications = await apiRequest<DetailReports["notifications"]>(
          `${basePath}/notifications?${params.toString()}`
        );
      } else if (mode === "clinic") {
        nextDetails.doctors = await apiRequest<{ doctors: DoctorRow[] }>(
          `${basePath}/doctors?${params.toString()}`
        );
        nextDetails.services = await apiRequest<{ services: ServiceRow[] }>(
          `${basePath}/services?${params.toString()}`
        );
      } else {
        nextDetails.ratings = await apiRequest<DetailReports["ratings"]>(
          `${basePath}/ratings?${params.toString()}`
        );
      }

      setOverview(overviewResponse);
      setDetails(nextDetails);
      setNotice("Reports loaded");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to load reports");
    } finally {
      setIsLoading(false);
    }
  }

  const revenue = overview?.summary.revenueByCurrency ?? [];
  const totalNetRevenue = revenue.reduce((sum, row) => sum + BigInt(row.netRevenueMinor), 0n);
  const primaryCurrency = revenue[0]?.currency ?? "LKR";

  return (
    <main className={embedded ? "report-embedded" : "portal-shell"}>
      {!embedded && <aside className="portal-sidebar">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>{appName}</h1>
        </div>
        <nav aria-label="Reports navigation">
          <a className="nav-item active" href="#overview">
            Overview
          </a>
          <a className="nav-item" href="#appointments">
            Appointments
          </a>
          <a className="nav-item" href="#revenue">
            Revenue
          </a>
          <a className="nav-item" href="#details">
            Details
          </a>
        </nav>
      </aside>}

      <section className={embedded ? "report-content" : "portal-main"} id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">{mode === "clinic" ? clinicId : mode}</p>
            <h2>{title}</h2>
          </div>
          <button
            className="primary-button"
            disabled={isLoading}
            onClick={() => void loadReports()}
            type="button"
          >
            Refresh
          </button>
        </header>

        <form className={`reports-filter${embedded ? " panel" : " auth-strip"}`} onSubmit={(event) => void loadReports(event)}>
          {!embedded && <label>
            Access token
            <input
              autoComplete="off"
              onChange={(event) => setAccessToken(event.target.value)}
              type="password"
              value={accessToken}
            />
          </label>}
          <label>
            From
            <input onChange={(event) => setFrom(event.target.value)} type="date" value={from} />
          </label>
          <label>
            To
            <input onChange={(event) => setTo(event.target.value)} type="date" value={to} />
          </label>
          <label>
            Group by
            <select onChange={(event) => setGroupBy(event.target.value as typeof groupBy)} value={groupBy}>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <button className="primary-button" disabled={isLoading} type="submit">
            Load
          </button>
        </form>

        {(notice || error) && (
          <div className={error ? "status-message error" : "status-message"} role="status">
            {error || notice}
          </div>
        )}

        <section className="metric-grid report-metrics" aria-label="Report totals">
          <Metric label="Appointments" value={overview?.summary.totalAppointments ?? 0} />
          <Metric label="Completed" value={overview?.summary.completedAppointments ?? 0} />
          <Metric label="Cancelled" value={overview?.summary.cancelledAppointments ?? 0} />
          <Metric label="No-shows" value={overview?.summary.noShowAppointments ?? 0} />
          <Metric
            label="Net revenue"
            value={formatMoney(totalNetRevenue.toString(), primaryCurrency)}
          />
          <Metric
            label="Rating"
            value={String(
              overview?.summary.averageRating ??
                overview?.summary.averagePlatformRating ??
                details.ratings?.summary.averageRating ??
                0
            )}
          />
        </section>

        <section className="content-grid" id="appointments">
          <ChartPanel
            rows={overview?.appointmentSeries ?? []}
            title="Appointments over time"
            valueKey="appointments"
          />
          <DistributionPanel
            rows={overview?.appointmentStatusDistribution ?? []}
            title="Status distribution"
          />
        </section>

        <section className="content-grid" id="revenue">
          <RevenuePanel rows={revenue} title="Revenue by currency" />
          <ChartPanel
            rows={overview?.revenueSeries ?? []}
            title="Revenue over time"
            valueKey="netRevenueMinor"
            money
          />
        </section>

        <section className="content-grid" id="details">
          {mode === "admin" ? (
            <>
              <DoctorRankingPanel rows={details.doctors?.doctors ?? []} />
              <NotificationPanel
                rows={details.notifications?.statusDistribution ?? overview?.notificationStatusDistribution ?? []}
                summary={details.notifications?.summary ?? overview?.summary.notificationDelivery}
              />
            </>
          ) : null}

          {mode === "clinic" ? (
            <>
              <DoctorRankingPanel rows={details.doctors?.doctors ?? overview?.doctors ?? []} />
              <ServicePanel rows={details.services?.services ?? overview?.services ?? []} />
            </>
          ) : null}

          {mode === "doctor" ? (
            <>
              <DistributionPanel
                rows={(overview?.clinicBreakdown ?? []).map((row) => ({
                  status: row.clinicName,
                  count: row.appointmentCount
                }))}
                title="Appointments by clinic"
              />
              <ReviewPanel rows={details.ratings?.recentReviews ?? overview?.recentReviews ?? []} />
            </>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChartPanel({
  rows,
  title,
  valueKey,
  money = false
}: {
  rows: Array<Record<string, unknown> & { period: string }>;
  title: string;
  valueKey: string;
  money?: boolean;
}) {
  const maxValue = Math.max(
    1,
    ...rows.map((row) => Number(row[valueKey] ?? 0))
  );

  return (
    <div className="panel report-chart-panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <span>{rows.length} periods</span>
      </div>
      <div className="report-bar-list">
        {rows.slice(0, 14).map((row) => {
          const value = Number(row[valueKey] ?? 0);

          return (
            <div className="report-bar-row" key={`${row.period}-${String(row.currency ?? "")}`}>
              <span>{row.period}</span>
              <div className="report-bar-track">
                <i style={{ width: `${Math.max(4, (value / maxValue) * 100)}%` }} />
              </div>
              <strong>
                {money ? formatMoney(String(row[valueKey] ?? "0"), String(row.currency ?? "LKR")) : value}
              </strong>
            </div>
          );
        })}
        {rows.length === 0 ? <span className="empty-state">No series data</span> : null}
      </div>
    </div>
  );
}

function DistributionPanel({ rows, title }: { rows: StatusDistributionRow[]; title: string }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <span>{rows.length} groups</span>
      </div>
      <div className="compact-list">
        {rows.map((row) => (
          <div className="compact-row" key={row.status}>
            <strong>{humanize(row.status)}</strong>
            <span>{row.count}</span>
          </div>
        ))}
        {rows.length === 0 ? <span className="empty-state">No distribution data</span> : null}
      </div>
    </div>
  );
}

function RevenuePanel({ rows, title }: { rows: RevenueRow[]; title: string }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>{title}</h3>
        <span>{rows.length} currencies</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Currency</th>
              <th>Online</th>
              <th>Offline</th>
              <th>Refunds</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.currency}>
                <td>{row.currency}</td>
                <td>{formatMoney(row.onlineRevenueMinor, row.currency)}</td>
                <td>{formatMoney(row.offlineRevenueMinor, row.currency)}</td>
                <td>{formatMoney(row.refundMinor, row.currency)}</td>
                <td>
                  <strong>{formatMoney(row.netRevenueMinor, row.currency)}</strong>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <span className="empty-state">No revenue data</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DoctorRankingPanel({ rows }: { rows: DoctorRow[] }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Doctors</h3>
        <span>{rows.length} ranked</span>
      </div>
      <div className="compact-list">
        {rows.map((row) => (
          <div className="compact-row report-compact-row" key={row.doctorId}>
            <span>
              <strong>{row.doctorName}</strong>
              <small>
                {row.appointmentCount} appointments · {row.averageRating}/5 ·{" "}
                {row.utilizationPercent ?? 0}% utilization
              </small>
            </span>
            <span>{row.completedAppointments} completed</span>
          </div>
        ))}
        {rows.length === 0 ? <span className="empty-state">No doctor data</span> : null}
      </div>
    </div>
  );
}

function ServicePanel({ rows }: { rows: ServiceRow[] }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Services</h3>
        <span>{rows.length} services</span>
      </div>
      <div className="compact-list">
        {rows.map((row) => (
          <div className="compact-row report-compact-row" key={row.serviceName}>
            <span>
              <strong>{row.serviceName}</strong>
              <small>{row.completedAppointments} completed</small>
            </span>
            <span>{formatMoney(row.revenueMinor, row.currency)}</span>
          </div>
        ))}
        {rows.length === 0 ? <span className="empty-state">No service data</span> : null}
      </div>
    </div>
  );
}

function NotificationPanel({
  rows,
  summary
}: {
  rows: StatusDistributionRow[];
  summary?: NotificationSummary;
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Notifications</h3>
        <span>{summary?.successRate ?? 0}% sent</span>
      </div>
      <div className="compact-list">
        {rows.map((row) => (
          <div className="compact-row" key={row.status}>
            <strong>{humanize(row.status)}</strong>
            <span>{row.count}</span>
          </div>
        ))}
        {rows.length === 0 ? <span className="empty-state">No notification data</span> : null}
      </div>
    </div>
  );
}

function ReviewPanel({ rows }: { rows: ReviewRow[] }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Recent reviews</h3>
        <span>{rows.length} shown</span>
      </div>
      <div className="compact-list">
        {rows.map((row) => (
          <div className="compact-row report-compact-row" key={row.id}>
            <span>
              <strong>
                {row.rating}/5 · {row.patientDisplayName}
              </strong>
              <small>{row.comment ?? row.clinicName}</small>
            </span>
            <span>{new Date(row.createdAt).toLocaleDateString()}</span>
          </div>
        ))}
        {rows.length === 0 ? <span className="empty-state">No recent reviews</span> : null}
      </div>
    </div>
  );
}

function formatMoney(amountMinor: string, currency: string) {
  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    maximumFractionDigits: Number(BigInt(amountMinor || "0") % 100n) === 0 ? 0 : 2
  }).format(Number(BigInt(amountMinor || "0")) / 100);
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
