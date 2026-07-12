"use client";

import Link from "next/link";
import { AlertTriangle, Inbox, LoaderCircle, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
const ToastContext = createContext<{ showToast: (message: string, tone?: Toast["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="admin-toast-region" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <div className={`admin-toast admin-toast-${toast.tone}`} key={toast.id} role="status">
            {toast.message}
            <button aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} type="button">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-v2-page-header">
      <div>
        {eyebrow && <p className="admin-v2-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="admin-v2-page-actions">{actions}</div>}
    </header>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll("_", "-");
  const label = status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return <span className={`admin-v2-status admin-v2-status-${normalized}`}>{label}</span>;
}

export function MetricCard({ label, value, detail, icon }: { label: string; value: ReactNode; detail?: string; icon?: ReactNode }) {
  return (
    <article className="admin-v2-metric">
      <div>{icon}<span>{label}</span></div>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="admin-v2-empty">
      <Inbox size={28} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="admin-v2-skeleton" aria-label="Loading" role="status">
      {Array.from({ length: rows }, (_, index) => <span key={index} />)}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="admin-v2-filter-bar">{children}</div>;
}

export function DataTable({ children, label }: { children: ReactNode; label: string }) {
  return <div className="admin-v2-table-wrap"><table aria-label={label}>{children}</table></div>;
}

export function Pagination({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="admin-v2-pagination" aria-label="Pagination">
      <span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}` : "0 records"}</span>
      <div>
        <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} type="button">Previous</button>
        <span>Page {page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => onPageChange(page + 1)} type="button">Next</button>
      </div>
    </div>
  );
}

export function Tabs({ items, active }: { items: Array<{ href: string; label: string }>; active: string }) {
  return (
    <nav className="admin-v2-tabs" aria-label="Record sections">
      {items.map((item) => <Link aria-current={item.href === active ? "page" : undefined} className={item.href === active ? "active" : ""} href={item.href} key={item.href}>{item.label}</Link>)}
    </nav>
  );
}

export function FormSection({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="admin-v2-card admin-v2-form-section">
      <div className="admin-v2-card-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions}</div>
      {children}
    </section>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", danger = false, busy = false, onCancel, onConfirm }: { open: boolean; title: string; description: string; confirmLabel?: string; danger?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, open]);
  if (!open) return null;
  return (
    <div className="admin-v2-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div aria-describedby="confirm-description" aria-modal="true" className="admin-v2-dialog" role="alertdialog">
        <AlertTriangle size={22} aria-hidden="true" />
        <h2>{title}</h2><p id="confirm-description">{description}</p>
        <div className="admin-v2-dialog-actions">
          <button disabled={busy} onClick={onCancel} type="button">Cancel</button>
          <button className={danger ? "danger-button" : "primary-button"} disabled={busy} onClick={onConfirm} type="button">{busy ? "Working…" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function Drawer({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div className="admin-v2-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside aria-label={title} aria-modal="true" className="admin-v2-drawer" role="dialog">
        <div className="admin-v2-drawer-header"><h2>{title}</h2><button aria-label="Close drawer" onClick={onClose} type="button"><X size={19} /></button></div>
        <div className="admin-v2-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function InlineLoading({ label = "Loading" }: { label?: string }) {
  return <span className="admin-v2-inline-loading"><LoaderCircle size={16} className="admin-v2-spin" />{label}</span>;
}

export function usePaginatedItems<T>(items: T[], page: number, pageSize: number) {
  return useMemo(() => items.slice((page - 1) * pageSize, page * pageSize), [items, page, pageSize]);
}
