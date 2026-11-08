/**
 * cron expression -> Windows Task Scheduler triggers.
 *
 * What Windows can really do (measured with Register-ScheduledTask):
 *   - Calendar triggers come in four periods only: daily (every N days), weekly
 *     (every N weeks + multi-select weekdays), monthly (multi-select days +
 *     multi-select months), and the Nth weekday of the month (single-select).
 *   - One trigger carries a single StartBoundary (to the second); several
 *     moments need a Repetition (interval + duration) instead.
 *   - There is no "year"; the shortest repetition interval is 1 minute (PT45S
 *     is rejected).
 *
 * So a conversion is necessarily "day pattern x moment group". There can be
 * several valid splits; all are generated and the one with the fewest triggers
 * wins (ties go to the split that needs no repetition).
 */
import { defaultTrigger } from "./config.js";
import { t as i18n } from "./i18n/index.js";
import { isoFromSeconds, humanize, toSeconds } from "./duration.js";

export const dowName = (i) => i18n(`cron.dow.${i}`);
/** The argument is the cron month number 1-12, not a bit value. */
export const monthName = (m) => i18n(`cron.month.${m}`);
/** Bit value -> month name, e.g. 1 -> Jan. */
export const monthBitName = (b) => monthName(Math.log2(b) + 1);
/** Separator used when listing weekday / month names. */
export const listSep = () => i18n("cron.listSep");
/** Weekday names for 0-6, in cron number order. */
export const dowNames = () => [0, 1, 2, 3, 4, 5, 6].map(dowName);

export function yearRange() {
  const y = new Date().getFullYear();
  return { min: y, max: y + 9 };
}

/** Cron field order: second minute hour day-of-month month day-of-week
 * [year]. */
export function cronFields() {
  const yr = yearRange();
  return [
    { key: "sec", label: i18n("cron.field.sec"), min: 0, max: 59, unit: "" },
    { key: "mi", label: i18n("cron.field.mi"), min: 0, max: 59, unit: "" },
    { key: "h", label: i18n("cron.field.h"), min: 0, max: 23, unit: "" },
    { key: "dom", label: i18n("cron.field.dom"), min: 1, max: 31, unit: i18n("cron.field.dom") },
    { key: "mon", label: i18n("cron.field.mon"), min: 1, max: 12, unit: "" },
    { key: "dow", label: i18n("cron.field.dow"), min: 0, max: 6, unit: "" },
    { key: "year", label: i18n("cron.field.year"), min: yr.min, max: yr.max, unit: i18n("cron.field.year") },
  ];
}

const ALL = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);

export function defaultCronFields() {
  return {
    sec: { values: [0], step: null },
    mi: { values: [0], step: null },
    h: { values: [9], step: null },
    dom: { values: ALL(1, 31), step: null },
    mon: { values: ALL(1, 12), step: null },
    dow: { values: ALL(0, 6), step: null },
    year: { values: ALL(yearRange().min, yearRange().max), step: null },
  };
}

/** Initial state when the builder opens: all seven dimensions empty — nothing is
 * pre-selected on the user's behalf.
 *
 * Date-ish fields used to be fully selected (day 1-31 / month 1-12 / weekday 0-6 /
 * the whole year range), which silently meant "every day, every month, every
 * weekday, every year". Someone who did not read closely would then create a pile
 * of triggers they never intended. Everything now starts empty and the UI says
 * plainly which dimensions are still unspecified. */
export function initialCronFields() {
  return {
    sec: { values: [], step: null },
    mi: { values: [], step: null },
    h: { values: [], step: null },
    dom: { values: [], step: null },
    mon: { values: [], step: null },
    dow: { values: [], step: null },
    year: { values: [], step: null },
  };
}

/** Values the field really resolves to; in step mode the step is expanded. */
export function valuesOf(f, fd) {
  if (!f) return [];
  if (f.step) {
    const { from, to, every } = f.step;
    const out = [];
    for (let v = from; v <= to; v += every) out.push(v);
    return out.length ? out : [from];
  }
  return [...(f.values || [])].sort((a, b) => a - b);
}

const isFull = (f, fd) => valuesOf(f, fd).length === fd.max - fd.min + 1;

/** Clamp into [lo,hi]; empty or invalid values fall back to dft. Shared by
 * the "From / to / every" boxes. */
function clampInt(v, lo, hi, dft) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dft;
  return Math.min(Math.max(n, lo), hi);
}

