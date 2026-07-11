"use client";

import { useMemo, useState, type FormEvent } from "react";

type QueueMode = "clinic" | "doctor";

type AppointmentOperationRecord = {
  id: string;
  appointmentNumber: string;
  status: string;
  startsAt: string;
  endsAt: string;
  serviceName: string;
  feeMinor: string;
  currency: string;
  paymentMode: string;
  attendingName: string;
  reasonForVisit: string | null;
  queueNumber: number | null;
  checkedInAt: string | null;
  completedAt: string | null;
  patient: {
    fullName: string;
    email: string | null;
    phone: string | null;
  };
  doctor: {
    fullName: string;
  };
  clinic: {
    id: string;
    name: string;
  };
  clinicLocation: {
    id: string;
    name: string | null;
    address: string;
    city: string;
    timezone: string;
  };
  payments: Array<{
    id: string;
    status: string;
    provider: string;
    amountMinor: string;
    currency: string;
    paymentMethod: string | null;
    paidAt: string | null;
  }>;
  refunds: Array<{
    id: string;
    status: string;
    amountMinor: string;
    currency: string;
    reason: string;
  }>;
};

type AppointmentsResponse = {
  appointments: AppointmentOperationRecord[];
};

type AppointmentResponse = {
  appointment: AppointmentOperationRecord;
  changed?: boolean;
};

const manageableStatuses = ["waiting", "in_progress", "completed", "no_show"] as const;
const today = new Date().toISOString().slice(0, 10);

