"use client";

// Customer map: every geocoded customer is a point in an Azure Maps DataSource
// with clustering on, so zooming out groups nearby accounts into a single
// numbered bubble and zooming in (or clicking a cluster) breaks them apart.
// Individual bubbles are sized by visit count; clicking one either jumps
// straight to the memo (single visit) or lists the visits as links (several).
// The Web SDK is loaded from Azure's CDN and authenticated with an Entra token
// minted by /api/maps-token — same creds as geocoding, secret stays server-side.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import AccountMenu from "@/components/AccountMenu";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/lib/AuthContext";
import { authedFetch, apiError } from "@/lib/api";
import { loadCustomers, customerId } from "@/lib/customers";
import { loadMemos } from "@/lib/storage";
import type { Customer, Memo } from "@/lib/schema";

// --- minimal Azure Maps Web SDK facade (only what we touch; avoids `any`) -----
type Lng = number;
type Lat = number;
type Position = [Lng, Lat];
type GetToken = (
  resolve: (token: string) => void,
  reject: (err: unknown) => void,
) => void;
type AtlasLayer = object;
// A clicked feature is either an atlas.Shape (unclustered points we added, with
// getProperties/getCoordinates) or a plain GeoJSON feature (generated clusters).
interface AtlasShape {
  getProperties(): Record<string, unknown>;
  getCoordinates(): Position | Position[] | Position[][];
}
type GeoFeatureLike = {
  properties?: Record<string, unknown>;
  geometry?: { coordinates?: Position };
};
type MapMouseEvent = { shapes?: Array<AtlasShape | GeoFeatureLike> };
interface AtlasDataSource {
  add(features: unknown): void;
  clear(): void;
  getClusterExpansionZoom(clusterId: number): Promise<number>;
}
interface AtlasMap {
  events: {
    add(type: string, cb: (e?: unknown) => void): void;
    add(type: string, target: AtlasLayer, cb: (e?: unknown) => void): void;
  };
  sources: { add(s: AtlasDataSource): void };
  layers: { add(layers: AtlasLayer | AtlasLayer[]): void };
  controls: { add(c: unknown, opts?: Record<string, unknown>): void };
  setCamera(opts: Record<string, unknown>): void;
  dispose(): void;
}
interface AtlasPopup {
  setOptions(o: Record<string, unknown>): void;
  open(map: AtlasMap): void;
  close(): void;
}
interface AtlasApi {
  Map: new (container: HTMLElement, opts: Record<string, unknown>) => AtlasMap;
  Popup: new (opts?: Record<string, unknown>) => AtlasPopup;
  control: { ZoomControl: new () => unknown };
  source: {
    DataSource: new (id: string | null, opts?: Record<string, unknown>) => AtlasDataSource;
  };
  layer: {
    BubbleLayer: new (s: AtlasDataSource, id: string | null, opts: Record<string, unknown>) => AtlasLayer;
    SymbolLayer: new (s: AtlasDataSource, id: string | null, opts: Record<string, unknown>) => AtlasLayer;
  };
  data: { BoundingBox: { fromPositions(positions: Position[]): unknown } };
}

const SDK_CSS = "https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.css";
const SDK_JS = "https://atlas.microsoft.com/sdk/javascript/mapcontrol/3/atlas.min.js";

// Inject the Azure Maps CSS+JS once and resolve the global `atlas` namespace.
function loadAtlas(): Promise<AtlasApi> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { atlas?: AtlasApi };
    if (w.atlas) return resolve(w.atlas);
    if (!document.querySelector("link[data-atlas]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = SDK_CSS;
      link.setAttribute("data-atlas", "");
      document.head.appendChild(link);
    }
    const done = () =>
      w.atlas ? resolve(w.atlas) : reject(new Error("Azure Maps SDK loaded but `atlas` is missing."));
    const existing = document.querySelector("script[data-atlas]") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", done);
      existing.addEventListener("error", () => reject(new Error("Failed to load the Azure Maps SDK.")));
      return;
    }
    const s = document.createElement("script");
    s.src = SDK_JS;
    s.async = true;
    s.setAttribute("data-atlas", "");
    s.onload = done;
    s.onerror = () => reject(new Error("Failed to load the Azure Maps SDK."));
    document.head.appendChild(s);
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Label for one visit in the popup: "#42 · Mar 3, 2026" (seq is optional).
function memoLinkLabel(m: Memo): string {
  const seqPart = typeof m.seq === "number" ? `#${m.seq} · ` : "";
  return seqPart + formatDate(m.created_iso);
}