/**
 * "From A to B every N" — range and step collapsed into one entry point.
 *
 * The UI used to expose two separate widgets: a range (from~to) and a step
 * (from / every N), each with its own "Apply". They overlapped in meaning and
 * clobbered each other — tweak the step and then the range and the step was
 * gone. They are really just the two ends of one thing: N = 1 gives a plain
 * range, B = the upper bound gives the old-style step. One entry point now
 * absorbs out-of-range, reversed and invalid-step inputs; the UI only has to
 * pass the three boxes through. */
export function pickField(fd, form) {
  const a = clampInt(form?.from, fd.min, fd.max, fd.min);
  const b = clampInt(form?.to, fd.min, fd.max, fd.max);
  const every = Math.max(1, clampInt(form?.every, 1, fd.max - fd.min + 1, 1));
  return { values: [], step: { from: Math.min(a, b), to: Math.max(a, b), every } };
}

/** How many values "from A to B every N" selects — shown live, so the result
 * is not a surprise after pressing Apply. */
export function pickCount(fd, form) {
  const { from, to, every } = pickField(fd, form).step;
  return Math.floor((to - from) / every) + 1;
}

// ---------------------------------------------------------------- Parsing

/** @ macros from Quartz / Spring, expanded to the standard 5 fields.
 * @reboot is deliberately absent: it maps to an "At startup" trigger. */
const MACROS = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

/** The "last" notations Windows cannot express. */
function lastError(fd, p) {
  if (fd.key === "dow") {
    return i18n("cron.err.dowLast", { p });
  }
  return i18n("cron.err.domLast", { p });
}

/** Parse one cron field into { values, step, nth? }. Unsupported notation
 * throws; the caller turns it into a hint. */
