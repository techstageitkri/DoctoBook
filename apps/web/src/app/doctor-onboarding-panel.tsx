"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

type DoctorStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SUSPENDED";
type ClinicAssociationStatus = "PENDING" | "APPROVED" | "REJECTED" | "REMOVED";

type Specialty = {
  id: string;
  name: string;
  slug: string;
};

type Doctor = {
  id: string;
  slug: string;
  licenseNumber: string | null;
  status: DoctorStatus;
  bio: string | null;
  qualifications: string | null;
  yearsExperience: number | null;
  languages: string[];
  rejectionReason: string | null;
  approvedByUserId: string | null;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    fullName: string;
    status: string;
  };
  specialties?: Array<{
    specialty: Specialty;
    isPrimary: boolean;
  }>;
  documents?: Array<{
    id: string;
    documentType: string;
    platformStatus: string;
    file: {
      originalFilename: string;
      mimeType: string;
      sizeBytes: string;
      visibility: string;
    };
  }>;
};

type Association = {
  id: string;
  status: ClinicAssociationStatus;
  clinicId: string;
  clinicLocationId: string;
  clinic: {
    id: string;
    name: string;
    slug: string;
  };
  clinicLocation: {
    id: string;
    name: string | null;
    address: string;
    city: string;
  };
  doctor?: Doctor;
};

type DoctorRegistrationForm = {
  email: string;
  fullName: string;
  password: string;
  licenseNumber: string;
  qualifications: string;
  bio: string;
  yearsExperience: string;
  languages: string;
  specialtyId: string;
};

const defaultDoctorForm: DoctorRegistrationForm = {
  email: "",
  fullName: "",
  password: "Password123!",
  licenseNumber: "",
  qualifications: "MBBS",
  bio: "",
  yearsExperience: "5",
  languages: "English",
  specialtyId: ""
};

