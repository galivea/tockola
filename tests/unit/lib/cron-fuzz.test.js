// cron -> Windows 触发器：脚本生成输入的批量等价性测试。
//
// 具例（cron.test.js）只能守住已知的坑；这一层穷举输入空间，断言 8 条不变量，
// 用来发现「没人报过但确实错了」的组合。
//
//   I1 等价性：所有触发器按其 start + repetition 展开出的时刻集合，
//              必须与 cron 的「时 × 分 × 秒」笛卡尔积完全一致（不多不少）
//   I2 无重叠：各触发器展开的时刻互不重叠
//   I3 间隔合法：重复间隔为 0（单次）或 >= 60 秒（Windows 最短 1 分钟）
//   I4 时长合法：duration == (count-1) * step，且 duration >= interval
//   I5 不跨天：start + step*(count-1) < 86400，且链上每点都在 cron 时刻里
//   I6 上下限：interval / duration 都在 1 分钟 ~ 31 天之间
//   I7 有压缩：触发器数量 <= 时刻数量（不比「一个时刻一个触发器」更差）
//   I8 稳定：同一输入两次转换结果一致

import { describe, it, expect } from "vitest";
import { cronFields, cronToTriggers } from "../../../src/lib/cron.js";
import { toSeconds } from "../../../src/lib/duration.js";

const DAY = 86400;
const MAX_31D = 31 * DAY;
const ALLV = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
const FDS = Object.fromEntries(cronFields().map((f) => [f.key, f]));