function parseTerm(term, fd) {
  const { min, max } = fd;
  const t = String(term).trim();
  if (!t) throw new Error(i18n("cron.err.fieldEmpty", { field: fd.label }));
  // "?" is Quartz's "do not care", equivalent to "*".
  if (t === "*" || t === "?") return { values: ALL(min, max), step: null };

  const stepMatch = t.match(/^(\*|\d+|\d+-\d+)\/(\d+)$/);
  if (stepMatch) {
    const every = +stepMatch[2];
    if (!(every >= 1)) throw new Error(i18n("cron.err.stepNotInt", { field: fd.label, step: stepMatch[2] }));
    let from = min;
    let to = max;
    if (stepMatch[1] !== "*") {
      const seg = stepMatch[1].split("-");
      from = +seg[0];
      to = seg.length > 1 ? +seg[1] : max;
    }
    if (from < min || to > max) throw new Error(i18n("cron.err.stepOutOfRange", { field: fd.label, min, max }));
    if (from > to) throw new Error(i18n("cron.err.stepReversed", { field: fd.label, from, to }));
    return { values: [], step: { from, to, every } };
  }

  const out = new Set();
  const nth = [];
  const NAMES = {
    dow: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    mon: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
  }[fd.key];
  const name2num = (s) => {
    if (!NAMES) return s;
    const i = NAMES.indexOf(String(s).toUpperCase());
    return i < 0 ? s : String(fd.key === "mon" ? i + 1 : i);
  };

  for (const part of t.split(",")) {
    const p = part.trim();
    if (!p) continue;

    // ---- Reject non-standard characters one by one, before the name lookup,
    // so abbreviations such as WED / JAN are not misread ----
    if (/^L$|^LW$|^\d+L$|^L-\d+$/i.test(p)) throw new Error(lastError(fd, p));
    if (/^W$|^\d+W$/i.test(p)) {
      throw new Error(
        i18n("cron.err.domNearestWeekday", { p })
      );
    }
    if (/^H$|^\s*H\s*[\/(]/i.test(p)) {
      throw new Error(i18n("cron.err.jenkinsHash", { field: fd.label, p }));
    }
    // "#" = the Nth weekday of the month, which Windows' own "Nth weekday"
    // trigger matches exactly, so it converts.
    if (p.includes("#")) {
      if (fd.key !== "dow") {
        throw new Error(i18n("cron.err.hashOnlyDow", { field: fd.label }));
      }
      const m = p.match(/^([A-Za-z]{3}|\d)#(\d+)$/);
      if (!m) {
        throw new Error(i18n("cron.err.dowHashMalformed", { p }));
      }
      let d = +name2num(m[1]);
      if (!Number.isFinite(d)) throw new Error(i18n("cron.err.dowNameUnknown", { p }));
      if (fd.key === "dow" && d === 7) d = 0;
      const week = +m[2];
      if (!(d >= 0 && d <= 6)) throw new Error(i18n("cron.err.dowOutOfRange", { p }));
      if (!(week >= 1 && week <= 5)) {
        throw new Error(i18n("cron.err.dowNthOutOfRange", { p, week }));
      }
      nth.push({ dow: d, week });
      out.add(d);
      continue;
    }

    // Weekdays / months accept English abbreviations; each end of a range is
    // looked up (MON-FRI).
    const single = !String(p).includes("-");
    const seg = String(p).split("-").map(name2num);
    let a = +seg[0];
    let b = seg.length > 1 ? +seg[1] : a;
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(i18n("cron.err.notANumber", { field: fd.label, p }));
    // Some implementations write Sunday as 7: a bare 7 is Sunday (0), while
    // the range 1-7 means Monday through Sunday.
    if (fd.key === "dow" && a === 7) a = single ? 0 : 0;
    if (fd.key === "dow" && b === 7) b = single ? a : 6;
    if (a < min || b > max) throw new Error(i18n("cron.err.outOfRange", { field: fd.label, p, min, max }));
    if (a > b) throw new Error(i18n("cron.err.rangeReversed", { field: fd.label, p, a, b }));
    for (let i = a; i <= b; i++) out.add(i);
  }
  if (!out.size) throw new Error(i18n("cron.err.noValidValue", { field: fd.label }));
  // Plain weekdays and "Nth weekday" cannot mix: the first is weekly, the
  // second is the Nth of a month, and Windows cannot fit both in one trigger.
  if (nth.length && [...out].some((d) => !nth.some((x) => x.dow === d))) {
    throw new Error(i18n("cron.err.dowMixed"));
  }
  return { values: [...out].sort((a, b) => a - b), step: null, ...(nth.length ? { nth } : {}) };
}

/** Parse a whole expression. 5 fields = min hour dom month dow; 6 fields =
 * sec min hour dom month dow; 7 fields = the same plus a year. A 6-field
 * expression whose last field is a four-digit year ("0 0 1 1 * 2027") is treated
 * as 5 fields + year so it is not mistaken for a weekday. */
export function parseCron(raw) {
  let text = String(raw ?? "").trim();
  // Timezone prefix: Windows triggers always run in the machine timezone,
  // so there is no expression-level timezone.
  const tz = text.match(/^(CRON_TZ|TZ)\s*=\s*(\S+)(?:\s+|$)/i);
  if (tz) {
    throw new Error(
      i18n("cron.err.timezone", { tz: tz[0].trim() })
    );
  }
  if (text.startsWith("@")) {
    const macro = MACROS[text.toLowerCase()];
    if (!macro) {
      throw new Error(
        text.toLowerCase() === "@reboot"
          ? i18n("cron.err.atReboot")
          : i18n("cron.err.unknownMacro", { text })
      );
    }
    text = macro;
  }

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < 5) {
    throw new Error(i18n("cron.err.tooFewFields", { count: parts.length }));
  }
  // A whole crontab line pasted in: the last field is the command to run.
  const last = parts[parts.length - 1];
  const isStep = /^(\*|\d+|\d+-\d+)\/\d+$/.test(last);
  if ((/[\\/]/.test(last) && !isStep) || /\.(sh|exe|bat|cmd|ps1|py|js|vbs)$/i.test(last)) {
    throw new Error(
      i18n("cron.err.looksLikeCommand", { last })
    );
  }
  if (parts.length > 7) {
    throw new Error(
      i18n("cron.err.tooManyFields", { count: parts.length, extra: parts.slice(7).join(" ") })
    );
  }
  const fds = cronFields();
  const yearTail = parts.length === 6 && /^\d{4}$/.test(parts[5]);
  const short = parts.length === 5 || yearTail;
  const order = (short
    ? ["mi", "h", "dom", "mon", "dow", ...(yearTail ? ["year"] : [])]
    : fds.map((f) => f.key)
  ).slice(0, parts.length);
  const out = defaultCronFields();
  if (short) out.sec = { values: [0], step: null };
  order.forEach((key, i) => {
    const fd = fds.find((f) => f.key === key);
    out[key] = parseTerm(parts[i], fd);
  });
  return out;
}

// ---------------------------------------------------------------- Rendering

function renderField(f, fd) {
  // "Nth weekday" values such as 6#3 are written back verbatim and must
  // not collapse into plain weekdays.
  if (fd.key === "dow" && f?.nth?.length) {
    return f.nth.map((x) => `${x.dow}#${x.week}`).join(",");
  }
  const v = valuesOf(f, fd);
  if (!v.length) return "*";
  if (v.length === fd.max - fd.min + 1) return "*";
  if (f.step && f.step.every > 1) {
    const { from, to } = f.step;
    // When the upper bound is not the field maximum, spell the range out
    // (3-11/5): writing just 3/5 reads back to the maximum and no
    // longer matches what is ticked.
    const head = from === fd.min && to === fd.max ? "*" : to === fd.max ? String(from) : `${from}-${to}`;
    return `${head}/${f.step.every}`;
  }
  // Merge consecutive runs: 1,2,3,5 -> 1-3,5
  const chunks = [];
  let s = v[0];
  let p = v[0];
  for (let i = 1; i < v.length; i++) {
    if (v[i] === p + 1) {
      p = v[i];
      continue;
    }
    chunks.push(s === p ? `${s}` : `${s}-${p}`);
    s = p = v[i];
  }
  chunks.push(s === p ? `${s}` : `${s}-${p}`);
  return chunks.join(",");
}

export function formatCron(fields) {
  const fds = cronFields();
  const parts = fds.map((fd) => renderField(fields?.[fd.key], fd));
  while (parts.length > 6 && parts[parts.length - 1] === "*") parts.pop();
  return parts.join(" ");
}

/** Short summary of a field for the left column: * / single value /
 * range / list / every N. */
export function fieldSummary(f, fd) {
  if (!f) return "";
  if (fd.key === "dow" && f.nth?.length) {
    return f.nth.map((x) => i18n("cron.desc.nthDow", { nth: i18n(`cron.nth.${x.week}`), dow: dowName(x.dow) })).join(listSep());
  }
  if (f.step) {
    const { from, to, every } = f.step;
    const full = from === fd.min && to === fd.max;
    if (full) return every === 1 ? "*" : i18n("cron.everyN", { every, field: fd.label });
    // With bounds set, never write * — that reads as "the whole range".
    return `${from}-${to}${every > 1 ? `/${every}` : ""}`;
  }
  const v = valuesOf(f, fd);
  if (!v.length) return i18n("cron.shape.none");
  if (v.length === fd.max - fd.min + 1) return "*";
  // A bare number is ambiguous for weekdays, so show the weekday name.
  if (v.length === 1) return fd.key === "dow" ? dowName(v[0]) : String(v[0]);
  const txt = renderField(f, fd);
  return txt.length > 12 ? i18n("cron.shape.selected", { count: v.length }) : txt;
}

// ---------------------------------------------------------------- Conversion

/** cron weekday slot -> Windows DaysOfWeek bit (1=Sunday … 64=Saturday). */
export const dowBits = (dows) => dows.map((d) => 1 << d);
/** cron month -> Windows Months bit (1=January … 2048=December). */
export const monBits = (mons) => mons.map((m) => 1 << (m - 1));

const DAY = 86400;

const uniqueSorted = (arr) => [...new Set(arr)].sort((a, b) => a - b);

/** Repetition duration for n evenly spaced moments: (n-1)*step.
 *  Measured with probe-repetition.ps1 at a 1-minute interval: duration=PT1M
 *  fires twice, PT2M fires three times — the endpoint of Duration counts as a
 *  firing, so reaching the n-th point takes (n-1)*step; one minute longer drags
 *  in an (n+1)-th run. */
function repDuration(step, count) {
  return step * (count - 1);
}

/** Whether the whole point set is an arithmetic sequence — then one
 * trigger plus a repetition interval expresses it. */
function arithmeticStep(sorted) {
  if (sorted.length < 2) return null;
  const d = sorted[1] - sorted[0];
  if (d < 60) return null; // the shortest repetition interval is 1 minute
  for (let i = 2; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] !== d) return null;
  return d; // every point lies in one day, so the span is under 24 hours
}

