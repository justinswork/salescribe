// Roster of fictional prospects + memo plans for synthetic test data.
//
// Persona: Jordan Reeves, senior account exec at "Cargolink" — a fictional
// B2B SaaS for fleet dispatch / route optimization / driver management.
// Customers are 3PLs, trucking companies, and field-service operators.
//
// Used by scripts/generate-test-data.mjs to produce realistic voice-memo
// transcripts and corresponding extractions, written to public/demo-data.json
// for the in-app "Load demo data" button to import into Firestore.
//
// Date math note: every memo gets a calendar date stamped backward from
// "now" so the distribution feels like a year of weekly memos. Edit the
// REFERENCE_NOW constant in the generator script if you want the data
// anchored to a different point in time.

export const PERSONA = {
  name: "Jordan Reeves",
  role: "Senior Account Executive",
  vendor: "Cargolink",
  vendor_product:
    "Cargolink — a SaaS platform for fleet dispatch, route optimization, driver management, and customer portals. Sells primarily to 3PLs, trucking ops, and field-service companies. Typical deal size $30K-$150K ACV.",
  voice_notes:
    "Speaks casually and naturally — fillers like 'okay so', 'I mean', sentence restarts. Memos are dictated mid-drive or walking to the car. Often mentions competitors FleetIO, Samsara, Routific, KeepTruckin/Motive, or 'their existing spreadsheets'.",
};

