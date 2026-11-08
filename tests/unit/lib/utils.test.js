// 执行时间的显示格式化。
// 时刻本身由 Windows 引擎算（src-tauri/src/runtimes.rs，cargo test 覆盖），
// 前端只负责把引擎返回的字符串显示出来，这里测的就是这一层。

import { describe, it, expect } from "vitest";
import { formatStamp, parseStamp, formatRelative } from "../../../src/lib/utils.js";

describe("时间戳解析", () => {
  it("引擎返回的样式能解析回来，缺秒也能", () => {
    const want = new Date(2026, 0, 2, 9, 0, 0).getTime();
    expect(parseStamp("2026-01-02 09:00:00")).toBe(want);
    expect(parseStamp("2026-01-02 09:00")).toBe(want);
  });

  it("解析不了返回 NaN，不 fallback 成当前时间", () => {
    expect(Number.isNaN(parseStamp("不是时间"))).toBe(true);
  });
});

describe("时间戳格式化", () => {
  it("格式化与解析能来回转换", () => {
    const t = new Date(2026, 0, 1, 0, 0, 0).getTime();
    expect(formatStamp(new Date(2026, 0, 2, 9, 5, 3).getTime())).toBe("2026-01-02 09:05:03");
    expect(parseStamp(formatStamp(t))).toBe(t);
  });
});

describe("相对时间", () => {
  it("按中文习惯描述，过期的说过期不说负数", () => {
    const base = new Date(2026, 0, 1, 0, 0, 0).getTime();
    expect(formatRelative(new Date(2026, 0, 1, 3, 0, 0).getTime(), base)).toBe("3 小时");
    expect(formatRelative(base - 60000, base)).toBe("已过期");
  });
});
