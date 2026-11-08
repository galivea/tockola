// 任务配置：保存前的必填校验 + 新建时的默认值。
//
// 默认值这一组是拿 Windows 引擎的出厂值逐项对齐的（用 COM 建一个空任务定义
// 导出 XML 实测得到）。界面上替用户预设任何一个业务值，都会在用户没注意到的
// 地方改变任务行为 —— 所以这些值不是「随便定的初始值」，是契约。

import { describe, it, expect } from "vitest";
import { defaultConfig, defaultTrigger, validateForSave } from "../../../src/lib/config.js";

const ALL_SECTIONS = ["identity", "triggers", "actions", "settings", "principal"];
const BASIC_SECTIONS = ["identity"];
const RUNTIME_SECTIONS = ["triggers", "actions", "settings", "principal"];
const ACT = { type: "exec", commandLine: "notepad.exe" };
const val = (cfg, sections = ALL_SECTIONS) => validateForSave(cfg, sections);

describe("保存前必填校验", () => {
  it("没有触发器的任务永远不会自动跑，必须拦住", () => {
    expect(val({ ...defaultConfig(), triggers: [], actions: [ACT] }).section).toBe("triggers");
    expect(val({ ...defaultConfig(), triggers: [defaultTrigger("daily")], actions: [ACT] })).toBeNull();
  });

  it("缺动作的任务跑起来什么也不做，也要拦住", () => {
    const cfg = { ...defaultConfig(), triggers: [defaultTrigger("daily")] };
    expect(val({ ...cfg, actions: [{ type: "exec", commandLine: "  " }] }).section).toBe("actions");
    expect(val({ ...cfg, actions: [] }).section).toBe("actions");
  });

  it("两条都缺时按界面分区顺序先报触发器", () => {
    expect(val({ ...defaultConfig(), triggers: [], actions: [] }).section).toBe("triggers");
  });

  it("COM 处理器与未知类型不能在界面上编辑，但只要存在就当作有效动作", () => {
    const cfg = { ...defaultConfig(), triggers: [defaultTrigger("daily")] };
    expect(val({ ...cfg, actions: [{ type: "com", classId: "{CLSID}" }] })).toBeNull();
    expect(val({ ...cfg, actions: [{ type: "unknown" }] })).toBeNull();
  });

  it("只改基本设置时，不该因为另一页的触发器没读完就存不回去", () => {
    const cfg = { ...defaultConfig(), triggers: [] };
    expect(val(cfg, BASIC_SECTIONS)).toBeNull();
    expect(val(cfg, RUNTIME_SECTIONS).section).toBe("triggers");
    expect(val(null)?.section).toBe("triggers");
  });
});

describe("新建默认值与 Windows 引擎一致", () => {
  const D = defaultConfig();

  it("<Settings> 逐项对齐引擎出厂值", () => {
    // 引擎写 PT72H，前端用 P3D，等价；这两处改动时测试必须跟着改，不能只改一处
    expect(D.settings).toMatchObject({
      enabled: true,
      allowStartOnDemand: true,
      allowHardTerminate: true,
      startWhenAvailable: false,
      runOnlyIfIdle: false,
      waitTimeout: "PT1H",
      idleDuration: "PT10M",
      stopOnIdleEnd: true,
      restartOnIdle: false,
      disallowStartIfOnBatteries: true,
      stopIfGoingOnBatteries: true,
      wakeToRun: false,
      runOnlyIfNetworkAvailable: false,
      executionTimeLimit: "P3D",
      multipleInstancesPolicy: "IgnoreNew",
      restartCount: 0,
      restartInterval: "PT0S",
      deleteExpiredTaskAfter: "PT0S",
      hidden: false,
      priority: 7,
      useUnifiedSchedulingEngine: false,
      volatile: false,
      maintenanceEnabled: false,
      maintenancePeriod: "PT0S",
      maintenanceDeadline: "PT0S",
    });
  });

  it("<Principal> 出厂值：当前用户、仅登录时运行、不提权", () => {
    expect(D.principal).toMatchObject({
      userId: "",
      logonType: "InteractiveToken",
      runLevel: "LeastPrivilege",
    });
  });

  it("注册信息与两个列表都是空的，由用户自己填", () => {
    expect(D.registration).toMatchObject({ author: "", securityDescriptor: "" });
    expect(D.triggers).toEqual([]);
    expect(D.actions).toEqual([]);
  });

  it("触发器起始时间是「此刻」，不替用户预设业务时间", () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const TR = defaultTrigger("daily");

    expect(String(TR.start).slice(0, 10)).toBe(
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    );
    expect(String(TR.start).slice(11, 13)).toBe(pad(now.getHours()));
    expect(TR.end).toBe("");
    expect(TR.randomDelay).toBe("PT0S");
    expect(TR.repetition.interval).toBe("PT0S");
  });

  it("weekly / monthly 的必填项要有默认值，空值注册会报格式不正确", () => {
    expect(defaultTrigger("weekly").daysOfWeek.length).toBeGreaterThan(0);
    expect(defaultTrigger("monthly").daysOfMonth.length).toBeGreaterThan(0);
    expect(defaultTrigger("monthly").months).toHaveLength(12);
    expect(defaultTrigger("monthlyDow").monthWeek).toBe(1);
  });
});
