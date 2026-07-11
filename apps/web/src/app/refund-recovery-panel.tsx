"use client";

import { useMemo, useState, type FormEvent } from "react";

type RefundStatus =
  | "requested"
  | "under_review"
  | "approved"
  | "rejected"
  | "processing"
  | "processed"
  | "failed"
  | "reconciliation_required";

type RefundSummary = {
  id: string;
  appointmentNumber: string;
  amountMinor: string;
  currency: string;
  status: RefundStatus;
  provider: string;
  providerRefundId: string | null;
  providerStatus: string | null;
  providerResponse: unknown;
  retryCount: number;
  failureReason: string | null;
  reason: string;
  requestedAt: string;
  updatedAt: string;
  patient: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  clinic: {
    id: string;
    name: string;
  };
  doctor: {
    name: string | null;
  };
  payment: {
    id: string;
    provider: string;
    providerPaymentId: string | null;
    amountMinor: string;
    currency: string;
    status: string;
    paidAt: string | null;
  };
  appointment: {
    id: string;
    number: string;
    status: string;
    serviceName: string;
    startsAt: string;
    feeMinor: string;
    currency: string;
  };
  reconciliation: {
    reason: string | null;
    notes: string | null;
    lastVerificationAt: string | null;
    resolvedAt: string | null;
    resolutionAction: string | null;
    assignedTo: {
      name: string | null;
      email: string | null;
    } | null;
  };
  statusHistory?: Array<{
    id: string;
    fromStatus: RefundStatus | null;
    toStatus: RefundStatus;
    reason: string | null;
    createdAt: string;
    actor: {
      name: string | null;
      email: string | null;
    } | null;
  }>;
};

type RefundListResponse = {
  refunds: RefundSummary[];
};

type RefundDetailResponse = {
  refund: RefundSummary;
};

const statusOptions: Array<{ value: RefundStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "failed", label: "Failed" },
  { value: "reconciliation_required", label: "Reconciliation" },
  { value: "requested", label: "Requested" },
  { value: "processing", label: "Processing" },
  { value: "processed", label: "Processed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" }
];

