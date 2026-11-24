import * as Location from 'expo-location';
import { queueGPS } from './DatabaseService';

export const LOCATION_TASK_NAME = 'background-location-task';

// Note: Background tasks need to be defined in the global scope (e.g., App.tsx)
// We use a robust foreground watch that simulates the 15-meter filter logic for this MVP.
let locationSubscription: Location.LocationSubscription | null = null;

export const startLocationTracking = async () => {
  try {
    const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
    if (foregroundStatus !== 'granted') {
      console.warn('Foreground location permission denied');
      return;
    }

    try {
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        console.warn('Background location permission denied');
      }
    } catch (bgErr) {
      // Android 11+ enforces strict runtime rules if ACCESS_BACKGROUND_LOCATION is requested
      console.warn('Background location permission request skipped:', bgErr);
    }

    locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 15, // Only trigger if device moves 15 meters
      },
      (location) => {
        const { latitude, longitude } = location.coords;
        console.log(`Location update (>= 15m moved): ${latitude}, ${longitude}`);
        
        // Save to SQLite
        queueGPS(latitude, longitude);
      }
    );
  } catch (error) {
    console.error('Error starting location tracking:', error);
  }
};

export const stopLocationTracking = () => {
  if (locationSubscription) {
    try {
      locationSubscription.remove();
    } catch (e) {
      console.warn('Error removing location subscription:', e);
    }
    locationSubscription = null;
  }
};
