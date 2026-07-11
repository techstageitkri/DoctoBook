"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

type PaymentMode = "ONLINE_REQUIRED" | "PAY_AT_CLINIC" | "ONLINE_OPTIONAL";

type MasterService = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  defaultDurationMinutes: number;
  isActive: boolean;
};

type ClinicService = {
  id: string;
  clinicId: string;
  serviceId: string;
  displayName: string | null;
  description: string | null;
  isActive: boolean;
  service: MasterService;
};

type DoctorClinicService = {
  id: string;
  doctorClinicId: string;
  clinicServiceId: string;
  durationMinutes: number;
  feeMinor: string | null;
  currency: string;
  paymentMode: PaymentMode | null;
  effectivePaymentMode: PaymentMode;
  cancellationWindowMinutes: number | null;
  rescheduleWindowMinutes: number | null;
  maxReschedules: number | null;
  isActive: boolean;
  clinicService: ClinicService;
};

type MasterServiceForm = {
  name: string;
  slug: string;
  description: string;
  defaultDurationMinutes: string;
};

type ClinicServiceForm = {
  serviceId: string;
  displayName: string;
};

type DoctorServiceForm = {
  clinicServiceId: string;
  durationMinutes: string;
  feeMinor: string;
  currency: string;
  paymentMode: PaymentMode | "";
  cancellationWindowMinutes: string;
  rescheduleWindowMinutes: string;
  maxReschedules: string;
};

const defaultMasterForm: MasterServiceForm = {
  name: "",
  slug: "",
  description: "",
  defaultDurationMinutes: "30"
};

const defaultClinicServiceForm: ClinicServiceForm = {
  serviceId: "",
  displayName: ""
};

const defaultDoctorServiceForm: DoctorServiceForm = {
  clinicServiceId: "",
  durationMinutes: "30",
  feeMinor: "250000",
  currency: "LKR",
  paymentMode: "",
  cancellationWindowMinutes: "30",
  rescheduleWindowMinutes: "30",
  maxReschedules: "2"
};

