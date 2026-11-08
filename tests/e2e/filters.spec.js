// 查询条件：工具栏长什么样、筛选对不对、条件能不能活过刷新。
//
// 界面状态是静默失效的重灾区——落盘失败没有任何报错，用户看到的只是
// 「关掉再打开，筛选又没了」。所以这里每一条都走完「改 → 落盘 → 刷新 → 回填」整条链路。

import { test, expect } from "./support/fixtures.js";
import { rows, groupCb, firstNonRootGroup, savedFilters } from "./support/selectors.js";

async function baselineRows(page) {
  return rows(page).count();
}

test.describe("查询工具栏", () => {
  test("四个查询项都在", async ({ page }) => {
    const labels = await page.locator(".filter-bar .label").allTextContents().then((t) => t.map((s) => s.trim()));
    for (const lab of ["任务名称", "下次运行时间", "启用状态", "运行状态"]) {
      expect(labels.includes(lab), `查询项「${lab}」应存在`).toBe(true);
    }
  });

  test("任务组查询已移到左侧树，查询区不再有相关控件", async ({ page }) => {
    const labels = await page.locator(".filter-bar .label").allTextContents().then((t) => t.map((s) => s.trim()));
    expect(labels).not.toContain("任务组");
    await expect(page.locator('[data-testid="group-select"]')).toHaveCount(0);
    // 隐藏任务的可见性归左侧任务组的「显示配置」管，这里不设开关
    await expect(page.locator('[data-testid="filter-hidden"]')).toHaveCount(0);
  });

  test("各控件齐备，无查询条件时重置禁用", async ({ page }) => {
    await expect(page.locator('[data-testid="filter-name"]')).toHaveCount(1);
    await expect(page.locator(".filter-bar input[type=date]")).toHaveCount(2);
    await expect(page.locator(".filter-bar select")).toHaveCount(2);
    await expect(page.locator('[data-testid="filter-state"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="reset-filters"]')).toBeDisabled();
  });

  test("日期框空值时显示「起始 / 结束」，不是日期格式占位", async ({ page }) => {
    const phs = await page.locator(".filter-bar .date-ph").allTextContents().then((t) => t.map((s) => s.trim()));
    expect(phs).toHaveLength(2);
    expect(phs).toContain("起始");
    expect(phs).toContain("结束");

    const vals = await page
      .locator(".filter-bar input[type=date]")
      .evaluateAll((els) => els.map((e) => e.value));
    expect(vals).toEqual(["", ""]);

    const native = (await page.locator(".filter-bar input[type=date]").first().getAttribute("placeholder")) || "";
    expect(native).not.toMatch(/年|月|日|yyyy|mm|dd/i);
  });
});

test.describe("按名称查询", () => {
  test("只按名称过滤，过滤不到时为空，清空后恢复", async ({ page }) => {
    const before = await baselineRows(page);
    const input = page.locator('[data-testid="filter-name"]');

    await input.fill("不存在的任务XYZ_123");
    await expect(rows(page)).toHaveCount(0);

    await input.fill("");
    await expect(rows(page)).toHaveCount(before);
  });
});

test.describe("条件落盘与恢复", () => {
  test("勾选状态刷新后仍在", async ({ page }) => {
    const group = await firstNonRootGroup(page);
    const cb = groupCb(page, group);

    await cb.check();
    const before = await baselineRows(page);
    expect(before).toBeGreaterThan(0);

    const saved = await savedFilters(page);
    expect(saved.selection?.groups ?? []).toContain(group);

    await page.reload({ waitUntil: "networkidle" });
    await expect(rows(page)).toHaveCount(before);
    await expect(groupCb(page, group)).toBeChecked();
    // 条件恢复了，重置按钮就应该可用
    await expect(page.locator('[data-testid="reset-filters"]')).toBeEnabled();
  });

  test("点击重置恢复全部任务，落盘的条件一并清空", async ({ page }) => {
    const baseline = await baselineRows(page);
    const group = await firstNonRootGroup(page);

    await groupCb(page, group).check();
    const filtered = await baselineRows(page);
    expect(filtered, "勾选任务组后行数应少于全量").toBeLessThan(baseline);

    await page.locator('[data-testid="reset-filters"]').click();
    await expect(rows(page)).toHaveCount(baseline);
    await expect(page.locator('[data-testid="reset-filters"]')).toBeDisabled();

    const saved = await savedFilters(page);
    expect(saved.selection?.groups ?? []).toEqual([]);
    expect(saved.selection?.tasks ?? []).toEqual([]);
    expect(saved.name).toBe("");
    expect(saved.enabled).toBe("all");
  });
});
