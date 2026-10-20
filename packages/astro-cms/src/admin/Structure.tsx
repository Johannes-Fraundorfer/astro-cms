import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentType } from "../schema.ts";
import { api, imageUrl, type DocSummary, type Schema } from "./api.ts";
import { Icon } from "./Icon.tsx";
import { SortableList } from "./Sortable.tsx";
import { StatusDot } from "./Status.tsx";

export function Structure({
  schema,
  activeType,
  docs,
  selected,
  onType,
  onSelect,
  onCreate,
  mediaActive,
  onMedia,
  onBulk,
  toast,
}: {
  schema: Schema;
  activeType?: string;
  docs: DocSummary[] | null;
  selected?: { type: string; id: string };
  onType: (type: DocumentType) => void;
  onSelect: (doc: DocSummary) => void;
  onCreate: (type: DocumentType) => void;
  mediaActive: boolean;
  onMedia: () => void;
  /** Runs an action on several documents; resolves true when it ran, so the selection clears. */
  onBulk: (type: DocumentType, action: BulkAction, ids: string[]) => Promise<boolean>;
  toast: (message: string, tone?: "error" | "info") => void;
}) {
  const [order, setOrder] = useState(schema.typeOrder);
  const groups = useMemo(() => {
    // Arranged types first, in the saved order; new ones follow in config order.
    const rank = (t: DocumentType) => {
      const i = order.indexOf(t.name);
      return i === -1 ? order.length + schema.types.indexOf(t) : i;
    };
    const out = new Map<string, (DocumentType & { _key: string })[]>();
    for (const t of [...schema.types].sort((a, b) => rank(a) - rank(b))) {
      const group = t.group ?? "Content";
      out.set(group, [...(out.get(group) ?? []), { ...t, _key: t.name }]);
    }
    return [...out];
  }, [schema, order]);

  const reorder = (group: string, next: DocumentType[]) => {
    const all = groups.flatMap(([g, types]) => (g === group ? next : types)).map((t) => t.name);
    const previous = order;
    setOrder(all);
    api.saveTypeOrder(all).catch((err) => {
      setOrder(previous);
      toast(err instanceof Error ? err.message : "Couldn't save the order", "error");
    });
  };
  const type = mediaActive ? undefined : schema.types.find((t) => t.name === activeType);

  return (
    <div className={`structure${type?.kind === "collection" ? " has-list" : ""}`}>
      <nav className="structure-col structure-types" aria-label="Content types">
        <div className="col-head">
          <span className="col-title">Content</span>
        </div>
        {groups.map(([group, types]) => (
          <div key={group} className="type-group">
            <div className="type-group-title">{group}</div>
            <SortableList className="type-list" items={types} onReorder={(next) => reorder(group, next)} disabled={types.length < 2}>
              {(t, _, handle) => (
                <>
                  {handle}
                  <button
                    type="button"
                    className={`type-item${t.name === activeType ? " is-active" : ""}`}
                    aria-current={t.name === activeType ? "true" : undefined}
                    onClick={() => onType(t)}
                  >
                    <span className="type-icon">{t.icon ?? "•"}</span>
                    <span className="type-name">{t.title}</span>
                    {t.kind === "collection" && <Icon name="chevron" size={14} />}
                  </button>
                </>
              )}
            </SortableList>
          </div>
        ))}
        <div className="type-group">
          <div className="type-group-title">Assets</div>
          <button
            type="button"
            className={`type-item${mediaActive ? " is-active" : ""}`}
            aria-current={mediaActive ? "true" : undefined}
            onClick={onMedia}
          >
            <span className="type-icon">
              <Icon name="image" size={14} />
            </span>
            <span className="type-name">Media</span>
          </button>
        </div>
      </nav>
      {type?.kind === "collection" && (
        <DocList
          key={type.name}
          type={type}
          docs={docs}
          selected={selected}
          onSelect={onSelect}
          onCreate={() => onCreate(type)}
          onBulk={(action, ids) => onBulk(type, action, ids)}
        />
      )}
    </div>
  );
}

export type BulkAction = "delete" | "duplicate" | "unpublish";

