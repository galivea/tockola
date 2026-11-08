// 布局：列表列宽按内容量出来再等比伸缩，左栏宽度可调并落盘。
//
// 列宽这一段要钉的是「内容决定比例，窗口只决定放大倍数」。之前那版让名称列独
// 吃富余像素、还把拖出来的宽度写进存档，毛病都出在那套逻辑上：拖完看着变了、
// 拉窗口时列宽跳一下、上周存下来的宽度盖掉今天改的默认值。现在是两步：先量内
// 容，再给整行一个统一的倍数——比例永远由内容定，不留白；宽度不进存档。
//
// 左栏宽度相反，它是要动的，而且「拖完看着变了，关掉再打开又回默认」最容易
// 悄悄回归——单独跑一遍看到的效果骗得过人，只有跨越一次页面重载的断言才钉
// 得住。

import { test, expect } from "./support/fixtures.js";
import { savedFilters } from "./support/selectors.js";

const sidebarWidth = (page) =>
  page.evaluate(() =>
    Math.round(document.querySelector('[data-testid="group-tree"]').getBoundingClientRect().width)
  );

/**
 * 一行的排版实况：每列多宽、加起来多宽、能用的地方多宽、溢出多少。
 * 「不留白」不是看某一列有没有变长，而是这两个数对得上且没有溢出。
 */
const layout = (page) =>
  page.evaluate(() => {
    const cells = [...document.querySelectorAll(".wx-header .wx-cell")];
    const scroll = document.querySelector(".wx-scroll");
    return {
      cols: Object.fromEntries(
        cells.map((e) => [
          e.getAttribute("data-header-id").slice(1),
          Math.round(e.getBoundingClientRect().width),
        ])
      ),
      sum: Math.round(cells.reduce((n, e) => n + e.getBoundingClientRect().width, 0)),
      avail: scroll ? scroll.clientWidth : null,
      overflow: scroll ? scroll.scrollWidth - scroll.clientWidth : null,
    };
  });

test.describe("列表列宽", () => {
  test("按内容定比例，列宽加起来正好填满，不留白", async ({ page }) => {
    const { cols, sum, avail, overflow } = await layout(page);

    // 内容多的列占得多：名称 > 下次运行时间 > 状态 > 只放一个图标的操作列
    expect(cols.name).toBeGreaterThan(cols.nextRun);
    expect(cols.nextRun).toBeGreaterThan(cols.state);
    expect(cols.state).toBeGreaterThan(cols.remove);

    expect(overflow).toBe(0);
    expect(Math.abs(sum - avail)).toBeLessThanOrEqual(1);
  });

  test("拉宽窗口：每列按同一个倍数变宽，仍然填满", async ({ page }) => {
    const before = await layout(page);

    await page.setViewportSize({ width: 1720, height: 860 });
    await page.waitForTimeout(500);
    const after = await layout(page);

    expect(after.overflow).toBe(0);
    expect(Math.abs(after.sum - after.avail)).toBeLessThanOrEqual(1);

    // 等比：每列的放大倍数相同，差只来自四舍五入
    const ratios = Object.keys(before.cols).map((id) => after.cols[id] / before.cols[id]);
    expect(Math.min(...ratios)).toBeGreaterThan(1.05);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.02);

    // 宽度不是靠存档实现的，存档里压根不该有这一项
    expect((await savedFilters(page)).gridCols).toBeUndefined();
  });

  // 等比的另一半：窗口窄到各列触底之后，剩下的只能是横向滚动
  test("窄到各列触底后改为横向滚动", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 760 });
    await page.waitForSelector(".wx-row");
    await page.waitForTimeout(500);

    expect((await layout(page)).overflow).toBeGreaterThan(0);
  });
});

test.describe("左栏宽度", () => {
  test("拖动改宽度，双击回默认，落在盘上的值跟着走", async ({ page }) => {
    expect(await sidebarWidth(page)).toBe(232);

    const sash = await page.locator('[data-testid="sidebar-sash"]').boundingBox();
    const y = sash.y + 200;
    await page.mouse.move(sash.x + sash.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(sash.x + sash.width / 2 + 80, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const wide = await sidebarWidth(page);
    expect(wide).toBe(312);
    expect((await savedFilters(page)).sidebarWidth).toBe(wide);

    await page.locator('[data-testid="sidebar-sash"]').dblclick();
    await page.waitForTimeout(300);
    expect(await sidebarWidth(page)).toBe(232);
    expect((await savedFilters(page)).sidebarWidth).toBe(232);
  });

  test("刷新后保持上次的宽度", async ({ page }) => {
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem("tockola.filters.v3") || "{}");
      raw.sidebarWidth = 300;
      localStorage.setItem("tockola.filters.v3", JSON.stringify(raw));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".wx-row");

    expect(await sidebarWidth(page)).toBe(300);
  });
});
