import "server-only";

// Azure Maps via Microsoft Entra (OAuth client-credentials), mirroring the
// team's existing Perl retriever: POST tenant+client+secret to Entra for a
// bearer token, then call Azure Maps with that token plus the Maps account's
// client id in the x-ms-client-id header. Tokens are cached per app client id
// (~1h lifetime) so a batch of geocodes reuses one token on a warm instance.

// Fully-resolved credentials (all four present) — distinct from the partial
// AzureMapsCreds that may be mid-entry in the keys store.
export type AzureMapsConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mapsClientId: string;
};

export type GeocodeResult =
  | { status: "ok"; lat: number; lng: number; formattedAddress: string | null }
  | { status: "none" };

type TokenEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenEntry>();

async function getToken(creds: AzureMapsConfig): Promise<string> {
  const cacheKey = `${creds.tenantId}:${creds.clientId}`;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  // Refresh a minute early so we never hand out an about-to-expire token.
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const body = new URLSearchParams({
    client_id: creds.clientId,
    scope: "https://atlas.microsoft.com/.default",
    client_secret: creds.clientSecret,
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `Entra token request failed (HTTP ${res.status}).`,
    );
  }
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

// Mint (or reuse the cached) Entra token for the browser Azure Maps Web SDK.
// The SDK's anonymous-auth getToken callback resolves with this string and
// re-requests when it needs a fresh one; our cache serves a still-valid token.
export async function getAzureMapsToken(creds: AzureMapsConfig): Promise<string> {
  return getToken(creds);
}

type AzureGeocode = {
  features?: Array<{
    geometry?: { coordinates?: [number, number] }; // [longitude, latitude]
    properties?: { address?: { formattedAddress?: string } };
  }>;
  error?: { message?: string };
};

// Forward-geocode one address. Throws on auth/quota/transport errors (the route
// turns that into a 502 so the client can stop the batch).
export async function geocodeWithAzure(
  creds: AzureMapsConfig,
  address: string,
): Promise<GeocodeResult> {
  const token = await getToken(creds);
  const url =
    "https://atlas.microsoft.com/geocode?api-version=2023-06-01&top=1" +
    `&query=${encodeURIComponent(address)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "x-ms-client-id": creds.mapsClientId },
  });
  const data = (await res.json().catch(() => ({}))) as AzureGeocode;
  if (!res.ok) {
    throw new Error(data.error?.message || `Azure Maps geocode failed (HTTP ${res.status}).`);
  }
  const coords = data.features?.[0]?.geometry?.coordinates;
  if (coords && coords.length === 2) {
    return {
      status: "ok",
      lat: coords[1],
      lng: coords[0],
      formattedAddress: data.features?.[0]?.properties?.address?.formattedAddress ?? null,
    };
  }
  return { status: "none" };
}