const pad = (n) => String(n).padStart(2, "0");
const hhmmss = (s) =>
  `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

/** 只给 秒/分/时，日期部分全选（每天） */
function fieldsOf(sec, mi, h) {
  return {
    sec: { values: [...sec].sort((a, b) => a - b), step: null },
    mi: { values: [...mi].sort((a, b) => a - b), step: null },
    h: { values: [...h].sort((a, b) => a - b), step: null },
    dom: { values: ALLV(1, 31), step: null },
    mon: { values: ALLV(1, 12), step: null },
    dow: { values: ALLV(0, 6), step: null },
    year: { values: ALLV(FDS.year.min, FDS.year.max), step: null },
  };
}

const cartesian = (h, mi, sec) => {
  const out = [];
  for (const hh of h) for (const mm of mi) for (const ss of sec) out.push(hh * 3600 + mm * 60 + ss);
  return [...new Set(out)].sort((a, b) => a - b);
};

/** 把触发器数组展开成「时刻 -> 次数」的计数表 */
function expand(triggers) {
  const hits = new Map();
  for (const t of triggers) {
    const [H, M, S] = ((t.start || "").slice(11) || "00:00:00").split(":").map(Number);
    const start = H * 3600 + M * 60 + S;
    const iv = secs(t.repetition?.interval);
    const du = secs(t.repetition?.duration);
    const n = iv > 0 ? Math.floor(du / iv) + 1 : 1;
    for (let k = 0; k < n; k++) {
      const at = start + iv * k;
      hits.set(at, (hits.get(at) || 0) + 1);
    }
  }
  return hits;
}

const secs = (iso) => (iso && iso !== "PT0S" ? toSeconds(iso) : 0);

/** 跑一个用例，返回违反的不变量描述（空数组 = 通过） */
function runCase(tag, sec, mi, h, opts = {}) {
  const times = cartesian(h, mi, sec);
  if (!times.length) return [];

  const f = fieldsOf(sec, mi, h);
  if (opts.dom) f.dom = { values: opts.dom, step: null };
  if (opts.mon) f.mon = { values: opts.mon, step: null };
  if (opts.dow) f.dow = { values: opts.dow, step: null };

  const r = cronToTriggers(f, { startDate: "2026-10-20" });
  if (!r.ok) {
    // 「超出可转换范围」是产品上有意设的上限，不计为失败。
    // 判据用 reason（机器可读）而不是文案：文案会随界面语言变。
    if (r.reason === "limit") return [];
    return [`${tag} 转换失败：${r.error}`];
  }

  const problems = [];
  const hits = expand(r.triggers);
  const expanded = [...hits.keys()].sort((a, b) => a - b);

  const missing = times.filter((t) => !hits.has(t));
  const extra = expanded.filter((t) => !times.includes(t));
  const dup = expanded.filter((t) => hits.get(t) > 1);
  if (missing.length) problems.push(`${tag} I1 漏了时刻 ${missing.slice(0, 5).map(hhmmss).join(",")}`);
  if (extra.length) problems.push(`${tag} I1 多了时刻 ${extra.slice(0, 5).map(hhmmss).join(",")}`);
  if (dup.length) problems.push(`${tag} I2 重叠覆盖 ${dup.slice(0, 5).map(hhmmss).join(",")}`);

  for (const t of r.triggers) {
    const iv = secs(t.repetition?.interval);
    const du = secs(t.repetition?.duration);
    const n = iv > 0 ? Math.floor(du / iv) + 1 : 1;
    const [H, M, S] = ((t.start || "").slice(11) || "00:00:00").split(":").map(Number);
    const start = H * 3600 + M * 60 + S;
    const at = `${tag} @${hhmmss(start)}`;

    if (!times.includes(start)) problems.push(`${at} I5 起点不在 cron 时刻里`);
    if (iv !== 0 && iv < 60) problems.push(`${at} I3 间隔 ${iv}s 短于 1 分钟`);
    if (iv > MAX_31D) problems.push(`${at} I6 间隔超出 31 天`);
    if (du > MAX_31D) problems.push(`${at} I6 时长超出 31 天`);
    if (du < iv) problems.push(`${at} I4 时长 ${du} 短于间隔 ${iv}`);
    if (du !== iv * (n - 1)) problems.push(`${at} I4 时长 ${du} != (n-1)*间隔，n=${n}`);
    if (start + iv * (n - 1) >= DAY) problems.push(`${at} I5 链尾跨天`);
    if (!Array.from({ length: n }, (_, k) => start + iv * k).every((x) => times.includes(x)))
      problems.push(`${at} I5 链上有非 cron 时刻`);
  }

  if (r.triggers.length > times.length)
    problems.push(`${tag} I7 触发器 ${r.triggers.length} 个多于时刻 ${times.length} 个`);

  const again = cronToTriggers(f, { startDate: "2026-10-20" });
  if (JSON.stringify(again.triggers) !== JSON.stringify(r.triggers))
    problems.push(`${tag} I8 两次转换结果不一致`);

  return problems;
}

const HOUR_SETS = [
  [0], [1], [9], [23],
  [1, 9], [7, 9], [1, 2], [0, 12], [8, 20], [23, 0], [1, 13],
  [1, 9, 17], [0, 8, 16], [7, 8, 9], [1, 2, 9], [6, 12, 18], [22, 23, 0],
  [0, 6, 12, 18], [1, 5, 9, 13, 17, 21], [2, 4, 8, 16], [0, 23],
  ALLV(0, 23),
  ALLV(0, 23).filter((x) => x % 2 === 0),
  ALLV(0, 23).filter((x) => x % 3 === 0),
  ALLV(0, 23).filter((x) => x % 4 === 0),
  ALLV(0, 23).filter((x) => x % 6 === 0),
  ALLV(0, 23).filter((x) => x % 8 === 0),
];
const MIN_SETS = [
  [0], [1], [30], [59],
  [0, 1], [0, 3], [0, 30], [0, 15, 30, 45], [0, 1, 3], [0, 3, 32], [3, 32],
  [0, 5, 10], [0, 10, 20, 30, 40, 50], [7, 37], [0, 29, 59], [1, 31],
  [0, 20, 40], [0, 17, 34, 51], [5, 10, 15], [0, 1, 2, 3], [13, 26, 39, 52],
  ALLV(0, 59),
  ALLV(0, 59).filter((x) => x % 5 === 0),
  ALLV(0, 59).filter((x) => x % 10 === 0),
  ALLV(0, 59).filter((x) => x % 15 === 0),
  ALLV(0, 59).filter((x) => x % 20 === 0),
];
const SEC_SETS = [
  [0], [30], [0, 30], [0, 15, 30, 45], [0, 10, 20], [5, 35], [0, 59], [0, 1, 2],
  ALLV(0, 59).filter((x) => x % 20 === 0),
];
const MAX_TIMES = 4000; // 超过这个规模的组合对等价性没有新信息，跳过

describe("批量等价性：脚本生成输入", () => {
  it("系统穷举：秒 × 分 × 时", () => {
    const problems = [];
    for (const sec of SEC_SETS) {
      for (const mi of MIN_SETS) {
        for (const h of HOUR_SETS) {
          if (sec.length * mi.length * h.length > MAX_TIMES) continue;
          problems.push(...runCase(`[秒${sec}|分${mi}|时${h}]`, sec, mi, h));
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it("随机用例（可复现的伪随机）", () => {
    // 固定种子的 mulberry32：失败能复现，不像 Math.random 那样每次换一批输入
    const mulberry32 = (a) => () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (rnd, pool, max) => {
      const k = 1 + Math.floor(rnd() * max);
      const s = new Set();
      let guard = 0;
      while (s.size < k && guard++ < 500) s.add(pool[Math.floor(rnd() * pool.length)]);
      return [...s].sort((a, b) => a - b);
    };

    const rnd = mulberry32(20261020);
    const problems = [];
    for (let i = 0; i < 260; i++) {
      const h = pick(rnd, ALLV(0, 23), 5);
      const mi = pick(rnd, ALLV(0, 59), 6);
      const sec = pick(rnd, [0, 5, 10, 15, 20, 30, 45, 59], 2);
      if (h.length * mi.length * sec.length > MAX_TIMES) continue;
      problems.push(...runCase(`随机#${i + 1}`, sec, mi, h));
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it("等间隔（步进）用例：时/分/秒都是 */k 形态", () => {
    const STEPS = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30];
    const problems = [];
    for (const sh of STEPS) {
      for (const sm of STEPS) {
        for (const ss of [1, 5, 10, 15, 20, 30, 60]) {
          const h = ALLV(0, 23).filter((x) => x % sh === 0);
          const mi = ALLV(0, 59).filter((x) => x % sm === 0);
          const sec = ALLV(0, 59).filter((x) => x % ss === 0);
          if (h.length * mi.length * sec.length > MAX_TIMES) continue;
          problems.push(...runCase(`时*/${sh} 分*/${sm} 秒*/${ss}`, sec, mi, h));
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });
});

