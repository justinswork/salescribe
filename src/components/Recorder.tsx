"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listenLive, type ListenHandle } from "@/lib/speech";

type Props = {
  onAudio: (blob: Blob, filename: string) => void;
  onLiveTranscript?: (text: string) => void;
  disabled?: boolean;
};

// Hard cap on a single recording. Picked to comfortably fit inside every
// downstream constraint: OpenAI Whisper's 25 MB body limit (~100 min of
// webm/opus), Cloud Run's 5-minute request timeout for the transcription
// call, and cost runaway protection against an accidentally-forgotten
// recording. Most real sales voice memos are <90 seconds, so this is a
// soft ceiling for the 99% case rather than a constraint anyone bumps into.
const MAX_DURATION_SECONDS = 5 * 60; // 5 minutes

function pickMimeAndExt(): { mime: string; ext: string } {
  const candidates: Array<{ mime: string; ext: string }> = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/mpeg", ext: "mp3" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) {
      return c;
    }
  }
  return { mime: "", ext: "webm" };
}

function formatMMSS(totalSeconds: number): string {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function Recorder({ onAudio, onLiveTranscript, disabled }: Props) {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [permError, setPermError] = useState<string>("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveHandleRef = useRef<ListenHandle | null>(null);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    liveHandleRef.current?.stop();
    liveHandleRef.current = null;
    setState("idle");
  }, []);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      const r = recorderRef.current;
      if (r && r.state !== "inactive") r.stop();
      r?.stream.getTracks().forEach((t) => t.stop());
      liveHandleRef.current?.stop();
    };
  }, []);

  // Auto-stop when the recording hits the hard cap. Uses the same code path
  // as a manual stop click, so the audio that has been captured so far is
  // submitted normally — nothing is lost.
  useEffect(() => {
    if (state === "recording" && elapsed >= MAX_DURATION_SECONDS) {
      stop();
    }
  }, [state, elapsed, stop]);

  async function start() {
    setPermError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mime, ext } = pickMimeAndExt();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        onAudio(blob, `memo.${ext}`);
      };
      recorder.start();
      recorderRef.current = recorder;
      setState("recording");
      setElapsed(0);
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

      // Live preview via browser SpeechRecognition. Runs alongside MediaRecorder
      // and shares the same mic. Falls back to a no-op handle in browsers
      // without SpeechRecognition support (e.g. Firefox) — the recording flow
      // is otherwise identical.
      if (onLiveTranscript) {
        onLiveTranscript("");
        liveHandleRef.current = listenLive({
          onPartialTranscript: onLiveTranscript,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone access denied.";
      setPermError(message);
    }
  }

  // Color the timer amber starting at 80% of the cap so the user has a
  // chance to wrap up before the auto-stop fires.
  const nearLimit = state === "recording" && elapsed >= 0.8 * MAX_DURATION_SECONDS;
  const timerLabel =
    state === "recording"
      ? `Recording... ${formatMMSS(elapsed)} / ${formatMMSS(MAX_DURATION_SECONDS)} max`
      : "Tap to record";

  return (
    <div className="flex flex-col items-center gap-3">
      {state === "idle" ? (
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Start recording"
        >
          <span className="h-6 w-6 rounded-full bg-white" />
        </button>
      ) : (
        <button
          type="button"
          onClick={stop}
          className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white shadow-lg ring-4 ring-red-300 animate-pulse"
          aria-label="Stop recording"
        >
          <span className="h-6 w-6 rounded-sm bg-white" />
        </button>
      )}
      <div
        className={`text-sm tabular-nums ${
          nearLimit
            ? "text-amber-700 dark:text-amber-400 font-medium"
            : "text-zinc-600 dark:text-zinc-400"
        }`}
      >
        {timerLabel}
      </div>
      {permError && (
        <div className="text-sm text-red-600 max-w-xs text-center">{permError}</div>
      )}
    </div>
  );
}
