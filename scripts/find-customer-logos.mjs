// Find a logo URL for every customer and (optionally) write it to Firestore.
//
// Real wordmark-logo APIs (logo.dev, Brandfetch) all require an account/API key.
// What works without one: Clearbit's autocomplete API still resolves a company
// NAME -> website DOMAIN (its `logo` field is now null, but the domain is what we
// need), and icon.horse serves a clean brand mark for a domain. So per customer:
//   name --(clearbit autocomplete + a name-match guard)--> domain --> logo URL
// The logo is a brand MARK/favicon, not a horizontal wordmark — which fits the
// square logo slot on the customer page well.
//
// Because matching an obscure company name to the right domain is imperfect, the
// default is a DRY RUN that writes a review HTML page (rendered logos + the
// domain + a match score) and touches nothing. Eyeball it, then re-run with
// --write to store logoUrl on the customers you're happy with.
//
// Prerequisites (same as seed-customer-addresses.mjs):
//   - GOOGLE_APPLICATION_CREDENTIALS -> a service-account key JSON (admin).
//   - NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local (or the env).
//
// Usage:
//   node scripts/find-customer-logos.mjs [--org vibrationresearch.com]
//     [--write] [--overwrite] [--provider icon-horse|google|duckduckgo]
//     [--out scripts/logo-review.html] [--min-score 0.5] [--limit N]
//
//   (default)        resolve + write the review HTML, write NOTHING to Firestore
//   --write          store logoUrl on accepted customers (skips ones that already
//                    have a logoUrl unless --overwrite)
//   --overwrite      replace a logoUrl a customer already has
//   --provider       logo image source (default icon-horse)
//   --min-score      name<->domain match threshold to auto-accept (default 0.5)
//   --limit N        only process the first N customers (for a quick test)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

function fromEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim() === name) return line.slice(eq + 1).trim();
    }
  } catch {
    // no .env.local — fall through
  }
  return undefined;
}

const ORG = arg("org", "vibrationresearch.com");
const WRITE = Boolean(arg("write", false));
const OVERWRITE = Boolean(arg("overwrite", false));
const PROVIDER = String(arg("provider", "icon-horse"));
const OUT = String(arg("out", join(process.cwd(), "scripts", "logo-review.html")));
const MIN_SCORE = Number(arg("min-score", "0.5"));
const LIMIT = Number(arg("limit", "0")) || 0;

const LOGO_URL = {
  "icon-horse": (d) => `https://icon.horse/icon/${d}`,
  google: (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=128`,
  duckduckgo: (d) => `https://icons.duckduckgo.com/ip3/${d}.ico`,
};
if (!LOGO_URL[PROVIDER]) {
  console.error(`Unknown --provider "${PROVIDER}". Use: ${Object.keys(LOGO_URL).join(", ")}`);
  process.exit(1);
}

// Hand-vetted corrections: { "<customerId>": "domain.com" | "https://.../logo.png" }.
// Picked up automatically from scripts/logo-overrides.json so researched domains
// win over the noisy autocomplete guess and flow straight into --write.
const OVERRIDES_PATH = String(arg("overrides", join(process.cwd(), "scripts", "logo-overrides.json")));
let overrides = {};
try {
  const parsed = JSON.parse(readFileSync(OVERRIDES_PATH, "utf8"));
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) overrides = parsed;
} catch {
  // no overrides file — autocomplete only
}

// --- normalization: mirror src/lib/customers.ts so ids/keys line up ------------
function normalizeCompany(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,]+$/g, "")
    .replace(/\b(inc|inc\.|llc|corp|corporation|co|ltd|limited|gmbh)$/g, "")
    .trim();
}

// Alphanumeric-only squash, for slug<->domain-root comparison.
function squash(s) {
  return normalizeCompany(s).replace(/[^a-z0-9]+/g, "");
}

// Second-level label of a domain (coilcraft.com -> coilcraft, foo.co.uk -> foo).
function domainRoot(domain) {
  const parts = domain.toLowerCase().split(".");
  if (parts.length >= 3 && ["co", "com", "org", "net", "gov", "ac"].includes(parts[parts.length - 2])) {
    return parts[parts.length - 3];
  }
  return parts[0];
}

