import { getSetting, setSetting, deleteSetting } from "./DatabaseService";

export const BACKEND_URL = (
  process.env.EXPO_PUBLIC_BACKEND_URL || "https://jica-backend-production.up.railway.app"
)
  .replace(/\/+$/, "")
  .trim();

export const SESSION_REVOKED_MESSAGE =
  "You have been logged out because this account was signed in on another device";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(val?: string | null): boolean {
  return Boolean(val && UUID_REGEX.test(String(val).trim()));
}

/**
 * Returns YYYY-MM-DD in Asia/Manila (UTC+8) safely on Hermes Android & iOS.
 */
export function getManilaDateString(dateInput: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(dateInput);
  } catch {
    // Reliable UTC+8 fallback when Intl timeZone data isn't bundled
    const manilaMs = dateInput.getTime() + 8 * 60 * 60 * 1000;
    return new Date(manilaMs).toISOString().split("T")[0];
  }
}

export function getManilaTimeString(dateInput: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(dateInput);
  } catch {
    const manilaMs = dateInput.getTime() + 8 * 60 * 60 * 1000;
    return new Date(manilaMs).toISOString().slice(11, 16);
  }
}

type RevokeListener = (reason: string) => void;
const revokeListeners = new Set<RevokeListener>();

export function subscribeSessionRevoked(listener: RevokeListener): () => void {
  revokeListeners.add(listener);
  return () => {
    revokeListeners.delete(listener);
  };
}

export function notifySessionRevoked(reason: string = SESSION_REVOKED_MESSAGE): void {
  revokeListeners.forEach(cb => {
    try {
      cb(reason);
    } catch {
      // ignore
    }
  });
}

export async function saveDriverSession(driver: any, sessionToken: string, authToken?: string): Promise<void> {
  const driverObj = {
    ...(driver || {}),
    session_token: sessionToken,
    active_session_token: sessionToken
  };
  await setSetting(
    "driver_session",
    JSON.stringify({
      driver: driverObj,
      session_token: sessionToken,
      savedAt: Date.now()
    })
  );
  await setSetting("session_token", sessionToken);
  if (authToken) {
    await setSetting("auth_token", authToken);
  }
}

export async function getStoredDriver(): Promise<any | null> {
  try {
    const rawDriver = await getSetting("driver_session");
    if (!rawDriver) return null;
    const parsed = JSON.parse(rawDriver);
    return parsed?.driver || parsed || null;
  } catch {
    return null;
  }
}

export async function clearLocalSession(): Promise<void> {
  await Promise.all([
    deleteSetting("driver_session"),
    deleteSetting("session_token"),
    deleteSetting("auth_token")
  ]);
}

export async function getSessionHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const [rawDriver, storedToken, authToken] = await Promise.all([
      getSetting("driver_session"),
      getSetting("session_token"),
      getSetting("auth_token")
    ]);
    let driverId = "";
    let sessToken = storedToken || "";
    if (rawDriver) {
      const parsed = JSON.parse(rawDriver);
      const drv = parsed?.driver || parsed;
      driverId = drv?.id || "";
      sessToken = sessToken || parsed?.session_token || drv?.session_token || drv?.active_session_token || "";
    }
    if (driverId) headers["X-User-Id"] = driverId;
    if (sessToken) headers["X-Session-Token"] = sessToken;
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  } catch {
    // ignore
  }
  return headers;
}

export async function validateMobileSession(
  userIdOverride?: string,
  tokenOverride?: string
): Promise<{ valid: boolean; offline?: boolean; reason?: string }> {
  try {
    const [rawDriver, storedToken] = await Promise.all([
      getSetting("driver_session"),
      getSetting("session_token")
    ]);
    let userId = userIdOverride || "";
    let sessionToken = tokenOverride || storedToken || "";

    if (!userId && rawDriver) {
      const parsed = JSON.parse(rawDriver);
      const drv = parsed?.driver || parsed;
      userId = drv?.id || "";
      sessionToken = sessionToken || parsed?.session_token || drv?.session_token || drv?.active_session_token || "";
    }

    if (!userId || !sessionToken) {
      return { valid: false, reason: "No active session token saved on this device." };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/auth/validate-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": userId,
          "X-Session-Token": sessionToken
        },
        body: JSON.stringify({ user_id: userId, session_token: sessionToken }),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (res.status === 401 || res.status === 403) {
        return { valid: false, reason: SESSION_REVOKED_MESSAGE };
      }
      if (res.ok) {
        const json = await res.json().catch(() => ({ valid: true }));
        if (json.valid === false) {
          return {
            valid: false,
            reason: json.reason || SESSION_REVOKED_MESSAGE
          };
        }
        return { valid: true };
      }
      return { valid: true, offline: true };
    } catch {
      clearTimeout(timer);
      // Do NOT log drivers out while inside cellular dead zones
      return { valid: true, offline: true };
    }
  } catch {
    return { valid: true, offline: true };
  }
}

export async function logoutMobileSession(driverOverride?: any): Promise<void> {
  try {
    const [rawDriver, storedToken] = await Promise.all([
      getSetting("driver_session"),
      getSetting("session_token")
    ]);
    const parsedRaw = driverOverride || (rawDriver ? JSON.parse(rawDriver) : null);
    const parsed = parsedRaw?.driver || parsedRaw;
    const userId = parsed?.id || "";
    const sessionToken =
      storedToken || parsedRaw?.session_token || parsed?.session_token || parsed?.active_session_token || "";

    if (userId) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      await fetch(`${BACKEND_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": userId,
          "X-Session-Token": sessionToken
        },
        body: JSON.stringify({
          user_id: userId,
          session_token: sessionToken
        }),
        signal: controller.signal
      }).catch(() => {});
      clearTimeout(timer);
    }
  } finally {
    await clearLocalSession();
  }
}