export function AppointmentOperationsPanel({
  apiUrl,
  accessToken,
  selectedClinicId
}: {
  apiUrl: string;
  accessToken: string;
  selectedClinicId: string;
}) {
  const [mode, setMode] = useState<QueueMode>("clinic");
  const [date, setDate] = useState(today);
  const [status, setStatus] = useState("");
  const [appointments, setAppointments] = useState<AppointmentOperationRecord[]>([]);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [reason, setReason] = useState("");
  const [offlinePaymentMethod, setOfflinePaymentMethod] = useState("cash");
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null,
    [appointments, selectedAppointmentId]
  );

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
        code?: unknown;
      } | null;
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : typeof payload?.code === "string"
            ? humanize(payload.code)
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

  async function loadAppointments() {
    await runAction(async () => {
      const params = new URLSearchParams({
        date,
        limit: "100"
      });

      if (status) {
        params.set("status", status);
      }

      const path =
        mode === "doctor"
          ? `/v1/doctors/me/appointments?${params.toString()}`
          : `/v1/clinics/${selectedClinicId}/appointments?${params.toString()}`;

      if (mode === "clinic" && !selectedClinicId) {
        throw new Error("Select a clinic first");
      }

      const response = await apiRequest<AppointmentsResponse>(path);
      setAppointments(response.appointments);
      setSelectedAppointmentId((current) =>
        response.appointments.some((appointment) => appointment.id === current)
          ? current
          : (response.appointments[0]?.id ?? "")
      );
    }, "Appointments loaded");
  }

  async function updateStatus(nextStatus: (typeof manageableStatuses)[number]) {
    if (!selectedAppointment) {
      setError("Select an appointment first");
      return;
    }

    await runAction(async () => {
      const path =
        mode === "doctor"
          ? `/v1/doctors/me/appointments/${selectedAppointment.id}/status`
          : `/v1/clinics/${selectedAppointment.clinic.id}/appointments/${selectedAppointment.id}/status`;
      const response = await apiRequest<AppointmentResponse>(path, {
        method: "PATCH",
        body: JSON.stringify({
          status: nextStatus,
          reason: reason || null
        })
      });

      replaceAppointment(response.appointment);
    }, `Appointment moved to ${humanize(nextStatus)}`);
  }

  async function checkInAppointment() {
    if (!selectedAppointment) {
      setError("Select an appointment first");
      return;
    }

    await runAction(async () => {
      const response = await apiRequest<AppointmentResponse>(
        `/v1/clinics/${selectedAppointment.clinic.id}/appointments/${selectedAppointment.id}/check-in`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: reason || null
          })
        }
      );

      replaceAppointment(response.appointment);
    }, "Appointment checked in");
  }

  async function cancelAppointment() {
    if (!selectedAppointment) {
      setError("Select an appointment first");
      return;
    }

    if (!reason.trim()) {
      setError("Cancellation reason is required");
      return;
    }

    await runAction(async () => {
      const response = await apiRequest<AppointmentResponse>(
        `/v1/clinics/${selectedAppointment.clinic.id}/appointments/${selectedAppointment.id}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({
            reason
          })
        }
      );

      replaceAppointment(response.appointment);
    }, "Appointment cancelled");
  }

  async function recordOfflinePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedAppointment) {
      setError("Select an appointment first");
      return;
    }

    await runAction(async () => {
      const response = await apiRequest<AppointmentResponse>(
        `/v1/clinics/${selectedAppointment.clinic.id}/appointments/${selectedAppointment.id}/record-payment`,
        {
          method: "POST",
          body: JSON.stringify({
            amountMinor: selectedAppointment.feeMinor,
            paymentMethod: offlinePaymentMethod,
            reason: reason || "Payment collected at clinic"
          })
        }
      );

      replaceAppointment(response.appointment);
    }, "Offline payment recorded");
  }

  function replaceAppointment(appointment: AppointmentOperationRecord) {
    setAppointments((current) =>
      current.map((currentAppointment) =>
        currentAppointment.id === appointment.id ? appointment : currentAppointment
      )
    );
    setSelectedAppointmentId(appointment.id);
  }

  return (
    <section className="panel appointment-ops-panel" id="appointments">
      <div className="panel-header">
        <h3>Appointment operations</h3>
        <span>{appointments.length} loaded</span>
      </div>

      <div className="appointment-toolbar">
        <div className="segmented">
          <button
            className={mode === "clinic" ? "active" : ""}
            onClick={() => setMode("clinic")}
            type="button"
          >
            Clinic queue
          </button>
          <button
            className={mode === "doctor" ? "active" : ""}
            onClick={() => setMode("doctor")}
            type="button"
          >
            Doctor queue
          </button>
        </div>
        <label className="field">
          Date
          <input onChange={(event) => setDate(event.target.value)} type="date" value={date} />
        </label>
        <label className="field">
          Status
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="">Any status</option>
            <option value="confirmed">Confirmed</option>
            <option value="checked_in">Checked in</option>
            <option value="waiting">Waiting</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="no_show">No-show</option>
            <option value="cancelled_by_patient">Cancelled by patient</option>
            <option value="cancelled_by_clinic">Cancelled by clinic</option>
          </select>
        </label>
        <button className="primary-button" disabled={isLoading} onClick={() => void loadAppointments()}>
          Load
        </button>
      </div>

      {(notice || error) && (
        <div className={error ? "status-message error" : "status-message"}>{error || notice}</div>
      )}

      <div className="appointment-ops-grid">
        <div className="appointment-list">
          {appointments.map((appointment) => (
            <button
              className={
                appointment.id === selectedAppointmentId
                  ? "appointment-row selected"
                  : "appointment-row"
              }
              key={appointment.id}
              onClick={() => setSelectedAppointmentId(appointment.id)}
              type="button"
            >
              <span>
                <strong>{appointment.patient.fullName}</strong>
                <small>
                  {appointment.doctor.fullName} · {formatDateTime(appointment.startsAt)}
                </small>
                <small>
                  {appointment.serviceName} · {formatMoney(appointment.feeMinor, appointment.currency)}
                </small>
              </span>
              <span className={`status-badge status-${appointment.status}`}>
                {humanize(appointment.status)}
              </span>
            </button>
          ))}
          {appointments.length === 0 ? <span className="empty-state">No appointments loaded</span> : null}
        </div>

        <div className="appointment-detail-panel">
          {selectedAppointment ? (
            <>
              <div>
                <p className="eyebrow">{selectedAppointment.appointmentNumber}</p>
                <h4>{selectedAppointment.patient.fullName}</h4>
                <p>
                  {selectedAppointment.serviceName} with {selectedAppointment.doctor.fullName}
                </p>
              </div>
              <div className="detail-grid">
                <span>
                  <small>Time</small>
                  <strong>{formatDateTime(selectedAppointment.startsAt)}</strong>
                </span>
                <span>
                  <small>Location</small>
                  <strong>
                    {selectedAppointment.clinicLocation.name ??
                      selectedAppointment.clinicLocation.city}
                  </strong>
                </span>
                <span>
                  <small>Queue</small>
                  <strong>{selectedAppointment.queueNumber ?? "Not checked in"}</strong>
                </span>
                <span>
                  <small>Payment</small>
                  <strong>{paymentSummary(selectedAppointment)}</strong>
                </span>
              </div>
              <label className="field">
                Reason or notes
                <textarea
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Required for cancellation"
                  value={reason}
                />
              </label>
              <div className="action-row appointment-action-row">
                <button disabled={mode === "doctor"} onClick={() => void checkInAppointment()} type="button">
                  Check in
                </button>
                {manageableStatuses.map((nextStatus) => (
                  <button key={nextStatus} onClick={() => void updateStatus(nextStatus)} type="button">
                    {humanize(nextStatus)}
                  </button>
                ))}
                <button onClick={() => void cancelAppointment()} type="button">
                  Cancel
                </button>
              </div>
              <form className="offline-payment-form" onSubmit={recordOfflinePayment}>
                <label className="field">
                  Offline method
                  <select
                    onChange={(event) => setOfflinePaymentMethod(event.target.value)}
                    value={offlinePaymentMethod}
                  >
                    <option value="cash">Cash</option>
                    <option value="card_terminal">Card terminal</option>
                    <option value="bank_transfer">Bank transfer</option>
                  </select>
                </label>
                <button disabled={mode === "doctor"} type="submit">
                  Record payment
                </button>
              </form>
            </>
          ) : (
            <span className="empty-state">Select an appointment</span>
          )}
        </div>
      </div>
    </section>
  );
}

function paymentSummary(appointment: AppointmentOperationRecord) {
  const payment = appointment.payments[0];

  if (!payment) {
    return "Not recorded";
  }

  return `${humanize(payment.status)} · ${formatMoney(payment.amountMinor, payment.currency)}`;
}

function formatMoney(amountMinor: string, currency: string) {
  const amount = Number(amountMinor) / 100;

  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2
  }).format(amount);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
