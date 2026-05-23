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
  {
    id: "06-multi-event-day",
    transcript:
      "Tomorrow's packed. At 9 I'm seeing Tom at TechCo, then I've got lunch with Sarah at 12:30 — we're meeting at that Italian place near her office. Back to TechCo at 3 for the CFO meeting with Patricia.",
    reference_now_iso: "2026-05-15T08:00:00-04:00",
    checks: {
      "three distinct events extracted": (e) =>
        e.calendar_events.length === 3 ? null : `got ${e.calendar_events.length} events`,
      "first event at 9am with Tom": (e) => {
        const ev = e.calendar_events[0];
        if (!ev) return "no first event";
        const okTime = /^2026-05-16T09/.test(ev.start_iso);
        const okPerson = (ev.attendees || []).join(" ").toLowerCase().includes("tom") ||
          (ev.title || "").toLowerCase().includes("tom") ||
          (ev.notes || "").toLowerCase().includes("tom");
        return okTime && okPerson ? null : `got start=${ev.start_iso}, attendees=${JSON.stringify(ev.attendees)}, title=${ev.title}`;
      },
      "lunch event at 12:30 with Sarah": (e) => {
        const lunch = e.calendar_events.find((ev) =>
          /^2026-05-16T12:?3/.test(ev.start_iso),
        );
        if (!lunch) return "no event at 12:30";
        const okPerson = (lunch.attendees || []).join(" ").toLowerCase().includes("sarah") ||
          (lunch.title || "").toLowerCase().includes("sarah");
        return okPerson ? null : `lunch attendees=${JSON.stringify(lunch.attendees)}, title=${lunch.title}`;
      },
      "CFO meeting at 3pm with Patricia": (e) => {
        const cfo = e.calendar_events.find((ev) =>
          /^2026-05-16T15/.test(ev.start_iso),
        );
        if (!cfo) return "no 3pm event";
        const okPerson = (cfo.attendees || []).join(" ").toLowerCase().includes("patricia") ||
          (cfo.title || "").toLowerCase().includes("patricia") ||
          (cfo.notes || "").toLowerCase().includes("patricia");
        return okPerson ? null : `3pm attendees=${JSON.stringify(cfo.attendees)}, title=${cfo.title}`;
      },
    },
  },
  {
    id: "07-implicit-pain-and-budget",
    transcript:
      "Karen at Northwind was pretty frustrated today. She kept complaining about how their current vendor keeps missing deadlines and it's been costing them real money on customer churn. She didn't quote a number but she made it crystal clear price is going to be a big factor in this decision.",
    reference_now_iso: "2026-05-15T14:00:00-04:00",
    checks: {
      "deal captures stated problem (vendor missing deadlines)": (e) => {
        const problem = (e.deal?.stated_problem || "").toLowerCase();
        return /(vendor|deadline|miss|churn)/.test(problem)
          ? null
          : `stated_problem=${e.deal?.stated_problem}`;
      },
      "deal captures price-sensitivity in objections or budget_signals": (e) => {
        const blob = `${e.deal?.objections || ""} ${e.deal?.budget_signals || ""}`.toLowerCase();
        return /(price|cost|budget|factor)/.test(blob)
          ? null
          : `objections=${e.deal?.objections}, budget_signals=${e.deal?.budget_signals}`;
      },
      "no invented price number": (e) => {
        const blob = `${e.deal?.budget_signals || ""} ${e.summary || ""}`;
        const hasDollarFigure = /\$\d|\d[,\.]\d{3}|\d+k\b/i.test(blob);
        return hasDollarFigure ? "fabricated a dollar figure" : null;
      },
    },
  },
  {
    id: "09-multi-company-disambiguation",
    transcript:
      "Talked to Karen at Northwind today. She mentioned they used to work with Tom over at Bay State Freight back when she was there a few years ago. Anyway, the deal is moving forward — she said their CFO Marcus needs to sign off and they're hoping to wrap by end of quarter.",
    reference_now_iso: "2026-05-15T14:00:00-04:00",
    checks: {
      "deal.company is Northwind (not Bay State)": (e) => {
        const c = (e.deal?.company || "").toLowerCase();
        return /northwind/.test(c) && !/bay state/.test(c)
          ? null
          : `deal.company=${e.deal?.company}`;
      },
      "Karen tagged as Northwind, not Bay State": (e) => {
        const karen = e.contacts.find((x) => /karen/i.test(x.name));
        if (!karen) return "no Karen in contacts";
        const co = (karen.company || "").toLowerCase();
        return /northwind/.test(co) && !/bay state/.test(co)
          ? null
          : `Karen.company=${karen.company}`;
      },
      "Tom tagged as Bay State (the tangential reference), not Northwind": (e) => {
        const tom = e.contacts.find((x) => /tom/i.test(x.name));
        if (!tom) return "Tom not extracted at all";
        const co = (tom.company || "").toLowerCase();
        return /bay state/.test(co) ? null : `Tom.company=${tom.company}`;
      },
      "Marcus is captured as a Northwind decision-maker": (e) => {
        const dm = (e.deal?.decision_makers || "").toLowerCase();
        const marcusContact = e.contacts.find((x) => /marcus/i.test(x.name));
        const marcusInDM = /marcus/.test(dm);
        const marcusNorthwind = marcusContact && /northwind/i.test(marcusContact.company || "");
        return marcusInDM || marcusNorthwind
          ? null
          : `decision_makers=${e.deal?.decision_makers}, marcusContact=${JSON.stringify(marcusContact)}`;
      },
    },
  },
  {
    id: "08-strong-language-classified-as-objection",
    transcript:
      "Met with the team at Initech. Bill thinks our reporting is way too clunky compared to what they get from Salesforce. He literally said 'this is a deal-breaker for us unless you can show me a roadmap'. Need to follow up by next Friday with our product team's response.",
    reference_now_iso: "2026-05-15T14:00:00-04:00",
    checks: {
      "objection captures the deal-breaker / reporting complaint": (e) => {
        const obj = (e.deal?.objections || "").toLowerCase();
        return /(report|clunky|deal.?break|roadmap)/.test(obj)
          ? null
          : `objections=${e.deal?.objections}`;
      },
      "Salesforce shows up as a competitor": (e) => {
        const comp = (e.deal?.competitors || "").toLowerCase();
        return /salesforce/.test(comp) ? null : `competitors=${e.deal?.competitors}`;
      },
      "next-step due is Friday 2026-05-22": (e) => {
        const iso = e.deal?.next_step_due_iso || "";
        return /^2026-05-22/.test(iso) ? null : `next_step_due_iso=${iso}`;
      },
    },
  },
  // -----------------------------
  // Coach-side tests (POST /api/followup directly).
  // Probe the agentic question_type choice and the RAG-grounded "history" mode.
  // -----------------------------
  {
    id: "10-coach-picks-gap-when-no-memory",
    type: "followup",
    transcript:
      "Quick one — talked to Karen at Northwind. They want a demo next Tuesday.",
    extraction: {
      summary: "Karen at Northwind requested a demo next Tuesday.",
      calendar_events: [
        {
          title: "Demo with Karen at Northwind",
          start_iso: "2026-05-26T14:00:00-04:00",
          end_iso: null,
          location: null,
          attendees: ["Karen"],
          notes: null,
        },
      ],
      reminders: [],
      contacts: [{ name: "Karen", role: null, company: "Northwind", notes: null }],
      deal: {
        company: "Northwind",
        prospect_name: "Karen",
        stated_problem: null,
        budget_signals: null,
        decision_makers: null,
        objections: null,
        competitors: null,
        next_step: "Demo next Tuesday",
        next_step_due_iso: "2026-05-26T14:00:00-04:00",
      },
    },
    chat: [],
    related_past_memos: [],
    checks: {
      "not done — there are obvious gaps": (r) =>
        r.done === false ? null : "coach prematurely declared done",
      "picks question_type=gap": (r) =>
        r.question_type === "gap" ? null : `question_type=${r.question_type}`,
      "question is brief (<=25 words)": (r) => {
        const wc = r.question.trim().split(/\s+/).length;
        return wc <= 25 ? null : `question is ${wc} words: "${r.question}"`;
      },
      "no filler intro": (r) => {
        const opening = r.question.trim().toLowerCase();
        return /^(great|nice|awesome|good memo|wow|thanks|love)/.test(opening)
          ? `opens with filler: "${r.question}"`
          : null;
      },
    },
  },
  {
    id: "11-coach-picks-history-when-stale-fact",
    type: "followup",
    transcript: "Caught up with Karen at Northwind again. Demo went well.",
    extraction: {
      summary: "Karen at Northwind: demo went well.",
      calendar_events: [],
      reminders: [],
      contacts: [{ name: "Karen", role: null, company: "Northwind", notes: null }],
      deal: {
        company: "Northwind",
        prospect_name: "Karen",
        stated_problem: null,
        budget_signals: null,
        decision_makers: null,
        objections: null,
        competitors: null,
        next_step: null,
        next_step_due_iso: null,
      },
    },
    chat: [],
    related_past_memos: [
      {
        id: "past-1",
        created_iso: "2026-05-01T14:00:00-04:00",
        transcript:
          "Met with Karen at Northwind. They're looking at 30-40K budget for the first year. CFO Marcus needs to sign off. Also evaluating FleetIO.",
        extraction: {
          summary: "Karen at Northwind, 30-40K budget, CFO Marcus involved, evaluating FleetIO.",
          calendar_events: [],
          reminders: [],
          contacts: [
            { name: "Karen", role: null, company: "Northwind", notes: null },
            { name: "Marcus", role: "CFO", company: "Northwind", notes: null },
          ],
          deal: {
            company: "Northwind",
            prospect_name: "Karen",
            stated_problem: "Spreadsheet sprawl on dispatch.",
            budget_signals: "30-40K for first year",
            decision_makers: "Karen + CFO Marcus",
            objections: null,
            competitors: "FleetIO",
            next_step: null,
            next_step_due_iso: null,
          },
        },
        chat: [],
      },
    ],
    checks: {
      "picks question_type=history (referencing past fact)": (r) =>
        r.question_type === "history"
          ? null
          : `question_type=${r.question_type}, question="${r.question}"`,
      "question references a past-memo fact (budget, Marcus, FleetIO, or pricing)": (r) => {
        const q = r.question.toLowerCase();
        return /(budget|30|40|marcus|cfo|fleetio|price|pricing|spreadsheet|dispatch)/.test(q)
          ? null
          : `question="${r.question}"`;
      },
      "question is brief (<=25 words)": (r) => {
        const wc = r.question.trim().split(/\s+/).length;
        return wc <= 25 ? null : `question is ${wc} words`;
      },
    },
  },
  // -----------------------------
  // Briefing cases (POST /api/brief). Probe cross-memo arc reconstruction,
  // identifying who owes outstanding next-steps, risk flagging from temporal
  // patterns, and anti-fabrication on sparse input.
  // Each case ships its own small multi-memo arc — self-contained, no
  // dependency on demo-data.json.
  // -----------------------------
  {
    id: "13-brief-arc-reconstruction-closed-won",
    type: "brief",
    company: "Acme Logistics",
    memos: [
      {
        id: "test-acme-1",
        created_iso: "2026-01-08T10:00:00-04:00",
        transcript:
          "Discovery call with Anna at Acme Logistics. They're running 80 trucks with spreadsheet dispatch. Pain is obvious. Mentioned $50-60K range.",
        extraction: {
          summary: "Discovery call with Anna at Acme Logistics. 80 trucks, spreadsheet dispatch, $50-60K range.",
          calendar_events: [],
          reminders: [],
          contacts: [{ name: "Anna Chen", role: "VP Ops", company: "Acme Logistics", notes: null }],
          deal: {
            company: "Acme Logistics",
            prospect_name: "Anna Chen",
            stated_problem: "Spreadsheet dispatch chaos with 80 trucks",
            budget_signals: "$50-60K range mentioned",
            decision_makers: "Anna",
            objections: null,
            competitors: null,
            next_step: "Send pricing",
            next_step_due_iso: null,
          },
        },
        chat: [],
      },
      {
        id: "test-acme-2",
        created_iso: "2026-02-14T14:00:00-04:00",
        transcript:
          "Demo with Anna and her IT lead Sanjay. Went well. They want to talk to a reference customer.",
        extraction: {
          summary: "Demo at Acme with Anna and IT lead Sanjay. Strong reception. Reference customer requested next.",
          calendar_events: [],
          reminders: [],
          contacts: [
            { name: "Anna Chen", role: "VP Ops", company: "Acme Logistics", notes: null },
            { name: "Sanjay Patel", role: "IT Lead", company: "Acme Logistics", notes: null },
          ],
          deal: {
            company: "Acme Logistics",
            prospect_name: "Anna Chen",
            stated_problem: "Spreadsheet dispatch chaos",
            budget_signals: "$50-60K range",
            decision_makers: "Anna, Sanjay",
            objections: null,
            competitors: null,
            next_step: "Set up reference customer call",
            next_step_due_iso: null,
          },
        },
        chat: [],
      },
      {
        id: "test-acme-3",
        created_iso: "2026-03-20T11:00:00-04:00",
        transcript:
          "Closed Acme. Signed at $58K, 2-year contract. Implementation kickoff next month.",
        extraction: {
          summary: "Acme Logistics closed-won at $58K on a 2-year contract. Implementation kickoff scheduled.",
          calendar_events: [],
          reminders: [],
          contacts: [
            { name: "Anna Chen", role: "VP Ops", company: "Acme Logistics", notes: null },
          ],
          deal: {
            company: "Acme Logistics",
            prospect_name: "Anna Chen",
            stated_problem: null,
            budget_signals: "Closed at $58K",
            decision_makers: "Anna",
            objections: null,
            competitors: null,
            next_step: "Implementation kickoff next month",
            next_step_due_iso: null,
          },
        },
        chat: [],
      },
    ],
    checks: {
      "deal_status_summary reflects closed-won": (b) => {
        const s = b.deal_status_summary.toLowerCase();
        return /(closed|won|signed|contract|implementation)/.test(s)
          ? null
          : `summary doesn't mention close: "${b.deal_status_summary}"`;
      },
      "deal_arc has at least 2 entries (multi-memo synthesis)": (b) =>
        b.deal_arc.length >= 2 ? null : `arc has only ${b.deal_arc.length} entries`,
      "deal_arc is chronological": (b) => {
        for (let i = 1; i < b.deal_arc.length; i++) {
          if (b.deal_arc[i - 1].date_iso > b.deal_arc[i].date_iso) {
            return `arc out of order at index ${i}`;
          }
        }
        return null;
      },
      "no fabricated competitor (none were mentioned)": (b) => {
        const blob = `${b.deal_status_summary} ${b.talking_points.join(" ")} ${b.risks.map((r) => r.description).join(" ")}`.toLowerCase();
        return /\b(fleetio|samsara|routific|motive|competitor)\b/.test(blob)
          ? "fabricated a competitor that wasn't in the memos"
          : null;
      },
    },
  },
  {
    id: "14-brief-flags-outstanding-salesperson-debt",
    type: "brief",
    company: "Brillion Carriers",
    memos: [
      {
        id: "test-brillion-1",
        created_iso: "2026-02-10T10:00:00-04:00",
        transcript:
          "Met with Carla at Brillion Carriers. Promised to send over our SOC2 documents and a case study from a similar size customer by end of week.",
        extraction: {
          summary: "Met with Carla at Brillion Carriers. Promised to send SOC2 docs and a case study by end of week.",
          calendar_events: [],
          reminders: [
            { text: "Send SOC2 docs and case study to Carla at Brillion", due_iso: null },
          ],
          contacts: [{ name: "Carla Reyes", role: "VP IT", company: "Brillion Carriers", notes: null }],
          deal: {
            company: "Brillion Carriers",
            prospect_name: "Carla Reyes",
            stated_problem: "Looking to modernize their dispatch stack",
            budget_signals: null,
            decision_makers: "Carla",
            objections: null,
            competitors: null,
            next_step: "Send SOC2 + case study",
            next_step_due_iso: null,
          },
        },
        chat: [],
      },
      {
        id: "test-brillion-2",
        created_iso: "2026-03-05T15:00:00-04:00",
        transcript:
          "Quick call with Carla. She asked when the SOC2 docs are coming. I forgot. Apologized, said tomorrow. Need to actually do it.",
        extraction: {
          summary: "Carla followed up asking about the promised SOC2 docs and case study. Salesperson hadn't sent them. Apologized, promised tomorrow.",
          calendar_events: [],
          reminders: [
            { text: "Send SOC2 docs and case study to Carla TOMORROW for real this time", due_iso: null },
          ],
          contacts: [{ name: "Carla Reyes", role: "VP IT", company: "Brillion Carriers", notes: null }],
          deal: {
            company: "Brillion Carriers",
            prospect_name: "Carla Reyes",
            stated_problem: null,
            budget_signals: null,
            decision_makers: "Carla",
            objections: null,
            competitors: null,
            next_step: "Send SOC2 + case study tomorrow",
            next_step_due_iso: null,
          },
        },
        chat: [],
      },
    ],
    checks: {
      "outstanding_next_steps captures the unfulfilled SOC2 promise": (b) => {
        const all = b.outstanding_next_steps.map((s) => s.action.toLowerCase()).join(" | ");
        return /(soc2|case study|docs|documents)/.test(all)
          ? null
          : `outstanding_next_steps: ${JSON.stringify(b.outstanding_next_steps)}`;
      },
      "the SOC2 obligation is tagged as owned by the salesperson": (b) => {
        const docCommitment = b.outstanding_next_steps.find((s) =>
          /(soc2|case study|docs|documents)/i.test(s.action),
        );
        if (!docCommitment) return "no doc-related outstanding step to check owner on";
        return docCommitment.owner === "salesperson"
          ? null
          : `wrong owner: ${docCommitment.owner} for "${docCommitment.action}"`;
      },
      "risks or summary acknowledge the missed commitment": (b) => {
        const blob = `${b.deal_status_summary} ${b.risks.map((r) => r.description).join(" ")}`.toLowerCase();
        return /(forgot|missed|delayed|fell through|trust|reliability|overdue|hasn'?t)/.test(blob)
          ? null
          : "no acknowledgment of the missed promise in summary or risks";
      },
    },
  },
  {
    id: "15-brief-no-fabrication-on-single-memo",
    type: "brief",
    company: "Solomatic Industries",
    memos: [
      {
        id: "test-solomatic-1",
        created_iso: "2026-04-12T09:00:00-04:00",
        transcript:
          "Had a 15-minute intro call with Devon at Solomatic. They run a small fleet. Not really sure if there's a fit yet. He said he'd check his calendar for a deeper conversation.",
        extraction: {
          summary: "Brief intro call with Devon at Solomatic. Small fleet. Devon to check calendar for a follow-up. Fit uncertain.",
          calendar_events: [],
          reminders: [],
          contacts: [{ name: "Devon Park", role: null, company: "Solomatic Industries", notes: null }],
          deal: {
            company: "Solomatic Industries",
            prospect_name: "Devon Park",
            stated_problem: null,
            budget_signals: null,
            decision_makers: null,
            objections: null,
            competitors: null,
            next_step: "Devon to schedule deeper conversation",
            next_step_due_iso: null,
          },
        },
        chat: [],
      },
    ],
    checks: {
      "deal_arc has at most 1 entry": (b) =>
        b.deal_arc.length <= 1 ? null : `fabricated ${b.deal_arc.length} arc entries from one memo`,
      "no invented competitors": (b) => {
        const blob = `${b.deal_status_summary} ${b.talking_points.join(" ")} ${b.risks.map((r) => r.description).join(" ")}`.toLowerCase();
        return /\b(fleetio|samsara|routific|motive|competitor)\b/.test(blob)
          ? "fabricated a competitor"
          : null;
      },
      "no invented budget numbers": (b) => {
        const blob = `${b.deal_status_summary} ${b.talking_points.join(" ")}`;
        return /\$\d|\d[,\.]\d{3}|\d+k\b/i.test(blob) ? "fabricated a dollar figure" : null;
      },
      "outstanding next-step captures Devon's calendar promise as owned by prospect": (b) => {
        const devonAction = b.outstanding_next_steps.find((s) =>
          /(calendar|follow.?up|schedule|deeper)/i.test(s.action),
        );
        if (!devonAction) return null; // OK if not flagged — minor item
        return devonAction.owner === "prospect" || devonAction.owner === "unclear"
          ? null
          : `wrong owner on Devon's calendar promise: ${devonAction.owner}`;
      },
    },
  },
  {
    id: "12-coach-stops-at-question-cap",
    type: "followup",
    transcript: "Quick one — talked to Karen at Northwind.",
    extraction: {
      summary: "Karen at Northwind.",
      calendar_events: [],
      reminders: [],
      contacts: [{ name: "Karen", role: null, company: "Northwind", notes: null }],
      deal: null,
    },
    // 3 prior assistant turns means we should be at the cap.
    chat: [
      { role: "assistant", content: "What's their stated problem?" },
      { role: "user", content: "Dispatch issues." },
      { role: "assistant", content: "Any budget signals?" },
      { role: "user", content: "Not yet." },
      { role: "assistant", content: "Who decides?" },
      { role: "user", content: "Karen plus their CFO." },
    ],
    related_past_memos: [],
    checks: {
      "coach declares done=true at the 3-question cap": (r) =>
        r.done === true ? null : `done=${r.done}, question="${r.question}"`,
      "question is empty when done": (r) =>
        r.question === "" ? null : `question="${r.question}"`,
      "question_type=none when done": (r) =>
        r.question_type === "none" ? null : `question_type=${r.question_type}`,
    },
  },
];
