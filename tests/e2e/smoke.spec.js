// 冒烟：页面能不能站起来、结构对不对、与 Windows 原生对齐的部分有没有走样。
//
// 这一层只读不写（除内联改名），断言的是「界面呈现出来的事实」，
// 不测 CSS 怎么写——居中、等宽这类属于视觉回归，不该由冒烟测试守。

import { test, expect } from "./support/fixtures.js";
import {
  rows,
  headerTexts,
  headerIds,
  stateTexts,
  nameTexts,
  nextRunTexts,
  openHistory,
} from "./support/selectors.js";

test.describe("页面结构", () => {
  test("三大区块都在：任务组树 / 查询 / 列表", async ({ page }) => {
    await expect(page.locator('[data-testid="group-tree"]')).toHaveCount(1);
    await expect(page.locator(".filter-bar")).toBeVisible();
    await expect(page.locator(".grid-host")).toBeVisible();
  });

  test("顶部是自绘标题栏：产品名 + 新建按钮都在", async ({ page }) => {
    // 窗口无边框，标题栏是页面自己画的这一行；产品名在标题栏里，不再有第二块品牌标题
    await expect(page.locator(".titlebar .name")).toHaveText("Tockola");
    await expect(page.getByRole("button", { name: /新建任务/ })).toBeVisible();
  });

  test("列表渲染出数据行", async ({ page }) => {
    await expect(rows(page).first()).toBeVisible();
    expect(await rows(page).count()).toBeGreaterThan(0);
  });
});

test.describe("列表列结构", () => {
  test("表头与 Windows 原生一致", async ({ page }) => {
    const headers = await headerTexts(page);
    for (const h of ["任务名称", "状态", "下次运行时间", "启用", "编辑", "运行", "历史", "删除"]) {
      expect(headers.some((t) => t?.includes(h)), `表头应包含「${h}」`).toBe(true);
    }
  });

  test("前三列顺序与官方一致", async ({ page }) => {
    const headers = await headerTexts(page);
    const idx = ["任务名称", "状态", "下次运行时间"].map((h) => headers.findIndex((t) => t?.includes(h)));
    expect(idx.every((i) => i >= 0), `三列都要在：${idx.join(",")}`).toBe(true);
    expect(idx[0]).toBeLessThan(idx[1]);
    expect(idx[1]).toBeLessThan(idx[2]);
  });

  test("行内操作列顺序为 运行→历史→编辑→删除（按列 id 比，不比文字）", async ({ page }) => {
    const ids = await headerIds(page);
    const keys = ["run", "history", "edit", "remove"];
    const idx = keys.map((k) => ids.indexOf(`:${k}`));
    keys.forEach((k, i) => {
      expect(idx[i], `列 id 里要有 :${k}，实际：${ids.join(",")}`).toBeGreaterThanOrEqual(0);
    });
    // 按下标升序即为期望顺序：先看能不能跑，再看跑得怎么样，然后才改它，最后才是删
    expect(idx, `操作列实际顺序：${ids.filter((id) => keys.some((k) => id === `:${k}`)).join(",")}`).toEqual(
      [...idx].sort((a, b) => a - b)
    );
  });

  test("已删除的列不再出现在表头", async ({ page }) => {
    const headers = await headerTexts(page);
    for (const h of ["上次运行时间", "上次运行结果", "任务描述", "任务组", "执行命令", "操作", "手动执行"]) {
      expect(headers.some((t) => t?.includes(h)), `表头不应再有「${h}」`).toBe(false);
    }
  });

  test("启用开关渲染", async ({ page }) => {
    expect(await page.locator('[role="switch"]').count()).toBeGreaterThan(0);
  });
});

test.describe("操作按钮", () => {
  for (const action of ["edit", "run", "history", "remove"]) {
    test(`「${action}」按钮渲染并带悬浮提示`, async ({ page }) => {
      const btn = page.locator(`button[data-action="${action}"]`).first();
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute("title", /.+/);
    });
  }

  test("每行四个操作按钮，一按钮一列", async ({ page }) => {
    await expect(rows(page).first().locator("button[data-action]")).toHaveCount(4);
  });
});

test.describe("显示格式", () => {
  test("下次运行时间只有「时间」或「—」两种形态", async ({ page }) => {
    const texts = await nextRunTexts(page);
    expect(texts.length).toBeGreaterThan(0);
    const re = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    const bad = texts.filter((t) => t !== "—" && !re.test(t));
    expect(bad, `出现了第三种形态：${bad.join(" | ")}`).toEqual([]);
    expect(texts).not.toContain("未计划");
  });
});

test.describe("运行状态", () => {
  test("状态徽章文案在既定集合内", async ({ page }) => {
    const states = await stateTexts(page);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((s) => ["正在运行", "就绪", "已禁用", "排队中"].includes(s))).toBe(true);
  });

  test("运行中的行显示停止按钮，其它行显示运行", async ({ page }) => {
    const stop = page.locator('button[data-action="run"][data-mode="stop"]');
    expect(await stop.count()).toBeGreaterThan(0);
    await expect(stop.first()).toHaveAttribute("title", "停止");
    expect(await page.locator('button[data-action="run"][data-mode="run"]').count()).toBeGreaterThan(0);
  });

  test("按运行状态筛选只剩该状态的任务", async ({ page }) => {
    const sel = page.locator('[data-testid="filter-state"]');

    await sel.selectOption("Running");
    await expect(page.locator('[data-testid="cell-state"]').first()).toHaveText("正在运行");
    const running = await stateTexts(page);
    expect(running.length).toBeGreaterThan(0);
    expect(running.every((s) => s === "正在运行")).toBe(true);

    await sel.selectOption("Disabled");
    const disabled = await stateTexts(page);
    expect(disabled.length).toBeGreaterThan(0);
    expect(disabled.every((s) => s === "已禁用")).toBe(true);

    await sel.selectOption("all");
    expect((await stateTexts(page)).length).toBeGreaterThan(disabled.length);
  });
});

