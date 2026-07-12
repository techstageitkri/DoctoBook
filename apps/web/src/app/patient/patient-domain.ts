export const patientNavigationRoutes = [
  "/patient",
  "/patient/find-care",
  "/patient/appointments",
  "/patient/payments",
  "/patient/reviews",
  "/patient/profile"
] as const;

export function canPatientCancel(appointment: { status: string }) {
  return appointment.status === "confirmed" || appointment.status === "pending_payment";
}

export function canPatientReschedule(appointment: { status: string }) {
  return appointment.status === "confirmed" || appointment.status === "pending_payment";
}

export function canPatientReview(appointment: { status: string }) {
  return appointment.status === "completed";
}

export function canCancelRescheduleRequest(request: { status: string }) {
  return request.status === "pending" || request.status === "pending_payment";
}

export function buildPatientAuthPayload(
  mode: "login" | "register",
  form: { fullName: string; email: string; password: string }
) {
  return {
    ...(mode === "register" ? { accountType: "patient" as const, fullName: form.fullName.trim() } : {}),
    email: form.email.trim().toLowerCase(),
    password: form.password,
    deviceName: "DoctoBook web"
  };
}

export function summarizePatientAppointments(
  appointments: Array<{
    status: string;
    startsAt: string;
    payment: { status: string } | null;
    review: unknown | null;
  }>,
  now = Date.now()
) {
  const upcoming = appointments.filter(
    (appointment) =>
      new Date(appointment.startsAt).getTime() >= now &&
      !appointment.status.startsWith("cancelled")
  );

  return {
    upcoming: upcoming.length,
    pendingPayments: appointments.filter((appointment) =>
      appointment.payment && ["initiated", "pending"].includes(appointment.payment.status)
    ).length,
    reviewsDue: appointments.filter(
      (appointment) => appointment.status === "completed" && !appointment.review
    ).length
  };
}
