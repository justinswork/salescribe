// Eval set for Salescribe extraction.
//
// Each case has:
//   - id: short slug for the report
//   - transcript: synthetic memo text
//   - reference_now_iso: pin "now" so date assertions are stable
//   - checks: an object whose values are functions (extraction) => string|null
//     returning null on pass, a failure message on fail.
//
// Keep cases focused on ONE behavior each. Pile-on cases make failure diagnosis hard.

export const cases = [
  {
    id: "01-canonical-discovery-call",
    transcript:
      "Okay, just got out of the meeting with Karen Holloway at Northwind Logistics. They're running into pretty bad spreadsheet sprawl on their dispatch side — Karen said they've got like fourteen different Excel files that drivers are emailing around every morning and it's blowing up. She mentioned they're looking at a budget in the thirty to forty thousand range for the first year. Decision is Karen plus their CFO Marcus. They're also evaluating FleetIO. I told her I'd send over our case study from Iron Mountain by end of day Friday.",
    reference_now_iso: "2026-05-15T14:00:00-04:00",
    checks: {
      "deal is non-null": (e) => (e.deal ? null : "expected deal to be populated"),
      "company is Northwind Logistics": (e) =>
        e.deal && /northwind/i.test(e.deal.company ?? "") ? null : `got company=${e.deal?.company}`,
      "competitor mentions FleetIO": (e) =>
        e.deal && /fleetio/i.test(e.deal.competitors ?? "") ? null : `got competitors=${e.deal?.competitors}`,
      "budget signal captured": (e) =>
        e.deal && /(30|thirty|40|forty)/i.test(e.deal.budget_signals ?? "")
          ? null
          : `got budget_signals=${e.deal?.budget_signals}`,
      "Karen and Marcus appear in contacts": (e) => {
        const names = e.contacts.map((c) => c.name.toLowerCase());
        const hasKaren = names.some((n) => n.includes("karen"));
        const hasMarcus = names.some((n) => n.includes("marcus"));
        return hasKaren && hasMarcus ? null : `contacts=${JSON.stringify(names)}`;
      },
      "next-step due is Friday 2026-05-15 week": (e) => {
        const iso = e.deal?.next_step_due_iso;
        if (!iso) return "no next_step_due_iso";
        // Friday following reference_now (2026-05-15) is 2026-05-15 itself? Actually 2026-05-15 is a Friday.
        // The memo says "by end of day Friday" — given today is Friday, the model should resolve to today or next Friday.
        // Accept either, as long as month is 2026-05.
        return /^2026-05-(15|22)/.test(iso) ? null : `got next_step_due_iso=${iso}`;
      },
    },
  },
  {
    id: "02-personal-reminder-no-deal",
    transcript:
      "Remind me to pick up my dry cleaning Wednesday after work. And I need to call my dentist to reschedule the cleaning appointment.",
    reference_now_iso: "2026-05-15T14:00:00-04:00",
    checks: {
      "deal is null": (e) => (e.deal === null ? null : `expected null deal, got ${JSON.stringify(e.deal)}`),
      "two reminders extracted": (e) =>
        e.reminders.length === 2 ? null : `got ${e.reminders.length} reminders`,
      "no fake contacts": (e) =>
        e.contacts.length === 0 ? null : `got ${e.contacts.length} contacts (should be none)`,
      "no fake events": (e) =>
        e.calendar_events.length === 0
          ? null
          : `got ${e.calendar_events.length} events (should be none)`,
    },
  },
  {
    id: "03-calendar-event-only",
    transcript:
      "Set up a meeting with the Acme team tomorrow at 2pm at their downtown office. It's me, Jen, and Bob from their engineering side.",
    reference_now_iso: "2026-05-15T09:00:00-04:00",
    checks: {
      "one event extracted": (e) =>
        e.calendar_events.length === 1 ? null : `got ${e.calendar_events.length} events`,
      "event start resolves to 2026-05-16 14:00": (e) => {
        const start = e.calendar_events[0]?.start_iso ?? "";
        return /^2026-05-16T14/.test(start) ? null : `got start_iso=${start}`;
      },
      "location captured": (e) => {
        const loc = e.calendar_events[0]?.location ?? "";
        return /downtown|acme/i.test(loc) ? null : `got location=${loc}`;
      },
      "attendees include Jen and Bob": (e) => {
        const att = (e.calendar_events[0]?.attendees ?? []).join(" ").toLowerCase();
        return att.includes("jen") && att.includes("bob") ? null : `got attendees=${att}`;
      },
    },
  },
  {
    id: "04-self-correction",
    transcript:
      "Remind me to call Lisa at TechVantage on Tuesday — actually no, make it Wednesday — about the renewal pricing she asked for.",
    reference_now_iso: "2026-05-15T09:00:00-04:00",
    checks: {
      "reminder due is Wednesday 2026-05-20": (e) => {
        const iso = e.reminders[0]?.due_iso ?? "";
        // Wednesday after Fri 5/15 = Wed 5/20
        return /^2026-05-20/.test(iso) ? null : `got due_iso=${iso}`;
      },
      "no reminder for Tuesday": (e) => {
        const tueHits = e.reminders.filter((r) => /^2026-05-19/.test(r.due_iso ?? ""));
        return tueHits.length === 0 ? null : "model latched onto the rescinded Tuesday";
      },
    },
  },
  {
    id: "05-vague-memo-no-fabrication",
    transcript: "Had a good call earlier. They seemed interested. We'll see.",
    reference_now_iso: "2026-05-15T14:00:00-04:00",
    checks: {
      "no invented contact names": (e) =>
        e.contacts.length === 0 ? null : `invented contacts: ${JSON.stringify(e.contacts)}`,
      "no invented company": (e) =>
        !e.deal || !e.deal.company
          ? null
          : `invented company: ${e.deal.company}`,
      "no invented dates": (e) => {
        const dated = [
          ...e.reminders.map((r) => r.due_iso),
          ...e.calendar_events.map((c) => c.start_iso),
          e.deal?.next_step_due_iso,
        ].filter((x) => x !== null && x !== undefined);
        return dated.length === 0 ? null : `invented dates: ${JSON.stringify(dated)}`;
      },
    },
  },
];
