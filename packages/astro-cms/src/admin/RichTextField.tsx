import { useEffect, useRef } from "react";
import { useForm } from "./context.ts";
import { Icon, type IconName } from "./Icon.tsx";

const ALLOWED = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "S", "A", "UL", "OL", "LI", "H2", "H3", "H4", "BLOCKQUOTE", "CODE"]);

/** Client-side cleanup for pasted HTML. The server sanitizes again on save. */
function cleanHtml(html: string) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      walk(child);
      if (!ALLOWED.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      const href = child.tagName === "A" ? child.getAttribute("href") : null;
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
      if (href && /^(https?:|mailto:|tel:|\/|#)/i.test(href)) child.setAttribute("href", href);
    }
  };
  const root = doc.body.firstElementChild!;
  walk(root);
  return root.innerHTML;
}

const tools: { icon: IconName | string; label: string; run: () => void }[] = [
  { icon: "bold", label: "Bold", run: () => document.execCommand("bold") },
  { icon: "italic", label: "Italic", run: () => document.execCommand("italic") },
  { icon: "H2", label: "Heading", run: () => document.execCommand("formatBlock", false, "h2") },
  { icon: "H3", label: "Subheading", run: () => document.execCommand("formatBlock", false, "h3") },
  { icon: "¶", label: "Paragraph", run: () => document.execCommand("formatBlock", false, "p") },
  { icon: "list", label: "Bulleted list", run: () => document.execCommand("insertUnorderedList") },
  {
    icon: "link",
    label: "Link",
    run: () => {
      const url = prompt("Link to (a path like /work, or a full URL)");
      if (url === null) return;
      if (url === "") document.execCommand("unlink");
      else if (/^(https?:|mailto:|tel:|\/|#)/i.test(url)) document.execCommand("createLink", false, url);
    },
  },
];

export function RichTextField({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const { readOnly } = useForm();
  const ref = useRef<HTMLDivElement>(null);

  // Only write into the editor when the value changed from outside (canvas,
  // discard), so typing never loses the caret.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (value ?? "") && document.activeElement !== el) el.innerHTML = value ?? "";
  }, [value]);

  const emit = () => ref.current && onChange(ref.current.innerHTML);

  return (
    <div className={`richtext${readOnly ? " is-readonly" : ""}`}>
      {!readOnly && (
        <div className="richtext-toolbar" role="toolbar" aria-label="Formatting">
          {tools.map((t) => (
            <button
              key={t.label}
              type="button"
              className="btn btn-icon btn-ghost"
              title={t.label}
              aria-label={t.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                ref.current?.focus();
                t.run();
                emit();
              }}
            >
              {t.icon.length <= 2 ? <span className="tool-glyph">{t.icon}</span> : <Icon name={t.icon as IconName} />}
            </button>
          ))}
        </div>
      )}
      <div
        ref={ref}
        className="richtext-body"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData.getData("text/html");
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertHTML", false, html ? cleanHtml(html) : text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n/g, "<br>"));
        }}
      />
    </div>
  );
}
