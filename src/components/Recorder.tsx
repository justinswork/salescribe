"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onAudio: (blob: Blob, filename: string) => void;
  disabled?: boolean;
};

// Picks the best container/codec the browser can record. Chrome/Edge/Firefox all
// support webm/opus; Safari uses mp4/aac. Returning the matching filename keeps
// Whisper happy on the server (it dispatches by extension).
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

export default function Recorder({ onAudio, disabled }: Props) {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [permError, setPermError] = useState<string>("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      const r = recorderRef.current;
      if (r && r.state !== "inactive") r.stop();
      r?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone access denied.";
      setPermError(message);
    }
  }

  function stop() {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") r.stop();
    if (tickRef.current) clearInterval(tickRef.current);
    setState("idle");
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

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
      <div className="text-sm text-zinc-600 dark:text-zinc-400 tabular-nums">
        {state === "recording" ? `Recording... ${mm}:${ss}` : "Tap to record"}
      </div>
      {permError && (
        <div className="text-sm text-red-600 max-w-xs text-center">{permError}</div>
      )}
    </div>
  );
}
