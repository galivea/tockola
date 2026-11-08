// 语言包完整性：en 是 source of truth。
//
// zh 缺键会静默回退英文（界面上混中英，很难发现），多键通常是改名后忘了删，
// 或者键名打错 —— 后者会静默回退成把键名本身显示出来（"editor.saving"），
// 只有下面「源码引用的键」那道检查能发现。
// 后端错误码同理：Rust 只发 code，文案全在前端，漏一条用户看到的就是裸错误码。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import en from "../../../src/lib/i18n/en.js";
import zh from "../../../src/lib/i18n/zh.js";

const leaves = (o, prefix = "", out = []) => {
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") leaves(v, p, out);
    else out.push(p);
  }
  return out;
};

const collect = (dir, re, exts) => {
  const found = new Set();
  if (!fs.existsSync(dir)) return found;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (exts.test(e.name)) {
        for (const m of fs.readFileSync(full, "utf8").matchAll(re)) found.add(m[1]);
      }
    }
  };
  walk(dir);
  return found;
};

const enKeys = leaves(en).sort();
const enSet = new Set(enKeys);
const zhSet = new Set(leaves(zh));

describe("语言包键对齐", () => {
  it("zh 与 en 一一对应，不多不少", () => {
    const missing = enKeys.filter((k) => !zhSet.has(k));
    const extra = [...zhSet].filter((k) => !enSet.has(k)).sort();
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it("源码里引用的键在 en 里都有定义", () => {
    const referenced = collect("src", /\b(?:t|tr|i18n)\(\s*"([a-zA-Z0-9_.]+)"/g, /\.(js|svelte)$/);
    const dangling = [...referenced].filter((k) => !enSet.has(k)).sort();
    expect(referenced.size).toBeGreaterThan(0); // 扫不到东西说明正则或路径失效了
    expect(dangling).toEqual([]);
  });
});

describe("后端错误码 <-> 文案", () => {
  it("Rust 里出现过的每个 code 在两个语言包里都有，且没有多余的", () => {
    const codes = collect(
      "src-tauri/src",
      /\b(?:err|errd|map)\(\s*"([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)"/g,
      /\.rs$/
    );
    const noEn = [...codes].filter((c) => !enSet.has(`err.${c}`)).sort();
    const noZh = [...codes].filter((c) => !zhSet.has(`err.${c}`)).sort();
    const orphan = enKeys
      .filter((k) => k.startsWith("err.") && k !== "err.unknown")
      .map((k) => k.slice(4))
      .filter((c) => !codes.has(c))
      .sort();

    expect(codes.size).toBeGreaterThan(0);
    expect(noEn).toEqual([]);
    expect(noZh).toEqual([]);
    expect(orphan).toEqual([]);
  });
});
