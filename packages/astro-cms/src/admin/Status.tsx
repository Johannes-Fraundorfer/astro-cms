import type { Status } from "./api.ts";

const labels: Record<Status, string> = {
  published: "Published",
  changed: "Published, with unpublished changes",
  draft: "Draft, never published",
  empty: "Empty",
  missing: "Not translated yet",
};

/** Sanity-style dots: green for live, orange for unpublished changes, hollow for a missing translation. */
export function StatusDot({ status }: { status: Status }) {
  return (
    <span className="status-dots" title={labels[status]} aria-label={labels[status]}>
      {(status === "published" || status === "changed") && <span className="dot dot-live" />}
      {(status === "changed" || status === "draft") && <span className="dot dot-draft" />}
      {status === "missing" && <span className="dot dot-missing" />}
    </span>
  );
}
