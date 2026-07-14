import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { azureMapsCredsFor } from "@/lib/ai";
import { geocodeWithAzure } from "@/lib/azure-maps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Forward-geocode a single address via Azure Maps (Microsoft Entra auth). Creds
// come from the org (Team settings) or the AZURE_MAPS_* env vars in local dev.
// One address per call so the client can show progress and skip already-located
// customers; the client throttles the batch. requireAuth (not authorize) since
// this isn't an AI call — batch geocoding shouldn't trip the token rate limiter.

export async function POST(req: NextRequest) {
  const principal = await requireAuth(req);
  if (principal instanceof Response) return principal;

  const creds = await azureMapsCredsFor(principal);
  if (creds instanceof Response) return creds;

  const body = (await req.json().catch(() => ({}))) as { address?: string };
  const address = (body.address ?? "").trim();
  if (!address) return Response.json({ error: "Missing address." }, { status: 400 });
  if (address.length > 500) return Response.json({ error: "Address too long." }, { status: 413 });

  try {
    const result = await geocodeWithAzure(creds, address);
    return Response.json({ ...result, provider: "azure" });
  } catch (e) {
    // Auth/quota/transport failure — surface it so the client stops the batch
    // instead of hammering the API.
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
