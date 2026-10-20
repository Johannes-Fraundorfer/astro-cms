import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "./Icon.tsx";

/** A vertical list whose rows reorder by dragging their handle. */
export function SortableList<T extends { _key: string }>({
  items,
  onReorder,
  disabled,
  className = "sortable",
  children,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  disabled?: boolean;
  className?: string;
  children: (item: T, index: number, handle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i._key === active.id);
    const to = items.findIndex((i) => i._key === over.id);
    onReorder(arrayMove(items, from, to));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i._key)} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ul className={className}>
          {items.map((item, i) => (
            <SortableRow key={item._key} id={item._key} disabled={disabled}>
              {(handle) => children(item, i, handle)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, disabled, children }: { id: string; disabled?: boolean; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = disabled ? (
    <span className="drag-handle is-disabled" />
  ) : (
    <button type="button" className="drag-handle" ref={setActivatorNodeRef} aria-label="Drag to reorder" {...attributes} {...listeners}>
      <Icon name="grip" size={14} />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      className={`sortable-row${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children(handle)}
    </li>
  );
}
