// 左侧任务组树：勾选筛选、增删改、以及「只显示勾选的任务组」这套显示配置。
//
// 这三条链路都跨了组件（树 → 列表 → localStorage），任何一个环节断了，
// 单独测组件是测不出来的——所以它们只能放在端到端这层。

import { test, expect } from "./support/fixtures.js";
import {
  rows,
  groupCb,
  groupRow,
  groupOp,
  firstNonRootGroup,
  allGroupPaths,
  allTaskPaths,
  sideGroupPaths,
  waitForGroupPath,
  waitForGroupGone,
  savedFilters,
} from "./support/selectors.js";

// 弹窗里用复选框代替已删除的「全选 / 清除」按钮
async function checkAllGroups(dlg) {
  const cbs = dlg.locator('[data-testid="tree-group-cb"]');
  const n = await cbs.count();
  for (let i = 0; i < n; i++) await cbs.nth(i).check();
}
async function uncheckAllGroups(dlg) {
  const cbs = dlg.locator('[data-testid="tree-group-cb"]');
  const n = await cbs.count();
  for (let i = 0; i < n; i++) await cbs.nth(i).uncheck();
}

const NEW_GROUP = "UI测试组";
const RENAMED = "UI测试组改名";

test.describe("树的结构", () => {
  test("任务组用目录图标，任务用时钟图标", async ({ page }) => {
    const groupNodes = await page.locator('[data-testid="tree-group"]').count();
    await expect(page.locator('[data-testid="tree-group"] .gicon svg')).toHaveCount(groupNodes);

    const taskNodes = await page.locator('[data-testid="tree-task"]').count();
    expect(taskNodes).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="tree-task"] .tico svg')).toHaveCount(taskNodes);
  });

});

test.describe("勾选筛选", () => {
  test("勾选任务组后列表被过滤，子任务一并勾上", async ({ page }) => {
    const baseline = await rows(page).count();
    const group = await firstNonRootGroup(page);
    const cb = groupCb(page, group);

    await cb.check();
    const after = await rows(page).count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(baseline);
    await expect(cb).toBeChecked();
    await expect(page.locator('.row.sel [data-testid="tree-group"]')).toHaveCount(1);

    const picked = await page.locator('[data-testid="tree-task-cb"]:checked').count();
    expect(picked).toBeGreaterThan(0);
    expect(after).toBeGreaterThanOrEqual(picked);

    // 面板只给状态提示，不报数量
    await expect(page.locator('[data-testid="group-tree"] .sub')).toHaveText(/任务列表只显示已勾选任务/);
    await expect(page.locator('[data-testid="group-tree"] .sub')).not.toHaveText(/\d/);
  });

  test("有勾选时重置按钮可用，无勾选时禁用", async ({ page }) => {
    const group = await firstNonRootGroup(page);
    await groupCb(page, group).check();
    await expect(page.locator('[data-testid="reset-filters"]')).toBeEnabled();
    await groupCb(page, group).uncheck();
    await expect(page.locator('[data-testid="reset-filters"]')).toBeDisabled();
  });

  test("勾选单个任务时父任务组进入半选状态", async ({ page }) => {
    const tasks = page.locator('[data-testid="tree-task-cb"]');
    await expect(tasks.first()).toBeVisible();

    // 父任务组要从被勾的那个任务自己算出来：树默认是折叠的，
    // 第一个可见任务的父组未必是「第一个非根任务组」
    const taskPath = await tasks.first().getAttribute("data-path");
    expect(taskPath).toBeTruthy();
    const parentPath = String(taskPath).slice(0, String(taskPath).lastIndexOf("\\", String(taskPath).length - 2) + 1);

    await tasks.first().check();
    await expect(page.locator(".task.sel").first()).toBeVisible();

    const parent = groupCb(page, parentPath);
    expect(
      await parent.evaluate((el) => ({ checked: el.checked, indeterminate: el.indeterminate }))
    ).toMatchObject({ indeterminate: true });
  });

});

