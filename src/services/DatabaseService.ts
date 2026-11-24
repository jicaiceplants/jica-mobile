import * as SQLite from 'expo-sqlite';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

export const getDb = async (): Promise<SQLite.SQLiteDatabase | null> => {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const db = await SQLite.openDatabaseAsync('jica.db');

      // Create GPS queue table with batching support
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS queued_gps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lat REAL NOT NULL,
          lng REAL NOT NULL,
          timestamp TEXT NOT NULL
        );
      `);

      // Create Transactions queue table with idempotency & partial delivery tracking
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS queued_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT UNIQUE NOT NULL,
          stop_id TEXT NOT NULL,
          customer_name TEXT NOT NULL,
          planned_qty INTEGER NOT NULL,
          delivered_qty INTEGER NOT NULL,
          returned_qty INTEGER NOT NULL,
          unit_price REAL NOT NULL,
          total_amount REAL NOT NULL,
          payment_method TEXT NOT NULL,
          partial_reason TEXT,
          timestamp TEXT NOT NULL
        );
      `);

      // Create Emergency SOS table
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS queued_sos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          idempotency_key TEXT UNIQUE NOT NULL,
          driver_id TEXT NOT NULL,
          truck_id TEXT NOT NULL,
          load_slip_id TEXT,
          reason TEXT NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          timestamp TEXT NOT NULL
        );
      `);

      // Create App Settings / Flags table (for one-time terms consent, etc.)
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      dbInstance = db;
      console.log('JICA SQLite Database initialized with idempotency, SOS & settings schema');
      return dbInstance;
    } catch (error) {
      console.error('Error initializing SQLite database:', error);
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
};

export const initDatabase = async (): Promise<void> => {
  await getDb();
};

export const queueGPS = async (lat: number, lng: number): Promise<void> => {
  try {
    const db = await getDb();
    if (!db) return;
    const timestamp = new Date().toISOString();
    await db.runAsync(
      'INSERT INTO queued_gps (lat, lng, timestamp) VALUES (?, ?, ?)',
      [lat, lng, timestamp]
    );
    console.log(`GPS queued locally: ${lat}, ${lng}`);
  } catch (error) {
    console.error('Error queueing GPS:', error);
  }
};

export interface QueueTransactionParams {
  idempotencyKey: string;
  stopId: string;
  customerName: string;
  plannedQty: number;
  deliveredQty: number;
  returnedQty: number;
  unitPrice: number;
  totalAmount: number;
  paymentMethod: string;
  partialReason?: string;
}

export const queueTransaction = async (params: QueueTransactionParams): Promise<void> => {
  try {
    const db = await getDb();
    if (!db) return;
    const timestamp = new Date().toISOString();
    await db.runAsync(
      `INSERT OR REPLACE INTO queued_transactions (
        idempotency_key, stop_id, customer_name, planned_qty, 
        delivered_qty, returned_qty, unit_price, total_amount, 
        payment_method, partial_reason, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.idempotencyKey,
        params.stopId,
        params.customerName,
        params.plannedQty,
        params.deliveredQty,
        params.returnedQty,
        params.unitPrice,
        params.totalAmount,
        params.paymentMethod,
        params.partialReason || null,
        timestamp
      ]
    );
    console.log(`Transaction queued locally with idempotency: ${params.idempotencyKey}`);
  } catch (error) {
    console.error('Error queueing transaction in SQLite:', error);
  }
};

export const getQueuedGPS = async (): Promise<any[]> => {
  try {
    const db = await getDb();
    if (!db) return [];
    return await db.getAllAsync('SELECT * FROM queued_gps');
  } catch (error) {
    console.error('Error getting GPS queue:', error);
    return [];
  }
};

export const getQueuedTransactions = async (): Promise<any[]> => {
  try {
    const db = await getDb();
    if (!db) return [];
    return await db.getAllAsync('SELECT * FROM queued_transactions');
  } catch (error) {
    console.error('Error getting transactions queue:', error);
    return [];
  }
};

export interface QueueSOSParams {
  idempotencyKey: string;
  driverId: string;
  truckId: string;
  loadSlipId?: string;
  reason: string;
  latitude: number;
  longitude: number;
  timestamp: string;
}

export const queueSOS = async (params: QueueSOSParams): Promise<void> => {
  try {
    const db = await getDb();
    if (!db) return;
    await db.runAsync(
      `INSERT OR REPLACE INTO queued_sos (
        idempotency_key, driver_id, truck_id, load_slip_id, reason, latitude, longitude, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.idempotencyKey,
        params.driverId,
        params.truckId,
        params.loadSlipId || null,
        params.reason,
        params.latitude,
        params.longitude,
        params.timestamp
      ]
    );
    console.log(`Emergency SOS recorded locally: ${params.reason} (${params.idempotencyKey})`);
  } catch (error) {
    console.error('Error recording SOS in SQLite:', error);
  }
};

export const getQueuedSOS = async (): Promise<any[]> => {
  try {
    const db = await getDb();
    if (!db) return [];
    return await db.getAllAsync('SELECT * FROM queued_sos ORDER BY id ASC');
  } catch (error) {
    console.error('Error getting queued SOS:', error);
    return [];
  }
};

export const clearQueues = async (gpsIds: number[], txIds: number[]): Promise<void> => {
  try {
    const db = await getDb();
    if (!db) return;
    if (gpsIds.length > 0) {
      const placeholders = gpsIds.map(() => '?').join(',');
      await db.runAsync(`DELETE FROM queued_gps WHERE id IN (${placeholders})`, gpsIds);
    }
    if (txIds.length > 0) {
      const placeholders = txIds.map(() => '?').join(',');
      await db.runAsync(`DELETE FROM queued_transactions WHERE id IN (${placeholders})`, txIds);
    }
    console.log('SQLite queues cleared after successful sync');
  } catch (error) {
    console.error('Error clearing SQLite queues:', error);
  }
};

export const getSetting = async (key: string): Promise<string | null> => {
  try {
    const db = await getDb();
    if (!db) return null;
    const row: any = await db.getFirstAsync('SELECT value FROM app_settings WHERE key = ?', [key]);
    return row ? row.value : null;
  } catch (error) {
    return null;
  }
};

export const setSetting = async (key: string, value: string): Promise<void> => {
  try {
    const db = await getDb();
    if (!db) return;
    await db.runAsync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
  } catch (error) {
    console.error(`Error saving setting ${key}:`, error);
  }
};
