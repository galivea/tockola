import { describe, it, expect } from "vitest";
import {
  loadCloseBehavior,
  saveCloseBehavior,
  CLOSE_QUIT,
  CLOSE_TRAY,
} from "../../../src/lib/settings.js";

const WEB_KEY = "tockola.settings.v1";
const LEGACY_KEY = "rhyzal.settings.v1";

describe("Close behavior persistence (browser fallback)", () => {
  it("migrates the pre-rename key on first read", async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ closeBehavior: CLOSE_TRAY }));

    expect(await loadCloseBehavior()).toBe(CLOSE_TRAY);
    expect(localStorage.getItem(WEB_KEY)).toBe(
      JSON.stringify({ closeBehavior: CLOSE_TRAY })
    );
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("keeps the new key authoritative when both exist", async () => {
    localStorage.setItem(WEB_KEY, JSON.stringify({ closeBehavior: CLOSE_QUIT }));
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ closeBehavior: CLOSE_TRAY }));

    expect(await loadCloseBehavior()).toBe(CLOSE_QUIT);
  });

  it("writes new state under the new key", async () => {
    await saveCloseBehavior(CLOSE_TRAY);
    expect(localStorage.getItem(WEB_KEY)).toBe(
      JSON.stringify({ closeBehavior: CLOSE_TRAY })
    );
  });
});