export function RefundRecoveryPanel({
  apiUrl,
  accessToken
}: {
  apiUrl: string;
  accessToken: string;
}) {
  const [refunds, setRefunds] = useState<RefundSummary[]>([]);
  const [selectedRefundId, setSelectedRefundId] = useState("");
  const [selectedRefund, setSelectedRefund] = useState<RefundSummary | null>(null);
  const [status, setStatus] = useState<RefundStatus | "">("failed");
  const [provider, setProvider] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [currency, setCurrency] = useState("LKR");
  const [manualReference, setManualReference] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualRefundedAt, setManualRefundedAt] = useState("");
  const [reconciliationReason, setReconciliationReason] = useState("");
  const [reconciliationNotes, setReconciliationNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const tableSelection = useMemo(
    () => refunds.find((refund) => refund.id === selectedRefundId) ?? refunds[0] ?? null,
    [refunds, selectedRefundId]
  );
  const activeRefund = selectedRefund ?? tableSelection;

  async function apiRequest<T>(path: string, options: RequestInit = {}) {
    if (!accessToken.trim()) {
      throw new Error("Access token is required");
    }

    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken.trim()}`,
        ...(options.headers ?? {})
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

  async function runAction<T>(action: () => Promise<T>, successMessage: string) {
    setIsLoading(true);
    setError("");
    setNotice("");

    try {
      const result = await action();
      setNotice(successMessage);
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function loadRefunds(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    await runAction(async () => {
      const params = new URLSearchParams({ limit: "50" });

      if (status) params.set("status", status);
      if (provider.trim()) params.set("provider", provider.trim());
      if (clinicId.trim()) params.set("clinicId", clinicId.trim());
      if (appointmentId.trim()) params.set("appointmentId", appointmentId.trim());
      if (currency.trim()) params.set("currency", currency.trim().toUpperCase());

      const response = await apiRequest<RefundListResponse>(`/v1/admin/refunds?${params}`);
      setRefunds(response.refunds);
      const nextSelectedId = response.refunds.some((refund) => refund.id === selectedRefundId)
        ? selectedRefundId
        : (response.refunds[0]?.id ?? "");

      setSelectedRefundId(nextSelectedId);
      setSelectedRefund(null);

      if (nextSelectedId) {
        await loadRefundDetail(nextSelectedId);
      }
    }, "Refunds loaded");
  }

  async function loadRefundDetail(refundId: string) {
    const response = await apiRequest<RefundDetailResponse>(`/v1/admin/refunds/${refundId}`);
    setSelectedRefundId(refundId);
    setSelectedRefund(response.refund);
  }

  async function retryRefund() {
    if (!activeRefund) {
      setError("Select a refund first");
      return;
    }

    if (!window.confirm("Retry this refund using the existing refund record?")) {
      return;
    }

    await runAction(async () => {
      const response = await apiRequest<RefundDetailResponse>(
        `/v1/admin/refunds/${activeRefund.id}/retry`,
        { method: "POST" }
      );
      setSelectedRefund(response.refund);
      await loadRefunds();
    }, "Refund retry queued");
  }

  async function markManual() {
    if (!activeRefund) {
      setError("Select a refund first");
      return;
    }

    if (!manualReference.trim() || !manualReason.trim()) {
      setError("Manual reference and reason are required");
      return;
    }

    if (!window.confirm("Mark this refund as manually completed?")) {
      return;
    }

    await runAction(async () => {
      const response = await apiRequest<RefundDetailResponse>(
        `/v1/admin/refunds/${activeRefund.id}/mark-manual`,
        {
          method: "POST",
          body: JSON.stringify({
            providerReference: manualReference.trim(),
            reason: manualReason.trim(),
            refundedAt: manualRefundedAt ? new Date(manualRefundedAt).toISOString() : undefined
          })
        }
      );
      setSelectedRefund(response.refund);
      setManualReference("");
      setManualReason("");
      setManualRefundedAt("");
      await loadRefunds();
    }, "Refund marked manually completed");
  }

  async function moveToReconciliation() {
    if (!activeRefund) {
      setError("Select a refund first");
      return;
    }

    if (!reconciliationReason.trim()) {
      setError("Reconciliation reason is required");
      return;
    }

    if (!window.confirm("Move this refund to reconciliation?")) {
      return;
    }

    await runAction(async () => {
      const response = await apiRequest<RefundDetailResponse>(
        `/v1/admin/refunds/${activeRefund.id}/reconciliation`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: reconciliationReason.trim(),
            notes: reconciliationNotes.trim() || null
          })
        }
      );
      setSelectedRefund(response.refund);
      setReconciliationReason("");
      setReconciliationNotes("");
      await loadRefunds();
    }, "Refund moved to reconciliation");
  }

  return (
    <section className="appointment-ops-panel" id="refunds">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Super Admin</p>
          <h2>Refund recovery</h2>
        </div>
      </div>

      {(notice || error) && (
        <div className={error ? "status-message error" : "status-message"} role="status">
          {error || notice}
        </div>
      )}

      <form className="refund-filter-grid" onSubmit={(event) => void loadRefunds(event)}>
        <label className="field">
          Status
          <select onChange={(event) => setStatus(event.target.value as RefundStatus | "")} value={status}>
            {statusOptions.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Provider
          <input onChange={(event) => setProvider(event.target.value)} placeholder="payhere" value={provider} />
        </label>
        <label className="field">
          Clinic ID
          <input onChange={(event) => setClinicId(event.target.value)} value={clinicId} />
        </label>
        <label className="field">
          Appointment ID
          <input onChange={(event) => setAppointmentId(event.target.value)} value={appointmentId} />
        </label>
        <label className="field">
          Currency
          <input onChange={(event) => setCurrency(event.target.value)} value={currency} />
        </label>
        <button className="primary-button" disabled={isLoading} type="submit">
          Load refunds
        </button>
      </form>

      <div className="appointment-ops-grid refund-recovery-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Refunds</h3>
            <span>{refunds.length} loaded</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Appointment</th>
                  <th>Patient</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((refund) => (
                  <tr
                    className={refund.id === activeRefund?.id ? "selected-row" : ""}
                    key={refund.id}
                    onClick={() => void loadRefundDetail(refund.id)}
                  >
                    <td>
                      <strong>{refund.appointmentNumber}</strong>
                      <span>{refund.clinic.name}</span>
                    </td>
                    <td>
                      <strong>{refund.patient.name ?? "Patient"}</strong>
                      <span>{refund.patient.email ?? refund.patient.phone ?? "No contact"}</span>
                    </td>
                    <td>
                      <strong>{formatMoney(refund.amountMinor, refund.currency)}</strong>
                      <span>{refund.provider}</span>
                    </td>
                    <td>
                      <span className={`status-badge status-${refund.status.replaceAll("_", "-")}`}>
                        {humanize(refund.status)}
                      </span>
                    </td>
                  </tr>
                ))}
                {refunds.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <span className="empty-state">No refunds loaded</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="appointment-detail-panel">
          {activeRefund ? (
            <>
              <div>
                <h4>{activeRefund.appointmentNumber}</h4>
                <p>{activeRefund.reason}</p>
              </div>
              <div className="detail-grid">
                <span>
                  <small>Refund</small>
                  <strong>{formatMoney(activeRefund.amountMinor, activeRefund.currency)}</strong>
                </span>
                <span>
                  <small>Payment</small>
                  <strong>{formatMoney(activeRefund.payment.amountMinor, activeRefund.payment.currency)}</strong>
                </span>
                <span>
                  <small>Provider</small>
                  <strong>{activeRefund.provider}</strong>
                </span>
                <span>
                  <small>Retries</small>
                  <strong>{activeRefund.retryCount}</strong>
                </span>
                <span>
                  <small>Doctor</small>
                  <strong>{activeRefund.doctor.name ?? "Doctor"}</strong>
                </span>
                <span>
                  <small>Appointment</small>
                  <strong>{formatDateTime(activeRefund.appointment.startsAt)}</strong>
                </span>
              </div>

              {activeRefund.failureReason ? (
                <span className="status-message error">{activeRefund.failureReason}</span>
              ) : null}

              <div className="refund-action-panel">
                <div className="action-row">
                  <button disabled={isLoading} onClick={() => void retryRefund()} type="button">
                    Retry
                  </button>
                  <button
                    className="danger-button"
                    disabled={isLoading}
                    onClick={() => void moveToReconciliation()}
                    type="button"
                  >
                    Reconciliation
                  </button>
                </div>
                <label className="field">
                  Manual reference
                  <input
                    onChange={(event) => setManualReference(event.target.value)}
                    placeholder="PAYHERE-REFUND-12345"
                    value={manualReference}
                  />
                </label>
                <label className="field">
                  Manual reason
                  <textarea
                    onChange={(event) => setManualReason(event.target.value)}
                    placeholder="Refund completed manually in merchant portal"
                    value={manualReason}
                  />
                </label>
                <label className="field">
                  Refunded at
                  <input
                    onChange={(event) => setManualRefundedAt(event.target.value)}
                    type="datetime-local"
                    value={manualRefundedAt}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={isLoading}
                  onClick={() => void markManual()}
                  type="button"
                >
                  Mark manual
                </button>
              </div>

              <div className="refund-action-panel">
                <label className="field">
                  Reconciliation reason
                  <input
                    onChange={(event) => setReconciliationReason(event.target.value)}
                    placeholder="Provider status could not be verified"
                    value={reconciliationReason}
                  />
                </label>
                <label className="field">
                  Reconciliation notes
                  <textarea
                    onChange={(event) => setReconciliationNotes(event.target.value)}
                    placeholder="Merchant portal must be checked manually"
                    value={reconciliationNotes}
                  />
                </label>
              </div>

              <div>
                <h4>Provider response</h4>
                <pre className="json-preview">{formatJson(activeRefund.providerResponse)}</pre>
              </div>

              {activeRefund.statusHistory?.length ? (
                <div>
                  <h4>Status history</h4>
                  <div className="refund-timeline">
                    {activeRefund.statusHistory.map((entry) => (
                      <span key={entry.id}>
                        <strong>{humanize(entry.toStatus)}</strong>
                        <small>
                          {entry.fromStatus ? `${humanize(entry.fromStatus)} -> ` : ""}
                          {formatDateTime(entry.createdAt)}
                          {entry.actor?.name ? ` by ${entry.actor.name}` : ""}
                        </small>
                        {entry.reason ? <small>{entry.reason}</small> : null}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <span className="empty-state">Select a refund to recover</span>
          )}
        </div>
      </div>
    </section>
  );
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatMoney(amountMinor: string, currency: string) {
  const amount = Number(BigInt(amountMinor)) / 100;

  return new Intl.NumberFormat("en", {
    style: "currency",
    currency
  }).format(amount);
}

function formatJson(value: unknown) {
  if (value === null || value === undefined) {
    return "{}";
  }

  return JSON.stringify(value, null, 2);
}
