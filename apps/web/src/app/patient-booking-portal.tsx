"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  CreditCard,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  Star,
  UserRound,
  X
} from "lucide-react";
import {
  canCancelRescheduleRequest,
  canPatientCancel,
  canPatientReschedule,
  canPatientReview
} from "./patient/patient-domain";

type ViewMode = "dashboard" | "search" | "booking" | "payment" | "appointments" | "payments" | "reviews" | "profile";
type PaymentMode = "online_required" | "pay_at_clinic" | "online_optional";

type Specialty = {
  id: string;
  name: string;
};

type MasterService = {
  id: string;
  name: string;
  defaultDurationMinutes: number;
};

type DoctorSummary = {
  id: string;
  slug: string;
  fullName: string;
  bio: string | null;
  qualifications: string | null;
  yearsExperience: number | null;
  languages: string[];
  specialties: Specialty[];
  ratingSummary: {
    averageRating: number;
    reviewCount: number;
  };
  clinics: DoctorClinicSummary[];
};

type DoctorDetail = DoctorSummary & {
  services: DoctorService[];
};

type DoctorClinicSummary = {
  doctorClinicId: string;
  clinicId: string;
  clinicSlug: string;
  clinicName: string;
  clinicLocationId: string;
  clinicLocationName: string | null;
  location: {
    address: string;
    city: string;
    timezone: string;
  };
};

type DoctorService = {
  doctorClinicId: string;
  clinicId: string;
  clinicSlug: string;
  clinicName: string;
  clinicLocationId: string;
  clinicLocationName: string | null;
  doctorClinicServiceId: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  feeMinor: string;
  currency: string;
  paymentMode?: PaymentMode;
};

type AvailabilitySlot = {
  slotId: string;
  doctorClinicId: string;
  doctorClinicServiceId: string;
  startsAt: string;
  endsAt: string;
  clinicTimezone: string;
  doctorId: string;
  doctorName: string;
  clinicId: string;
  clinicName: string;
  clinicLocationId: string;
  clinicLocationName: string | null;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  feeMinor: string;
  currency: string;
  paymentMode: PaymentMode;
};

type AuthSession = {
  accessToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    email: string | null;
    fullName: string;
    roles: string[];
  };
};

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type PatientProfile = {
  id: string;
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
};

type BookingResponse = {
  appointmentId: string;
  appointmentNumber: string;
  status: string;
  idempotentReplay: boolean;
  payment: {
    paymentId: string;
    status: string;
    amountMinor: string;
    currency: string;
    redirectPending: boolean;
  } | null;
};

type PaymentStatusResponse = {
  appointmentId: string;
  appointmentStatus: string;
  payment: PaymentStatus | null;
};

type PaymentStatus = {
  paymentId: string;
  status: string;
  provider: string;
  providerPaymentId: string | null;
  amountMinor: string;
  currency: string;
  checkoutUrl: string | null;
  checkoutFields: Record<string, string> | null;
  expiresAt: string | null;
  reconciliationRequired: boolean;
};

type RefundSummary = {
  id: string;
  paymentId: string;
  status: string;
  uiStatus?: string;
  provider: string;
  providerRefundId: string | null;
  amountMinor: string;
  currency: string;
  reason: string;
  requestedAt: string;
  processedAt: string | null;
};

type ReschedulePaymentSummary = {
  id?: string;
  paymentId?: string;
  status: string;
  provider?: string;
  providerPaymentId?: string | null;
  amountMinor: string;
  currency: string;
  checkoutUrl?: string | null;
  checkoutFields?: Record<string, string> | null;
  expiresAt?: string | null;
  reconciliationRequired?: boolean;
  redirectPending?: boolean;
};

type RescheduleRequestSummary = {
  requestId?: string;
  id: string;
  status: string;
  rawStatus?: string;
  oldStartsAt: string;
  oldEndsAt: string;
  newStartsAt: string;
  newEndsAt: string;
  oldFeeMinor: string;
  newFeeMinor: string;
  differenceFeeMinor: string;
  oldAmountMinor?: string;
  newAmountMinor?: string;
  differenceMinor?: string;
  currency: string;
  createdAt: string;
  resolvedAt: string | null;
  expiresAt?: string | null;
  originalAppointment?: {
    startsAt: string;
    endsAt: string;
  };
  replacementSlot?: {
    slotId: string | null;
    startsAt: string;
    endsAt: string;
  };
  hold?: {
    id?: string;
    status: string;
    expiresAt: string;
    resolvedAt?: string | null;
  } | null;
  payment: ReschedulePaymentSummary | null;
  refund?: RefundSummary | null;
};

type RescheduleOption = {
  slotId: string;
  startsAt: string;
  endsAt: string;
  amountMinor: string;
  priceDifferenceMinor: string;
  paymentRequired: boolean;
};

type RescheduleOptionsResponse = {
  appointmentId: string;
  currentAmountMinor: string;
  currency: string;
  slots: RescheduleOption[];
};

type RescheduleStatusResponse = {
  appointmentId: string;
  rescheduleRequest: RescheduleRequestSummary | null;
  rescheduleRequests: RescheduleRequestSummary[];
  refunds: RefundSummary[];
};

type RescheduleResponse = {
  appointmentId: string;
  rescheduleRequest: RescheduleRequestSummary;
  idempotentReplay: boolean;
};

type ReviewSummary = {
  id: string;
  appointmentId: string;
  rating: number;
  title: string | null;
  comment: string | null;
  status: string;
  moderationReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReviewForm = {
  rating: string;
  title: string;
  comment: string;
};

type PublicReview = {
  id: string;
  rating: number;
  title: string | null;
  comment: string | null;
  patientDisplayName: string;
  patientLabel: string;
  clinicName: string;
  clinicLocationName: string | null;
  clinicCity: string;
  createdAt: string;
};

type PatientAppointment = {
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
  doctorName: string;
  clinicName: string;
  clinicLocationName: string | null;
  clinicAddress: string;
  clinicCity: string;
  clinicTimezone: string;
  payment: {
    id: string;
    status: string;
    provider: string;
    amountMinor: string;
    currency: string;
  } | null;
  review: ReviewSummary | null;
  refunds: RefundSummary[];
  rescheduleRequests: RescheduleRequestSummary[];
};

type BookingAttempt = {
  payloadKey: string;
  idempotencyKey: string;
  appointmentId?: string;
  paymentId?: string;
};

type RescheduleAttempt = {
  payloadKey: string;
  idempotencyKey: string;
  requestId?: string;
  paymentId?: string;
};

type PatientBookingPortalProps = {
  apiUrl: string;
  appName: string;
  initialDoctorSlug?: string;
  initialDoctorClinicServiceId?: string;
  initialPaymentId?: string;
  initialAppointmentId?: string;
  initialView?: ViewMode;
};

const bookingAttemptKey = "doctobook_patient_booking_attempt";
const paymentMapPrefix = "doctobook_payment_appointment:";
const rescheduleAttemptPrefix = "doctobook_reschedule_attempt:";

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function getInitialDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);

  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1);
  }

  return date.toISOString().slice(0, 10);
}

function dateStringFromNow(daysFromNow: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);

  return date.toISOString().slice(0, 10);
}

