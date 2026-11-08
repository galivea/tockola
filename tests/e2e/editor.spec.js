// 新建 / 修改任务的长页弹窗，以及列表单元格的内联编辑。
//
// 保存是全量重写 XML，所以这里最该守的不是「点得动」，而是
// 「没读到的分区不会被默认值冲掉」——那个 bug 发生在演示模式之外，
// 端到端这层是唯一能复现它的地方。

import { test, expect } from "./support/fixtures.js";
import { rows } from "./support/selectors.js";

const SECTIONS = ["identity", "triggers", "actions", "settings", "principal"];
const ANCHORS = ["基本信息", "触发器", "动作", "设置与条件", "运行身份"];

/** 五个分区并发取数，取完才没有 busy 占位 */
const loaded = (page) =>
  page
    .waitForFunction(() => !document.querySelector('[data-testid="editor-busy"]'), null, { timeout: 15000 })
    .catch(() => {});

async function openNew(page) {
  await page.getByRole("button", { name: /新建任务/ }).first().click();
  const dlg = page.locator('[role="dialog"]');
  await dlg.waitFor({ state: "visible" });
  await loaded(page);
  return dlg;
}

async function openEdit(page) {
  await rows(page).first().locator('button[data-action="edit"]').first().click();
  const dlg = page.locator('[role="dialog"]').filter({ hasText: "修改任务" });
  await dlg.waitFor({ state: "visible" });
  await dlg.locator("#sec-identity").first().waitFor({ state: "visible" });
  await loaded(page);
  return dlg;
}