test.describe("任务名称悬停", () => {
  test("悬停出描述卡片，移开消失，且不用原生 title", async ({ page }) => {
    const nameText = page.locator(".wx-row .wx-cell").first().locator("span.text");
    await nameText.hover();

    const tip = page.locator('[data-testid="name-tip"]');
    await expect(tip).toHaveCount(1);
    await expect(page.locator('[data-testid="name-tip-desc"]')).not.toBeEmpty();
    // 原生 title 会和自定义卡片打架，这里必须是彻底没有 title 属性
    expect(await nameText.getAttribute("title")).toBeNull();

    await page.mouse.move(600, 400);
    await expect(tip).toHaveCount(0);
  });
});

test.describe("任务组增删改", () => {
  test("新建子任务组", async ({ page }) => {
    const group = await firstNonRootGroup(page);
    await groupRow(page, group).hover();
    await groupOp(page, group, "add").first().click();

    const dlg = page.locator('[data-testid="folder-dialog"]');
    await expect(dlg).toBeVisible();
    await page.locator('[data-testid="folder-name-input"]').fill(NEW_GROUP);
    await page.locator('[data-testid="folder-confirm"]').click();

    const created = await waitForGroupPath(page, NEW_GROUP);
    expect(created.endsWith(`\\${NEW_GROUP}\\`)).toBe(true);
    await expect(page.locator('[data-testid="folder-dialog"]')).toHaveCount(0);
  });

  test("非法名称被拦下并提示，Esc 可关闭弹窗", async ({ page }) => {
    const group = await firstNonRootGroup(page);
    await groupRow(page, group).hover();
    await groupOp(page, group, "add").first().click();

    const dlg = page.locator('[data-testid="folder-dialog"]');
    await page.locator('[data-testid="folder-name-input"]').fill("非法/名称");
    await page.locator('[data-testid="folder-confirm"]').click();

    await expect(dlg.locator(".err")).toContainText("不能包含");
    await expect(dlg).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
  });

  test("重命名任务组：预填当前名，改完旧名消失", async ({ page }) => {
    const group = await firstNonRootGroup(page);
    await groupRow(page, group).hover();
    await groupOp(page, group, "add").first().click();
    await page.locator('[data-testid="folder-name-input"]').fill(NEW_GROUP);
    await page.locator('[data-testid="folder-confirm"]').click();

    const created = await waitForGroupPath(page, NEW_GROUP);

    await groupRow(page, created).hover();
    await groupOp(page, created, "rename").first().click();
    await expect(page.locator('[data-testid="folder-name-input"]')).toHaveValue(NEW_GROUP);

    await page.locator('[data-testid="folder-name-input"]').fill(RENAMED);
    await page.locator('[data-testid="folder-confirm"]').click();

    const renamed = await waitForGroupPath(page, RENAMED);
    expect(renamed.endsWith(`\\${RENAMED}\\`)).toBe(true);
    await waitForGroupGone(page, NEW_GROUP);
  });

  test("删除任务组前提示影响范围，删完从树上消失", async ({ page }) => {
    const group = await firstNonRootGroup(page);
    await groupRow(page, group).hover();
    await groupOp(page, group, "add").first().click();
    await page.locator('[data-testid="folder-name-input"]').fill(NEW_GROUP);
    await page.locator('[data-testid="folder-confirm"]').click();

    const created = await waitForGroupPath(page, NEW_GROUP);

    await groupRow(page, created).hover();
    await groupOp(page, created, "del").first().click();

    const dlg = page.locator('[data-testid="folder-dialog"]');
    await expect(dlg).toContainText("一并删除");
    // 统计口径已经撤掉：只说影响范围，不报数量
    await expect(dlg).not.toHaveText(/\d+\s*个(子任务组|任务)/);

    await page.locator('[data-testid="folder-confirm"]').click();
    await waitForGroupGone(page, NEW_GROUP);
  });
});

