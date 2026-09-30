"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** Key of the saved choice; read by the script of app/layout.tsx before the first paint. */
export const THEME_KEY = "pq-theme";

/**
 * Light / dark switch. The theme lives in <html data-theme>, set before the
 * first paint (layout.tsx): the knob and icon follow it in CSS, so the server
 * render never shows the wrong one. The choice is saved in localStorage when
 * the browser allows it; otherwise it lasts until the page is left.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);

  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage refused (private browsing…): the choice is not kept.
    }
    setDark(next === "dark");
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Mode sombre"
      title={dark ? "Passer en mode clair" : "Passer en mode sombre"}
      className="theme-switch"
      onClick={toggle}
    >
      <span className="theme-switch-knob" aria-hidden="true">
        <Sun size={12} className="theme-icon-light" />
        <Moon size={12} className="theme-icon-dark" />
      </span>
    </button>
  );
}