test.describe("新建任务长页", () => {
  test("五个分区上下排列、同时可见，不分页签", async ({ page }) => {
    const dlg = await openNew(page);
    for (const id of SECTIONS) {
      await expect(dlg.locator(`#sec-${id}`)).toHaveCount(1);
    }
    for (const a of ANCHORS) {
      expect(await dlg.locator(".anchor").filter({ hasText: a }).count()).toBeGreaterThan(0);
    }
  });

  test("基本信息区：名称 + 任务组树选择器，没有手输路径框", async ({ page }) => {
    const dlg = await openNew(page);
    await expect(page.locator('[data-testid="edit-name"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="group-tree-select"]')).toHaveCount(1);
    // 任务组只能用选择器，手输会写出不存在的路径
    await expect(page.locator('[data-testid="edit-path"]')).toHaveCount(0);
  });

  test("作者与描述符收在「更多信息」里，默认收起", async ({ page }) => {
    const dlg = await openNew(page);
    const more = page.locator('[data-testid="reg-more"]');
    await expect(more).toHaveCount(1);
    await expect(page.locator("#sec-identity details.adv.more").first()).toHaveJSProperty("open", false);
    await expect(more).toHaveAttribute("title", /作者：/);
    await expect(more).toHaveAttribute("title", /安全描述符：/);

    await more.click();
    await expect(page.locator('[data-testid="edit-author"]')).toBeVisible();
  });

  test("任务组按钮显示原始路径，选完树面板收起", async ({ page }) => {
    const dlg = await openNew(page);
    await page.locator('[data-testid="group-tree-select"] .trigger').click();
    await expect(page.locator('[data-testid="group-tree-select"] .node').first()).toBeVisible();
    await page.locator('[data-testid="group-tree-select"] .node').first().click();
    await expect(page.locator('[data-testid="group-tree-select"] .panel')).toHaveCount(0);

    const val = (await page.locator('[data-testid="group-tree-value"]').textContent())?.trim() || "";
    expect(val.startsWith("\\")).toBe(true);
    expect(val).not.toContain("/");
  });

  test("触发器与动作默认都是 0 条，点了才加", async ({ page }) => {
    const dlg = await openNew(page);
    await expect(dlg.locator("#sec-triggers .trow")).toHaveCount(0);
    await expect(dlg.locator("#sec-actions .trow")).toHaveCount(0);

    await page.locator('[data-testid="add-trigger"]').click();
    await expect(dlg.locator("#sec-triggers .trow")).toHaveCount(1);

    await page.locator('[data-testid="add-action"]').click();
    await expect(dlg.locator("#sec-actions .trow")).toHaveCount(1);
  });

  test("动作类型只有 Windows 支持的几种，没有邮件 / 消息", async ({ page }) => {
    const dlg = await openNew(page);
    const opts = await dlg.locator("#sec-actions option").allTextContents();
    expect(opts.some((t) => /邮件|消息/.test(t))).toBe(false);
  });

  test("触发器表头字段名与顺序固定，结束日期在主行内", async ({ page }) => {
    const dlg = await openNew(page);
    await page.locator('[data-testid="add-trigger"]').click();

    const heads = await dlg.locator("#sec-triggers .thead span").allTextContents().then((t) => t.map((s) => s.trim()));
    expect(heads.join("/")).toBe(
      "/#/触发周期/选择周期/开始日期/重复间隔/持续时间/持续时间到时停止/结束日期/运行超时时间/相隔周期/随机延迟/启用/"
    );

    const at = (name) => heads.indexOf(name);
    expect(at("开始日期")).toBeLessThan(at("重复间隔"));
    expect(at("相隔周期")).toBeLessThan(at("随机延迟"));
    expect(at("运行超时时间")).toBe(at("结束日期") + 1);
  });

  test("时长是「数字 + 单位」两格，不再拆成时 / 分", async ({ page }) => {
    const dlg = await openNew(page);
    await page.locator('[data-testid="add-trigger"]').click();

    const inputs = await dlg.locator('[data-testid="dur-input"]').count();
    expect(inputs).toBeGreaterThan(0);
    await expect(dlg.locator('[data-testid="dur-unit"]')).toHaveCount(inputs);
    await expect(dlg.locator('[data-testid="dur-h"]')).toHaveCount(0);
    await expect(dlg.locator('[data-testid="time-s"]').first()).toBeVisible();
  });

  test("未来执行时间：预览模式下说清连不上服务，不给手算结果", async ({ page }) => {
    const dlg = await openNew(page);
    await page.locator('[data-testid="add-trigger"]').click();

    const box = dlg.locator("#sec-triggers [data-testid=\"next-run\"]");
    await expect(box).toHaveCount(1);
    const cnt = box.locator('[data-testid="next-run-count"]');
    await expect(cnt).toHaveValue("5");
    await cnt.fill("3");
    await expect(cnt).toHaveValue("3");

    await expect(box.locator('[data-testid="next-run-unsupported"]')).toContainText(/任务计划服务|桌面端/);
    await expect(box.locator('[data-testid="next-run-verify"]')).toHaveCount(0);
  });

  test("选择周期就地展开，不是浮动层", async ({ page }) => {
    const dlg = await openNew(page);
    await page.locator('[data-testid="add-trigger"]').click();

    // 只有日历型触发器才有「选择周期」，默认的每天没有，先换成每周
    await dlg.locator("#sec-triggers .trow select").first().selectOption("weekly");

    const btn = dlg.locator('#sec-triggers [data-testid="period-btn"]:not([disabled])').first();
    await expect(btn).toBeVisible();
    await btn.click();

    const ex = dlg.locator('#sec-triggers [data-testid="tg-expand"]');
    await expect(ex).toHaveCount(1);
    expect(await ex.first().evaluate((el) => getComputedStyle(el).position)).not.toBe("fixed");
  });

  test("触发器与动作行都可以拖动排序，没有多余的列表标题", async ({ page }) => {
    const dlg = await openNew(page);
    await page.locator('[data-testid="add-trigger"]').click();
    await page.locator('[data-testid="add-action"]').click();

    await expect(dlg.locator('#sec-triggers .grip[draggable="true"]').first()).toBeVisible();
    await expect(dlg.locator('#sec-actions .grip[draggable="true"]').first()).toBeVisible();
    await expect(page.getByText("触发器列表", { exact: true })).toHaveCount(0);
    await expect(page.getByText("操作列表", { exact: true })).toHaveCount(0);
  });
});

