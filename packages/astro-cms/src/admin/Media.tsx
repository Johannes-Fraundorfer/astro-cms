import { useCallback, useEffect, useId, useState } from "react";
import { api, type Asset } from "./api.ts";
import { Icon } from "./Icon.tsx";
import { Menu } from "./Menu.tsx";

type Filter = "all" | "used" | "unused";
type Toast = (message: string, tone?: "error" | "info") => void;
type OpenDoc = (type: string, id: string, locale?: string) => void;

const ACCEPT = "image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml";

/** Opens the file dialog once and hands back the chosen file. */
function pickFile(multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ACCEPT, multiple });
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.click();
  });
}

const deleteBlocker = (a: Asset) =>
  a.uses
    ? `Used in ${a.uses} ${a.uses === 1 ? "document" : "documents"}. Remove it there first.`
    : !a.deletable
      ? "This image is part of the site's code, so it can't be deleted here."
      : undefined;

/**
 * Every image the site can use: published ones from the repo and uploads that
 * go live with the next publish. Picks an image when `onPick` is given;
 * otherwise each image opens its details (alt text, replace, delete).
 */
export function MediaGrid({
  onPick,
  onOpenDoc,
  localeTitle,
  toast,
}: {
  onPick?: (asset: Asset) => void;
  onOpenDoc?: OpenDoc;
  localeTitle?: string;
  toast: Toast;
}) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState<string>();

  const load = useCallback(async () => {
    const fresh = await api.assets().catch((err) => {
      toast(err.message, "error");
      return null;
    });
    if (fresh) setAssets(fresh);
    return fresh;
  }, [toast]);

  useEffect(() => void load(), [load]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    let last: string | undefined;
    for (const file of files) {
      try {
        last = (await api.upload(file)).src;
      } catch (err) {
        toast(`${file.name}: ${err instanceof Error ? err.message : "upload failed"}`, "error");
      }
    }
    setBusy(false);
    const fresh = await load();
    // Uploading from a picker picks the upload right away.
    const picked = fresh?.find((a) => a.value === last);
    if (onPick && picked && files.length === 1) onPick(picked);
  };

  const replace = async (asset: Asset) => {
    const [file] = await pickFile();
    if (!file) return;
    setBusy(true);
    try {
      const { src, updated } = await api.replaceAsset(asset.value, file);
      toast(updated ? `Replaced in ${updated} ${updated === 1 ? "document" : "documents"}. Publish them to update the site.` : "Image replaced");
      await load();
      if (open === asset.value) setOpen(src);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Replace failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (asset: Asset) => {
    const note = asset.pending ? "It was never published, so it can't be restored." : "This removes the file from the site with the next deploy.";
    if (!confirm(`Delete "${asset.name}"? ${note}`)) return;
    try {
      await api.removeAsset(asset.value);
      setAssets((list) => list?.filter((a) => a.value !== asset.value) ?? list);
      if (open === asset.value) setOpen(undefined);
      toast(`Deleted "${asset.name}"`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  };

  const needle = q.trim().toLowerCase();
  const shown = (assets ?? []).filter(
    (a) =>
      (filter === "all" || (filter === "used" ? a.uses > 0 : a.uses === 0)) &&
      (!needle || `${a.name} ${a.folder} ${a.alt ?? ""}`.toLowerCase().includes(needle)),
  );
  const detail = assets?.find((a) => a.value === open);

  return (
    <div
      className={`media${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        upload([...e.dataTransfer.files]);
      }}
    >
      <div className="media-bar">
        <div className="search">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or alt text" aria-label="Search images" />
        </div>
        <div className="segmented" role="group" aria-label="Filter">
          {(["all", "used", "unused"] as const).map((f) => (
            <button key={f} type="button" className={filter === f ? "is-active" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "used" ? "In use" : "Unused"}
            </button>
          ))}
        </div>
        <button type="button" className="btn" disabled={busy} onClick={async () => upload(await pickFile(!onPick))}>
          <Icon name="plus" size={14} /> {busy ? "Uploading…" : "Upload"}
        </button>
      </div>

      {assets === null ? (
        <p className="muted pad">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted pad">{assets.length ? "No images match." : "No images yet. Drop some here to upload them."}</p>
      ) : (
        <ul className="media-grid">
          {shown.map((a) => (
            <li key={a.value} className="media-card">
              <button
                type="button"
                className="media-thumb"
                title={a.alt ? `Alt text: ${a.alt}` : a.name}
                onClick={() => (onPick ? onPick(a) : setOpen(a.value))}
              >
                <img src={a.url} alt={a.alt ?? ""} loading="lazy" />
              </button>
              <div className="media-meta">
                <span className="media-name" title={a.name}>
                  {a.name}
                </span>
                <span className="media-info">
                  {a.pending && <span className="type-tag media-tag">Unpublished</span>}
                  {a.uses ? `Used ${a.uses}×` : "Unused"}
                  {a.width && a.height ? ` · ${a.width}×${a.height}` : ""}
                </span>
                {!onPick && !a.alt && <span className="media-info media-noalt">No alt text</span>}
              </div>
              {!onPick && (
                <div className="media-actions">
                  <Menu
                    label={`Actions for ${a.name}`}
                    className="btn btn-icon btn-ghost media-more"
                    trigger={<Icon name="more" />}
                    items={[
                      { label: "Details & alt text", icon: <Icon name="form" />, onSelect: () => setOpen(a.value) },
                      { label: "Replace…", icon: <Icon name="refresh" />, onSelect: () => replace(a) },
                      { label: "Delete", icon: <Icon name="trash" />, danger: true, disabled: !!deleteBlocker(a), onSelect: () => remove(a) },
                    ]}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {detail && (
        <AssetDetails
          key={detail.value}
          asset={detail}
          busy={busy}
          localeTitle={localeTitle}
          toast={toast}
          onClose={() => setOpen(undefined)}
          onSaved={load}
          onReplace={() => replace(detail)}
          onDelete={() => remove(detail)}
          onOpenDoc={onOpenDoc}
        />
      )}
    </div>
  );
}

function AssetDetails({
  asset,
  busy,
  localeTitle,
  toast,
  onClose,
  onSaved,
  onReplace,
  onDelete,
  onOpenDoc,
}: {
  asset: Asset;
  busy: boolean;
  localeTitle?: string;
  toast: Toast;
  onClose: () => void;
  onSaved: () => void;
  onReplace: () => void;
  onDelete: () => void;
  onOpenDoc?: OpenDoc;
}) {
  const altId = useId();
  const [alt, setAlt] = useState(asset.alt ?? "");
  const [updateUses, setUpdateUses] = useState(asset.altUses > 0);
  const [saving, setSaving] = useState(false);
  const blocker = deleteBlocker(asset);
  const dirty = alt.trim() !== (asset.alt ?? "");
  const where = localeTitle ? `${localeTitle} ` : "";

  const saveAlt = async () => {
    setSaving(true);
    try {
      const { updated } = await api.setAssetAlt(asset.value, alt, updateUses && asset.altUses > 0);
      toast(updated ? `Alt text saved and updated in ${updated} ${updated === 1 ? "draft" : "drafts"}` : "Alt text saved");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the alt text", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog dialog-asset"
        role="dialog"
        aria-modal="true"
        aria-label={asset.name}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog-head">
          <h2 className="asset-title">{asset.name}</h2>
          <button type="button" className="btn btn-icon btn-ghost" aria-label="Close" onClick={onClose} autoFocus>
            <Icon name="close" />
          </button>
        </div>
        <div className="asset-body">
          <div className="asset-preview">
            <img src={asset.url} alt={asset.alt ?? ""} />
          </div>
          <div className="asset-side">
            <dl className="asset-facts">
              <dt>Folder</dt>
              <dd>{asset.folder}</dd>
              {asset.width && asset.height ? (
                <>
                  <dt>Size</dt>
                  <dd>
                    {asset.width} × {asset.height}
                  </dd>
                </>
              ) : null}
              {asset.size ? (
                <>
                  <dt>File</dt>
                  <dd>{asset.size > 1024 * 1024 ? `${(asset.size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(asset.size / 1024)} KB`}</dd>
                </>
              ) : null}
              <dt>Status</dt>
              <dd>{asset.pending ? "Unpublished upload, goes live with the first published document using it" : "Published"}</dd>
            </dl>

            <div className="asset-section">
              <label className="field-label" htmlFor={altId}>
                Alt text{localeTitle ? ` (${localeTitle})` : ""}
              </label>
              <p className="field-description">Describe the image for screen readers and search engines. Used whenever someone picks it.</p>
              <textarea id={altId} className="input" rows={3} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Leave empty if it's decorative" />
              {asset.altUses > 0 && (
                <label className="check">
                  <input type="checkbox" checked={updateUses} onChange={(e) => setUpdateUses(e.target.checked)} />
                  Also update it in the {asset.altUses} {where}
                  {asset.altUses === 1 ? "document" : "documents"} using it (saved as drafts)
                </label>
              )}
              <div className="asset-row">
                <button type="button" className="btn btn-primary" disabled={saving || (!dirty && !updateUses)} onClick={saveAlt}>
                  {saving ? "Saving…" : "Save alt text"}
                </button>
              </div>
            </div>

            <div className="asset-section">
              <span className="field-label">Used in</span>
              {asset.usedIn.length ? (
                <ul className="asset-uses">
                  {asset.usedIn.map((d) => (
                    <li key={`${d.type}:${d.id}:${d.locale}`}>
                      <button type="button" className="doc-item" disabled={!onOpenDoc} onClick={() => onOpenDoc?.(d.type, d.id, d.locale)}>
                        <Icon name="doc" />
                        <span className="block-title">{d.title}</span>
                        {localeTitle && <span className="type-tag">{d.locale.toUpperCase()}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Not used anywhere.</p>
              )}
            </div>

            <div className="asset-section asset-row">
              <button type="button" className="btn" disabled={busy} onClick={onReplace}>
                <Icon name="refresh" size={14} /> {busy ? "Uploading…" : "Replace…"}
              </button>
              <button type="button" className="btn btn-danger" disabled={!!blocker} title={blocker} onClick={onDelete}>
                <Icon name="trash" size={14} /> Delete
              </button>
            </div>
            <p className="muted small">
              {blocker ??
                "Replacing swaps in a new file wherever this one is used, as drafts to publish."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MediaView({ toast, onOpenDoc, localeTitle }: { toast: Toast; onOpenDoc: OpenDoc; localeTitle?: string }) {
  return (
    <div className="media-view">
      <header className="media-head">
        <h1>Media</h1>
        <p className="muted">
          Every image on the site. Click one to set its alt text, replace it or delete it. New uploads go live with the first published document that
          uses them.
        </p>
      </header>
      <MediaGrid toast={toast} onOpenDoc={onOpenDoc} localeTitle={localeTitle} />
    </div>
  );
}

export function MediaPicker({ onPick, onClose, toast }: { onPick: (asset: Asset) => void; onClose: () => void; toast: Toast }) {
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog dialog-media"
        role="dialog"
        aria-modal="true"
        aria-label="Choose an image"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog-head">
          <h2>Choose an image</h2>
          <button type="button" className="btn btn-icon btn-ghost" aria-label="Close" onClick={onClose} autoFocus>
            <Icon name="close" />
          </button>
        </div>
        <MediaGrid onPick={onPick} toast={toast} />
      </div>
    </div>
  );
}
