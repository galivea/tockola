// 时长换算：界面上是「数字 + 单位」两格，存进 XML 是 ISO 8601（PT1H30M）。
// Windows 对几项时长有硬边界（最短 1 分钟、最长 31 天），越界注册会失败，
// 所以收敛规则本身就是被测行为，不是防御性代码。

import { describe, it, expect } from "vitest";
import {
  parseIso,
  formatIso,
  humanize,
  fromSeconds,
  isoFromSeconds,
  toSeconds,
  bestUnit,
  splitValue,
  compose,
  clampSeconds,
  rangeText,
  LIMITS,
} from "../../../src/lib/duration.js";

const round = (t) => formatIso(parseIso(t));

describe("ISO 8601 解析", () => {
  it("常见形态原样往返", () => {
    expect(round("PT1H30M")).toBe("PT1H30M");
    expect(round("PT45S")).toBe("PT45S");
    expect(round("P1D")).toBe("P1D");
    expect(round("P1DT2H")).toBe("P1DT2H");
    expect(round("P1Y2M3DT4H5M6S")).toBe("P1Y2M3DT4H5M6S");
  });

  it("P1M 是 1 个月不是 1 分钟", () => {
    expect(formatIso(parseIso("P1M"))).toBe("P1M");
  });

  it("认不出来返回 null，不返回默认值", () => {
    expect(parseIso("abc")).toBeNull();
  });

  it("PT0S 解析为全 0 而不是空对象", () => {
    expect(parseIso("PT0S")).toEqual({ y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0 });
  });
});

describe("秒与 ISO 互转", () => {
  it("秒转 ISO，负数当 0", () => {
    expect(isoFromSeconds(90)).toBe("PT1M30S");
    expect(isoFromSeconds(60)).toBe("PT1M");
    expect(isoFromSeconds(5400)).toBe("PT1H30M");
    expect(isoFromSeconds(86400)).toBe("P1D");
    expect(isoFromSeconds(259200)).toBe("P3D");
    expect(isoFromSeconds(0)).toBe("PT0S");
    expect(isoFromSeconds(-5)).toBe("PT0S");
  });

  it("秒拆成分量", () => {
    expect(fromSeconds(90)).toEqual({ y: 0, mo: 0, d: 0, h: 0, mi: 1, s: 30 });
  });

  it("ISO 转秒：月按 30 天、年按 365 天折算", () => {
    expect(toSeconds("PT1H30M")).toBe(5400);
    expect(toSeconds("P1D")).toBe(86400);
    expect(isoFromSeconds(toSeconds("P1M"))).toBe("P30D");
    expect(isoFromSeconds(toSeconds("P1Y"))).toBe("P365D");
  });
});

describe("单位挑选（数字 + 单位两格怎么显示）", () => {
  it("按大小挑最合适的单位", () => {
    expect(splitValue("PT1M30S")).toEqual({ num: 90, unit: "s" });
    expect(splitValue("PT1H30M")).toEqual({ num: 90, unit: "mi" });
    expect(splitValue("PT2H")).toEqual({ num: 2, unit: "h" });
    expect(splitValue("P3D")).toEqual({ num: 3, unit: "d" });
    expect(splitValue("PT0S")).toEqual({ num: 0, unit: "s" });
  });

  it("限定了可用单位时按限定显示，哪怕取整会损失精度", () => {
    expect(splitValue("P3D", ["d"])).toEqual({ num: 3, unit: "d" });
    expect(bestUnit(21600, ["d"])).toBe("d");
  });

  it("数字 + 单位合成 ISO", () => {
    expect(compose(90, "mi")).toBe("PT1H30M");
    expect(compose(2, "d")).toBe("P2D");
  });
});

describe("范围收敛（Windows 实测边界）", () => {
  const ri = [LIMITS.repeatInterval.min, LIMITS.repeatInterval.max];
  const rd = [LIMITS.randomDelay.min, LIMITS.randomDelay.max];
  const el = [LIMITS.executionTimeLimit.min, LIMITS.executionTimeLimit.max];
  const iso = (s, r) => isoFromSeconds(clampSeconds(s, r[0], r[1]));

  it("重复间隔收敛到 1 分钟 ~ 31 天", () => {
    expect(iso(45, ri)).toBe("PT1M");
    expect(iso(90, ri)).toBe("PT1M30S");
    expect(iso(32 * 86400, ri)).toBe("P31D");
    expect(iso(31 * 86400, ri)).toBe("P31D");
  });

  it("随机延迟收敛到 1 秒 ~ 31 天", () => {
    expect(iso(1, rd)).toBe("PT1S");
    expect(iso(32 * 86400, rd)).toBe("P31D");
  });

  it("执行超时不设上界（PT0S 表示不限时，不能把它收敛掉）", () => {
    expect(iso(4000 * 86400, el)).toBe("P4000D");
    expect(clampSeconds(0, 60, 2678400)).toBe(0);
  });

  it("范围文案跟随语言包", () => {
    expect(rangeText(60, 31 * 86400)).toBe("1分 ~ 31天");
    expect(rangeText(1, null)).toBe("1秒 起");
  });
});

describe("人话展示", () => {
  it("按中文习惯连写，并先归一化到标准单位", () => {
    expect(humanize("PT1H30M")).toBe("1小时30分");
    expect(humanize("PT45S")).toBe("45秒");
    expect(humanize("P1D")).toBe("1天");
    expect(humanize("PT0S")).toBe("0");
    expect(humanize("PT90M")).toBe("1小时30分");
  });
});
