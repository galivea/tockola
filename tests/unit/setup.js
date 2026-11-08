// 每个测试文件的公共准备。
// 这里刻意不设置 window.__TAURI_INTERNALS__：默认走「非 Tauri」分支，
// 也就是浏览器演示模式用的 Web 存储通道。需要测 Tauri 通道的用例自己在文件里
// 用 vi.stubGlobal + vi.resetModules 打开，避免两条通道互相污染。

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/svelte";
import { bindLocale } from "../../src/lib/i18n/index.js";

// 断言里写的是中文文案，整份套件钉在 zh，不依赖宿主环境（CI 与本机可能不同）。
// 要测英文包的文件自己在文件内切换。
bindLocale(() => "zh");

afterEach(() => {
  // 不清理的话上一个用例挂的 DOM 还在，下一个用例的 getBy* 会报「找到多个」
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // 有些环境没有 localStorage，忽略
  }
});
