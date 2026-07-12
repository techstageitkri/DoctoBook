export type ClinicStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "SUSPENDED" | "CLOSED";
export type DoctorStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type PaymentMode = "ONLINE_REQUIRED" | "PAY_AT_CLINIC" | "ONLINE_OPTIONAL";

export type ClinicHour = { id: string; dayOfWeek: number; opensAt: string | null; closesAt: string | null; isClosed: boolean; effectiveFrom?: string | null; effectiveTo?: string | null };
export type ClinicClosure = { id: string; startsAt: string; endsAt: string; reason: string | null };
export type ClinicLocation = { id: string; name: string | null; address: string; city: string; district?: string | null; province?: string | null; country: string; timezone: string; latitude?: string | null; longitude?: string | null; phone: string | null; isPrimary: boolean; status: ClinicStatus; hours?: ClinicHour[]; closures?: ClinicClosure[] };
export type ClinicAdmin = { id: string; userId: string; status: string; user?: { id: string; email: string | null; phone: string | null; fullName: string | null; status: string } };
export type Clinic = { id: string; name: string; slug: string; description: string | null; status: ClinicStatus; email: string | null; phone: string | null; websiteUrl: string | null; defaultPaymentMode: PaymentMode | null; cancellationWindowMinutes: number | null; refundProcessingDays: number | null; createdAt: string; updatedAt: string; deletedAt: string | null; locations?: ClinicLocation[]; admins?: ClinicAdmin[] };

export type Specialty = { id: string; name: string; slug: string };
export type DoctorDocument = { id: string; documentType: string; platformStatus: string; file: { originalFilename: string; mimeType: string; sizeBytes: string; visibility: string } };
export type Doctor = { id: string; slug: string; licenseNumber: string | null; status: DoctorStatus; bio: string | null; qualifications: string | null; yearsExperience: number | null; languages: string[]; rejectionReason: string | null; approvedByUserId: string | null; user: { id: string; email: string | null; phone: string | null; fullName: string; status: string }; specialties?: Array<{ specialty: Specialty; isPrimary: boolean }>; documents?: DoctorDocument[]; clinicAssociations?: DoctorAssociation[] };
export type DoctorAssociation = { id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "REMOVED"; clinicId: string; clinicLocationId: string; clinic: { id: string; name: string; slug: string }; clinicLocation: { id: string; name: string | null; address: string; city: string }; doctor?: Doctor };

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function paymentModeLabel(value: PaymentMode | null) {
  if (!value) return "Not configured";
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