// A memo's stable route target — the detail route accepts seq or id.
function memoTarget(m: Memo): string {
  return String(m.seq ?? m.id);
}

// Cluster features arrive as plain GeoJSON; our own points as atlas.Shape.
function getProps(s: AtlasShape | GeoFeatureLike): Record<string, unknown> {
  const shape = s as AtlasShape;
  if (typeof shape.getProperties === "function") return shape.getProperties();
  return (s as GeoFeatureLike).properties ?? {};
}
function getCoords(s: AtlasShape | GeoFeatureLike): Position | undefined {
  const shape = s as AtlasShape;
  if (typeof shape.getCoordinates === "function") {
    const c = shape.getCoordinates();
    return Array.isArray(c) && typeof c[0] === "number" ? (c as Position) : undefined;
  }
  return (s as GeoFeatureLike).geometry?.coordinates;
}

type VisitLink = { to: string; label: string };

function popupHtml(props: Record<string, unknown>, links: VisitLink[]): string {
  const name = String(props.name ?? "");
  const address = String(props.address ?? "");
  const logoUrl = String(props.logoUrl ?? "");
  const count = links.length;
  const logo = logoUrl
    ? `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;` +
      `border-radius:9999px;background:#fff;border:1px solid #e5e5e5;overflow:hidden;flex:0 0 auto;">` +
      `<img src="${esc(logoUrl)}" alt="" style="width:78%;height:78%;object-fit:contain;"/></span>`
    : "";
  const rows = links
    .map(
      (l) =>
        `<a href="/memos/${esc(l.to)}" data-memo-id="${esc(l.to)}" ` +
        `style="display:block;color:#2563eb;text-decoration:none;font-size:13px;padding:1px 0;">` +
        `${esc(l.label)} →</a>`,
    )
    .join("");
  return (
    `<div style="padding:10px 12px;font:13px system-ui,sans-serif;max-width:260px;color:#111;">` +
    `<div style="display:flex;align-items:center;gap:8px;">${logo}<div style="font-weight:600;">${esc(name)}</div></div>` +
    (address ? `<div style="color:#6b7280;font-size:12px;margin-top:1px;">${esc(address)}</div>` : "") +
    `<div style="color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:6px 0 4px;">` +
    `${count} ${count === 1 ? "visit" : "visits"}</div>` +
    `<div style="display:flex;flex-direction:column;max-height:180px;overflow:auto;">${rows}</div>` +
    `</div>`
  );
}

export default function MapPage() {
  return (
    <AuthGuard>
      <MapPageContent />
    </AuthGuard>
  );
}

