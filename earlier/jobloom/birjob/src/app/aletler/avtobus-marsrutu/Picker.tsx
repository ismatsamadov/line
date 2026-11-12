"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search, X, MapPin, MapPinned, LocateFixed } from "lucide-react";
import { keepShownRows, type ShownRows } from "./search";

/** One suggestion. `kind` sets its icon: a stop, a named place, or the person's
 *  location once chosen (#720). */
export interface PickerItem { key: string; name: string; detail: string; badge?: string; kind?: "stop" | "place" | "here" }

/** Keyboard focus stays in the input; screen readers follow the active option. */
export default function Picker<T extends PickerItem>({ label, placeholder, searchItems, selected, onSelect, onActivate, active, loading, icon, emptyHint, onQueryChange, pending, footer }: {
  label: string; placeholder: string; searchItems: (query: string) => T[]; selected: PickerItem | null;
  onSelect: (item: T | null) => void; onActivate?: () => void;
  active?: boolean; loading?: boolean; icon?: ReactNode; emptyHint: string;
  /** Told of every change of the query, in the same update, for results the picker does
   *  not search itself. */
  onQueryChange?: (query: string) => void;
  /** More results are on their way, so an empty list is not yet "nothing found". */
  pending?: boolean;
  /** A line under the suggestions, such as the credit for the places in them. */
  footer?: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // The active option by key, not position: results that arrive later (places) can
  // move it, and the highlight must stay on what the person chose with the arrows.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Rows already shown for what is typed keep their places when more arrive for it (the
  // places, after the stops): those go below, never under the finger (keepShownRows).
  // Recomputing from the same rows gives the same rows, so a repeated render is harmless.
  const shown = useRef<ShownRows<T> | null>(null);
  const items = useMemo(() => {
    shown.current = keepShownRows(shown.current, query, searchItems(query));
    return shown.current.rows;
  }, [searchItems, query]);
  const index = activeKey === null ? -1 : items.findIndex(item => item.key === activeKey);
  const expanded = open && !selected && !loading;

  // The owner hears of a new query in the same update as the picker, not an effect later:
  // one render with the new query and the old query's places listed those places as
  // the new query's first rows, and keepShownRows then kept them (#720).
  const changeQuery = (next: string) => { setQuery(next); onQueryChange?.(next); };

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  useEffect(() => {
    if (expanded && index >= 0) document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [expanded, index, id]);

  function choose(item: T) {
    onSelect(item); changeQuery(""); setOpen(false); setActiveKey(null);
    requestAnimationFrame(() => selectedRef.current?.focus());
  }
  function edit() {
    onSelect(null); changeQuery(""); setOpen(true); setActiveKey(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    if (event.key === "Enter") {
      event.preventDefault();
      if (expanded && index >= 0 && items[index]) choose(items[index]);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      if (!items.length) { setActiveKey(null); return; }
      const next = !expanded || index < 0
        ? (event.key === "ArrowDown" ? 0 : items.length - 1)
        : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      setActiveKey(items[next].key);
    }
    if (expanded && items.length && (event.key === "Home" || event.key === "End")) {
      event.preventDefault(); setActiveKey(items[event.key === "Home" ? 0 : items.length - 1].key);
    }
  }
  return (
    <div ref={ref} className="relative" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <label id={`${id}-label`} htmlFor={id} className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
        {icon}{label}
      </label>
      {selected ? (
        <div className={`flex min-h-[58px] items-center gap-2 rounded-xl border bg-white px-3 ${active ? "border-orange-300" : "border-gray-200"}`}>
          <button ref={selectedRef} type="button" onClick={edit} aria-label={`${label}: ${selected.name}. Dəyişmək üçün seçin`} aria-describedby={`${id}-detail`} className="min-w-0 flex-1 py-2 text-left focus-visible:outline-orange-500">
            <span className="block truncate text-sm font-semibold text-gray-900">{selected.badge && <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">{selected.badge}</span>}{selected.kind === "place" && <MapPinned aria-hidden="true" className="mr-1.5 inline h-4 w-4 -translate-y-px text-orange-600" />}{selected.kind === "here" && <LocateFixed aria-hidden="true" className="mr-1.5 inline h-4 w-4 -translate-y-px text-indigo-600" />}{selected.name}</span>
            <span id={`${id}-detail`} className="block truncate text-xs text-gray-500">{selected.detail || "Dayanacağı dəyişmək üçün toxunun"}</span>
          </button>
          <button type="button" onClick={edit} aria-label={`${label} seçimini sil`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 focus-visible:outline-orange-500"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input ref={inputRef} id={id} type="text" inputMode="search" autoComplete="off" spellCheck={false}
            role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-list`}
            aria-activedescendant={expanded && index >= 0 ? `${id}-option-${index}` : undefined}
            value={query} disabled={loading} placeholder={loading ? "Məlumat yüklənir…" : placeholder}
            onChange={event => { changeQuery(event.target.value); setOpen(true); setActiveKey(null); }}
            onFocus={() => { setOpen(true); onActivate?.(); }} onKeyDown={keys}
            className={`min-h-[58px] w-full rounded-xl border bg-white py-3 pl-10 pr-3 text-base text-gray-900 placeholder:text-sm placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:bg-gray-50 ${active ? "border-orange-300" : "border-gray-200"}`} />
        </div>
      )}
      {!selected && (
        <div hidden={!expanded} className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <p className="border-b border-gray-100 px-3 py-2 text-[11px] font-medium text-gray-500">{query.trim() ? "Uyğun nəticələr · ↑ ↓ ilə seçin" : emptyHint}</p>
          <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="bj-picker-suggestions max-h-64 overflow-y-auto overscroll-contain">
            {items.map((item, i) => (
              <li key={item.key} id={`${id}-option-${i}`} role="option" aria-selected={index === i}
                onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}
                className={`flex min-h-[52px] cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-orange-50 ${index === i ? "bg-orange-50" : ""}`}>
                {item.badge ? <span className="min-w-10 shrink-0 rounded-lg bg-blue-100 px-2 py-1 text-center text-sm font-bold text-blue-800">{item.badge}</span>
                  : item.kind === "place" ? <MapPinned aria-hidden="true" className="h-4 w-4 shrink-0 text-orange-600" />
                  : <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400" />}
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-900">{item.name}</span>{item.detail && <span className="block truncate text-xs text-gray-500">{item.detail}</span>}</span>
              </li>
            ))}
          </ul>
          {items.length === 0 && (pending
            ? <p role="status" className="px-3 py-4 text-sm text-gray-600">Axtarılır…</p>
            : <p role="status" className="px-3 py-4 text-sm text-gray-600">{query.trim() ? `«${query}» üzrə nəticə tapılmadı. Başqa ad və ya kod yazın.` : "Axtarmaq üçün dayanacaq adı və ya kod yazın."}</p>)}
          {footer}
        </div>
      )}
    </div>
  );
}
