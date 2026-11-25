import NetInfo from "@react-native-community/netinfo";
import {
  getQueuedGPS,
  clearSyncedGPS,
  getQueuedTransactions,
  markTransactionsSynced,
  getQueuedSOS,
  clearSyncedSOS,
  getQueuedFinishShifts,
  clearQueuedFinishShift,
  getSetting
} from "./DatabaseService";
import { BACKEND_URL, getSessionHeaders, notifySessionRevoked, SESSION_REVOKED_MESSAGE } from "./SessionService";

let isSyncing = false;

export const syncDataWithServer = async (
  activeLoadSlipId?: string
): Promise<{
  syncedTransactions: number;
  syncedGps: number;
  syncedSos: number;
  syncedFinishes: number;
  skipped?: boolean;
}> => {
  if (isSyncing) {
    return { syncedTransactions: 0, syncedGps: 0, syncedSos: 0, syncedFinishes: 0, skipped: true };
  }

  isSyncing = true;
  let syncedTransactions = 0;
  let syncedGps = 0;
  let syncedSos = 0;
  let syncedFinishes = 0;

  try {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      return { syncedTransactions: 0, syncedGps: 0, syncedSos: 0, syncedFinishes: 0 };
    }

    const headers = await getSessionHeaders();
    const rawDriver = await getSetting("driver_session");
    const parsedSession = rawDriver ? JSON.parse(rawDriver) : null;
    const driver = parsedSession?.driver || parsedSession;
    const driverId = driver?.id || undefined;
    const truckId = driver?.truckId || driver?.assigned_truck_id || undefined;
    const driverName = driver?.name || driver?.full_name || "Driver";

    // 1. Flush pending SOS alerts immediately with deduplicated idempotency keys
    const sosList = await getQueuedSOS();
    if (sosList.length > 0) {
      const confirmedSosKeys: string[] = [];
      for (const sos of sosList) {
        try {
          const res = await fetch(`${BACKEND_URL}/api/v1/telemetry/sos`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              driver_id: sos.driver_id || driverId || "driver",
              driver_name: sos.driver_name || driverName,
              truck_id: sos.truck_id || truckId || "",
              load_slip_id: sos.load_slip_id || activeLoadSlipId || null,
              latitude: Number(sos.latitude),
              longitude: Number(sos.longitude),
              reason: sos.reason,
              idempotency_key: sos.idempotency_key
            })
          });
          if (res.ok) {
            confirmedSosKeys.push(sos.idempotency_key);
          }
        } catch {
          // Keep in SQLite for next retry
        }
      }
      if (confirmedSosKeys.length > 0) {
        await clearSyncedSOS(confirmedSosKeys);
        syncedSos = confirmedSosKeys.length;
      }
    }

    // 2. Flush queued deliveries (scheduled stops + adhoc extra drops) and GPS breadcrumb pings
    const [txs, gps] = await Promise.all([getQueuedTransactions(), getQueuedGPS()]);

    if (txs.length > 0 || gps.length > 0) {
      const resolvedSlipId = activeLoadSlipId || txs.find(t => t.load_slip_id)?.load_slip_id || undefined;
      const payload = {
        driver_id: driverId,
        truck_id: truckId,
        load_slip_id: resolvedSlipId,
        transactions: txs.map(t => ({
          idempotency_key: t.idempotency_key,
          stop_id: t.stop_id,
          load_slip_id: t.load_slip_id || resolvedSlipId,
          hub_id: t.hub_id || undefined,
          hub_name: t.hub_name || undefined,
          customer_name: t.customer_name,
          product_id: t.product_id || undefined,
          product_name: t.product_name || "Ice Product",
          sack_size: t.sack_size || "Standard Sack",
          planned_qty: Number(t.planned_qty || 0),
          delivered_qty: Number(t.delivered_qty || 0),
          returned_qty: Number(t.returned_qty || 0),
          unit_price: Number(t.unit_price || 0),
          total_amount: Number(t.total_amount || 0),
          payment_method: t.payment_method || "Cash",
          partial_reason: t.partial_reason || undefined,
          is_adhoc: Boolean(t.is_adhoc),
          timestamp: t.timestamp
        })),
        gps_pings: gps.map(g => ({
          trip_id: resolvedSlipId || truckId || "TRIP",
          driver_id: driverId,
          truck_id: truckId,
          latitude: Number(g.latitude),
          longitude: Number(g.longitude),
          speed_kmh: Number(g.speed_kmh || 0),
          heading: Number(g.heading || 0),
          is_sos: false,
          idempotency_key: g.idempotency_key || `GPS-${g.id}-${g.logged_at}`
        }))
      };

      const res = await fetch(`${BACKEND_URL}/api/v1/sync`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      if (res.status === 401) {
        const errJson = await res.json().catch(() => ({}));
        if (String(errJson?.detail || "").includes("SESSION_REVOKED")) {
          notifySessionRevoked(SESSION_REVOKED_MESSAGE);
        }
      } else if (res.ok) {
        const json = await res.json().catch(() => ({}));
        const syncedKeys: string[] = Array.isArray(json.synced_transactions)
          ? json.synced_transactions
          : txs.map(t => t.idempotency_key);
        if (syncedKeys.length > 0) {
          await markTransactionsSynced(syncedKeys);
          syncedTransactions = syncedKeys.length;
        }
        if (gps.length > 0) {
          const maxGpsId = Math.max(...gps.map(g => Number(g.id)));
          await clearSyncedGPS(maxGpsId);
          syncedGps = gps.length;
        }
      }
    }

    // 3. Flush queued Finish Delivery calls (from offline completion taps)
    const finishList = await getQueuedFinishShifts();
    if (finishList.length > 0) {
      for (const fin of finishList) {
        try {
          const res = await fetch(
            `${BACKEND_URL}/api/v1/load-slips/${encodeURIComponent(fin.load_slip_id)}/finish-delivery`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                driver_id: fin.driver_id || driverId,
                truck_id: fin.truck_id || truckId
              })
            }
          );
          if (res.ok) {
            await clearQueuedFinishShift(fin.load_slip_id);
            syncedFinishes += 1;
          }
        } catch {
          // retry next cycle
        }
      }
    }
  } catch (err) {
    console.warn("syncDataWithServer notice:", err);
  } finally {
    isSyncing = false;
  }

  return { syncedTransactions, syncedGps, syncedSos, syncedFinishes };
};

let networkUnsubscribe: (() => void) | null = null;
let wasConnected = true;

export const startNetworkListener = (): (() => void) => {
  if (networkUnsubscribe) return networkUnsubscribe;

  networkUnsubscribe = NetInfo.addEventListener(state => {
    const online = Boolean(state.isConnected);
    if (online && !wasConnected) {
      syncDataWithServer().catch(() => {});
    }
    wasConnected = online;
  });

  // Initial opportunistic flush on app launch
  syncDataWithServer().catch(() => {});

  return () => {
    if (networkUnsubscribe) {
      networkUnsubscribe();
      networkUnsubscribe = null;
    }
  };
};
