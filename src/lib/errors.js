/**
 * Turning backend failures into UI text.
 *
 * Rust never sends a display string: every command returns `AppError { code,
 * detail }`, where `code` is a stable public identifier and `detail` carries
 * locale-neutral context (a path, a name, a COM error). This module is the only
 * place that knows how to turn that pair into something readable, so the
 * backend stays translatable and the UI never echoes a raw system message.
 *
 * The browser demo layer throws plain `Error` instead, which is already
 * human-readable; both shapes go through the same helper.
 */

import { t, has } from "./i18n/index.js";

/** The stable identifier carried by `AppError`, or "" for anything else. */
export function errorCode(e) {
  if (e && typeof e === "object" && typeof e.code === "string") return e.code;
  return "";
}

/**
 * Render an error for the user.
 *
 * @param {unknown} e Rejection value from the API layer.
 * @param {string} [fallbackKey] Language-pack key used when nothing better fits.
 */
export function errText(e, fallbackKey = "err.unknown") {
  if (typeof e === "string") return e;

  const code = errorCode(e);
  if (code) {
    const key = `err.${code}`;
    if (has(key)) return t(key, { detail: e.detail ?? "" });
    return t(fallbackKey, { detail: code });
  }

  const msg = e && typeof e.message === "string" ? e.message.trim() : "";
  if (msg) return msg;
  return t(fallbackKey);
}
