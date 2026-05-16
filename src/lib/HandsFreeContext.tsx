"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { isSTTSupported } from "./speech";

type State = {
  enabled: boolean;
  supported: boolean;
  toggle: () => void;
};

const HandsFreeContext = createContext<State>({
  enabled: false,
  supported: true, // optimistic default for SSR
  toggle: () => {},
});

const STORAGE_KEY = "salescribe:handsFree";

export function HandsFreeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  // Assume supported during SSR; correct on mount once we can check window.
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    // TTS now has a server-side path (/api/speak) that works in every
    // browser, so we only gate on STT support. The browser SpeechRecognition
    // API is the actual blocker — Firefox is the notable holdout.
    setSupported(isSTTSupported());
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === "true") setEnabled(true);
    } catch {
      // localStorage unavailable; default to off in-memory.
    }
  }, []);

  function toggle() {
    setEnabled((cur) => {
      const next = !cur;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <HandsFreeContext.Provider value={{ enabled, supported, toggle }}>
      {children}
    </HandsFreeContext.Provider>
  );
}

export function useHandsFree(): State {
  return useContext(HandsFreeContext);
}
