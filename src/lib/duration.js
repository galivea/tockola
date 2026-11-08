/**
 * ISO 8601 durations: PnDTnHnMnS.
 *
 * Every time span in the Windows Task Scheduler XML uses this format
 * (Repetition/Interval, RandomDelay, ExecutionTimeLimit, DeleteExpiredTaskAfter...).
 *
 * The UI takes "one number + one unit", never a free-form ISO string: measured
 * on Windows, only days/hours/minutes/seconds are accepted — P1M (months) and
 * P1Y (years) are always rejected with "the format is incorrect or out of
 * range", while any combination of seconds, minutes, hours and days is
 * accepted. "Number + unit" cannot express months or years, cannot be
 * syntactically wrong, and lets each field clamp its own range.
 *
 * Measured per-field limits (probed one by one on this machine with
 * Register-ScheduledTask -Xml; see LIMITS):
 */

/** The six components a duration splits into, in ISO writing order. */
export const EMPTY = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 };

import { t } from "./i18n/index.js";

const KEYS = ["y", "mo", "d", "h", "mi", "s"];

/** Units offered in the dropdown, smallest first. */
export const ALL_UNITS = ["s", "mi", "h", "d"];
export const UNIT_SEC = { s: 1, mi: 60, h: 3600, d: 86400 };

/** Unit dropdown labels. A function rather than a constant object so it
 * re-evaluates after a language switch. */
export const unitLabel = (u) => t(`unitFull.${u}`);

export function isZero(p) {
  return KEYS.every((k) => !p[k]);
}

/**
 * Parse an ISO 8601 string. With a T the time part is parsed; without one, M
 * means months (P1M = one month). Months and years can only come from legacy
 * data written elsewhere: Windows rejects them and the UI never produces them.
 * Returns null when the input is not valid ISO.
 */
export function parseIso(text) {
  const s = String(text || "").trim().toUpperCase();
  if (!s) return { ...EMPTY };
  const m = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?!$)(\d+H)?(\d+M)?(\d+S)?)?$/.exec(s);
  if (!m) return null;
  const p = { ...EMPTY };
  p.y = m[1] ? +m[1].slice(0, -1) : 0;
  p.mo = m[2] ? +m[2].slice(0, -1) : 0;
  // P1W counts as 7 days; the scheduler XML never emits weeks, but legacy
  // data that uses them must still parse.
  p.d = (m[3] ? +m[3].slice(0, -1) * 7 : 0) + (m[4] ? +m[4].slice(0, -1) : 0);
  p.h = m[6] ? +m[6].slice(0, -1) : 0;
  p.mi = m[7] ? +m[7].slice(0, -1) : 0;
  p.s = m[8] ? +m[8].slice(0, -1) : 0;
  return p;
}

/** Components -> ISO string; all-zero becomes PT0S. */
export function formatIso(p) {
  if (isZero(p)) return "PT0S";
  let out = "P";
  if (p.y) out += `${p.y}Y`;
  if (p.mo) out += `${p.mo}M`;
  if (p.d) out += `${p.d}D`;
  let t = "";
  if (p.h) t += `${p.h}H`;
  if (p.mi) t += `${p.mi}M`;
  if (p.s) t += `${p.s}S`;
  if (t) out += `T${t}`;
  return out;
}

/** Seconds -> components; anything past 24 hours stays on `d`, which is
 * how Windows normalizes it when written back. */
export function fromSeconds(total) {
  const s = Math.max(0, Math.round(Number(total) || 0));
  return {
    y: 0,
    mo: 0,
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    mi: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

/** Seconds -> ISO string. */
export function isoFromSeconds(total) {
  return formatIso(fromSeconds(total));
}

/** ISO string -> seconds (a year counts as 365 days, a month as 30, only
 * so that legacy data can still be shown as a usable value). */
export function toSeconds(iso) {
  const p = parseIso(iso);
  if (!p) return 0;
  return p.y * 31536000 + p.mo * 2592000 + p.d * 86400 + p.h * 3600 + p.mi * 60 + p.s;
}

/**
 * Which unit best shows this number of seconds: the largest unit that divides
 * it evenly, else the smallest (5400 s -> 90 minutes, 86400 -> 1 day).
 */
export function bestUnit(sec, units = ALL_UNITS) {
  const list = units?.length ? units : ALL_UNITS;
  const s = Math.max(0, Math.round(sec));
  if (!s) return list[0];
  const big = ["d", "h", "mi", "s"].filter((u) => list.includes(u));
  for (const u of big) {
    if (s % UNIT_SEC[u] === 0 && s / UNIT_SEC[u] >= 1) return u;
  }
  return list[0];
}

/** ISO string -> { num, unit }, ready for the "number + unit" pair. */
export function splitValue(iso, units = ALL_UNITS) {
  const sec = toSeconds(iso);
  const unit = bestUnit(sec, units);
  return { num: Math.round(sec / UNIT_SEC[unit]), unit };
}

/** "Number + unit" -> ISO string. */
export function compose(num, unit) {
  const n = Math.max(0, Math.round(Number(num) || 0));
  return isoFromSeconds(n * (UNIT_SEC[unit] ?? 1));
}

/**
 * Clamp to the range a field allows.
 * 0 always passes — it means "no repeat / no limit / no deletion", and the
 * backend decides whether to write the element at all; only non-zero values
 * are subject to min / max.
 */
export function clampSeconds(sec, min = 0, max = null) {
  let v = Math.max(0, Math.round(Number(sec) || 0));
  if (v > 0 && min) v = Math.max(v, min);
  if (max != null) v = Math.min(v, max);
  return v;
}

/** The range in plain words, for the tooltip. */
export function rangeText(min, max) {
  const lo = min ? humanize(isoFromSeconds(min)) : "0";
  if (max == null) return t("duration.from", { value: lo });
  return `${lo} ~ ${humanize(isoFromSeconds(max))}`;
}

/** ISO string -> plain words; normalized first, so PT90M reads as
 * "1 hour 30 minutes" rather than "90 minutes". */
export function humanize(iso) {
  const p = parseIso(iso);
  if (!p) return "";
  const q = fromSeconds(toSeconds(iso));
  if (isZero(q)) return "0";
  return KEYS.filter((k) => q[k]).map((k) => `${q[k]}${t(`unit.${k}`)}`).join(t("unit.sep"));
}

/**
 * Measured limits per duration field, in seconds.
 * max = null means no upper bound was found (4000 days still registers), so the
 * UI does not enforce one.
 */
export const LIMITS = {
  repeatInterval: { min: 60, max: 31 * 86400 },
  repeatDuration: { min: 60, max: null },
  randomDelay: { min: 1, max: 31 * 86400 },
  delay: { min: 1, max: null },
  executionTimeLimit: { min: 1, max: null },
  restartInterval: { min: 60, max: 31 * 86400 },
  idleDuration: { min: 1, max: null },
  waitTimeout: { min: 1, max: null },
  deleteExpired: { min: 1, max: null },
  maintenancePeriod: { min: 86400, max: null, units: ["d"] },
  maintenanceDeadline: { min: 86400, max: null, units: ["d"] },
};
