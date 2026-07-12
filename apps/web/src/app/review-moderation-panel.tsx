"use client";

import { useMemo, useState, type FormEvent } from "react";

type ReviewStatus = "pending_moderation" | "approved" | "hidden" | "rejected";

type AdminReview = {
  id: string;
  appointmentNumber: string;
  appointmentStartsAt: string;
  patientName: string;
  patientEmail: string | null;
  patientPhone: string | null;
  doctorName: string;
  clinicName: string;
  rating: number;
  title: string | null;
  comment: string | null;
  status: ReviewStatus;
  moderationReason: string | null;
  moderatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReviewListResponse = {
  reviews: AdminReview[];
};

const statusOptions: Array<{ value: ReviewStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "pending_moderation", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "hidden", label: "Hidden" },
  { value: "rejected", label: "Rejected" }
];

export function ReviewModerationPanel({
  apiUrl,
  accessToken,
  initialStatus = ""
}: {
  apiUrl: string;
  accessToken: string;
  initialStatus?: ReviewStatus | "";
}) {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [selectedReviewId, setSelectedReviewId] = useState("");
  const [status, setStatus] = useState<ReviewStatus | "">(initialStatus);
  const [rating, setRating] = useState("");
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedReview = useMemo(
    () => reviews.find((review) => review.id === selectedReviewId) ?? reviews[0] ?? null,
    [reviews, selectedReviewId]
  );

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

  async function loadReviews(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    await runAction(async () => {
      const params = new URLSearchParams({ limit: "50" });

      if (status) {
        params.set("status", status);
      }

      if (rating) {
        params.set("rating", rating);
      }

      const response = await apiRequest<ReviewListResponse>(`/v1/admin/reviews?${params}`);
      setReviews(response.reviews);
      setSelectedReviewId((current) =>
        response.reviews.some((review) => review.id === current)
          ? current
          : (response.reviews[0]?.id ?? "")
      );
    }, "Reviews loaded");
  }

  async function moderateReview(nextStatus: Exclude<ReviewStatus, "pending_moderation">) {
    if (!selectedReview) {
      setError("Select a review first");
      return;
    }

    if ((nextStatus === "hidden" || nextStatus === "rejected") && !reason.trim()) {
      setError("Moderation reason is required");
      return;
    }

    await runAction(async () => {
      await apiRequest<{ review: AdminReview }>(
        `/v1/admin/reviews/${selectedReview.id}/moderation`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status: nextStatus,
            reason: reason.trim() || null
          })
        }
      );
      setReason("");
      await loadReviews();
    }, `Review marked ${humanize(nextStatus)}`);
  }

  return (
    <section className="appointment-ops-panel" id="reviews">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Super Admin</p>
          <h2>Review moderation</h2>
        </div>
      </div>

      {(notice || error) && (
        <div className={error ? "status-message error" : "status-message"} role="status">
          {error || notice}
        </div>
      )}

      <form className="appointment-toolbar" onSubmit={(event) => void loadReviews(event)}>
        <label className="field">
          Status
          <select onChange={(event) => setStatus(event.target.value as ReviewStatus | "")} value={status}>
            {statusOptions.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Rating
          <select onChange={(event) => setRating(event.target.value)} value={rating}>
            <option value="">All ratings</option>
            <option value="5">5</option>
            <option value="4">4</option>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1</option>
          </select>
        </label>
        <span />
        <button className="primary-button" disabled={isLoading} type="submit">
          Load reviews
        </button>
      </form>

      <div className="appointment-ops-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Reviews</h3>
            <span>{reviews.length} loaded</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Rating</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => (
                  <tr
                    className={review.id === selectedReview?.id ? "selected-row" : ""}
                    key={review.id}
                    onClick={() => setSelectedReviewId(review.id)}
                  >
                    <td>
                      <strong>{review.patientName}</strong>
                      <span>{review.appointmentNumber}</span>
                    </td>
                    <td>
                      <strong>{review.doctorName}</strong>
                      <span>{review.clinicName}</span>
                    </td>
                    <td>{review.rating}/5</td>
                    <td>
                      <span className={`status-badge status-${review.status.replaceAll("_", "-")}`}>
                        {humanize(review.status)}
                      </span>
                    </td>
                  </tr>
                ))}
                {reviews.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      <span className="empty-state">No reviews loaded</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="appointment-detail-panel">
          {selectedReview ? (
            <>
              <div>
                <h4>{selectedReview.title ?? "Patient review"}</h4>
                <p>{selectedReview.comment ?? "No comment provided"}</p>
              </div>
              <div className="detail-grid">
                <span>
                  <small>Patient</small>
                  <strong>{selectedReview.patientName}</strong>
                </span>
                <span>
                  <small>Doctor</small>
                  <strong>{selectedReview.doctorName}</strong>
                </span>
                <span>
                  <small>Appointment</small>
                  <strong>{formatDateTime(selectedReview.appointmentStartsAt)}</strong>
                </span>
                <span>
                  <small>Rating</small>
                  <strong>{selectedReview.rating}/5</strong>
                </span>
              </div>
              <label className="field">
                Moderation reason
                <textarea
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Required for hidden or rejected reviews"
                  value={reason}
                />
              </label>
              {selectedReview.moderationReason ? (
                <span className="status-message">{selectedReview.moderationReason}</span>
              ) : null}
              <div className="action-row">
                <button
                  className="primary-button"
                  disabled={isLoading}
                  onClick={() => void moderateReview("approved")}
                  type="button"
                >
                  Approve
                </button>
                <button
                  disabled={isLoading}
                  onClick={() => void moderateReview("hidden")}
                  type="button"
                >
                  Hide
                </button>
                <button
                  className="danger-button"
                  disabled={isLoading}
                  onClick={() => void moderateReview("rejected")}
                  type="button"
                >
                  Reject
                </button>
              </div>
            </>
          ) : (
            <span className="empty-state">Select a review to moderate</span>
          )}
        </div>
      </div>
    </section>
  );
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
