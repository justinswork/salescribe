import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { azureMapsCredsFor } from "@/lib/ai";
import { getAzureMapsToken } from "@/lib/azure-maps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mints a short-lived Azure Maps (Entra) token for the browser Web SDK. The map
// initializes with anonymous auth: authOptions.clientId = the Maps account id,
// and a getToken callback that hits this route. Same creds/flow as geocoding —
// the secret never leaves the server; only the bearer token is handed out.

export async function GET(req: NextRequest) {
  const principal = await requireAuth(req);
  if (principal instanceof Response) return principal;

  const creds = await azureMapsCredsFor(principal);
  if (creds instanceof Response) return creds;

  try {
    const token = await getAzureMapsToken(creds);
    return Response.json({ token, clientId: creds.mapsClientId });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