function clusterBy(sorted, keyFn) {
  const m = new Map();
  for (const t of sorted) {
    const k = keyFn(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return [...m.values()];
}

/** Greedily take maximal arithmetic chains. Hard rule: every point in a chain
 * must sit in the same hour, or all share the same minute offset within the
 * hour — otherwise you get a repetition like 07:03 + 09:00 with a 1h57m
 * interval that nobody can read. */
function greedyChains(sorted) {
  const index = new Map(sorted.map((v, i) => [v, i]));
  const used = new Array(sorted.length).fill(false);
  const groups = [];
  const sameBlock = (a, b) => Math.floor(a / 3600) === Math.floor(b / 3600) || a % 3600 === b % 3600;

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    const start = sorted[i];
    let best = null;
    for (let j = i + 1; j < sorted.length; j++) {
      const step = sorted[j] - start;
      if (step < 60) continue; // the shortest repetition interval is 1 minute
      if (!sameBlock(start, sorted[j])) continue;
      let n = 1;
      let cur = start + step;
      while (cur <= sorted[sorted.length - 1]) {
        const k = index.get(cur);
        if (k === undefined || used[k]) break;
        n++;
        cur += step;
      }
      if (start + step * (n - 1) >= DAY) n = Math.max(n - 1, 1); // never cross midnight
      // On a tie prefer the smaller step: 7:00-7:01 reads better than
      // 7:00-7:03.
      if (n >= 2 && (!best || n > best.n)) best = { step, n };
    }
    if (best) {
      for (let k = 0; k < best.n; k++) used[index.get(start + best.step * k)] = true;
      groups.push({ start, step: best.step, count: best.n });
    } else {
      used[i] = true;
      groups.push({ start, step: 0, count: 1 });
    }
  }
  return groups;
}

/** How much better a cross-hour plan must be before it wins.
 * The default is "split by hour": every trigger repeats inside a single hour,
 * which reads naturally (7:00-7:01 becomes "every 1 minute, 2 runs"; 7:03 gets
 * its own trigger) at the cost of more triggers. A cross-hour plan only takes
 * over when it needs at least 1.5x fewer triggers — full-coverage cron such as
 * "at minute 0 and 30 of every hour" degenerates into 24 triggers when split by
 * hour, while one arithmetic chain covers it in a single trigger. That kind of
 * clear win has to be honored. */
const CROSS_HOUR_GAIN = 1.5;

/**
 * Cover the moments of one day with "start point + evenly spaced repetition".
 *
 * Covering a set with the fewest arithmetic sequences is proven NP-complete
 * (Heath 1990, Cover / Exact Cover by Arithmetic Progressions), so this does not
 * chase the theoretical optimum. Instead it leans on the fact that a cron moment
 * set is naturally the cartesian product hour x minute x second, and decomposes
 * structurally:
 *   A. the whole set is one arithmetic sequence   -> 1 (e.g. 0/8/16 o'clock, every 15 minutes)
 *   B. cut by minute offset within the hour, recurse -> one trigger per offset
 *      (e.g. 7:00 and 9:00 merge into "every 2 hours")
 *   C. greedy maximal arithmetic chains per block  -> 7:00-7:01 merged, 7:03 alone
 *   D. cut by hour, recurse per block              -> one trigger per hour
 *      (most obvious layout, the default)
 * A/B/C keep the layout with the fewest groups; that is then compared with D:
 * D wins by default unless A/B/C is clearly cheaper (see CROSS_HOUR_GAIN). */
function coverSorted(sorted) {
  const n = sorted.length;
  if (!n) return { groups: [], planCount: 0, plan: i18n("cron.shape.empty") };
  if (n === 1) return { groups: [{ start: sorted[0], step: 0, count: 1 }], planCount: 1, plan: i18n("cron.shape.single") };

  const hours = clusterBy(sorted, (t) => Math.floor(t / 3600));
  const offs = clusterBy(sorted, (t) => t % 3600);

  // Compact plan: the fewest groups among A / B / C.
  const plans = [];
  const d = arithmeticStep(sorted);
  if (d) plans.push({ name: i18n("cron.shape.arithmetic"), groups: [{ start: sorted[0], step: d, count: n }] });
  // "Minute offset" only means something across hours: inside one hour
  // every moment already has its own offset.
  if (hours.length > 1 && offs.length > 1) {
    plans.push({ name: i18n("cron.shape.minuteOffset"), groups: offs.flatMap((b) => coverSorted(b).groups) });
  }
  // Greedy is only the fallback when the structural split has nothing left
  // to cut; for very large point sets greedy is too slow, so keep the
  // structural plan.
  if (!plans.length || n <= 400) plans.push({ name: i18n("cron.shape.longChain"), groups: greedyChains(sorted) });
  plans.sort((a, b) => a.groups.length - b.groups.length);
  const compact = plans[0];

  let chosen = compact;
  let planCount = plans.length;
  if (hours.length > 1) {
    planCount += 1;
    const hourly = { name: i18n("cron.shape.hourlyBlocks"), groups: hours.flatMap((b) => coverSorted(b).groups) };
    if (!(compact.groups.length * CROSS_HOUR_GAIN <= hourly.groups.length)) chosen = hourly;
  }
  return { groups: chosen.groups, planCount, plan: chosen.name };
}

export function coverTimes(times) {
  return coverSorted(uniqueSorted(times));
}

/** Date fields -> several Windows period patterns (one trigger each), plus
 * notes explaining whatever cannot be split. */
function datePatterns(fields, fds) {
  const dom = valuesOf(fields.dom, fds.dom);
  const mon = valuesOf(fields.mon, fds.mon);
  const dow = valuesOf(fields.dow, fds.dow);
  // "The Nth weekday" (cron's 6#3) matches Windows' "Nth weekday" trigger
  // exactly: one trigger per week number.
  const nth = fields.dow?.nth;
  if (nth?.length) {
    const byWeek = new Map();
    for (const x of nth) {
      if (!byWeek.has(x.week)) byWeek.set(x.week, []);
      byWeek.get(x.week).push(dowBits([x.dow])[0]);
    }
    const months = mon.length === 12 ? [] : monBits(mon);
    const pats = [...byWeek.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, bits]) => ({ kind: "monthlyDow", monthWeek: week, daysOfWeek: bits, months }));
    const notes = [];
    // Windows has no "5th": the week number only offers 1st-4th and "last".
    if (nth.some((x) => x.week === 5))
      notes.push(
        i18n("cron.note.fifthBecomesLast")
      );
    if (dom.length === 31) return { patterns: pats, notes };
    pats.unshift({ kind: "monthly", daysOfMonth: dom, months });
    notes.push(
      i18n("cron.note.domAndDowSplit")
    );
    return { patterns: pats, notes };
  }
  const domAll = dom.length === 31;
  const monAll = mon.length === 12;
  const dowAll = dow.length === 7;
  const months = monAll ? [] : monBits(mon);
  const dows = dowBits(dow);
  const notes = [];
  const nthAll = () =>
    [1, 2, 3, 4, 5].map((monthWeek) => ({ kind: "monthlyDow", monthWeek, daysOfWeek: dows, months }));

  // nothing restricted: every day
  if (domAll && monAll && dowAll) return { patterns: [{ kind: "daily", daysInterval: 1 }], notes };
  // only the month is restricted: monthly (by date), every date selected
  if (domAll && dowAll) return { patterns: [{ kind: "monthly", daysOfMonth: ALL(1, 31), months }], notes };
  // only the date is restricted: monthly (by date)
  if (dowAll) return { patterns: [{ kind: "monthly", daysOfMonth: dom, months }], notes };
  // only the weekday is restricted, month free: weekly (several weekdays allowed)
  if (domAll && monAll) return { patterns: [{ kind: "weekly", weeksInterval: 1, daysOfWeek: dows }], notes };
  // weekday and month both restricted: Windows "weekly" knows nothing about
  // months, so it degrades to "Nth weekday of the month" — and that week number
  // is single-select, so this fans out into five triggers
  if (domAll) {
    notes.push(i18n("cron.note.monthAndDowSplit"));
    notes.push(i18n("cron.note.fourthAndLastOverlap"));
    return { patterns: nthAll(), notes };
  }
  // date and weekday both restricted: standard cron (Vixie / POSIX) means OR
  // here, not AND — old BSD defined it that way and POSIX still carries it;
  // Quartz dodges the ambiguity with ?, while Spring actually means AND.
  // Windows has no OR, so both groups are emitted and any overlapping day runs
  // twice, once per trigger.
  const out = [{ kind: "monthly", daysOfMonth: dom, months }];
  if (monAll) out.push({ kind: "weekly", weeksInterval: 1, daysOfWeek: dows });
  else out.push(...nthAll());
  const domText = dom.length === 1 ? i18n("cron.desc.day", { d: dom[0] }) : i18n("cron.desc.day", { d: dom.join(",") });
  const dowText = i18n("cron.desc.weeklyOn", { d: dow.map((d) => dowName(d)).join(listSep()) });
  notes.push(
    i18n("cron.note.domAndDowDetail", { dom: domText, dow: dowText })
  );
  const guess = nthGuess(dom, dow);
  if (guess) notes.push(guess);
  return { patterns: out, notes };
}

