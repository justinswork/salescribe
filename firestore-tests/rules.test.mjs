// Firestore security-rules test suite. Runs against the Firestore emulator and
// exercises the org/membership/visibility rules in firestore.rules.
//
//   npm run test:rules
//
// That wraps this in `firebase emulators:exec`, which starts the emulator,
// runs this script, and shuts it down. Requires the Firebase CLI and a JDK.
// firebase-tools v15+ needs JDK 21+. On an older JDK (e.g. 11) run it through
// a compatible CLI instead:
//   npx -y firebase-tools@13 emulators:exec --only firestore "node firestore-tests/rules.test.mjs"

import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";

const PROJECT_ID = "salescribe-rules-test";
const ORG = "acme.com";

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
    host: "127.0.0.1",
    port: 8085,
  },
});

// A Firestore handle authenticated as a user with the given email claims.
function as(uid, email, emailVerified = true) {
  return testEnv
    .authenticatedContext(uid, { email, email_verified: emailVerified })
    .firestore();
}

// Seed data with rules disabled (for preconditions the rules would block).
function seed(fn) {
  return testEnv.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
}

const orgDoc = (db) => doc(db, "orgs", ORG);
const memberDoc = (db, uid) => doc(db, "orgs", ORG, "members", uid);
const memoDoc = (db, id) => doc(db, "orgs", ORG, "memos", id);
const memosCol = (db) => collection(db, "orgs", ORG, "memos");

const ORG_DATA = {
  id: ORG,
  name: "Acme",
  domain: ORG,
  personal: false,
  createdBy: "alice",
  created_iso: "2026-01-01T00:00:00Z",
};
const member = (uid, role) => ({
  uid,
  email: `${uid}@${ORG}`,
  displayName: uid,
  role,
  joined_iso: "2026-01-01T00:00:00Z",
});
const memo = (authorUid, visibility) => ({
  id: "x",
  created_iso: "2026-02-01T00:00:00Z",
  transcript: "t",
  extraction: { summary: "s", calendar_events: [], reminders: [], contacts: [], deal: null },
  chat: [],
  authorUid,
  authorName: authorUid,
  visibility,
});

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, message: e?.message || String(e) });
    console.log(`  ✗ ${name} — ${e?.message || e}`);
  }
}

// --- Membership + join rules -------------------------------------------------
console.log("\nMembership");
await testEnv.clearFirestore();

await check("unverified user cannot create the org", () =>
  assertFails(setDoc(orgDoc(as("alice", "alice@acme.com", false)), ORG_DATA)),
);
await check("verified same-domain user creates the org", () =>
  assertSucceeds(setDoc(orgDoc(as("alice", "alice@acme.com")), ORG_DATA)),
);
await check("org creator self-joins as admin", () =>
  assertSucceeds(setDoc(memberDoc(as("alice", "alice@acme.com"), "alice"), member("alice", "admin"))),
);
await check("non-creator cannot self-join as admin", () =>
  assertFails(setDoc(memberDoc(as("bob", "bob@acme.com"), "bob"), member("bob", "admin"))),
);
await check("same-domain user self-joins as member", () =>
  assertSucceeds(setDoc(memberDoc(as("bob", "bob@acme.com"), "bob"), member("bob", "member"))),
);
await check("member cannot promote themselves to admin", () =>
  assertFails(updateDoc(memberDoc(as("bob", "bob@acme.com"), "bob"), { role: "admin" })),
);
await check("member can update their own non-role fields", () =>
  assertSucceeds(updateDoc(memberDoc(as("bob", "bob@acme.com"), "bob"), { displayName: "Bobby" })),
);
await check("off-domain user cannot join the org", () =>
  assertFails(setDoc(memberDoc(as("mallory", "mallory@evil.com"), "mallory"), member("mallory", "member"))),
);

// --- Memo visibility ---------------------------------------------------------
console.log("\nMemo visibility");
await testEnv.clearFirestore();
await seed(async (db) => {
  await setDoc(orgDoc(db), ORG_DATA);
  await setDoc(memberDoc(db, "alice"), member("alice", "admin"));
  await setDoc(memberDoc(db, "bob"), member("bob", "member"));
  await setDoc(memoDoc(db, "shared1"), memo("alice", "shared"));
  await setDoc(memoDoc(db, "private1"), memo("alice", "private"));
});

await check("teammate can read a shared memo", () =>
  assertSucceeds(getDoc(memoDoc(as("bob", "bob@acme.com"), "shared1"))),
);
await check("teammate CANNOT read another's private memo", () =>
  assertFails(getDoc(memoDoc(as("bob", "bob@acme.com"), "private1"))),
);
await check("author can read their own private memo", () =>
  assertSucceeds(getDoc(memoDoc(as("alice", "alice@acme.com"), "private1"))),
);
await check("non-member cannot read a shared memo", () =>
  assertFails(getDoc(memoDoc(as("carol", "carol@other.com"), "shared1"))),
);
await check("member can create a memo authored by themselves", () =>
  assertSucceeds(setDoc(memoDoc(as("bob", "bob@acme.com"), "bobmemo"), memo("bob", "shared"))),
);
await check("member cannot forge a memo authored by someone else", () =>
  assertFails(setDoc(memoDoc(as("bob", "bob@acme.com"), "forged"), memo("alice", "shared"))),
);
await check("non-author cannot edit a memo", () =>
  assertFails(updateDoc(memoDoc(as("bob", "bob@acme.com"), "shared1"), { visibility: "private" })),
);
await check("author can change their memo's visibility", () =>
  assertSucceeds(updateDoc(memoDoc(as("alice", "alice@acme.com"), "shared1"), { visibility: "private" })),
);
await check("non-author cannot delete a memo", () =>
  assertFails(deleteDoc(memoDoc(as("bob", "bob@acme.com"), "private1"))),
);
await check("filtered shared-only query is allowed", () =>
  assertSucceeds(getDocs(query(memosCol(as("bob", "bob@acme.com")), where("visibility", "==", "shared")))),
);
await check("unfiltered query over all memos is denied", () =>
  assertFails(getDocs(memosCol(as("bob", "bob@acme.com")))),
);

// --- usage/ is server-only ---------------------------------------------------
console.log("\nUsage counters (server-only)");
await testEnv.clearFirestore();
await check("client cannot read usage counters", () =>
  assertFails(getDoc(doc(as("alice", "alice@acme.com"), "usage", "alice"))),
);
await check("client cannot write usage counters", () =>
  assertFails(setDoc(doc(as("alice", "alice@acme.com"), "usage", "alice"), { dayCount: 0 })),
);

await testEnv.cleanup();

const total = passed + failures.length;
console.log(`\nSummary: ${passed}/${total} checks passed`);
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`);
  process.exit(1);
}