function MapPageContent() {
  const { org, roster } = useAuth();
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<AtlasMap | null>(null);
  const popupRef = useRef<AtlasPopup | null>(null);
  const dataSourceRef = useRef<AtlasDataSource | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [rep, setRep] = useState<string>("all");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load the data (customers for coords, memos for visits + rep links).
  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    void (async () => {
      try {
        const [cs, ms] = await Promise.all([loadCustomers(), loadMemos()]);
        if (!cancelled) {
          setCustomers(cs);
          setMemos(ms);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  // Initialize the map + clustering source/layers once (Entra token via the API).
  useEffect(() => {
    if (!org) return;
    const container = mapDivRef.current;
    if (!container) return;
    let cancelled = false;

    // Intercept clicks on the popup's visit links so navigation stays client-side.
    const onLinkClick = (ev: MouseEvent) => {
      const el = (ev.target as HTMLElement | null)?.closest?.("[data-memo-id]") as HTMLElement | null;
      if (!el) return;
      ev.preventDefault();
      const to = el.getAttribute("data-memo-id");
      if (to) routerRef.current.push(`/memos/${to}`);
    };
    container.addEventListener("click", onLinkClick);

    void (async () => {
      try {
        const r = await authedFetch("/api/maps-token");
        if (!r.ok) throw new Error(await apiError(r, "Could not get a maps token"));
        const { clientId } = (await r.json()) as { token: string; clientId: string };
        const atlas = await loadAtlas();
        if (cancelled || !mapDivRef.current) return;
        const dark = document.documentElement.classList.contains("dark");
        const map = new atlas.Map(mapDivRef.current, {
          center: [-98.5, 39.8],
          zoom: 3,
          style: dark ? "grayscale_dark" : "road",
          authOptions: {
            authType: "anonymous",
            clientId,
            getToken: ((resolve, reject) => {
              authedFetch("/api/maps-token")
                .then((res) => res.json())
                .then((d: { token: string }) => resolve(d.token))
                .catch(reject);
            }) as GetToken,
          },
        });

        map.events.add("ready", () => {
          if (cancelled) return;
          map.controls.add(new atlas.control.ZoomControl(), { position: "top-right" });

          const ds = new atlas.source.DataSource(null, {
            cluster: true,
            clusterRadius: 45,
            clusterMaxZoom: 14,
          });
          map.sources.add(ds);
          dataSourceRef.current = ds;

          const clusterBubble = new atlas.layer.BubbleLayer(ds, null, {
            radius: ["step", ["get", "point_count"], 18, 25, 24, 100, 32],
            color: ["step", ["get", "point_count"], "#60a5fa", 25, "#3b82f6", 100, "#1d4ed8"],
            strokeWidth: 2,
            strokeColor: "#ffffff",
            filter: ["has", "point_count"],
          });
          const pointBubble = new atlas.layer.BubbleLayer(ds, null, {
            radius: ["min", 22, ["+", 9, ["*", 2, ["get", "visitCount"]]]],
            color: "#2563eb",
            strokeWidth: 2,
            strokeColor: "#ffffff",
            filter: ["!", ["has", "point_count"]],
          });
          const labels = new atlas.layer.SymbolLayer(ds, null, {
            iconOptions: { image: "none" },
            textOptions: {
              textField: [
                "case",
                ["has", "point_count"],
                ["get", "point_count_abbreviated"],
                ["to-string", ["get", "visitCount"]],
              ],
              color: "#ffffff",
              font: ["StandardFont-Bold"],
              size: 12,
              offset: [0, 0.1],
              allowOverlap: true,
            },
          });
          map.layers.add([clusterBubble, pointBubble, labels]);

          // Cluster click → zoom to the level where it breaks apart.
          map.events.add("click", clusterBubble, (e) => {
            const shape = (e as MapMouseEvent).shapes?.[0];
            if (!shape) return;
            const clusterId = getProps(shape).cluster_id as number | undefined;
            const coords = getCoords(shape);
            if (clusterId == null || !coords) return;
            ds.getClusterExpansionZoom(clusterId)
              .then((zoom) => map.setCamera({ center: coords, zoom }))
              .catch(() => {});
          });

          // Point click → jump to the memo (one visit) or list them (several).
          map.events.add("click", pointBubble, (e) => {
            const shape = (e as MapMouseEvent).shapes?.[0];
            if (!shape) return;
            const props = getProps(shape);
            let links: VisitLink[] = [];
            try {
              links = JSON.parse(String(props.memosJson ?? "[]")) as VisitLink[];
            } catch {
              links = [];
            }
            if (links.length === 1) {
              routerRef.current.push(`/memos/${links[0].to}`);
              return;
            }
            const popup = popupRef.current;
            const coords = getCoords(shape);
            if (!popup || !coords) return;
            popup.setOptions({ position: coords, content: popupHtml(props, links) });
            popup.open(map);
          });

          popupRef.current = new atlas.Popup({ pixelOffset: [0, -8] });
          mapRef.current = map;
          setReady(true);
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      container.removeEventListener("click", onLinkClick);
      try {
        mapRef.current?.dispose();
      } catch {
        // best-effort teardown
      }
      mapRef.current = null;
      dataSourceRef.current = null;
      popupRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id]);

  // Memos grouped by the customer they visited (deal.company), newest first.
  const customerMemos = useMemo(() => {
    const map = new Map<string, Memo[]>();
    for (const m of memos) {
      const company = m.extraction.deal?.company;
      if (!company) continue;
      const id = customerId(company);
      const arr = map.get(id) ?? [];
      arr.push(m);
      map.set(id, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => b.created_iso.localeCompare(a.created_iso));
    return map;
  }, [memos]);

  // Which reps visited each customer, so the filter can scope to a territory.
  const customerReps = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [id, list] of customerMemos) {
      const set = new Set<string>();
      for (const m of list) if (m.authorUid) set.add(m.authorUid);
      map.set(id, set);
    }
    return map;
  }, [customerMemos]);

  // Reps that authored memos, for the filter dropdown.
  const reps = useMemo(() => {
    const names = new Map<string, string>();
    for (const m of memos) {
      if (m.authorUid) names.set(m.authorUid, roster[m.authorUid]?.displayName ?? m.authorName ?? "Teammate");
    }
    return Array.from(names.entries())
      .map(([uid, name]) => ({ uid, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [memos, roster]);

  const located = useMemo(
    () => customers.filter((c) => c.lat != null && c.lng != null),
    [customers],
  );

  const visible = useMemo(() => {
    if (rep === "all") return located;
    return located.filter((c) => customerReps.get(c.id)?.has(rep));
  }, [located, rep, customerReps]);

  // Push features into the DataSource whenever the map is ready or filter changes.
  // Clustering, bubble sizing, and labels are all driven off these properties.
  useEffect(() => {
    const ds = dataSourceRef.current;
    const map = mapRef.current;
    const atlas = (window as unknown as { atlas?: AtlasApi }).atlas;
    if (!ready || !ds || !map || !atlas) return;

    const features: unknown[] = [];
    const positions: Position[] = [];
    for (const c of visible) {
      const lng = c.lng as number;
      const lat = c.lat as number;
      // Under a rep filter, the bubble reflects just that rep's visits here.
      const visits = (customerMemos.get(c.id) ?? []).filter(
        (m) => rep === "all" || m.authorUid === rep,
      );
      const links: VisitLink[] = visits.map((m) => ({ to: memoTarget(m), label: memoLinkLabel(m) }));
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          name: c.name,
          address: c.address ?? "",
          visitCount: links.length,
          logoUrl: c.logoUrl ?? "",
          memosJson: JSON.stringify(links),
        },
      });
      positions.push([lng, lat]);
    }

    ds.clear();
    ds.add(features);
    popupRef.current?.close();

    if (positions.length === 1) {
      map.setCamera({ center: positions[0], zoom: 12 });
    } else if (positions.length > 1) {
      map.setCamera({ bounds: atlas.data.BoundingBox.fromPositions(positions), padding: 80 });
    }
  }, [ready, visible, rep, customerMemos]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
          <Link href="/" className="inline-flex items-baseline rounded hover:opacity-80" aria-label="Go to home">
            <span className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Salescribe
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Map</h1>
          <div className="flex items-center gap-3">
            <label className="text-sm text-zinc-500 dark:text-zinc-400">
              Rep{" "}
              <select
                value={rep}
                onChange={(e) => setRep(e.target.value)}
                className="ml-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100"
              >
                <option value="all">All reps</option>
                {reps.map((r) => (
                  <option key={r.uid} value={r.uid}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <Link
              href="/customers"
              className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Customers →
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {loading
            ? "Loading…"
            : `${visible.length} of ${located.length} located customer${located.length === 1 ? "" : "s"} shown` +
              (customers.length > located.length
                ? ` · ${customers.length - located.length} not yet geocoded`
                : "")}
        </div>

        <div
          ref={mapDivRef}
          className="h-[70vh] w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900"
        />

        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Zoom out to group nearby accounts; click a cluster to expand it. Click a bubble to open the
          visit — or pick from the list when there’s more than one.
        </p>
      </main>
    </div>
  );
}