/** "day 8-14 + Tuesday" almost always means "the second Tuesday of the month" —
 * that needs AND, which standard cron cannot express, but Windows "Nth weekday
 * of the month" can. So spell out the rewrite. */
function nthGuess(dom, dow) {
  const lo = dom[0];
  const hi = dom[dom.length - 1];
  if (dom.length < 2 || hi - lo + 1 !== dom.length) return null; // must be one unbroken run
  if (lo % 7 !== 1 || hi % 7 !== 0) return null; // and exactly one full 1-7 / 8-14 / 15-21 / 22-28 block
  const week = (lo - 1) / 7 + 1;
  const names = dow.map((x) => dowName(x)).join(listSep());
  return i18n("cron.note.looksLikeNth", { nth: i18n(`cron.nth.${week}`), names, lo, hi, dow: dow[0], nthNum: week });
}

const pad = (n) => String(n).padStart(2, "0");
const hhmmss = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

export function humanPattern(p) {
  switch (p.kind) {
    case "daily":
      return p.daysInterval > 1 ? i18n("cron.desc.everyNDays", { n: p.daysInterval }) : i18n("cron.desc.daily");
    case "weekly":
      return i18n("cron.desc.weeklyOn", { d: p.daysOfWeek.map((b) => dowName(Math.log2(b))).join(listSep()) });
    case "monthly": {
      const days = p.daysOfMonth.length === 31 ? i18n("cron.desc.daily") : i18n("cron.desc.day", { d: p.daysOfMonth.join(",") });
      const ms = (p.months || []).length ? ` · ${p.months.map((b) => monthBitName(b)).join(listSep())}` : "";
      return i18n("cron.desc.monthlyOn", { days, months: ms });
    }
    case "monthlyDow": {
      const nth = ["", i18n("cron.nth.1"), i18n("cron.nth.2"), i18n("cron.nth.3"), i18n("cron.nth.4"), i18n("cron.nth.last")][p.monthWeek] || "";
      const ms = (p.months || []).length ? ` · ${p.months.map((b) => monthBitName(b)).join(listSep())}` : "";
      return i18n("cron.desc.monthlyNth", { nth, dow: p.daysOfWeek.map((b) => dowName(Math.log2(b))).join(listSep()), months: ms });
    }
    default:
      return p.kind;
  }
}

