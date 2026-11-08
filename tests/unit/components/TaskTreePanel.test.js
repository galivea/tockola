// 左侧任务组树的组件测试
//
// 树的状态（展开哪些组、勾选哪些组、滚动到哪）由父层持久化后作为 props 传进来。
// 组件这层如果没正确消费 props，用户看到的就是「关掉再打开，树又变回默认样」——
// 所以这里直接挂载组件，断言它确实按 props 渲染。

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import TaskTreePanel from "../../../src/components/TaskTreePanel.svelte";

function tree() {
  return {
    path: "\\",
    name: "根",
    children: [
      {
        path: "\\维护\\",
        name: "维护",
        children: [],
        tasks: [{ path: "\\维护\\", name: "每日备份" }],
      },
      {
        path: "\\报表\\",
        name: "报表",
        children: [],
        tasks: [{ path: "\\报表\\", name: "月度汇总" }],
      },
    ],
    tasks: [],
  };
}

function mountPanel(overrides = {}) {
  const props = {
    tree: tree(),
    selection: { groups: [], tasks: [] },
    expanded: ["\\"],
    scrollTop: 0,
    onToggleExpand: vi.fn(),
    onToggleGroup: vi.fn(),
    onToggleTask: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    onScrollChange: vi.fn(),
    ...overrides,
  };
  const utils = render(TaskTreePanel, { props });
  return { ...utils, props };
}

const cbFor = (path) =>
  screen.getAllByTestId("tree-group-cb").find((el) => el.dataset.path === path);

describe("展开状态由 props 决定", () => {
  it("展开集合里的任务组会显示其下的任务", () => {
    mountPanel({ expanded: ["\\", "\\维护\\"] });
    expect(screen.getByText("每日备份")).toBeTruthy();
  });

  it("不在展开集合里的任务组，其下的任务不渲染", () => {
    mountPanel({ expanded: ["\\", "\\维护\\"] });
    expect(screen.queryByText("月度汇总")).toBeNull();
  });

  it("点折叠手柄会把该组路径回传给父层去持久化", async () => {
    const { props } = mountPanel({ expanded: ["\\", "\\维护\\"] });
    const groups = screen.getAllByTestId("tree-group");
    const target = groups.find((el) => el.dataset.path === "\\维护\\");

    // 折叠手柄是这一行里的 .twist 按钮（aria-label 随界面语言变化，这里按结构取）
    const row = target.closest(".row");
    const twist = row.querySelector(".twist");
    twist.click();
    await Promise.resolve();

    expect(props.onToggleExpand).toHaveBeenCalledWith("\\维护\\");
  });
});

describe("勾选状态由 props 决定", () => {
  it("整组全勾时复选框为选中", () => {
    mountPanel({
      expanded: ["\\", "\\维护\\"],
      selection: {
        groups: ["\\维护\\"],
        tasks: [{ path: "\\维护\\", name: "每日备份" }],
      },
    });
    expect(cbFor("\\维护\\").checked).toBe(true);
  });

  it("只勾了一部分任务时复选框为半选", () => {
    // \维护\ 下有任务但一个都没勾 -> 未选；这里用子组场景造半选：
    // 直接勾选子任务而不勾父组，父组应呈现 indeterminate
    const t = tree();
    t.children[0] = {
      path: "\\维护\\",
      name: "维护",
      children: [{ path: "\\维护\\子\\", name: "子", children: [], tasks: [{ path: "\\维护\\子\\", name: "子任务" }] }],
      tasks: [],
    };
    mountPanel({
      tree: t,
      expanded: ["\\", "\\维护\\", "\\维护\\子\\"],
      selection: { groups: [], tasks: [{ path: "\\维护\\子\\", name: "子任务" }] },
    });
    expect(cbFor("\\维护\\").checked).toBe(false);
    expect(cbFor("\\维护\\").indeterminate).toBe(true);
  });

  it("未勾选任何东西时复选框为空", () => {
    mountPanel({ expanded: ["\\"] });
    expect(cbFor("\\维护\\").checked).toBe(false);
    expect(cbFor("\\维护\\").indeterminate).toBe(false);
  });

  it("点组名会带着整棵子树回传给父层", async () => {
    const { props } = mountPanel({
      expanded: ["\\", "\\维护\\"],
    });
    const target = screen
      .getAllByTestId("tree-group")
      .find((el) => el.dataset.path === "\\维护\\");
    target.click();
    await Promise.resolve();

    expect(props.onToggleGroup).toHaveBeenCalled();
    const [path, next, subPaths] = props.onToggleGroup.mock.calls[0];
    expect(path).toBe("\\维护\\");
    expect(next).toBe(true);
    expect(subPaths).toContain("\\维护\\");
  });
});

describe("勾选计数副标题", () => {
  it("有勾选时显示已选副标题", () => {
    mountPanel({
      selection: { groups: ["\\维护\\"], tasks: [{ path: "\\报表\\", name: "月度汇总" }] },
    });
    expect(screen.getByTestId("tree-sub")).toBeTruthy();
  });

  it("无勾选时不显示已选副标题", () => {
    mountPanel();
    expect(screen.queryByTestId("tree-sub")).toBeNull();
  });
});

