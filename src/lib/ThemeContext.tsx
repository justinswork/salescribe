"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";

type ThemePref = "system" | "light" | "dark";
type Resolved = "light" | "dark";

type ThemeState = {
  pref: ThemePref;
  resolved: Resolved;
  cycle: () => void;
};

const STORAGE_KEY = "salescribe:theme";

const ThemeContext = createContext<ThemeState>({
  pref: "system",
  resolved: "light",
  cycle: () => {},
});

function readPref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePref): Resolved {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

function applyClass(resolved: Resolved) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize with whatever the pre-hydration <head> script already set on <html>.
  // This avoids a flash since the script ran synchronously before paint.
  const [pref, setPref] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<Resolved>("light");

  // First-mount sync: read localStorage and recompute. Server can't know.
  useEffect(() => {
    const initialPref = readPref();
    const initialResolved = resolve(initialPref);
    setPref(initialPref);
    setResolved(initialResolved);
    applyClass(initialResolved);
  }, []);

  // Listen for OS theme changes while in "system" mode.
  useEffect(() => {
    if (pref !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const r = systemPrefersDark() ? "dark" : "light";
      setResolved(r);
      applyClass(r);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [pref]);

  const cycle = useCallback(() => {
    const next: ThemePref = pref === "system" ? "light" : pref === "light" ? "dark" : "system";
    const r = resolve(next);
    setPref(next);
    setResolved(r);
    applyClass(r);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable (private mode etc.); the in-memory state still works.
    }
  }, [pref]);

  return (
    <ThemeContext.Provider value={{ pref, resolved, cycle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}
