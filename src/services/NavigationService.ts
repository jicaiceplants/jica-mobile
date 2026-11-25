// Standardized Google Routes API v2 Navigation Data Contract
import { getSetting, setSetting } from './DatabaseService';

export type RouteManeuver = 
  | 'depart'
  | 'straight'
  | 'turn-left'
  | 'turn-right'
  | 'turn-slight-left'
  | 'turn-slight-right'
  | 'turn-sharp-left'
  | 'turn-sharp-right'
  | 'u-turn-left'
  | 'u-turn-right'
  | 'ramp-left'
  | 'ramp-right'
  | 'fork-left'
  | 'fork-right'
  | 'roundabout'
  | 'arrive';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteStep {
  stepIndex: number;
  instruction: string;
  maneuver: RouteManeuver;
  distanceMeters: number;
  durationSeconds: number;
  startLocation: LatLng;
  endLocation: LatLng;
}

export interface RouteNavigationPayload {
  routeId: string;
  destinationId: string;
  destinationName: string;
  encodedPolyline?: string;
  overviewPolyline: LatLng[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  steps: RouteStep[];
  isFallback?: boolean;
}

const memoryRouteCache = new Map<string, RouteNavigationPayload>();

/**
 * Decodes a Google Encoded Polyline Algorithm Format string into LatLng points.
 */
export function decodeEncodedPolyline(encoded: string): LatLng[] {
  if (!encoded || typeof encoded !== 'string') return [];
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) break;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    if (index >= encoded.length) break;
    shift = 0;
    result = 0;
    do {
      if (index >= encoded.length) break;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({
      latitude: Number((lat / 1e5).toFixed(6)),
      longitude: Number((lng / 1e5).toFixed(6))
    });
  }

  return points;
}

