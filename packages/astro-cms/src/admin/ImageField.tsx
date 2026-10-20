import { useId, useRef, useState } from "react";
import { imageSrc, type ImageValue } from "../schema.ts";
import { api, imageUrl } from "./api.ts";
import { useForm } from "./context.ts";
import { Icon } from "./Icon.tsx";
import { MediaPicker } from "./Media.tsx";

export function ImageField({ value, onChange }: { value?: ImageValue; onChange: (v: unknown) => void }) {
  const { readOnly, toast } = useForm();
  const input = useRef<HTMLInputElement>(null);
  const altId = useId();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);

  const src = imageSrc(value);
  const alt = typeof value === "object" && value ? (value.alt ?? "") : "";

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const { src: uploaded } = await api.upload(file);
      onChange({ src: uploaded, alt });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`image-field${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        if (readOnly) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!readOnly) upload(e.dataTransfer.files[0]);
      }}
    >
      {src ? (
        <img className="image-preview" src={imageUrl(src)} alt={alt} />
      ) : (
        <div className="image-placeholder">
          <Icon name="image" size={28} />
          <span>{readOnly ? "No image" : "Drop an image here"}</span>
        </div>
      )}
      {!readOnly && (
        <div className="image-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : src ? "Replace" : "Upload"}
          </button>
          <button type="button" className="btn" onClick={() => setPicking(true)}>
            Choose from library
          </button>
          {src && (
            <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>
              Remove
            </button>
          )}
          {src?.startsWith("/_cms/asset/") && <span className="muted small">Added to the site on publish</span>}
        </div>
      )}
      {src && (
        <div className="image-alt">
          <label className="field-label" htmlFor={altId}>
            Alt text
          </label>
          <p className="field-description">Describe the image for screen readers and search engines. Leave empty if it's decorative.</p>
          <input
            id={altId}
            className="input"
            type="text"
            value={alt}
            readOnly={readOnly}
            placeholder="e.g. Barista pouring latte art in the Northwind café"
            onChange={(e) => onChange({ src, alt: e.target.value })}
          />
        </div>
      )}
      {picking && (
        <MediaPicker
          toast={toast}
          onClose={() => setPicking(false)}
          onPick={(asset) => {
            // The alt text this image had elsewhere is usually right here too.
            onChange({ src: asset.value, alt: asset.alt ?? "" });
            setPicking(false);
          }}
        />
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml"
        hidden
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
