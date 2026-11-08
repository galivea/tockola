/**
 * 真机验证：编辑页保存不丢配置
 *
 * 保存是全量重写 XML，所以提交前五个分区都必须读到真实数据，
 * 否则默认值会把触发器 / 操作冲掉。这个脚本在真实桌面端上跑一遍：
 * 记下触发器数量与执行命令 → 只改描述 → 保存 → 再打开逐项比对。
 *
 * 用法：
 *   1. 用调试端口启动桌面端：
 *      npx tauri build --no-bundle --config "{\"app\":{\"windows\":[{\"label\":\"main\",\"additionalBrowserArgs\":\"--remote-debugging-port=9223\"}]}}"
 *   2. 打开生成的 exe
 *   3. node scripts/verify-edit-save.mjs
 */
import { chromium } from "playwright-core";

const port = "9223";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const pages = browser.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => !p.url().startsWith("devtools")) ?? pages[0];
if (!page) {
  console.error("未找到桌面端页面");
  process.exit(1);
}
console.log(`已连接: ${page.url()}\n`);

const row = page.locator(".wx-row").first();
await row.waitFor({ state: "visible", timeout: 15000 });
const taskName = (await row.locator(".wx-cell").first().textContent())?.trim() ?? "";
console.log(`观察任务: ${taskName}\n`);

const waitReady = () =>
  page
    .waitForFunction(() => !document.querySelector('[data-testid="editor-busy"]'), null, {
      timeout: 30000,
    })
    .catch(() => {});

// 打开编辑页（与新建页同一个页面）
const openEditor = async () => {
  await row.locator('button[data-action="edit"]').first().click();
  const dialog = page.locator('[role="dialog"]').filter({ hasText: "修改任务" });
  await dialog.waitFor({ timeout: 10000 });
  await waitReady();
  return dialog;
};

// 1) 先记下现状
let dialog = await openEditor();
const trigBefore = await page.locator("#sec-triggers .trow").count();
const cmdBefore = await page.locator('#sec-actions [data-testid="cmd-input"]').first().inputValue();
check("编辑页读到触发器", trigBefore > 0, `${trigBefore} 个`);
check("编辑页读到执行命令", (cmdBefore ?? "").length > 0, cmdBefore);
await page.locator('[role="dialog"] .close').first().click();
await page.waitForTimeout(500);

// 2) 只改描述并保存
dialog = await openEditor();
const stamp = `编辑页保存验证 ${Date.now()}`;
const descInput = dialog.locator("#sec-identity input").nth(1);
await descInput.fill(stamp);
await page.getByRole("button", { name: "保存", exact: true }).click();
await page.waitForTimeout(3000);
check("保存后弹窗关闭", (await page.locator('[role="dialog"]').count()) === 0);

// 3) 再打开比对：触发器与操作必须原样
dialog = await openEditor();
const trigAfter = await page.locator("#sec-triggers .trow").count();
const cmdAfter = await page.locator('#sec-actions [data-testid="cmd-input"]').first().inputValue();
const descNow = await page.locator("#sec-identity input").nth(1).inputValue();
check("保存后触发器数量不变", trigAfter === trigBefore, `${trigBefore} → ${trigAfter}`);
check("保存后执行命令不变", cmdAfter === cmdBefore, `${cmdBefore} → ${cmdAfter}`);
check("描述已保存到任务里", descNow === stamp, `${descNow}`);
await page.locator('[role="dialog"] .close').first().click();
await page.waitForTimeout(300);

console.log(`\n=== 结果: ${failed === 0 ? "全部通过" : `${failed} 项失败`} ===`);
process.exit(failed ? 1 : 0);