test.describe("cron 生成器", () => {
  async function openCron(page) {
    const dlg = await openNew(page);
    await page.locator('[data-testid="add-trigger-batch"]').click();
    const cron = page.locator('[data-testid="cron-dialog"]');
    await cron.waitFor({ state: "visible" });
    return { dlg, cron };
  }

  /** 预览默认收起，读之前先展开 */
  async function preview(cron) {
    const d = cron.locator('[data-testid="cron-preview"]');
    if (!(await d.count())) return "";
    if (!(await d.evaluate((el) => el.open))) await d.locator("summary").click();
    return ((await d.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  }

  const toastText = (cron) =>
    cron.locator('[data-testid="cron-toast"]').innerText().catch(() => "").then((t) => (t || "").replace(/\s+/g, ""));

  test("七个字段默认都不选，不替用户预设计划", async ({ page }) => {
    const { cron } = await openCron(page);
    const tabs = await cron.locator('[data-testid^="cron-field-"]').allTextContents();
    expect(tabs.map((t) => t.replace(/\s+/g, "")).join("/")).toBe(
      "秒未选/分未选/时未选/日未选/月未选/周未选/年未选"
    );
    await expect(cron.locator('[data-testid="cron-expr"]')).toHaveValue("");
    await expect(cron.locator('[data-testid="cron-missing"]')).toContainText(/秒、分、时/);
  });

  test("没填完点添加：当场提示，弹窗不关也不添加", async ({ page }) => {
    const { cron } = await openCron(page);
    await cron.locator('[data-testid="cron-add"]').click();
    await expect(cron.locator('[data-testid="cron-toast"]')).toContainText("还没指定");
    await expect(cron).toBeVisible();
  });

  test("不支持的写法当场报错并撤销输入", async ({ page }) => {
    const { cron } = await openCron(page);
    const expr = cron.locator('[data-testid="cron-expr"]');
    const cases = [
      ["0 0 L * *", "最后一天"],
      ["0 0 15W * *", "最近工作日"],
      ["0 0 * * 5L", "最后一个星期"],
      ["H * * * *", "Jenkins"],
      ["@reboot", "开机"],
      ["CRON_TZ=Asia/Shanghai 0 9 * * *", "时区"],
      ["0 9 * * * /usr/bin/backup.sh", "命令"],
    ];

    const bads = [];
    for (const [text, kw] of cases) {
      await expr.fill(text);
      await expr.blur();
      const tip = await toastText(cron);
      if (!tip.includes(kw)) bads.push(`${text} 没有提示「${kw}」`);
      if ((await expr.inputValue()) !== "") bads.push(`${text} 没有被撤销`);
    }
    expect(bads).toEqual([]);
  });

  test("直接写表达式：工作日 9 点合成 1 个 weekly", async ({ page }) => {
    const { cron } = await openCron(page);
    const expr = cron.locator('[data-testid="cron-expr"]');
    await expr.fill("0 9 * * 1-5");
    await expr.blur();

    const text = await preview(cron);
    expect(text).toMatch(/将添加\s*1\s*个触发器/);
    expect(text).toContain("周一、周二、周三、周四、周五");
  });

  test("回归：三个等间隔时刻合成 1 个，用重复间隔表达", async ({ page }) => {
    const { cron } = await openCron(page);
    const expr = cron.locator('[data-testid="cron-expr"]');
    await expr.fill("0 0,8,16 * * *");
    await expr.blur();

    const text = await preview(cron);
    expect(text).toMatch(/将添加\s*1\s*个触发器/);
    expect(text).toContain("每 8小时一次");
  });

  test("回归：分 0-1,3 × 时 7,9 按小时分块成 4 个", async ({ page }) => {
    const { cron } = await openCron(page);
    const expr = cron.locator('[data-testid="cron-expr"]');
    await expr.fill("0 0-1,3 7,9 * * *");
    await expr.blur();

    const text = await preview(cron);
    expect(text).toMatch(/将添加\s*4\s*个触发器/);
    // 不能把 7:03 和 9:00 缝成一条「间隔 1 小时 57 分」的链
    expect(text).not.toContain("1小时57分");
    expect((text.match(/每 1分一次，共 2 次/g) || []).length).toBe(2);
    expect(text).toContain("07:03:00");
    expect(text).toContain("09:03:00");
  });

  test("回归：分 0,3,32 × 时 1,9 切 4 个，不出现跨小时的 8 小时链", async ({ page }) => {
    const { cron } = await openCron(page);
    const expr = cron.locator('[data-testid="cron-expr"]');
    await expr.fill("0 0,3,32 1,9 * * *");
    await expr.blur();

    const text = await preview(cron);
    expect(text).toMatch(/将添加\s*4\s*个触发器/);
    expect(text).not.toContain("每 8小时一次");
    expect((text.match(/每 3分一次，共 2 次/g) || []).length).toBe(2);
  });

  test("日期与星期同时限定：当场提示「或」不是「且」", async ({ page }) => {
    const { cron } = await openCron(page);
    const expr = cron.locator('[data-testid="cron-expr"]');

    await expr.fill("0 9 1 * 1");
    await expr.blur();
    const clash = cron.locator('[data-testid="cron-clash"]');
    await expect(clash).toContainText("「或」");
    await expect(clash).toContainText("不是「且」");
    await expect(clash).toContainText("跑两次");

    const marks = await cron
      .locator('[data-testid^="cron-field-"].warn')
      .evaluateAll((els) => els.map((e) => (e.getAttribute("data-testid") || "").replace("cron-field-", "")).sort());
    expect(marks).toEqual(["dom", "dow"]);

    // 只限一边时不该报警
    await expr.fill("0 9 * * 2");
    await expr.blur();
    await expect(clash).toHaveCount(0);
  });

  test("6#3 是每月第三个周六，属于 Windows 原生支持的写法", async ({ page }) => {
    const { cron } = await openCron(page);
    const expr = cron.locator('[data-testid="cron-expr"]');
    await expr.fill("0 9 * * 6#3");
    await expr.blur();
    await expect(cron.locator('[data-testid="cron-toast"]')).toHaveCount(0);
    expect(await preview(cron)).toMatch(/第三个\s*周六/);
  });

  test("勾选字段与表达式双向同步，非等间隔时按最少触发器拆分", async ({ page }) => {
    const { cron } = await openCron(page);
    const expr = cron.locator('[data-testid="cron-expr"]');

    await expr.fill("0 0,8,16 * * *");
    await expr.blur();
    await cron.locator('[data-testid="cron-field-h"]').click();
    await cron.locator('[data-testid="cron-opt-h-12"]').click();
    expect(await expr.inputValue()).toContain("12");

    // 4 个点不再等差，会拆成 2 组
    expect(await preview(cron)).toMatch(/将添加\s*2\s*个触发器/);
  });

  test("一次超过 100 个触发器时当场提示，不添加也不关窗", async ({ page }) => {
    const { dlg, cron } = await openCron(page);
    const before = await dlg.locator("#sec-triggers .trow").count();

    // 秒、分都拉满（60 × 60），其余字段给单值：总数 3600，远超一次 100 个的上限。
    // 注意校验顺序：少填字段会先报「还没指定」，所以这里必须七个字段全有值。
    const expr = cron.locator('[data-testid="cron-expr"]');
    await expr.fill("* * 9 1 1 1");
    await expr.blur();

    await cron.locator('[data-testid="cron-add"]').click();
    await expect(cron.locator('[data-testid="cron-toast"]')).toContainText("100");
    await expect(cron).toBeVisible();
    await expect(dlg.locator("#sec-triggers .trow")).toHaveCount(before);
  });

  test("批量添加后触发器接在原有列表后面，弹窗关闭", async ({ page }) => {
    const { dlg, cron } = await openCron(page);
    const expr = cron.locator('[data-testid="cron-expr"]');
    await expr.fill("0 0,8,16 * * *");
    await expr.blur();

    const before = await dlg.locator("#sec-triggers .trow").count();
    await cron.locator('[data-testid="cron-add"]').click();
    await expect(cron).toHaveCount(0);
    await expect(dlg.locator("#sec-triggers .trow")).toHaveCount(before + 1);
  });
});

test.describe("修改任务", () => {
  test("修改页与新建页同构：五个分区一个不少", async ({ page }) => {
    const dlg = await openEdit(page);
    const anchors = await dlg.locator(".anchor .a-label").allTextContents();
    expect(anchors).toHaveLength(5);
    expect(anchors.some((t) => (t ?? "").includes("基本信息"))).toBe(true);

    for (const id of SECTIONS) {
      await expect(dlg.locator(`#sec-${id}`)).toHaveCount(1);
    }
    await expect(dlg.locator(".loading-box")).toHaveCount(0);
    await expect(dlg.locator("#sec-triggers .trow").first()).toBeVisible();
    await expect(dlg.locator("#sec-actions .trow").first()).toBeVisible();
  });

  test("组主体与用户主体互斥", async ({ page }) => {
    const dlg = await openEdit(page);
    const sec = dlg.locator("#sec-principal");
    const sel = sec.locator("select").first();

    const opts = await sel.locator("option").allTextContents();
    expect(opts.some((t) => (t || "").includes("组成员身份运行"))).toBe(true);

    await sel.selectOption("Group");
    await expect(sec.locator('[data-testid="principal-group-id"]')).toHaveCount(1);
    await expect(sec.locator('input[placeholder="留空=当前用户"]')).toHaveCount(0);

    await sel.selectOption("InteractiveToken");
    await expect(sec.locator('[data-testid="principal-group-id"]')).toHaveCount(0);
  });

  test("重复间隔超出实测边界时自动收敛", async ({ page }) => {
    const dlg = await openEdit(page);
    const input = dlg.locator('#sec-triggers [data-testid="dur-input"]').first();
    const unit = dlg.locator('#sec-triggers [data-testid="dur-unit"]').first();
    const tip = () =>
      dlg.locator("#sec-triggers .dur").first().getAttribute("title").then((t) => (t || "").replace(/\n/g, " / "));

    await unit.selectOption("h");
    await input.fill("2");
    expect(await tip()).toContain("PT2H");

    // Windows 最短 1 分钟
    await unit.selectOption("s");
    await input.fill("45");
    expect(await tip()).toContain("PT1M");

    // Windows 最长 31 天
    await unit.selectOption("d");
    await input.fill("32");
    expect(await tip()).toContain("P31D");
  });

  test("保存后弹窗关闭，任务名还在", async ({ page }) => {
    const rowName = (await rows(page).first().locator(".wx-cell").first().textContent())?.trim() || "";
    const dlg = await openEdit(page);

    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(rows(page).first().locator(".wx-cell").first()).toHaveText(rowName);
  });

  test("保存不冲掉未改动的配置", async ({ page }) => {
    const row = rows(page).first();

    // 先记下基准：执行命令与任务名
    await row.locator('button[data-action="edit"]').first().click();
    await page.locator('[role="dialog"]').first().waitFor();
    await loaded(page);
    const cmdBefore = await page.locator('#sec-actions [data-testid="cmd-input"]').first().inputValue();
    const nameBefore = await page.locator("#sec-identity input").first().inputValue();
    expect(cmdBefore.length).toBeGreaterThan(0);
    await page.locator('[role="dialog"] .close').first().click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // 什么都不改，直接保存
    await row.locator('button[data-action="edit"]').first().click();
    await page.locator('[role="dialog"]').first().waitFor();
    await loaded(page);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // 再打开，两个值必须原样
    await row.locator('button[data-action="edit"]').first().click();
    await page.locator('[role="dialog"]').first().waitFor();
    await loaded(page);
    await expect(page.locator('#sec-actions [data-testid="cmd-input"]').first()).toHaveValue(cmdBefore);
    await expect(page.locator("#sec-identity input").first()).toHaveValue(nameBefore);
  });
});

test.describe("列表内联编辑", () => {
  test("点名称进入单行编辑，Esc 取消，Ctrl+Enter 保存并回显", async ({ page }) => {
    const cell = page.locator(".wx-row").first().locator(".wx-cell").first().locator("span.text");

    await cell.click();
    const input = page.locator(".wx-row input.inline").first();
    await expect(input).toBeVisible();

    await input.press("Escape");
    await expect(page.locator(".wx-row input.inline")).toHaveCount(0);

    await cell.click();
    const next = "内联改名后的任务";
    await page.locator(".wx-row input.inline").first().fill(next);
    await page.locator(".wx-row input.inline").first().press("Control+Enter");
    await expect(page.locator(".wx-row").first().locator(".wx-cell").first().locator("span.text")).toHaveText(next);
  });
});
