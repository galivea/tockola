// 端到端测试的共享装置。
//
// 两件事是这里统一做的，也是老脚本最缺的两件事：
//   1. 每个用例拿到一张干净的页面（清掉上一轮落盘的状态再重新加载）——
//      用例之间不再需要手工复位，顺序也不会互相影响
//   2. 每个用例结束时复查运行时错误——老脚本只在开头查一次，
//      交互过程中页面炸了照样报全绿

import { test as base, expect } from "@playwright/test";

/** 用例运行期间收集到的运行时问题（未捕获异常 / console.error / 资源加载失败） */
const collect = (page) => {
  const found = [];
  page.on("pageerror", (e) => found.push(`未捕获异常：${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") found.push(`console.error：${m.text()}`);
  });
  page.on("requestfailed", (r) => found.push(`资源加载失败：${r.url()}`));
  return found;
};

export const test = base.extend({
  page: async ({ baseURL, browser }, use) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 860 },
      // 自建 context 不会继承 config 里的 use.locale，这里得再来一次；
      // 配合下面写死的 ts.locale，界面语言有两道保险
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
    const page = await context.newPage();
    const problems = collect(page);

    // 先落地一次，清掉上一轮落盘的状态，再把界面语言钉成简体中文后重新进入。
    // 语言必须显式写死：应用默认跟随 navigator.language，而浏览器 locale 是
    // Playwright 设备配置给的（en-US），不写死的话整套中文断言会随机变英文。
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("ts.locale", "zh");
    });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });

    // 等演示数据真的渲染出来。dev server 首次编译要几十秒，webServer 的
    // url 探测只看到端口通了就放行；少了这一步，最前面几个用例会跑在空白页上。
    await page.waitForSelector(".wx-row", { timeout: 30_000 });

    await use(page);

    // 每条用例都要干净收尾：交互中途报的错在这里才抓得到
    expect(problems, "用例运行期间不应有运行时错误").toEqual([]);
    await context.close();
  },
});

export { expect };
