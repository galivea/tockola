/**
 * Display conversion for "last run result".
 *
 * The backend sends a decimal i32 string (taskdef.rs writes v.to_string()),
 * while Windows itself shows a hexadecimal HRESULT. Left unconverted,
 * codes such as -2147024891 are unreadable, so everything goes through
 * this module.
 *
 * Only the numeric meaning of EventData / IRegisteredTask::LastTaskResult is
 * trusted — never the localized copy, because Message follows the system
 * language.
 */

import { t, has } from "./i18n/index.js";

// Decimal -> colour class. The copy lives in the pack (result.*); codes with
// no entry fall back to the hexadecimal form.
const KNOWN = {
  0: { kind: "ok" },
  1: { kind: "err" },
  2: { kind: "err" },
  5: { kind: "err" },
  267008: { kind: "err" },
  267009: { kind: "run" },
  267010: { kind: "idle" },
  267011: { kind: "idle" },
  267012: { kind: "idle" },
  267014: { kind: "err" },
  // The following are HRESULTs (negative as decimals), indexed by their
  // unsigned two's-complement value
  2147942405: { kind: "err" },
  2147942402: { kind: "err" },
  2147942403: { kind: "err" },
  2147942487: { kind: "err" },
  2147750687: { kind: "err" },
};

/** Counts as "recently failed": everything but success, never run, running,
 * disabled and no more runs. */
export function isFailedResult(value) {
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  const unsigned = n >>> 0;
  return ![0, 267009, 267010, 267011, 267012].includes(unsigned);
}

/** Decimal -> 8-digit hex string (negatives expanded as two's complement). */
export function toResultHex(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  // >>> 0 reads the value as unsigned 32-bit, which is exactly the HRESULT
  // two's-complement form
  return (n >>> 0).toString(16).padStart(8, "0");
}

/**
 * Format one result code.
 * @param {unknown} value Decimal string / number from the backend.
 * @returns {{ text: string, kind: "ok"|"run"|"err"|"idle"|"none", tip: string }}
 */
export function formatResult(value) {
  if (value === null || value === undefined || value === "") {
    return { text: "—", kind: "none", tip: "" };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { text: String(value), kind: "none", tip: "" };
  }

  const unsigned = n >>> 0;
  const hit = KNOWN[unsigned];
  if (hit) {
    return {
      text: t(`result.${unsigned}.text`),
      kind: hit.kind,
      tip: t(`result.${unsigned}.tip`),
    };
  }

  const hex = toResultHex(n);
  return {
    text: `0x${hex.replace(/^0+(?=.)/, "")}`,
    kind: "err",
    tip: t("result.unknown.tip", { value: n, hex }),
  };
}

/**
 * History event ID -> copy (**used only when the system copy is missing**).
 *
 * The real value for the "Task Category" column is the event's own Task
 * display name, rendered by Windows under the current locale (the backend
 * reads `RenderingInfo/Task` via `EvtFormatMessage`), which is also what the
 * native History tab shows — so it varies with Windows version and language
 * pack, and no fixed table can match it.
 *
 * The UI prefers the system copy from the backend; this table is only the
 * fallback, so it lists **IDs actually observed on this machine**, with the
 * measured `TaskDisplayName` as copy:
 *   take 3000 events from channel
 *   `Microsoft-Windows-TaskScheduler/Operational`, group by ID, and read
 *   LevelDisplayName / TaskDisplayName per group.
 *
 * IDs that are absent are shown as "Event #N" — no guessing.
 *
 * Note: an earlier edition derived copy from EventData / Message and almost
 * every entry disagreed with the system (140 became "task updated" where the
 * system says "task registration updated", 107 became "time trigger fired"
 * where the system says "task triggered by scheduler"); all values have been
 * replaced with the measured ones.
 *
 * The copy lives in the pack under event.* keyed by event ID; this module only
 * looks values up, it does not store the table.
 */
export function formatEventText(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return t("event.unknown");
  const key = `event.${n}`;
  return has(key) ? t(key) : t("event.fallback", { id: n });
}

/**
 * Event output level -> copy.
 *
 * Mirrors System/Level in the event XML: 1 = critical, 2 = error,
 * 3 = warning, 4 = information. The native Level column uses the same four
 * tiers, and the same wording.
 */
export function formatLevel(level) {
  const key = String(level ?? "").trim();
  if (has(`level.${key}`)) return { text: t(`level.${key}`), kind: key };
  return { text: t("level.info"), kind: "info" };
}

/** Task state -> badge copy and colour (same logic that dims disabled
 * folders in the left tree). */
export function formatState(state) {
  const key = String(state ?? "").trim();
  switch (key) {
    case "Running":
      return { text: t("state.Running"), kind: "run" };
    case "Ready":
      return { text: t("state.Ready"), kind: "ok" };
    case "Disabled":
      return { text: t("state.Disabled"), kind: "off" };
    case "Queued":
      return { text: t("state.Queued"), kind: "wait" };
    default:
      return { text: key || t("state.unknown"), kind: "off" };
  }
}
