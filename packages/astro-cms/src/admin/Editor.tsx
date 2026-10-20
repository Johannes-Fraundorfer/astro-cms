import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  emptyData,
  getBlock,
  getType,
  isLocalized,
  localizePath,
  newKey,
  previewOf,
  refKey,
  splitStorageId,
  storageId,
  type BlockType,
  type CmsConfig,
} from "../schema.ts";
import { ApiError, api, timeAgo, type Data, type Deploy, type DocDetail, type DocSummary, type Locale } from "./api.ts";
import { FormContext, type FormApi } from "./context.ts";
import { FieldList } from "./Form.tsx";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Canvas, type CanvasHandle, type CanvasMessage } from "./Canvas.tsx";
import { Icon } from "./Icon.tsx";
import { Menu } from "./Menu.tsx";
import { StatusDot } from "./Status.tsx";
import { enclosingBlock, getIn, parsePath, pathKey, resolveTarget, setIn, type Path } from "./paths.ts";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
type SectionAction = "up" | "down" | "duplicate" | "remove" | "add";

const PATCHABLE = new Set(["string", "text", "url", "richText"]);

export function Editor({
  config,
  target,
  locale,
  locales,
  index,
  onChanged,
  onOpenDoc,
  onDeleted,
  onPublished,
  pagePath,
  onPagePath,
  toast,
}: {
  config: CmsConfig;
  target: { type: string; id: string };
  locale: string;
  locales: Locale[];
  index: Map<string, DocSummary>;
  onChanged: (doc: DocSummary) => void;
  onOpenDoc: (type: string, id: string, locale?: string) => void;
  onDeleted: (doc: DocSummary) => void;
  onPublished: (deploy: Deploy, title: string) => void;
  /** The last page shown on the canvas, without a locale prefix: global types (navigation, footer) preview on it. */
  pagePath?: string;
  onPagePath: (path: string) => void;
  toast: FormApi["toast"];
}) {
  const type = getType(config, target.type)!;
  const localized = isLocalized(config, type);
  // The canvas marks each document by where this locale's version is stored: `home:de/home`.
  const ref = refKey(target.type, localized ? storageId(config, target.id, locale) : target.id);
  const localeTitle = (code: string) => locales.find((l) => l.code === code)?.title ?? code;

  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [data, setData] = useState<Data>({});
  const [tab, setTab] = useState<"draft" | "published">("draft");
  const [save, setSave] = useState<SaveState>("idle");
  const [errors, setErrors] = useState(new Map<string, string>());
  const [focus, setFocus] = useState<Path>();
  const [adding, setAdding] = useState<{ list: Path; index: number; blocks: BlockType[] } | null>(null);
  const [canvasPath, setCanvasPath] = useState<string | undefined>();
  const [publishing, setPublishing] = useState(false);
  const [showUsedBy, setShowUsedBy] = useState(false);

  const canvas = useRef<CanvasHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useRef(data);
  const current = useRef({ ...target, locale });
  current.current = { ...target, locale };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const needsReload = useRef(false);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  /** The unsaved edit, tagged with its document and locale so a switch mid-save can't misfile it. */
  const pending = useRef<{ type: string; id: string; locale: string; data: Data } | null>(null);
  /** A field to scroll to once the panel has rendered it. */
  const reveal = useRef<{ key: string; focusInput: boolean } | null>(null);
  /** Set while the canvas itself selected something, so it isn't scrolled to what it just showed. */
  const fromCanvas = useRef<string | null>(null);

  /* ------------------------------ Loading ------------------------------ */

  useEffect(() => {
    let live = true;
    setDetail(null);
    setFocus(undefined);
    setErrors(new Map());
    setTab("draft");
    setSave("idle");
    api
      .get(target.type, target.id)
      .then((d) => {
        if (!live) return;
        // A missing translation starts from the default locale's content; the first edit saves it as the translation.
        const initial = d.draft ?? d.published ?? d.fallback ?? {};
        latest.current = initial;
        setDetail(d);
        setData(initial);
        setCanvasPath(d.path);
      })
      .catch((err) => toast(err.message, "error"));
    return () => {
      live = false;
    };
  }, [ref]);

  /* ------------------------------ Saving ------------------------------- */

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const job = pending.current;
    if (!job) return saving.current;
    pending.current = null;
    const isCurrent = () =>
      current.current.type === job.type && current.current.id === job.id && current.current.locale === job.locale;
    const run = saving.current.then(async () => {
      if (isCurrent()) setSave("saving");
      try {
        const d = await api.save(job.type, job.id, job.data, job.locale);
        if (isCurrent()) onChanged(d);
        if (!isCurrent()) return;
        setDetail(d);
        setSave(pending.current ? "pending" : "saved");
        if (needsReload.current) {
          needsReload.current = false;
          canvas.current?.reload();
        }
      } catch (err) {
        if (isCurrent()) setSave("error");
        toast(err instanceof Error ? err.message : "Saving failed", "error");
      }
    });
    saving.current = run;
    return run;
  }, []);

  useEffect(() => () => void flush(), [ref]);

  const onChange = useCallback(
    (path: Path, value: unknown, fromCanvas = false) => {
      const next = setIn(latest.current, path, value);
      latest.current = next;
      pending.current = { type: target.type, id: target.id, locale, data: next };
      setData(next);
      setErrors((prev) => {
        if (!prev.has(pathKey(path))) return prev;
        const next = new Map(prev);
        next.delete(pathKey(path));
        return next;
      });
      const t = resolveTarget(config, type.fields, next, path);
      const patchable = t?.kind === "field" && PATCHABLE.has(t.field.type);
      if (!fromCanvas) {
        if (patchable) canvas.current?.patch(ref, pathKey(path), value, t.field.type === "richText" ? "rich" : "text");
        else needsReload.current = true;
      }
      setSave("pending");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [config, type, ref, locale, target.type, target.id, flush],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        flush();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [flush]);

  /* ------------------------------ Actions ------------------------------ */

  const publish = async () => {
    setPublishing(true);
    try {
      await flush();
      const d = await api.publish(target.type, target.id);
      latest.current = d.draft ?? d.published ?? {};
      setDetail(d);
      setData(latest.current);
      setErrors(new Map());
      onChanged(d);
      if (d.deploy && config.publish?.target === "github") onPublished(d.deploy, d.title);
      toast("Published");
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) {
        setErrors(new Map(err.fieldErrors.map((e) => [e.path, e.message])));
        setTab("draft");
        const first = err.fieldErrors[0].path;
        const block = enclosingBlock(config, type.fields, latest.current, parsePath(first));
        openItem(block?.path, { key: first, focusInput: false });
      }
      toast(err instanceof Error ? err.message : "Publishing failed", "error");
    } finally {
      setPublishing(false);
    }
  };

  const discard = async () => {
    if (!confirm("Discard all unpublished changes to this document?")) return;
    clearTimeout(timer.current);
    pending.current = null;
    await saving.current;
    const d = await api.discard(target.type, target.id);
    latest.current = d.published ?? {};
    setDetail(d);
    setData(latest.current);
    setSave("idle");
    onChanged(d);
    canvas.current?.reload();
  };

  const unpublish = async () => {
    if (!detail) return;
    const scope = localized && locale === config.i18n?.defaultLocale && locales.length > 1 ? " and its translations" : "";
    if (!confirm(`Unpublish "${detail.title}"${scope}? It comes off the live site with the next deploy and stays here as a draft.`)) return;
    await flush();
    try {
      const d = await api.unpublish(target.type, target.id);
      latest.current = d.draft ?? {};
      setDetail(d);
      setData(latest.current);
      setTab("draft");
      onChanged(d);
      if (d.deploy && config.publish?.target === "github") onPublished(d.deploy, d.title);
      toast("Unpublished. It's a draft now.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Unpublish failed", "error");
    }
  };

  const translate = async () => {
    clearTimeout(timer.current);
    pending.current = null;
    await saving.current;
    try {
      const d = await api.translate(target.type, target.id);
      latest.current = d.draft ?? {};
      setDetail(d);
      setData(latest.current);
      setSave("saved");
      onChanged(d);
      canvas.current?.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't start the translation", "error");
    }
  };

  const duplicate = async () => {
    await flush();
    const d = await api.duplicate(target.type, target.id);
    onChanged(d);
    onOpenDoc(d.type, d.id);
  };

  const remove = async () => {
    if (!detail) return;
    const live = detail.published ? " It will also be removed from the live site." : "";
    const scope =
      localized && locale !== config.i18n?.defaultLocale
        ? ` (${localeTitle(locale)} version only)`
        : localized
          ? " and all its translations"
          : "";
    if (!confirm(`Delete "${detail.title}"${scope}?${live} This can't be undone.`)) return;
    clearTimeout(timer.current);
    pending.current = null;
    await saving.current;
    try {
      await api.remove(target.type, target.id);
      if (type.kind === "singleton") {
        // A single page's translation: the page stays, now showing the default locale again.
        const d = await api.get(target.type, target.id);
        latest.current = d.draft ?? d.published ?? d.fallback ?? {};
        setDetail(d);
        setData(latest.current);
        setSave("idle");
        onChanged(d);
        canvas.current?.reload();
        toast(`Deleted the ${localeTitle(locale)} version`);
        return;
      }
      onDeleted(detail);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  };

  /* --------------------------- Panel navigation ------------------------- */

  /** Shows a block item in the form panel (or the document itself), optionally scrolling to one of its fields. */
  const openItem = useCallback((path?: Path, field?: { key: string; focusInput: boolean }) => {
    setFocus(path?.length ? path : undefined);
    reveal.current = field ?? null;
    if (!field) scroller.current?.scrollTo({ top: 0 });
  }, []);

  const focusTarget = focus ? resolveTarget(config, type.fields, data, focus) : undefined;
  const focused = focusTarget?.kind === "block" ? focusTarget : undefined;

  // The focused item went away (removed, or the list was reordered from elsewhere): back to the document.
  useEffect(() => {
    if (focus && detail && !focused) setFocus(undefined);
  }, [focus, focused, detail]);

  useLayoutEffect(() => {
    const r = reveal.current;
    if (!r) return;
    reveal.current = null;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(r.key)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.remove("is-flash");
    void el.offsetWidth;
    el.classList.add("is-flash");
    if (r.focusInput) el.querySelector<HTMLElement>("input, textarea, select, [contenteditable=true]")?.focus({ preventScroll: true });
  });

  const crumbs = useMemo(() => {
    if (!focus) return [];
    const out: { path: Path; label: string }[] = [];
    for (let n = 1; n <= focus.length; n++) {
      const t = resolveTarget(config, type.fields, data, focus.slice(0, n));
      if (t?.kind === "block") out.push({ path: t.path, label: t.value?._label || t.block.title });
    }
    return out;
  }, [focus, data, config, type]);

  /* ------------------------------ Sections ------------------------------ */

  const listOf = (path: Path) => {
    const list = path.slice(0, -1);
    const t = resolveTarget(config, type.fields, latest.current, list);
    const items = getIn(latest.current, list);
    if (t?.kind !== "field" || t.field.type !== "blocks" || !Array.isArray(items)) return undefined;
    return { list, items: items as Data[], i: path[path.length - 1] as number, of: t.field.of };
  };

  const sectionAction = (action: SectionAction, path: Path) => {
    const hit = listOf(path);
    if (!hit) return;
    const { list, items, i, of } = hit;
    const move = (to: number) => {
      if (to < 0 || to >= items.length) return;
      const next = [...items];
      [next[i], next[to]] = [next[to], next[i]];
      onChange(list, next);
      openItem([...list, to]);
    };
    if (action === "up") return move(i - 1);
    if (action === "down") return move(i + 1);
    if (action === "duplicate") {
      onChange(list, [...items.slice(0, i + 1), { ...structuredClone(items[i]), _key: newKey() }, ...items.slice(i + 1)]);
      return openItem([...list, i + 1]);
    }
    if (action === "remove") {
      const block = getBlock(config, items[i]?._type);
      const name = (items[i]?._label as string) || block?.title || "this item";
      if (!confirm(`Remove "${name}" from the page?`)) return;
      onChange(list, items.filter((_, j) => j !== i));
      return openItem(undefined);
    }
    const blocks = of.map((n) => getBlock(config, n)).filter((b): b is BlockType => !!b);
    if (blocks.length === 1) return insert(list, i + 1, blocks[0]);
    setAdding({ list, index: i + 1, blocks });
  };

  const insert = (list: Path, at: number, block: BlockType) => {
    const items = (getIn(latest.current, list) as Data[] | undefined) ?? [];
    const item = { _type: block.name, _key: newKey(), ...emptyData(block.fields) };
    onChange(list, [...items.slice(0, at), item, ...items.slice(at)]);
    setAdding(null);
    openItem([...list, at]);
  };

  /* ------------------------------ Canvas ------------------------------- */

  // Remember the page on screen, so the navigation or footer opened from it stays on it.
  useEffect(() => {
    if (!type.url || !canvasPath) return;
    const prefix = locales.find((l) => l.code !== config.i18n?.defaultLocale && (canvasPath === `/${l.code}` || canvasPath.startsWith(`/${l.code}/`)));
    onPagePath(prefix ? canvasPath.slice(prefix.code.length + 1) || "/" : canvasPath);
  }, [canvasPath]);

  const onCanvas = (msg: CanvasMessage) => {
    if (msg.type === "navigate" && msg.path) {
      api.resolve(msg.path).then((hit) => (hit ? onOpenDoc(hit.type, hit.id, hit.locale) : setCanvasPath(msg.path)));
      return;
    }
    if (!msg.path || !msg.doc) return;
    if (msg.doc !== ref) {
      if (msg.type === "select") {
        const i = msg.doc.indexOf(":");
        const { id, locale: loc } = splitStorageId(config, msg.doc.slice(i + 1));
        onOpenDoc(msg.doc.slice(0, i), id, loc);
      }
      return;
    }
    const path = parsePath(msg.path);
    if (msg.type === "edit") return onChange(path, msg.value, true);
    fromCanvas.current = msg.type === "select" ? msg.path : null;
    if (msg.type === "section" && msg.action) return sectionAction(msg.action as SectionAction, path);
    if (msg.type === "select") {
      const t = resolveTarget(config, type.fields, latest.current, path);
      if (t?.kind === "block") return openItem(path);
      const block = enclosingBlock(config, type.fields, latest.current, path);
      // Text being edited in place keeps its focus; anything else focuses its input in the panel.
      openItem(block?.path, { key: pathKey(path), focusInput: !!msg.open });
    }
  };

  // Opening an item from the panel shows it on the canvas too.
  const focusKey = focus ? pathKey(focus) : undefined;
  useEffect(() => {
    if (focusKey && focusKey !== fromCanvas.current) canvas.current?.highlight(ref, focusKey);
    fromCanvas.current = null;
  }, [focusKey, ref]);

  /* ------------------------------- Render ------------------------------ */

  const readOnly = tab === "published";
  const shown = readOnly ? (detail?.published ?? {}) : data;
  const formApi: FormApi = useMemo(
    () => ({ config, readOnly, errors, onChange, openItem, index, toast }),
    [config, readOnly, errors, onChange, openItem, index, toast],
  );

  if (!detail) return <div className="editor-loading">Loading…</div>;

  const missing = detail.status === "missing" && save === "idle";
  const title = previewOf(type.preview, data).title || detail.title;
  const hasDraft = save === "pending" || save === "saving" || !!detail.draft;
  const saveLabel =
    save === "pending" ? "Unsaved changes" : save === "saving" ? "Saving…" : save === "error" ? "Not saved" : hasDraft ? "Draft saved" : "";

  // Types without a page of their own show on the page last open, or their preview page.
  const hostPath = type.url ? canvasPath : localizePath(config, pagePath ?? type.previewPath, locale);
  const canvasBody = !hostPath && !type.url ? (
    <div className="empty">
      <p>{type.title} has no page of its own.</p>
      <p className="muted">Edit it in the form on the right.</p>
    </div>
  ) : hostPath ? (
    <Canvas ref={canvas} path={hostPath} onMessage={onCanvas} />
  ) : (
    <div className="empty">Fill in the fields used in the URL ({type.url}) to preview this page.</div>
  );

  const translations = localized && locales.length > 1 && (
    <div className="translations" aria-label="Translations">
      {locales.map((l) => {
        const status = detail.translations[l.code] ?? "missing";
        return (
          <button
            key={l.code}
            type="button"
            className={`translation${l.code === locale ? " is-active" : ""}`}
            aria-current={l.code === locale ? "true" : undefined}
            title={`${l.title}${status === "missing" ? ": not translated yet" : ""}`}
            onClick={() => l.code !== locale && onOpenDoc(target.type, target.id, l.code)}
          >
            {l.code.toUpperCase()} <StatusDot status={status} />
          </button>
        );
      })}
    </div>
  );

  return (
    <FormContext.Provider value={formApi}>
      <Group className="editor-split" orientation="horizontal">
        <Panel id="canvas" minSize={320} className="pane pane-canvas">
          {canvasBody}
        </Panel>
        <Separator className="sep" />
        <Panel id="form" defaultSize="29.4" minSize={300} className="pane pane-form">
          <div className="editor">
            <header className="editor-head">
              <div className="tabs" role="tablist" aria-label="Version">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "published"}
                  className={`tab${tab === "published" ? " is-active" : ""}`}
                  disabled={!detail.published}
                  onClick={() => setTab("published")}
                >
                  <span className="dot dot-live" /> Published
                </button>
                <button type="button" role="tab" aria-selected={tab === "draft"} className={`tab${tab === "draft" ? " is-active" : ""}`} onClick={() => setTab("draft")}>
                  <span className="dot dot-draft" /> Draft
                </button>
              </div>
              <div className="editor-actions">
                {detail.publishedPath && (
                  <a className="btn btn-icon btn-ghost" href={detail.publishedPath} target="_blank" rel="noreferrer" title="Open live page" aria-label="Open live page">
                    <Icon name="external" />
                  </a>
                )}
                <Menu
                  label="Document actions"
                  trigger={<Icon name="more" />}
                  items={[
                    ...(type.kind === "collection" ? [{ label: "Duplicate", icon: <Icon name="copy" />, onSelect: duplicate }] : []),
                    { label: "Discard changes", icon: <Icon name="undo" />, disabled: !detail.draft || !detail.published, onSelect: discard },
                    ...(type.kind === "collection" ? [{ label: "Unpublish", icon: <Icon name="eyeOff" />, disabled: !detail.published, onSelect: unpublish }] : []),
                    ...(type.kind === "collection" || (localized && locale !== config.i18n?.defaultLocale && detail.status !== "missing")
                      ? [{ label: type.kind === "collection" ? "Delete" : "Delete translation", icon: <Icon name="trash" />, danger: true, onSelect: remove }]
                      : []),
                  ]}
                />
              </div>
            </header>

            {focused && (
              <nav className="crumbs" aria-label="Location in document">
                <button type="button" className="btn btn-icon btn-ghost" aria-label="Back" title="Back" onClick={() => openItem(crumbs.length > 1 ? crumbs[crumbs.length - 2].path : undefined)}>
                  <Icon name="back" />
                </button>
                <button type="button" className="crumb" onClick={() => openItem(undefined)}>
                  {title}
                </button>
                {crumbs.map((c, n) => (
                  <span key={pathKey(c.path)} className="crumb-wrap">
                    <Icon name="chevron" size={12} />
                    <button type="button" className="crumb" aria-current={n === crumbs.length - 1 ? "true" : undefined} onClick={() => openItem(c.path)}>
                      {c.label}
                    </button>
                  </span>
                ))}
              </nav>
            )}

            <div className="editor-scroll" ref={scroller}>
              <div className="editor-doc">
                {focused ? (
                  <ItemHead
                    key={pathKey(focused.path)}
                    block={focused.block}
                    label={focused.value?._label}
                    readOnly={readOnly}
                    canMove={listOf(focused.path)}
                    onRename={(label) => onChange([...focused.path, "_label"], label || undefined)}
                    onAction={(a) => sectionAction(a, focused.path)}
                  />
                ) : (
                  <>
                    <p className="editor-type">
                      {type.icon} {type.title}
                    </p>
                    <h1 className="editor-title">{title}</h1>
                    {translations}
                    {missing && (
                      <div className="notice notice-translate">
                        <p>
                          <strong>No {localeTitle(locale)} version yet.</strong> The page shows the {localeTitle(config.i18n?.defaultLocale ?? "en")} content
                          below until a translation is published. Editing any field starts the translation.
                        </p>
                        <button type="button" className="btn" onClick={translate}>
                          <Icon name="globe" size={14} /> Start translation
                        </button>
                      </div>
                    )}
                    {detail.usedBy.length > 0 && (
                      <div className="used-by">
                        <button type="button" className="used-by-toggle" aria-expanded={showUsedBy} onClick={() => setShowUsedBy(!showUsedBy)}>
                          <Icon name={showUsedBy ? "down" : "chevron"} size={14} /> Used on {detail.usedBy.length} {detail.usedBy.length === 1 ? "page" : "pages"}
                        </button>
                        {showUsedBy && (
                          <ul>
                            {detail.usedBy.map((d) => (
                              <li key={`${d.type}:${d.id}`}>
                                <button type="button" className="doc-item" onClick={() => onOpenDoc(d.type, d.id)}>
                                  <Icon name="doc" /> <span className="block-title">{d.title}</span>
                                  <span className="block-subtitle">{d.path}</span>
                                  <StatusDot status={d.status} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </>
                )}
                {readOnly && <p className="notice">You're viewing the published version. Switch to Draft to edit.</p>}
                {focused ? (
                  <FieldList fields={focused.block.fields} data={shown} base={focused.path} />
                ) : (
                  <FieldList fields={type.fields} data={shown} />
                )}
              </div>
            </div>

            <footer className="editor-foot">
              <span className="muted small">
                {detail.publishedAt || detail.published
                  ? `Last published ${timeAgo(detail.publishedAt) ?? "before this dashboard"}`
                  : "Never published"}
              </span>
              <span className={`save-state is-${save}`}>{saveLabel}</span>
              <button type="button" className="btn btn-primary" disabled={publishing || !hasDraft} onClick={publish}>
                {publishing ? "Publishing…" : localized && locales.length > 1 ? `Publish ${locale.toUpperCase()}` : "Publish"}
              </button>
            </footer>
          </div>
        </Panel>
      </Group>

      {adding && (
        <AddSection blocks={adding.blocks} onPick={(b) => insert(adding.list, adding.index, b)} onClose={() => setAdding(null)} />
      )}
    </FormContext.Provider>
  );
}

/** Heading of a block item opened in the panel: its name, rename, and list actions. */
function ItemHead({
  block,
  label,
  readOnly,
  canMove,
  onRename,
  onAction,
}: {
  block: BlockType;
  label?: string;
  readOnly: boolean;
  canMove?: { items: unknown[]; i: number };
  onRename: (label: string) => void;
  onAction: (action: SectionAction) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="item-head">
      <p className="editor-type">
        {block.icon} {block.title}
      </p>
      {renaming ? (
        <input
          className="input item-rename"
          autoFocus
          defaultValue={label ?? ""}
          placeholder={block.title}
          aria-label="Section name"
          onBlur={(e) => {
            onRename(e.target.value.trim());
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <div className="item-title-row">
          <h1 className="editor-title">{label || block.title}</h1>
          {!readOnly && (
            <>
              <button type="button" className="btn btn-icon btn-ghost" aria-label="Rename section" title="Rename" onClick={() => setRenaming(true)}>
                <Icon name="pencil" size={14} />
              </button>
              {canMove && (
                <Menu
                  label={`Actions for ${label || block.title}`}
                  trigger={<Icon name="more" />}
                  items={[
                    { label: "Add below", icon: <Icon name="plus" />, onSelect: () => onAction("add") },
                    { label: "Duplicate", icon: <Icon name="copy" />, onSelect: () => onAction("duplicate") },
                    { label: "Move up", icon: <Icon name="arrowUp" />, disabled: canMove.i === 0, onSelect: () => onAction("up") },
                    { label: "Move down", icon: <Icon name="arrowDown" />, disabled: canMove.i === canMove.items.length - 1, onSelect: () => onAction("down") },
                    { label: "Remove", icon: <Icon name="trash" />, danger: true, onSelect: () => onAction("remove") },
                  ]}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AddSection({ blocks, onPick, onClose }: { blocks: BlockType[]; onPick: (b: BlockType) => void; onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add a section"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="dialog-head">
          <h2>Add a section</h2>
          <button type="button" className="btn btn-icon btn-ghost" aria-label="Close" onClick={onClose} autoFocus>
            <Icon name="close" />
          </button>
        </div>
        <ul className="picker-list add-list">
          {blocks.map((b) => (
            <li key={b.name}>
              <button type="button" className="doc-item" onClick={() => onPick(b)}>
                <span className="block-icon">{b.icon ?? "•"}</span>
                <span className="block-title">{b.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
