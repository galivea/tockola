// cron -> Windows 触发器：具例回归。
//
// 这一层钉的是「历史上出过错的具体表达式」，穷举覆盖在 cron-fuzz.test.js。
// Windows 的触发器模型与 cron 差别很大：没有年/秒维度、重复间隔最短 1 分钟、
// 「每月第 N 个星期 X」是独立类型。转换漏掉这些约束时，任务不会报错，只会不跑。

import { describe, it, expect } from "vitest";
import {
  parseCron,
  formatCron,
  cronToTriggers,
  coverTimes,
  cronFields,
  initialCronFields,
  valuesOf,
  pickField,
  pickCount,
  fieldSummary,
} from "../../../src/lib/cron.js";

const T = (expr) => cronToTriggers(parseCron(expr), { startDate: "2026-10-20" });
const FDS = Object.fromEntries(cronFields().map((f) => [f.key, f]));
const hh = (s) =>
  `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const G = (secs) => coverTimes(secs).groups.map((g) => `${hh(g.start)}/${g.step}/${g.count}`);

describe("解析与回写", () => {
  it("常见写法解析后能原样写回", () => {
    expect(formatCron(parseCron("0 9 * * *"))).toBe("0 0 9 * * *"); // 5 段补秒
    expect(formatCron(parseCron("0 30 8 * * 1"))).toBe("0 30 8 * * 1");
    expect(formatCron(parseCron("0 0 1 1 * 2027"))).toBe("0 0 0 1 1 * 2027"); // 末位是年
    expect(formatCron(parseCron("0 0 9,13,17 1-5 * *"))).toBe("0 0 9,13,17 1-5 * *");
    expect(formatCron(parseCron("0 */15 * * * *"))).toBe("0 */15 * * * *");
  });

  it("缩写与 7=周日 都归一成数字", () => {
    expect(formatCron(parseCron("0 9 * * MON-FRI"))).toBe("0 0 9 * * 1-5");
    expect(formatCron(parseCron("0 9 1 MAR *"))).toBe("0 0 9 1 3 *");
    expect(formatCron(parseCron("0 9 * * 7"))).toBe("0 0 9 * * 0");
  });
});

describe("不支持的写法必须在解析时就报错", () => {
  it.each([
    ["L（当月最后一天）", "0 0 L * *", /最后一天/],
    ["LW（最后工作日）", "0 0 LW * *", /最后一天|最近工作日/],
    ["L-3（倒数第三天）", "0 0 L-3 * *", /最后一天/],
    ["W（最近工作日）", "0 0 15W * *", /最近工作日/],
    ["5L（最后一个周五）", "0 0 * * 5L", /最后一个星期/],
    ["H（Jenkins 散列）", "H * * * *", /Jenkins/],
    ["H(0-30)（Jenkins 散列）", "H(0-30) * * * *", /Jenkins/],
    ["@reboot", "@reboot", /开机/],
    ["不认识的宏", "@every-5m", /不认识的宏/],
    ["时区前缀 CRON_TZ", "CRON_TZ=Asia/Shanghai 0 9 * * *", /时区/],
    ["时区前缀 TZ", "TZ=UTC 0 9 * * *", /时区/],
    ["段数不足", "0 9 * *", /5~7 段/],
    ["带上了要执行的命令", "0 9 * * * /usr/bin/backup.sh", /命令/],
    ["分钟越界", "70 9 * * *", /超出/],
    ["日期越界", "0 0 32 * *", /超出/],
    ["区间写反", "5-1 * * * *", /反的/],
    ["步长 0", "*/0 * * * *", /步长/],
  ])("%s", (_name, expr, re) => {
    // 静默接受这些写法会让用户以为设好了，实际 Windows 侧根本不存在对应语义
    expect(() => parseCron(expr)).toThrow(re);
  });
});

describe("转换：时刻合并成重复间隔", () => {
  it("每天一次合成 1 个 daily", () => {
    const r = T("0 9 * * *");
    expect(r.triggers).toHaveLength(1);
    expect(r.triggers[0].type).toBe("daily");
    expect(r.triggers[0].start).toBe("2026-10-20T09:00:00");
  });

  it("工作日合成 1 个 weekly（位掩码 周一~周五）", () => {
    const r = T("0 9 * * 1-5");
    expect([r.triggers.length, r.triggers[0].type]).toEqual([1, "weekly"]);
    expect(r.triggers[0].daysOfWeek).toEqual([2, 4, 8, 16, 32]);
  });

  it("每月 1 号合成 monthly，月份用位值", () => {
    expect([T("0 0 1 * *").triggers[0].type, T("0 0 1 * *").triggers[0].daysOfMonth]).toEqual([
      "monthly",
      [1],
    ]);
    expect(T("0 9 1 3 *").triggers[0].months).toEqual([4]);
  });

  it("多个时刻压成一条重复链，而不是拆成多个触发器", () => {
    const a = T("0 0,12 * * *");
    expect(a.triggers).toHaveLength(1);
    expect([a.triggers[0].repetition.interval, a.triggers[0].repetition.duration]).toEqual([
      "PT12H",
      "PT12H",
    ]);

    const b = T("0 */8 * * *");
    expect(b.triggers).toHaveLength(1);
    expect([b.triggers[0].repetition.interval, b.triggers[0].repetition.duration]).toEqual([
      "PT8H",
      "PT16H",
    ]);

    const c = T("0 9,13,17 * * *");
    expect(c.triggers).toHaveLength(1);
    expect([c.triggers[0].repetition.interval, c.triggers[0].repetition.duration]).toEqual([
      "PT4H",
      "PT8H",
    ]);

    const d = T("*/15 * * * *");
    expect(d.triggers).toHaveLength(1);
    expect([d.triggers[0].repetition.interval, d.triggers[0].repetition.duration]).toEqual([
      "PT15M",
      "PT23H45M",
    ]);
  });

  it("23 点与 1 点从较早的点起算，不从 23 点跨到次日", () => {
    const r = T("0 0 23,1 * * *");
    expect(r.triggers).toHaveLength(1);
    expect(r.triggers[0].start).toBe("2026-10-20T01:00:00");
    expect(r.triggers[0].repetition.interval).toBe("PT22H");
  });

  it("重复取值去重，年份只写进起始日期", () => {
    expect(T("0 9,9 * * *").triggers).toHaveLength(1);
    expect(T("0 0 1 1 * 2027").triggers[0].start.slice(0, 4)).toBe("2027");
  });
});

describe("转换：日期与星期同时限定时是「或」不是「且」", () => {
  it("同时限定日期与星期时拆成两个触发器并给出警告", () => {
    const r = T("0 9 1 * 1");
    expect(r.triggers.map((t) => t.type)).toEqual(["monthly", "weekly"]);
    expect(r.warnings.some((w) => /「或」/.test(w) && /不是「且」/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /跑两次/.test(w))).toBe(true);
  });

  it("「8-14 号 + 周二」是网上流传的「第二个周二」配方，要指出来并给改法", () => {
    const r = T("0 9 8-14 * 2");
    expect(r.warnings.some((w) => /每月第二个周二/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /2#2/.test(w))).toBe(true);
  });

  it("只限一边时不误报，残缺的 7 天块也不误报", () => {
    expect(T("0 9 * * 2").warnings.some((w) => /「或」/.test(w))).toBe(false);
    expect(T("0 9 8 * *").warnings.some((w) => /「或」/.test(w))).toBe(false);
    expect(T("0 9 8-10 * 2").warnings.some((w) => /每月第/.test(w))).toBe(false);
    expect(T("0 9 29-31 * 2").warnings.some((w) => /每月第/.test(w))).toBe(false);
  });
});

describe("转换：# = 每月第 N 个星期 X", () => {
  it("转成 monthlyDow，周次只能单选所以多个 # 要拆开", () => {
    const a = T("0 9 * * 6#3");
    expect([a.triggers.length, a.triggers[0].type]).toEqual([1, "monthlyDow"]);
    expect([a.triggers[0].monthWeek, a.triggers[0].daysOfWeek]).toEqual([3, [64]]);

    expect(T("0 9 * * FRI#3").triggers[0].daysOfWeek).toEqual([32]);
    expect(T("0 9 * * 6#2,6#4").triggers.map((t) => t.monthWeek)).toEqual([2, 4]);
    expect(formatCron(parseCron("0 9 * * 6#3"))).toBe("0 0 9 * * 6#3");
  });

  it("3 月的周一展开成 5 个（周次即第几个，无法合并）", () => {
    // 日期不限、星期=周一：「第几个周一」是不确定的，只能按 5 个周次铺满
    const r = T("0 9 * 3 1");
    expect(r.triggers).toHaveLength(5);
    expect(r.triggers.map((t) => t.monthWeek)).toEqual([1, 2, 3, 4, 5]);
    expect(r.triggers[0].months).toEqual([4]);
  });

  it("日期与 # 都限定时拆成 monthly + monthlyDow", () => {
    expect(T("0 9 1 * 6#3").triggers.map((t) => t.type)).toEqual(["monthly", "monthlyDow"]);
  });
});

describe("转换：@ 宏与秒级的硬约束", () => {
  it("@ 宏展开成对应类型", () => {
    expect(T("@daily").triggers[0].start).toBe("2026-10-20T00:00:00");
    expect(T("@weekly").triggers[0].type).toBe("weekly");
    expect(T("@monthly").triggers[0].type).toBe("monthly");
    expect(T("@hourly").triggers).toHaveLength(1);
  });

  it("秒级重复只能拆成多条间隔 1 分钟的链", () => {
    const s30 = T("*/30 * * * * *");
    expect(s30.triggers).toHaveLength(48);
    expect(s30.triggers[0].repetition.interval).toBe("PT1M");
    expect(s30.warnings.some((w) => /合并不成一条重复/.test(w))).toBe(true);

    expect(T("*/10 * 9 * * *").triggers).toHaveLength(6);
  });

  it("分钟级整段等差一个触发器就够", () => {
    const r = T("0 */1 * * * *");
    expect(r.triggers).toHaveLength(1);
    expect(r.triggers[0].repetition.duration).toBe("PT23H59M");
  });

  it.each([
    ["每秒一次", "* * * * * *", /超出/],
    ["每 5 秒", "*/5 * * * * *", /超出/],
  ])("%s 超出可转换上限时明确拒绝", (_name, expr, re) => {
    const r = cronToTriggers(parseCron(expr), { startDate: "2026-10-20" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(re);
  });
});

describe("时刻分组（笛卡尔积分解）", () => {
  it("等间隔压成一组，间隔不足 1 分钟的不合并", () => {
    expect(G(Array.from({ length: 288 }, (_, i) => i * 300))).toEqual(["00:00:00/300/288"]);
    expect(G([32400])).toEqual(["09:00:00/0/1"]);
    expect(G([0, 30, 60])).toEqual(["00:00:00/60/2", "00:00:30/0/1"]);
  });

  it("用户报的 bug：分 0,1,3 × 时 7,9 必须按小时分块，不能缝成怪链", () => {
    const times = [7 * 3600, 7 * 3600 + 60, 7 * 3600 + 180, 9 * 3600, 9 * 3600 + 60, 9 * 3600 + 180];
    expect(G(times)).toEqual([
      "07:00:00/60/2",
      "07:03:00/0/1",
      "09:00:00/60/2",
      "09:03:00/0/1",
    ]);
    expect(coverTimes(times).plan).toBe("按小时分块");
  });

  it("用户报的 bug：分 0,3,32 × 时 1,9 切 4 组", () => {
    expect(G([3600, 3600 + 180, 3600 + 1920, 9 * 3600, 9 * 3600 + 180, 9 * 3600 + 1920])).toEqual([
      "01:00:00/180/2",
      "01:32:00/0/1",
      "09:00:00/180/2",
      "09:32:00/0/1",
    ]);
  });

  it("跨小时合并只在明显更省时才启用，且从不跨天", () => {
    expect(G([3600, 9 * 3600])).toEqual(["01:00:00/28800/2"]);
    expect(coverTimes([3600, 9 * 3600]).plan).toBe("整段等差");
    expect(G([0, 8 * 3600, 16 * 3600])).toEqual(["00:00:00/28800/3"]);
    expect(G([23 * 3600, 3600])).toEqual(["01:00:00/79200/2"]);
  });

  it("分组必覆盖全部时刻，不多不少", () => {
    expect(coverTimes([0, 60, 3600, 3660]).groups.reduce((n, g) => n + g.count, 0)).toBe(4);
  });
});

describe("初始状态与必填", () => {
  it("七个维度一个都不预设（以前默认全选，会批量造出每天每月每周的触发器）", () => {
    const init = initialCronFields();
    const lenOf = (key) => valuesOf(init[key], FDS[key]).length;
    expect(["sec", "mi", "h", "dom", "mon", "dow", "year"].map(lenOf)).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ]);

    const r = cronToTriggers(init, { startDate: "2026-10-20" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/秒、分、时、日、月、周/);
  });

  it("年不在必填里：不勾年也能转，年只用来定起始日期", () => {
    const f = initialCronFields();
    Object.assign(f, {
      sec: { values: [0], step: null },
      mi: { values: [30], step: null },
      h: { values: [9], step: null },
      dom: { values: [15], step: null },
      mon: { values: [3], step: null },
      dow: { values: [0, 1, 2, 3, 4, 5, 6], step: null },
    });
    const r = cronToTriggers(f, { startDate: "2026-10-20" });
    expect(r.ok).toBe(true);
    expect(r.triggers[0].start).toMatch(/^2026-10-20/);
  });

  it("分钟没选值时拒绝转换，不返回空触发器列表", () => {
    const f = { ...initialCronFields(), mi: { values: [], step: null }, h: { values: [9], step: null } };
    expect(cronToTriggers(f, { startDate: "2026-10-20" }).ok).toBe(false);
  });
});

describe("范围与步长内聚", () => {
  const picked = (fd, form) => valuesOf(pickField(fd, form), fd);

  it("每 N = 1 就是连续范围，上界取满就是步长，两者还能结合", () => {
    expect(picked(FDS.h, { from: 9, to: 17, every: 1 })).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(picked(FDS.mi, { from: 0, to: 59, every: 5 })).toEqual([
      0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55,
    ]);
    expect(picked(FDS.h, { from: 9, to: 17, every: 2 })).toEqual([9, 11, 13, 15, 17]);
  });

  it("最后一个值不落在上界上也不补齐", () => {
    expect(picked(FDS.mi, { from: 0, to: 14, every: 5 })).toEqual([0, 5, 10]);
  });

  it("越界 / 反序 / 非法步长都在 pickField 里收敛", () => {
    expect(pickField(FDS.mi, { from: -5, to: 999, every: 5 }).step).toEqual({
      from: 0,
      to: 59,
      every: 5,
    });
    expect(pickField(FDS.dom, { from: 20, to: 5, every: 1 }).step).toEqual({
      from: 5,
      to: 20,
      every: 1,
    });
    expect(pickField(FDS.mi, { from: 0, to: 59, every: 0 }).step.every).toBe(1);
    expect(pickField(FDS.mi, { from: 0, to: 59, every: -3 }).step.every).toBe(1);
    expect(pickField(FDS.dom, {}).step).toEqual({ from: 1, to: 31, every: 1 });
  });

  it("计数与实选一致", () => {
    expect(pickCount(FDS.h, { from: 9, to: 17, every: 2 })).toBe(
      picked(FDS.h, { from: 9, to: 17, every: 2 }).length
    );
    expect(pickCount(FDS.mi, { from: 0, to: 59, every: 5 })).toBe(12);
  });

  it("回写：带边界的步进必须写出边界，否则读回来就对不上", () => {
    const hPart = (pick) => formatCron({ ...initialCronFields(), h: pickField(FDS.h, pick) }).split(" ")[2];
    expect(hPart({ from: 0, to: 23, every: 5 })).toBe("*/5");
    expect(hPart({ from: 9, to: 17, every: 2 })).toBe("9-17/2");
    expect(hPart({ from: 10, to: 23, every: 2 })).toBe("10/2");
    expect(hPart({ from: 9, to: 17, every: 1 })).toBe("9-17");
  });

  it("往返：写出去再读回来，选中的值一个不差", () => {
    const roundTrip = (pick) => {
      const expr = formatCron({ ...initialCronFields(), h: pickField(FDS.h, pick) });
      return valuesOf(parseCron(expr).h, FDS.h);
    };
    expect(roundTrip({ from: 9, to: 17, every: 2 })).toEqual([9, 11, 13, 15, 17]);
    expect(roundTrip({ from: 0, to: 23, every: 5 })).toEqual([0, 5, 10, 15, 20]);
  });

  it("摘要：有边界时不能写成 *，那会让人以为整段都选了", () => {
    expect(fieldSummary(pickField(FDS.mi, { from: 0, to: 59, every: 5 }), FDS.mi)).toBe("每 5分");
    expect(fieldSummary(pickField(FDS.h, { from: 9, to: 17, every: 2 }), FDS.h)).toBe("9-17/2");
    expect(fieldSummary(pickField(FDS.h, { from: 9, to: 17, every: 1 }), FDS.h)).toBe("9-17");
  });
});
