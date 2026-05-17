// Per-route input size caps. These bound the cost of a single API call and
// blunt DoS-via-huge-input. Numbers are deliberately roomy for legitimate
// usage (a 5-minute Whisper transcript averages ~5KB; a pasted memo would
// rarely exceed 10KB; coach questions are under 200 chars). Anything past
// these limits is either programmatic abuse or a misuse case we want to
// fail fast on.

export const LIMITS = {
  // Transcript text submitted to /api/extract or /api/followup.
  // 5 min of Whisper output is ~5 KB; 50 KB is a 10x buffer.
  transcriptChars: 50_000,
  // A single chat message in the dialogue history.
  chatMessageChars: 5_000,
  // Total number of messages in the dialogue history.
  chatMessageCount: 100,
  // Past-memo payload sent to /api/followup (summary + deal + contacts +
  // open reminders for up to MAX_RELATED memos). 30 KB easily fits 3
  // reasonable memos with margin.
  relatedMemosBytes: 30_000,
  // Text submitted to /api/speak (a single coach question or "Saved.").
  speakChars: 1_000,
} as const;
