import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/svelte";

// The real APIs are side-effect free fakes; the only thing under test is that
// TitleBar forwards the right window call from the right region.
const win = {
  startDragging: vi.fn(),
  startResizeDragging: vi.fn(),
  toggleMaximize: vi.fn(),
  minimize: vi.fn(),
  close: vi.fn(),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  onResized: vi.fn(() => Promise.resolve(() => {})),
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => win,
}));
vi.mock("../../../src/lib/api.js", () => ({ isTauri: true }));
vi.mock("../../../src/lib/windowState.js", () => ({
  flushWindowState: vi.fn(() => Promise.resolve()),
}));

import TitleBar from "../../../src/components/TitleBar.svelte";

beforeEach(() => {
  cleanup();
  Object.values(win).forEach((fn) => fn.mockClear());
});

describe("TitleBar drags and resizes from the window API", () => {
  it("drags the window when pressing empty title-bar space (not a control)", async () => {
    const { container } = render(TitleBar, {
      props: { updaterBusy: false },
    });
    const bar = container.querySelector(".titlebar");
    // press on the brand (not a button) -> should start dragging
    await fireEvent.mouseDown(bar.querySelector(".brand"));
    expect(win.startDragging).toHaveBeenCalledOnce();
    expect(win.startResizeDragging).not.toHaveBeenCalled();
  });

  it("does NOT drag when pressing a window control button", async () => {
    const { container } = render(TitleBar, {
      props: { updaterBusy: false },
    });
    const closeBtn = container.querySelector('[data-testid="win-close"]');
    await fireEvent.mouseDown(closeBtn);
    expect(win.startDragging).not.toHaveBeenCalled();
  });

  it("double-clicking empty title-bar space toggles maximize", async () => {
    const { container } = render(TitleBar, {
      props: { updaterBusy: false },
    });
    const bar = container.querySelector(".titlebar");
    await fireEvent.dblClick(bar.querySelector(".brand"));
    expect(win.toggleMaximize).toHaveBeenCalledOnce();
  });

  it("does NOT toggle maximize when double-clicking a control", async () => {
    const { container } = render(TitleBar, {
      props: { updaterBusy: false },
    });
    const maxBtn = container.querySelector('[data-testid="win-maximize"]');
    await fireEvent.dblClick(maxBtn);
    expect(win.toggleMaximize).not.toHaveBeenCalled();
  });
});
