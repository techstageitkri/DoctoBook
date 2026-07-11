"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

type AvailabilityRule = {
  id: string;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  slotIntervalMinutes: number | null;
  maxPatients: number;
  isActive: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  breaks: AvailabilityBreak[];
};

type AvailabilityBreak = {
  id: string;
  ruleId: string;
  startsAt: string;
  endsAt: string;
};

type ClinicClosure = {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

type DoctorTimeOff = {
  id: string;
  doctorClinicId: string;
  doctorClinicServiceId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

type AvailabilityForm = {
  dayOfWeek: string;
  startsAt: string;
  endsAt: string;
  slotIntervalMinutes: string;
  maxPatients: string;
};

type BreakForm = {
  startsAt: string;
  endsAt: string;
};

type TimeOffForm = {
  startsAt: string;
  endsAt: string;
  doctorClinicServiceId: string;
  reason: string;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const defaultAvailabilityForm: AvailabilityForm = {
  dayOfWeek: "1",
  startsAt: "09:00",
  endsAt: "13:00",
  slotIntervalMinutes: "15",
  maxPatients: "1"
};
const defaultBreakForm: BreakForm = {
  startsAt: "12:00",
  endsAt: "12:30"
};
const defaultTimeOffForm: TimeOffForm = {
  startsAt: "",
  endsAt: "",
  doctorClinicServiceId: "",
  reason: ""
};

export function DoctorAvailabilityPanel({
  apiUrl,
  accessToken,
  selectedClinicId
}: {
  apiUrl: string;
  accessToken: string;
  selectedClinicId: string;
}) {
  const [doctorToken, setDoctorToken] = useState("");
  const [clinicId, setClinicId] = useState(selectedClinicId);
  const [associationId, setAssociationId] = useState("");
  const [routeMode, setRouteMode] = useState<"admin" | "doctor">("admin");
  const [availabilityRules, setAvailabilityRules] = useState<AvailabilityRule[]>([]);
  const [clinicClosures, setClinicClosures] = useState<ClinicClosure[]>([]);
  const [timeOff, setTimeOff] = useState<DoctorTimeOff[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [availabilityForm, setAvailabilityForm] =
    useState<AvailabilityForm>(defaultAvailabilityForm);
  const [breakForm, setBreakForm] = useState<BreakForm>(defaultBreakForm);
  const [timeOffForm, setTimeOffForm] = useState<TimeOffForm>(defaultTimeOffForm);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const storedDoctorToken = window.localStorage.getItem("doctobook_doctor_access_token");

    if (storedDoctorToken) {
      setDoctorToken(storedDoctorToken);
    }
  }, []);

  useEffect(() => {
    setClinicId((current) => current || selectedClinicId);
  }, [selectedClinicId]);

  useEffect(() => {
    if (doctorToken) {
      window.localStorage.setItem("doctobook_doctor_access_token", doctorToken);
    }
  }, [doctorToken]);

  async function tokenRequest<T>(path: string, token: string, options: RequestInit = {}) {
    if (!token.trim()) {
      throw new Error("Access token is required");
    }

    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.trim()}`,
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

  async function loadAvailability(mode = routeMode) {
    const response =
      mode === "admin"
        ? await tokenRequest<{
            availabilityRules: AvailabilityRule[];
            clinicClosures: ClinicClosure[];
          }>(
            `/v1/clinics/${clinicId}/doctor-associations/${associationId}/availability`,
            accessToken
          )
        : await tokenRequest<{
            availabilityRules: AvailabilityRule[];
            clinicClosures: ClinicClosure[];
          }>(`/v1/doctors/me/clinic-associations/${associationId}/availability`, doctorToken);

    setRouteMode(mode);
    setAvailabilityRules(response.availabilityRules);
    setClinicClosures(response.clinicClosures);
    setSelectedRuleId((current) => current || response.availabilityRules[0]?.id || "");
  }

  async function loadTimeOff(mode = routeMode) {
    const response =
      mode === "admin"
        ? await tokenRequest<{ timeOff: DoctorTimeOff[] }>(
            `/v1/clinics/${clinicId}/doctor-associations/${associationId}/time-off`,
            accessToken
          )
        : await tokenRequest<{ timeOff: DoctorTimeOff[] }>(
            `/v1/doctors/me/clinic-associations/${associationId}/time-off`,
            doctorToken
          );

    setRouteMode(mode);
    setTimeOff(response.timeOff);
  }

  async function handleLoad(mode: "admin" | "doctor") {
    await runAction(async () => {
      await loadAvailability(mode);
      await loadTimeOff(mode);
    }, "Availability loaded");
  }

  async function handleCreateAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const path =
      routeMode === "admin"
        ? `/v1/clinics/${clinicId}/doctor-associations/${associationId}/availability`
        : `/v1/doctors/me/clinic-associations/${associationId}/availability`;
    const token = routeMode === "admin" ? accessToken : doctorToken;

    const created = await runAction(
      () =>
        tokenRequest<AvailabilityRule>(path, token, {
          method: "POST",
          body: JSON.stringify({
            dayOfWeek: Number(availabilityForm.dayOfWeek),
            startsAt: availabilityForm.startsAt,
            endsAt: availabilityForm.endsAt,
            slotIntervalMinutes: toOptionalNumber(availabilityForm.slotIntervalMinutes),
            maxPatients: Number(availabilityForm.maxPatients),
            isActive: true
          })
        }),
      "Availability rule created"
    );

    if (created) {
      setSelectedRuleId(created.id);
      await loadAvailability();
    }
  }

  async function handleCreateBreak(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const path =
      routeMode === "admin"
        ? `/v1/clinics/${clinicId}/availability/${selectedRuleId}/breaks`
        : `/v1/doctors/me/availability/${selectedRuleId}/breaks`;
    const token = routeMode === "admin" ? accessToken : doctorToken;

    await runAction(async () => {
      await tokenRequest<AvailabilityBreak>(path, token, {
        method: "POST",
        body: JSON.stringify({
          startsAt: breakForm.startsAt,
          endsAt: breakForm.endsAt
        })
      });
      await loadAvailability();
    }, "Break added");
  }

  async function handleCreateTimeOff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const path =
      routeMode === "admin"
        ? `/v1/clinics/${clinicId}/doctor-associations/${associationId}/time-off`
        : `/v1/doctors/me/clinic-associations/${associationId}/time-off`;
    const token = routeMode === "admin" ? accessToken : doctorToken;

    await runAction(async () => {
      await tokenRequest<DoctorTimeOff>(path, token, {
        method: "POST",
        body: JSON.stringify({
          startsAt: toIsoFromLocalDateTime(timeOffForm.startsAt),
          endsAt: toIsoFromLocalDateTime(timeOffForm.endsAt),
          doctorClinicServiceId: timeOffForm.doctorClinicServiceId || null,
          reason: timeOffForm.reason || null
        })
      });
      setTimeOffForm(defaultTimeOffForm);
      await loadTimeOff();
    }, "Time off added");
  }

  async function toggleRule(rule: AvailabilityRule) {
    const path =
      routeMode === "admin"
        ? `/v1/clinics/${clinicId}/availability/${rule.id}`
        : `/v1/doctors/me/availability/${rule.id}`;
    const token = routeMode === "admin" ? accessToken : doctorToken;

    await runAction(async () => {
      await tokenRequest<AvailabilityRule>(path, token, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !rule.isActive })
      });
      await loadAvailability();
    }, rule.isActive ? "Availability disabled" : "Availability enabled");
  }

  return (
    <section className="availability-workspace" id="availability">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Doctor availability</p>
          <h2>Recurring schedules, breaks, and time off</h2>
        </div>
        <div className="action-row">
          <button
            className="primary-button"
            disabled={!clinicId || !associationId || isLoading}
            onClick={() => void handleLoad("admin")}
            type="button"
          >
            Load as admin
          </button>
          <button
            disabled={!doctorToken || !associationId || isLoading}
            onClick={() => void handleLoad("doctor")}
            type="button"
          >
            Load as doctor
          </button>
        </div>
      </div>

      {(notice || error) && (
        <div className={error ? "status-message error" : "status-message"} role="status">
          {error || notice}
        </div>
      )}

      <section className="content-grid">
        <form className="panel form-panel" onSubmit={handleCreateAvailability}>
          <div className="panel-header">
            <h3>Create availability</h3>
            <span>{routeMode}</span>
          </div>
          <Field label="Clinic ID">
            <input onChange={(event) => setClinicId(event.target.value)} value={clinicId} />
          </Field>
          <Field label="Doctor-clinic association ID">
            <input onChange={(event) => setAssociationId(event.target.value)} value={associationId} />
          </Field>
          <Field label="Doctor access token">
            <input
              onChange={(event) => setDoctorToken(event.target.value)}
              type="password"
              value={doctorToken}
            />
          </Field>
          <Field label="Weekday">
            <select
              onChange={(event) =>
                setAvailabilityForm((current) => ({
                  ...current,
                  dayOfWeek: event.target.value
                }))
              }
              value={availabilityForm.dayOfWeek}
            >
              {weekdays.map((weekday, index) => (
                <option key={weekday} value={index}>
                  {weekday}
                </option>
              ))}
            </select>
          </Field>
          <div className="field-row">
            <Field label="Starts">
              <input
                onChange={(event) =>
                  setAvailabilityForm((current) => ({
                    ...current,
                    startsAt: event.target.value
                  }))
                }
                required
                type="time"
                value={availabilityForm.startsAt}
              />
            </Field>
            <Field label="Ends">
              <input
                onChange={(event) =>
                  setAvailabilityForm((current) => ({ ...current, endsAt: event.target.value }))
                }
                required
                type="time"
                value={availabilityForm.endsAt}
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Slot interval">
              <input
                min="1"
                onChange={(event) =>
                  setAvailabilityForm((current) => ({
                    ...current,
                    slotIntervalMinutes: event.target.value
                  }))
                }
                type="number"
                value={availabilityForm.slotIntervalMinutes}
              />
            </Field>
            <Field label="Max patients">
              <input
                min="1"
                onChange={(event) =>
                  setAvailabilityForm((current) => ({
                    ...current,
                    maxPatients: event.target.value
                  }))
                }
                type="number"
                value={availabilityForm.maxPatients}
              />
            </Field>
          </div>
          <button className="primary-button" disabled={!associationId || isLoading} type="submit">
            Create rule
          </button>
        </form>

        <div className="panel">
          <div className="panel-header">
            <h3>Availability rules</h3>
            <span>{availabilityRules.length} rules</span>
          </div>
          <div className="compact-list">
            {availabilityRules.map((rule) => (
              <button
                className={rule.id === selectedRuleId ? "location-row selected" : "location-row"}
                key={rule.id}
                onClick={() => setSelectedRuleId(rule.id)}
                type="button"
              >
                <span>
                  <strong>
                    {weekdays[rule.dayOfWeek]} {formatTime(rule.startsAt)} -{" "}
                    {formatTime(rule.endsAt)}
                  </strong>
                  <small>
                    {rule.slotIntervalMinutes ?? "Default"} min interval · {rule.breaks.length}{" "}
                    breaks
                  </small>
                </span>
                <span className="small-pill">{rule.isActive ? "Active" : "Inactive"}</span>
              </button>
            ))}
            {!availabilityRules.length && (
              <span className="empty-state">No availability rules loaded</span>
            )}
          </div>
          <div className="action-row">
            <button
              disabled={!selectedRuleId || isLoading}
              onClick={() => {
                const rule = availabilityRules.find((item) => item.id === selectedRuleId);

                if (rule) {
                  void toggleRule(rule);
                }
              }}
              type="button"
            >
              Toggle selected
            </button>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <form className="panel form-panel" onSubmit={handleCreateBreak}>
          <div className="panel-header">
            <h3>Add break</h3>
          </div>
          <Field label="Availability rule">
            <select
              onChange={(event) => setSelectedRuleId(event.target.value)}
              value={selectedRuleId}
            >
              {availabilityRules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {weekdays[rule.dayOfWeek]} {formatTime(rule.startsAt)} - {formatTime(rule.endsAt)}
                </option>
              ))}
            </select>
          </Field>
          <div className="field-row">
            <Field label="Starts">
              <input
                onChange={(event) =>
                  setBreakForm((current) => ({ ...current, startsAt: event.target.value }))
                }
                type="time"
                value={breakForm.startsAt}
              />
            </Field>
            <Field label="Ends">
              <input
                onChange={(event) =>
                  setBreakForm((current) => ({ ...current, endsAt: event.target.value }))
                }
                type="time"
                value={breakForm.endsAt}
              />
            </Field>
          </div>
          <button className="primary-button" disabled={!selectedRuleId || isLoading} type="submit">
            Add break
          </button>
        </form>

        <form className="panel form-panel" onSubmit={handleCreateTimeOff}>
          <div className="panel-header">
            <h3>Add time off</h3>
          </div>
          <Field label="Starts">
            <input
              onChange={(event) =>
                setTimeOffForm((current) => ({ ...current, startsAt: event.target.value }))
              }
              required
              type="datetime-local"
              value={timeOffForm.startsAt}
            />
          </Field>
          <Field label="Ends">
            <input
              onChange={(event) =>
                setTimeOffForm((current) => ({ ...current, endsAt: event.target.value }))
              }
              required
              type="datetime-local"
              value={timeOffForm.endsAt}
            />
          </Field>
          <Field label="Doctor-clinic service ID">
            <input
              onChange={(event) =>
                setTimeOffForm((current) => ({
                  ...current,
                  doctorClinicServiceId: event.target.value
                }))
              }
              value={timeOffForm.doctorClinicServiceId}
            />
          </Field>
          <Field label="Reason">
            <input
              onChange={(event) =>
                setTimeOffForm((current) => ({ ...current, reason: event.target.value }))
              }
              value={timeOffForm.reason}
            />
          </Field>
          <button className="primary-button" disabled={!associationId || isLoading} type="submit">
            Add time off
          </button>
        </form>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Time off</h3>
            <span>{timeOff.length} records</span>
          </div>
          <div className="compact-list">
            {timeOff.map((item) => (
              <div className="compact-row" key={item.id}>
                <span>
                  <strong>{formatDateTime(item.startsAt)}</strong>
                  <small>{formatDateTime(item.endsAt)}</small>
                </span>
                <span>{item.reason ?? "Unavailable"}</span>
              </div>
            ))}
            {!timeOff.length && <span className="empty-state">No time off loaded</span>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Clinic closures</h3>
            <span>{clinicClosures.length} upcoming</span>
          </div>
          <div className="compact-list">
            {clinicClosures.map((closure) => (
              <div className="compact-row" key={closure.id}>
                <span>
                  <strong>{formatDateTime(closure.startsAt)}</strong>
                  <small>{formatDateTime(closure.endsAt)}</small>
                </span>
                <span>{closure.reason ?? "Closure"}</span>
              </div>
            ))}
            {!clinicClosures.length && <span className="empty-state">No closures loaded</span>}
          </div>
        </div>
      </section>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function toOptionalNumber(value: string) {
  return value ? Number(value) : null;
}

function toIsoFromLocalDateTime(value: string) {
  return new Date(value).toISOString();
}