export function PatientBookingPortal({
  apiUrl,
  appName,
  initialDoctorSlug,
  initialDoctorClinicServiceId,
  initialPaymentId,
  initialAppointmentId,
  initialView = "search"
}: PatientBookingPortalProps) {
  const pathname = usePathname();
  const paymentFormRef = useRef<HTMLFormElement | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(initialView);
  const [search, setSearch] = useState("");
  const [selectedSpecialtyId, setSelectedSpecialtyId] = useState("");
  const [selectedMasterServiceId, setSelectedMasterServiceId] = useState("");
  const [selectedDate, setSelectedDate] = useState(getInitialDate);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [masterServices, setMasterServices] = useState<MasterService[]>([]);
  const [doctors, setDoctors] = useState<DoctorSummary[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorDetail | null>(null);
  const [doctorServices, setDoctorServices] = useState<DoctorService[]>([]);
  const [selectedDoctorClinicServiceId, setSelectedDoctorClinicServiceId] = useState(
    initialDoctorClinicServiceId ?? ""
  );
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [paymentPreference, setPaymentPreference] = useState<"online" | "pay_at_clinic">(
    "pay_at_clinic"
  );
  const [reasonForVisit, setReasonForVisit] = useState("");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({
    fullName: "",
    email: "",
    password: ""
  });
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [booking, setBooking] = useState<BookingResponse | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusResponse | null>(null);
  const [appointments, setAppointments] = useState<PatientAppointment[]>([]);
  const [rescheduleAppointmentId, setRescheduleAppointmentId] = useState("");
  const [rescheduleOptions, setRescheduleOptions] = useState<RescheduleOptionsResponse | null>(null);
  const [selectedReplacementSlotId, setSelectedReplacementSlotId] = useState("");
  const [rescheduleStatus, setRescheduleStatus] = useState<RescheduleStatusResponse | null>(null);
  const [reviewForm, setReviewForm] = useState<ReviewForm>({
    rating: "5",
    title: "",
    comment: ""
  });
  const [doctorReviews, setDoctorReviews] = useState<PublicReview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [pendingCancellation, setPendingCancellation] = useState<PatientAppointment | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");

  const selectedDoctorService = useMemo(
    () =>
      doctorServices.find((service) => service.doctorClinicServiceId === selectedDoctorClinicServiceId) ??
      doctorServices[0] ??
      null,
    [doctorServices, selectedDoctorClinicServiceId]
  );
  const selectedSlot = useMemo(
    () => slots.find((slot) => slot.slotId === selectedSlotId) ?? null,
    [slots, selectedSlotId]
  );
  const selectedRescheduleAppointment = useMemo(
    () => appointments.find((appointment) => appointment.id === rescheduleAppointmentId) ?? null,
    [appointments, rescheduleAppointmentId]
  );
  const activeRescheduleRequest = useMemo(
    () => rescheduleStatus?.rescheduleRequest ?? rescheduleStatus?.rescheduleRequests[0] ?? null,
    [rescheduleStatus]
  );
  const terminalReschedule = useMemo(() => {
    if (!activeRescheduleRequest) {
      return true;
    }

    return ["completed", "expired", "cancelled", "failed"].includes(activeRescheduleRequest.status);
  }, [activeRescheduleRequest]);
  const terminalPayment = useMemo(() => {
    const appointmentStatus = paymentStatus?.appointmentStatus ?? booking?.status ?? "";
    const status = paymentStatus?.payment?.status ?? booking?.payment?.status ?? "";

    return (
      appointmentStatus === "confirmed" ||
      appointmentStatus === "expired" ||
      appointmentStatus.startsWith("cancelled") ||
      status === "successful" ||
      status === "failed" ||
      status === "cancelled" ||
      paymentStatus?.payment?.reconciliationRequired === true
    );
  }, [booking, paymentStatus]);

  useEffect(() => {
    void restorePatientSession();
    void loadReferenceData();
    void loadDoctors();
  }, []);

  useEffect(() => {
    if (!initialDoctorSlug) {
      return;
    }

    void loadDoctorBySlug(initialDoctorSlug);
  }, [initialDoctorSlug]);

  useEffect(() => {
    if (!initialPaymentId) {
      return;
    }

    const appointmentId = window.sessionStorage.getItem(`${paymentMapPrefix}${initialPaymentId}`);

    if (appointmentId) {
      setBooking((current) => current ?? ({
        appointmentId,
        appointmentNumber: "",
        status: "pending_payment",
        idempotentReplay: true,
        payment: {
          paymentId: initialPaymentId,
          status: "pending",
          amountMinor: "0",
          currency: "LKR",
          redirectPending: true
        }
      }));
      setViewMode("payment");
    }
  }, [initialPaymentId]);

  useEffect(() => {
    if (initialAppointmentId) {
      setBooking((current) => current ?? ({
        appointmentId: initialAppointmentId,
        appointmentNumber: "",
        status: "pending_payment",
        idempotentReplay: true,
        payment: null
      }));
      setViewMode("payment");
    }
  }, [initialAppointmentId]);

  useEffect(() => {
    if (selectedDoctorService) {
      setPaymentPreference(
        selectedDoctorService.paymentMode === "online_required" ? "online" : "pay_at_clinic"
      );
    }
  }, [selectedDoctorService?.doctorClinicServiceId, selectedDoctorService?.paymentMode]);

  useEffect(() => {
    if (!selectedDoctor || !selectedDoctorService) {
      return;
    }

    void loadAvailability();
  }, [selectedDoctor?.id, selectedDoctorService?.serviceId, selectedDate]);

  useEffect(() => {
    if (!booking?.appointmentId || terminalPayment) {
      return;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      if (!cancelled) {
        void loadPaymentStatus(booking.appointmentId, true);
      }
    }, isPolling ? 3000 : 5000);

    void loadPaymentStatus(booking.appointmentId, true);
    setIsPolling(true);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [booking?.appointmentId, terminalPayment, session?.accessToken]);

  useEffect(() => {
    if (!rescheduleAppointmentId || terminalReschedule) {
      return;
    }

    let cancelled = false;
    const interval = window.setInterval(() => {
      if (!cancelled) {
        void loadRescheduleStatus(rescheduleAppointmentId, true);
      }
    }, activeRescheduleRequest?.status === "pending_payment" ? 3000 : 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [rescheduleAppointmentId, terminalReschedule, activeRescheduleRequest?.status]);

  async function loadReferenceData() {
    const [specialtyResponse, serviceResponse] = await Promise.all([
      publicRequest<{ specialties: Specialty[] }>("/v1/public/specialties"),
      publicRequest<{ services: MasterService[] }>("/v1/public/services")
    ]);

    setSpecialties(specialtyResponse.specialties);
    setMasterServices(serviceResponse.services);
  }

  async function loadDoctors() {
    await runAction(async () => {
      const params = new URLSearchParams();
      params.set("limit", "24");

      if (search.trim()) {
        params.set("search", search.trim());
      }

      if (selectedSpecialtyId) {
        params.set("specialtyId", selectedSpecialtyId);
      }

      if (selectedMasterServiceId) {
        params.set("serviceId", selectedMasterServiceId);
      }

      if (selectedDate) {
        params.set("availableDate", selectedDate);
      }

      const response = await publicRequest<{ doctors: DoctorSummary[] }>(
        `/v1/public/doctors?${params.toString()}`
      );
      setDoctors(response.doctors);

      if (!selectedDoctor && response.doctors[0] && (initialView === "booking" || Boolean(initialDoctorClinicServiceId))) {
        await loadDoctor(response.doctors[0]);
      }
    }, "");
  }

  async function loadDoctorBySlug(slug: string) {
    await runAction(async () => {
      const doctor = await publicRequest<DoctorDetail>(`/v1/public/doctors/${slug}`);
      setSelectedDoctor(doctor);
      setViewMode("booking");
      await loadDoctorServices(doctor.id);
      await loadDoctorReviews(doctor.id);
    }, "");
  }

  async function loadDoctor(doctor: DoctorSummary) {
    setSelectedSlotId("");
    setBooking(null);
    const detail = await publicRequest<DoctorDetail>(`/v1/public/doctors/${doctor.slug}`);
    setSelectedDoctor(detail);
    setViewMode("booking");
    await loadDoctorServices(detail.id);
    await loadDoctorReviews(detail.id);
  }

  async function loadDoctorServices(doctorId: string) {
    const response = await publicRequest<{ doctorServices: DoctorService[] }>(
      `/v1/public/doctors/${doctorId}/services`
    );
    setDoctorServices(response.doctorServices);
    setSelectedDoctorClinicServiceId((current) => current || response.doctorServices[0]?.doctorClinicServiceId || "");
  }

  async function loadDoctorReviews(doctorId: string) {
    const response = await publicRequest<{ reviews: PublicReview[] }>(
      `/v1/public/doctors/${doctorId}/reviews?limit=5`
    );
    setDoctorReviews(response.reviews);
  }

  async function loadAvailability() {
    if (!selectedDoctor || !selectedDoctorService) {
      return [];
    }

    const params = new URLSearchParams({
      doctorId: selectedDoctor.id,
      serviceId: selectedDoctorService.serviceId,
      fromDate: selectedDate,
      toDate: selectedDate,
      limit: "60"
    });
    const response = await publicRequest<{ availability: AvailabilitySlot[] }>(
      `/v1/public/availability?${params.toString()}`
    );

    setSlots(response.availability);
    setSelectedSlotId((current) =>
      response.availability.some((slot) => slot.slotId === current)
        ? current
        : response.availability[0]?.slotId ?? ""
    );

    return response.availability;
  }

  async function loadPatientProfile(token = session?.accessToken) {
    if (!token) {
      return;
    }

    const response = await tokenRequest<{ patient: PatientProfile }>("/v1/patient/me", token);
    setPatient(response.patient);
  }

  async function loadAppointments(token = session?.accessToken, navigate = true) {
    if (!token) {
      if (navigate) setViewMode("appointments");
      return;
    }

    await runAction(async () => {
      const response = await tokenRequest<{ appointments: PatientAppointment[] }>(
        "/v1/patient/appointments",
        token
      );
      setAppointments(response.appointments);
      if (navigate) setViewMode("appointments");
    }, "");
  }

  async function cancelPatientAppointment(appointment: PatientAppointment) {
    if (!session?.accessToken) {
      setError("Login to cancel appointments");
      return;
    }

    setPendingCancellation(appointment);
    setCancellationReason("");
  }

  async function confirmPatientCancellation() {
    if (!session?.accessToken || !pendingCancellation || !cancellationReason.trim()) return;
    const appointment = pendingCancellation;
    const trimmedReason = cancellationReason.trim();

    await runAction(async () => {
      await tokenRequest(`/v1/patient/appointments/${appointment.id}/cancel`, session.accessToken, {
        method: "POST",
        body: JSON.stringify({ reason: trimmedReason })
      });
      await loadAppointments();
    }, "Appointment cancelled");
    setPendingCancellation(null);
    setCancellationReason("");
  }

  async function startReschedule(appointment: PatientAppointment) {
    if (!session?.accessToken) {
      setError("Login to reschedule appointments");
      return;
    }

    await runAction(async () => {
      const params = new URLSearchParams({
        fromDate: todayDateString(),
        toDate: dateStringFromNow(14),
        limit: "30"
      });
      const response = await tokenRequest<RescheduleOptionsResponse>(
        `/v1/patient/appointments/${appointment.id}/reschedule-options?${params.toString()}`,
        session.accessToken
      );

      setRescheduleAppointmentId(appointment.id);
      setRescheduleOptions(response);
      setSelectedReplacementSlotId((current) =>
        response.slots.some((slot) => slot.slotId === current)
          ? current
          : response.slots[0]?.slotId ?? ""
      );
      await loadRescheduleStatus(appointment.id, true);
    }, "");
  }

  async function submitReschedule(appointment: PatientAppointment) {
    if (!session?.accessToken) {
      setError("Login to reschedule appointments");
      return;
    }

    if (!selectedReplacementSlotId) {
      setError("Choose a replacement slot first");
      return;
    }

    await runAction(async () => {
      const payloadKey = JSON.stringify({
        appointmentId: appointment.id,
        replacementSlotId: selectedReplacementSlotId
      });
      const attempt = getOrCreateRescheduleAttempt(appointment.id, payloadKey);
      const response = await tokenRequest<RescheduleResponse>(
        `/v1/patient/appointments/${appointment.id}/reschedule`,
        session.accessToken,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": attempt.idempotencyKey
          },
          body: JSON.stringify({ replacementSlotId: selectedReplacementSlotId })
        }
      );
      const payment = response.rescheduleRequest.payment;
      const paymentId = payment?.paymentId ?? payment?.id;

      persistRescheduleAttempt(appointment.id, {
        ...attempt,
        requestId: response.rescheduleRequest.id,
        paymentId
      });
      setRescheduleStatus({
        appointmentId: appointment.id,
        rescheduleRequest: response.rescheduleRequest,
        rescheduleRequests: [response.rescheduleRequest],
        refunds: []
      });

      if (payment && paymentId) {
        window.sessionStorage.setItem(`${paymentMapPrefix}${paymentId}`, appointment.id);
        setBooking({
          appointmentId: appointment.id,
          appointmentNumber: appointment.appointmentNumber,
          status: appointment.status,
          idempotentReplay: response.idempotentReplay,
          payment: {
            paymentId,
            status: payment.status,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            redirectPending: payment.redirectPending ?? true
          }
        });
        setViewMode("payment");
        await loadPaymentStatus(appointment.id, false);
        return;
      }

      await loadAppointments();
      await loadRescheduleStatus(appointment.id, true);
    }, "Reschedule submitted");
  }

  async function loadRescheduleStatus(appointmentId: string, silent: boolean) {
    if (!session?.accessToken) {
      return null;
    }

    const action = async () => {
      const response = await tokenRequest<RescheduleStatusResponse>(
        `/v1/patient/appointments/${appointmentId}/reschedule-status`,
        session.accessToken
      );
      const payment = response.rescheduleRequest?.payment;
      const paymentId = payment?.paymentId ?? payment?.id;

      if (paymentId) {
        window.sessionStorage.setItem(`${paymentMapPrefix}${paymentId}`, appointmentId);
      }

      setRescheduleAppointmentId(appointmentId);
      setRescheduleStatus(response);
      return response;
    };

    if (silent) {
      return action().catch(() => null);
    }

    return runAction(action, "");
  }

  async function cancelPatientReschedule(appointment: PatientAppointment) {
    if (!session?.accessToken) {
      setError("Login to cancel reschedule requests");
      return;
    }

    await runAction(async () => {
      const response = await tokenRequest<{
        appointmentId: string;
        rescheduleRequest: RescheduleRequestSummary;
      }>(`/v1/patient/appointments/${appointment.id}/reschedule/cancel`, session.accessToken, {
        method: "POST"
      });

      setRescheduleStatus({
        appointmentId: appointment.id,
        rescheduleRequest: response.rescheduleRequest,
        rescheduleRequests: [response.rescheduleRequest],
        refunds: rescheduleStatus?.appointmentId === appointment.id ? rescheduleStatus.refunds : []
      });
      await loadAppointments();
    }, "Reschedule cancelled");
  }

  function startReview(appointment: PatientAppointment) {
    setRescheduleAppointmentId(appointment.id);
    setReviewForm({
      rating: String(appointment.review?.rating ?? 5),
      title: appointment.review?.title ?? "",
      comment: appointment.review?.comment ?? ""
    });
    setViewMode("appointments");
  }

  async function submitPatientReview(appointment: PatientAppointment) {
    if (!session?.accessToken) {
      setError("Login to review appointments");
      return;
    }

    await runAction(async () => {
      const payload = {
        rating: Number(reviewForm.rating),
        title: reviewForm.title.trim() || null,
        comment: reviewForm.comment.trim() || null
      };

      if (appointment.review) {
        await tokenRequest(`/v1/patient/reviews/${appointment.review.id}`, session.accessToken, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
      } else {
        await tokenRequest(`/v1/patient/appointments/${appointment.id}/review`, session.accessToken, {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }

      await loadAppointments();

      if (selectedDoctor?.id) {
        await loadDoctorReviews(selectedDoctor.id);
      }
    }, appointment.review ? "Review updated" : "Review submitted");
  }

  async function deletePatientReview(appointment: PatientAppointment) {
    if (!session?.accessToken || !appointment.review) {
      return;
    }

    await runAction(async () => {
      await tokenRequest(`/v1/patient/reviews/${appointment.review!.id}`, session.accessToken, {
        method: "DELETE"
      });
      await loadAppointments();
    }, "Review removed");
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      if (authMode === "register") {
        await publicRequest("/v1/auth/register", {
          method: "POST",
          body: JSON.stringify({
            accountType: "patient",
            fullName: authForm.fullName,
            email: authForm.email,
            password: authForm.password,
            deviceName: "DoctoBook web"
          })
        });
        setPendingVerificationEmail(authForm.email);
        setNotice("Account created. Check your email to verify your account before signing in.");
        return null;
      }

      let loginResponse: AuthSession;

      try {
        loginResponse = await publicRequest<AuthSession>("/v1/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: authForm.email,
            password: authForm.password,
            deviceName: "DoctoBook web"
          })
        });
      } catch (loginError) {
        if (loginError instanceof ApiRequestError && loginError.code === "EMAIL_VERIFICATION_REQUIRED") {
          setPendingVerificationEmail(authForm.email);
          setNotice("Email verification is required before sign-in. Check your email or resend the verification link.");
          return null;
        }

        throw loginError;
      }

      setSession(loginResponse);
      await loadPatientProfile(loginResponse.accessToken);
      await loadAppointments(loginResponse.accessToken, false);
      setNotice("Signed in");
    }, "");
  }

  async function resendVerification(email = pendingVerificationEmail || authForm.email) {
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setError("Enter your email address to resend verification.");
      return;
    }

    await runAction(async () => {
      await publicRequest("/v1/auth/email-verification/request", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail })
      });
      setPendingVerificationEmail(normalizedEmail);
    }, "If this account is pending verification, a new verification email has been sent.");
  }

  async function submitBooking() {
    if (!selectedSlot || !patient || !session?.accessToken) {
      setViewMode("booking");
      setError("Sign in and select an available slot first");
      return;
    }

    await runAction(async () => {
      const refreshedSlots = await loadAvailability();
      const freshSlot = refreshedSlots.find((slot) => slot.slotId === selectedSlot.slotId);

      if (!freshSlot) {
        throw new Error("That slot is no longer available. Please choose another time.");
      }

      const payloadKey = JSON.stringify({
        appointmentSlotId: freshSlot.slotId,
        attendingPatientId: patient.id,
        reasonForVisit: reasonForVisit.trim() || null,
        paymentPreference
      });
      const idempotencyKey = getOrCreateBookingAttempt(payloadKey).idempotencyKey;
      const response = await tokenRequest<BookingResponse>("/v1/patient/appointments", session.accessToken, {
        method: "POST",
        headers: {
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
          appointmentSlotId: freshSlot.slotId,
          attendingPatientId: patient.id,
          reasonForVisit: reasonForVisit.trim() || null,
          paymentPreference
        })
      });

      setBooking(response);
      persistBookingAttempt({
        payloadKey,
        idempotencyKey,
        appointmentId: response.appointmentId,
        paymentId: response.payment?.paymentId
      });

      if (response.payment?.paymentId) {
        window.sessionStorage.setItem(
          `${paymentMapPrefix}${response.payment.paymentId}`,
          response.appointmentId
        );
      }

      if (response.status === "pending_payment") {
        setViewMode("payment");
        await loadPaymentStatus(response.appointmentId, false);
      } else {
        setViewMode("appointments");
        await loadAppointments();
      }
    }, "Booking submitted");
  }

  async function loadPaymentStatus(appointmentId: string, silent: boolean) {
    if (!session?.accessToken) {
      return;
    }

    const action = async () => {
      const response = await tokenRequest<PaymentStatusResponse>(
        `/v1/patient/appointments/${appointmentId}/payment`,
        session.accessToken
      );
      setPaymentStatus(response);

      if (response.payment?.paymentId) {
        window.sessionStorage.setItem(`${paymentMapPrefix}${response.payment.paymentId}`, appointmentId);
      }

      return response;
    };

    if (silent) {
      await action().catch(() => null);
      return;
    }

    await runAction(action, "");
  }

  async function restorePatientSession() {
    const restored = await publicRequest<AuthSession>("/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({})
    }).catch(() => null);

    if (!restored?.accessToken) {
      return;
    }

    setSession(restored);
    await loadPatientProfile(restored.accessToken);
    await loadAppointments(restored.accessToken, false);
  }

  async function publicRequest<T>(path: string, options: RequestInit = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      }
    });

    return parseResponse<T>(response);
  }

  async function tokenRequest<T>(path: string, token: string, options: RequestInit = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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

      throw new ApiRequestError(message, typeof payload?.code === "string" ? payload.code : undefined);
    }

    return (await response.json()) as T;
  }

  async function runAction<T>(action: () => Promise<T>, successMessage: string) {
    setIsLoading(true);
    setError("");
    setNotice("");

    try {
      const result = await action();

      if (successMessage) {
        setNotice(successMessage);
      }

      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  function getOrCreateBookingAttempt(payloadKey: string): BookingAttempt {
    const stored = window.sessionStorage.getItem(bookingAttemptKey);
    const parsed = stored ? safeJsonParse<BookingAttempt>(stored) : null;

    if (parsed?.payloadKey === payloadKey) {
      return parsed;
    }

    const next = {
      payloadKey,
      idempotencyKey: crypto.randomUUID()
    };

    persistBookingAttempt(next);
    return next;
  }

  function persistBookingAttempt(attempt: BookingAttempt) {
    window.sessionStorage.setItem(bookingAttemptKey, JSON.stringify(attempt));
  }

  function getOrCreateRescheduleAttempt(appointmentId: string, payloadKey: string): RescheduleAttempt {
    const storageKey = `${rescheduleAttemptPrefix}${appointmentId}`;
    const stored = window.sessionStorage.getItem(storageKey);
    const parsed = stored ? safeJsonParse<RescheduleAttempt>(stored) : null;

    if (parsed?.payloadKey === payloadKey) {
      return parsed;
    }

    const next = {
      payloadKey,
      idempotencyKey: crypto.randomUUID()
    };

    persistRescheduleAttempt(appointmentId, next);
    return next;
  }

  function persistRescheduleAttempt(appointmentId: string, attempt: RescheduleAttempt) {
    window.sessionStorage.setItem(`${rescheduleAttemptPrefix}${appointmentId}`, JSON.stringify(attempt));
  }

  function logout() {
    void publicRequest("/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({})
    }).catch(() => null);
    setSession(null);
    setPatient(null);
    setAppointments([]);
    setProfileMenuOpen(false);
  }

  const patientNavigation = [
    { href: "/patient", label: "Dashboard", icon: LayoutDashboard },
    { href: "/patient/find-care", label: "Find care", icon: Search },
    { href: "/patient/appointments", label: "Appointments", icon: CalendarDays },
    { href: "/patient/payments", label: "Payments", icon: CreditCard },
    { href: "/patient/reviews", label: "Reviews", icon: Star },
    { href: "/patient/profile", label: "Profile", icon: UserRound }
  ];

  const navigationMarkup = (
    <nav aria-label="Patient navigation" className="patient-v2-nav">
      {patientNavigation.map((item) => {
        const Icon = item.icon;
        const active = item.href === "/patient"
          ? pathname === item.href
          : (item.href === "/patient/find-care" && pathname === "/") || pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "active" : ""}
            href={item.href}
            key={item.href}
            onClick={() => setMobileNavOpen(false)}
          >
            <Icon size={18} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="patient-v2-shell">
      <aside className="patient-v2-sidebar">
        <div className="patient-v2-brand">
          <span><HeartPulse size={22} /></span>
          <div><strong>{appName}</strong><small>Patient Portal</small></div>
        </div>
        {navigationMarkup}
        <div className="patient-v2-support">
          <CircleHelp size={18} />
          <div><strong>Need help?</strong><span>Contact your clinic for appointment support.</span></div>
        </div>
      </aside>

      {mobileNavOpen ? (
        <div className="patient-v2-mobile-overlay" onMouseDown={(event) => event.target === event.currentTarget && setMobileNavOpen(false)}>
          <aside aria-label="Mobile patient navigation" className="patient-v2-mobile-drawer">
            <div className="patient-v2-brand">
              <span><HeartPulse size={22} /></span>
              <div><strong>{appName}</strong><small>Patient Portal</small></div>
              <button aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} type="button"><X size={19} /></button>
            </div>
            {navigationMarkup}
          </aside>
        </div>
      ) : null}

      <div className="patient-v2-workspace">
        <header className="patient-v2-header">
          <button aria-label="Open navigation" className="patient-v2-menu" onClick={() => setMobileNavOpen(true)} type="button"><Menu size={20} /></button>
          <div className="patient-v2-breadcrumb">
            <Link href="/patient">Patient portal</Link><ChevronRight size={13} /><span>{viewTitle(viewMode)}</span>
          </div>
          <div className="patient-v2-header-actions">
            <Link className="patient-v2-find-link" href="/patient/find-care"><Search size={16} />Find care</Link>
            <button aria-label="Notifications" className="patient-v2-icon-button" type="button"><Bell size={18} /></button>
            <div className="patient-v2-profile-menu">
              <button aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((current) => !current)} type="button">
                <span className="patient-v2-avatar"><UserRound size={17} /></span>
                <span><strong>{patient?.fullName ?? session?.user.fullName ?? "Guest"}</strong><small>{patient?.email ?? session?.user.email ?? "Sign in to book"}</small></span>
              </button>
              {profileMenuOpen ? (
                <div className="patient-v2-profile-popover">
                  {session ? <><Link href="/patient/profile" onClick={() => setProfileMenuOpen(false)}><UserRound size={16} />Profile</Link><button onClick={logout} type="button"><LogOut size={16} />Sign out</button></> : <Link href="/patient/find-care" onClick={() => setProfileMenuOpen(false)}><ShieldCheck size={16} />Sign in while booking</Link>}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="patient-v2-main">
          <header className="patient-v2-page-header">
            <div><p>{viewEyebrow(viewMode)}</p><h1>{viewTitle(viewMode)}</h1><span>{viewDescription(viewMode, patient?.fullName ?? session?.user.fullName)}</span></div>
            <div>{viewMode !== "search" && viewMode !== "booking" ? <Link className="primary-button" href="/patient/find-care"><Search size={16} />Book appointment</Link> : null}</div>
          </header>

          {notice ? <div className="patient-v2-alert success" role="status">{notice}</div> : null}
          {error ? <div className="patient-v2-alert error" role="alert">{error}</div> : null}

          {viewMode === "dashboard" ? (
            <PatientDashboard
              appointments={appointments}
              authForm={authForm}
              authMode={authMode}
              isLoading={isLoading}
              pendingVerificationEmail={pendingVerificationEmail}
              patient={patient}
              session={session}
              setAuthForm={setAuthForm}
              setAuthMode={setAuthMode}
              onResendVerification={resendVerification}
              onSubmitAuth={submitAuth}
            />
          ) : null}

          {viewMode === "search" ? (
            <SearchView
            search={search}
            setSearch={setSearch}
            selectedSpecialtyId={selectedSpecialtyId}
            setSelectedSpecialtyId={setSelectedSpecialtyId}
            selectedMasterServiceId={selectedMasterServiceId}
            setSelectedMasterServiceId={setSelectedMasterServiceId}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            specialties={specialties}
            masterServices={masterServices}
            doctors={doctors}
            selectedDoctor={selectedDoctor}
            isLoading={isLoading}
            onSearch={() => void loadDoctors()}
            onSelectDoctor={(doctor) => void loadDoctor(doctor)}
            />
          ) : null}

          {viewMode === "booking" ? (
            <BookingView
            selectedDoctor={selectedDoctor}
            doctorReviews={doctorReviews}
            doctorServices={doctorServices}
            selectedDoctorClinicServiceId={selectedDoctorClinicServiceId}
            setSelectedDoctorClinicServiceId={setSelectedDoctorClinicServiceId}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            slots={slots}
            selectedSlotId={selectedSlotId}
            setSelectedSlotId={setSelectedSlotId}
            selectedSlot={selectedSlot}
            paymentPreference={paymentPreference}
            setPaymentPreference={setPaymentPreference}
            reasonForVisit={reasonForVisit}
            setReasonForVisit={setReasonForVisit}
            patient={patient}
            session={session}
            authMode={authMode}
            setAuthMode={setAuthMode}
            authForm={authForm}
            setAuthForm={setAuthForm}
            isLoading={isLoading}
            onSubmitAuth={submitAuth}
            onRefreshSlots={() => void loadAvailability()}
            onSubmitBooking={() => void submitBooking()}
            />
          ) : null}

          {viewMode === "payment" ? (
            <PaymentView
            booking={booking}
            paymentStatus={paymentStatus}
            paymentFormRef={paymentFormRef}
            isPolling={isPolling && !terminalPayment}
            onRefresh={() => booking?.appointmentId && void loadPaymentStatus(booking.appointmentId, false)}
            />
          ) : null}

          {viewMode === "appointments" ? (
            <AppointmentsView
            session={session}
            appointments={appointments}
            selectedAppointment={selectedRescheduleAppointment}
            rescheduleOptions={rescheduleOptions}
            selectedReplacementSlotId={selectedReplacementSlotId}
            setSelectedReplacementSlotId={setSelectedReplacementSlotId}
            rescheduleStatus={rescheduleStatus}
            reviewForm={reviewForm}
            setReviewForm={setReviewForm}
            isLoading={isLoading}
            onLoadAppointments={() => void loadAppointments()}
            onCancelAppointment={(appointment) => void cancelPatientAppointment(appointment)}
            onTrackPayment={(appointment) => {
              setBooking({
                appointmentId: appointment.id,
                appointmentNumber: appointment.appointmentNumber,
                status: appointment.status,
                idempotentReplay: true,
                payment: appointment.payment
                  ? {
                      paymentId: appointment.payment.id,
                      status: appointment.payment.status,
                      amountMinor: appointment.payment.amountMinor,
                      currency: appointment.payment.currency,
                      redirectPending: appointment.payment.status === "initiated" || appointment.payment.status === "pending"
                    }
                  : null
              });
              setViewMode("payment");
              void loadPaymentStatus(appointment.id, false);
            }}
            onStartReschedule={(appointment) => void startReschedule(appointment)}
            onStartReview={startReview}
            onSubmitReview={(appointment) => void submitPatientReview(appointment)}
            onDeleteReview={(appointment) => void deletePatientReview(appointment)}
            onSubmitReschedule={(appointment) => void submitReschedule(appointment)}
            onRefreshRescheduleStatus={(appointment) => void loadRescheduleStatus(appointment.id, false)}
            onCancelReschedule={(appointment) => void cancelPatientReschedule(appointment)}
            onTrackReschedulePayment={(appointment, payment) => {
              const paymentId = payment.paymentId ?? payment.id;

              if (!paymentId) {
                setError("Payment is not ready yet");
                return;
              }

              setBooking({
                appointmentId: appointment.id,
                appointmentNumber: appointment.appointmentNumber,
                status: appointment.status,
                idempotentReplay: true,
                payment: {
                  paymentId,
                  status: payment.status,
                  amountMinor: payment.amountMinor,
                  currency: payment.currency,
                  redirectPending:
                    payment.redirectPending ??
                    (payment.status === "initiated" || payment.status === "pending")
                }
              });
              setViewMode("payment");
              void loadPaymentStatus(appointment.id, false);
            }}
            />
          ) : null}

          {viewMode === "payments" ? <PatientPaymentsView appointments={appointments} session={session} /> : null}
          {viewMode === "reviews" ? <PatientReviewsView appointments={appointments} session={session} /> : null}
          {viewMode === "profile" ? <PatientProfileView patient={patient} session={session} /> : null}
        </main>
      </div>

      {pendingCancellation ? (
        <div className="patient-v2-dialog-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPendingCancellation(null)}>
          <div aria-modal="true" className="patient-v2-dialog" role="alertdialog">
            <h2>Cancel this appointment?</h2>
            <p>{pendingCancellation.serviceName} with {pendingCancellation.doctorName} on {formatDateTime(pendingCancellation.startsAt)}.</p>
            <label>Cancellation reason<textarea autoFocus onChange={(event) => setCancellationReason(event.target.value)} required value={cancellationReason} /></label>
            <div><button onClick={() => setPendingCancellation(null)} type="button">Keep appointment</button><button className="danger-button" disabled={isLoading || !cancellationReason.trim()} onClick={() => void confirmPatientCancellation()} type="button">Cancel appointment</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PatientDashboard({
  patient,
  session,
  appointments,
  authMode,
  setAuthMode,
  authForm,
  setAuthForm,
  isLoading,
  pendingVerificationEmail,
  onResendVerification,
  onSubmitAuth
}: {
  patient: PatientProfile | null;
  session: AuthSession | null;
  appointments: PatientAppointment[];
  authMode: "login" | "register";
  setAuthMode: (value: "login" | "register") => void;
  authForm: { fullName: string; email: string; password: string };
  setAuthForm: (value: { fullName: string; email: string; password: string }) => void;
  isLoading: boolean;
  pendingVerificationEmail: string;
  onResendVerification: () => void;
  onSubmitAuth: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const now = Date.now();
  const upcoming = appointments
    .filter((appointment) => new Date(appointment.startsAt).getTime() >= now && !appointment.status.startsWith("cancelled"))
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const nextAppointment = upcoming[0] ?? null;
  const pendingPayments = appointments.filter((appointment) => appointment.payment && ["initiated", "pending"].includes(appointment.payment.status)).length;
  const reviewsDue = appointments.filter((appointment) => appointment.status === "completed" && !appointment.review).length;

  if (!session || !patient) {
    return (
      <div className="patient-v2-guest-grid">
        <section className="patient-v2-welcome-card">
          <span className="patient-v2-brand-icon"><HeartPulse size={24} /></span>
          <h2>Your care, organized in one place</h2>
          <p>Find trusted doctors, book verified appointment times, track payments, reschedule visits, and manage reviews securely.</p>
          <div className="patient-v2-feature-list">
            <span><ShieldCheck size={17} />Secure patient session</span>
            <span><CalendarDays size={17} />Live appointment availability</span>
            <span><CreditCard size={17} />Clear payment and refund status</span>
          </div>
          <Link className="primary-button" href="/patient/find-care">Explore available doctors<ChevronRight size={16} /></Link>
        </section>
        <PatientAuthCard authForm={authForm} authMode={authMode} isLoading={isLoading} onResendVerification={onResendVerification} onSubmitAuth={onSubmitAuth} pendingVerificationEmail={pendingVerificationEmail} setAuthForm={setAuthForm} setAuthMode={setAuthMode} />
      </div>
    );
  }

  return (
    <>
      <section className="patient-v2-metrics" aria-label="Patient summary">
        <article><span><CalendarDays size={18} />Upcoming</span><strong>{upcoming.length}</strong><small>Scheduled appointments</small></article>
        <article><span><CreditCard size={18} />Pending payments</span><strong>{pendingPayments}</strong><small>Require your attention</small></article>
        <article><span><Star size={18} />Reviews due</span><strong>{reviewsDue}</strong><small>Completed visits</small></article>
      </section>
      <div className="patient-v2-dashboard-grid">
        <section className="patient-v2-card patient-v2-next-appointment">
          <div className="patient-v2-card-heading"><div><p>Next appointment</p><h2>{nextAppointment ? nextAppointment.serviceName : "Nothing scheduled"}</h2></div>{nextAppointment ? <span className={`status-badge status-${nextAppointment.status}`}>{humanize(nextAppointment.status)}</span> : null}</div>
          {nextAppointment ? <><div className="patient-v2-appointment-focus"><span className="patient-v2-date-tile"><strong>{new Intl.DateTimeFormat("en", { day: "2-digit" }).format(new Date(nextAppointment.startsAt))}</strong><small>{new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(nextAppointment.startsAt))}</small></span><div><strong>{nextAppointment.doctorName}</strong><span>{nextAppointment.clinicName}</span><span>{formatDateTime(nextAppointment.startsAt)}</span><span>{nextAppointment.clinicLocationName ?? nextAppointment.clinicCity}</span></div></div><Link href="/patient/appointments">Manage appointment<ChevronRight size={15} /></Link></> : <div className="patient-v2-empty-compact"><p>You have no upcoming visits.</p><Link className="primary-button" href="/patient/find-care">Find a doctor</Link></div>}
        </section>
        <section className="patient-v2-card">
          <div className="patient-v2-card-heading"><div><p>Quick actions</p><h2>What would you like to do?</h2></div></div>
          <div className="patient-v2-quick-actions"><Link href="/patient/find-care"><Search size={18} /><span><strong>Find care</strong><small>Search doctors and available times</small></span><ChevronRight size={16} /></Link><Link href="/patient/appointments"><CalendarDays size={18} /><span><strong>Appointments</strong><small>Reschedule, cancel, or check status</small></span><ChevronRight size={16} /></Link><Link href="/patient/payments"><CreditCard size={18} /><span><strong>Payments</strong><small>Track payments and refunds</small></span><ChevronRight size={16} /></Link></div>
        </section>
      </div>
    </>
  );
}

function PatientAuthCard({
  authMode,
  setAuthMode,
  authForm,
  setAuthForm,
  isLoading,
  pendingVerificationEmail,
  onResendVerification,
  onSubmitAuth
}: {
  authMode: "login" | "register";
  setAuthMode: (value: "login" | "register") => void;
  authForm: { fullName: string; email: string; password: string };
  setAuthForm: (value: { fullName: string; email: string; password: string }) => void;
  isLoading: boolean;
  pendingVerificationEmail: string;
  onResendVerification: () => void;
  onSubmitAuth: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="patient-v2-card patient-v2-auth-card" onSubmit={onSubmitAuth}>
      <div className="patient-v2-card-heading">
        <div>
          <p>Secure access</p>
          <h2>{authMode === "login" ? "Sign in to your account" : "Create your patient account"}</h2>
        </div>
      </div>
      <div className="segmented">
        <button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")} type="button">Sign in</button>
        <button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")} type="button">Register</button>
      </div>
      {pendingVerificationEmail ? (
        <div className="patient-v2-check-email" role="status">
          <ShieldCheck size={19} />
          <div>
            <strong>Check your email</strong>
            <span>We sent a verification link to {pendingVerificationEmail}. Verify your account before signing in.</span>
          </div>
          <button disabled={isLoading} onClick={() => onResendVerification()} type="button">
            {isLoading ? "Sending..." : "Resend verification"}
          </button>
        </div>
      ) : null}
      {authMode === "register" ? (
        <label>Full name<input autoComplete="name" onChange={(event) => setAuthForm({ ...authForm, fullName: event.target.value })} required value={authForm.fullName} /></label>
      ) : null}
      <label>Email address<input autoComplete="username" onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} required type="email" value={authForm.email} /></label>
      <label>Password<input autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={8} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} required type="password" value={authForm.password} /></label>
      <button className="primary-button" disabled={isLoading} type="submit">{isLoading ? "Please wait..." : authMode === "login" ? "Sign in securely" : "Create account"}</button>
      <small>DoctoBook uses a secure HttpOnly refresh cookie. Your authentication token is never stored in browser storage.</small>
    </form>
  );
}

function PatientPaymentsView({ appointments, session }: { appointments: PatientAppointment[]; session: AuthSession | null }) {
  const paymentAppointments = appointments.filter((appointment) => appointment.payment);
  const refunds = appointments.flatMap((appointment) => appointment.refunds.map((refund) => ({ ...refund, appointment })));
  const paidTotal = paymentAppointments.filter((appointment) => appointment.payment?.status === "successful").reduce((sum, appointment) => sum + Number(appointment.payment?.amountMinor ?? 0), 0);
  if (!session) return <PatientLockedState title="Sign in to view payments" description="Payment history and refund details are available after secure sign-in." />;
  return <><section className="patient-v2-metrics"><article><span><CreditCard size={18} />Successful payments</span><strong>{paymentAppointments.filter((item) => item.payment?.status === "successful").length}</strong><small>{formatMoney(String(paidTotal), paymentAppointments[0]?.payment?.currency ?? "LKR")}</small></article><article><span><CalendarDays size={18} />Payment records</span><strong>{paymentAppointments.length}</strong><small>Across your appointments</small></article><article><span><HeartPulse size={18} />Refunds</span><strong>{refunds.length}</strong><small>Requested or processed</small></article></section><div className="patient-v2-dashboard-grid"><section className="patient-v2-card"><div className="patient-v2-card-heading"><div><p>Payment history</p><h2>Recent appointment payments</h2></div></div><div className="patient-v2-activity-list">{paymentAppointments.map((appointment) => <article key={appointment.id}><span className="patient-v2-list-icon"><CreditCard size={17} /></span><div><strong>{appointment.serviceName}</strong><span>{appointment.doctorName} · {formatDate(appointment.startsAt)}</span></div><div><strong>{formatMoney(appointment.payment!.amountMinor, appointment.payment!.currency)}</strong><span className={`status-badge status-${appointment.payment!.status}`}>{humanize(appointment.payment!.status)}</span></div></article>)}{!paymentAppointments.length ? <div className="patient-v2-empty-compact"><p>No payment records yet.</p></div> : null}</div></section><section className="patient-v2-card"><div className="patient-v2-card-heading"><div><p>Refund tracking</p><h2>Refund requests</h2></div></div><div className="patient-v2-activity-list">{refunds.map(({ appointment, ...refund }) => <article key={refund.id}><span className="patient-v2-list-icon"><CreditCard size={17} /></span><div><strong>{appointment.serviceName}</strong><span>{refund.reason}</span></div><div><strong>{formatMoney(refund.amountMinor, refund.currency)}</strong><span className={`status-badge status-${refund.uiStatus ?? refund.status}`}>{humanize(refund.uiStatus ?? refund.status)}</span></div></article>)}{!refunds.length ? <div className="patient-v2-empty-compact"><p>No refund requests.</p></div> : null}</div></section></div></>;
}

function PatientReviewsView({ appointments, session }: { appointments: PatientAppointment[]; session: AuthSession | null }) {
  if (!session) return <PatientLockedState title="Sign in to manage reviews" description="Your completed visits and submitted reviews are private to your account." />;
  const reviewable = appointments.filter((appointment) => appointment.status === "completed");
  return <section className="patient-v2-card"><div className="patient-v2-card-heading"><div><p>Your feedback</p><h2>Appointment reviews</h2></div><span>{reviewable.length} completed visits</span></div><div className="patient-v2-review-grid">{reviewable.map((appointment) => <article key={appointment.id}><div><span className="patient-v2-avatar"><Star size={17} /></span><span><strong>{appointment.doctorName}</strong><small>{appointment.serviceName} · {formatDate(appointment.startsAt)}</small></span></div>{appointment.review ? <><strong className="patient-v2-stars">{"★".repeat(appointment.review.rating)}{"☆".repeat(5 - appointment.review.rating)}</strong><p>{appointment.review.comment || appointment.review.title || "Review submitted"}</p><span className={`status-badge status-${appointment.review.status}`}>{humanize(appointment.review.status)}</span></> : <><p>Share feedback after this completed appointment.</p><Link href="/patient/appointments">Write a review</Link></>}</article>)}{!reviewable.length ? <div className="patient-v2-empty-compact"><p>Completed appointments will appear here when they are ready for review.</p></div> : null}</div></section>;
}

function PatientProfileView({ patient, session }: { patient: PatientProfile | null; session: AuthSession | null }) {
  if (!session || !patient) return <PatientLockedState title="Sign in to view your profile" description="Your personal details are protected by your patient session." />;
  return <div className="patient-v2-dashboard-grid"><section className="patient-v2-card"><div className="patient-v2-profile-hero"><span className="patient-v2-avatar patient-v2-avatar-large"><UserRound size={24} /></span><div><h2>{patient.fullName}</h2><p>Patient account</p></div></div><dl className="patient-v2-profile-details"><div><dt>Full name</dt><dd>{patient.fullName}</dd></div><div><dt>Email address</dt><dd>{patient.email || "Not provided"}</dd></div><div><dt>Phone number</dt><dd>{patient.phone || "Not provided"}</dd></div><div><dt>Patient ID</dt><dd>{patient.id}</dd></div></dl></section><section className="patient-v2-card"><div className="patient-v2-card-heading"><div><p>Account security</p><h2>Secure session</h2></div><ShieldCheck size={21} /></div><div className="patient-v2-security-note"><ShieldCheck size={18} /><p>Your session is restored with a secure HttpOnly refresh cookie. Access tokens remain in memory and are never shown or saved in browser storage.</p></div><div className="patient-v2-info-note"><strong>Profile editing is not available yet.</strong><span>The current patient API exposes a read-only profile. Contact support to correct personal information.</span></div></section></div>;
}

function PatientLockedState({ title, description }: { title: string; description: string }) {
  return <section className="patient-v2-card patient-v2-locked"><span className="patient-v2-brand-icon"><ShieldCheck size={23} /></span><h2>{title}</h2><p>{description}</p><Link className="primary-button" href="/patient/find-care">Find care and sign in</Link></section>;
}

function SearchView({
  search,
  setSearch,
  selectedSpecialtyId,
  setSelectedSpecialtyId,
  selectedMasterServiceId,
  setSelectedMasterServiceId,
  selectedDate,
  setSelectedDate,
  specialties,
  masterServices,
  doctors,
  selectedDoctor,
  isLoading,
  onSearch,
  onSelectDoctor
}: {
  search: string;
  setSearch: (value: string) => void;
  selectedSpecialtyId: string;
  setSelectedSpecialtyId: (value: string) => void;
  selectedMasterServiceId: string;
  setSelectedMasterServiceId: (value: string) => void;
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  specialties: Specialty[];
  masterServices: MasterService[];
  doctors: DoctorSummary[];
  selectedDoctor: DoctorDetail | null;
  isLoading: boolean;
  onSearch: () => void;
  onSelectDoctor: (doctor: DoctorSummary) => void;
}) {
  return (
    <div className="patient-content-grid">
      <section className="panel patient-search-panel">
        <div className="panel-header">
          <h3>Find care</h3>
          <span>{doctors.length} doctors</span>
        </div>
        <div className="patient-search-controls">
          <label className="field">
            Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Doctor or specialty" />
          </label>
          <label className="field">
            Specialty
            <select value={selectedSpecialtyId} onChange={(event) => setSelectedSpecialtyId(event.target.value)}>
              <option value="">Any specialty</option>
              {specialties.map((specialty) => (
                <option key={specialty.id} value={specialty.id}>
                  {specialty.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Service
            <select value={selectedMasterServiceId} onChange={(event) => setSelectedMasterServiceId(event.target.value)}>
              <option value="">Any service</option>
              {masterServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Date
            <input min={todayDateString()} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
          <button className="primary-button" disabled={isLoading} onClick={onSearch}>
            Search
          </button>
        </div>
      </section>

      <section className="patient-results">
        {doctors.length === 0 ? (
          <span className="empty-state">
            No doctors have available slots for the selected date. Try another date or clear filters.
          </span>
        ) : null}
        {doctors.map((doctor) => (
          <button
            key={doctor.id}
            className={selectedDoctor?.id === doctor.id ? "doctor-result selected" : "doctor-result"}
            onClick={() => onSelectDoctor(doctor)}
          >
            <Avatar name={doctor.fullName} />
            <span>
              <strong>{doctor.fullName}</strong>
              <small>
                {doctor.specialties.map((specialty) => specialty.name).join(", ") || "General practice"}
              </small>
              <small>
                {doctor.clinics[0]?.clinicName ?? "Clinic"} · {doctor.ratingSummary.averageRating.toFixed(1)} rating
              </small>
            </span>
          </button>
        ))}
      </section>
    </div>
  );
}

function BookingView({
  selectedDoctor,
  doctorReviews,
  doctorServices,
  selectedDoctorClinicServiceId,
  setSelectedDoctorClinicServiceId,
  selectedDate,
  setSelectedDate,
  slots,
  selectedSlotId,
  setSelectedSlotId,
  selectedSlot,
  paymentPreference,
  setPaymentPreference,
  reasonForVisit,
  setReasonForVisit,
  patient,
  session,
  authMode,
  setAuthMode,
  authForm,
  setAuthForm,
  isLoading,
  onSubmitAuth,
  onRefreshSlots,
  onSubmitBooking
}: {
  selectedDoctor: DoctorDetail | null;
  doctorReviews: PublicReview[];
  doctorServices: DoctorService[];
  selectedDoctorClinicServiceId: string;
  setSelectedDoctorClinicServiceId: (value: string) => void;
  selectedDate: string;
  setSelectedDate: (value: string) => void;
  slots: AvailabilitySlot[];
  selectedSlotId: string;
  setSelectedSlotId: (value: string) => void;
  selectedSlot: AvailabilitySlot | null;
  paymentPreference: "online" | "pay_at_clinic";
  setPaymentPreference: (value: "online" | "pay_at_clinic") => void;
  reasonForVisit: string;
  setReasonForVisit: (value: string) => void;
  patient: PatientProfile | null;
  session: AuthSession | null;
  authMode: "login" | "register";
  setAuthMode: (value: "login" | "register") => void;
  authForm: { fullName: string; email: string; password: string };
  setAuthForm: (value: { fullName: string; email: string; password: string }) => void;
  isLoading: boolean;
  onSubmitAuth: (event: FormEvent<HTMLFormElement>) => void;
  onRefreshSlots: () => void;
  onSubmitBooking: () => void;
}) {
  if (!selectedDoctor) {
    return <span className="empty-state">Select a doctor to book</span>;
  }

  return (
    <div className="patient-content-grid">
      <section className="panel">
        <div className="doctor-profile-band">
          <Avatar name={selectedDoctor.fullName} />
          <div>
            <h3>{selectedDoctor.fullName}</h3>
            <p>{selectedDoctor.specialties.map((specialty) => specialty.name).join(", ") || "General practice"}</p>
            <p>
              {selectedDoctor.ratingSummary.averageRating.toFixed(1)} ·{" "}
              {selectedDoctor.ratingSummary.reviewCount} reviews
            </p>
          </div>
        </div>

        <div className="field-row">
          <label className="field">
            Clinic and service
            <select value={selectedDoctorClinicServiceId} onChange={(event) => setSelectedDoctorClinicServiceId(event.target.value)}>
              {doctorServices.map((service) => (
                <option key={service.doctorClinicServiceId} value={service.doctorClinicServiceId}>
                  {service.serviceName} · {service.clinicName} · {formatMoney(service.feeMinor, service.currency)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Date
            <input min={todayDateString()} type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
        </div>

        <div className="panel-header patient-subheader">
          <h3>Available slots</h3>
          <button onClick={onRefreshSlots}>Refresh</button>
        </div>
        <div className="slot-grid">
          {slots.length === 0 ? <span className="empty-state">No slots for this date</span> : null}
          {slots.map((slot) => (
            <button
              key={slot.slotId}
              className={selectedSlotId === slot.slotId ? "slot-button selected" : "slot-button"}
              onClick={() => setSelectedSlotId(slot.slotId)}
            >
              <strong>{formatTime(slot.startsAt)}</strong>
              <span>{slot.clinicLocationName ?? slot.clinicName}</span>
            </button>
          ))}
        </div>
        <div className="review-preview-list">
          <div className="panel-header patient-subheader">
            <h3>Recent reviews</h3>
            <span>{selectedDoctor.ratingSummary.reviewCount}</span>
          </div>
          {doctorReviews.length === 0 ? <span className="empty-state">No reviews yet</span> : null}
          {doctorReviews.map((review) => (
            <div key={review.id} className="public-review-row">
              <span>
                <strong>
                  {"★".repeat(review.rating)}
                  {"☆".repeat(5 - review.rating)}
                </strong>
                <small>
                  {review.patientDisplayName} · {review.patientLabel}
                </small>
                {review.comment ? <small>{review.comment}</small> : null}
              </span>
              <small>{formatDate(review.createdAt)}</small>
            </div>
          ))}
        </div>
      </section>

      <aside className="panel form-panel">
        <div className="panel-header">
          <h3>Confirm</h3>
          {selectedSlot ? <span>{formatMoney(selectedSlot.feeMinor, selectedSlot.currency)}</span> : null}
        </div>
        {selectedSlot ? (
          <div className="booking-summary">
            <strong>{selectedSlot.serviceName}</strong>
            <span>{selectedSlot.doctorName}</span>
            <span>{selectedSlot.clinicName}</span>
            <span>{formatDateTime(selectedSlot.startsAt)} · {selectedSlot.durationMinutes} min</span>
            <span>{humanize(selectedSlot.paymentMode)}</span>
          </div>
        ) : (
          <span className="empty-state">Choose a slot</span>
        )}

        <label className="field">
          Reason
          <input value={reasonForVisit} onChange={(event) => setReasonForVisit(event.target.value)} placeholder="Optional" />
        </label>

        {selectedSlot?.paymentMode === "online_optional" ? (
          <label className="field">
            Payment
            <select value={paymentPreference} onChange={(event) => setPaymentPreference(event.target.value as "online" | "pay_at_clinic")}>
              <option value="pay_at_clinic">Pay at clinic</option>
              <option value="online">Pay online</option>
            </select>
          </label>
        ) : null}

        {selectedSlot?.paymentMode === "online_required" ? (
          <span className="status-message">Online payment required</span>
        ) : null}

        {!session || !patient ? (
          <form className="auth-card" onSubmit={onSubmitAuth}>
            <div className="segmented">
              <button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>
                Login
              </button>
              <button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>
                Register
              </button>
            </div>
            {authMode === "register" ? (
              <label className="field">
                Full name
                <input value={authForm.fullName} onChange={(event) => setAuthForm({ ...authForm, fullName: event.target.value })} required />
              </label>
            ) : null}
            <label className="field">
              Email
              <input type="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} required />
            </label>
            <label className="field">
              Password
              <input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} required />
            </label>
            <button className="primary-button" type="submit" disabled={isLoading}>
              {authMode === "register" ? "Create account" : "Login"}
            </button>
          </form>
        ) : (
          <button className="primary-button" disabled={isLoading || !selectedSlot} onClick={onSubmitBooking}>
            Book appointment
          </button>
        )}
      </aside>
    </div>
  );
}

function PaymentView({
  booking,
  paymentStatus,
  paymentFormRef,
  isPolling,
  onRefresh
}: {
  booking: BookingResponse | null;
  paymentStatus: PaymentStatusResponse | null;
  paymentFormRef: React.RefObject<HTMLFormElement | null>;
  isPolling: boolean;
  onRefresh: () => void;
}) {
  const payment = paymentStatus?.payment;

  return (
    <div className="patient-content-grid">
      <section className="panel form-panel">
        <div className="panel-header">
          <h3>Payment status</h3>
          <span>{isPolling ? "Polling" : "Idle"}</span>
        </div>
        {!booking ? <span className="empty-state">No payment selected</span> : null}
        {booking ? (
          <div className="booking-summary">
            <strong>{booking.appointmentNumber || booking.appointmentId}</strong>
            <span>Appointment {paymentStatus?.appointmentStatus ?? booking.status}</span>
            <span>Payment {payment?.status ?? booking.payment?.status ?? "not required"}</span>
            {payment ? <span>{formatMoney(payment.amountMinor, payment.currency)}</span> : null}
            {payment?.expiresAt ? <span>Hold expires {formatDateTime(payment.expiresAt)}</span> : null}
            {payment?.reconciliationRequired ? (
              <span className="status-message error">Reconciliation required</span>
            ) : null}
          </div>
        ) : null}
        <div className="action-row">
          <button onClick={onRefresh}>Refresh</button>
          {payment?.checkoutUrl && !payment.checkoutFields ? (
            <a className="primary-button" href={payment.checkoutUrl}>
              Continue to payment
            </a>
          ) : null}
          {payment?.checkoutUrl && payment.checkoutFields ? (
            <form ref={paymentFormRef} method="post" action={payment.checkoutUrl}>
              {Object.entries(payment.checkoutFields).map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} readOnly />
              ))}
              <button className="primary-button" type="submit">
                Continue to payment
              </button>
            </form>
          ) : null}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h3>Processing</h3>
        </div>
        <div className="payment-timeline">
          <span className={booking ? "active" : ""}>Booking created</span>
          <span className={payment ? "active" : ""}>Payment initialized</span>
          <span className={payment?.status === "successful" ? "active" : ""}>Verified</span>
          <span className={paymentStatus?.appointmentStatus === "confirmed" ? "active" : ""}>Confirmed</span>
        </div>
      </section>
    </div>
  );
}

function AppointmentsView({
  session,
  appointments,
  selectedAppointment,
  rescheduleOptions,
  selectedReplacementSlotId,
  setSelectedReplacementSlotId,
  rescheduleStatus,
  reviewForm,
  setReviewForm,
  isLoading,
  onLoadAppointments,
  onCancelAppointment,
  onTrackPayment,
  onStartReschedule,
  onStartReview,
  onSubmitReview,
  onDeleteReview,
  onSubmitReschedule,
  onRefreshRescheduleStatus,
  onCancelReschedule,
  onTrackReschedulePayment
}: {
  session: AuthSession | null;
  appointments: PatientAppointment[];
  selectedAppointment: PatientAppointment | null;
  rescheduleOptions: RescheduleOptionsResponse | null;
  selectedReplacementSlotId: string;
  setSelectedReplacementSlotId: (slotId: string) => void;
  rescheduleStatus: RescheduleStatusResponse | null;
  reviewForm: ReviewForm;
  setReviewForm: (form: ReviewForm) => void;
  isLoading: boolean;
  onLoadAppointments: () => void;
  onCancelAppointment: (appointment: PatientAppointment) => void;
  onTrackPayment: (appointment: PatientAppointment) => void;
  onStartReschedule: (appointment: PatientAppointment) => void;
  onStartReview: (appointment: PatientAppointment) => void;
  onSubmitReview: (appointment: PatientAppointment) => void;
  onDeleteReview: (appointment: PatientAppointment) => void;
  onSubmitReschedule: (appointment: PatientAppointment) => void;
  onRefreshRescheduleStatus: (appointment: PatientAppointment) => void;
  onCancelReschedule: (appointment: PatientAppointment) => void;
  onTrackReschedulePayment: (appointment: PatientAppointment, payment: ReschedulePaymentSummary) => void;
}) {
  const activeRequest =
    selectedAppointment && rescheduleStatus?.appointmentId === selectedAppointment.id
      ? rescheduleStatus.rescheduleRequest ?? rescheduleStatus.rescheduleRequests[0] ?? null
      : null;
  const optionSet =
    selectedAppointment && rescheduleOptions?.appointmentId === selectedAppointment.id
      ? rescheduleOptions
      : null;
  const selectedOption =
    optionSet?.slots.find((slot) => slot.slotId === selectedReplacementSlotId) ?? null;
  const refunds =
    selectedAppointment && rescheduleStatus?.appointmentId === selectedAppointment.id
      ? rescheduleStatus.refunds
      : selectedAppointment?.refunds ?? [];

  return (
    <div className="patient-content-grid appointments-workspace">
      <section className="panel">
        <div className="panel-header">
          <h3>My appointments</h3>
          <button disabled={!session} onClick={onLoadAppointments}>
            Refresh
          </button>
        </div>
        {!session ? <span className="empty-state">Login to view appointments</span> : null}
        {session && appointments.length === 0 ? <span className="empty-state">No appointments</span> : null}
        <div className="appointment-list">
          {appointments.map((appointment) => {
            const latestReschedule = appointment.rescheduleRequests[0] ?? null;

            return (
              <div
                key={appointment.id}
                className={
                  selectedAppointment?.id === appointment.id
                    ? "appointment-row appointment-row-card selected"
                    : "appointment-row appointment-row-card"
                }
              >
                <span>
                  <strong>{appointment.serviceName}</strong>
                  <small>
                    {appointment.doctorName} · {appointment.clinicName}
                  </small>
                  <small>{formatDateTime(appointment.startsAt)}</small>
                  <small>
                    {formatMoney(appointment.feeMinor, appointment.currency)} · {humanize(appointment.paymentMode)}
                  </small>
                  {latestReschedule ? (
                    <small>
                      Reschedule {humanize(latestReschedule.status)} · {formatDateTime(latestReschedule.newStartsAt)}
                    </small>
                  ) : null}
                  {appointment.refunds.map((refund) => (
                    <small key={refund.id}>
                      Refund {humanize(refund.uiStatus ?? refund.status)} · {formatMoney(refund.amountMinor, refund.currency)}
                    </small>
                  ))}
                  {appointment.review ? (
                    <small>
                      Review {humanize(appointment.review.status)} · {appointment.review.rating}/5
                    </small>
                  ) : null}
                </span>
                <span className="appointment-actions">
                  <span className={`status-badge status-${appointment.status}`}>
                    {humanize(appointment.status)}
                  </span>
                  {appointment.payment ? (
                    <button onClick={() => onTrackPayment(appointment)} type="button">
                      Payment
                    </button>
                  ) : null}
                  {canPatientReschedule(appointment) ? (
                    <button onClick={() => onStartReschedule(appointment)} type="button">
                      Reschedule
                    </button>
                  ) : null}
                  {canPatientReview(appointment) || appointment.review ? (
                    <button onClick={() => onStartReview(appointment)} type="button">
                      Review
                    </button>
                  ) : null}
                  {canPatientCancel(appointment) ? (
                    <button onClick={() => onCancelAppointment(appointment)} type="button">
                      Cancel
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="panel reschedule-panel">
        <div className="panel-header">
          <h3>Appointment actions</h3>
          {activeRequest ? <span>{humanize(activeRequest.status)}</span> : null}
        </div>
        {!selectedAppointment ? (
          <span className="empty-state">Choose an appointment to reschedule</span>
        ) : (
          <>
            <div className="booking-summary">
              <strong>{selectedAppointment.serviceName}</strong>
              <span>{selectedAppointment.doctorName}</span>
              <span>{selectedAppointment.clinicName}</span>
              <span>Current {formatDateTime(selectedAppointment.startsAt)}</span>
              <span>{formatMoney(selectedAppointment.feeMinor, selectedAppointment.currency)}</span>
            </div>

            {canPatientReview(selectedAppointment) || selectedAppointment.review ? (
              <div className="review-form-panel">
                <div className="panel-header patient-subheader">
                  <h3>Review</h3>
                  {selectedAppointment.review ? (
                    <span>{humanize(selectedAppointment.review.status)}</span>
                  ) : null}
                </div>
                <label className="field">
                  Rating
                  <select
                    value={reviewForm.rating}
                    onChange={(event) => setReviewForm({ ...reviewForm, rating: event.target.value })}
                  >
                    {[5, 4, 3, 2, 1].map((rating) => (
                      <option key={rating} value={String(rating)}>
                        {rating} stars
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Title
                  <input
                    value={reviewForm.title}
                    onChange={(event) => setReviewForm({ ...reviewForm, title: event.target.value })}
                    placeholder="Optional"
                  />
                </label>
                <label className="field">
                  Comment
                  <textarea
                    value={reviewForm.comment}
                    onChange={(event) => setReviewForm({ ...reviewForm, comment: event.target.value })}
                    placeholder="Share your experience"
                    rows={4}
                  />
                </label>
                {selectedAppointment.review?.moderationReason ? (
                  <span className="status-message">{selectedAppointment.review.moderationReason}</span>
                ) : null}
                <div className="action-row">
                  <button
                    className="primary-button"
                    disabled={isLoading}
                    onClick={() => onSubmitReview(selectedAppointment)}
                    type="button"
                  >
                    {selectedAppointment.review ? "Update review" : "Submit review"}
                  </button>
                  {selectedAppointment.review ? (
                    <button disabled={isLoading} onClick={() => onDeleteReview(selectedAppointment)} type="button">
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {canPatientReschedule(selectedAppointment) || activeRequest ? (
              <>
                <div className="panel-header patient-subheader">
                  <h3>Replacement slots</h3>
                  <button disabled={isLoading} onClick={() => onStartReschedule(selectedAppointment)}>
                    Refresh
                  </button>
                </div>
                <div className="reschedule-options">
                  {!optionSet ? <span className="empty-state">Load available replacement slots</span> : null}
                  {optionSet?.slots.length === 0 ? <span className="empty-state">No replacement slots found</span> : null}
                  {optionSet?.slots.map((slot) => (
                    <button
                      key={slot.slotId}
                      className={
                        selectedReplacementSlotId === slot.slotId
                          ? "reschedule-option selected"
                          : "reschedule-option"
                      }
                      onClick={() => setSelectedReplacementSlotId(slot.slotId)}
                      type="button"
                    >
                      <span>
                        <strong>{formatDateTime(slot.startsAt)}</strong>
                        <small>{formatMoney(slot.amountMinor, optionSet.currency)}</small>
                      </span>
                      <span className={slot.priceDifferenceMinor.startsWith("-") ? "amount-negative" : "amount-positive"}>
                        {formatSignedMoney(slot.priceDifferenceMinor, optionSet.currency)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {selectedOption ? (
              <div className="reschedule-review">
                <div>
                  <span>New appointment</span>
                  <strong>{formatDateTime(selectedOption.startsAt)}</strong>
                </div>
                <div>
                  <span>Price difference</span>
                  <strong>{formatSignedMoney(selectedOption.priceDifferenceMinor, selectedAppointment.currency)}</strong>
                </div>
                <span className="status-message">
                  {describePriceDifference(selectedOption.priceDifferenceMinor)}
                </span>
                <button
                  className="primary-button"
                  disabled={isLoading || !selectedReplacementSlotId}
                  onClick={() => onSubmitReschedule(selectedAppointment)}
                  type="button"
                >
                  Submit reschedule
                </button>
              </div>
            ) : null}

            {activeRequest ? (
              <div className="reschedule-status-card">
                <div className="panel-header patient-subheader">
                  <h3>Request status</h3>
                  <button disabled={isLoading} onClick={() => onRefreshRescheduleStatus(selectedAppointment)}>
                    Refresh
                  </button>
                </div>
                <div className="booking-summary">
                  <span>Original {formatDateTime(activeRequest.oldStartsAt)}</span>
                  <span>Replacement {formatDateTime(activeRequest.newStartsAt)}</span>
                  <span>
                    Difference {formatSignedMoney(activeRequest.differenceFeeMinor, activeRequest.currency)}
                  </span>
                  {activeRequest.expiresAt ? <span>Expires {formatDateTime(activeRequest.expiresAt)}</span> : null}
                  {activeRequest.payment ? (
                    <span>
                      Payment {humanize(activeRequest.payment.status)} ·{" "}
                      {formatMoney(activeRequest.payment.amountMinor, activeRequest.payment.currency)}
                    </span>
                  ) : null}
                </div>
                <div className="action-row">
                  {activeRequest.payment ? (
                    <button
                      className="primary-button"
                      onClick={() => onTrackReschedulePayment(selectedAppointment, activeRequest.payment!)}
                      type="button"
                    >
                      Pay difference
                    </button>
                  ) : null}
                  {canCancelRescheduleRequest(activeRequest) ? (
                    <button onClick={() => onCancelReschedule(selectedAppointment)} type="button">
                      Cancel request
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {refunds.length > 0 ? (
              <div className="refund-list">
                <div className="panel-header patient-subheader">
                  <h3>Refunds</h3>
                </div>
                {refunds.map((refund) => (
                  <div key={refund.id} className="refund-row">
                    <span>
                      <strong>{formatMoney(refund.amountMinor, refund.currency)}</strong>
                      <small>{refund.reason}</small>
                    </span>
                    <span className={`status-badge status-${refund.uiStatus ?? refund.status}`}>
                      {humanize(refund.uiStatus ?? refund.status)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </aside>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return <span className="doctor-avatar">{initials || "DR"}</span>;
}

function formatMoney(amountMinor: string, currency: string) {
  const amount = Number(amountMinor) / 100;

  return new Intl.NumberFormat("en-LK", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2
  }).format(amount);
}

function formatSignedMoney(amountMinor: string, currency: string) {
  const amount = Number(amountMinor);

  if (amount === 0) {
    return formatMoney("0", currency);
  }

  const absolute = formatMoney(String(Math.abs(amount)), currency);

  return amount > 0 ? `+${absolute}` : `-${absolute}`;
}

function describePriceDifference(amountMinor: string) {
  const amount = Number(amountMinor);

  if (amount > 0) {
    return "Additional payment is required";
  }

  if (amount < 0) {
    return "A refund request will be created";
  }

  return "No price difference";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium"
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-LK", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function viewTitle(viewMode: ViewMode) {
  if (viewMode === "dashboard") {
    return "Dashboard";
  }

  if (viewMode === "booking") {
    return "Book appointment";
  }

  if (viewMode === "payment") {
    return "Payment processing";
  }

  if (viewMode === "appointments") {
    return "My appointments";
  }

  if (viewMode === "payments") {
    return "Payments and refunds";
  }

  if (viewMode === "reviews") {
    return "My reviews";
  }

  if (viewMode === "profile") {
    return "Profile and security";
  }

  return "Find a doctor";
}

function viewEyebrow(viewMode: ViewMode) {
  if (viewMode === "search" || viewMode === "booking") return "Find care";
  if (viewMode === "payment" || viewMode === "payments") return "Financial activity";
  if (viewMode === "reviews") return "Patient feedback";
  if (viewMode === "profile") return "Your account";
  if (viewMode === "appointments") return "Care schedule";
  return "Patient overview";
}

function viewDescription(viewMode: ViewMode, patientName?: string) {
  if (viewMode === "dashboard") return patientName ? `Welcome back, ${patientName.split(" ")[0]}. Here is your care summary.` : "Sign in to organize appointments, payments, and reviews.";
  if (viewMode === "search") return "Search verified doctors by specialty, service, and live availability.";
  if (viewMode === "booking") return "Choose a clinic service and an appointment time that works for you.";
  if (viewMode === "appointments") return "Track upcoming and past visits, reschedule, cancel, or leave feedback.";
  if (viewMode === "payment") return "Follow payment verification and appointment confirmation in real time.";
  if (viewMode === "payments") return "Review payment outcomes and follow refund progress.";
  if (viewMode === "reviews") return "Manage feedback from completed appointments.";
  return "Review your patient identity and secure session details.";
}

function safeJsonParse<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