/** Plain-language summary of one trigger, used by the conversion preview. */
export function describeTrigger(t) {
  let s = "";
  switch (t.type) {
    case "daily":
      s = t.daysInterval > 1 ? i18n("cron.desc.everyNDays", { n: t.daysInterval }) : i18n("cron.desc.daily");
      break;
    case "weekly":
      s = i18n("cron.desc.weeklyOn", { d: t.daysOfWeek.map((b) => dowName(Math.log2(b))).join(listSep()) });
      break;
    case "monthly": {
      const days = (t.daysOfMonth || []).length === 31 ? i18n("cron.desc.daily") : i18n("cron.desc.day", { d: (t.daysOfMonth || []).join(",") });
      const ms = (t.months || []).length ? ` · ${t.months.map((b) => monthBitName(b)).join(listSep())}` : "";
      s = i18n("cron.desc.monthlyOn", { days, months: ms });
      break;
    }
    case "monthlyDow": {
      const nth = ["", i18n("cron.nth.1"), i18n("cron.nth.2"), i18n("cron.nth.3"), i18n("cron.nth.4"), i18n("cron.nth.last")][t.monthWeek] || "";
      const ms = (t.months || []).length ? ` · ${t.months.map((b) => monthBitName(b)).join(listSep())}` : "";
      s = i18n("cron.desc.monthlyNth", { nth, dow: t.daysOfWeek.map((b) => dowName(Math.log2(b))).join(listSep()), months: ms });
      break;
    }
    default:
      s = t.type;
  }
  const time = (t.start || "").slice(11) || "";
  let tail = "";
  if (t.repetition?.interval && t.repetition.interval !== "PT0S") {
    const iv = toSeconds(t.repetition.interval);
    const du = toSeconds(t.repetition.duration);
    const n = iv > 0 ? Math.floor(du / iv) + 1 : 1;
    tail = i18n("cron.desc.repeatTail", { interval: humanize(t.repetition.interval), count: n });
  }
  return `${s} ${time}${tail}`;
}

