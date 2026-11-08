// 导入弹窗的组件测试
//
// 导入是「原样抄一份」，不是「编辑后再存」：名称、账户、触发器、操作全都照 XML
// 里的来，弹窗只回显，唯一能改的是落到哪个任务组，以及 XML 里本来就带不了的
// 密码。这几条断言钉的就是「哪些能改、哪些不能改」——一旦有人把名称改回可编辑
// 的输入框，或者又加回一个运行身份输入框，这里会立刻红。
//
// 另外钉住多选：一次选 N 个文件就是 N 条记录，每条各自读自己的 XML。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import ImportTaskDialog from "../../../src/components/ImportTaskDialog.svelte";
import * as api from "../../../src/lib/api.js";

vi.mock("../../../src/lib/api.js", () => ({
  importTaskXml: vi.fn(async (input) => ({ name: input.name })),
}));

const xmlOf = (uri, user = "DOMAIN\\svc", logon = "InteractiveToken") => `<?xml version="1.0"?>
<Task>
  <RegistrationInfo><URI>${uri}</URI></RegistrationInfo>
  <Principals><Principal><UserId>${user}</UserId><LogonType>${logon}</LogonType></Principal></Principals>
</Task>`;

const groupXml = (uri, group = "S-1-5-32-545") => `<?xml version="1.0"?>
<Task>
  <RegistrationInfo><URI>${uri}</URI></RegistrationInfo>
  <Principals><Principal><GroupId>${group}</GroupId></Principal></Principals>
</Task>`;

// jsdom 的 File 不一定带 text()；带上它，读文件这一步才跟浏览器一致。
function file(name, text) {
  const f = new File([text], name, { type: "text/xml" });
  if (typeof f.text !== "function") {
    Object.defineProperty(f, "text", { value: async () => text });
  }
  return f;
}

function mount(overrides = {}) {
  const props = { onClose: vi.fn(), onImported: vi.fn(), ...overrides };
  const utils = render(ImportTaskDialog, { props });
  return { ...utils, props };
}

const items = () => screen.queryAllByTestId("import-item");
const enabled = (el) => !el.hasAttribute("disabled");

/** 走一次文件选择；expectCount 显式给出，被挡掉的文件本来就不该进列表 */
async function choose(files, expectCount = files.length) {
  await fireEvent.change(screen.getByTestId("import-picker"), { target: { files } });
  await vi.waitFor(() => expect(items()).toHaveLength(expectCount));
}

beforeEach(() => {
  const mocked = vi.mocked(api.importTaskXml);
  mocked.mockClear();
  mocked.mockImplementation(async (input) => ({ name: input.name }));
});

describe("一次选多个文件", () => {
  it("每个 XML 各占一条记录，只显示文件名", async () => {
    mount();
    await choose([file("a.xml", xmlOf("\\维护\\每日备份")), file("b.xml", xmlOf("\\报表\\月度汇总"))]);

    expect(screen.getAllByTestId("import-file").map((e) => e.textContent.trim())).toEqual([
      "a.xml",
      "b.xml",
    ]);
    // 列表里除了文件名和移除按钮，没有别的
    expect(screen.queryByTestId("group-tree-select")).toBeNull();
  });

  it("选文件就那一个按钮，不因为选过就换成「继续添加」", async () => {
    mount();
    const label = () => screen.getByTestId("import-picker").parentElement.textContent.trim();
    const before = label();
    await choose([file("a.xml", xmlOf("\\维护\\每日备份"))]);
    expect(label()).toBe(before);
    expect(screen.getAllByTestId("import-picker")).toHaveLength(1);
  });

  it("确认按钮带上条数，一眼看出这一批有几个", async () => {
    mount();
    await choose([file("a.xml", xmlOf("\\a")), file("b.xml", xmlOf("\\b"))]);
    expect(screen.getByTestId("import-confirm").textContent).toContain("2");
  });

  it("不是任务 XML 的文件被挡在列表外，并说清楚挡了哪些", async () => {
    mount();
    await choose([file("a.xml", xmlOf("\\a")), file("note.xml", "hello")], 1);

    // 文案随界面语言变，这里钉的是「被挡掉的文件名确实点了出来」
    expect(screen.getByTestId("import-skipped").textContent).toContain("note.xml");
  });

  it("再选一次同名文件是刷新那条记录，不是堆出第二条", async () => {
    mount();
    await choose([file("a.xml", xmlOf("\\a"))]);
    await choose([file("a.xml", xmlOf("\\a"))], 1);
  });

  it("点 × 把该条从这一批里去掉", async () => {
    mount();
    await choose([file("a.xml", xmlOf("\\a")), file("b.xml", xmlOf("\\b"))]);
    await fireEvent.click(screen.getAllByTestId("import-remove")[0]);
    expect(items()).toHaveLength(1);
    expect(screen.getByTestId("import-file").textContent.trim()).toBe("b.xml");
  });
});