export function ServiceConfigurationPanel({
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
  const [masterServices, setMasterServices] = useState<MasterService[]>([]);
  const [clinicServices, setClinicServices] = useState<ClinicService[]>([]);
  const [doctorServices, setDoctorServices] = useState<DoctorClinicService[]>([]);
  const [doctorServicesMode, setDoctorServicesMode] = useState<"admin" | "doctor">("admin");
  const [masterForm, setMasterForm] = useState<MasterServiceForm>(defaultMasterForm);
  const [clinicServiceForm, setClinicServiceForm] =
    useState<ClinicServiceForm>(defaultClinicServiceForm);
  const [doctorServiceForm, setDoctorServiceForm] =
    useState<DoctorServiceForm>(defaultDoctorServiceForm);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const activeClinicServices = useMemo(
    () => clinicServices.filter((clinicService) => clinicService.isActive),
    [clinicServices]
  );

  useEffect(() => {
    const storedDoctorToken = window.sessionStorage.getItem("doctobook_doctor_access_token");

    if (storedDoctorToken) {
      setDoctorToken(storedDoctorToken);
    }

    void loadMasterServices();
  }, []);

  useEffect(() => {
    setClinicId((current) => current || selectedClinicId);
  }, [selectedClinicId]);

  useEffect(() => {
    if (doctorToken) {
      window.sessionStorage.setItem("doctobook_doctor_access_token", doctorToken);
    }
  }, [doctorToken]);

  useEffect(() => {
    setClinicServiceForm((current) => ({
      ...current,
      serviceId: current.serviceId || masterServices[0]?.id || ""
    }));
  }, [masterServices]);

  useEffect(() => {
    setDoctorServiceForm((current) => ({
      ...current,
      clinicServiceId: current.clinicServiceId || activeClinicServices[0]?.id || ""
    }));
  }, [activeClinicServices]);

  async function publicRequest<T>(path: string, options: RequestInit = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      }
    });

    return parseResponse<T>(response);
  }

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

    return parseResponse<T>(response);
  }

  async function parseResponse<T>(response: Response) {
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

  async function loadMasterServices() {
    const response = await publicRequest<{ services: MasterService[] }>("/v1/services");
    setMasterServices(response.services);
  }

  async function handleCreateMasterService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const created = await runAction(
      () =>
        tokenRequest<MasterService>("/v1/admin/services", accessToken, {
          method: "POST",
          body: JSON.stringify({
            name: masterForm.name,
            slug: masterForm.slug,
            description: masterForm.description || null,
            defaultDurationMinutes: Number(masterForm.defaultDurationMinutes),
            isActive: true
          })
        }),
      "Master service created"
    );

    if (created) {
      setMasterForm(defaultMasterForm);
      await loadMasterServices();
    }
  }

  async function loadClinicServices(showStatus = true) {
    if (!clinicId) {
      setError("Clinic ID is required");
      return;
    }

    const response = await tokenRequest<{ clinicServices: ClinicService[] }>(
      `/v1/clinics/${clinicId}/services`,
      accessToken
    );
    setClinicServices(response.clinicServices);

    if (showStatus) {
      setNotice("Clinic services loaded");
    }
  }

  async function handleLoadClinicServices() {
    await runAction(() => loadClinicServices(false), "Clinic services loaded");
  }

  async function handleCreateClinicService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const created = await runAction(
      () =>
        tokenRequest<ClinicService>(`/v1/clinics/${clinicId}/services`, accessToken, {
          method: "POST",
          body: JSON.stringify({
            serviceId: clinicServiceForm.serviceId,
            displayName: clinicServiceForm.displayName || null,
            isActive: true
          })
        }),
      "Clinic service enabled"
    );

    if (created) {
      setClinicServiceForm((current) => ({ ...current, displayName: "" }));
      await loadClinicServices(false);
    }
  }

  async function toggleClinicService(clinicService: ClinicService) {
    await runAction(async () => {
      await tokenRequest<ClinicService>(
        `/v1/clinics/${clinicId}/services/${clinicService.id}`,
        accessToken,
        {
          method: "PATCH",
          body: JSON.stringify({ isActive: !clinicService.isActive })
        }
      );
      await loadClinicServices(false);
    }, clinicService.isActive ? "Clinic service deactivated" : "Clinic service activated");
  }

  async function loadDoctorServices(mode: "admin" | "doctor") {
    if (!associationId) {
      setError("Doctor-clinic association ID is required");
      return;
    }

    const response =
      mode === "admin"
        ? await tokenRequest<{ doctorClinicServices: DoctorClinicService[] }>(
            `/v1/clinics/${clinicId}/doctor-associations/${associationId}/services`,
            accessToken
          )
        : await tokenRequest<{ doctorClinicServices: DoctorClinicService[] }>(
            `/v1/doctors/me/clinic-associations/${associationId}/services`,
            doctorToken
          );

    setDoctorServices(response.doctorClinicServices);
    setDoctorServicesMode(mode);
  }

  async function handleLoadDoctorServices(mode: "admin" | "doctor") {
    await runAction(() => loadDoctorServices(mode), "Doctor services loaded");
  }

  async function handleCreateDoctorService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      clinicServiceId: doctorServiceForm.clinicServiceId,
      durationMinutes: Number(doctorServiceForm.durationMinutes),
      feeMinor: toOptionalNumber(doctorServiceForm.feeMinor),
      currency: doctorServiceForm.currency,
      paymentMode: doctorServiceForm.paymentMode || null,
      cancellationWindowMinutes: toOptionalNumber(doctorServiceForm.cancellationWindowMinutes),
      rescheduleWindowMinutes: toOptionalNumber(doctorServiceForm.rescheduleWindowMinutes),
      maxReschedules: toOptionalNumber(doctorServiceForm.maxReschedules),
      isActive: true
    };

    const created = await runAction(
      () =>
        tokenRequest<DoctorClinicService>(
          `/v1/clinics/${clinicId}/doctor-associations/${associationId}/services`,
          accessToken,
          {
            method: "POST",
            body: JSON.stringify(payload)
          }
        ),
      "Doctor service configured"
    );

    if (created) {
      await loadDoctorServices("admin");
    }
  }

  async function toggleDoctorService(doctorService: DoctorClinicService) {
    const path =
      doctorServicesMode === "admin"
        ? `/v1/clinics/${clinicId}/doctor-services/${doctorService.id}`
        : `/v1/doctors/me/clinic-services/${doctorService.id}`;
    const token = doctorServicesMode === "admin" ? accessToken : doctorToken;

    await runAction(async () => {
      await tokenRequest<DoctorClinicService>(path, token, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !doctorService.isActive })
      });
      await loadDoctorServices(doctorServicesMode);
    }, doctorService.isActive ? "Doctor service disabled" : "Doctor service enabled");
  }

  return (
    <section className="service-workspace" id="services">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Service configuration</p>
          <h2>Master, clinic, and doctor-clinic services</h2>
        </div>
        <button
          className="primary-button"
          disabled={isLoading}
          onClick={() => void loadMasterServices()}
          type="button"
        >
          Load services
        </button>
      </div>

      {(notice || error) && (
        <div className={error ? "status-message error" : "status-message"} role="status">
          {error || notice}
        </div>
      )}

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Master services</h3>
            <span>{masterServices.length} active</span>
          </div>
          <div className="compact-list">
            {masterServices.map((service) => (
              <div className="compact-row" key={service.id}>
                <span>
                  <strong>{service.name}</strong>
                  <small>
                    {service.slug} · {service.defaultDurationMinutes} min
                  </small>
                </span>
                <span className="small-pill">{service.isActive ? "Active" : "Inactive"}</span>
              </div>
            ))}
            {!masterServices.length && <span className="empty-state">No services loaded</span>}
          </div>
        </div>

        <form className="panel form-panel" onSubmit={handleCreateMasterService}>
          <div className="panel-header">
            <h3>Create master service</h3>
          </div>
          <Field label="Name">
            <input
              onChange={(event) =>
                setMasterForm((current) => ({ ...current, name: event.target.value }))
              }
              required
              value={masterForm.name}
            />
          </Field>
          <Field label="Slug">
            <input
              onChange={(event) =>
                setMasterForm((current) => ({ ...current, slug: event.target.value }))
              }
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
              value={masterForm.slug}
            />
          </Field>
          <Field label="Duration minutes">
            <input
              min="1"
              onChange={(event) =>
                setMasterForm((current) => ({
                  ...current,
                  defaultDurationMinutes: event.target.value
                }))
              }
              type="number"
              value={masterForm.defaultDurationMinutes}
            />
          </Field>
          <Field label="Description">
            <input
              onChange={(event) =>
                setMasterForm((current) => ({ ...current, description: event.target.value }))
              }
              value={masterForm.description}
            />
          </Field>
          <button className="primary-button" disabled={isLoading} type="submit">
            Create service
          </button>
        </form>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Clinic services</h3>
            <span>{clinicServices.length} enabled</span>
          </div>
          <Field label="Clinic ID">
            <input onChange={(event) => setClinicId(event.target.value)} value={clinicId} />
          </Field>
          <div className="action-row">
            <button
              className="primary-button"
              disabled={!clinicId || isLoading}
              onClick={handleLoadClinicServices}
              type="button"
            >
              Load clinic services
            </button>
          </div>
          <div className="compact-list">
            {clinicServices.map((clinicService) => (
              <div className="compact-row association-row" key={clinicService.id}>
                <span>
                  <strong>{clinicService.displayName || clinicService.service.name}</strong>
                  <small>{clinicService.service.slug}</small>
                </span>
                <span className="small-pill">{clinicService.isActive ? "Active" : "Inactive"}</span>
                <button
                  disabled={isLoading}
                  onClick={() => void toggleClinicService(clinicService)}
                  type="button"
                >
                  {clinicService.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            ))}
            {!clinicServices.length && (
              <span className="empty-state">No clinic services loaded</span>
            )}
          </div>
        </div>

        <form className="panel form-panel" onSubmit={handleCreateClinicService}>
          <div className="panel-header">
            <h3>Enable clinic service</h3>
          </div>
          <Field label="Master service">
            <select
              onChange={(event) =>
                setClinicServiceForm((current) => ({ ...current, serviceId: event.target.value }))
              }
              value={clinicServiceForm.serviceId}
            >
              {masterServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Display name">
            <input
              onChange={(event) =>
                setClinicServiceForm((current) => ({
                  ...current,
                  displayName: event.target.value
                }))
              }
              value={clinicServiceForm.displayName}
            />
          </Field>
          <button
            className="primary-button"
            disabled={!clinicId || !clinicServiceForm.serviceId || isLoading}
            type="submit"
          >
            Enable service
          </button>
        </form>
      </section>

      <section className="content-grid">
        <form className="panel form-panel" onSubmit={handleCreateDoctorService}>
          <div className="panel-header">
            <h3>Configure doctor service</h3>
          </div>
          <Field label="Doctor-clinic association ID">
            <input onChange={(event) => setAssociationId(event.target.value)} value={associationId} />
          </Field>
          <Field label="Clinic service">
            <select
              onChange={(event) =>
                setDoctorServiceForm((current) => ({
                  ...current,
                  clinicServiceId: event.target.value
                }))
              }
              value={doctorServiceForm.clinicServiceId}
            >
              {activeClinicServices.map((clinicService) => (
                <option key={clinicService.id} value={clinicService.id}>
                  {clinicService.displayName || clinicService.service.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="field-row">
            <Field label="Duration">
              <input
                min="1"
                onChange={(event) =>
                  setDoctorServiceForm((current) => ({
                    ...current,
                    durationMinutes: event.target.value
                  }))
                }
                type="number"
                value={doctorServiceForm.durationMinutes}
              />
            </Field>
            <Field label="Fee minor">
              <input
                min="0"
                onChange={(event) =>
                  setDoctorServiceForm((current) => ({ ...current, feeMinor: event.target.value }))
                }
                type="number"
                value={doctorServiceForm.feeMinor}
              />
            </Field>
          </div>
          <div className="field-row">
            <Field label="Currency">
              <input
                maxLength={3}
                minLength={3}
                onChange={(event) =>
                  setDoctorServiceForm((current) => ({ ...current, currency: event.target.value }))
                }
                value={doctorServiceForm.currency}
              />
            </Field>
            <Field label="Payment mode">
              <select
                onChange={(event) =>
                  setDoctorServiceForm((current) => ({
                    ...current,
                    paymentMode: event.target.value as PaymentMode | ""
                  }))
                }
                value={doctorServiceForm.paymentMode}
              >
                <option value="">Inherit</option>
                <option value="PAY_AT_CLINIC">Pay at clinic</option>
                <option value="ONLINE_REQUIRED">Online required</option>
                <option value="ONLINE_OPTIONAL">Online optional</option>
              </select>
            </Field>
          </div>
          <div className="field-row">
            <Field label="Cancel window">
              <input
                min="1"
                onChange={(event) =>
                  setDoctorServiceForm((current) => ({
                    ...current,
                    cancellationWindowMinutes: event.target.value
                  }))
                }
                type="number"
                value={doctorServiceForm.cancellationWindowMinutes}
              />
            </Field>
            <Field label="Reschedule window">
              <input
                min="1"
                onChange={(event) =>
                  setDoctorServiceForm((current) => ({
                    ...current,
                    rescheduleWindowMinutes: event.target.value
                  }))
                }
                type="number"
                value={doctorServiceForm.rescheduleWindowMinutes}
              />
            </Field>
          </div>
          <Field label="Max reschedules">
            <input
              min="0"
              onChange={(event) =>
                setDoctorServiceForm((current) => ({
                  ...current,
                  maxReschedules: event.target.value
                }))
              }
              type="number"
              value={doctorServiceForm.maxReschedules}
            />
          </Field>
          <button
            className="primary-button"
            disabled={!clinicId || !associationId || !doctorServiceForm.clinicServiceId || isLoading}
            type="submit"
          >
            Configure service
          </button>
        </form>

        <div className="panel form-panel">
          <div className="panel-header">
            <h3>Doctor services</h3>
            <span>{doctorServices.length} configured</span>
          </div>
          <Field label="Doctor access token">
            <input
              onChange={(event) => setDoctorToken(event.target.value)}
              type="password"
              value={doctorToken}
            />
          </Field>
          <div className="action-row">
            <button
              disabled={!clinicId || !associationId || isLoading}
              onClick={() => void handleLoadDoctorServices("admin")}
              type="button"
            >
              Load as admin
            </button>
            <button
              disabled={!doctorToken || !associationId || isLoading}
              onClick={() => void handleLoadDoctorServices("doctor")}
              type="button"
            >
              Load as doctor
            </button>
          </div>
          <div className="compact-list">
            {doctorServices.map((doctorService) => (
              <div className="compact-row association-row" key={doctorService.id}>
                <span>
                  <strong>
                    {doctorService.clinicService.displayName ||
                      doctorService.clinicService.service.name}
                  </strong>
                  <small>
                    {doctorService.durationMinutes} min · {formatFee(doctorService.feeMinor)} ·{" "}
                    {displayPaymentMode(doctorService.effectivePaymentMode)}
                  </small>
                </span>
                <span className="small-pill">{doctorService.isActive ? "Active" : "Inactive"}</span>
                <button
                  disabled={isLoading}
                  onClick={() => void toggleDoctorService(doctorService)}
                  type="button"
                >
                  {doctorService.isActive ? "Disable" : "Enable"}
                </button>
              </div>
            ))}
            {!doctorServices.length && (
              <span className="empty-state">No doctor services loaded</span>
            )}
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

function displayPaymentMode(mode: PaymentMode | null) {
  if (!mode) {
    return "Inherit";
  }

  return mode
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatFee(value: string | null) {
  return value === null ? "Inherited fee" : value;
}

function toOptionalNumber(value: string) {
  return value ? Number(value) : null;
}
