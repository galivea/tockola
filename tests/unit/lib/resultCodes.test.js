// 运行结果码与历史事件文案：列表「上次运行结果」列与历史抽屉共用。
//
// 「上次运行结果」的取值来自 Windows 的 LastTaskResult；负数是 HRESULT，
// 必须按无符号解释，否则 0x80042501 会显示成 -0x7...。历史事件文案（任务类别）
// 主取值是后端从系统取到的显示名，这张表只在拿不到时兜底 —— 表里的每条都是
// 本机实测的 TaskDisplayName，改错了这里会先炸。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  formatResult,
  formatEventText,
  formatLevel,
} from "../../../src/lib/resultCodes.js";
import { bindLocale } from "../../../src/lib/i18n/index.js";

beforeAll(() => bindLocale(() => "zh"));

describe("运行结果码", () => {
  it("0 与 267011 / 267009 是系统约定的几个非错误码", () => {
    expect([formatResult(0).text, formatResult(0).kind]).toEqual(["成功", "ok"]);
    expect(formatResult(267011).text).toBe("从未运行");
    expect(formatResult(267009).kind).toBe("run");
  });

  it("已知的 HRESULT 给中文，未收录的按无符号转十六进制", () => {
    expect(formatResult(-2147024891).text).toBe("拒绝访问");
    // -2147212031 的无符号形式是 0x80042501
    expect(formatResult(-2147212031).text).toBe("0x80042501");
    expect(formatResult(-2147212031).tip).toContain("0x80042501");
    expect([formatResult(65537).text, formatResult(65537).kind]).toEqual(["0x10001", "err"]);
  });

  it("空值（还没跑过）不算失败", () => {
    expect(formatResult("").kind).toBe("none");
  });
});

describe("历史事件文案（回落表）", () => {
  it("与系统实测的 TaskDisplayName 一致", () => {
    expect(formatEventText(100)).toBe("任务已启动");
    expect(formatEventText(101)).toBe("任务启动失败");
    expect(formatEventText(102)).toBe("任务已完成");
    expect(formatEventText(140)).toBe("任务注册已更新");
    expect(formatEventText(141)).toBe("任务注册已删除");
    expect(formatEventText(142)).toBe("任务已禁用");
    expect(formatEventText(153)).toBe("已拒绝错过的任务启动");
  });

  it("200/201 是「操作」不是「动作」，认不出的 ID 不猜", () => {
    expect([formatEventText(200), formatEventText(201)]).toEqual(["操作已启动", "操作已完成"]);
    expect(formatEventText(203)).toBe("操作无法启动");
    expect(formatEventText(999)).toBe("事件 #999");
  });
});

describe("历史级别", () => {
  it("跟原生四档对齐，kind 用于着色", () => {
    expect(formatLevel("info").text).toBe("信息");
    expect(formatLevel("warning").text).toBe("警告");
    expect(formatLevel("error").text).toBe("错误");
    expect(formatLevel("critical").text).toBe("关键");
    expect(formatLevel("error").kind).toBe("error");
  });

  it("认不出的级别退回信息，不显示空", () => {
    expect(formatLevel("whatever").text).toBe("信息");
  });
});

describe("英文包下同一批取值", () => {
  beforeAll(() => bindLocale(() => "en"));
  afterAll(() => bindLocale(() => "zh"));

  it("返回码与事件文案都是英文", () => {
    expect(formatResult(0).text).toBe("Success");
    expect(formatResult(267011).text).toBe("Never run");
    expect(formatResult(-2147024891).text).toBe("Access denied");
    expect(formatEventText(100)).toBe("Task started");
    expect(formatEventText(140)).toBe("Task registration updated");
    expect(formatEventText(999)).toBe("Event #999");
  });

  it("级别也是英文", () => {
    expect(formatLevel("info").text).toBe("Information");
    expect(formatLevel("critical").text).toBe("Critical");
  });
});
