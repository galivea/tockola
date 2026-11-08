// 窗口几何的落地规则（src/lib/windowState.js）
//
// 这里最要紧的一条是「别把窗口存没了」。Windows 把最小化的窗口停在
// (-32000, -32000)，outerPosition() 会原样报出来；照单写进文件，下次启动窗口
// 就在屏幕外，点哪儿都找不回来——而且没有任何报错。恢复时的夹紧规则必须钉死。

import { describe, it, expect } from "vitest";
import { sanitize } from "../../../src/lib/windowState.js";

describe("窗口几何的落地规则", () => {
  it("正常尺寸与位置原样保留", () => {
    expect(sanitize({ width: 1240, height: 780, x: 120, y: 60 })).toEqual({
      width: 1240,
      height: 780,
      x: 120,
      y: 60,
      maximized: false,
    });
  });

  it("最小化时 Windows 报的 (-32000, -32000) 不当坐标：只留尺寸，位置丢弃", () => {
    const out = sanitize({ width: 800, height: 560, x: -32000, y: -32000 });
    expect(out.width).toBe(800);
    expect(out.height).toBe(560);
    expect(out.x).toBeNull();
    expect(out.y).toBeNull();
  });

  // 多显示器允许负坐标，但只到一台显示器的宽度那么多
  it("负坐标仍可用，超出显示器范围的才丢", () => {
    expect(sanitize({ width: 1240, height: 780, x: -1200, y: 80 }).x).toBe(-1200);
    expect(sanitize({ width: 1240, height: 780, x: -20000, y: 80 }).x).toBeNull();
  });

  it("缺尺寸视为没有可恢复的几何，缺位置只是位置为空", () => {
    expect(sanitize({ x: 10, y: 10 })).toBeNull();
    expect(sanitize({ width: 1240, height: 780 }).x).toBeNull();
    expect(sanitize({ width: "wide", height: 780 })).toBeNull();
  });

  it("过小的尺寸夹回下限，最大化标记单独保留", () => {
    expect(sanitize({ width: 300, height: 200 }).width).toBe(800);
    expect(sanitize({ width: 300, height: 200 }).height).toBe(560);
    expect(sanitize({ width: 1240, height: 780, maximized: true }).maximized).toBe(true);
  });
});
