/**
 * Internationalization — the runes-free half.
 *
 * Why two files:
 *  - Components need reactivity: after a language switch the UI must
 *    re-render immediately. That needs runes ($state), and runes may
 *    only appear in .svelte.js files, which node cannot run directly.
 *  - But the unit tests import logic modules such as cron.js straight
 *    into node. If runes appeared anywhere on that import chain, node
 *    would fail with a syntax error.
 * So: lookup logic and the packs live here (plain JS), while the active
 * locale is injected by the host (bindLocale). The component layer
 * (.svelte.js) injects runes state, so the same t() is reactive in the
 * browser and quietly falls back to English under node.
 */

import en from "./en.js";
import zh from "./zh.js";

/** English first: it is the default locale and the fallback. */
export const DICTS = { en, zh };

/** Each language is shown under its own name — the switcher must not follow
 * the active locale, or users lose the way back. */
export const LANGS = [
  { id: "en", label: "English" },
  { id: "zh", label: "简体中文" },
];

export const STORAGE_KEY = "ts.locale";
export const FALLBACK = "en";

/** Where the active locale is read from. Defaults to fixed English; the host
 * (.svelte.js) swaps in runes state. */
let localeOf = () => FALLBACK;

export function bindLocale(fn) {
  localeOf = fn;
}

function lookup(dict, key) {
  let node = dict;
  for (const part of key.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Look up a string.
 * @param {string} key Dot path, e.g. "action.save"
 * @param {Record<string, unknown>} [vars] Placeholder values, e.g. { count: 3 }
 */
export function t(key, vars) {
  const cur = localeOf();
  let s = lookup(DICTS[cur], key);
  if (s == null && cur !== FALLBACK) s = lookup(DICTS[FALLBACK], key);
  if (s == null) return key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}

/** Whether the key has copy — distinguishes "no such key" from "empty". */
export function has(key) {
  const cur = localeOf();
  return lookup(DICTS[cur], key) != null || lookup(DICTS[FALLBACK], key) != null;
}

/** System language preference: only en / zh are recognized; anything else
 * falls back to English. */
export function systemLocale() {
  const langs =
    typeof navigator !== "undefined" && navigator.languages
      ? navigator.languages
      : typeof navigator !== "undefined" && navigator.language
        ? [navigator.language]
        : [];
  for (const raw of langs) {
    const low = String(raw).toLowerCase();
    if (low.startsWith("zh")) return "zh";
    if (low.startsWith("en")) return "en";
  }
  return FALLBACK;
}

export function applyDocumentLang(locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
}
