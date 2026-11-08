/**
 * Internationalization — the reactive half (for components).
 *
 * Runes may only appear here. It binds $state to index.js's localeOf, so
 * t() from index.js tracks language changes when called while a component
 * renders. Components should import t from here — same semantics, but
 * reactive.
 */

import {
  bindLocale,
  t as plainT,
  STORAGE_KEY,
  FALLBACK,
  DICTS,
  LANGS,
  systemLocale,
  applyDocumentLang,
} from "./index.js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const state = $state({ locale: FALLBACK });

bindLocale(() => state.locale);

export { LANGS };

/** Use this in components: the view re-renders after a language switch. */
export function t(key, vars) {
  state.locale;
  return plainT(key, vars);
}

export function getLocale() {
  return state.locale;
}

/** Push the active locale to the native tray menu (desktop only; no-op in web). */
let traySynced = false;
function syncTray(locale) {
  invoke("set_tray_locale", { locale }).catch(() => {});
}

export function setLocale(id) {
  if (!DICTS[id]) return;
  state.locale = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
  applyDocumentLang(id);
  syncTray(id);
}

/** Call once at startup: read the persisted preference, else follow the system. */
export function initLocale() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {}
  const next = saved && DICTS[saved] ? saved : systemLocale();
  state.locale = next;
  applyDocumentLang(next);
  if (!traySynced) {
    traySynced = true;
    syncTray(next);
    // Picking a language inside the tray menu switches the whole UI.
    listen("tray-set-locale", (e) => {
      if (DICTS[e.payload]) setLocale(e.payload);
    }).catch(() => {});
  }
}
