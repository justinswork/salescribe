"use client";

import { useEffect, useRef, useState } from "react";
import Recorder from "@/components/Recorder";
import ExtractionView from "@/components/ExtractionView";
import MemoHistory from "@/components/MemoHistory";
import RelatedMemos from "@/components/RelatedMemos";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import HandsFreeToggle from "@/components/HandsFreeToggle";
import BriefView from "@/components/BriefView";
import { useAuth } from "@/lib/AuthContext";
import { useHandsFree } from "@/lib/HandsFreeContext";
import { cancelSpeech, listenForReply, speak, type ListenHandle } from "@/lib/speech";
import type { Brief, ChatMessage, Extraction, FollowupResult, Memo } from "@/lib/schema";
import {
  loadMemos,
  saveMemo,
  deleteMemo,
  newMemoId,
  findRelatedMemos,
  findMemosByCompany,
  getCompanyOptions,
} from "@/lib/storage";

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
  const handsFree = useHandsFree();

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
  const [sampleLoading, setSampleLoading] = useState(false);

  // Briefing state: when briefingCompany is non-empty, the main content area
  // renders the BriefView (or its loading/error state) instead of the normal
  // recording UI. A null currentBrief alongside a non-empty briefingCompany
  // means we're still waiting on /api/brief to return.
  const [briefingCompany, setBriefingCompany] = useState<string>("");
  const [briefingMemoCount, setBriefingMemoCount] = useState(0);
  const [currentBrief, setCurrentBrief] = useState<Brief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState("");

  // Live transcript from the browser's SpeechRecognition during memo recording.
  // This is just a UX preview — the authoritative transcript still comes from
  // Whisper on the server after the user stops recording.
  const [liveTranscript, setLiveTranscript] = useState("");

  // Hands-free state. `speaking` is true while TTS is reading the coach's
  // question; `listening` is true while STT is collecting the salesperson's
  // spoken reply. `partialReply` mirrors the live transcript so the UI can
  // show what the recognizer is hearing in real time.
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [partialReply, setPartialReply] = useState("");
  const listenHandleRef = useRef<ListenHandle | null>(null);

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
    cancelSpeech();
    listenHandleRef.current?.stop();
    listenHandleRef.current = null;
    setSpeaking(false);
    setListening(false);
    setPartialReply("");
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
    setLiveTranscript("");
  }

  // On unmount, kill any in-flight speech or listening so the user doesn't get
  // a stuck "speaking..." after navigating away.
  useEffect(() => {
    return () => {
      cancelSpeech();
      listenHandleRef.current?.stop();
    };
  }, []);

  // Hands-free flow: when a follow-up question is on screen and hands-free is
  // enabled, speak the question, then listen for either a spoken reply or an
  // "end notes" voice command.
  useEffect(() => {
    if (!handsFree.enabled) return;
    if (status !== "ready_for_reply" || !currentQuestion) return;

    let aborted = false;

    (async () => {
      setSpeaking(true);
      await speak(currentQuestion);
      if (aborted) return;
      setSpeaking(false);

      setPartialReply("");
      setListening(true);
      listenHandleRef.current = listenForReply({
        onPartialTranscript: (t) => setPartialReply(t),
        onReply: (text) => {
          setListening(false);
          setPartialReply("");
          listenHandleRef.current = null;
          // Pass spoken text directly — bypasses the replyDraft input.
          void submitReply(text);
        },
        onEndNotesCommand: () => {
          setListening(false);
          setPartialReply("");
          listenHandleRef.current = null;
          void finalizeNow();
        },
        onError: (e) => {
          setListening(false);
          setPartialReply("");
          listenHandleRef.current = null;
          setError(`Listening failed: ${e.message}. Switch to typing or disable hands-free.`);
        },
      });
    })();

    return () => {
      aborted = true;
      cancelSpeech();
      listenHandleRef.current?.stop();
      listenHandleRef.current = null;
      setSpeaking(false);
      setListening(false);
      setPartialReply("");
    };
    // submitReply / finalizeNow are stable closures captured from this render;
    // we intentionally don't depend on them or eslint would chase its own tail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, currentQuestion, handsFree.enabled]);

  // Speak "Saved." once when a memo finishes in hands-free mode.
  useEffect(() => {
    if (!handsFree.enabled) return;
    if (status !== "done") return;
    void speak("Saved.");
  }, [status, handsFree.enabled]);

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
    setLiveTranscript("");
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

  async function submitReply(textOverride?: string) {
    const replyText = (textOverride ?? replyDraft).trim();
    if (!replyText || !extraction) return;
    const newChat: ChatMessage[] = [
      ...chat,
      { role: "assistant", content: currentQuestion },
      { role: "user", content: replyText },
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

  // Pull all memos for `company` from the loaded list, POST them to /api/brief,
  // render the Brief in BriefView. Errors fall through to the error state for
  // the same view rather than dumping the user back to the home screen.
  async function openBriefing(company: string) {
    const matching = findMemosByCompany(company, pastMemos);
    if (matching.length === 0) {
      setBriefError(`No memos found for "${company}".`);
      setBriefingCompany(company);
      setBriefingMemoCount(0);
      setCurrentBrief(null);
      return;
    }
    setBriefingCompany(company);
    setBriefingMemoCount(matching.length);
    setCurrentBrief(null);
    setBriefError("");
    setBriefLoading(true);
    try {
      const r = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, memos: matching }),
      });
      if (!r.ok) {
        let detail = "";
        try {
          const body = await r.json();
          detail = body.error ? `: ${body.error}` : "";
        } catch {}
        throw new Error(`Briefing failed (${r.status})${detail}`);
      }
      const data = (await r.json()) as { brief: Brief };
      setCurrentBrief(data.brief);
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : String(e));
    } finally {
      setBriefLoading(false);
    }
  }

  function closeBriefing() {
    setBriefingCompany("");
    setCurrentBrief(null);
    setBriefError("");
    setBriefLoading(false);
    setBriefingMemoCount(0);
  }

  // Fetch a fresh AI-generated sample memo, falling back to the hardcoded
  // SAMPLE constant if the route fails (rate limits, network, etc.) so the
  // button always does something even when the generator is down.
  async function fetchSample(): Promise<string> {
    setSampleLoading(true);
    try {
      const r = await fetch("/api/sample", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { transcript?: string };
      if (!data.transcript || data.transcript.trim().length === 0) {
        throw new Error("Empty transcript returned");
      }
      return data.transcript;
    } catch (e) {
      console.warn("[sample] generator failed, falling back to hardcoded:", e);
      return SAMPLE;
    } finally {
      setSampleLoading(false);
    }
  }

  async function loadSampleIntoText() {
    const t = await fetchSample();
    setTextInput(t);
  }

  async function tryVoiceModeSample() {
    setMode("text");
    const t = await fetchSample();
    setTextInput(t);
  }

  const busy =
    status === "transcribing" || status === "extracting" || status === "coaching";

  const statusLabel: Record<Status, string> = {
    idle: "",
    transcribing: "Transcribing audio...",
    extracting: "Pulling out structured details...",
    coaching: "Checking for gaps and past context...",
    ready_for_reply: "",
    // "done" and "error" intentionally empty: the primary action card
    // and the error block render their own confirmation/diagnostic UI,
    // so duplicating it in the gray status banner is just noise.
    done: "",
    error: "",
  };

  // Conversation is in flight whenever we have a transcript and haven't yet
  // finalized or errored out. Used to flip the follow-up chat panel between
  // a prominent top slot (so the question is impossible to miss) and a
  // compact bottom slot for review after the memo is saved.
  const conversationActive = Boolean(transcript) && status !== "done" && status !== "error";

  // The follow-up chat panel. Rendered in one of two positions depending on
  // conversationActive — at the top while the coach is asking questions, then
  // demoted to the bottom (smaller heading, muted background) for review once
  // the memo is saved.
  const followUpSection = (chat.length > 0 || currentQuestion) && (
    <section
      className={`rounded-lg border p-4 ${
        conversationActive
          ? "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
          : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40"
      }`}
    >
      <h2
        className={`font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-3 ${
          conversationActive ? "text-sm" : "text-xs"
        }`}
      >
        {conversationActive ? "Follow-up" : "Follow-up conversation"}
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
                {speaking && (
                  <span className="text-xs text-blue-700 dark:text-blue-400 font-medium inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                    reading question aloud…
                  </span>
                )}
                <div className="rounded-lg px-3 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
                  {currentQuestion}
                </div>
              </div>
            </div>
            {listening && (
              <div className="rounded-lg border border-blue-300 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/20 p-3 flex flex-col gap-1">
                <div className="text-xs font-medium text-blue-700 dark:text-blue-400 inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                  listening… say <span className="font-mono">&ldquo;end notes&rdquo;</span> to save and close
                </div>
                {partialReply && (
                  <div className="text-sm text-zinc-700 dark:text-zinc-300 italic">
                    {partialReply}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitReply();
                }}
                placeholder={
                  handsFree.enabled
                    ? "or type a reply manually…"
                    : "Your answer..."
                }
                disabled={speaking || listening}
                className="flex-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
                autoFocus={!handsFree.enabled}
              />
              <button
                type="button"
                onClick={() => void submitReply()}
                disabled={!replyDraft.trim() || busy || speaking || listening}
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
  );

  // Pre-meeting briefing view. Same shell as the memo-view branch — header
  // with a "back" handler in the logo and an account menu on the right; main
  // body either renders BriefView, a loading state, or an error.
  if (briefingCompany) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="mx-auto max-w-3xl px-6 py-5 flex items-center justify-between">
            <button
              type="button"
              onClick={closeBriefing}
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
              <button
                type="button"
                onClick={closeBriefing}
                className="text-sm text-zinc-500 dark:text-zinc-400 underline mr-2"
              >
                ← Back
              </button>
              <HandsFreeToggle />
              <ThemeToggle />
              <AccountMenu />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
          {briefLoading && (
            <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="inline-block h-3 w-3 rounded-full bg-zinc-400 animate-pulse" />
              <span>
                Reading {briefingMemoCount} memo{briefingMemoCount === 1 ? "" : "s"} about {briefingCompany}…
              </span>
            </div>
          )}
          {briefError && (
            <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-200">
              {briefError}
            </div>
          )}
          {currentBrief && (
            <BriefView
              company={briefingCompany}
              memoCount={briefingMemoCount}
              brief={currentBrief}
            />
          )}
        </main>
      </div>
    );
  }

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
          <div className="text-sm text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
            <span>Recorded {new Date(viewingMemo.created_iso).toLocaleString()}</span>
            {viewingMemo.is_demo && (
              <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                demo
              </span>
            )}
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
            <span
              className="ml-3 align-middle text-xs font-mono font-normal text-zinc-400 dark:text-zinc-500"
              title={`commit ${process.env.NEXT_PUBLIC_GIT_SHA}`}
            >
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          </button>
          <div className="flex items-center gap-2">
            <HandsFreeToggle />
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
                  <Recorder
                    onAudio={onAudio}
                    onLiveTranscript={setLiveTranscript}
                    disabled={busy || sampleLoading}
                  />
                  {liveTranscript && (
                    <div className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm italic text-zinc-700 dark:text-zinc-300">
                      <div className="text-xs font-medium not-italic text-zinc-500 dark:text-zinc-400 mb-1 uppercase tracking-wide">
                        live preview
                      </div>
                      {liveTranscript}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={tryVoiceModeSample}
                    disabled={sampleLoading}
                    className="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-50"
                  >
                    {sampleLoading ? "generating a sample…" : "or try a sample memo"}
                  </button>
                </>
              ) : (
                <div className="w-full flex flex-col gap-3">
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Paste or type a memo here..."
                    rows={8}
                    disabled={sampleLoading}
                    className="w-full rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 disabled:opacity-60"
                  />
                  <div className="flex gap-2 justify-end items-center">
                    <button
                      type="button"
                      onClick={loadSampleIntoText}
                      disabled={sampleLoading || busy}
                      className="text-xs text-zinc-500 dark:text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-50"
                    >
                      {sampleLoading ? "generating sample…" : "generate sample"}
                    </button>
                    <button
                      type="button"
                      onClick={submitText}
                      disabled={busy || !textInput.trim() || sampleLoading}
                      className="rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      Process
                    </button>
                  </div>
                </div>
              )}
            </section>

            {(() => {
              // Briefings panel: lists companies with 2+ memos (anything less
              // wouldn't really be a "briefing", just a re-read of one memo).
              // Click a company → openBriefing(company) navigates into the
              // brief view, which calls /api/brief and renders BriefView.
              const options = getCompanyOptions(pastMemos).filter((o) => o.memoCount >= 2);
              if (options.length === 0) return null;
              return (
                <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-1">
                    Pre-meeting briefings
                    <span className="ml-2 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-700 dark:text-zinc-300">
                      {options.length}
                    </span>
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
                    Synthesize the deal arc, open items, talking points, and risks across every past memo for a prospect.
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {options.slice(0, 10).map((o) => (
                      <li key={o.company}>
                        <button
                          type="button"
                          onClick={() => openBriefing(o.company)}
                          className="w-full flex items-center justify-between gap-3 rounded border border-zinc-200 dark:border-zinc-800 p-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                        >
                          <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {o.company}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">
                            {o.memoCount} memos · brief me →
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })()}

            <MemoHistory memos={pastMemos} onOpen={openMemo} onDelete={handleDelete} />
          </>
        )}

        {/* Conversation-active block: the chat panel and its status banner
            float to the top so the coach's question is impossible to miss.
            Once the memo is finalized (status="done"), the panel falls back
            to a compact slot near the bottom of the page — see below. */}
        {conversationActive && (
          <>
            {(busy || statusLabel[status]) && (
              <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
                {busy && <span className="inline-block h-3 w-3 rounded-full bg-zinc-400 animate-pulse" />}
                <span>{statusLabel[status]}</span>
              </div>
            )}
            {followUpSection}
          </>
        )}

        {/* Status banner in its original position only when we're NOT in an
            active conversation (e.g. transcribing audio before the transcript
            arrives). When the conversation is active it renders above with
            the chat panel instead. */}
        {!conversationActive && (busy || statusLabel[status]) && (
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

        {!conversationActive && followUpSection}

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
