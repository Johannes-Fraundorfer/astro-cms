import { useState } from "react";
import { emptyData, getBlock, newKey, previewOf, type BlockType, type Field } from "../schema.ts";
import { imageUrl, type Data } from "./api.ts";
import { useForm } from "./context.ts";
import { Icon } from "./Icon.tsx";
import { Menu } from "./Menu.tsx";
import type { Path } from "./paths.ts";
import { SortableList } from "./Sortable.tsx";

type BlocksFieldDef = Extract<Field, { type: "blocks" }>;
type Item = Data & { _key: string; _type: string; _label?: string };

export function BlocksField({ field, value, path }: { field: BlocksFieldDef; value?: Item[]; path: Path }) {
  const { config, onChange, openItem, readOnly, errors } = useForm();
  const items = value ?? [];
  const [renaming, setRenaming] = useState<string | null>(null);
  const blockTypes = field.of.map((n) => getBlock(config, n)).filter((b): b is BlockType => !!b);

  const add = (block: BlockType) => {
    const item = { _type: block.name, _key: newKey(), ...emptyData(block.fields) } as Item;
    onChange(path, [...items, item]);
    openItem([...path, items.length]);
  };
  const update = (next: Item[]) => onChange(path, next);

  const hasError = (i: number) => {
    const prefix = `${path.join(".")}.${i}.`;
    for (const key of errors.keys()) if (key.startsWith(prefix)) return true;
    return false;
  };

  return (
    <div className="blocks">
      {items.length === 0 && <p className="blocks-empty">No items yet.</p>}
      <SortableList items={items} onReorder={update} disabled={readOnly}>
        {(item, i, handle) => {
          const block = getBlock(config, item._type);
          const pv = block ? previewOf(block.preview, item) : { title: item._type, subtitle: undefined, media: undefined };
          return (
            <div className={`block-row${hasError(i) ? " has-error" : ""}`}>
              {handle}
              {renaming === item._key ? (
                <div className="block-row-main">
                  <span className="block-icon">{block?.icon ?? <Icon name="doc" />}</span>
                  <input
                    className="input block-rename"
                    autoFocus
                    defaultValue={item._label ?? ""}
                    placeholder={block?.title ?? item._type}
                    aria-label="Section name"
                    onBlur={(e) => {
                      update(items.map((x, j) => (j === i ? withLabel(x, e.target.value) : x)));
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                </div>
              ) : (
                <button type="button" className="block-row-main" onClick={() => openItem([...path, i])}>
                  <span className="block-icon">
                    {pv.media ? <img src={imageUrl(pv.media)} alt="" /> : (block?.icon ?? <Icon name="doc" />)}
                  </span>
                  <span className="block-text">
                    <span className="block-title">
                      {item._label || block?.title || item._type}
                      {item._label && <span className="type-tag">{block?.title ?? item._type}</span>}
                    </span>
                    {(pv.title || pv.subtitle) && <span className="block-subtitle">{pv.title || pv.subtitle}</span>}
                  </span>
                  <Icon name="chevron" size={14} />
                </button>
              )}
              {!readOnly && (
                <Menu
                  label={`Actions for ${block?.title ?? "item"}`}
                  trigger={<Icon name="more" />}
                  items={[
                    { label: "Edit", icon: <Icon name="form" />, onSelect: () => openItem([...path, i]) },
                    { label: "Rename", icon: <Icon name="pencil" />, onSelect: () => setRenaming(item._key) },
                    {
                      label: "Duplicate",
                      icon: <Icon name="copy" />,
                      onSelect: () => update([...items.slice(0, i + 1), { ...structuredClone(item), _key: newKey() }, ...items.slice(i + 1)]),
                    },
                    {
                      label: "Move up",
                      icon: <Icon name="arrowUp" />,
                      disabled: i === 0,
                      onSelect: () => update(swap(items, i, i - 1)),
                    },
                    {
                      label: "Move down",
                      icon: <Icon name="arrowDown" />,
                      disabled: i === items.length - 1,
                      onSelect: () => update(swap(items, i, i + 1)),
                    },
                    { label: "Remove", icon: <Icon name="trash" />, danger: true, onSelect: () => update(items.filter((_, j) => j !== i)) },
                  ]}
                />
              )}
            </div>
          );
        }}
      </SortableList>
      {!readOnly &&
        (blockTypes.length === 1 ? (
          <button type="button" className="btn btn-add" onClick={() => add(blockTypes[0])}>
            <Icon name="plus" /> Add {blockTypes[0].title}
          </button>
        ) : (
          <Menu
            label="Add item"
            align="start"
            className="btn btn-add"
            trigger={
              <>
                <Icon name="plus" /> Add item
              </>
            }
            items={blockTypes.map((b) => ({
              label: b.title,
              icon: <span className="menu-glyph">{b.icon ?? "•"}</span>,
              onSelect: () => add(b),
            }))}
          />
        ))}
    </div>
  );
}

/** A custom name for one section; clearing it falls back to the block type's title. */
function withLabel(item: Item, label: string): Item {
  const { _label, ...rest } = item;
  return label.trim() ? { ...rest, _label: label.trim() } : (rest as Item);
}

function swap<T>(arr: T[], a: number, b: number) {
  const next = [...arr];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