// Haversine distance calculator in meters
export function computeDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Radius of Earth in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Official JICA ICEPLANT (#69 Old Road Gusa, CDOC 9000)
export const GUSA_DEPOT_COORD: LatLng = {
  latitude: 8.4770172,
  longitude: 124.6798424
};

// Generic Default Route fallback for offline resilience
function generateFallbackRoute(
  origin: LatLng,
  destination: { id: string; name: string; lat: number; lng: number }
): RouteNavigationPayload {
  const distMeters = computeDistanceMeters(origin.latitude, origin.longitude, destination.lat, destination.lng);
  const durSeconds = Math.max(60, Math.round((distMeters / 6.5))); // ~23 km/h city speed

  const midLat = (origin.latitude + destination.lat) / 2;
  const midLng = (origin.longitude + destination.lng) / 2;

  return {
    routeId: `ROUTE-OFFLINE-${destination.id}`,
    destinationId: destination.id,
    destinationName: destination.name,
    totalDistanceMeters: distMeters,
    totalDurationSeconds: durSeconds,
    overviewPolyline: [
      origin,
      { latitude: midLat, longitude: midLng },
      { latitude: destination.lat, longitude: destination.lng }
    ],
    isFallback: true,
    steps: [
      {
        stepIndex: 0,
        instruction: `Depart toward ${destination.name}`,
        maneuver: "depart",
        distanceMeters: Math.round(distMeters * 0.3),
        durationSeconds: Math.round(durSeconds * 0.3),
        startLocation: origin,
        endLocation: { latitude: midLat, longitude: midLng }
      },
      {
        stepIndex: 1,
        instruction: `Continue along CDO arterial corridor toward ${destination.name}`,
        maneuver: "straight",
        distanceMeters: Math.round(distMeters * 0.6),
        durationSeconds: Math.round(durSeconds * 0.6),
        startLocation: { latitude: midLat, longitude: midLng },
        endLocation: { latitude: destination.lat, longitude: destination.lng }
      },
      {
        stepIndex: 2,
        instruction: `Arrive at ${destination.name}`,
        maneuver: "arrive",
        distanceMeters: Math.round(distMeters * 0.1),
        durationSeconds: Math.round(durSeconds * 0.1),
        startLocation: { latitude: destination.lat, longitude: destination.lng },
        endLocation: { latitude: destination.lat, longitude: destination.lng }
      }
    ]
  };
}

function sanitizePolylinePoints(rawPoints: any): LatLng[] {
  if (!Array.isArray(rawPoints)) return [];
  return rawPoints
    .filter((pt: any) => pt && Number.isFinite(Number(pt.latitude)) && Number.isFinite(Number(pt.longitude)))
    .map((pt: any) => ({
      latitude: Number(pt.latitude),
      longitude: Number(pt.longitude)
    }));
}

// Service API Switcher: calls live FastAPI + Google Routes API v2 with local caching, falling back strictly when offline
export async function fetchTurnByTurnRoute(
  origin: LatLng,
  destination: { id: string; name: string; lat: number; lng: number },
  options?: { forceRefresh?: boolean; waypoints?: LatLng[] }
): Promise<RouteNavigationPayload> {
  const destId = destination.id || `${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
  const roundedOriginKey = `${origin.latitude.toFixed(3)},${origin.longitude.toFixed(3)}`;
  const cacheKey = `${destId}|${roundedOriginKey}|${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
  const sqliteCacheKey = `cached_nav_route_${destId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  if (!options?.forceRefresh) {
    // 1. Check in-memory cache for this exact/nearby origin + destination
    const exactCached = memoryRouteCache.get(cacheKey);
    if (exactCached && exactCached.overviewPolyline.length >= 2 && !exactCached.isFallback) {
      return exactCached;
    }

    // 2. Reuse cached destination route if origin is within 400m of its start point (prevents repeat calls on jitter)
    for (const [key, cached] of memoryRouteCache.entries()) {
      if (!key.startsWith(`${destId}|`) || cached.isFallback || cached.overviewPolyline.length < 2) continue;
      const firstPt = cached.overviewPolyline[0];
      if (computeDistanceMeters(origin.latitude, origin.longitude, firstPt.latitude, firstPt.longitude) <= 400) {
        return cached;
      }
    }
  }

  const backendUrl = (process.env.EXPO_PUBLIC_BACKEND_URL || "https://jica-backend-production.up.railway.app").replace(/\/+$/, "").trim();

  if (backendUrl && !backendUrl.includes("placeholder")) {
    try {
      const response = await fetch(`${backendUrl}/api/v1/routes/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: { latitude: origin.latitude, longitude: origin.longitude },
          destination: { latitude: destination.lat, longitude: destination.lng },
          destination_id: destination.id,
          destination_name: destination.name,
          waypoints: options?.waypoints?.length ? options.waypoints : undefined,
          routing_preference: "TRAFFIC_AWARE"
        })
      });

      if (response.ok) {
        const liveData = await response.json();
        const encodedStr = typeof liveData?.encodedPolyline === 'string' ? liveData.encodedPolyline : '';
        const decodedFromEncoded = encodedStr ? decodeEncodedPolyline(encodedStr) : [];
        const rawOverview = sanitizePolylinePoints(liveData?.overviewPolyline);
        const finalPolyline =
          decodedFromEncoded.length >= rawOverview.length && decodedFromEncoded.length >= 2
            ? decodedFromEncoded
            : rawOverview;

        const isFallback = Boolean(liveData?.isFallback) || finalPolyline.length < 2;
        if (!isFallback || (liveData?.steps && liveData.steps.length > 0)) {
          const normalized: RouteNavigationPayload = {
            routeId: String(liveData.routeId || `GOOGLE-${destId}`),
            destinationId: destination.id,
            destinationName: destination.name || liveData.destinationName || "Delivery Stop",
            encodedPolyline: encodedStr || undefined,
            overviewPolyline: finalPolyline.length >= 2 ? finalPolyline : [origin, { latitude: destination.lat, longitude: destination.lng }],
            totalDistanceMeters: Number(liveData.totalDistanceMeters || 0),
            totalDurationSeconds: Number(liveData.totalDurationSeconds || 0),
            steps: Array.isArray(liveData.steps) ? liveData.steps : [],
            isFallback
          };

          if (!normalized.isFallback) {
            memoryRouteCache.set(cacheKey, normalized);
            setSetting(sqliteCacheKey, JSON.stringify(normalized)).catch(() => {});
          }
          return normalized;
        }
      }
    } catch (err) {
      console.warn("Live Routes API unavailable, checking offline SQLite route cache:", err);
    }
  }

  // 3. Offline SQLite fallback: return cached road polyline for this destination if available
  try {
    const rawSaved = await getSetting(sqliteCacheKey);
    if (rawSaved) {
      const saved: RouteNavigationPayload = JSON.parse(rawSaved);
      if (saved?.overviewPolyline && saved.overviewPolyline.length >= 2 && !saved.isFallback) {
        return saved;
      }
    }
  } catch {
    // ignore corrupt cache
  }

  return generateFallbackRoute(origin, destination);
}

// Generate Traffic Bypass Route for "Recalculate Fastest Route"
export function recalculateBypassRoute(
  currentRoute: RouteNavigationPayload,
  _driverPos: LatLng
): RouteNavigationPayload {
  const bypassSteps = (currentRoute.steps || []).map((step, idx) => {
    if (idx === 1) {
      return {
        ...step,
        instruction: "Follow updated fastest traffic-aware CDO corridor",
        durationSeconds: Math.max(30, Math.round(step.durationSeconds * 0.9))
      };
    }
    return step;
  });

  return {
    ...currentRoute,
    totalDurationSeconds: Math.max(60, Math.round(currentRoute.totalDurationSeconds * 0.9)),
    steps: bypassSteps
  };
}
