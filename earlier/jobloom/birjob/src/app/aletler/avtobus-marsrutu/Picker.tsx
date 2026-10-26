"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Search, X, MapPin } from "lucide-react";

export interface PickerItem { id: number; name: string; detail: string; badge?: string }

/** Keyboard focus stays in the input; screen readers follow the active option. */
export default function Picker({ label, placeholder, searchItems, selected, onSelect, onActivate, active, loading, icon, emptyHint }: {
  label: string; placeholder: string; searchItems: (query: string) => PickerItem[]; selected: PickerItem | null;
  onSelect: (id: number | null) => void; onActivate?: () => void;
  active?: boolean; loading?: boolean; icon?: ReactNode; emptyHint: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(-1);
  const items = useMemo(() => searchItems(query), [searchItems, query]);
  const expanded = open && !selected && !loading;

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

  function choose(item: PickerItem) {
    onSelect(item.id); setQuery(""); setOpen(false); setIndex(-1);
    requestAnimationFrame(() => selectedRef.current?.focus());
  }
  function edit() {
    onSelect(null); setQuery(""); setOpen(true); setIndex(-1);
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
      setIndex(current => {
        if (!items.length) return -1;
        if (!expanded || current < 0) return event.key === "ArrowDown" ? 0 : items.length - 1;
        return Math.max(0, Math.min(items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
      });
    }
    if (expanded && items.length && (event.key === "Home" || event.key === "End")) {
      event.preventDefault(); setIndex(event.key === "Home" ? 0 : items.length - 1);
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
          <button ref={selectedRef} type="button" onClick={edit} aria-label={`${label}: ${selected.name}. Dəyişmək üçün seçin`} className="min-w-0 flex-1 py-2 text-left focus-visible:outline-orange-500">
            <span className="block truncate text-sm font-semibold text-gray-900">{selected.badge && <span className="mr-2 rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">{selected.badge}</span>}{selected.name}</span>
            <span className="block truncate text-xs text-gray-500">{selected.detail || "Dayanacağı dəyişmək üçün toxunun"}</span>
          </button>
          <button type="button" onClick={edit} aria-label={`${label} seçimini sil`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 focus-visible:outline-orange-500"><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input ref={inputRef} id={id} type="text" inputMode="search" autoComplete="off" spellCheck={false}
            role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-list`}
            aria-activedescendant={expanded && index >= 0 && items[index] ? `${id}-option-${index}` : undefined}
            value={query} disabled={loading} placeholder={loading ? "Məlumat yüklənir…" : placeholder}
            onChange={event => { setQuery(event.target.value); setOpen(true); setIndex(-1); }}
            onFocus={() => { setOpen(true); onActivate?.(); }} onKeyDown={keys}
            className={`min-h-[58px] w-full rounded-xl border bg-white py-3 pl-10 pr-3 text-base text-gray-900 placeholder:text-sm placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:bg-gray-50 ${active ? "border-orange-300" : "border-gray-200"}`} />
        </div>
      )}
      {!selected && (
        <div hidden={!expanded} className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <p className="border-b border-gray-100 px-3 py-2 text-[11px] font-medium text-gray-500">{query.trim() ? "Uyğun nəticələr · ↑ ↓ ilə seçin" : emptyHint}</p>
          <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="bj-picker-suggestions max-h-64 overflow-y-auto overscroll-contain">
            {items.map((item, i) => (
              <li key={item.id} id={`${id}-option-${i}`} role="option" aria-selected={index === i}
                onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}
                className={`flex min-h-[52px] cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-orange-50 ${index === i ? "bg-orange-50" : ""}`}>
                {item.badge ? <span className="min-w-10 shrink-0 rounded-lg bg-blue-100 px-2 py-1 text-center text-sm font-bold text-blue-800">{item.badge}</span> : <MapPin className="h-4 w-4 shrink-0 text-gray-400" />}
                <span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-900">{item.name}</span>{item.detail && <span className="block truncate text-xs text-gray-500">{item.detail}</span>}</span>
              </li>
            ))}
          </ul>
          {items.length === 0 && <p role="status" className="px-3 py-4 text-sm text-gray-600">{query.trim() ? `«${query}» üzrə nəticə tapılmadı. Başqa ad və ya kod yazın.` : "Axtarmaq üçün dayanacaq adı və ya kod yazın."}</p>}
        </div>
      )}
    </div>
  );
}