test.describe("隐藏任务", () => {
  test("可见性归任务组的显示配置管，查询区不再有开关", async ({ page }) => {
    await expect(page.locator('[data-testid="filter-hidden"]')).toHaveCount(0);
    await expect(page.locator('.filter-bar input[type="checkbox"]')).toHaveCount(0);
  });

  test("hidden 任务照常出现在列表里", async ({ page }) => {
    // 演示数据里的 Start Sync Client 带 hidden:true，不能被过滤掉
    const names = await nameTexts(page);
    expect(names).toContain("Start Sync Client");
  });
});

test.describe("历史抽屉", () => {
  test("能打开也能关闭", async ({ page }) => {
    await openHistory(page);
    const drawer = page.locator('[data-testid="history-drawer"]');
    await expect(drawer).toBeVisible();
    await expect(page.locator('[data-testid="history-row"]').first()).toBeVisible();
    await drawer.locator(".x").click();
    await expect(drawer).toHaveCount(0);
  });

  test("四列与原生一致：级别 / 日期和时间 / 事件 ID / 任务类别", async ({ page }) => {
    await openHistory(page);
    const heads = await page
      .locator('[data-testid="history-table"] thead th')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    expect(heads).toEqual(["级别", "日期和时间", "事件 ID", "任务类别"]);

    // 事件 ID 与任务类别必须在同一行（原生就是这样，之前是两个 tr）
    const cells = await page
      .locator('[data-testid="history-row"]')
      .first()
      .locator("td")
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    expect(cells).toHaveLength(4);
    expect(cells[2]).toMatch(/^\d+$/);
    expect(cells[3]).not.toBe("");
  });

  test("任务类别是有含义的文案，不是事件 ID 也不是空列", async ({ page }) => {
    await openHistory(page);
    const cats = await page
      .locator('[data-testid="history-row"] .cat')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    const ids = await page
      .locator('[data-testid="history-row"] td:nth-child(3)')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));

    expect(cats.length).toBeGreaterThan(0);
    // 类别不是「事件 #102」这种兜底串 —— 那说明文案表没覆盖到这个 ID
    expect(cats.filter((c) => !c || c.startsWith("事件 #"))).toEqual([]);
    // 类别也不是把事件 ID 直接搬过来
    expect(cats.filter((c, i) => c === ids[i])).toEqual([]);
    expect(
      cats.some((c) => ["任务已完成", "操作已启动", "任务已启动", "任务注册已更新"].includes(c))
    ).toBe(true);
  });

  test("级别文案在既定集合内，且与着色档位对应", async ({ page }) => {
    await openHistory(page);
    const levels = await page
      .locator('[data-testid="history-row"] .lv')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    const kinds = await page
      .locator('[data-testid="history-row"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-level")));

    expect(levels.length).toBeGreaterThan(0);
    expect(levels.every((l) => ["信息", "警告", "错误", "关键"].includes(l))).toBe(true);
    kinds.forEach((k, i) => {
      const want =
        k === "warning" ? "警告" : k === "error" || k === "critical" ? ["错误", "关键"] : "信息";
      if (Array.isArray(want)) expect(want).toContain(levels[i]);
      else expect(levels[i]).toBe(want);
    });
  });

  test("日期和时间用斜杠分隔且带秒", async ({ page }) => {
    await openHistory(page);
    const times = await page
      .locator('[data-testid="history-row"] .c-time')
      .evaluateAll((els) => els.map((e) => e.textContent.trim()));
    expect(times.length).toBeGreaterThan(0);
    expect(times.every((t) => /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(t))).toBe(true);
  });
});

test.describe("列头排序", () => {
  test("任务名称列三态循环：升序 → 降序 → 默认", async ({ page }) => {
    const header = page.locator('[data-testid="sort-name"]');
    await expect(header).toHaveCount(1);

    const before = await nameTexts(page);
    expect(before.length).toBeGreaterThan(0);

    await header.click();
    const asc = await nameTexts(page);
    await expect(header).toHaveAttribute("data-dir", "asc");
    // 真比较序列，而不是只比行数：排序坏了行数当然还是那么多
    expect(asc).toEqual([...before].sort((a, b) => a.localeCompare(b, "zh")));

    await header.click();
    const desc = await nameTexts(page);
    await expect(header).toHaveAttribute("data-dir", "desc");
    expect(desc).toEqual([...asc].reverse());

    await header.click();
    await expect(header).toHaveAttribute("data-dir", "");
    expect(await nameTexts(page)).toEqual(asc);
  });
});

// 导入与导出都要原生文件对话框，浏览器演示模式下两个入口都在，但都点不动
test.describe("导入 / 导出入口", () => {
  test("演示模式下导入按钮存在但禁用", async ({ page }) => {
    const btn = page.locator('[data-testid="import-task"]');
    await expect(btn).toHaveCount(1);
    await expect(btn).toBeDisabled();
  });

  test("演示模式下导出按钮存在但禁用", async ({ page }) => {
    const btn = page.locator('[data-testid="export-tasks"]');
    await expect(btn).toHaveCount(1);
    await expect(btn).toBeDisabled();
  });
});