describe("原样导入：只显示文件名，其余照 XML", () => {
  it("不回显任务名、账户，也没有可以改它们的输入框", async () => {
    mount();
    await choose([file("a.xml", xmlOf("\\维护\\每日备份"))]);

    expect(screen.getByTestId("import-file").textContent.trim()).toBe("a.xml");
    expect(screen.queryByTestId("import-name")).toBeNull();
    expect(screen.queryByTestId("import-runas")).toBeNull();
    expect(screen.queryByTestId("import-user")).toBeNull();
  });

  it("名称与账户照 XML 的来：没有 URI 时退回文件名", async () => {
    const { props } = mount();
    await choose([file("每日备份.xml", "<Task><Settings /></Task>")]);
    await fireEvent.click(screen.getByTestId("import-confirm"));

    await vi.waitFor(() => expect(props.onImported).toHaveBeenCalled());
    expect(vi.mocked(api.importTaskXml).mock.calls[0][0].name).toBe("每日备份");
  });

  it("主体是组的 XML，账户原样留空，不拿组 SID 去填", async () => {
    const { props } = mount();
    await choose([file("a.xml", groupXml("\\维护\\每日备份"))]);
    await fireEvent.click(screen.getByTestId("import-confirm"));

    await vi.waitFor(() => expect(props.onImported).toHaveBeenCalled());
    expect(vi.mocked(api.importTaskXml).mock.calls[0][0].user).toBe("");
  });

  it("注册时账户取自 XML，弹窗不提供账户输入", async () => {
    const { props } = mount();
    await choose([file("a.xml", xmlOf("\\维护\\每日备份"))]);
    await fireEvent.click(screen.getByTestId("import-confirm"));

    await vi.waitFor(() => expect(props.onImported).toHaveBeenCalled());
    const sent = vi.mocked(api.importTaskXml).mock.calls[0][0];
    expect(sent.name).toBe("每日备份");
    expect(sent.user).toBe("DOMAIN\\svc");
    expect(sent.password).toBe("");
  });

  it("任务组由 XML 决定：不传 path，落回它原来那个任务组", async () => {
    const { props } = mount();
    await choose([file("a.xml", xmlOf("\\报表\\月度汇总"))]);
    await fireEvent.click(screen.getByTestId("import-confirm"));

    await vi.waitFor(() => expect(props.onImported).toHaveBeenCalled());
    // 后端拿不到 path 就会用 <URI> 里的那个
    expect("path" in vi.mocked(api.importTaskXml).mock.calls[0][0]).toBe(false);
  });
});

describe("逐个注册", () => {
  it("按列表顺序每个文件注册一次，成功的一并回传", async () => {
    const { props } = mount();
    await choose([file("a.xml", xmlOf("\\维护\\每日备份")), file("b.xml", xmlOf("\\报表\\月度汇总"))]);
    await fireEvent.click(screen.getByTestId("import-confirm"));

    await vi.waitFor(() => expect(props.onImported).toHaveBeenCalled());
    expect(vi.mocked(api.importTaskXml).mock.calls.map(([i]) => i.name)).toEqual(["每日备份", "月度汇总"]);
    const summary = props.onImported.mock.calls[0][0];
    expect(summary.ok).toEqual(["每日备份", "月度汇总"]);
    expect(summary.failed).toEqual([]);
  });

  it("其中一个失败不影响其余，失败的那条留在汇总里", async () => {
    vi.mocked(api.importTaskXml).mockImplementation(async (input) => {
      if (input.name === "每日备份") throw new Error("拒绝访问");
      return { name: input.name };
    });
    const { props } = mount();
    await choose([file("a.xml", xmlOf("\\维护\\每日备份")), file("b.xml", xmlOf("\\报表\\月度汇总"))]);
    await fireEvent.click(screen.getByTestId("import-confirm"));

    await vi.waitFor(() => expect(props.onImported).toHaveBeenCalled());
    const summary = props.onImported.mock.calls[0][0];
    expect(summary.ok).toEqual(["月度汇总"]);
    expect(summary.failed).toEqual([{ name: "每日备份", message: "拒绝访问" }]);
  });

  it("全部失败时不关弹窗，错误留在对应那条上等着重试", async () => {
    vi.mocked(api.importTaskXml).mockRejectedValue(new Error("拒绝访问"));
    const { props } = mount();
    await choose([file("a.xml", xmlOf("\\维护\\每日备份"))]);
    await fireEvent.click(screen.getByTestId("import-confirm"));

    await vi.waitFor(() => expect(screen.getByText("拒绝访问")).toBeTruthy());
    expect(props.onImported).not.toHaveBeenCalled();
    expect(screen.getByTestId("import-dialog")).toBeTruthy();
  });

  it("以保存密码方式运行的任务，不填密码就不给导入", async () => {
    mount();
    await choose([file("a.xml", xmlOf("\\a", "DOMAIN\\svc", "Password"))]);
    expect(screen.getByTestId("import-password")).toBeTruthy();
    expect(enabled(screen.getByTestId("import-confirm"))).toBe(false);

    await fireEvent.input(screen.getByTestId("import-password"), { target: { value: "pw" } });
    expect(enabled(screen.getByTestId("import-confirm"))).toBe(true);
  });
});
