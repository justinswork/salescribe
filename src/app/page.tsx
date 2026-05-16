"use client";

import { useEffect, useState } from "react";
import Recorder from "@/components/Recorder";
import ExtractionView from "@/components/ExtractionView";
import MemoHistory from "@/components/MemoHistory";
import RelatedMemos from "@/components/RelatedMemos";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/lib/AuthContext";
import type { ChatMessage, Extraction, FollowupResult, Memo } from "@/lib/schema";
import { loadMemos, saveMemo, deleteMemo, newMemoId, findRelatedMemos } from "@/lib/storage";

type Status = "idle" | "transcribing" | "extracting" | "coaching" | "ready_for_reply" | "done" | "error";

const SAMPLE = `Okay, just got out of the meeting with Karen Holloway at Northwind Logistics. They're running into pretty bad spreadsheet sprawl on their dispatch side — Karen said they've got like fourteen different Excel files that drivers are emailing around every morning and it's blowing up. She mentioned they're looking at a budget in the thirty to forty thousand range for the first year. Decision is Karen plus their CFO Marcus. They're also evaluating FleetIO. I told her I'd send over our case study from Iron Mountain by end of day Friday. Oh, and remind me to call back our existing customer at Bay State Freight on Thursday about their renewal.`;

export default function Home() {
  return (
    <AuthGuard>
      <SalescribeApp />
    </AuthGuard>
  );
}