function DocList({
  type,
  docs,
  selected,
  onSelect,
  onCreate,
  onBulk,
}: {
  type: DocumentType;
  docs: DocSummary[] | null;
  selected?: { type: string; id: string };
  onSelect: (doc: DocSummary) => void;
  onCreate: () => void;
  onBulk: (action: BulkAction, ids: string[]) => Promise<boolean>;
}) {
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const anchor = useRef<string | null>(null);
  const shown = (docs ?? []).filter(
    (d) => !q || `${d.title} ${d.subtitle ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  // Documents that went away (deleted elsewhere) leave the selection.
  useEffect(() => {
    if (!docs) return;
    setChecked((prev) => {
      const next = new Set([...prev].filter((id) => docs.some((d) => d.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [docs]);

  /** Shift-click selects everything between the last clicked row and this one. */
  const toggle = (id: string, range: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      const on = !prev.has(id);
      const from = anchor.current ? shown.findIndex((d) => d.id === anchor.current) : -1;
      const to = shown.findIndex((d) => d.id === id);
      if (range && from !== -1 && to !== -1) {
        for (const d of shown.slice(Math.min(from, to), Math.max(from, to) + 1)) on ? next.add(d.id) : next.delete(d.id);
      } else if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    anchor.current = id;
  };

  const run = async (action: BulkAction) => {
    setBusy(true);
    try {
      if (await onBulk(action, [...checked])) setChecked(new Set());
    } finally {
      setBusy(false);
    }
  };

  const selecting = checked.size > 0;
  const allShown = shown.length > 0 && shown.every((d) => checked.has(d.id));
  const anyPublished = (docs ?? []).some((d) => checked.has(d.id) && (d.status === "published" || d.status === "changed"));

  return (
    <section className={`structure-col structure-docs${selecting ? " is-selecting" : ""}`} aria-label={type.title}>
      {selecting ? (
        <div className="col-head bulk-bar">
          <label className="doc-check-all">
            <input
              type="checkbox"
              checked={allShown}
              aria-label={allShown ? "Clear selection" : "Select all"}
              onChange={() => setChecked(allShown ? new Set() : new Set(shown.map((d) => d.id)))}
            />
            <span className="col-title">{checked.size} selected</span>
          </label>
          <button type="button" className="btn btn-icon btn-ghost" aria-label="Clear selection" title="Clear selection" onClick={() => setChecked(new Set())}>
            <Icon name="close" />
          </button>
        </div>
      ) : (
        <div className="col-head">
          <span className="col-title">{type.title}</span>
          <button type="button" className="btn btn-icon btn-ghost" aria-label={`New ${type.title}`} title={`New ${type.title}`} onClick={onCreate}>
            <Icon name="plus" />
          </button>
        </div>
      )}
      {selecting ? (
        <div className="bulk-actions" role="toolbar" aria-label="Actions for selected documents">
          <button type="button" className="btn" disabled={busy} onClick={() => run("duplicate")}>
            <Icon name="copy" size={14} /> Duplicate
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !anyPublished}
            title={anyPublished ? undefined : "Nothing selected is published"}
            onClick={() => run("unpublish")}
          >
            <Icon name="eyeOff" size={14} /> Unpublish
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => run("delete")}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      ) : (
        <div className="search">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search list" aria-label={`Search ${type.title}`} />
        </div>
      )}
      <ul className="doc-list">
        {docs === null && <li className="muted pad">Loading…</li>}
        {docs?.length === 0 && <li className="muted pad">No documents yet.</li>}
        {shown.map((d) => {
          const active = selected?.type === d.type && selected.id === d.id;
          const isChecked = checked.has(d.id);
          return (
            <li key={d.id} className={`doc-row${isChecked ? " is-checked" : ""}`}>
              <label className="doc-check" title="Select (Shift-click for a range)">
                <input
                  type="checkbox"
                  checked={isChecked}
                  aria-label={`Select ${d.title}`}
                  onChange={() => {}}
                  onClick={(e) => toggle(d.id, e.shiftKey)}
                />
              </label>
              <button
                type="button"
                className={`doc-item${active ? " is-active" : ""}`}
                aria-current={active ? "true" : undefined}
                onClick={(e) => (selecting || e.ctrlKey || e.metaKey ? toggle(d.id, e.shiftKey) : onSelect(d))}
              >
                <span className="block-icon">{d.media ? <img src={imageUrl(d.media)} alt="" /> : <Icon name="doc" />}</span>
                <span className="block-text">
                  <span className="block-title">{d.title}</span>
                  <span className="block-subtitle">{d.path ?? d.subtitle ?? d.id}</span>
                </span>
                <StatusDot status={d.status} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
