<!--
  菜单栏：帮助 / 关于，靠窗口右上角。

  桌面应用的惯例是「跟整个应用有关的东西」挂在窗口边缘：语言属于偏好，检查更新与关于
  属于应用自身，它们都不是对某条任务的操作，所以从任务区的工具条搬到了这里。
-->
<script>
  import { t } from "../lib/i18n/index.svelte.js";
  import { isTauri } from "../lib/api.js";

  let {
    updaterBusy = false,
    onCheckUpdate,
    onAbout,
    onSettings,
  } = $props();

  // Which dropdown is open. One at a time: a menu bar with two panels hanging
  // open at once reads like a bug.
  let open = $state("");

  function toggle(name) {
    open = open === name ? "" : name;
  }

  function runCheckUpdate() {
    closeAll();
    onCheckUpdate?.();
  }

  function runAbout() {
    closeAll();
    onAbout?.();
  }

  function runSettings() {
    closeAll();
    onSettings?.();
  }

  function closeAll() {
    open = "";
  }

  // Clicking anywhere outside closes; clicking a menu button is left to its own
  // click handler, or pointerdown would close it just before it reopens.
  function onOutside(e) {
    if (!open) return;
    if (e.target?.closest?.(".menu")) return;
    closeAll();
  }
</script>

<svelte:window
  onpointerdown={onOutside}
  onkeydown={(e) => {
    if (e.key === "Escape") closeAll();
  }}
/>

<nav class="menubar">
  <div class="menu">
    <button
      class="menu-btn"
      class:active={open === "help"}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open === "help"}
      onclick={() => toggle("help")}
      onpointerenter={() => open && toggle("help")}
      data-testid="menu-help">{t("menu.help")}</button
    >
    {#if open === "help"}
      <div class="pop" role="menu" data-testid="menu-help-pop">
        <button class="item" type="button" role="menuitem" onclick={runSettings} data-testid="menu-settings">
          {t("menu.settings")}
        </button>
      </div>
    {/if}
  </div>

  <div class="menu">
    <button
      class="menu-btn"
      class:active={open === "about"}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open === "about"}
      onclick={() => toggle("about")}
      onpointerenter={() => open && toggle("about")}
      data-testid="menu-about">{t("menu.about")}</button
    >
    {#if open === "about"}
      <div class="pop" role="menu" data-testid="menu-about-pop">
        <button class="item" type="button" role="menuitem" onclick={runAbout} data-testid="about-app">
          {t("menu.aboutApp")}
        </button>
        <button
          class="item"
          type="button"
          role="menuitem"
          onclick={runCheckUpdate}
          disabled={!isTauri || updaterBusy}
          title={isTauri ? t("app.updaterTip") : t("app.updaterTipDemo")}
          data-testid="check-update"
        >
          {updaterBusy ? t("app.updaterChecking") : t("app.updaterCheck")}
        </button>
      </div>
    {/if}
  </div>
</nav>

<style>
  /* Sits right after the window title; the title bar owns the spacing. */
  .menubar {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .menu {
    position: relative;
  }

  /* Text-only menu titles: they are not actions, they open a list. */
  .menu-btn {
    height: 26px;
    padding: 0 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #44506b;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .menu-btn:hover,
  .menu-btn.active {
    background: #e4eaf3;
    color: #22303f;
  }

  .pop {
    position: absolute;
    top: calc(100% + 4px);
    /* Left-aligned under its title, so a panel never runs past the window edge
       at the right; the language list then has the whole row to grow into. */
    left: 0;
    min-width: 176px;
    padding: 5px;
    background: #fff;
    border: 1px solid #dfe5ee;
    border-radius: 7px;
    box-shadow: 0 10px 26px rgba(20, 30, 45, 0.16);
    transition: transform 0.12s ease;
    z-index: 40;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #2f3742;
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }

  .item:hover:not(:disabled),
  .item.active {
    background: #eef3fb;
  }

  .item:disabled {
    color: #a6b0be;
    cursor: not-allowed;
  }

  .item.on {
    color: #1a73e8;
    font-weight: 600;
  }

  .item :global(.icon) {
    color: #98a3b3;
  }

</style>
