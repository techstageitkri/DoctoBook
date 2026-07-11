"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AppointmentOperationsPanel } from "./appointment-operations-panel";
import { DoctorAvailabilityPanel } from "./doctor-availability-panel";
import { DoctorOnboardingPanel } from "./doctor-onboarding-panel";
import { RefundRecoveryPanel } from "./refund-recovery-panel";
import { ReviewModerationPanel } from "./review-moderation-panel";
import { ServiceConfigurationPanel } from "./service-configuration-panel";

type ClinicStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "CLOSED";
type PaymentMode = "ONLINE_REQUIRED" | "PAY_AT_CLINIC" | "ONLINE_OPTIONAL";

type ClinicLocation = {
  id: string;
  name: string | null;
  address: string;
  city: string;
  district: string | null;
  province: string | null;
  country: string;
  timezone: string;
  phone: string | null;
  isPrimary: boolean;
  status: ClinicStatus;
  deletedAt?: string | null;
  hours?: ClinicHour[];
  closures?: ClinicClosure[];
};

type ClinicHour = {
  id: string;
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

type ClinicClosure = {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

type ClinicAdmin = {
  id: string;
  userId: string;
  status: string;
  user?: {
    id: string;
    email: string | null;
    phone: string | null;
    fullName: string | null;
    status: string;
  };
};

type Clinic = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ClinicStatus;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  defaultPaymentMode: PaymentMode | null;
  cancellationWindowMinutes: number | null;
  refundProcessingDays: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  locations?: ClinicLocation[];
  admins?: ClinicAdmin[];
};

type ClinicListResponse = {
  clinics: Clinic[];
};

type LocationListResponse = {
  locations: ClinicLocation[];
};

type ClinicForm = {
  name: string;
  slug: string;
  email: string;
  phone: string;
  defaultPaymentMode: PaymentMode | "";
  cancellationWindowMinutes: string;
  refundProcessingDays: string;
};

type LocationForm = {
  name: string;
  address: string;
  city: string;
  phone: string;
  isPrimary: boolean;
};

type HoursForm = {
  dayOfWeek: string;
  firstOpensAt: string;
  firstClosesAt: string;
  secondOpensAt: string;
  secondClosesAt: string;
};

type ClosureForm = {
  startsAt: string;
  endsAt: string;
  reason: string;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const defaultClinicForm: ClinicForm = {
  name: "",
  slug: "",
  email: "",
  phone: "",
  defaultPaymentMode: "PAY_AT_CLINIC",
  cancellationWindowMinutes: "30",
  refundProcessingDays: "7"
};
const defaultLocationForm: LocationForm = {
  name: "Main Branch",
  address: "",
  city: "Colombo",
  phone: "",
  isPrimary: true
};
const defaultHoursForm: HoursForm = {
  dayOfWeek: "1",
  firstOpensAt: "09:00",
  firstClosesAt: "13:00",
  secondOpensAt: "14:00",
  secondClosesAt: "18:00"
};
const defaultClosureForm: ClosureForm = {
  startsAt: "",
  endsAt: "",
  reason: ""
};

export function ClinicAdminPortal({ apiUrl, appName }: { apiUrl: string; appName: string }) {
  const [accessToken, setAccessToken] = useState("");
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [clinicForm, setClinicForm] = useState<ClinicForm>(defaultClinicForm);
  const [locationForm, setLocationForm] = useState<LocationForm>(defaultLocationForm);
  const [hoursForm, setHoursForm] = useState<HoursForm>(defaultHoursForm);
  const [closureForm, setClosureForm] = useState<ClosureForm>(defaultClosureForm);
  const [adminUserId, setAdminUserId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedClinic = useMemo(
    () => clinics.find((clinic) => clinic.id === selectedClinicId) ?? null,
    [clinics, selectedClinicId]
  );
  const selectedLocation = useMemo(
    () => selectedClinic?.locations?.find((location) => location.id === selectedLocationId) ?? null,
    [selectedClinic, selectedLocationId]
  );
  const clinicStats = useMemo(() => {
    return {
      total: clinics.length,
      active: clinics.filter((clinic) => clinic.status === "ACTIVE").length,
      pending: clinics.filter(
        (clinic) => clinic.status === "DRAFT" || clinic.status === "PENDING_APPROVAL"
      ).length
    };
  }, [clinics]);

  useEffect(() => {
    const storedToken = window.sessionStorage.getItem("doctobook_access_token");

    if (storedToken) {
      setAccessToken(storedToken);
    }
  }, []);

  useEffect(() => {
    if (accessToken) {
      window.sessionStorage.setItem("doctobook_access_token", accessToken);
    }
  }, [accessToken]);

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

  async function refreshClinics(nextSelectedClinicId = selectedClinicId) {
    const response = await apiRequest<ClinicListResponse>("/v1/admin/clinics");
    setClinics(response.clinics);

    const nextSelected =
      response.clinics.find((clinic) => clinic.id === nextSelectedClinicId) ??
      response.clinics[0] ??
      null;

    if (nextSelected) {
      setSelectedClinicId(nextSelected.id);
      await loadClinicDetails(nextSelected.id, false);
    } else {
      setSelectedClinicId("");
      setSelectedLocationId("");
    }
  }

  async function loadClinicDetails(clinicId: string, showStatus = true) {
    const clinic = await apiRequest<Clinic>(`/v1/admin/clinics/${clinicId}`);
    const locationsResponse = await apiRequest<LocationListResponse>(
      `/v1/clinics/${clinicId}/locations`
    );

    setClinics((currentClinics) => {
      const clinicExists = currentClinics.some((currentClinic) => currentClinic.id === clinic.id);
      const nextClinic = {
        ...clinic,
        locations: clinic.locations?.length ? clinic.locations : locationsResponse.locations
      };

      if (!clinicExists) {
        return [nextClinic, ...currentClinics];
      }

      return currentClinics.map((currentClinic) =>
        currentClinic.id === clinic.id ? nextClinic : currentClinic
      );
    });

    setSelectedClinicId(clinic.id);
    setSelectedLocationId((currentLocationId) => {
      const currentLocationStillExists = locationsResponse.locations.some(
        (location) => location.id === currentLocationId
      );

      return currentLocationStillExists
        ? currentLocationId
        : (locationsResponse.locations[0]?.id ?? "");
    });

    if (showStatus) {
      setNotice("Clinic details loaded");
    }
  }

  async function handleRefresh() {
    await runAction(() => refreshClinics(), "Clinics refreshed");
  }

  async function handleCreateClinic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const created = await runAction(
      () =>
        apiRequest<Clinic>("/v1/admin/clinics", {
          method: "POST",
          body: JSON.stringify({
            name: clinicForm.name,
            slug: clinicForm.slug,
            email: clinicForm.email || null,
            phone: clinicForm.phone || null,
            defaultPaymentMode: clinicForm.defaultPaymentMode || null,
            cancellationWindowMinutes: toOptionalNumber(clinicForm.cancellationWindowMinutes),
            refundProcessingDays: toOptionalNumber(clinicForm.refundProcessingDays)
          })
        }),
      "Clinic created"
    );

    if (created) {
      setClinicForm(defaultClinicForm);
      await refreshClinics(created.id);
    }
  }

  async function handleStatusChange(status: ClinicStatus) {
    if (!selectedClinic) {
      return;
    }

    await runAction(
      async () => {
        await apiRequest<Clinic>(`/v1/admin/clinics/${selectedClinic.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status })
        });
        await loadClinicDetails(selectedClinic.id, false);
      },
      `Clinic moved to ${status.toLowerCase().replaceAll("_", " ")}`
    );
  }

  async function handleDeleteClinic() {
    if (!selectedClinic) {
      return;
    }

    await runAction(async () => {
      await apiRequest<Clinic>(`/v1/admin/clinics/${selectedClinic.id}`, {
        method: "DELETE"
      });
      await refreshClinics();
    }, "Clinic closed");
  }

  async function handleCreateLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedClinic) {
      setError("Select a clinic first");
      return;
    }

    const created = await runAction(
      () =>
        apiRequest<ClinicLocation>(`/v1/clinics/${selectedClinic.id}/locations`, {
          method: "POST",
          body: JSON.stringify({
            name: locationForm.name || null,
            address: locationForm.address,
            city: locationForm.city,
            phone: locationForm.phone || null,
            isPrimary: locationForm.isPrimary
          })
        }),
      "Location added"
    );

    if (created) {
      setLocationForm(defaultLocationForm);
      await loadClinicDetails(selectedClinic.id, false);
      setSelectedLocationId(created.id);
    }
  }

  async function handleSetHours(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedClinic || !selectedLocation) {
      setError("Select a clinic location first");
      return;
    }

    const hours = [
      {
        dayOfWeek: Number(hoursForm.dayOfWeek),
        opensAt: hoursForm.firstOpensAt,
        closesAt: hoursForm.firstClosesAt
      }
    ];

    if (hoursForm.secondOpensAt && hoursForm.secondClosesAt) {
      hours.push({
        dayOfWeek: Number(hoursForm.dayOfWeek),
        opensAt: hoursForm.secondOpensAt,
        closesAt: hoursForm.secondClosesAt
      });
    }

    await runAction(async () => {
      await apiRequest<{ hours: ClinicHour[] }>(
        `/v1/clinics/${selectedClinic.id}/locations/${selectedLocation.id}/hours`,
        {
          method: "PUT",
          body: JSON.stringify({ hours })
        }
      );
      await loadClinicDetails(selectedClinic.id, false);
    }, "Operating hours saved");
  }

  async function handleCreateClosure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedClinic || !selectedLocation) {
      setError("Select a clinic location first");
      return;
    }

    await runAction(async () => {
      await apiRequest<ClinicClosure>(
        `/v1/clinics/${selectedClinic.id}/locations/${selectedLocation.id}/closures`,
        {
          method: "POST",
          body: JSON.stringify({
            startsAt: toIsoFromLocalDateTime(closureForm.startsAt),
            endsAt: toIsoFromLocalDateTime(closureForm.endsAt),
            reason: closureForm.reason || null
          })
        }
      );
      setClosureForm(defaultClosureForm);
      await loadClinicDetails(selectedClinic.id, false);
    }, "Closure added");
  }

  async function handleAssignAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedClinic) {
      setError("Select a clinic first");
      return;
    }

    await runAction(async () => {
      await apiRequest<ClinicAdmin>(`/v1/clinics/${selectedClinic.id}/admins`, {
        method: "POST",
        body: JSON.stringify({ userId: adminUserId })
      });
      setAdminUserId("");
      await loadClinicDetails(selectedClinic.id, false);
    }, "Clinic admin assigned");
  }

  return (
    <main className="portal-shell">
      <aside className="portal-sidebar">
        <div>
          <p className="eyebrow">Marketplace admin</p>
          <h1>{appName}</h1>
        </div>
        <nav aria-label="Admin navigation">
          <a className="nav-item active" href="#clinics">
            Clinics
          </a>
          <a className="nav-item" href="#locations">
            Locations
          </a>
          <a className="nav-item" href="#access">
            Access
          </a>
          <a className="nav-item" href="#doctors">
            Doctors
          </a>
          <a className="nav-item" href="#services">
            Services
          </a>
          <a className="nav-item" href="#availability">
            Availability
          </a>
          <a className="nav-item" href="#appointments">
            Appointments
          </a>
          <a className="nav-item" href="#reviews">
            Reviews
          </a>
          <a className="nav-item" href="#refunds">
            Refunds
          </a>
        </nav>
      </aside>

      <section className="portal-main" id="clinics">
        <header className="topbar">
          <div>
            <p className="eyebrow">Super Admin</p>
            <h2>Clinic management</h2>
          </div>
          <button
            className="primary-button"
            disabled={isLoading}
            onClick={handleRefresh}
            type="button"
          >
            Refresh
          </button>
        </header>

        <section className="auth-strip" id="access" aria-label="API access">
          <label>
            API URL
            <input readOnly value={apiUrl} />
          </label>
          <label>
            Access token
            <input
              autoComplete="off"
              onChange={(event) => setAccessToken(event.target.value)}
              type="password"
              value={accessToken}
            />
          </label>
        </section>

        {(notice || error) && (
          <div className={error ? "status-message error" : "status-message"} role="status">
            {error || notice}
          </div>
        )}

        <section className="metric-grid" aria-label="Clinic totals">
          <Metric label="Total clinics" value={clinicStats.total} />
          <Metric label="Active" value={clinicStats.active} />
          <Metric label="Draft or pending" value={clinicStats.pending} />
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-header">
              <h3>Clinic directory</h3>
              <span>{clinics.length} records</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Locations</th>
                  </tr>
                </thead>
                <tbody>
                  {clinics.map((clinic) => (
                    <tr
                      className={clinic.id === selectedClinicId ? "selected-row" : ""}
                      key={clinic.id}
                      onClick={() => void loadClinicDetails(clinic.id)}
                    >
                      <td>
                        <strong>{clinic.name}</strong>
                        <span>{clinic.slug}</span>
                      </td>
                      <td>
                        <StatusBadge status={clinic.status} />
                      </td>
                      <td>{displayPaymentMode(clinic.defaultPaymentMode)}</td>
                      <td>{clinic.locations?.length ?? 0}</td>
                    </tr>
                  ))}
                  {clinics.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <span className="empty-state">No clinics loaded</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <form className="panel form-panel" onSubmit={handleCreateClinic}>
            <div className="panel-header">
              <h3>Create clinic</h3>
            </div>
            <Field label="Name">
              <input
                onChange={(event) =>
                  setClinicForm((current) => ({ ...current, name: event.target.value }))
                }
                required
                value={clinicForm.name}
              />
            </Field>
            <Field label="Slug">
              <input
                onChange={(event) =>
                  setClinicForm((current) => ({ ...current, slug: event.target.value }))
                }
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                required
                value={clinicForm.slug}
              />
            </Field>
            <div className="field-row">
              <Field label="Email">
                <input
                  onChange={(event) =>
                    setClinicForm((current) => ({ ...current, email: event.target.value }))
                  }
                  type="email"
                  value={clinicForm.email}
                />
              </Field>
              <Field label="Phone">
                <input
                  onChange={(event) =>
                    setClinicForm((current) => ({ ...current, phone: event.target.value }))
                  }
                  value={clinicForm.phone}
                />
              </Field>
            </div>
            <Field label="Default payment">
              <select
                onChange={(event) =>
                  setClinicForm((current) => ({
                    ...current,
                    defaultPaymentMode: event.target.value as PaymentMode
                  }))
                }
                value={clinicForm.defaultPaymentMode}
              >
                <option value="PAY_AT_CLINIC">Pay at clinic</option>
                <option value="ONLINE_REQUIRED">Online required</option>
                <option value="ONLINE_OPTIONAL">Online optional</option>
              </select>
            </Field>
            <div className="field-row">
              <Field label="Cancel window">
                <input
                  min="1"
                  onChange={(event) =>
                    setClinicForm((current) => ({
                      ...current,
                      cancellationWindowMinutes: event.target.value
                    }))
                  }
                  type="number"
                  value={clinicForm.cancellationWindowMinutes}
                />
              </Field>
              <Field label="Refund days">
                <input
                  min="1"
                  onChange={(event) =>
                    setClinicForm((current) => ({
                      ...current,
                      refundProcessingDays: event.target.value
                    }))
                  }
                  type="number"
                  value={clinicForm.refundProcessingDays}
                />
              </Field>
            </div>
            <button className="primary-button" disabled={isLoading} type="submit">
              Create clinic
            </button>
          </form>
        </section>

        <section className="detail-band">
          <div className="detail-summary">
            <div>
              <p className="eyebrow">Selected clinic</p>
              <h3>{selectedClinic?.name ?? "None selected"}</h3>
              {selectedClinic && <span>{selectedClinic.slug}</span>}
            </div>
            {selectedClinic && <StatusBadge status={selectedClinic.status} />}
          </div>

          <div className="action-row">
            <button
              disabled={!selectedClinic || isLoading}
              onClick={() => void handleStatusChange("ACTIVE")}
              type="button"
            >
              Activate
            </button>
            <button
              disabled={!selectedClinic || isLoading}
              onClick={() => void handleStatusChange("SUSPENDED")}
              type="button"
            >
              Suspend
            </button>
            <button
              className="danger-button"
              disabled={!selectedClinic || isLoading}
              onClick={() => void handleDeleteClinic()}
              type="button"
            >
              Close clinic
            </button>
          </div>
        </section>

        <section className="content-grid" id="locations">
          <div className="panel">
            <div className="panel-header">
              <h3>Locations</h3>
              <span>{selectedClinic?.locations?.length ?? 0} active</span>
            </div>
            <div className="location-list">
              {(selectedClinic?.locations ?? []).map((location) => (
                <button
                  className={
                    location.id === selectedLocationId ? "location-row selected" : "location-row"
                  }
                  key={location.id}
                  onClick={() => setSelectedLocationId(location.id)}
                  type="button"
                >
                  <span>
                    <strong>{location.name ?? "Clinic location"}</strong>
                    <small>
                      {location.address}, {location.city}
                    </small>
                  </span>
                  {location.isPrimary && <span className="small-pill">Primary</span>}
                </button>
              ))}
              {!selectedClinic?.locations?.length && (
                <span className="empty-state">No active locations</span>
              )}
            </div>
          </div>

          <form className="panel form-panel" onSubmit={handleCreateLocation}>
            <div className="panel-header">
              <h3>Add location</h3>
            </div>
            <Field label="Name">
              <input
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, name: event.target.value }))
                }
                value={locationForm.name}
              />
            </Field>
            <Field label="Address">
              <input
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, address: event.target.value }))
                }
                required
                value={locationForm.address}
              />
            </Field>
            <div className="field-row">
              <Field label="City">
                <input
                  onChange={(event) =>
                    setLocationForm((current) => ({ ...current, city: event.target.value }))
                  }
                  required
                  value={locationForm.city}
                />
              </Field>
              <Field label="Phone">
                <input
                  onChange={(event) =>
                    setLocationForm((current) => ({ ...current, phone: event.target.value }))
                  }
                  value={locationForm.phone}
                />
              </Field>
            </div>
            <label className="checkbox-field">
              <input
                checked={locationForm.isPrimary}
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, isPrimary: event.target.checked }))
                }
                type="checkbox"
              />
              Primary location
            </label>
            <button
              className="primary-button"
              disabled={!selectedClinic || isLoading}
              type="submit"
            >
              Add location
            </button>
          </form>
        </section>

        <section className="content-grid">
          <form className="panel form-panel" onSubmit={handleSetHours}>
            <div className="panel-header">
              <h3>Operating hours</h3>
            </div>
            <Field label="Weekday">
              <select
                onChange={(event) =>
                  setHoursForm((current) => ({ ...current, dayOfWeek: event.target.value }))
                }
                value={hoursForm.dayOfWeek}
              >
                {weekdays.map((weekday, index) => (
                  <option key={weekday} value={index}>
                    {weekday}
                  </option>
                ))}
              </select>
            </Field>
            <div className="field-row">
              <Field label="Opens">
                <input
                  onChange={(event) =>
                    setHoursForm((current) => ({ ...current, firstOpensAt: event.target.value }))
                  }
                  required
                  type="time"
                  value={hoursForm.firstOpensAt}
                />
              </Field>
              <Field label="Closes">
                <input
                  onChange={(event) =>
                    setHoursForm((current) => ({ ...current, firstClosesAt: event.target.value }))
                  }
                  required
                  type="time"
                  value={hoursForm.firstClosesAt}
                />
              </Field>
            </div>
            <div className="field-row">
              <Field label="Second opens">
                <input
                  onChange={(event) =>
                    setHoursForm((current) => ({ ...current, secondOpensAt: event.target.value }))
                  }
                  type="time"
                  value={hoursForm.secondOpensAt}
                />
              </Field>
              <Field label="Second closes">
                <input
                  onChange={(event) =>
                    setHoursForm((current) => ({ ...current, secondClosesAt: event.target.value }))
                  }
                  type="time"
                  value={hoursForm.secondClosesAt}
                />
              </Field>
            </div>
            <button
              className="primary-button"
              disabled={!selectedLocation || isLoading}
              type="submit"
            >
              Save hours
            </button>
          </form>

          <form className="panel form-panel" onSubmit={handleCreateClosure}>
            <div className="panel-header">
              <h3>Exceptional closure</h3>
            </div>
            <Field label="Starts">
              <input
                onChange={(event) =>
                  setClosureForm((current) => ({ ...current, startsAt: event.target.value }))
                }
                required
                type="datetime-local"
                value={closureForm.startsAt}
              />
            </Field>
            <Field label="Ends">
              <input
                onChange={(event) =>
                  setClosureForm((current) => ({ ...current, endsAt: event.target.value }))
                }
                required
                type="datetime-local"
                value={closureForm.endsAt}
              />
            </Field>
            <Field label="Reason">
              <input
                onChange={(event) =>
                  setClosureForm((current) => ({ ...current, reason: event.target.value }))
                }
                value={closureForm.reason}
              />
            </Field>
            <button
              className="primary-button"
              disabled={!selectedLocation || isLoading}
              type="submit"
            >
              Add closure
            </button>
          </form>
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="panel-header">
              <h3>Current hours</h3>
              <span>{selectedLocation?.name ?? "No location"}</span>
            </div>
            <div className="compact-list">
              {(selectedLocation?.hours ?? []).map((hour) => (
                <div className="compact-row" key={hour.id}>
                  <strong>{weekdays[hour.dayOfWeek]}</strong>
                  <span>
                    {hour.isClosed
                      ? "Closed"
                      : `${formatTime(hour.opensAt)} - ${formatTime(hour.closesAt)}`}
                  </span>
                </div>
              ))}
              {!selectedLocation?.hours?.length && (
                <span className="empty-state">No hours set</span>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3>Closures</h3>
              <span>{selectedLocation?.closures?.length ?? 0} scheduled</span>
            </div>
            <div className="compact-list">
              {(selectedLocation?.closures ?? []).map((closure) => (
                <div className="compact-row" key={closure.id}>
                  <strong>{formatDateTime(closure.startsAt)}</strong>
                  <span>{closure.reason ?? "Closure"}</span>
                </div>
              ))}
              {!selectedLocation?.closures?.length && (
                <span className="empty-state">No closures scheduled</span>
              )}
            </div>
          </div>
        </section>

        <section className="content-grid">
          <form className="panel form-panel" onSubmit={handleAssignAdmin}>
            <div className="panel-header">
              <h3>Clinic admins</h3>
            </div>
            <Field label="User ID">
              <input
                onChange={(event) => setAdminUserId(event.target.value)}
                required
                value={adminUserId}
              />
            </Field>
            <button
              className="primary-button"
              disabled={!selectedClinic || isLoading}
              type="submit"
            >
              Assign admin
            </button>
          </form>

          <div className="panel">
            <div className="panel-header">
              <h3>Assigned admins</h3>
              <span>{selectedClinic?.admins?.length ?? 0} approved</span>
            </div>
            <div className="compact-list">
              {(selectedClinic?.admins ?? []).map((admin) => (
                <div className="compact-row" key={admin.id}>
                  <strong>{admin.user?.fullName ?? admin.userId}</strong>
                  <span>{admin.user?.email ?? admin.status}</span>
                </div>
              ))}
              {!selectedClinic?.admins?.length && (
                <span className="empty-state">No admins assigned</span>
              )}
            </div>
          </div>
        </section>

        <DoctorOnboardingPanel apiUrl={apiUrl} accessToken={accessToken} />
        <ServiceConfigurationPanel
          apiUrl={apiUrl}
          accessToken={accessToken}
          selectedClinicId={selectedClinicId}
        />
        <DoctorAvailabilityPanel
          apiUrl={apiUrl}
          accessToken={accessToken}
          selectedClinicId={selectedClinicId}
        />
        <AppointmentOperationsPanel
          apiUrl={apiUrl}
          accessToken={accessToken}
          selectedClinicId={selectedClinicId}
        />
        <ReviewModerationPanel apiUrl={apiUrl} accessToken={accessToken} />
        <RefundRecoveryPanel apiUrl={apiUrl} accessToken={accessToken} />
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: ClinicStatus }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>{formatStatus(status)}</span>
  );
}

function displayPaymentMode(mode: PaymentMode | null) {
  if (!mode) {
    return "Platform default";
  }

  return mode
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStatus(status: ClinicStatus) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTime(value: string | null) {
  if (!value) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit"
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