export function DoctorOnboardingPanel({
  apiUrl,
  accessToken
}: {
  apiUrl: string;
  accessToken: string;
}) {
  const [doctorToken, setDoctorToken] = useState("");
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [doctorForm, setDoctorForm] = useState<DoctorRegistrationForm>(defaultDoctorForm);
  const [verificationToken, setVerificationToken] = useState("");
  const [myProfile, setMyProfile] = useState<Doctor | null>(null);
  const [doctorList, setDoctorList] = useState<Doctor[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [clinicId, setClinicId] = useState("");
  const [clinicLocationId, setClinicLocationId] = useState("");
  const [associationClinicId, setAssociationClinicId] = useState("");
  const [associations, setAssociations] = useState<Association[]>([]);
  const [documentKey, setDocumentKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const selectedDoctor = useMemo(
    () => doctorList.find((doctor) => doctor.id === selectedDoctorId) ?? doctorList[0] ?? null,
    [doctorList, selectedDoctorId]
  );

  useEffect(() => {
    const storedDoctorToken = window.localStorage.getItem("doctobook_doctor_access_token");

    if (storedDoctorToken) {
      setDoctorToken(storedDoctorToken);
    }

    void loadSpecialties();
  }, []);

  useEffect(() => {
    if (doctorToken) {
      window.localStorage.setItem("doctobook_doctor_access_token", doctorToken);
    }
  }, [doctorToken]);

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

  async function loadSpecialties() {
    const response = await publicRequest<{ specialties: Specialty[] }>("/v1/specialties");
    setSpecialties(response.specialties);
    setDoctorForm((current) => ({
      ...current,
      specialtyId: current.specialtyId || response.specialties[0]?.id || ""
    }));
  }

  async function handleRegisterDoctor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const registration = await runAction(
      () =>
        publicRequest<{ verificationToken?: string }>("/v1/auth/register/doctor", {
          method: "POST",
          body: JSON.stringify({
            email: doctorForm.email,
            fullName: doctorForm.fullName,
            password: doctorForm.password,
            licenseNumber: doctorForm.licenseNumber,
            qualifications: doctorForm.qualifications || null,
            bio: doctorForm.bio || null,
            yearsExperience: doctorForm.yearsExperience ? Number(doctorForm.yearsExperience) : null,
            languages: doctorForm.languages
              .split(",")
              .map((language) => language.trim())
              .filter(Boolean),
            specialtyIds: doctorForm.specialtyId ? [doctorForm.specialtyId] : []
          })
        }),
      "Doctor registered"
    );

    if (registration?.verificationToken) {
      setVerificationToken(registration.verificationToken);
    }
  }

  async function handleVerifyAndLogin() {
    await runAction(async () => {
      await publicRequest("/auth/email-verification/confirm", {
        method: "POST",
        body: JSON.stringify({ token: verificationToken })
      });
      const login = await publicRequest<{ accessToken: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: doctorForm.email,
          password: doctorForm.password
        })
      });
      setDoctorToken(login.accessToken);
      await loadMyProfile(login.accessToken);
    }, "Doctor verified and logged in");
  }

  async function loadMyProfile(nextToken = doctorToken) {
    const profile = await tokenRequest<Doctor>("/v1/doctors/me", nextToken);
    setMyProfile(profile);
  }

  async function handleLoadMyProfile() {
    await runAction(() => loadMyProfile(), "Doctor profile loaded");
  }

  async function handleUpdateMyProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      await tokenRequest<Doctor>("/v1/doctors/me", doctorToken, {
        method: "PATCH",
        body: JSON.stringify({
          qualifications: doctorForm.qualifications || null,
          bio: doctorForm.bio || null,
          yearsExperience: doctorForm.yearsExperience ? Number(doctorForm.yearsExperience) : null,
          languages: doctorForm.languages
            .split(",")
            .map((language) => language.trim())
            .filter(Boolean),
          specialtyIds: doctorForm.specialtyId ? [doctorForm.specialtyId] : []
        })
      });
      await loadMyProfile();
    }, "Doctor profile updated");
  }

  async function handleUploadDocument() {
    await runAction(async () => {
      await tokenRequest("/v1/doctors/me/documents", doctorToken, {
        method: "POST",
        body: JSON.stringify({
          documentType: "medical_license",
          storageProvider: "local",
          objectKey: documentKey,
          originalFilename: documentKey.split("/").pop() || "doctor-document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048
        })
      });
      setDocumentKey("");
      await loadMyProfile();
    }, "Document metadata added");
  }

  async function handleRequestAssociation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(
      () =>
        tokenRequest("/v1/doctors/me/clinic-associations", doctorToken, {
          method: "POST",
          body: JSON.stringify({
            clinicId,
            clinicLocationId,
            currency: "LKR",
            defaultSlotIntervalMinutes: 15,
            bufferMinutes: 0
          })
        }),
      "Clinic association requested"
    );
  }

  async function handleLoadDoctors() {
    const response = await runAction(
      () => tokenRequest<{ doctors: Doctor[] }>("/v1/admin/doctors", accessToken),
      "Doctors loaded"
    );

    if (response) {
      setDoctorList(response.doctors);
      setSelectedDoctorId(response.doctors[0]?.id ?? "");
    }
  }

  async function handleDoctorDecision(action: "approve" | "reject" | "suspend" | "reactivate") {
    if (!selectedDoctor) {
      setError("Select a doctor first");
      return;
    }

    await runAction(async () => {
      await tokenRequest(`/v1/admin/doctors/${selectedDoctor.id}/${action}`, accessToken, {
        method: "POST",
        body:
          action === "reject"
            ? JSON.stringify({ reason: "Information needs correction" })
            : JSON.stringify({})
      });
      await handleLoadDoctors();
    }, `Doctor ${action} completed`);
  }

  async function handleLoadAssociations() {
    const response = await runAction(
      () =>
        tokenRequest<{ associations: Association[] }>(
          `/v1/clinics/${associationClinicId}/doctor-associations`,
          accessToken
        ),
      "Clinic associations loaded"
    );

    if (response) {
      setAssociations(response.associations);
    }
  }

  async function handleAssociationDecision(associationId: string, action: "approve" | "reject") {
    await runAction(async () => {
      await tokenRequest(
        `/v1/clinics/${associationClinicId}/doctor-associations/${associationId}/${action}`,
        accessToken,
        {
          method: "POST",
          body:
            action === "reject"
              ? JSON.stringify({ reason: "Not approved for this location" })
              : JSON.stringify({})
        }
      );
      await handleLoadAssociations();
    }, `Association ${action} completed`);
  }

  return (
    <section className="doctor-workspace" id="doctors">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Doctor onboarding</p>
          <h2>Registration, verification, and clinic associations</h2>
        </div>
        <button
          className="primary-button"
          disabled={isLoading}
          onClick={handleLoadDoctors}
          type="button"
        >
          Load doctors
        </button>
      </div>

      {(notice || error) && (
        <div className={error ? "status-message error" : "status-message"} role="status">
          {error || notice}
        </div>
      )}

      <section className="content-grid">
        <form className="panel form-panel" onSubmit={handleRegisterDoctor}>
          <div className="panel-header">
            <h3>Doctor registration</h3>
          </div>
          <Field label="Email">
            <input
              onChange={(event) =>
                setDoctorForm((current) => ({ ...current, email: event.target.value }))
              }
              required
              type="email"
              value={doctorForm.email}
            />
          </Field>
          <Field label="Full name">
            <input
              onChange={(event) =>
                setDoctorForm((current) => ({ ...current, fullName: event.target.value }))
              }
              required
              value={doctorForm.fullName}
            />
          </Field>
          <div className="field-row">
            <Field label="Password">
              <input
                onChange={(event) =>
                  setDoctorForm((current) => ({ ...current, password: event.target.value }))
                }
                required
                type="password"
                value={doctorForm.password}
              />
            </Field>
            <Field label="License">
              <input
                onChange={(event) =>
                  setDoctorForm((current) => ({ ...current, licenseNumber: event.target.value }))
                }
                required
                value={doctorForm.licenseNumber}
              />
            </Field>
          </div>
          <Field label="Specialty">
            <select
              onChange={(event) =>
                setDoctorForm((current) => ({ ...current, specialtyId: event.target.value }))
              }
              value={doctorForm.specialtyId}
            >
              {specialties.map((specialty) => (
                <option key={specialty.id} value={specialty.id}>
                  {specialty.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="field-row">
            <Field label="Qualifications">
              <input
                onChange={(event) =>
                  setDoctorForm((current) => ({ ...current, qualifications: event.target.value }))
                }
                value={doctorForm.qualifications}
              />
            </Field>
            <Field label="Experience">
              <input
                min="0"
                onChange={(event) =>
                  setDoctorForm((current) => ({ ...current, yearsExperience: event.target.value }))
                }
                type="number"
                value={doctorForm.yearsExperience}
              />
            </Field>
          </div>
          <Field label="Languages">
            <input
              onChange={(event) =>
                setDoctorForm((current) => ({ ...current, languages: event.target.value }))
              }
              value={doctorForm.languages}
            />
          </Field>
          <Field label="Bio">
            <input
              onChange={(event) =>
                setDoctorForm((current) => ({ ...current, bio: event.target.value }))
              }
              value={doctorForm.bio}
            />
          </Field>
          <button className="primary-button" disabled={isLoading} type="submit">
            Register doctor
          </button>
        </form>

        <div className="panel form-panel">
          <div className="panel-header">
            <h3>Doctor session</h3>
          </div>
          <Field label="Verification token">
            <input
              onChange={(event) => setVerificationToken(event.target.value)}
              value={verificationToken}
            />
          </Field>
          <button
            className="primary-button"
            disabled={!verificationToken || isLoading}
            onClick={handleVerifyAndLogin}
            type="button"
          >
            Verify and login
          </button>
          <Field label="Doctor access token">
            <input
              onChange={(event) => setDoctorToken(event.target.value)}
              type="password"
              value={doctorToken}
            />
          </Field>
          <button disabled={!doctorToken || isLoading} onClick={handleLoadMyProfile} type="button">
            Load my profile
          </button>
          {myProfile && (
            <div className="profile-summary">
              <strong>{myProfile.user.fullName}</strong>
              <span>{myProfile.status}</span>
              <span>{myProfile.licenseNumber}</span>
            </div>
          )}
        </div>
      </section>

      <section className="content-grid">
        <form className="panel form-panel" onSubmit={handleUpdateMyProfile}>
          <div className="panel-header">
            <h3>Doctor profile</h3>
          </div>
          <Field label="Document object key">
            <input onChange={(event) => setDocumentKey(event.target.value)} value={documentKey} />
          </Field>
          <div className="action-row">
            <button disabled={!doctorToken || isLoading} type="submit">
              Save profile
            </button>
            <button
              disabled={!doctorToken || !documentKey || isLoading}
              onClick={handleUploadDocument}
              type="button"
            >
              Add document
            </button>
          </div>
        </form>

        <form className="panel form-panel" onSubmit={handleRequestAssociation}>
          <div className="panel-header">
            <h3>Request clinic association</h3>
          </div>
          <Field label="Clinic ID">
            <input
              onChange={(event) => setClinicId(event.target.value)}
              required
              value={clinicId}
            />
          </Field>
          <Field label="Clinic location ID">
            <input
              onChange={(event) => setClinicLocationId(event.target.value)}
              required
              value={clinicLocationId}
            />
          </Field>
          <button className="primary-button" disabled={!doctorToken || isLoading} type="submit">
            Request association
          </button>
        </form>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Admin doctor review</h3>
            <span>{doctorList.length} doctors</span>
          </div>
          <div className="compact-list">
            {doctorList.map((doctor) => (
              <button
                className={
                  doctor.id === selectedDoctor?.id ? "location-row selected" : "location-row"
                }
                key={doctor.id}
                onClick={() => setSelectedDoctorId(doctor.id)}
                type="button"
              >
                <span>
                  <strong>{doctor.user.fullName}</strong>
                  <small>{doctor.user.email}</small>
                </span>
                <StatusPill status={doctor.status} />
              </button>
            ))}
            {!doctorList.length && <span className="empty-state">No doctors loaded</span>}
          </div>
        </div>

        <div className="panel form-panel">
          <div className="panel-header">
            <h3>Verification actions</h3>
          </div>
          <div className="action-row">
            <button
              disabled={!selectedDoctor || isLoading}
              onClick={() => void handleDoctorDecision("approve")}
              type="button"
            >
              Approve
            </button>
            <button
              disabled={!selectedDoctor || isLoading}
              onClick={() => void handleDoctorDecision("reject")}
              type="button"
            >
              Reject
            </button>
            <button
              disabled={!selectedDoctor || isLoading}
              onClick={() => void handleDoctorDecision("suspend")}
              type="button"
            >
              Suspend
            </button>
            <button
              disabled={!selectedDoctor || isLoading}
              onClick={() => void handleDoctorDecision("reactivate")}
              type="button"
            >
              Reactivate
            </button>
          </div>
          {selectedDoctor && (
            <div className="profile-summary">
              <strong>{selectedDoctor.licenseNumber}</strong>
              <span>{selectedDoctor.qualifications}</span>
              <span>
                {selectedDoctor.specialties?.map((item) => item.specialty.name).join(", ")}
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="content-grid">
        <div className="panel form-panel">
          <div className="panel-header">
            <h3>Clinic associations</h3>
          </div>
          <Field label="Clinic ID">
            <input
              onChange={(event) => setAssociationClinicId(event.target.value)}
              value={associationClinicId}
            />
          </Field>
          <button
            className="primary-button"
            disabled={!associationClinicId || isLoading}
            onClick={handleLoadAssociations}
            type="button"
          >
            Load associations
          </button>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Pending requests</h3>
            <span>{associations.length} records</span>
          </div>
          <div className="compact-list">
            {associations.map((association) => (
              <div className="compact-row association-row" key={association.id}>
                <span>
                  <strong>{association.doctor?.user.fullName ?? association.id}</strong>
                  <small>
                    {association.clinicLocation.address}, {association.clinicLocation.city}
                  </small>
                </span>
                <StatusPill status={association.status} />
                <div className="action-row">
                  <button
                    disabled={isLoading}
                    onClick={() => void handleAssociationDecision(association.id, "approve")}
                    type="button"
                  >
                    Approve
                  </button>
                  <button
                    disabled={isLoading}
                    onClick={() => void handleAssociationDecision(association.id, "reject")}
                    type="button"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
            {!associations.length && <span className="empty-state">No associations loaded</span>}
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

function StatusPill({ status }: { status: DoctorStatus | ClinicAssociationStatus }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>{formatStatus(status)}</span>
  );
}

function formatStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