function tokens(s) {
  return new Set(normalizeCompany(s).split(" ").filter(Boolean));
}
function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// How well a candidate {name, domain} matches the customer name [0..1].
function scoreCandidate(customerName, cand) {
  const custNorm = normalizeCompany(customerName);
  const candNorm = normalizeCompany(cand.name || "");
  if (candNorm && candNorm === custNorm) return 1;

  const custSlug = squash(customerName);
  const root = domainRoot(cand.domain || "");
  let slugScore = 0;
  if (custSlug && root) {
    if (root === custSlug) slugScore = 0.95;
    else if (custSlug.length >= 4 && root.startsWith(custSlug)) slugScore = 0.8;
    else if (root.length >= 4 && custSlug.startsWith(root)) slugScore = 0.75;
    else if (custSlug.length >= 5 && root.includes(custSlug)) slugScore = 0.6;
  }
  return Math.max(jaccard(customerName, cand.name || ""), slugScore);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Clearbit autocomplete: name -> [{ name, domain, logo }]. Public, no key.
async function suggest(query) {
  const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Rank real corporate TLDs above regional/novelty ones on a tie.
function tldRank(domain) {
  const tld = domain.toLowerCase().split(".").pop();
  return ["com", "gov", "org", "edu", "net"].includes(tld) ? 2 : 1;
}

// Resolve one customer name to a best-guess { domain, matchName, score }. Clearbit
// autocomplete is noisy, so on ties we prefer a domain whose root IS the company
// and a real TLD, then fall back to Clearbit's own (relevance) ordering.
async function resolve(name) {
  let cands = await suggest(name);
  if (!cands.length) {
    // Retry with the legal suffix stripped ("Foo Inc" -> "Foo").
    const stripped = normalizeCompany(name);
    if (stripped && stripped !== name.toLowerCase().trim()) {
      await sleep(120);
      cands = await suggest(stripped);
    }
  }
  if (!cands.length) {
    // Last resort: just the first significant word ("Honeywell Aerospace" -> "Honeywell").
    const first = normalizeCompany(name).split(" ")[0];
    if (first && first.length >= 3) {
      await sleep(120);
      cands = await suggest(first);
    }
  }
  const custSlug = squash(name);
  const scored = cands
    .filter((c) => c.domain)
    .map((c, i) => ({
      domain: c.domain,
      matchName: c.name || "",
      score: scoreCandidate(name, c),
      exactRoot: domainRoot(c.domain) === custSlug ? 1 : 0,
      tld: tldRank(c.domain),
      i, // preserve Clearbit's relevance order as the final tiebreak
    }));
  if (!scored.length) return null;
  scored.sort(
    (a, b) => b.score - a.score || b.exactRoot - a.exactRoot || b.tld - a.tld || a.i - b.i,
  );
  const best = scored[0];
  return { domain: best.domain, matchName: best.matchName, score: best.score };
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- firebase-admin -----------------------------------------------------------
const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
initializeApp({
  credential: applicationDefault(),
  projectId: fromEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
});
const db = getFirestore();

const snap = await db.collection(`orgs/${ORG}/customers`).get();
let customers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
customers.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
if (LIMIT) customers = customers.slice(0, LIMIT);
console.log(
  `Org "${ORG}": ${customers.length} customer(s). Provider=${PROVIDER}, min-score=${MIN_SCORE}.` +
    `${WRITE ? "" : " (dry run — review only)"}\n`,
);

const rows = [];
let accepted = 0;
let low = 0;
let none = 0;
let skip = 0;

for (const c of customers) {
  let domain = "";
  let matchName = "";
  let score = 0;
  let status = "no-match";
  let logoUrl = "";

  const ov = overrides[c.id] ? String(overrides[c.id]).trim() : "";
  const isSkip = ["-", "none", "skip"].includes(ov.toLowerCase());
  if (isSkip) {
    // Forced no-logo: a wrong auto-match with no good replacement. Never written
    // (only "ok" rows are), so the bad guess can't slip into Firestore.
    matchName = "(skip)";
    status = "skip";
  } else if (ov) {
    // Override: a full image URL is used as-is; anything else is treated as a domain.
    if (/^https?:\/\//i.test(ov)) {
      logoUrl = ov;
    } else {
      domain = ov;
      logoUrl = LOGO_URL[PROVIDER](ov);
    }
    matchName = "(override)";
    score = 1;
    status = "ok";
  } else {
    const hit = await resolve(c.name || c.id);
    const ok = hit && hit.score >= MIN_SCORE;
    domain = hit?.domain || "";
    matchName = hit?.matchName || "";
    score = hit ? hit.score : 0;
    logoUrl = ok ? LOGO_URL[PROVIDER](hit.domain) : "";
    status = !hit ? "no-match" : ok ? "ok" : "low-score";
    await sleep(120); // be polite to the public autocomplete endpoint
  }

  if (status === "ok") accepted++;
  else if (status === "low-score") low++;
  else if (status === "skip") skip++;
  else none++;
  // A resolved domain IS the company website; offer it to backfill that field.
  const website = domain ? `https://${domain}` : "";
  rows.push({
    id: c.id,
    name: c.name || c.id,
    hadLogo: Boolean(c.logoUrl),
    hadWebsite: Boolean(c.website),
    domain,
    matchName,
    score,
    status,
    logoUrl,
    website,
  });
  const tag = isSkip ? "∅" : ov ? "◆" : status === "ok" ? "✓" : status === "low-score" ? "≈" : "✗";
  console.log(
    `  ${tag} ${(c.name || c.id).padEnd(34).slice(0, 34)} ${(domain || (logoUrl ? "(url)" : "—")).padEnd(26)} ${score ? score.toFixed(2) : ""}`,
  );
}

// --- review HTML --------------------------------------------------------------
// Unresolved/low-score first so they're easy to spot and fix by hand.
const order = { "no-match": 0, "low-score": 1, skip: 1.5, ok: 2 };
const sorted = [...rows].sort((a, b) => order[a.status] - order[b.status] || b.score - a.score);
const cell = (r) => `
  <tr class="${r.status}">
    <td class="logo">${r.logoUrl ? `<img src="${esc(r.logoUrl)}" alt="" loading="lazy" />` : ""}</td>
    <td>${esc(r.name)}${r.hadLogo ? ' <span class="badge">has logo</span>' : ""}</td>
    <td>${r.domain ? `<a href="https://${esc(r.domain)}" target="_blank" rel="noreferrer">${esc(r.domain)}</a>` : "—"}</td>
    <td class="muted">${esc(r.matchName)}</td>
    <td class="score">${r.score ? r.score.toFixed(2) : ""}</td>
    <td class="status">${r.status}</td>
  </tr>`;
const html = `<!doctype html><meta charset="utf-8"><title>Customer logo review — ${esc(ORG)}</title>
<style>
  body{font:14px system-ui,sans-serif;margin:24px;color:#111;background:#fafafa}
  h1{font-size:18px} .sum{color:#555;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e5e5e5}
  th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:middle}
  th{background:#f3f4f6;position:sticky;top:0}
  td.logo{width:56px} td.logo img{width:40px;height:40px;object-fit:contain;border:1px solid #eee;border-radius:6px;background:#fff}
  .muted{color:#888} .score{font-variant-numeric:tabular-nums} .badge{font-size:11px;color:#a16207;background:#fef9c3;border-radius:4px;padding:1px 5px}
  tr.ok{} tr.low-score{background:#fff7ed} tr.no-match{background:#fef2f2}
  td.status{font-size:12px;color:#666}
</style>
<h1>Customer logo review — ${esc(ORG)}</h1>
<div class="sum">${rows.length} customers · <b>${accepted}</b> accepted (score ≥ ${MIN_SCORE}) ·
  ${low} low-score · ${none} no match · ${skip} skipped · provider <b>${esc(PROVIDER)}</b>.
  ${WRITE ? "Written to Firestore." : "Nothing written — re-run with <code>--write</code> to store the accepted logos."}</div>
<table>
  <thead><tr><th>Logo</th><th>Customer</th><th>Domain</th><th>Matched name</th><th>Score</th><th>Status</th></tr></thead>
  <tbody>${sorted.map(cell).join("")}</tbody>
</table>`;
writeFileSync(OUT, html, "utf8");

// Companion JSON: every row, machine-readable, so the resolved domains can be
// vetted/corrected (even the high-score-but-wrong ones) before --write.
const JSON_OUT = OUT.replace(/\.html?$/i, "") + ".json";
writeFileSync(JSON_OUT, JSON.stringify({ org: ORG, provider: PROVIDER, rows }, null, 2), "utf8");

console.log(`\nReview page: ${OUT}`);
console.log(`Review data: ${JSON_OUT}`);
console.log(`Summary: ${accepted} accepted, ${low} low-score, ${none} no match, ${skip} skipped (of ${rows.length}).`);

// --- write --------------------------------------------------------------------
if (WRITE) {
  let wroteLogo = 0;
  let wroteSite = 0;
  let skipped = 0;
  for (const r of rows) {
    if (r.status !== "ok") continue;
    // Logo and website are gated independently: a customer that already has a
    // logo still gets its website backfilled (and vice-versa).
    const update = {};
    if (r.logoUrl && (!r.hadLogo || OVERWRITE)) update.logoUrl = r.logoUrl;
    if (r.website && (!r.hadWebsite || OVERWRITE)) update.website = r.website;
    if (Object.keys(update).length === 0) {
      skipped++;
      continue;
    }
    update.updated_iso = new Date().toISOString();
    await db.doc(`orgs/${ORG}/customers/${r.id}`).set(update, { merge: true });
    if (update.logoUrl) wroteLogo++;
    if (update.website) wroteSite++;
  }
  console.log(
    `Wrote ${wroteLogo} logo(s) and ${wroteSite} website(s)` +
      `${skipped ? `, ${skipped} already had both (use --overwrite to replace)` : ""}.`,
  );
} else {
  console.log("Dry run — re-run with --write once the review page looks right.");
}
