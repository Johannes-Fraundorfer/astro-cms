import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";

export interface CanvasMessage {
  type: "select" | "edit" | "navigate" | "ready" | "section";
  doc?: string | null;
  path?: string;
  kind?: string;
  label?: string;
  value?: string;
  open?: boolean;
  /** For `section`: what to do with the list item at `path`. */
  action?: "up" | "down" | "duplicate" | "remove" | "add";
}

export interface CanvasHandle {
  patch: (doc: string, path: string, value: unknown, kind: string) => void;
  highlight: (doc: string, path: string) => void;
  reload: () => void;
}

const widths = { desktop: "100%", tablet: "768px", phone: "375px" } as const;

export const Canvas = forwardRef<CanvasHandle, { path: string; onMessage: (msg: CanvasMessage) => void }>(
  function Canvas({ path, onMessage }, ref) {
    const frame = useRef<HTMLIFrameElement>(null);
    const [width, setWidth] = useState<keyof typeof widths>("desktop");
    const [loading, setLoading] = useState(true);
    const handler = useRef(onMessage);
    handler.current = onMessage;

    const post = (msg: object) =>
      frame.current?.contentWindow?.postMessage({ source: "cms-dashboard", ...msg }, location.origin);

    useImperativeHandle(ref, () => ({
      patch: (doc, p, value, kind) => post({ type: "patch", doc, path: p, value, kind }),
      highlight: (doc, p) => post({ type: "highlight", doc, path: p }),
      reload: () => {
        post({ type: "save-scroll" });
        try {
          frame.current?.contentWindow?.location.reload();
        } catch {
          /* cross-origin navigation; ignore */
        }
      },
    }));

    useEffect(() => {
      const listen = (e: MessageEvent) => {
        if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
        if (e.data?.source !== "cms-canvas") return;
        if (e.data.type === "ready") setLoading(false);
        handler.current(e.data as CanvasMessage);
      };
      addEventListener("message", listen);
      return () => removeEventListener("message", listen);
    }, []);

    useEffect(() => setLoading(true), [path]);

    const src = `/_cms/preview${path === "/" ? "/" : path}`;

    return (
      <div className="canvas">
        <div className="canvas-bar">
          <span className="canvas-url" title={path}>
            {path}
          </span>
          <div className="segmented" role="group" aria-label="Viewport">
            {(Object.keys(widths) as (keyof typeof widths)[]).map((w) => (
              <button key={w} type="button" className={w === width ? "is-active" : ""} aria-pressed={w === width} onClick={() => setWidth(w)}>
                {w[0].toUpperCase() + w.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-icon btn-ghost" aria-label="Reload preview" title="Reload preview" onClick={() => frame.current?.contentWindow?.location.reload()}>
            <Icon name="refresh" />
          </button>
        </div>
        <div className="canvas-stage">
          {loading && <div className="canvas-loading">Loading preview…</div>}
          <iframe ref={frame} title="Page preview" src={src} style={{ width: widths[width] }} />
        </div>
        <p className="canvas-hint">Click text to edit it in place. Click a section's purple tab to open its fields; its buttons move, add, duplicate or remove sections.</p>
      </div>
    );
  },
);
