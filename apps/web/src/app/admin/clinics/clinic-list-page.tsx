"use client";

import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../admin-shell";
import { DataTable, EmptyState, FilterBar, LoadingSkeleton, PageHeader, Pagination, StatusBadge, usePaginatedItems } from "../admin-ui";
import { formatDate, paymentModeLabel, type Clinic, type ClinicStatus } from "../admin-types";

const statuses: Array<ClinicStatus | "ALL"> = ["ALL", "ACTIVE", "PENDING_APPROVAL", "DRAFT", "SUSPENDED", "CLOSED"];

export function ClinicListPage({ approvalsOnly = false, title = "Clinic directory", description = "Search, filter, and manage every clinic organization on the platform." }: { approvalsOnly?: boolean; title?: string; description?: string }) {
  const { apiRequest, can } = useAdminSession();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ClinicStatus | "ALL">(approvalsOnly ? "PENDING_APPROVAL" : "ALL");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { setLoading(true); void apiRequest<{ clinics: Clinic[] }>("/v1/admin/clinics").then((result) => setClinics(result.clinics)).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load clinics")).finally(() => setLoading(false)); }, [apiRequest]);
  const filtered = useMemo(() => clinics.filter((clinic) => {
    const matchStatus = status === "ALL" || clinic.status === status;
    const term = query.trim().toLowerCase();
    return matchStatus && (!term || clinic.name.toLowerCase().includes(term) || clinic.slug.toLowerCase().includes(term) || clinic.email?.toLowerCase().includes(term));
  }), [clinics, query, status]);
  const visible = usePaginatedItems(filtered, page, 10);
  useEffect(() => setPage(1), [query, status]);

  return <>
    <PageHeader eyebrow="Clinic operations" title={title} description={description} actions={can("clinic.create") ? <Link className="primary-button" href="/admin/clinics/new"><Plus size={17} />Create clinic</Link> : undefined} />
    <section className="admin-v2-card admin-v2-table-card">
      <FilterBar>
        <label className="admin-v2-search-field"><span className="sr-only">Search clinics</span><Search size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="Search by clinic, slug, or email" value={query} /></label>
        <label><span>Status</span><select onChange={(event) => setStatus(event.target.value as ClinicStatus | "ALL")} value={status}>{statuses.map((value) => <option key={value} value={value}>{value === "ALL" ? "All statuses" : value.replaceAll("_", " ")}</option>)}</select></label>
      </FilterBar>
      {error && <div className="admin-v2-alert error" role="alert">{error}</div>}
      {loading ? <LoadingSkeleton /> : visible.length ? <>
        <DataTable label="Clinics">
          <thead><tr><th>Clinic</th><th>Status</th><th>Payment policy</th><th>Locations</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{visible.map((clinic) => <tr key={clinic.id}><td><div className="admin-v2-entity"><span className="admin-v2-avatar"><Building2 size={17} /></span><span><strong>{clinic.name}</strong><small>{clinic.email || clinic.slug}</small></span></div></td><td><StatusBadge status={clinic.status} /></td><td>{paymentModeLabel(clinic.defaultPaymentMode)}</td><td>{clinic.locations?.length ?? 0}</td><td>{formatDate(clinic.createdAt)}</td><td><Link className="admin-v2-table-action" href={`/admin/clinics/${clinic.id}`}>View</Link></td></tr>)}</tbody>
        </DataTable><Pagination onPageChange={setPage} page={page} pageSize={10} total={filtered.length} />
      </> : <EmptyState title="No clinics found" description={query || status !== "ALL" ? "Adjust the search or status filter." : "Create the first clinic to populate the directory."} action={can("clinic.create") ? <Link className="primary-button" href="/admin/clinics/new">Create clinic</Link> : undefined} />}
    </section>
  </>;
}
