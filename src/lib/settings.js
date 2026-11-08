/**
 * App-level preferences that are NOT part of the query state:
 *   - closeBehavior: "quit" | "tray"   what the X button / Alt+F4 does
 *
 * Storage mirrors filters.js: tauri-plugin-store under Tauri, Web storage
 * fallback in browser demo mode. The live value is cached in `cached` so the
 * title-bar close handler can read it synchronously; and every change is
 * pushed to the Rust side (set_close_behavior) so the native close path
 * honors it too.
 */

import { isTauri } from "./api.js";
import { invoke } from "@tauri-apps/api/core";

export const CLOSE_QUIT = "quit";
export const CLOSE_TRAY = "tray";
export const DEFAULT_CLOSE_BEHAVIOR = CLOSE_QUIT;

const STORE_FILE = "settings.json";
const STORE_KEY = "settings";
const WEB_KEY = "tockola.settings.v1";
// Pre-rename browser key; read once and migrated on the first load.
const LEGACY_WEB_KEY = "rhyzal.settings.v1";

// Synchronously readable by the title bar; refreshed by load/save.
let cached = DEFAULT_CLOSE_BEHAVIOR;

function normalize(raw) {
  const base = { closeBehavior: DEFAULT_CLOSE_BEHAVIOR };
  if (!raw || typeof raw !== "object") return base;
  const cb = raw.closeBehavior;
  return {
    closeBehavior: cb === CLOSE_QUIT || cb === CLOSE_TRAY ? cb : DEFAULT_CLOSE_BEHAVIOR,
  };
}

// ---- Store handle (same dual-channel shape as filters.js) ----

let storePromise = null;
function getStore() {
  if (!isTauri) return Promise.resolve(null);
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store")
      .then((m) => m.load(STORE_FILE, { autoSave: 100 }))
      .catch((e) => {
        console.warn("settings store plugin unavailable, falling back to Web storage", e);
        storePromise = null;
        return null;
      });
  }
  return storePromise;
}

async function pushToRust(behavior) {
  if (!isTauri) return;
  try {
    await invoke("set_close_behavior", { behavior });
  } catch (e) {
    // Web demo or pre-startup; the Rust default stands until the next push.
    console.warn("failed to push close behavior to Rust", e);
  }
}

// ---- Public API ----

/** Read once at startup; also pushes the loaded value to Rust. */
export async function loadCloseBehavior() {
  let value = DEFAULT_CLOSE_BEHAVIOR;
  if (isTauri) {
    try {
      const store = await getStore();
      if (store) {
        const saved = await store.get(STORE_KEY);
        if (saved) value = normalize(saved).closeBehavior;
      }
    } catch (e) {
      console.warn("failed to read the settings store", e);
    }
  } else {
    try {
      let raw = localStorage.getItem(WEB_KEY);
      if (!raw) {
        raw = localStorage.getItem(LEGACY_WEB_KEY);
        if (raw) {
          localStorage.setItem(WEB_KEY, raw);
          localStorage.removeItem(LEGACY_WEB_KEY);
        }
      }
      if (raw) value = normalize(JSON.parse(raw)).closeBehavior;
    } catch {
      /* ignore */
    }
  }
  cached = value;
  await pushToRust(value);
  return value;
}

export function getCloseBehavior() {
  return cached;
}

export async function saveCloseBehavior(behavior) {
  const next = normalize({ closeBehavior: behavior }).closeBehavior;
  cached = next;
  await pushToRust(next);
  const payload = { closeBehavior: next };
  if (isTauri) {
    try {
      const store = await getStore();
      if (store) {
        await store.set(STORE_KEY, payload);
        return;
      }
    } catch (e) {
      console.warn("failed to write the settings store", e);
    }
  }
  try {
    localStorage.setItem(WEB_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