describe("批量等价性：日期维度", () => {
  it("日 / 月 / 周 组合 × 时刻：每种日期模式下时刻都要完整", () => {
    const DOM_SETS = [ALLV(1, 31), [1], [1, 15], [1, 10, 20], [31]];
    const MON_SETS = [ALLV(1, 12), [1], [3, 6, 9, 12], [2]];
    const DOW_SETS = [ALLV(0, 6), [1], [1, 2, 3, 4, 5], [0, 6], [3]];
    const TIME_CASES = [
      { sec: [0], mi: [0], h: [9] },
      { sec: [0], mi: [0, 30], h: [1, 9] },
      { sec: [0, 30], mi: [0, 3, 32], h: [1, 9] },
      { sec: [0], mi: [0, 15, 30, 45], h: [0, 8, 16] },
      { sec: [0], mi: [0, 20, 40], h: [2, 4, 8, 16] },
    ];
    const sig = (t) =>
      [
        t.type,
        (t.daysOfMonth || []).join("."),
        (t.daysOfWeek || []).join("."),
        (t.months || []).join("."),
        t.monthWeek,
      ].join("|");
    const legalBits = (arr, max) => arr.every((b) => b >= 1 && b <= max && (b & (b - 1)) === 0);

    const problems = [];
    for (const dom of DOM_SETS) {
      for (const mon of MON_SETS) {
        for (const dow of DOW_SETS) {
          for (const tc of TIME_CASES) {
            const tag = `日${dom} 月${mon} 周${dow} × 时${tc.h} 分${tc.mi}`;
            const times = cartesian(tc.h, tc.mi, tc.sec);
            const rr = cronToTriggers(
              {
                ...fieldsOf(tc.sec, tc.mi, tc.h),
                dom: { values: dom, step: null },
                mon: { values: mon, step: null },
                dow: { values: dow, step: null },
              },
              { startDate: "2026-10-20" }
            );
            if (!rr.ok) {
              if (rr.reason !== "limit") problems.push(`${tag} 转换失败：${rr.error}`);
              continue;
            }

            // 按日期模式分组：每个模式下展开的时刻必须完整且无重叠
            const byPat = new Map();
            for (const t of rr.triggers) {
              const k = sig(t);
              if (!byPat.has(k)) byPat.set(k, []);
              byPat.get(k).push(t);
            }
            for (const [k, list] of byPat) {
              const hits = expand(list);
              if (times.some((x) => !hits.has(x)))
                problems.push(`${tag} [${k}] 漏了时刻`);
              if ([...hits.keys()].some((x) => !times.includes(x)))
                problems.push(`${tag} [${k}] 多了时刻`);
              if ([...hits.values()].some((n) => n !== 1))
                problems.push(`${tag} [${k}] 有时刻被覆盖多次`);
            }

            // 参数合法性：位值必须是单个 bit，月周次必须在 1~5
            for (const t of rr.triggers) {
              const bad =
                (t.type === "weekly" && !(legalBits(t.daysOfWeek || [], 64) && t.daysOfWeek.length)) ||
                (t.type === "monthly" && !(t.daysOfMonth || []).every((d) => d >= 1 && d <= 31)) ||
                ((t.type === "monthly" || t.type === "monthlyDow") &&
                  !(t.months || []).every((m) => legalBits([m], 2048))) ||
                (t.type === "monthlyDow" &&
                  !(t.monthWeek >= 1 && t.monthWeek <= 5 && legalBits(t.daysOfWeek || [], 64)));
              if (bad) problems.push(`${tag} ${t.type} 参数不合法：${JSON.stringify(t)}`);
            }

            // 各日期模式下的触发器数应当一致（时刻部分被复用了同样的拆分）
            const sizes = [...byPat.values()].map((l) => l.length);
            if (new Set(sizes).size !== 1) problems.push(`${tag} 各日期模式触发器数不一致：${sizes.join("/")}`);
          }
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });
});
