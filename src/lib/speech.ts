"use client";

// Browser-native speech utilities for hands-free mode.
//
// Two APIs:
//   - speechSynthesis (TTS): well-supported, no key, instant. Used for
//     speaking the coach's follow-up questions and the "Saved." confirmation.
//   - SpeechRecognition (STT): used to listen for the salesperson's spoken
//     reply once a question has been read out loud. Continuous mode with a
//     silence timer determines when a reply is complete. Also watches for
//     end-notes voice commands.
//
// Browser support: Chrome/Edge/Safari support both APIs. Firefox supports
// speechSynthesis but not SpeechRecognition. The hands-free toggle is
// disabled in unsupported browsers — see HandsFreeContext.

// ----------------------------------------------------------------------------
// Minimal type declarations for SpeechRecognition (not in standard lib.dom.d.ts).
// ----------------------------------------------------------------------------
type SpeechRecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
};
type SpeechRecognitionErrorEvent = { error: string; message?: string };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ----------------------------------------------------------------------------
// Support detection
// ----------------------------------------------------------------------------
export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function isSTTSupported(): boolean {
  return getRecognitionCtor() !== null;
}

// ----------------------------------------------------------------------------
// TTS — browser speechSynthesis (no external key needed). Instant; voice
// quality depends on the OS/browser. speak() resolves when playback ends.
// (The `voice` option is accepted but unused now that server TTS is gone.)
// ----------------------------------------------------------------------------

export function speak(
  text: string,
  opts?: { rate?: number; pitch?: number; voice?: string },
): Promise<void> {
  cancelSpeech();
  return new Promise((resolve) => {
    if (!isTTSSupported() || !text.trim()) {
      resolve();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts?.rate ?? 1.0;
    u.pitch = opts?.pitch ?? 1.0;
    u.lang = "en-US";
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function cancelSpeech(): void {
  if (isTTSSupported()) window.speechSynthesis.cancel();
}

// ----------------------------------------------------------------------------
// STT: continuous listen with command detection and silence-based finalization
// ----------------------------------------------------------------------------

// Phrases that, when said any time during a reply, save and close the memo.
// Kept liberal so a salesperson's natural speech ("we're done", "that's all")
// works without memorizing a magic word.
const END_NOTES_PATTERNS: RegExp[] = [
  /\bend notes?\b/i,
  /\bsave (and )?close\b/i,
  /\bsave (the )?notes?\b/i,
  /\bsave (the )?memo\b/i,
  /\bthat'?s all\b/i,
  /\bwe'?re done\b/i,
  /\bdone (with )?(recording|memo|notes?)\b/i,
];

export function detectEndNotesCommand(text: string): boolean {
  const normalized = text.toLowerCase();
  return END_NOTES_PATTERNS.some((re) => re.test(normalized));
}

export type ListenOptions = {
  // Live partial transcript (interim + finalized so far). Updates as speech arrives.
  onPartialTranscript: (text: string) => void;
  // Fired when a reply is considered complete via silence threshold.
  onReply: (text: string) => void;
  // Fired when an end-notes command is detected (interrupts the reply).
  onEndNotesCommand: () => void;
  // Fired on unrecoverable errors. Silence-related events are filtered out.
  onError: (e: Error) => void;
  // Silence threshold before treating the reply as complete. Default 3s.
  silenceMs?: number;
};

export type ListenHandle = { stop: () => void };

// ----------------------------------------------------------------------------
// Live preview: continuous transcription with no command detection, no
// silence finalization. Used during memo recording to render a live preview
// alongside the MediaRecorder. The eventual authoritative transcript still
// comes from Whisper on the server; this is just for "I see my words" UX.
// ----------------------------------------------------------------------------
export function listenLive(opts: {
  onPartialTranscript: (text: string) => void;
  onError?: (e: Error) => void;
}): ListenHandle {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    // Not supported (e.g., Firefox). Return a no-op handle — the caller still
    // gets the recording experience, just without the live preview.
    return { stop: () => {} };
  }

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  let finalText = "";
  let stopped = false;

  rec.onresult = (e) => {
    if (stopped) return;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result.isFinal) {
        finalText += result[0].transcript + " ";
      } else {
        interim += result[0].transcript;
      }
    }
    opts.onPartialTranscript((finalText + interim).trim());
  };

  rec.onerror = (e) => {
    if (stopped) return;
    if (e.error === "no-speech" || e.error === "aborted") return;
    opts.onError?.(new Error(e.error || "speech recognition error"));
  };

  // Some browsers auto-end the session after a silence even in continuous
  // mode. Restart so the user keeps seeing words as they keep talking.
  rec.onend = () => {
    if (stopped) return;
    try {
      rec.start();
    } catch {
      // already stopped or in a state that rejects start; safe to ignore.
    }
  };

  try {
    rec.start();
  } catch (e) {
    opts.onError?.(e instanceof Error ? e : new Error(String(e)));
  }

  return {
    stop: () => {
      stopped = true;
      try {
        rec.stop();
      } catch {
        // best-effort
      }
    },
  };
}

export function listenForReply(opts: ListenOptions): ListenHandle {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    opts.onError(new Error("Speech recognition not supported in this browser"));
    return { stop: () => {} };
  }

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  let finalText = "";
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const silenceMs = opts.silenceMs ?? 3000;

  function clearSilence() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function finalize(reason: "reply" | "command") {
    if (stopped) return;
    stopped = true;
    clearSilence();
    try {
      rec.stop();
    } catch {
      // best-effort
    }
    const text = finalText.trim();
    if (reason === "command") {
      opts.onEndNotesCommand();
    } else if (text.length > 0) {
      opts.onReply(text);
    }
  }

  function armSilence() {
    clearSilence();
    silenceTimer = setTimeout(() => finalize("reply"), silenceMs);
  }

  rec.onresult = (e) => {
    if (stopped) return;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        finalText += transcript + " ";
      } else {
        interim += transcript;
      }
    }
    const combined = (finalText + interim).trim();
    opts.onPartialTranscript(combined);

    // End-notes command: fire immediately on detection, don't wait for silence.
    if (detectEndNotesCommand(combined)) {
      finalize("command");
      return;
    }

    armSilence();
  };

  rec.onerror = (e) => {
    if (stopped) return;
    // Benign — "no-speech" means the user didn't speak yet; "aborted" means we
    // stopped ourselves. Neither is a real error.
    if (e.error === "no-speech" || e.error === "aborted") return;
    finalize("reply"); // hand back whatever we have so far
    opts.onError(new Error(e.error || "speech recognition error"));
  };

  rec.onend = () => {
    clearSilence();
  };

  try {
    rec.start();
  } catch (e) {
    opts.onError(e instanceof Error ? e : new Error(String(e)));
  }

  return {
    stop: () => {
      stopped = true;
      clearSilence();
      try {
        rec.stop();
      } catch {
        // best-effort
      }
    },
  };
}