// Each customer has an arc_type and a list of `beats`. A beat is one memo:
// `weeks_ago` is its date offset from "now", and `event` is a one-sentence
// summary the generator uses as a prompt anchor when writing the transcript.
export const CUSTOMERS = [
  // -------------------------------------------------------------------------
  // ONE-OFFS — single memo, prospect didn't engage further.
  // -------------------------------------------------------------------------
  {
    id: "helix-manufacturing",
    company: "Helix Manufacturing",
    industry: "Custom machined parts manufacturing",
    contacts: [{ name: "Greg Tomasek", role: "Ops Manager" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 47,
        event:
          "Cold outreach call with Greg. Talked about their inbound/outbound logistics. Said they handle dispatch through their ERP and aren't in market. Polite no.",
      },
    ],
  },
  {
    id: "brightside-couriers",
    company: "Brightside Couriers",
    industry: "Same-day local courier",
    contacts: [{ name: "Maya Acharya", role: "Operations Lead" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 44,
        event:
          "Inbound demo request. Walked Maya through dispatch + driver mobile. Liked it but said they're sticking with whiteboards for now. Tiny shop, 12 drivers.",
      },
    ],
  },
  {
    id: "tundra-transport",
    company: "Tundra Transport",
    industry: "Canadian LTL trucking",
    contacts: [{ name: "Pierre Lavoie", role: "VP of Operations" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 41,
        event:
          "Demo with Pierre and his dispatch supervisor. Engaged well. Sent pricing afterward. Pierre ghosted. Followed up twice, never heard back.",
      },
    ],
  },
  {
    id: "sage-foods-distribution",
    company: "Sage Foods Distribution",
    industry: "Specialty foods 3PL",
    contacts: [{ name: "Diane Park", role: "Director of Logistics" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 38,
        event:
          "Partner referral from Cargolink rep at Sysco. Diane interested but said they just renewed their incumbent platform — no budget for 18 months. Asked to circle back next year.",
      },
    ],
  },
  {
    id: "pacificrim-shipping",
    company: "PacificRim Shipping",
    industry: "Ocean freight forwarder",
    contacts: [{ name: "Hideo Watanabe", role: "VP Operations" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 34,
        event:
          "Intro call set up by their CIO. Hideo joined but seemed distracted, said the CIO is the actual buyer. Followed up to schedule with CIO, no response.",
      },
    ],
  },
  {
    id: "redrock-mining-logistics",
    company: "RedRock Mining Logistics",
    industry: "Mining equipment hauling",
    contacts: [{ name: "Sam Cortez", role: "Fleet Manager" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 30,
        event:
          "Discovery call with Sam. They run 40+ heavy-haul trucks on private mining sites. Said our product doesn't handle off-highway routing well enough. Not a fit. Closed cleanly.",
      },
    ],
  },
  {
    id: "coastal-freight-services",
    company: "Coastal Freight Services",
    industry: "Regional carrier (East Coast)",
    contacts: [{ name: "Lena Brooks", role: "Director of Operations" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 26,
        event:
          "RFP response. Made the shortlist of 3. Lost to FleetIO on feature gap around their broker portal integration. Lena was professional about it.",
      },
    ],
  },
  {
    id: "iron-bridge-logistics",
    company: "Iron Bridge Logistics",
    industry: "Heavy haul / oversized loads",
    contacts: [{ name: "Doug McNair", role: "Owner / President" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 22,
        event:
          "Cold call to Doug — turned out they signed with Samsara 6 months ago. 3-year contract. Asked to circle back end of 2027.",
      },
    ],
  },
  {
    id: "sweetwater-brewing",
    company: "Sweetwater Brewing",
    industry: "Craft brewery distribution",
    contacts: [{ name: "Roberta Klein", role: "Distribution Manager" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 18,
        event:
          "Inbound from their website. Roberta wanted same-day-delivery automation features we don't have on the roadmap. Lost on capability gap, told her honestly.",
      },
    ],
  },
  {
    id: "vanguard-last-mile",
    company: "Vanguard Last-Mile",
    industry: "Last-mile delivery startup",
    contacts: [{ name: "Theo Marsh", role: "Co-founder / COO" }],
    arc_type: "one-off",
    beats: [
      {
        weeks_ago: 13,
        event:
          "Intro call with Theo. They have 6 drivers, planning to scale to 30 next year. Loved the product. Said our entry-tier pricing is too expensive for where they are. Asked about a startup discount; flagged for review.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // MID-TOUCH — 2-5 memos, arcs play out partially.
  // -------------------------------------------------------------------------
  {
    id: "bay-state-freight",
    company: "Bay State Freight",
    industry: "Regional LTL / Northeast",
    contacts: [
      { name: "Rachel Donovan", role: "VP Operations" },
      { name: "Tony Marsicano", role: "Dispatch Manager" },
    ],
    arc_type: "closed-won-fast",
    beats: [
      {
        weeks_ago: 45,
        event:
          "Discovery call with Rachel. Pain: their dispatch platform from 2014 is unsupported, vendor went out of business. Urgent need to migrate before Q4.",
      },
      {
        weeks_ago: 43,
        event:
          "Demo with Rachel and Tony. Tony asked sharp dispatch-workflow questions. Both liked it. Asked for pricing same week.",
      },
      {
        weeks_ago: 42,
        event:
          "Sent pricing. Rachel called back: 'How fast can you onboard us?' Closed at $54K ACV, 2-year contract. Implementation kickoff next month.",
      },
    ],
  },
  {
    id: "pacific-northwest-distribution",
    company: "Pacific Northwest Distribution",
    industry: "Cold chain food distribution",
    contacts: [
      { name: "Erin Liu", role: "Director of Logistics" },
      { name: "Carlos Mendoza", role: "IT Director" },
    ],
    arc_type: "closed-won-medium",
    beats: [
      {
        weeks_ago: 39,
        event:
          "Discovery with Erin. They run 80 reefer trucks. Driver retention is the pain — they want a driver-facing app. Mentioned Samsara as benchmark.",
      },
      {
        weeks_ago: 37,
        event:
          "Demo with Erin + her dispatch supervisor. Demo went well; the driver-app side was the standout.",
      },
      {
        weeks_ago: 33,
        event:
          "Looped in Carlos from IT for security/integration review. Sent SOC2 doc. Carlos asked about API rate limits.",
      },
      {
        weeks_ago: 30,
        event:
          "Procurement signoff. Closed at $78K ACV. Implementation starting end of month.",
      },
    ],
  },
  {
    id: "granite-transit",
    company: "Granite Transit",
    industry: "Regional carrier (Midwest)",
    contacts: [{ name: "Brad Kowalski", role: "VP Operations" }],
    arc_type: "closed-lost-competitor",
    beats: [
      {
        weeks_ago: 36,
        event:
          "Cold outreach. Brad agreed to a 30-min call. They run 120 trucks. Open to switching from spreadsheets. Strong fit on paper.",
      },
      {
        weeks_ago: 33,
        event:
          "Demo with Brad and his ops team. Went well. Brad said they're evaluating us, FleetIO, and Samsara.",
      },
      {
        weeks_ago: 28,
        event:
          "Brad emailed: chose FleetIO. Said the difference was FleetIO's existing integration with their TMS. Polite, said to stay in touch.",
      },
    ],
  },
  {
    id: "skyway-logistics",
    company: "Skyway Logistics",
    industry: "Air-freight ground handling",
    contacts: [{ name: "Anita Reyes", role: "Operations Director" }],
    arc_type: "closed-lost-status-quo",
    beats: [
      {
        weeks_ago: 32,
        event:
          "Intro call with Anita. Pain: handoff between airline ops and trucking is manual. Interested.",
      },
      {
        weeks_ago: 29,
        event:
          "Demo. Anita liked it but said she'd need to convince her CFO. We sent ROI doc.",
      },
      {
        weeks_ago: 22,
        event:
          "Anita reported the CFO said no — too disruptive mid-year. Decided to stay with current process. Maybe revisit in 2027.",
      },
    ],
  },
  {
    id: "evergreenops",
    company: "EvergreenOps",
    industry: "Green / EV last-mile delivery",
    contacts: [{ name: "Drew Hawthorne", role: "Co-founder / COO" }],
    arc_type: "stalled",
    beats: [
      {
        weeks_ago: 28,
        event:
          "Inbound demo request. Drew loved the product. We're a great fit for EV route planning.",
      },
      {
        weeks_ago: 25,
        event:
          "Second call with Drew + his head of ops. Talked through pilot terms.",
      },
      {
        weeks_ago: 20,
        event:
          "Sent pilot proposal. Drew said they'd come back with feedback within 2 weeks.",
      },
      {
        weeks_ago: 14,
        event:
          "Followed up. Drew said they're in the middle of a Series B raise and can't make purchasing decisions until it closes. Asked to circle back in 6-8 weeks.",
      },
      {
        weeks_ago: 6,
        event:
          "Checked in again. Drew said Series B took longer than expected, still no decision authority. Stalled. Frustrating because they're a great fit.",
      },
    ],
  },
  {
    id: "atlas-field-services",
    company: "Atlas Field Services",
    industry: "HVAC / commercial field service",
    contacts: [
      { name: "Mira Castillo", role: "VP Operations" },
      { name: "Devon Tran", role: "Service Manager" },
    ],
    arc_type: "closed-won-medium",
    beats: [
      {
        weeks_ago: 24,
        event:
          "Discovery with Mira. They have 60 technicians doing commercial HVAC. Pain: routing chaos, technicians spending too much time driving between jobs.",
      },
      {
        weeks_ago: 22,
        event:
          "Demo with Mira + Devon. Devon especially excited about the dynamic re-routing feature. Concrete ROI ask: cut driving time 15%.",
      },
      {
        weeks_ago: 19,
        event:
          "Closed at $42K ACV. Devon will lead implementation. Kickoff in 2 weeks.",
      },
    ],
  },
  {
    id: "meridian-trucking",
    company: "Meridian Trucking",
    industry: "Long-haul trucking",
    contacts: [{ name: "Hank Vermeer", role: "Owner / Dispatch Manager" }],
    arc_type: "stalled",
    beats: [
      {
        weeks_ago: 21,
        event:
          "Cold call to Hank. Family-owned, 35 trucks, runs his own dispatch. Sharp guy. Said he's been burned by SaaS before. Cautious.",
      },
      {
        weeks_ago: 18,
        event:
          "Demo for Hank. Lukewarm. He kept asking 'what happens if you go out of business.' Sent escrow-source clause docs.",
      },
      {
        weeks_ago: 12,
        event:
          "Followed up. Hank said he's busy with peak season, will revisit Q1 next year. Marked stalled, not lost — could re-engage.",
      },
    ],
  },
  {
    id: "crescent-last-mile",
    company: "Crescent Last-Mile",
    industry: "Last-mile e-commerce delivery",
    contacts: [
      { name: "Jasmine Okafor", role: "Director of Operations" },
      { name: "Ravi Mehta", role: "Head of Engineering" },
    ],
    arc_type: "closed-lost-competitor",
    beats: [
      {
        weeks_ago: 23,
        event:
          "Discovery with Jasmine. They run 200+ daily drivers across 5 metros. Major potential deal.",
      },
      {
        weeks_ago: 21,
        event:
          "Demo with Jasmine + Ravi. Ravi grilled on API and webhooks. Engineering-driven evaluation. They're also looking at Routific.",
      },
      {
        weeks_ago: 16,
        event:
          "Sent technical comparison doc. Ravi liked our API but said Routific has better route-density algorithms for last-mile.",
      },
      {
        weeks_ago: 12,
        event:
          "Jasmine emailed: chose Routific. Said our dispatch tooling was better but for their use case the routing core mattered more. Stung — big deal lost on a feature gap.",
      },
    ],
  },
  {
    id: "twin-cities-distribution",
    company: "Twin Cities Distribution",
    industry: "Regional 3PL (Minneapolis)",
    contacts: [
      { name: "Liz Bergquist", role: "VP Operations" },
      { name: "Calvin Owusu", role: "IT Director" },
    ],
    arc_type: "closed-won-expanding",
    beats: [
      {
        weeks_ago: 36,
        event:
          "Discovery with Liz. Mid-size 3PL, 90 trucks. Pain: scaling problems with their homegrown dispatch system.",
      },
      {
        weeks_ago: 33,
        event:
          "Demo for Liz + her dispatch lead. Strong reception.",
      },
      {
        weeks_ago: 30,
        event:
          "Brought in Calvin for security review. Easy pass.",
      },
      {
        weeks_ago: 27,
        event:
          "Closed at $66K ACV. Smooth process.",
      },
      {
        weeks_ago: 8,
        event:
          "Quarterly check-in with Liz. Implementation going great. She mentioned their sister company Bluebird Carrier Services (separate roster entry) might be interested.",
      },
    ],
  },
  {
    id: "bluebird-carrier-services",
    company: "Bluebird Carrier Services",
    industry: "Regional carrier (Upper Midwest)",
    contacts: [{ name: "Trent Halvorsen", role: "Operations Manager" }],
    arc_type: "stalled-after-referral",
    beats: [
      {
        weeks_ago: 7,
        event:
          "Warm intro from Liz at Twin Cities Distribution. Initial call with Trent — interested, said he'd loop in his VP.",
      },
      {
        weeks_ago: 5,
        event:
          "Demo got pushed twice; finally happened. Went OK. Trent quieter than expected. Asked for pricing.",
      },
      {
        weeks_ago: 2,
        event:
          "Sent pricing. No response in a week. Sent gentle follow-up. Crickets. Marking stalled.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // MAJOR ACCOUNTS — 8-12 memos, long arcs, multiple stakeholders.
  // -------------------------------------------------------------------------
  {
    id: "northwind-logistics",
    company: "Northwind Logistics",
    industry: "Regional 3PL / dispatch-heavy",
    contacts: [
      { name: "Karen Holloway", role: "VP Operations", primary: true },
      { name: "Marcus Brennan", role: "CFO" },
      { name: "Yusuf Adebayo", role: "Dispatch Lead" },
    ],
    arc_type: "closed-won-major-expansion",
    beats: [
      {
        weeks_ago: 40,
        event:
          "Initial discovery with Karen. Pain: 14 different Excel files drivers are emailing every morning. Mentioned budget range $30-40K for year one. Competitor FleetIO is also being evaluated.",
      },
      {
        weeks_ago: 38,
        event:
          "Demo for Karen + Yusuf. Demo went well; Yusuf had sharp dispatch-flow questions. Karen wants to involve CFO Marcus.",
      },
      {
        weeks_ago: 35,
        event:
          "Three-way call with Karen, Marcus (CFO), and Yusuf. Marcus pushed on price hard. Asked for a comparison doc vs FleetIO and Samsara.",
      },
      {
        weeks_ago: 32,
        event:
          "Sent comparison doc. Karen called: 'we're leaning toward you' but Marcus still doing diligence on TCO over 3 years.",
      },
      {
        weeks_ago: 29,
        event:
          "Procurement asked for SOC2 + insurance docs. Sent. Marcus also wants to talk to a reference customer.",
      },
      {
        weeks_ago: 26,
        event:
          "Reference call with our customer Bay State Freight went well. Karen said they're going into internal review.",
      },
      {
        weeks_ago: 22,
        event:
          "Karen wants to move forward. Marcus pushing for multi-year discount. Discussed 3-year terms.",
      },
      {
        weeks_ago: 18,
        event:
          "Multi-year discussion stalled. Marcus wants a 1-year pilot to de-risk. Karen disappointed but understanding.",
      },
      {
        weeks_ago: 14,
        event:
          "Compromise reached: 18-month pilot at a 10% discount. Karen pushing internally for sign-off.",
      },
      {
        weeks_ago: 10,
        event:
          "Legal reviewing contract. Should close by month-end. Karen mentioned Yusuf will own implementation.",
      },
      {
        weeks_ago: 7,
        event:
          "Closed-won! Signed 18-month pilot at $38K. Implementation kickoff scheduled.",
      },
      {
        weeks_ago: 2,
        event:
          "Implementation check-in. Going smoothly. Karen mentioned expansion to their sister company Northwind Freight (separate legal entity, 70 more trucks). Wants to introduce me to their COO.",
      },
    ],
  },
  {
    id: "continental-freight",
    company: "Continental Freight",
    industry: "National LTL carrier",
    contacts: [
      { name: "Patrick O'Sullivan", role: "Chief Operating Officer", primary: true },
      { name: "Mei-Lin Zhao", role: "VP IT" },
      { name: "Brent Garrison", role: "VP Operations" },
      { name: "Aaliyah Reeves", role: "Director of Dispatch" },
    ],
    arc_type: "closed-won-major-enterprise",
    beats: [
      {
        weeks_ago: 50,
        event:
          "Cold outreach got through to Patrick (COO). 30-min intro call. They run 600+ trucks across 11 terminals. Massive potential. Patrick said: 'we change vendors slowly but we change.'",
      },
      {
        weeks_ago: 47,
        event:
          "Discovery with Patrick + Aaliyah. Pain: their TMS is from 2009, dispatch is bolted-on Excel macros. Aaliyah is the operational champion.",
      },
      {
        weeks_ago: 44,
        event:
          "Demo for Aaliyah's team — 8 dispatch supervisors on the call. Mixed reception. Some loved it, two old-timers were skeptical.",
      },
      {
        weeks_ago: 40,
        event:
          "Mei-Lin (IT) joined for technical eval. She asked about on-prem deploy option — we don't have one. Tense moment. Worked through hybrid options.",
      },
      {
        weeks_ago: 37,
        event:
          "Sent reference customer list. Patrick wants to visit one in person. Set up site visit to our customer Pacific Northwest Distribution.",
      },
      {
        weeks_ago: 32,
        event:
          "Site visit happened. Patrick was impressed. Came back saying 'okay, we're going to do this — figuring out how.' Procurement starting.",
      },
      {
        weeks_ago: 27,
        event:
          "Security review with Mei-Lin's team. SOC2 + penetration test docs. Several follow-up questions about data residency.",
      },
      {
        weeks_ago: 22,
        event:
          "Pricing call with Patrick + CFO. Asked for 3-year terms with terminal-by-terminal rollout. Big deal: $420K ACV at full deployment.",
      },
      {
        weeks_ago: 17,
        event:
          "Closed the contract! 3-year deal, phased rollout starting with 3 terminals.",
      },
      {
        weeks_ago: 11,
        event:
          "First 3 terminals live. Going well. Brent (VP Ops) flagged some training issues with old-timer dispatch supervisors. Sending in extra training support.",
      },
      {
        weeks_ago: 5,
        event:
          "Quarterly review with Patrick. Phase 1 going smoothly. Discussing accelerated rollout for terminals 4-7. Possible expansion add-on for fuel-management module.",
      },
    ],
  },
  {
    id: "atlas-hauling-group",
    company: "Atlas Hauling Group",
    industry: "Bulk hauling / aggregates",
    contacts: [
      { name: "Frank DeRosa", role: "President", primary: true },
      { name: "Karen Sondheim", role: "VP Operations" },
      { name: "Manuel Ortiz", role: "Dispatch Director" },
    ],
    arc_type: "closed-lost-major-late",
    beats: [
      {
        weeks_ago: 42,
        event:
          "Intro call with Karen Sondheim (VP Ops). Family-owned but big — 180 trucks hauling aggregates. Pain: dispatch supervisors leaving, knowledge walking out the door.",
      },
      {
        weeks_ago: 39,
        event:
          "Demo with Karen + Manuel. Manuel is the long-tenured dispatch director; he was the skeptic. Lots of 'we already do that with our system' pushback.",
      },
      {
        weeks_ago: 35,
        event:
          "Second demo with President Frank DeRosa. Frank is the actual decision-maker. Liked the dashboard view. Said he'd 'think about it.'",
      },
      {
        weeks_ago: 31,
        event:
          "Karen pushed for a pilot. Frank reluctantly agreed to a small evaluation period — just one terminal.",
      },
      {
        weeks_ago: 28,
        event:
          "Sent pilot proposal. Manuel pushed back on terms; wanted longer pilot, lower commitment.",
      },
      {
        weeks_ago: 24,
        event:
          "Revised proposal accepted. 60-day pilot at one terminal starting next month.",
      },
      {
        weeks_ago: 20,
        event:
          "Pilot kicked off. Some friction with Manuel's team but Karen's enthusiasm carrying it.",
      },
      {
        weeks_ago: 14,
        event:
          "Pilot mid-point review. Numbers looking good. Karen pleased. Manuel grudgingly admitting some benefits.",
      },
      {
        weeks_ago: 9,
        event:
          "Pilot ended. Strong results. Pricing call for full deployment scheduled with Frank.",
      },
      {
        weeks_ago: 4,
        event:
          "Frank's call: surprised everyone by going with FleetIO. Turns out FleetIO's CEO knows Frank from a trade association and gave him a custom deal. Karen was visibly upset. Hard loss.",
      },
    ],
  },
  {
    id: "summit-distribution",
    company: "Summit Distribution",
    industry: "Building materials distribution",
    contacts: [
      { name: "Eleanor Ng", role: "Chief Operating Officer", primary: true },
      { name: "Dale Reichmann", role: "Director of IT" },
      { name: "Hassan Iqbal", role: "Dispatch Manager" },
    ],
    arc_type: "stalled-major-procurement",
    beats: [
      {
        weeks_ago: 38,
        event:
          "Inbound from their website. Eleanor (COO) wants to modernize. 110 trucks, regional building materials supplier.",
      },
      {
        weeks_ago: 35,
        event:
          "Discovery with Eleanor + Hassan. Eleanor is sharp and decisive. Hassan is operational champion. Strong fit.",
      },
      {
        weeks_ago: 31,
        event:
          "Demo for Eleanor + Hassan + 3 dispatch supervisors. Universally well received.",
      },
      {
        weeks_ago: 27,
        event:
          "Dale (IT director) joined for technical eval. Asked detailed questions about SSO and AD integration.",
      },
      {
        weeks_ago: 22,
        event:
          "Eleanor confirmed they want to move forward. Procurement starting. Estimated $90K ACV.",
      },
      {
        weeks_ago: 17,
        event:
          "Procurement asked for a custom MSA — they have specific terms they always insist on. Sent to our legal team.",
      },
      {
        weeks_ago: 12,
        event:
          "Legal back-and-forth on MSA. Several rounds. Eleanor still engaged but getting impatient with the pace.",
      },
      {
        weeks_ago: 8,
        event:
          "Legal still going. Eleanor said internal priorities shifted — they have a new ERP rollout that's consuming her bandwidth.",
      },
      {
        weeks_ago: 3,
        event:
          "Followed up. Eleanor said she'll get back to us in a few weeks once the ERP project stabilizes. Stalled but not dead.",
      },
    ],
  },
];

// Sanity-check: number of memos per arc_type bucket.
export function rosterStats() {
  const buckets = {};
  let total = 0;
  for (const c of CUSTOMERS) {
    buckets[c.arc_type] = (buckets[c.arc_type] ?? 0) + c.beats.length;
    total += c.beats.length;
  }
  return { total, buckets, customers: CUSTOMERS.length };
}
