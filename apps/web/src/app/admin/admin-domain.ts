import type { Doctor, PaymentMode } from "./admin-types";

export type ClinicCreateForm = {
  name: string;
  slug: string;
  description: string;
  email: string;
  phone: string;
  websiteUrl: string;
  defaultPaymentMode: PaymentMode;
  cancellationWindowMinutes: string;
  refundProcessingDays: string;
};

export function buildClinicCreatePayload(form: ClinicCreateForm) {
  return {
    ...form,
    description: form.description || null,
    email: form.email || null,
    phone: form.phone || null,
    websiteUrl: form.websiteUrl || null,
    cancellationWindowMinutes: Number(form.cancellationWindowMinutes),
    refundProcessingDays: Number(form.refundProcessingDays)
  };
}

export function doctorReadinessChecks(doctor: Doctor) {
  const approvedDocuments = doctor.documents?.filter((document) => document.platformStatus === "APPROVED").length ?? 0;
  const approvedAssociations = doctor.clinicAssociations?.filter((association) => association.status === "APPROVED").length ?? 0;
  return {
    accountApproved: doctor.status === "APPROVED",
    documentApproved: approvedDocuments > 0,
    specialtyConfigured: Boolean(doctor.specialties?.length),
    clinicAssigned: approvedAssociations > 0,
    publicListingReady: doctor.status === "APPROVED" && approvedDocuments > 0 && Boolean(doctor.specialties?.length) && approvedAssociations > 0
  };
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const safePage = Math.max(1, page);
  return items.slice((safePage - 1) * pageSize, safePage * pageSize);
}
