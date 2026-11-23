import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { normalizeTag } from "../lib/tags";

// Chips for chosen tags plus a text box suggesting existing ones. Tags that
// don't exist yet are drawn dashed and amber, marked "new".
export function TagInput({
  value,
  onChange,
  existing,
  placeholder = "Add tags…",
  autoFocus = false,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  existing: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const existingSet = useMemo(() => new Set(existing), [existing]);
  const query = normalizeTag(text);

  const suggestions = useMemo(() => {
    const free = existing.filter((t) => !value.includes(t));
    if (!query) return free.slice(0, 8);
    const starts = free.filter((t) => t.startsWith(query));
    const contains = free.filter((t) => !t.startsWith(query) && t.includes(query));
    return [...starts, ...contains].slice(0, 8);
  }, [existing, value, query]);

  const showCreate = query !== "" && !existingSet.has(query) && !value.includes(query);
  const options = [...suggestions, ...(showCreate ? [query] : [])];

  const add = (tag: string) => {
    const t = normalizeTag(tag);
    if (t && !value.includes(t)) onChange([...value, t]);
    setText("");
    setActive(0);
  };

  return (
    <div className="relative">
      <div
        className="input flex min-h-10 flex-wrap items-center gap-1.5 py-1.5"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => {
          const isNew = !existingSet.has(tag);
          return (
            <span
              key={tag}
              className={
                isNew
                  ? "inline-flex items-center gap-1 rounded-full border border-dashed border-new bg-new-soft px-2 py-0.5 text-xs text-new"
                  : "chip"
              }
              title={isNew ? "This tag will be created" : undefined}
            >
              {isNew && <span className="font-semibold">new</span>}
              {tag}
              <button
                type="button"
                className="opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(value.filter((t) => t !== tag));
                }}
                aria-label={`Remove ${tag}`}
              >
                <X size={12} />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          placeholder={value.length ? "" : placeholder}
          className="min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
              if (e.key === "Tab" && !text) return;
              if (options.length || query) {
                e.preventDefault();
                add(options[active] ?? query);
              }
            } else if (e.key === "Backspace" && !text && value.length) {
              onChange(value.slice(0, -1));
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Escape" && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </div>
      {open && options.length > 0 && (
        <ul className="card absolute z-20 mt-1 max-h-60 w-full overflow-auto py-1 shadow-lg">
          {options.map((tag, i) => {
            const isNew = showCreate && i === options.length - 1;
            return (
              <li key={`${tag}-${isNew}`}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === active ? "bg-sunken" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(tag)}
                >
                  {isNew ? (
                    <>
                      <Plus size={14} className="text-new" />
                      <span>
                        Create <span className="font-medium text-new">“{tag}”</span>
                      </span>
                    </>
                  ) : (
                    <span>{tag}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