function SalescribeApp() {
  const { user } = useAuth();

  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [currentQuestionType, setCurrentQuestionType] = useState<FollowupResult["question_type"]>("none");
  const [replyDraft, setReplyDraft] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const [textInput, setTextInput] = useState("");

  // Memory + retrieval
  const [pastMemos, setPastMemos] = useState<Memo[]>([]);
  const [relatedMemos, setRelatedMemos] = useState<Memo[]>([]);
  const [currentMemoId, setCurrentMemoId] = useState<string>("");
  const [viewingMemo, setViewingMemo] = useState<Memo | null>(null);

  // Load past memos whenever the signed-in user changes.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadMemos()
      .then((memos) => {
        if (!cancelled) setPastMemos(memos);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  function reset() {
    setStatus("idle");
    setTranscript("");
    setExtraction(null);
    setChat([]);
    setCurrentQuestion("");
    setCurrentQuestionType("none");
    setReplyDraft("");
    setError("");
    setTextInput("");
    setRelatedMemos([]);
    setCurrentMemoId("");
    setViewingMemo(null);
  }

  async function persistCurrent(finalExtraction: Extraction, finalChat: ChatMessage[]) {
    const id = currentMemoId || newMemoId();
    const memo: Memo = {
      id,
      created_iso: new Date().toISOString(),
      transcript,
      extraction: finalExtraction,
      chat: finalChat,
    };
    await saveMemo(memo);
    const fresh = await loadMemos();
    setPastMemos(fresh);
  }

  async function processTranscript(text: string) {
    setTranscript(text);
    setStatus("extracting");
    setCurrentMemoId(newMemoId());
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
      const related = findRelatedMemos(data.extraction, pastMemos);
      setRelatedMemos(related);
      await askFollowup(text, data.extraction, [], related);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function askFollowup(t: string, ex: Extraction, c: ChatMessage[], related: Memo[]) {
    setStatus("coaching");
    try {
      const r = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: t,
          extraction: ex,
          chat: c,
          related_past_memos: related,
        }),
      });
      if (!r.ok) throw new Error(`Coach failed (${r.status})`);
      const data = (await r.json()) as { result: FollowupResult };
      if (data.result.done) {
        setCurrentQuestion("");
        setCurrentQuestionType("none");
        setStatus("done");
        await persistCurrent(ex, c);
      } else {
        setCurrentQuestion(data.result.question);
        setCurrentQuestionType(data.result.question_type);
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
      if (!r.ok) {
        let detail = "";
        try {
          const body = await r.json();
          detail = body.error ? `: ${body.error}` : "";
        } catch {}
        throw new Error(`Transcription failed (${r.status})${detail}`);
      }
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
      const related = findRelatedMemos(data.extraction, pastMemos);
      setRelatedMemos(related);
      await askFollowup(transcript, data.extraction, newChat, related);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  async function finalizeNow() {
    if (!extraction) return;
    setCurrentQuestion("");
    setCurrentQuestionType("none");
    setStatus("done");
    await persistCurrent(extraction, chat);
  }

  function openMemo(m: Memo) {
    setViewingMemo(m);
  }

  async function handleDelete(id: string) {
    await deleteMemo(id);
    const fresh = await loadMemos();
    setPastMemos(fresh);
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
    coaching: "Checking for gaps and past context...",
    ready_for_reply: "",
    done: "Memo saved.",
    error: "Something went wrong.",
  };

  // Read-only view of a saved memo.
  if (viewingMemo) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="mx-auto max-w-3xl px-6 py-5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewingMemo(null)}
              className="inline-flex items-baseline rounded text-left hover:opacity-80"
              aria-label="Go to home"
            >
              <span className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Salescribe
              </span>
              <span
                className="ml-3 align-middle text-xs font-mono font-normal text-zinc-400 dark:text-zinc-500"
                title={`commit ${process.env.NEXT_PUBLIC_GIT_SHA}`}
              >
                v{process.env.NEXT_PUBLIC_APP_VERSION}
              </span>
            </button>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            Recorded {new Date(viewingMemo.created_iso).toLocaleString()}
          </div>
          <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
              Transcript
            </h2>
            <p className="text-sm whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
              {viewingMemo.transcript}
            </p>
          </section>
          <ExtractionView extraction={viewingMemo.extraction} />
          {viewingMemo.chat.length > 0 && (
            <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3">
                Follow-up
              </h2>
              <div className="flex flex-col gap-3">
                {viewingMemo.chat.map((m, i) => (
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
              </div>
            </section>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (!transcript || status === "done" || !extraction || confirm("Discard this memo without saving?")) {
                reset();
              }
            }}
            className="inline-flex items-baseline rounded text-left hover:opacity-80"
            aria-label="Go to home"
          >
            <span className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Salescribe
            </span>
            <span className="ml-3 align-middle text-xs font-mono font-normal text-zinc-400 dark:text-zinc-500">
              v {process.env.NEXT_PUBLIC_GIT_SHA}
            </span>
          </button>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
        {!transcript && (
          <>
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
                    onClick={() => {
                      setMode("text");
                      setTextInput(SAMPLE);
                    }}
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

            <MemoHistory memos={pastMemos} onOpen={openMemo} onDelete={handleDelete} />
          </>
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

        {relatedMemos.length > 0 && status !== "done" && (
          <RelatedMemos memos={relatedMemos} />
        )}

        {extraction && <ExtractionView extraction={extraction} />}

        {extraction && !busy && (
          <section
            className={`rounded-lg border p-4 flex items-center justify-between gap-3 ${
              status === "done"
                ? "border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-900"
                : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
            }`}
          >
            {status === "done" ? (
              <>
                <div className="text-sm text-green-800 dark:text-green-200 flex items-center gap-2">
                  <span aria-hidden="true">✓</span>
                  <span>Saved to your memo history.</span>
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium"
                >
                  Start new memo
                </button>
              </>
            ) : (
              <>
                <div className="text-sm text-zinc-700 dark:text-zinc-300">
                  Not saved yet — answer the coach below or finish now.
                </div>
                <button
                  type="button"
                  onClick={finalizeNow}
                  className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium"
                >
                  Save and finish
                </button>
              </>
            )}
          </section>
        )}

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
                    <div className="max-w-[80%] flex flex-col gap-1">
                      {currentQuestionType === "history" && (
                        <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                          ↻ referencing a past memo
                        </span>
                      )}
                      <div className="rounded-lg px-3 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
                        {currentQuestion}
                      </div>
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
                      onClick={finalizeNow}
                      className="text-sm text-zinc-500 dark:text-zinc-400 px-3"
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {transcript && status !== "done" && (
          <button
            type="button"
            onClick={() => {
              if (!extraction || confirm("Discard this memo without saving?")) reset();
            }}
            className="self-start text-sm text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ← Discard and start over
          </button>
        )}
      </main>
    </div>
  );
}
