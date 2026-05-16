// Eval runner. Hits the /api/extract endpoint on a running dev server (or whatever
// SALESCRIBE_URL is set to) and reports per-check pass/fail.
//
// Usage:
//   1. `npm run dev` in one terminal
//   2. `node evals/run.mjs` in another
//      or `SALESCRIBE_URL=https://your-deploy.vercel.app node evals/run.mjs`

import { cases } from "./cases.mjs";

const URL = process.env.SALESCRIBE_URL || "http://localhost:3000";

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function color(c, s) {
  return process.stdout.isTTY ? `${COLORS[c]}${s}${COLORS.reset}` : s;
}

let totalChecks = 0;
let passedChecks = 0;
const failures = [];

for (const c of cases) {
  process.stdout.write(`\n${color("bold", c.id)}\n`);

  let extraction;
  try {
    const r = await fetch(`${URL}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: c.transcript,
        chat: [],
        reference_now_iso: c.reference_now_iso,
      }),
    });
    if (!r.ok) {
      const body = await r.text();
      console.log(`  ${color("red", "REQUEST FAILED")} (${r.status}): ${body}`);
      failures.push({ case: c.id, check: "<request>", message: `${r.status}: ${body}` });
      continue;
    }
    const data = await r.json();
    extraction = data.extraction;
  } catch (e) {
    console.log(`  ${color("red", "REQUEST THREW")}: ${e.message}`);
    failures.push({ case: c.id, check: "<request>", message: e.message });
    continue;
  }

  for (const [name, fn] of Object.entries(c.checks)) {
    totalChecks++;
    let result;
    try {
      result = fn(extraction);
    } catch (e) {
      result = `threw: ${e.message}`;
    }
    if (result === null || result === undefined) {
      passedChecks++;
      console.log(`  ${color("green", "✓")} ${name}`);
    } else {
      failures.push({ case: c.id, check: name, message: result });
      console.log(`  ${color("red", "✗")} ${name} ${color("dim", "— " + result)}`);
    }
  }
}

const pct = totalChecks === 0 ? 0 : Math.round((passedChecks / totalChecks) * 100);
console.log(
  `\n${color("bold", "Summary:")} ${passedChecks}/${totalChecks} checks passed (${pct}%)`,
);

if (failures.length > 0) {
  console.log(color("yellow", `\n${failures.length} failure(s):`));
  for (const f of failures) {
    console.log(`  - [${f.case}] ${f.check}: ${f.message}`);
  }
  process.exit(1);
}
