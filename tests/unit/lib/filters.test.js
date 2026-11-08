// 界面状态持久化（src/lib/filters.js）
//
// 左侧任务组的展开状态、勾选状态、滚动位置全靠这里落盘。
// 它一旦静默失效，用户看到的就是「关掉再打开，树又变回默认样」——
// 而且没有任何报错，所以必须用测试把两条通道都钉死。

import { describe, it, expect, vi } from "vitest";
import {
  defaultFilters,
  normalizeFilters,
  loadFilters,
  saveFilters,
  clearFilters,
  selectionCount,
  isFilterActive,
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_RANGE,
} from "../../../src/lib/filters.js";

const WEB_KEY = "tockola.filters.v3";

describe("默认值与归一化", () => {
  it("默认状态是空筛选且根任务组展开", () => {
    const f = defaultFilters();
    expect(f.name).toBe("");
    expect(f.enabled).toBe("all");
    expect(f.selection).toEqual({ groups: [], tasks: [] });
    expect(f.expanded).toEqual(["\\"]);
    expect(f.treeScroll).toBe(0);
  });

  it("归一化会补齐缺失字段，不会因为旧数据少一个键就崩", () => {
    expect(normalizeFilters(null).expanded).toEqual(["\\"]);
    expect(normalizeFilters({}).selection).toEqual({ groups: [], tasks: [] });
    expect(normalizeFilters({ name: 123 }).name).toBe("");
    expect(normalizeFilters({ enabled: "weird" }).enabled).toBe("all");
  });

  it("勾选的任务项缺少 name 时整条丢弃，不留下半截对象", () => {
    const out = normalizeFilters({
      selection: { groups: ["\\a\\"], tasks: [{ path: "\\a\\" }, { name: "x", path: "\\a\\" }] },
    });
    expect(out.selection.tasks).toEqual([{ path: "\\a\\", name: "x" }]);
  });

  it("负数或非数字的滚动位置归零", () => {
    expect(normalizeFilters({ treeScroll: -5 }).treeScroll).toBe(0);
    expect(normalizeFilters({ treeScroll: "abc" }).treeScroll).toBe(0);
    expect(normalizeFilters({ treeScroll: 120 }).treeScroll).toBe(120);
  });
});

