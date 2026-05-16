"use client";

import { useState } from "react";
import Recorder from "@/components/Recorder";
import ExtractionView from "@/components/ExtractionView";
import type { ChatMessage, Extraction, FollowupResult } from "@/lib/schema";

type Status = "idle" | "transcribing" | "extracting" | "coaching" | "ready_for_reply" | "done" | "error";

const SAMPLE = `Okay, just got out of the meeting with Karen Holloway at Northwind Logistics. They're running into pretty bad spreadsheet sprawl on their dispatch side — Karen said they've got like fourteen different Excel files that drivers are emailing around every morning and it's blowing up. She mentioned they're looking at a budget in the thirty to forty thousand range for the first year. Decision is Karen plus their CFO Marcus. They're also evaluating FleetIO. I told her I'd send over our case study from Iron Mountain by end of day Friday. Oh, and remind me to call back our existing customer at Bay State Freight on Thursday about their renewal.`;

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [textInput, setTextInput] = useState("");

  function reset() {
    setStatus("idle");
    setTranscript("");
    setExtraction(null);
    setChat([]);
    setCurrentQuestion("");
    setReplyDraft("");
    setError("");
    setTextInput("");
  }

  async function processTranscript(text: string) {
    setTranscript(text);
    setStatus("extracting");
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: text,
          chat: [],
          reference_now_iso: new Date().toISOString(),
        }),
      });
      if (!r.ok) throw new Error(`Extraction failed (${r.status})`);
      const data = (await r.json()) as { extraction: Extraction };
      setExtraction(data.extraction);
      await askFollowup(text, data.extraction, []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function askFollowup(t: string, ex: Extraction, c: ChatMessage[]) {
    setStatus("coaching");
    try {
      const r = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: t, extraction: ex, chat: c }),
      });
      if (!r.ok) throw new Error(`Coach failed (${r.status})`);
      const data = (await r.json()) as { result: FollowupResult };
      if (data.result.done) {
        setCurrentQuestion("");
        setStatus("done");
      } else {
        setCurrentQuestion(data.result.question);
        setStatus("ready_for_reply");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function onAudio(blob: Blob, filename: string) {
    setStatus("transcribing");
    setError("");
    try {
      const fd = new FormData();
      fd.append("audio", new File([blob], filename, { type: blob.type }));
      const r = await fetch("/api/transcribe", { method: "POST", body: fd });
      if (!r.ok) throw new Error(`Transcription failed (${r.status})`);
      const data = (await r.json()) as { transcript: string };
      await processTranscript(data.transcript);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function submitReply() {
    if (!replyDraft.trim() || !extraction) return;
    const newChat: ChatMessage[] = [
      ...chat,
      { role: "assistant", content: currentQuestion },
      { role: "user", content: replyDraft.trim() },
    ];
    setChat(newChat);
    setReplyDraft("");
    setStatus("extracting");
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          chat: newChat,
          reference_now_iso: new Date().toISOString(),
        }),
      });
      if (!r.ok) throw new Error(`Re-extraction failed (${r.status})`);
      const data = (await r.json()) as { extraction: Extraction };
      setExtraction(data.extraction);
      await askFollowup(transcript, data.extraction, newChat);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function useSample() {
    setMode("text");
    setTextInput(SAMPLE);
  }

  async function submitText() {
    if (!textInput.trim()) return;
    await processTranscript(textInput.trim());
  }

  const busy =
    status === "transcribing" || status === "extracting" || status === "coaching";

  const statusLabel: Record<Status, string> = {
    idle: "",
    transcribing: "Transcribing audio...",
    extracting: "Pulling out structured details...",
    coaching: "Checking for gaps...",
    ready_for_reply: "",
    done: "Looks complete.",
    error: "Something went wrong.",
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-5 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Salescribe
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Voice memos → structured sales notes
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
        {!transcript && (
          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 flex flex-col items-center gap-5">
            <div className="flex gap-2 self-center text-sm">
              <button
                type="button"
                onClick={() => setMode("voice")}
                className={`px-3 py-1 rounded ${mode === "voice" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"}`}
              >
                Record
              </button>
              <button
                type="button"
                onClick={() => setMode("text")}
                className={`px-3 py-1 rounded ${mode === "text" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"}`}
              >
                Paste / type
              </button>
            </div>

            {mode === "voice" ? (
              <>
                <Recorder onAudio={onAudio} disabled={busy} />
                <button
                  type="button"
                  onClick={useSample}
                  className="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  or try a sample memo
                </button>
              </>
            ) : (
              <div className="w-full flex flex-col gap-3">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Paste or type a memo here..."
                  rows={8}
                  className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setTextInput(SAMPLE)}
                    className="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    fill with sample
                  </button>
                  <button
                    type="button"
                    onClick={submitText}
                    disabled={busy || !textInput.trim()}
                    className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Process
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {(busy || statusLabel[status]) && (
          <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            {busy && <span className="inline-block h-3 w-3 rounded-full bg-zinc-400 animate-pulse" />}
            <span>{statusLabel[status]}</span>
          </div>
        )}

        {error && (
          <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-200">
            {error}
            <button
              type="button"
              onClick={reset}
              className="ml-3 underline"
            >
              start over
            </button>
          </div>
        )}

        {transcript && (
          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
              Transcript
            </h2>
            <p className="text-sm whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">{transcript}</p>
          </section>
        )}

        {extraction && <ExtractionView extraction={extraction} />}

        {(chat.length > 0 || currentQuestion) && (
          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
              Follow-up
            </h2>
            <div className="flex flex-col gap-3">
              {chat.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "assistant" ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "assistant"
                        ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                        : "bg-blue-600 text-white"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {currentQuestion && status === "ready_for_reply" && (
                <>
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
                      {currentQuestion}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitReply();
                      }}
                      placeholder="Your answer..."
                      className="flex-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={submitReply}
                      disabled={!replyDraft.trim() || busy}
                      className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      Send
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentQuestion("");
                        setStatus("done");
                      }}
                      className="text-sm text-zinc-500 dark:text-zinc-400 px-3"
                    >
                      Skip
                    </button>
                  </div>
                </>
              )}
              {status === "done" && (
                <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
                  Note looks complete. Start a new memo when you're ready.
                </p>
              )}
            </div>
          </section>
        )}

        {transcript && (
          <button
            type="button"
            onClick={reset}
            className="self-start text-sm text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ← New memo
          </button>
        )}
      </main>
    </div>
  );
}
