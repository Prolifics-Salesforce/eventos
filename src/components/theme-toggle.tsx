"use client";

import { useEffect, useState } from "react";

/**
 * Runs before the page is drawn, so a chosen theme never flashes the other one first.
 * With no choice made, the device's own light or dark setting is used.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("eventos-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

/** Switches between light and dark, and remembers the choice on this device. */
export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const chosen = document.documentElement.dataset.theme;
    setDark(chosen ? chosen === "dark" : !window.matchMedia("(prefers-color-scheme: light)").matches);
  }, []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("eventos-theme", next); } catch { /* private browsing: the choice lasts for this page only */ }
    setDark(!dark);
  };
  return (
    <button type="button" className="theme" onClick={flip} aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"} title={dark ? "Light theme" : "Dark theme"}>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dark
          ? <><circle cx="10" cy="10" r="3.4" /><path d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4" /></>
          : <path d="M16.5 11.8A7 7 0 0 1 8.2 3.5a7 7 0 1 0 8.3 8.3z" />}
      </svg>
    </button>
  );
}
