import * as SQLite from "expo-sqlite";

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

export interface QueueTransactionParams {
  idempotencyKey?: string;
  stopId: string;
  loadSlipId?: string;
  hubId?: string;
  hubName?: string;
  customerName: string;
  productId?: string;
  productName?: string;
  sackSize?: string;
  plannedQty: number;
  deliveredQty: number;
  returnedQty: number;
  unitPrice: number;
  totalAmount: number;
  paymentMethod?: string;
  paymentMode?: string;
  partialReason?: string;
  isAdhoc?: boolean;
}

function generateIdempotencyKey(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

export const initDatabase = async (): Promise<SQLite.SQLiteDatabase | null> => {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const database = await SQLite.openDatabaseAsync("jica_driver.db");
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS queued_gps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT UNIQUE,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          speed_kmh REAL DEFAULT 0,
          heading REAL DEFAULT 0,
          logged_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queued_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT UNIQUE NOT NULL,
          stop_id TEXT NOT NULL,
          load_slip_id TEXT,
          hub_id TEXT,
          hub_name TEXT,
          customer_name TEXT NOT NULL,
          product_id TEXT,
          product_name TEXT,
          sack_size TEXT,
          planned_qty INTEGER NOT NULL,
          delivered_qty INTEGER NOT NULL,
          returned_qty INTEGER NOT NULL DEFAULT 0,
          unit_price REAL NOT NULL,
          total_amount REAL NOT NULL,
          payment_method TEXT NOT NULL,
          partial_reason TEXT,
          is_adhoc INTEGER DEFAULT 0,
          timestamp TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queued_sos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT UNIQUE NOT NULL,
          driver_id TEXT NOT NULL,
          driver_name TEXT,
          truck_id TEXT NOT NULL,
          load_slip_id TEXT,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queued_finish_shift (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          load_slip_id TEXT UNIQUE NOT NULL,
          driver_id TEXT,
          truck_id TEXT,
          finished_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS driver_settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      // Safe additive schema migrations for pre-existing APK installs
      const alterStatements = [
        "ALTER TABLE queued_gps ADD COLUMN idempotency_key TEXT",
        "ALTER TABLE queued_gps ADD COLUMN speed_kmh REAL DEFAULT 0",
        "ALTER TABLE queued_gps ADD COLUMN heading REAL DEFAULT 0",
        "ALTER TABLE queued_transactions ADD COLUMN load_slip_id TEXT",
        "ALTER TABLE queued_transactions ADD COLUMN hub_id TEXT",
        "ALTER TABLE queued_transactions ADD COLUMN hub_name TEXT",
        "ALTER TABLE queued_transactions ADD COLUMN product_id TEXT",
        "ALTER TABLE queued_transactions ADD COLUMN product_name TEXT",
        "ALTER TABLE queued_transactions ADD COLUMN sack_size TEXT",
        "ALTER TABLE queued_transactions ADD COLUMN is_adhoc INTEGER DEFAULT 0",
        "ALTER TABLE queued_sos ADD COLUMN driver_name TEXT",
        "ALTER TABLE queued_sos ADD COLUMN load_slip_id TEXT"
      ];
      for (const stmt of alterStatements) {
        try {
          await database.execAsync(stmt);
        } catch {
          // Column already exists
        }
      }

      db = database;
      return db;
    } catch (error) {
      console.warn("Database initialization notice:", error);
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

export const getDb = async (): Promise<SQLite.SQLiteDatabase | null> => {
  return db || (await initDatabase());
};

export const queueGPS = async (
  latitude: number,
  longitude: number,
  speedKmh: number = 0,
  heading: number = 0
): Promise<void> => {
  const database = await getDb();
  if (!database) return;
  try {
    const key = generateIdempotencyKey("GPS");
    await database.runAsync(
      "INSERT OR IGNORE INTO queued_gps (idempotency_key, latitude, longitude, speed_kmh, heading, logged_at) VALUES (?, ?, ?, ?, ?, ?)",
      [key, latitude, longitude, speedKmh || 0, heading || 0, new Date().toISOString()]
    );
  } catch (e) {
    console.warn("queueGPS error:", e);
  }
};

export const getQueuedGPS = async (): Promise<any[]> => {
  const database = await getDb();
  if (!database) return [];
  try {
    return await database.getAllAsync("SELECT * FROM queued_gps ORDER BY id ASC LIMIT 200");
  } catch {
    return [];
  }
};

export const clearSyncedGPS = async (maxId?: number): Promise<void> => {
  const database = await getDb();
  if (!database) return;
  try {
    if (typeof maxId === "number") {
      await database.runAsync("DELETE FROM queued_gps WHERE id <= ?", [maxId]);
    } else {
      await database.runAsync("DELETE FROM queued_gps");
    }
  } catch (e) {
    console.warn("clearSyncedGPS error:", e);
  }
};

export const queueTransaction = async (params: QueueTransactionParams): Promise<string> => {
  const key = params.idempotencyKey || generateIdempotencyKey(`TX-${params.stopId}`);
  const database = await getDb();
  if (!database) return key;

  const paymentMethod = params.paymentMethod || params.paymentMode || "Cash";
  const roundedTotal = Math.round((Number(params.totalAmount) || 0) * 100) / 100;
  const roundedUnit = Math.round((Number(params.unitPrice) || 0) * 100) / 100;

  try {
    await database.runAsync(
      `INSERT OR REPLACE INTO queued_transactions (
        idempotency_key, stop_id, load_slip_id, hub_id, hub_name, customer_name,
        product_id, product_name, sack_size, planned_qty, delivered_qty, returned_qty,
        unit_price, total_amount, payment_method, partial_reason, is_adhoc, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        key,
        params.stopId,
        params.loadSlipId || null,
        params.hubId || null,
        params.hubName || null,
        params.customerName,
        params.productId || null,
        params.productName || "Ice Product",
        params.sackSize || "Standard Sack",
        params.plannedQty,
        params.deliveredQty,
        params.returnedQty,
        roundedUnit,
        roundedTotal,
        paymentMethod,
        params.partialReason || null,
        params.isAdhoc ? 1 : 0,
        new Date().toISOString()
      ]
    );
  } catch (e) {
    console.warn("queueTransaction error:", e);
  }
  return key;
};

export const getQueuedTransactions = async (): Promise<any[]> => {
  const database = await getDb();
  if (!database) return [];
  try {
    return await database.getAllAsync("SELECT * FROM queued_transactions ORDER BY id ASC");
  } catch {
    return [];
  }
};

export const markTransactionsSynced = async (idempotencyKeys: string[]): Promise<void> => {
  const database = await getDb();
  if (!database || !idempotencyKeys || idempotencyKeys.length === 0) return;
  try {
    for (const k of idempotencyKeys) {
      await database.runAsync("DELETE FROM queued_transactions WHERE idempotency_key = ?", [k]);
    }
  } catch (e) {
    console.warn("markTransactionsSynced error:", e);
  }
};

export const queueSOS = async (params: {
  idempotencyKey: string;
  driverId: string;
  driverName?: string;
  truckId: string;
  loadSlipId?: string | null;
  latitude: number;
  longitude: number;
  reason: string;
}): Promise<void> => {
  const database = await getDb();
  if (!database) return;
  try {
    await database.runAsync(
      `INSERT OR IGNORE INTO queued_sos (
        idempotency_key, driver_id, driver_name, truck_id, load_slip_id, latitude, longitude, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.idempotencyKey,
        params.driverId,
        params.driverName || params.driverId,
        params.truckId,
        params.loadSlipId || null,
        params.latitude,
        params.longitude,
        params.reason,
        new Date().toISOString()
      ]
    );
  } catch (e) {
    console.warn("queueSOS error:", e);
  }
};

export const getQueuedSOS = async (): Promise<any[]> => {
  const database = await getDb();
  if (!database) return [];
  try {
    return await database.getAllAsync("SELECT * FROM queued_sos ORDER BY id ASC");
  } catch {
    return [];
  }
};

export const clearSyncedSOS = async (keys: string[]): Promise<void> => {
  const database = await getDb();
  if (!database || !keys.length) return;
  try {
    for (const key of keys) {
      await database.runAsync("DELETE FROM queued_sos WHERE idempotency_key = ?", [key]);
    }
  } catch (e) {
    console.warn("clearSyncedSOS error:", e);
  }
};

export const queueFinishShift = async (
  loadSlipId: string,
  driverId?: string,
  truckId?: string
): Promise<void> => {
  const database = await getDb();
  if (!database || !loadSlipId) return;
  try {
    await database.runAsync(
      "INSERT OR REPLACE INTO queued_finish_shift (load_slip_id, driver_id, truck_id, finished_at) VALUES (?, ?, ?, ?)",
      [loadSlipId, driverId || null, truckId || null, new Date().toISOString()]
    );
  } catch (e) {
    console.warn("queueFinishShift error:", e);
  }
};

export const getQueuedFinishShifts = async (): Promise<any[]> => {
  const database = await getDb();
  if (!database) return [];
  try {
    return await database.getAllAsync("SELECT * FROM queued_finish_shift ORDER BY id ASC");
  } catch {
    return [];
  }
};

export const clearQueuedFinishShift = async (loadSlipId: string): Promise<void> => {
  const database = await getDb();
  if (!database) return;
  try {
    await database.runAsync("DELETE FROM queued_finish_shift WHERE load_slip_id = ?", [loadSlipId]);
  } catch (e) {
    console.warn("clearQueuedFinishShift error:", e);
  }
};

export const clearQueues = async (): Promise<void> => {
  const database = await getDb();
  if (!database) return;
  try {
    await database.execAsync(`
      DELETE FROM queued_gps;
      DELETE FROM queued_transactions;
      DELETE FROM queued_sos;
      DELETE FROM queued_finish_shift;
    `);
  } catch (e) {
    console.warn("clearQueues error:", e);
  }
};

export const getUnsyncedSummary = async (): Promise<{
  gpsCount: number;
  txCount: number;
  sosCount: number;
  finishCount: number;
  totalPending: number;
}> => {
  const database = await getDb();
  if (!database) {
    return { gpsCount: 0, txCount: 0, sosCount: 0, finishCount: 0, totalPending: 0 };
  }
  try {
    const [gps, tx, sos, finish] = await Promise.all([
      database.getFirstAsync<{ cnt: number }>("SELECT COUNT(*) as cnt FROM queued_gps"),
      database.getFirstAsync<{ cnt: number }>("SELECT COUNT(*) as cnt FROM queued_transactions"),
      database.getFirstAsync<{ cnt: number }>("SELECT COUNT(*) as cnt FROM queued_sos"),
      database.getFirstAsync<{ cnt: number }>("SELECT COUNT(*) as cnt FROM queued_finish_shift")
    ]);
    const gpsCount = gps?.cnt || 0;
    const txCount = tx?.cnt || 0;
    const sosCount = sos?.cnt || 0;
    const finishCount = finish?.cnt || 0;
    return {
      gpsCount,
      txCount,
      sosCount,
      finishCount,
      totalPending: txCount + sosCount + finishCount
    };
  } catch {
    return { gpsCount: 0, txCount: 0, sosCount: 0, finishCount: 0, totalPending: 0 };
  }
};

export const getSetting = async (key: string): Promise<string | null> => {
  const database = await getDb();
  if (!database) return null;
  try {
    const row = await database.getFirstAsync<{ value: string }>(
      "SELECT value FROM driver_settings WHERE key = ?",
      [key]
    );
    return row ? row.value : null;
  } catch {
    return null;
  }
};

export const setSetting = async (key: string, value: string): Promise<void> => {
  const database = await getDb();
  if (!database) return;
  try {
    await database.runAsync("INSERT OR REPLACE INTO driver_settings (key, value) VALUES (?, ?)", [
      key,
      value
    ]);
  } catch (e) {
    console.warn("setSetting error:", e);
  }
};

export const deleteSetting = async (key: string): Promise<void> => {
  const database = await getDb();
  if (!database) return;
  try {
    await database.runAsync("DELETE FROM driver_settings WHERE key = ?", [key]);
  } catch (e) {
    console.warn("deleteSetting error:", e);
  }
};