describe("布局偏好的落地规则", () => {
  it("左栏宽度越界夹紧，非法值与 0 回默认", () => {
    expect(normalizeFilters({ sidebarWidth: 8 }).sidebarWidth).toBe(SIDEBAR_RANGE[0]);
    expect(normalizeFilters({ sidebarWidth: 4000 }).sidebarWidth).toBe(SIDEBAR_RANGE[1]);
    expect(normalizeFilters({ sidebarWidth: "wide" }).sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(normalizeFilters({ sidebarWidth: 0 }).sidebarWidth).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  // 「重置」按钮的文案说的是清空查询条件。若把用户拖好的宽度一并抹掉，
  // 那条按钮就名不副实了。
  it("布局偏好不算查询条件，不影响「条件已生效」的判定", () => {
    const f = { ...defaultFilters(), sidebarWidth: 400 };
    expect(isFilterActive(f)).toBe(false);
    expect(isFilterActive({ ...f, name: "备份" })).toBe(true);
  });
});

describe("Web 存储通道（浏览器演示模式的实际路径）", () => {
  it("存了再读，任务组的展开与勾选原样回来", async () => {
    const state = {
      ...defaultFilters(),
      expanded: ["\\", "\\维护\\", "\\维护\\日志\\"],
      selection: { groups: ["\\维护\\"], tasks: [{ path: "\\维护\\", name: "备份" }] },
      treeScroll: 240,
    };

    await saveFilters(state);
    const back = await loadFilters();

    expect(back.expanded).toEqual(["\\", "\\维护\\", "\\维护\\日志\\"]);
    expect(back.selection.groups).toEqual(["\\维护\\"]);
    expect(back.selection.tasks).toEqual([{ path: "\\维护\\", name: "备份" }]);
    expect(back.treeScroll).toBe(240);
  });

  it("反复修改不会把之前存的状态冲掉", async () => {
    await saveFilters({ ...defaultFilters(), name: "备份" });
    await saveFilters({ ...defaultFilters(), name: "备份", expanded: ["\\", "\\x\\"] });
    const back = await loadFilters();
    expect(back.name).toBe("备份");
    expect(back.expanded).toEqual(["\\", "\\x\\"]);
  });

  it("改名前的旧 key 会被一次性迁移，已有布局不丢", async () => {
    localStorage.clear();
    localStorage.setItem(
      "rhyzal.filters.v3",
      JSON.stringify({ ...defaultFilters(), sidebarWidth: 333, expanded: ["\\", "\\旧\\"] })
    );

    const back = await loadFilters();
    expect(back.sidebarWidth).toBe(333);
    expect(back.expanded).toEqual(["\\", "\\旧\\"]);
    expect(localStorage.getItem(WEB_KEY)).not.toBeNull();
    expect(localStorage.getItem("rhyzal.filters.v3")).toBeNull();
  });

  it("新 key 已存在时旧 key 不再生效", async () => {
    localStorage.clear();
    localStorage.setItem(WEB_KEY, JSON.stringify({ ...defaultFilters(), sidebarWidth: 410 }));
    localStorage.setItem(
      "rhyzal.filters.v3",
      JSON.stringify({ ...defaultFilters(), sidebarWidth: 190 })
    );

    expect((await loadFilters()).sidebarWidth).toBe(410);
  });

  it("存储里是坏数据时回落到默认值，而不是抛错", async () => {
    localStorage.setItem(WEB_KEY, "{ 这不是 JSON");
    await expect(loadFilters()).resolves.toEqual(defaultFilters());
  });

  it("清空之后读回默认值", async () => {
    await saveFilters({ ...defaultFilters(), name: "x", expanded: ["\\", "\\y\\"] });
    await clearFilters();
    expect(await loadFilters()).toEqual(defaultFilters());
  });
});

describe("Tauri 通道（走 tauri-plugin-store 文件）", () => {
  // isTauri 在 api.js 被 import 时就定型了，所以必须重置模块再补上全局标记
  async function withTauri(fn) {
    vi.resetModules();
    const mem = new Map();
    const store = {
      get: vi.fn(async (k) => (mem.has(k) ? mem.get(k) : undefined)),
      set: vi.fn(async (k, v) => void mem.set(k, v)),
      delete: vi.fn(async (k) => void mem.delete(k)),
    };
    vi.doMock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => store) }));
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn() });

    const mod = await import("../../../src/lib/filters.js");
    try {
      await fn(mod, store, mem);
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock("@tauri-apps/plugin-store");
      vi.resetModules();
    }
  }

  it("写进 store 文件，不落到 Web 存储", async () => {
    await withTauri(async ({ saveFilters: save }, store) => {
      await save({ ...defaultFilters(), expanded: ["\\", "\\a\\"], treeScroll: 88 });
      expect(store.set).toHaveBeenCalled();
      expect(localStorage.getItem(WEB_KEY)).toBeNull();
    });
  });

  it("store 里的状态能原样读回", async () => {
    await withTauri(async ({ saveFilters: save, loadFilters: load }) => {
      const state = {
        ...defaultFilters(),
        expanded: ["\\", "\\维护\\"],
        selection: { groups: ["\\维护\\"], tasks: [] },
        treeScroll: 512,
      };
      await save(state);
      const back = await load();
      expect(back.expanded).toEqual(["\\", "\\维护\\"]);
      expect(back.selection.groups).toEqual(["\\维护\\"]);
      expect(back.treeScroll).toBe(512);
    });
  });

  it("store 插件不可用时回落到 Web 存储，不让界面起不来", async () => {
    vi.resetModules();
    vi.doMock("@tauri-apps/plugin-store", () => ({
      load: vi.fn(async () => {
        throw new Error("插件没注册");
      }),
    }));
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn() });
    try {
      const { saveFilters: save, loadFilters: load } = await import("../../../src/lib/filters.js");
      await save({ ...defaultFilters(), expanded: ["\\", "\\回落\\"] });
      expect((await load()).expanded).toEqual(["\\", "\\回落\\"]);
    } finally {
      vi.unstubAllGlobals();
      vi.doUnmock("@tauri-apps/plugin-store");
      vi.resetModules();
    }
  });
});

describe("派生判断", () => {
  it("勾选数量按任务组与任务分别计", () => {
    expect(selectionCount(defaultFilters())).toBe(0);
    expect(selectionCount({ selection: { groups: ["\\a\\"], tasks: [{ name: "x" }] } })).toBe(2);
    expect(selectionCount({})).toBe(0);
  });

  it("任一条件非空即视为筛选生效", () => {
    expect(isFilterActive(defaultFilters())).toBe(false);
    expect(isFilterActive({ ...defaultFilters(), name: "备份" })).toBe(true);
    expect(isFilterActive({ ...defaultFilters(), enabled: "disabled" })).toBe(true);
    expect(isFilterActive({ ...defaultFilters(), selection: { groups: ["\\a\\"], tasks: [] } })).toBe(
      true
    );
  });
});
