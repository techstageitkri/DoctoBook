"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useAdminSession } from "../admin-shell";
import { FormSection, PageHeader, useToast } from "../admin-ui";
import type { Clinic, PaymentMode } from "../admin-types";

export function ClinicCreatePage() {
  const { apiRequest } = useAdminSession(); const { showToast } = useToast(); const router = useRouter();
  const [form, setForm] = useState({ name: "", slug: "", description: "", email: "", phone: "", websiteUrl: "", defaultPaymentMode: "PAY_AT_CLINIC" as PaymentMode, cancellationWindowMinutes: "30", refundProcessingDays: "7" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { const clinic = await apiRequest<Clinic>("/v1/admin/clinics", { method: "POST", body: JSON.stringify({ ...form, description: form.description || null, email: form.email || null, phone: form.phone || null, websiteUrl: form.websiteUrl || null, cancellationWindowMinutes: Number(form.cancellationWindowMinutes), refundProcessingDays: Number(form.refundProcessingDays) }) }); showToast("Clinic created successfully"); router.push(`/admin/clinics/${clinic.id}`); } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Unable to create clinic"); } finally { setBusy(false); } }
  function update(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })); }
  return <>
    <PageHeader eyebrow="Clinic operations" title="Create clinic" description="Set up the organization record first. Locations, hours, services, and administrators are configured after creation." actions={<Link className="admin-v2-secondary-button" href="/admin/clinics"><ArrowLeft size={17} />Back to clinics</Link>} />
    <form className="admin-v2-form-layout" onSubmit={submit}>
      <FormSection title="Organization information" description="Public identity and primary contact details.">
        <div className="admin-v2-form-grid"><label>Clinic name<input autoFocus onChange={(e) => update("name", e.target.value)} required value={form.name} /></label><label>URL slug<input onChange={(e) => update("slug", e.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required value={form.slug} /><small>Lowercase letters, numbers, and hyphens only.</small></label><label className="span-2">Description<textarea onChange={(e) => update("description", e.target.value)} value={form.description} /></label><label>Email address<input onChange={(e) => update("email", e.target.value)} type="email" value={form.email} /></label><label>Phone number<input onChange={(e) => update("phone", e.target.value)} value={form.phone} /></label><label className="span-2">Website URL<input onChange={(e) => update("websiteUrl", e.target.value)} type="url" value={form.websiteUrl} /></label></div>
      </FormSection>
      <FormSection title="Operational defaults" description="These defaults can be overridden by clinic and doctor services.">
        <div className="admin-v2-form-grid"><label>Default payment mode<select onChange={(e) => update("defaultPaymentMode", e.target.value)} value={form.defaultPaymentMode}><option value="PAY_AT_CLINIC">Pay at clinic</option><option value="ONLINE_REQUIRED">Online required</option><option value="ONLINE_OPTIONAL">Online optional</option></select></label><label>Cancellation window (minutes)<input min="1" onChange={(e) => update("cancellationWindowMinutes", e.target.value)} required type="number" value={form.cancellationWindowMinutes} /></label><label>Refund processing target (days)<input min="1" onChange={(e) => update("refundProcessingDays", e.target.value)} required type="number" value={form.refundProcessingDays} /></label></div>
      </FormSection>
      {error && <div className="admin-v2-alert error" role="alert">{error}</div>}
      <div className="admin-v2-form-footer"><Link href="/admin/clinics">Cancel</Link><button className="primary-button" disabled={busy} type="submit"><Building2 size={17} />{busy ? "Creating…" : "Create clinic"}</button></div>
    </form>
  </>;
}
