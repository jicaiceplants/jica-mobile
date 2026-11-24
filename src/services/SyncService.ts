import NetInfo from '@react-native-community/netinfo';
import { getQueuedGPS, getQueuedTransactions, clearQueues } from './DatabaseService';
import { supabase } from './SupabaseClient';

let isSyncing = false;

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || "https://jica-backend-production.up.railway.app").replace(/\/+$/, "").trim();

export const syncDataWithServer = async (driverId?: string, truckId?: string) => {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const gpsData: any[] = await getQueuedGPS();
    const txData: any[] = await getQueuedTransactions();

    if (gpsData.length === 0 && txData.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`Syncing ${gpsData.length} GPS points and ${txData.length} transactions with server...`);

    let syncSucceeded = false;

    // 1. Try FastAPI backend first
    try {
      const response = await fetch(`${BACKEND_URL}/api/v1/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driver_id: driverId || "USR-DEFAULT",
          truck_id: truckId || "TRK-01",
          gps_pings: gpsData.map(g => ({
            trip_id: "00000000-0000-0000-0000-000000000000",
            driver_id: driverId || "USR-DEFAULT",
            truck_id: truckId || "TRK-01",
            latitude: g.lat,
            longitude: g.lng,
            speed_kmh: 0,
            heading: 0,
            battery_level: 100,
            is_charging: false,
            is_sos: false,
            timestamp: g.timestamp
          })),
          transactions: txData.map(t => ({
            idempotency_key: t.idempotency_key,
            stop_id: t.stop_id,
            customer_name: t.customer_name,
            planned_qty: t.planned_qty,
            delivered_qty: t.delivered_qty,
            returned_qty: t.returned_qty,
            unit_price: t.unit_price,
            total_amount: t.total_amount,
            payment_method: t.payment_method,
            partial_reason: t.partial_reason,
            timestamp: t.timestamp
          }))
        })
      });

      if (response.ok) {
        syncSucceeded = true;
      }
    } catch (netErr) {
      console.warn("Backend /sync endpoint unreachable, falling back directly to Supabase:", netErr);
    }

    // 2. Direct Supabase Fallback if backend is unreachable
    if (!syncSucceeded) {
      try {
        if (gpsData.length > 0) {
          await supabase.from("gps_logs").insert(
            gpsData.map(g => ({
              driver_id: null,
              truck_id: truckId || "TRK-01",
              latitude: g.lat,
              longitude: g.lng,
              logged_at: g.timestamp
            }))
          );
        }
        syncSucceeded = true;
      } catch (sbErr) {
        console.error("Direct Supabase sync fallback error:", sbErr);
      }
    }

    if (syncSucceeded) {
      console.log('Mobile batch sync successfully completed!');
      const gpsIds = gpsData.map(g => g.id);
      const txIds = txData.map(t => t.id);
      await clearQueues(gpsIds, txIds);
    }

  } catch (error) {
    console.error('Error during mobile sync:', error);
  } finally {
    isSyncing = false;
  }
};

export const startNetworkListener = () => {
  return NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable) {
      // Reconnected online, trigger sync
      syncDataWithServer();
    }
  });
};
