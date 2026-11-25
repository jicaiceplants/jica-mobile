import * as Location from "expo-location";
import { queueGPS } from "./DatabaseService";

export const LOCATION_TASK_NAME = "background-location-task";

let locationSubscription: Location.LocationSubscription | null = null;
let lastQueuedCoord: { latitude: number; longitude: number; timestamp: number } | null = null;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const startLocationTracking = async () => {
  if (locationSubscription) return;

  try {
    const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
    if (foregroundStatus !== "granted") {
      console.warn("Foreground location permission denied");
      return;
    }

    try {
      await Location.requestBackgroundPermissionsAsync();
    } catch {
      // Android 11+ foreground active service continues cleanly
    }

    // Supabase Free-Tier Guard: throttle GPS writes to >= 20s and >= 25m movement; skip stationary pings
    locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 20000,
        distanceInterval: 25
      },
      (location) => {
        const { latitude, longitude, speed, heading } = location.coords;
        const now = Date.now();

        if (lastQueuedCoord) {
          const movedMeters = haversineMeters(
            lastQueuedCoord.latitude,
            lastQueuedCoord.longitude,
            latitude,
            longitude
          );
          const elapsedMs = now - lastQueuedCoord.timestamp;
          // Skip stationary noise or overly frequent updates
          if (movedMeters < 20 || elapsedMs < 15000) {
            return;
          }
        }

        lastQueuedCoord = { latitude, longitude, timestamp: now };
        const speedKmh = speed && speed > 0 ? Math.round(speed * 3.6 * 10) / 10 : 0;
        queueGPS(latitude, longitude, speedKmh, heading ?? 0);
      }
    );
  } catch (error) {
    console.error("Error starting location tracking:", error);
  }
};

export const stopLocationTracking = () => {
  if (locationSubscription) {
    try {
      locationSubscription.remove();
    } catch (e) {
      console.warn("Error removing location subscription:", e);
    }
    locationSubscription = null;
  }
  lastQueuedCoord = null;
};
