import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import type { CmsConfig, DocumentType } from "../schema.ts";
import { api, features, setLocale, type Deploy, type DocSummary, type Schema } from "./api.ts";
import { DeployChip } from "./Deploy.tsx";
import { Editor } from "./Editor.tsx";
import { MediaView } from "./Media.tsx";
import { Structure, type BulkAction } from "./Structure.tsx";
import { Icon } from "./Icon.tsx";

type Target = { type: string; id: string };
type Toast = { id: number; message: string; tone: "error" | "info" };

const store = {
  get: (key: string) => {
    try {
      return localStorage.getItem(`cms:${key}`);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(`cms:${key}`, value);
    } catch {
      /* private mode */
    }
  },
};

function fromUrl(): { type?: string; id?: string; locale?: string } {
  const [, , type, id] = location.pathname.split("/").map(decodeURIComponent);
  const locale = new URLSearchParams(location.search).get("locale");
  return { type: type || undefined, id: id || undefined, locale: locale || undefined };
}

/** Dev-only, so its code (xterm) loads only when the terminal is opened. */
const TerminalPanel = lazy(() => import("./Terminal.tsx").then((m) => ({ default: m.TerminalPanel })));

/** The media library's place in the structure; a content type can't be called this. */
const MEDIA = "media";

export default function App() {
  const [schema, setSchema] = useState<Schema | null>(null);
  const [failed, setFailed] = useState<string>();
  const [activeType, setActiveType] = useState<string>();
  const [locale, setLocaleState] = useState<string>();
  const [pagePath, setPagePath] = useState<string>();
  /** Bumped to reload the open document after a bulk action changed it. */
  const [editorVersion, setEditorVersion] = useState(0);
  const [deploy, setDeploy] = useState<(Deploy & { title: string }) | null>(() => {
    try {
      const saved = JSON.parse(store.get("deploy") ?? "null");
      // Older than half an hour: whatever happened, it's no longer news.
      return saved && Date.now() - saved.since < 30 * 60_000 ? saved : null;
    } catch {
      return null;
    }
  });
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [target, setTarget] = useState<Target>();
  const [index, setIndex] = useState(new Map<string, DocSummary>());
  const [showTerminal, setShowTerminal] = useState(() => store.get("terminal") === "shown");
  const [showStructure, setShowStructure] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const terminalPanel = usePanelRef();
  const structurePanel = usePanelRef();

  const config = useMemo<CmsConfig | null>(
    () =>
      schema
        ? { types: schema.types, blocks: schema.blocks, i18n: schema.i18n, publish: { target: schema.publishTarget } }
        : null,
    [schema],
  );

  const toast = useCallback((message: string, tone: "error" | "info" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 3000);
  }, []);

  const refreshIndex = useCallback(() => {
    api
      .search()
      .then((all) => setIndex(new Map(all.map((d) => [`${d.type}:${d.id}`, d]))))
      .catch(() => {});
  }, []);

  /* ------------------------------ Bootstrap ------------------------------ */

  useEffect(() => {
    api
      .schema()
      .then((s) => {
        const { type, id, locale: fromLink } = fromUrl();
        const codes = s.i18n?.locales.map((l) => l.code) ?? [];
        const wanted = fromLink ?? store.get("locale") ?? undefined;
        const loc = wanted && codes.includes(wanted) ? wanted : s.i18n?.defaultLocale;
        setLocale(loc);
        setLocaleState(loc);
        features.videoUploads = s.videoUploads;
        setSchema(s);
        if (type === MEDIA && !s.types.some((t) => t.name === MEDIA)) {
          setActiveType(MEDIA);
          return;
        }
        const t = s.types.find((x) => x.name === type) ?? s.types.find((x) => x.kind === "collection") ?? s.types[0];
        setActiveType(t.name);
        if (t.kind === "singleton") setTarget({ type: t.name, id: t.name });
        else if (id) setTarget({ type: t.name, id });
      })
      .catch((err) => setFailed(err.message));
  }, []);

  useEffect(() => {
    if (schema) refreshIndex();
  }, [locale, schema, refreshIndex]);

  const listType = schema?.types.find((t) => t.name === activeType)?.kind === "collection" ? activeType : undefined;
  useEffect(() => {
    if (!listType) return;
    setDocs(null);
    api.list(listType).then(setDocs).catch((err) => toast(err.message, "error"));
  }, [listType, locale, toast]);

  useEffect(() => {
    if (!schema) return;
    // Single-entry types (home, settings) use their type name as the id: /admin/home, not /admin/home/home.
    const path =
      target && activeType !== MEDIA
        ? target.id === target.type
          ? `/admin/${target.type}`
          : `/admin/${target.type}/${target.id}`
        : activeType
          ? `/admin/${activeType}`
          : "/admin";
    const search = locale && locale !== schema.i18n?.defaultLocale && activeType !== MEDIA ? `?locale=${locale}` : "";
    if (location.pathname + location.search !== path + search) history.replaceState(null, "", path + search);
  }, [schema, target, activeType, locale]);

  const switchLocale = useCallback((code: string) => {
    setLocale(code);
    setLocaleState(code);
    store.set("locale", code);
  }, []);

  useEffect(() => {
    store.set("deploy", JSON.stringify(deploy));
  }, [deploy]);

  /* ------------------------------- Actions ------------------------------- */

  const openDoc = useCallback(
    (type: string, id: string, loc?: string) => {
      if (loc) switchLocale(loc);
      setActiveType(type);
      setTarget({ type, id });
    },
    [switchLocale],
  );

  const onType = (t: DocumentType) => {
    setActiveType(t.name);
    setTarget(t.kind === "singleton" ? { type: t.name, id: t.name } : undefined);
  };

  const onCreate = async (t: DocumentType) => {
    try {
      const d = await api.create(t.name);
      setDocs((list) => [d, ...(list ?? [])]);
      setTarget({ type: d.type, id: d.id });
      refreshIndex();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't create document", "error");
    }
  };

  const activeTypeRef = useRef(activeType);
  activeTypeRef.current = activeType;

  const onChanged = useCallback(
    (d: DocSummary) => {
      setIndex((m) => new Map(m).set(`${d.type}:${d.id}`, d));
      if (d.type !== activeTypeRef.current) return;
      setDocs((list) => {
        if (!list) return list;
        const i = list.findIndex((x) => x.id === d.id);
        const summary: DocSummary = { ...d };
        return i === -1 ? [summary, ...list] : list.map((x, j) => (j === i ? summary : x));
      });
    },
    [],
  );

  const onDeleted = useCallback(
    (d: DocSummary) => {
      setDocs((list) => list?.filter((x) => !(x.type === d.type && x.id === d.id)) ?? list);
      setIndex((m) => {
        const next = new Map(m);
        next.delete(`${d.type}:${d.id}`);
        return next;
      });
      setTarget(undefined);
      toast(`Deleted "${d.title}"`);
    },
    [toast],
  );

  const onBulk = async (t: DocumentType, action: BulkAction, ids: string[]) => {
    const n = ids.length;
    const what = n === 1 ? `1 ${t.title.replace(/s$/, "")}` : `${n} ${t.title}`;
    const inAll = schema?.i18n && locale === schema.i18n.defaultLocale && schema.i18n.locales.length > 1 ? " and their translations" : "";
    if (action === "delete" && !confirm(`Delete ${what}${inAll}? Published ones are removed from the live site. This can't be undone.`)) return false;
    if (action === "unpublish" && !confirm(`Unpublish ${what}${inAll}? They come off the live site with the next deploy and stay here as drafts.`)) return false;
    try {
      const r = await api.bulk(t.name, action, ids);
      setDocs(await api.list(t.name));
      refreshIndex();
      if (target?.type === t.name && ids.includes(target.id)) {
        if (action === "delete") setTarget(undefined);
        else setEditorVersion((v) => v + 1);
      }
      if (r.deploy && schema?.publishTarget === "github") setDeploy({ ...r.deploy, title: what });
      toast(
        action === "delete"
          ? `Deleted ${r.count}`
          : action === "duplicate"
            ? `Duplicated ${r.count} as drafts`
            : `Unpublished ${r.count}. They're drafts now.`,
      );
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work", "error");
      return false;
    }
  };

  const toggle = (which: "terminal" | "structure") => {
    const panel = which === "terminal" ? terminalPanel.current : structurePanel.current;
    const shown = which === "terminal" ? showTerminal : showStructure;
    if (which === "terminal") {
      setShowTerminal(!shown);
      store.set("terminal", shown ? "hidden" : "shown");
    } else setShowStructure(!shown);
    if (shown) panel?.collapse();
    else panel?.expand();
  };

  /* -------------------------------- Render ------------------------------- */

  if (failed) return <div className="boot-error">Couldn't load the CMS: {failed}</div>;
  if (!schema || !config) return <div className="boot">Loading…</div>;

  const terminalOn = schema.terminal && !!schema.terminalToken;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span className="brand-name">Astro CMS</span>
          {schema.publishTarget === "local" && <span className="brand-env">Local</span>}
        </div>
        <div className="topbar-actions">
          {deploy && <DeployChip deploy={deploy} onDone={() => setDeploy(null)} />}
          {schema.i18n && schema.i18n.locales.length > 1 && (
            <div className="segmented locale-switch" role="group" aria-label="Content language">
              {schema.i18n.locales.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={l.code === locale ? "is-active" : ""}
                  aria-pressed={l.code === locale}
                  title={`Edit the ${l.title} version`}
                  onClick={() => switchLocale(l.code)}
                >
                  {l.code.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {terminalOn && (
            <button type="button" className={`btn btn-ghost${showTerminal ? " is-on" : ""}`} aria-pressed={showTerminal} onClick={() => toggle("terminal")}>
              <Icon name="terminal" size={14} /> Terminal
            </button>
          )}
          <button type="button" className={`btn btn-ghost${showStructure ? " is-on" : ""}`} aria-pressed={showStructure} onClick={() => toggle("structure")}>
            <Icon name="panelRight" size={14} /> Structure
          </button>
          <a className="btn btn-ghost" href="/" target="_blank" rel="noreferrer">
            <Icon name="external" size={14} /> Site
          </a>
          {schema.signedIn && (
            <form method="post" action="/api/cms/auth/logout">
              <button type="submit" className="btn btn-ghost">Sign out</button>
            </form>
          )}
        </div>
      </header>

      <Group className="panes" orientation="horizontal">
        <Panel
          id="structure"
          panelRef={structurePanel}
          defaultSize="15"
          minSize={180}
          collapsible
          collapsedSize={0}
          onResize={(size) => setShowStructure(size.asPercentage > 0)}
          className="pane pane-structure"
        >
          <Structure
            schema={schema}
            activeType={activeType}
            docs={docs}
            selected={target}
            onType={onType}
            onSelect={(d) => setTarget({ type: d.type, id: d.id })}
            onCreate={onCreate}
            onBulk={onBulk}
            toast={toast}
            mediaActive={activeType === MEDIA}
            onMedia={() => {
              setActiveType(MEDIA);
              setTarget(undefined);
            }}
          />
        </Panel>
        <Separator className="sep" />
        <Panel id="main" minSize={620} className="pane">
          <Group className="panes" orientation="vertical">
            <Panel id="editor" minSize={200} className="pane">
              {activeType === MEDIA ? (
                <MediaView
                  toast={toast}
                  onOpenDoc={openDoc}
                  localeTitle={schema.i18n && schema.i18n.locales.length > 1 ? schema.i18n.locales.find((l) => l.code === locale)?.title : undefined}
                />
              ) : target ? (
                <Editor
                  key={`${target.type}:${target.id}:${locale}:${editorVersion}`}
                  config={config}
                  target={target}
                  locale={locale ?? "en"}
                  locales={schema.i18n?.locales ?? []}
                  index={index}
                  onChanged={onChanged}
                  onOpenDoc={openDoc}
                  onDeleted={onDeleted}
                  onPublished={(d, title) => setDeploy({ ...d, title })}
                  pagePath={pagePath}
                  onPagePath={setPagePath}
                  toast={toast}
                />
              ) : (
                <div className="empty">
                  <p>Select a document from the structure on the left,</p>
                  <p className="muted">or create a new one with +.</p>
                </div>
              )}
            </Panel>
            {terminalOn && (
              <>
                <Separator className="sep sep-h" />
                <Panel
                  id="terminal"
                  panelRef={terminalPanel}
                  defaultSize={showTerminal ? "32" : "0"}
                  minSize={140}
                  collapsible
                  collapsedSize={0}
                  onResize={(size) => setShowTerminal(size.asPercentage > 0)}
                  className="pane pane-terminal"
                >
                  {showTerminal && (
                    <Suspense fallback={<div className="empty">Starting terminal…</div>}>
                      <TerminalPanel token={schema.terminalToken!} onClose={() => toggle("terminal")} />
                    </Suspense>
                  )}
                </Panel>
              </>
            )}
          </Group>
        </Panel>
      </Group>

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === "info" && <Icon name="check" size={14} />}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
