import { useState, type ReactNode } from "react";
import { fieldTitle, slugify, type Field } from "../schema.ts";
import { useForm } from "./context.ts";
import { getIn, pathKey, type Path } from "./paths.ts";
import { BlocksField } from "./BlocksField.tsx";
import { LinkField, ReferenceField, ReferencesField } from "./ReferenceField.tsx";
import { ImageField } from "./ImageField.tsx";
import { VideoField } from "./VideoField.tsx";
import { RichTextField } from "./RichTextField.tsx";
import { Icon } from "./Icon.tsx";

export function FieldList({ fields, data, base = [] }: { fields: Field[]; data: unknown; base?: Path }) {
  return (
    <div className="field-list">
      {fields.map((field) => (
        <FieldRow key={field.name} field={field} data={data} path={[...base, field.name]} />
      ))}
    </div>
  );
}

function FieldRow({ field, data, path }: { field: Field; data: unknown; path: Path }) {
  const { errors } = useForm();
  const error = errors.get(pathKey(path));
  const id = `f-${pathKey(path)}`;
  const labelFor = ["boolean", "blocks", "references", "image", "video", "richText", "object", "link"].includes(field.type) ? undefined : id;
  return (
    <div className={`field${error ? " has-error" : ""}`} data-path={pathKey(path)}>
      <div className="field-head">
        <label className="field-label" htmlFor={labelFor}>
          {fieldTitle(field)}
          {field.required && <span className="field-required" title="Required">*</span>}
        </label>
        {field.description && <p className="field-description">{field.description}</p>}
      </div>
      <FieldInput id={id} field={field} value={getIn(data, path)} path={path} data={data} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

function FieldInput({ id, field, value, path, data }: { id: string; field: Field; value: any; path: Path; data: unknown }) {
  const { onChange, readOnly } = useForm();
  const set = (v: unknown) => onChange(path, v);

  switch (field.type) {
    case "string":
    case "url":
      return (
        <input
          id={id}
          className="input"
          type="text"
          inputMode={field.type === "url" ? "url" : undefined}
          value={value ?? ""}
          placeholder={field.type === "string" ? field.placeholder : "/path or https://"}
          readOnly={readOnly}
          onChange={(e) => set(e.target.value)}
        />
      );
    case "text":
      return (
        <textarea
          id={id}
          className="input"
          rows={field.rows ?? 4}
          value={value ?? ""}
          placeholder={field.placeholder}
          readOnly={readOnly}
          onChange={(e) => set(e.target.value)}
        />
      );
    case "secret":
      return <SecretInput id={id} value={value} onChange={set} readOnly={readOnly} />;
    case "number":
      return (
        <input
          id={id}
          className="input input-narrow"
          type="number"
          value={value ?? ""}
          min={field.min}
          max={field.max}
          step={field.integer ? 1 : "any"}
          readOnly={readOnly}
          onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "boolean":
      return (
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          aria-label={fieldTitle(field)}
          className="switch"
          disabled={readOnly}
          onClick={() => set(!value)}
        >
          <span className="switch-thumb" />
        </button>
      );
    case "date":
      return (
        <input
          id={id}
          className="input input-narrow"
          type="date"
          value={value ?? ""}
          readOnly={readOnly}
          onChange={(e) => set(e.target.value || undefined)}
        />
      );
    case "select":
      return (
        <select id={id} className="input input-narrow" value={value ?? ""} disabled={readOnly} onChange={(e) => set(e.target.value || undefined)}>
          <option value="">—</option>
          {field.options.map((o) => {
            const opt = typeof o === "string" ? { title: o, value: o } : o;
            return (
              <option key={opt.value} value={opt.value}>
                {opt.title}
              </option>
            );
          })}
        </select>
      );
    case "slug": {
      const source = field.source ? getIn(data, [...path.slice(0, -1), field.source]) : undefined;
      return (
        <div className="input-group">
          <input
            id={id}
            className="input"
            type="text"
            value={value ?? ""}
            readOnly={readOnly}
            onChange={(e) => set(e.target.value)}
            onBlur={(e) => e.target.value && set(slugify(e.target.value) || e.target.value)}
          />
          {!readOnly && field.source && (
            <button type="button" className="btn" disabled={!source} onClick={() => set(slugify(String(source)))}>
              Generate
            </button>
          )}
        </div>
      );
    }
    case "image":
      return <ImageField value={value} onChange={set} />;
    case "video":
      return <VideoField value={value} onChange={set} />;
    case "richText":
      return <RichTextField value={value} onChange={set} />;
    case "reference":
      return <ReferenceField field={field} value={value} onChange={set} />;
    case "references":
      return <ReferencesField field={field} value={value} path={path} />;
    case "link":
      return <LinkField id={id} field={field} value={value} onChange={set} />;
    case "blocks":
      return <BlocksField field={field} value={value} path={path} />;
    case "object":
      return (
        <div className="fieldset">
          <FieldList fields={field.fields} data={data} base={path} />
        </div>
      );
  }
}

function SecretInput({ id, value, onChange, readOnly }: { id: string; value?: string; onChange: (v: string) => void; readOnly: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="input-group">
      <input
        id={id}
        className="input"
        type={shown ? "text" : "password"}
        autoComplete="off"
        value={value ?? ""}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="btn btn-icon" aria-label={shown ? "Hide value" : "Show value"} onClick={() => setShown(!shown)}>
        <Icon name={shown ? "eyeOff" : "eye"} />
      </button>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
