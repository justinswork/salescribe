import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getUserOrgId, isOrgAdmin, orgKeyStatus, setOrgKeys } from "@/lib/org-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manage an org's bring-your-own-key API keys. GET returns whether each key is
// set (never the values); POST (admins only) sets/replaces them. Keys live in a
// server-only Firestore path — see src/lib/org-keys.ts.

type Resolved = { uid: string; orgId: string };

async function orgUser(req: NextRequest): Promise<Resolved | Response> {
  const principal = await requireAuth(req);
  if (principal instanceof Response) return principal;
  if (principal.kind !== "user") {
    return Response.json(
      { error: "Sign in as an organization admin to manage API keys." },
      { status: 403 },
    );
  }
  const orgId = await getUserOrgId(principal.uid);
  if (!orgId) return Response.json({ error: "No organization found for this account." }, { status: 400 });
  return { uid: principal.uid, orgId };
}

export async function GET(req: NextRequest) {
  const who = await orgUser(req);
  if (who instanceof Response) return who;
  return Response.json(await orgKeyStatus(who.orgId));
}

export async function POST(req: NextRequest) {
  const who = await orgUser(req);
  if (who instanceof Response) return who;
  if (!(await isOrgAdmin(who.orgId, who.uid))) {
    return Response.json({ error: "Only an admin can set API keys." }, { status: 403 });
  }
  const body = (await req.json()) as { anthropic?: string; openai?: string };
  await setOrgKeys(who.orgId, { anthropic: body.anthropic, openai: body.openai }, who.uid);
  return Response.json(await orgKeyStatus(who.orgId));
}
