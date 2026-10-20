import { useEffect, useRef, useState } from "react";
import { getType, linkTargets, newKey, type Field, type LinkValue } from "../schema.ts";
import { api, imageUrl, type DocSummary } from "./api.ts";
import { useForm } from "./context.ts";
import { Icon } from "./Icon.tsx";
import type { Path } from "./paths.ts";
import { SortableList } from "./Sortable.tsx";
import { StatusDot } from "./Status.tsx";

type Ref = { _ref: string };
type KeyedRef = Ref & { _key: string };

function RefCard({ docRef: r, onOpen }: { docRef: string; onOpen?: () => void }) {
  const { index, config } = useForm();
  const doc = index.get(r);
  const type = getType(config, r.slice(0, r.indexOf(":")));
  return (
    <button type="button" className="ref-card" onClick={onOpen} disabled={!onOpen}>
      <span className="block-icon">{doc?.media ? <img src={imageUrl(doc.media)} alt="" /> : (type?.icon ?? <Icon name="doc" />)}</span>
      <span className="block-text">
        <span className="block-title">{doc?.title ?? <em>Missing document</em>}</span>
        <span className="block-subtitle">{type?.title}</span>
      </span>
      {doc && <StatusDot status={doc.status} />}
    </button>
  );
}

export function ReferenceField({ field, value, onChange }: { field: Extract<Field, { type: "reference" }>; value?: Ref; onChange: (v: unknown) => void }) {
  const { readOnly } = useForm();
  const [picking, setPicking] = useState(false);
  return (
    <div className="refs">
      {value?._ref ? (
        <div className="ref-row">
          <RefCard docRef={value._ref} />
          {!readOnly && (
            <button type="button" className="btn btn-icon btn-ghost" aria-label="Remove reference" onClick={() => onChange(undefined)}>
              <Icon name="close" />
            </button>
          )}
        </div>
      ) : null}
      {!readOnly && (
        <button type="button" className="btn btn-add" onClick={() => setPicking(true)}>
          <Icon name="link" /> {value?._ref ? "Replace" : "Choose"}
        </button>
      )}
      {picking && (
        <Picker
          types={field.to}
          exclude={[]}
          onClose={() => setPicking(false)}
          onPick={(d) => {
            onChange({ _ref: `${d.type}:${d.id}` });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

export function ReferencesField({ field, value, path }: { field: Extract<Field, { type: "references" }>; value?: KeyedRef[]; path: Path }) {
  const { readOnly, onChange } = useForm();
  const [picking, setPicking] = useState(false);
  const items = value ?? [];
  return (
    <div className="refs">
      {items.length === 0 && <p className="blocks-empty">Nothing linked yet.</p>}
      <SortableList items={items} disabled={readOnly} onReorder={(next) => onChange(path, next)}>
        {(item, i, handle) => (
          <div className="ref-row">
            {handle}
            <RefCard docRef={item._ref} />
            {!readOnly && (
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                aria-label="Remove"
                onClick={() => onChange(path, items.filter((_, j) => j !== i))}
              >
                <Icon name="close" />
              </button>
            )}
          </div>
        )}
      </SortableList>
      {!readOnly && (
        <button type="button" className="btn btn-add" onClick={() => setPicking(true)}>
          <Icon name="plus" /> Add
        </button>
      )}
      {picking && (
        <Picker
          types={field.to}
          exclude={items.map((i) => i._ref)}
          onClose={() => setPicking(false)}
          onPick={(d) => {
            onChange(path, [...items, { _key: newKey(), _ref: `${d.type}:${d.id}` }]);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

/** A page on the site (follows its slug and language) or a typed URL. */
export function LinkField({ id, field, value: raw, onChange: set }: { id: string; field: Extract<Field, { type: "link" }>; value?: LinkValue | string; onChange: (v: unknown) => void }) {
  const { readOnly, config } = useForm();
  // Older content stored a plain path.
  const value: LinkValue | undefined = typeof raw === "string" ? { href: raw } : raw;
  const onChange = (next: LinkValue | undefined) => set(next && value?.newTab ? { ...next, newTab: true } : next);
  const [mode, setMode] = useState<"page" | "url">(value?.href ? "url" : "page");
  const [picking, setPicking] = useState(false);
  return (
    <div className="link-field">
      <div className="segmented" role="group" aria-label="Link to">
        {(["page", "url"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? "is-active" : ""}
            aria-pressed={mode === m}
            disabled={readOnly}
            onClick={() => {
              if (m === mode) return;
              setMode(m);
              onChange(undefined);
            }}
          >
            {m === "page" ? "Page" : "URL"}
          </button>
        ))}
      </div>
      {mode === "url" ? (
        <input
          id={id}
          className="input"
          type="text"
          inputMode="url"
          value={value?.href ?? ""}
          placeholder="https://… or mailto:…"
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value ? { href: e.target.value } : undefined)}
        />
      ) : (
        <div className="refs">
          {value?._ref && (
            <div className="ref-row">
              <RefCard docRef={value._ref} />
              {!readOnly && (
                <button type="button" className="btn btn-icon btn-ghost" aria-label="Remove link" onClick={() => onChange(undefined)}>
                  <Icon name="close" />
                </button>
              )}
            </div>
          )}
          {!readOnly && (
            <button type="button" className="btn btn-add" onClick={() => setPicking(true)}>
              <Icon name="link" /> {value?._ref ? "Change page" : "Choose page"}
            </button>
          )}
        </div>
      )}
      {(value?._ref || value?.href) && (
        <label className="check">
          <input
            type="checkbox"
            checked={!!value?.newTab}
            disabled={readOnly}
            onChange={(e) => set(e.target.checked ? { ...value, newTab: true } : { _ref: value?._ref, href: value?.href })}
          />
          Open in a new tab
        </label>
      )}
      {picking && (
        <Picker
          types={linkTargets(config, field)}
          exclude={[]}
          onClose={() => setPicking(false)}
          onPick={(d) => {
            onChange({ _ref: `${d.type}:${d.id}` });
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

function Picker({ types, exclude, onPick, onClose }: { types: string[]; exclude: string[]; onPick: (d: DocSummary) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DocSummary[] | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const t = setTimeout(() => api.search(types, q).then(setResults).catch(() => setResults([])), 150);
    return () => clearTimeout(t);
  }, [q, types.join(",")]);

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Choose a document" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="dialog-head">
          <h2>Choose a document</h2>
          <button type="button" className="btn btn-icon btn-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="search">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search documents" />
        </div>
        <ul className="picker-list">
          {results === null && <li className="muted pad">Loading…</li>}
          {results?.length === 0 && <li className="muted pad">No matches.</li>}
          {results
            ?.filter((d) => !exclude.includes(`${d.type}:${d.id}`))
            .map((d) => (
              <li key={`${d.type}:${d.id}`}>
                <button type="button" className="doc-item" onClick={() => onPick(d)}>
                  <span className="block-icon">{d.media ? <img src={imageUrl(d.media)} alt="" /> : <Icon name="doc" />}</span>
                  <span className="block-text">
                    <span className="block-title">{d.title}</span>
                    {d.subtitle && <span className="block-subtitle">{d.subtitle}</span>}
                  </span>
                  <StatusDot status={d.status} />
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
