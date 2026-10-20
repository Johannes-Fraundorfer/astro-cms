import { useId, useRef, useState } from "react";
import type { VideoValue } from "../schema.ts";
import { api, features } from "./api.ts";
import { useForm } from "./context.ts";
import { Icon } from "./Icon.tsx";

/** How many parts upload at once. */
const PARALLEL = 3;

export function VideoField({ value, onChange }: { value?: VideoValue; onChange: (v: unknown) => void }) {
  const { readOnly, toast } = useForm();
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const urlId = useId();
  const titleId = useId();
  const [progress, setProgress] = useState<number>();
  const [over, setOver] = useState(false);

  const src = value?.src ?? "";
  const title = value?.title ?? "";
  const set = (next: VideoValue) => onChange(next.src || next.title ? next : undefined);
  const canUpload = features.videoUploads && !readOnly;
  const busy = progress !== undefined;

  const upload = async (file?: File) => {
    if (!file || busy) return;
    cancelled.current = false;
    setProgress(0);
    let started: { key: string; uploadId: string } | undefined;
    try {
      const { key, uploadId, partSize } = await api.videoStart(file);
      started = { key, uploadId };
      const count = Math.ceil(file.size / partSize);
      const parts: { partNumber: number; etag: string }[] = [];
      let next = 1;
      let sent = 0;
      const worker = async () => {
        while (next <= count) {
          if (cancelled.current) throw new Error("cancelled");
          const n = next++;
          const chunk = file.slice((n - 1) * partSize, Math.min(n * partSize, file.size));
          parts.push(await api.videoPart(key, uploadId, n, chunk));
          sent += chunk.size;
          setProgress(sent / file.size);
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, count) }, worker));
      parts.sort((a, b) => a.partNumber - b.partNumber);
      const { src: uploaded } = await api.videoComplete(key, uploadId, parts);
      set({ src: uploaded, title });
    } catch (err) {
      if (started) api.videoAbort(started.key, started.uploadId).catch(() => {});
      if (!cancelled.current) toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setProgress(undefined);
    }
  };

  return (
    <div
      className={`image-field${over ? " is-over" : ""}`}
      onDragOver={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setOver(false);
        upload(e.dataTransfer.files[0]);
      }}
    >
      {busy ? (
        <div className="image-placeholder">
          <span>Uploading… {Math.round(progress * 100)}%</span>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      ) : src ? (
        // Keyed by source, so a new link loads instead of keeping the old video.
        <video key={src} className="image-preview video-preview" src={src} controls muted playsInline preload="metadata" />
      ) : (
        <div className="image-placeholder">
          <Icon name="video" size={28} />
          <span>{readOnly ? "No video" : canUpload ? "Drop a video here or paste a link" : "Paste a video link"}</span>
        </div>
      )}
      {!readOnly && (
        <div className="image-actions">
          {canUpload &&
            (busy ? (
              <button type="button" className="btn" onClick={() => (cancelled.current = true)}>
                Cancel upload
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => input.current?.click()}>
                {src ? "Replace" : "Upload"}
              </button>
            ))}
          {src && !busy && (
            <button type="button" className="btn btn-ghost" onClick={() => onChange(undefined)}>
              Remove
            </button>
          )}
        </div>
      )}
      <div className="image-alt">
        <label className="field-label" htmlFor={urlId}>
          Video link
        </label>
        <p className="field-description">An MP4 or WebM file on a CDN. HLS streams (.m3u8) only preview in Safari.</p>
        <input
          id={urlId}
          className="input"
          type="url"
          inputMode="url"
          value={src}
          readOnly={readOnly || busy}
          placeholder="https://cdn.example.com/hero.mp4"
          onChange={(e) => set({ src: e.target.value, title })}
        />
      </div>
      {src && (
        <div className="image-alt">
          <label className="field-label" htmlFor={titleId}>
            Title
          </label>
          <p className="field-description">Describes the video for screen readers. Leave empty if it's decorative.</p>
          <input
            id={titleId}
            className="input"
            type="text"
            value={title}
            readOnly={readOnly}
            placeholder="e.g. Tour of the Northwind café"
            onChange={(e) => set({ src, title: e.target.value })}
          />
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-m4v"
        hidden
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