test.describe("显示配置：只显示勾选的任务组", () => {
  const SUB = "显示配置子组";

  async function createSubGroup(page, parentPath) {
    await groupRow(page, parentPath).hover();
    await groupOp(page, parentPath, "add").first().click();
    await page.locator('[data-testid="folder-name-input"]').fill(SUB);
    await page.locator('[data-testid="folder-confirm"]').click();
    return `${parentPath}${SUB}\\`;
  }

  test("勾选的任务组保留，其余整枝隐藏", async ({ page }) => {
    const parent = await firstNonRootGroup(page);
    const subPath = await createSubGroup(page, parent);
    await expect(page.locator(`[data-testid="tree-group"][data-path="${subPath.replace(/\\/g, "\\\\")}"]`)).toHaveCount(1);

    const eye = page.locator('[data-testid="group-tree"] [data-testid="icon-btn-eye"]');
    await expect(eye).toHaveCount(1);
    await eye.click();

    const dlg = page.locator('[data-testid="visible-dialog"]');
    await expect(dlg).toBeVisible();

    const cbPaths = await dlg
      .locator('[data-testid="tree-group-cb"]')
      .evaluateAll((els) => els.map((e) => e.dataset.path));
    expect(cbPaths.length).toBeGreaterThan(1);
    expect(cbPaths).toContain("\\");
    // 弹窗必须复用左侧树同一套层级数据，子任务组也要在
    expect(cbPaths).toContain(subPath);

    // 弹窗开着时页面上会有两份树，这里只要左侧那份来比对
    const side = await sideGroupPaths(page);
    expect(side.length).toBeGreaterThan(0);
    expect(cbPaths).toEqual(side);

    // 一个都不选等于把树清空，不给确定
    await uncheckAllGroups(dlg);
    await expect(dlg.locator('[data-testid="visible-confirm"]')).toBeDisabled();
    // 全选等于不限制，给确定
    await checkAllGroups(dlg);
    await expect(dlg.locator('[data-testid="visible-confirm"]')).toBeEnabled();

    const keep = [parent];
    await uncheckAllGroups(dlg);
    await groupCb(dlg, parent).check();
    await dlg.locator('[data-testid="visible-confirm"]').click();
    await expect(dlg).toHaveCount(0);

    const after = await allGroupPaths(page);
    expect(after).toContain(parent);
    expect(after).toContain(subPath);
    expect(after).toContain("\\");

    const tasks = await allTaskPaths(page);
    expect(tasks.every((p) => keep.some((k) => p === k || p.startsWith(k)))).toBe(true);
    await expect(page.locator('[data-testid="group-tree"] .sub')).toContainText("隐藏");

    const saved = await savedFilters(page);
    expect(saved.visibleGroups).toEqual(keep);
  });

  test("刷新后隐藏范围不变，再打开会回填，全选等于不限制", async ({ page }) => {
    const parent = await firstNonRootGroup(page);
    const eye = page.locator('[data-testid="group-tree"] [data-testid="icon-btn-eye"]');

    // 基准必须在配置生效前取：配完之后没被勾选的组已经不在树上了
    const others = (await allGroupPaths(page)).filter((p) => p && p !== "\\" && p !== parent);
    expect(others.length, "除了根与被测组之外还得有别的可隐藏项").toBeGreaterThan(0);

    await eye.click();
    const dlg = page.locator('[data-testid="visible-dialog"]');
    await uncheckAllGroups(dlg);
    await groupCb(dlg, parent).check();
    await dlg.locator('[data-testid="visible-confirm"]').click();

    const afterReload = await allGroupPaths(page);
    expect(afterReload).toContain(parent);
    expect(others.filter((p) => afterReload.includes(p))).toEqual([]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="group-tree"]').waitFor();
    // 刷新后树要异步展开回原样，只查一次会拿到折叠状态的骨架
    await expect
      .poll(async () => (await allGroupPaths(page)).includes(parent), { timeout: 10_000 })
      .toBe(true);
    const afterRefresh = await allGroupPaths(page);
    expect(others.filter((p) => afterRefresh.includes(p))).toEqual([]);

    await eye.click();
    const checked = await dlg
      .locator('[data-testid="tree-group-cb"]')
      .evaluateAll((els) => els.filter((e) => e.checked).map((e) => e.dataset.path));
    expect(checked).toContain(parent);
    expect(checked.filter((p) => others.includes(p))).toEqual([]);

    await checkAllGroups(dlg);
    await dlg.locator('[data-testid="visible-confirm"]').click();
    expect((await savedFilters(page)).visibleGroups).toEqual([]);
    // 全选等于不限制：先前被隐藏的组要全部回来
    const restored = await allGroupPaths(page);
    expect(others.filter((p) => restored.includes(p))).toEqual(others);
  });
});
