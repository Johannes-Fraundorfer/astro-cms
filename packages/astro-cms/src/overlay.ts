/**
 * Injected into `/_cms/preview/*` pages. Talks to the dashboard through
 * postMessage: reports hovers, selections and inline edits, and applies
 * patches the dashboard sends back.
 */
export const overlayScript = String.raw`
(() => {
  if (window.parent === window) return;
  const origin = location.origin;
  const send = (msg) => window.parent.postMessage({ source: "cms-canvas", ...msg }, origin);
  const SCROLL_KEY = "cms-scroll:" + location.pathname;

  const css = document.createElement("style");
  css.textContent = [
    "astro-dev-toolbar{display:none!important}",
    "[data-cms-field]{cursor:pointer}",
    "[data-cms-editing]{outline:none;cursor:text}",
    // Boxes live in a fixed, clipping layer the size of the viewport, so an outline around a full-width section can't make the page scroll.
    ".cms-layer{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147483646}",
    ".cms-layer.is-scrolling *{transition:none!important}",
    ".cms-box{position:absolute;pointer-events:none;z-index:2147483646;border:1.5px solid #3b82f6;border-radius:3px;transition:all .08s ease-out}",
    ".cms-box.is-block{border-style:dashed;border-color:#a78bfa}",
    ".cms-box.is-selected{border-color:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.25)}",
    ".cms-tag{position:absolute;pointer-events:auto;z-index:2147483647;font:500 11px/1 ui-sans-serif,system-ui,sans-serif;color:#fff;background:#3b82f6;padding:4px 6px;border-radius:3px 3px 0 0;white-space:nowrap;cursor:pointer;transform:translateY(-100%)}",
    ".cms-tag.is-block{background:#7c3aed;display:flex;align-items:center;gap:2px;padding:0 2px 0 0}",
    ".cms-tag.is-inside{transform:none;border-radius:0 0 3px 0}",
    ".cms-tag-label{padding:4px 6px}",
    ".cms-tag button{all:unset;display:grid;place-items:center;width:20px;height:19px;border-radius:2px;cursor:pointer;font:600 12px/1 ui-sans-serif,system-ui,sans-serif;color:#fff}",
    ".cms-tag button:hover{background:rgba(255,255,255,.2)}",
    ".cms-tag-sep{width:1px;align-self:stretch;margin:3px 2px;background:rgba(255,255,255,.3)}",
    ".cms-flash{animation:cms-flash 1s ease-out}",
    "@keyframes cms-flash{0%{box-shadow:0 0 0 4px rgba(59,130,246,.6)}100%{box-shadow:0 0 0 0 rgba(59,130,246,0)}}",
  ].join("");
  document.head.appendChild(css);

  const hoverBox = Object.assign(document.createElement("div"), { className: "cms-box" });
  const blockBox = Object.assign(document.createElement("div"), { className: "cms-box is-block" });
  const selBox = Object.assign(document.createElement("div"), { className: "cms-box is-selected" });
  const blockTag = Object.assign(document.createElement("div"), { className: "cms-tag is-block" });
  const blockLabel = Object.assign(document.createElement("span"), { className: "cms-tag-label" });
  blockTag.appendChild(blockLabel);
  blockTag.appendChild(Object.assign(document.createElement("span"), { className: "cms-tag-sep" }));
  const tools = [
    ["up", "↑", "Move up"],
    ["down", "↓", "Move down"],
    ["add", "+", "Add a section below"],
    ["duplicate", "⧉", "Duplicate"],
    ["remove", "✕", "Remove"],
  ];
  for (const [action, glyph, title] of tools) {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: glyph, title });
    b.setAttribute("aria-label", title);
    b.dataset.action = action;
    blockTag.appendChild(b);
  }
  const hoverTag = Object.assign(document.createElement("div"), { className: "cms-tag" });
  const layer = Object.assign(document.createElement("div"), { className: "cms-layer" });
  for (const el of [hoverBox, blockBox, selBox, blockTag, hoverTag]) {
    el.style.display = "none";
    layer.appendChild(el);
  }
  document.body.appendChild(layer);

  let hovered = null, hoveredBlock = null, selected = null, editing = null;

  const docOf = (el) => el.closest("[data-cms-doc]")?.getAttribute("data-cms-doc") ?? null;
  const info = (el) => ({
    doc: docOf(el),
    path: el.getAttribute("data-cms-field"),
    kind: el.getAttribute("data-cms-kind") || "text",
    label: el.getAttribute("data-cms-label") || el.getAttribute("data-cms-field"),
  });
  const place = (box, el) => {
    if (!el || !el.isConnected) return (box.style.display = "none");
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: "block",
      top: r.top - 3 + "px",
      left: r.left - 3 + "px",
      width: r.width + 6 + "px",
      height: r.height + 6 + "px",
    });
  };
  const placeTag = (tag, el, text) => {
    if (!el) return (tag.style.display = "none");
    const r = el.getBoundingClientRect();
    (tag === blockTag ? blockLabel : tag).textContent = text;
    if (tag === blockTag) {
      // The section toolbar sits inside its section, so the pointer can reach it
      // without leaving the section, and sticks to the viewport top while the section scrolls past.
      tag.classList.add("is-inside");
      Object.assign(tag.style, { display: "flex" });
      const top = Math.min(Math.max(r.top, 0), r.bottom - tag.offsetHeight);
      Object.assign(tag.style, { top: top + "px", left: Math.max(0, r.left) + "px" });
      return;
    }
    // With no room above the element (top of the viewport), the tag sits inside it.
    tag.classList.toggle("is-inside", r.top < 24);
    Object.assign(tag.style, { display: "block", top: r.top - 3 + "px", left: Math.max(0, r.left - 3) + "px" });
  };
  const blockOf = (el) => el?.closest('[data-cms-kind="block"]') ?? null;

  function refresh() {
    place(hoverBox, hovered && hovered !== hoveredBlock ? hovered : null);
    place(blockBox, hoveredBlock);
    place(selBox, selected);
    placeTag(blockTag, hoveredBlock, hoveredBlock ? "✎ " + info(hoveredBlock).label : "");
    placeTag(hoverTag, hovered && hovered !== hoveredBlock ? hovered : null, hovered ? info(hovered).label : "");
  }

  const onTag = (t) => blockTag.contains(t) || hoverTag.contains(t);

  document.addEventListener("mouseover", (e) => {
    if (onTag(e.target)) return;
    hovered = e.target.closest?.("[data-cms-field]") ?? null;
    hoveredBlock = blockOf(hovered) ?? blockOf(e.target);
    refresh();
  });
  document.addEventListener("mouseleave", () => { hovered = hoveredBlock = null; refresh(); });
  // Boxes follow the page while it scrolls, without easing behind it.
  let scrollEnd = 0;
  addEventListener("scroll", () => {
    layer.classList.add("is-scrolling");
    refresh();
    clearTimeout(scrollEnd);
    scrollEnd = setTimeout(() => layer.classList.remove("is-scrolling"), 150);
  }, { passive: true, capture: true });
  addEventListener("resize", refresh);

  blockTag.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!hoveredBlock) return;
    const action = e.target.closest?.("button")?.dataset.action;
    if (!action) return select(hoveredBlock, true);
    const i = info(hoveredBlock);
    selected = hoveredBlock;
    send({ type: "section", action, doc: i.doc, path: i.path });
  });

  function select(el, forceOpen) {
    selected = el;
    refresh();
    const i = info(el);
    send({ type: "select", ...i, open: forceOpen || !["text", "multiline", "rich"].includes(i.kind) });
  }

  function startEditing(el) {
    if (editing === el) return;
    stopEditing();
    editing = el;
    const kind = info(el).kind;
    el.setAttribute("data-cms-editing", "");
    el.contentEditable = kind === "rich" ? "true" : "plaintext-only";
    el.focus();
  }
  function stopEditing() {
    if (!editing) return;
    editing.removeAttribute("data-cms-editing");
    editing.contentEditable = "false";
    editing.removeAttribute("contenteditable");
    editing = null;
  }

  document.addEventListener("click", (e) => {
    if (onTag(e.target)) return;
    const field = e.target.closest("[data-cms-field]");
    const link = e.target.closest("a[href]");
    if (field) {
      e.preventDefault();
      const i = info(field);
      select(field, false);
      if (["text", "multiline", "rich"].includes(i.kind) && i.doc) startEditing(field);
      return;
    }
    if (link) {
      e.preventDefault();
      const url = new URL(link.href, location.href);
      if (url.origin === origin) send({ type: "navigate", path: url.pathname });
      return;
    }
    stopEditing();
  }, true);

  document.addEventListener("submit", (e) => e.preventDefault(), true);

  document.addEventListener("input", (e) => {
    if (!editing || !editing.contains(e.target)) return;
    const i = info(editing);
    const value = i.kind === "rich" ? editing.innerHTML : editing.innerText.replace(/\n$/, "");
    send({ type: "edit", doc: i.doc, path: i.path, kind: i.kind, value });
    refresh();
  });

  document.addEventListener("keydown", (e) => {
    if (!editing) return;
    const kind = info(editing).kind;
    if (e.key === "Escape" || (e.key === "Enter" && kind === "text")) {
      e.preventDefault();
      editing.blur();
      stopEditing();
    }
  });
  document.addEventListener("focusout", (e) => { if (editing && e.target === editing) stopEditing(); });

  const find = (doc, path) =>
    [...document.querySelectorAll('[data-cms-field="' + CSS.escape(path) + '"]')].find((el) => docOf(el) === doc);

  addEventListener("message", (e) => {
    if (e.origin !== origin || e.data?.source !== "cms-dashboard") return;
    const msg = e.data;
    if (msg.type === "patch") {
      const el = find(msg.doc, msg.path);
      if (!el || el === editing) return;
      if (msg.kind === "rich") el.innerHTML = msg.value ?? "";
      else el.textContent = msg.value ?? "";
      refresh();
    }
    if (msg.type === "highlight") {
      const el = find(msg.doc, msg.path);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      selected = el;
      el.classList.add("cms-flash");
      setTimeout(() => el.classList.remove("cms-flash"), 1000);
      refresh();
    }
    if (msg.type === "save-scroll") sessionStorage.setItem(SCROLL_KEY, String(scrollY));
  });

  const saved = sessionStorage.getItem(SCROLL_KEY);
  if (saved) { scrollTo(0, Number(saved)); sessionStorage.removeItem(SCROLL_KEY); }
  addEventListener("beforeunload", () => sessionStorage.setItem(SCROLL_KEY, String(scrollY)));
  send({ type: "ready", path: location.pathname.replace(/^\/_cms\/preview/, "") || "/" });
})();
`;
