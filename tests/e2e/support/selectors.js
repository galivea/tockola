// 端到端测试共用的一组定位器与取数helper。
// 页面上的交互元素一律走 data-testid：类名会随样式调整变，
// testid 是给测试留的契约，改了等于改契约。

import { expect } from "@playwright/test";

/** Windows 任务组路径里含反斜杠，写进 CSS 属性选择器前必须转义 */
export const cssPath = (p) => String(p ?? "").replace(/\\/g, "\\\\");

export const rows = (page) => page.locator(".wx-row");

export const groupCb = (page, p) =>
  page.locator(`[data-testid="tree-group-cb"][data-path="${cssPath(p)}"]`);

export const groupRow = (page, p) =>
  page.locator(`[data-testid="tree-group"][data-path="${cssPath(p)}"]`);

export const groupOp = (page, p, op) =>
  page.locator(`[data-testid="tree-group-${op}"][data-path="${cssPath(p)}"]`);

/** 树里第一个非根任务组：拿它当实验对象，避免动到根 */
export async function firstNonRootGroup(page) {
  const paths = await page
    .locator('[data-testid="tree-group"]')
    .evaluateAll((els) => els.map((e) => e.dataset.path));
  return paths.find((p) => p && p !== "\\") ?? "\\";
}

export const allGroupPaths = (page) =>
  page.locator('[data-testid="tree-group"]').evaluateAll((els) => els.map((e) => e.dataset.path));

export const allTaskPaths = (page) =>
  page.locator('[data-testid="tree-task"]').evaluateAll((els) => els.map((e) => e.dataset.path));

/** 只取左侧树里的任务组，不含弹窗里那份（弹窗开着时两者会混在一起） */
export const sideGroupPaths = (page) =>
  page
    .locator('[data-testid="group-tree"] [data-testid="tree-group"]')
    .evaluateAll((els) => els.map((e) => e.dataset.path));

/**
 * 等某个任务组真的出现在树上再返回它的完整路径。
 * 新建是异步的，直接用 evaluateAll 找会得到 undefined，
 * 后面所有 hover / 点击就都砸在空 locator 上。
 */
export async function waitForGroupPath(page, name) {
  const hit = (paths) => paths.find((p) => p && p.includes(`\\${name}\\`)) ?? null;
  await expect
    .poll(async () => hit(await allGroupPaths(page)) ?? "", { timeout: 10_000, message: `任务组「${name}」应出现在树上` })
    .not.toBe("");
  return hit(await allGroupPaths(page));
}

/** 重命名 / 删除也是异步的，等旧名彻底消失再断言 */
export async function waitForGroupGone(page, name) {
  await expect
    .poll(
      async () => (await allGroupPaths(page)).filter((p) => p && p.includes(`\\${name}\\`)).length,
      { timeout: 10_000, message: `任务组「${name}」应从树上消失` }
    )
    .toBe(0);
}

/** 界面状态落盘的那一坨（filters.js 的 v3 key） */
export const savedFilters = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("tockola.filters.v3") || "{}"));

/** 表头文字，去空白 */
export const headerTexts = (page) =>
  page.locator(".wx-header .wx-cell").allTextContents().then((t) => t.map((s) => s.trim()));

/**
 * 列序按 data-header-id 读，不按文字。
 * 表头单元格里还塞了排序箭头，文字是「 编辑 ↕ 」这种带空白的形态，
 * 拿它做全等比较，改个箭头就红；列 id 才是给测试留的契约。
 */
export const headerIds = (page) =>
  page
    .locator(".wx-header .wx-cell")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-header-id")));

export const stateTexts = (page) =>
  page
    .locator('[data-testid="cell-state"]')
    .evaluateAll((els) => els.map((e) => e.textContent.trim()));

export const nameTexts = (page) =>
  page
    .locator('[data-testid="cell-name"]')
    .allTextContents()
    .then((t) => t.map((s) => s.trim()));

/**
 * 打开历史抽屉并等第一行落定。
 * 抽屉里的数据是异步取的，直接 evaluateAll 会拿到空数组——
 * 那是「还没渲染」，不是「没有这一列」，必须显式等到有行再断言。
 */
export async function openHistory(page) {
  await page.locator('button[data-action="history"]').first().click();
  await page.locator('[data-testid="history-drawer"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="history-row"]').first().waitFor({ state: "visible" });
}

export const nextRunTexts = (page) =>
  page
    .locator('[data-testid="cell-nextrun"]')
    .allTextContents()
    .then((t) => t.map((s) => s.trim()));