/**
 * Convert to an array of triggers. The result carries every candidate plan; the
 * caller keeps the one with the smallest triggers.length.
 * opts.startDate: "YYYY-MM-DD", used as the start date of every trigger. */
export function cronToTriggers(fields, opts = {}) {
  const fds = Object.fromEntries(cronFields().map((f) => [f.key, f]));
  const warnings = [];

  const sec = valuesOf(fields.sec, fds.sec);
  const mi = valuesOf(fields.mi, fds.mi);
  const h = valuesOf(fields.h, fds.h);
  const years = valuesOf(fields.year, fds.year);
  const missing = Object.entries({ sec: fds.sec, mi: fds.mi, h: fds.h, dom: fds.dom, mon: fds.mon, dow: fds.dow })
    .filter(([key, fd]) => !valuesOf(fields[key], fd).length)
    .map(([, fd]) => fd.label);
  if (missing.length) {
    return {
      ok: false,
      error: i18n("cron.err.missingFields", { missing: missing.join(listSep()) }),
      triggers: [],
      warnings,
    };
  }

  const times = [];
  for (const hh of h) for (const mm of mi) for (const ss of sec) times.push(hh * 3600 + mm * 60 + ss);
  if (!times.length) return { ok: false, error: i18n("cron.err.noMoment"), triggers: [], warnings };
  if (times.length > 4000) {
    return {
      ok: false,
      error: i18n("cron.err.tooManyMoments", { count: times.length }),
      // `reason` is for the program to branch on (language independent);
      // `error` is the text people read.
      reason: "limit",
      triggers: [],
      warnings,
    };
  }
  // Smallest gap between neighbouring moments: below 1 minute they cannot
  // merge into one repetition interval (Windows minimum is 1 minute).
  let minGap = Infinity;
  for (let i = 1; i < times.length; i++) minGap = Math.min(minGap, times[i] - times[i - 1]);

  // Year: Windows has no such concept; it only fixes the start date.
  let dateStr = opts.startDate || "";
  if (years.length && years.length < fds.year.max - fds.year.min + 1) {
    if (years.length > 1) warnings.push(i18n("cron.err.yearIgnored", { year: years[0] }));
    if (dateStr) dateStr = `${years[0]}${dateStr.slice(4)}`;
  }
  if (!dateStr) {
    const d = new Date();
    dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const { patterns, notes } = datePatterns(fields, fds);
  const covered = coverTimes(times);
  const groups = covered.groups;
  const total = patterns.length * groups.length;
  if (total > 100) {
    return {
      ok: false,
      error:
        minGap < 60
          ? i18n("cron.err.gapTooSmall", { gap: minGap, total })
          : i18n("cron.err.tooManyTriggers", { total, patterns: patterns.length, groups: groups.length }),
      reason: "limit",
      triggers: [],
      warnings,
    };
  }

  const build = (useGroups) => {
    const out = [];
    for (const p of patterns) {
      for (const g of useGroups) {
        const t = defaultTrigger(p.kind);
        t.start = `${dateStr}T${hhmmss(g.start)}`;
        t.end = "";
        if (p.kind === "daily") t.daysInterval = p.daysInterval;
        if (p.kind === "weekly") {
          t.weeksInterval = p.weeksInterval;
          t.daysOfWeek = p.daysOfWeek;
        }
        if (p.kind === "monthly") {
          t.daysOfMonth = p.daysOfMonth;
          t.months = p.months;
        }
        if (p.kind === "monthlyDow") {
          t.monthWeek = p.monthWeek;
          t.daysOfWeek = p.daysOfWeek;
          t.months = p.months;
        }
        if (g.count > 1) {
          t.repetition = {
            interval: isoFromSeconds(g.step),
            duration: isoFromSeconds(repDuration(g.step, g.count)),
            stopAtDurationEnd: false,
          };
        }
        out.push(t);
      }
    }
    return out.sort((a, b) => String(a.start).localeCompare(String(b.start)) || a.type.localeCompare(b.type));
  };

  const triggers = build(groups);
  for (const n of notes) warnings.push(n);
  if (triggers.some((t) => t.repetition?.interval && t.repetition.interval !== "PT0S")) {
    warnings.push(i18n("cron.err.partialRepetition"));
  }
  if (minGap < 60 && groups.length > 1) {
    warnings.push(
      i18n("cron.err.gapSmallSplit", { gap: minGap, groups: groups.length })
    );
  }
  if (triggers.length > 30) {
    warnings.push(i18n("cron.err.willCreateMany", { count: triggers.length }));
  }

  return {
    ok: true,
    triggers,
    planLabel: covered.plan,
    planCount: covered.planCount,
    warnings,
  };
}
