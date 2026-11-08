<!--
  自绘标题栏。

  窗口是 frameless 的（tauri.conf.json 里 decorations: false），所以标题、拖动、
  最小化 / 最大化 / 关闭都由这一行自己负责。这样做的理由只有一个：把「帮助 / 关于」
  塞进窗口标题这一行，省掉它们单独占一行的高度。

  拖动由这一行自己接管：按下左键（且没落在按钮/输入框上）就调 startDragging()，
  双击同一区域切换最大化。没有依赖 Tauri 注入的 data-tauri-drag-region 脚本——那条
  路径悄悄失效的话，整扇窗就既不能挪也不能缩放，代价太大。
-->
<script>
  import MenuBar from "./MenuBar.svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { isTauri } from "../lib/api.js";
  import { flushWindowState } from "../lib/windowState.js";
  import { t } from "../lib/i18n/index.svelte.js";

  let { updaterBusy = false, onCheckUpdate, onAbout, onSettings } = $props();

  // Restoring, maximizing and restoring again all change this; the button shows
  // the box variants accordingly.
  let maximized = $state(false);

  // Anything the user expects to click rather than drag: window controls, the
  // Help / About titles, inputs.
  const CLICKABLE = "button, a, input, select, textarea, label, [role='menuitem']";

  function onInteractive(event) {
    return Boolean(event.target?.closest?.(CLICKABLE));
  }

  async function startDrag(event) {
    if (!isTauri || event.button !== 0 || event.detail > 1) return;
    if (onInteractive(event)) return;
    event.preventDefault(); // keeps the press from turning into a text cursor
    try {
      await getCurrentWindow().startDragging();
    } catch (e) {
      console.warn("failed to drag the window", e);
    }
  }

  function handleDoubleClick(event) {
    if (!isTauri || onInteractive(event)) return;
    toggleMaximize();
  }

  $effect(() => {
    if (!isTauri) return;
    let unResize = null;
    void (async () => {
      try {
        const win = getCurrentWindow();
        maximized = await win.isMaximized();
        unResize = await win.onResized(async () => {
          maximized = await win.isMaximized();
        });
      } catch (e) {
        console.warn("failed to follow the maximized state", e);
      }
    })();
    return () => unResize?.();
  });

  async function minimize() {
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      console.warn("failed to minimize the window", e);
    }
  }

  async function toggleMaximize() {
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (e) {
      console.warn("failed to toggle the maximized state", e);
    }
  }

  // The X button always asks the window to close. Whether that means "exit the
  // app" or "hide to the system tray" is decided by Rust in `CloseRequested`
  // (see src-tauri/src/lib.rs) from the user's Setting. Keeping that decision
  // in one place avoids the frontend and backend disagreeing about behavior.
  // `flushWindowState` runs first so the geometry is on file before the
  // webview may go away.
  async function close() {
    try {
      await flushWindowState();
    } catch (e) {
      console.warn("failed to flush the window state", e);
    }
    try {
      await getCurrentWindow().close();
    } catch (e) {
      console.warn("failed to close the window", e);
    }
  }
</script>

<header class="titlebar" role="toolbar" aria-label="窗口标题栏" onmousedown={startDrag} ondblclick={handleDoubleClick}>
  <span class="brand">
    <img class="logo" src="/favicon.svg" alt="" draggable="false" />
    <span class="name">Tockola</span>
  </span>

  <!-- 帮助 / 关于紧挨窗口标题右侧 -->
  <MenuBar {updaterBusy} {onCheckUpdate} {onAbout} {onSettings} />

  {#if isTauri}
    <span class="ctls">
      <button class="ctl" type="button" onclick={minimize} title={t("winctl.minimize")} data-testid="win-minimize">
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" /></svg>
      </button>
      <button
        class="ctl"
        type="button"
        onclick={toggleMaximize}
        title={maximized ? t("winctl.restore") : t("winctl.maximize")}
        data-testid="win-maximize"
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          {#if maximized}
            <path d="M2.5 1h5.5v5.5" class="o" />
            <rect x="1" y="3.5" width="5.5" height="5.5" class="o f" />
          {:else}
            <rect x="1.5" y="1.5" width="7" height="7" class="o" />
          {/if}
        </svg>
      </button>
      <button class="ctl close" type="button" onclick={close} title={t("winctl.close")} data-testid="win-close">
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>
      </button>
    </span>
  {/if}
</header>

<style>
  .titlebar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 32px;
    padding-left: 12px;
    background: #f2f4f8;
    /* select() calls preventDefault on mousedown; dragging the window has to stay ours */
    user-select: none;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .logo {
    width: 15px;
    height: 15px;
    border-radius: 3px;
  }

  .name {
    font-size: 12px;
    font-weight: 600;
    color: #55617a;
    letter-spacing: 0.2px;
  }

  .ctls {
    display: flex;
    align-items: stretch;
    margin-left: auto;
  }

  /* Windows geometry: 45px wide, ~29px tall, no divider between them. */
  .ctl {
    width: 45px;
    height: 29px;
    border: none;
    background: transparent;
    color: #55617a;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: default;
  }

  .ctl svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 0.9;
  }

  .ctl svg .f {
    fill: #f2f4f8;
  }

  .ctl:hover {
    background: #e2e7ee;
  }

  .ctl:active {
    background: #d6dce5;
  }

  .ctl.close:hover {
    background: #e81123;
    color: #fff;
  }

  .ctl.close:active {
    background: #c50f1f;
    color: #fff;
  }
</style>
