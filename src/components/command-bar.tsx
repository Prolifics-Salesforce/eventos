"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type Command = { label: string; href: string; hint: string };

/** Jump anywhere by typing. Press ⌘K or Ctrl K from any screen. */
export function CommandBar({ commands }: { commands: Command[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(q)) : commands).slice(0, 9);
  }, [query, commands]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    input.current?.blur();
    router.push(href);
  };

  return (
    <div className="cmd">
      <input
        ref={input} value={query} placeholder="Jump to an event, a screen, a guest list…" aria-label="Jump to"
        role="combobox" aria-expanded={open} aria-controls="cmd-list" autoComplete="off"
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { setQuery(e.target.value); setAt(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && matches[at]) { e.preventDefault(); go(matches[at].href); }
          else if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
        }}
      />
      <kbd>⌘K</kbd>
      {open && matches.length > 0 && (
        <ul id="cmd-list" role="listbox">
          {matches.map((c, i) => (
            <li key={c.href} role="option" aria-selected={i === at} className={i === at ? "on" : ""}>
              <a href={c.href} onMouseDown={(e) => { e.preventDefault(); go(c.href); }}>{c.label}<span>{c.hint}</span></a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
