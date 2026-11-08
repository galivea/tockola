/**
 * Persisting window size, position and maximized state.
 *
 * Why not the official window-state plugin: that means a new crate, and this
 * machine has to build offline (no registry round-trip available). Everything
 * here runs on pieces already shipped — the store plugin writes the file, and
 * @tauri-apps/api talks to the window.
 *
 * The file is separate from filters.json on purpose: on-start restore reads it
 * before the UI exists, and it should not be able to trip over a half-written
 * filter state.
 *
 * Sizes are stored in logical units. Windows hands back physical pixels and the
 * scale factor depends on the monitor, so persisting raw pixels makes a saved
 * size visibly jump when the window comes back on a display with a different
 * DPI.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { isTauri } from "./api.js";

const STORE_FILE = "window.json";
const STORE_KEY = "window";

// Long enough that dragging an edge is one write, short enough that killing the
// process right after a resize still keeps the last geometry.
const SAVE_DELAY = 500;

// The window cannot legally be smaller than the layout itself; values outside
// this range come from a hand-edited file or a monitor that has gone away.
const MIN_SIZE = { width: 800, height: 560 };

// Windows parks a window it has taken off screen — minimized, or hidden while
// the app starts — at (-32000, -32000). outerPosition() reports that number
// like any other coordinate, so saving it puts the window off screen on the
// next launch, where no amount of clicking finds it. Anything further out than
// a generous multi-monitor setup can reach is treated as "not a position".
const OFFSCREEN_LIMIT = 8000;

function isOnScreen(x, y) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Math.abs(x) < OFFSCREEN_LIMIT &&
    Math.abs(y) < OFFSCREEN_LIMIT
  );
}

let storePromise = null;

function getStore() {
  if (!isTauri) return Promise.resolve(null);
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store")
      .then((m) => m.load(STORE_FILE, { autoSave: 100 }))
      .catch((e) => {
        console.warn("window store unavailable, geometry will not persist", e);
        storePromise = null;
        return null;
      });
  }
  return storePromise;
}

export function sanitize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const width = num(raw.width);
  const height = num(raw.height);
  if (width === null || height === null) return null;
  const x = num(raw.x);
  const y = num(raw.y);
  const at = isOnScreen(x, y) ? { x: Math.round(x), y: Math.round(y) } : { x: null, y: null };
  return {
    width: Math.max(MIN_SIZE.width, Math.round(width)),
    height: Math.max(MIN_SIZE.height, Math.round(height)),
    ...at,
    maximized: raw.maximized === true,
  };
}

/** Geometry to restore, or null when there is nothing usable yet. */
export async function readWindowState() {
  if (!isTauri) return null;
  try {
    const store = await getStore();
    if (!store) return null;
    return sanitize(await store.get(STORE_KEY));
  } catch (e) {
    console.warn("failed to read the window state", e);
    return null;
  }
}

/**
 * Apply the saved geometry once at startup. Run before the first paint would be
 * ideal, but restoring needs the window handle, so this is called from main.js
 * right before mount — one frame at the configured default.
 */
export async function restoreWindow() {
  const saved = await readWindowState();
  if (!saved) return;
  try {
    const win = getCurrentWindow();
    if (saved.maximized) {
      await win.maximize();
      return;
    }
    await win.setSize(new LogicalSize(saved.width, saved.height));
    if (saved.x !== null && saved.y !== null) {
      await win.setPosition(new LogicalPosition(saved.x, saved.y));
    }
  } catch (e) {
    // A monitor unplugged since the last run makes an off-screen position
    // reject; the window stays where the OS put it, which is fine.
    console.warn("failed to restore the window geometry", e);
  }
}

/**
 * Keep the file in step with resizing. Called once at mount; resolves to a
 * teardown that App never needs (the watcher lives as long as the window).
 */
export async function watchWindow() {
  if (!isTauri) return () => {};
  const win = getCurrentWindow();
  const queue = debounce(() => snapshot(win));

  let unlisten = () => {};
  try {
    const [unResize, unMove] = await Promise.all([win.onResized(queue), win.onMoved(queue)]);
    unlisten = () => {
      unResize();
      unMove();
    };
  } catch (e) {
    console.warn("failed to watch the window geometry", e);
  }

  return () => {
    unlisten();
    queue.cancel();
  };
}

/**
 * Record the geometry once, right now.
 *
 * The watcher debounces, so resizing and quitting inside half a second would
 * leave the previous size on file. A frameless window has no system close box,
 * so closing from our own button needs this call before the webview goes away.
 */
export async function flushWindowState() {
  if (!isTauri) return;
  try {
    await snapshot(getCurrentWindow());
  } catch (e) {
    console.warn("failed to record the window geometry", e);
  }
}

/** One sample of size, position and maximized state, written to the store. */
async function snapshot(win) {
  const [factor, size, position, maximized, minimized] = await Promise.all([
    win.scaleFactor(),
    win.innerSize(),
    win.outerPosition(),
    win.isMaximized(),
    win.isMinimized(),
  ]);
  // While maximized the window reports the screen's size; writing it down
  // would make the next launch open "maximized" as a normal window.
  if (maximized) {
    await write({ maximized: true });
    return;
  }
  // A minimized window reports no geometry worth keeping: the size is the
  // taskbar icon's and the position is off screen. Whatever is on file from
  // the last visible frame stays.
  if (minimized) return;
  const logical = size.toLogical(factor);
  const at = position.toLogical(factor);
  await write({
    width: Math.round(logical.width),
    height: Math.round(logical.height),
    x: Math.round(at.x),
    y: Math.round(at.y),
    maximized: false,
  });
}

/** Debounced so dragging an edge is one write, cancellable for teardown. */
function debounce(fn) {
  let timer = null;
  const run = () => {
    clearTimeout(timer);
    timer = setTimeout(fn, SAVE_DELAY);
  };
  run.cancel = () => clearTimeout(timer);
  return run;
}

// Only the five keys this module owns are written back. Merging whatever is
// already in the file would carry forward junk a debug build left behind and
// make the file impossible to read.
async function write(state) {
  const store = await getStore();
  if (!store) return;
  const prev = await store.get(STORE_KEY);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  const kept =
    prev && typeof prev === "object"
      ? {
          width: num(prev.width),
          height: num(prev.height),
          // An off-screen position on file is worse than none: keep the size,
          // drop the coordinates, and the next launch opens at the OS default.
          ...(isOnScreen(num(prev.x), num(prev.y))
            ? { x: num(prev.x), y: num(prev.y) }
            : {}),
        }
      : {};
  await store.set(STORE_KEY, { ...kept, ...state });
}
