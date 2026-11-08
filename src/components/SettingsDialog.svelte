<!--
  设置对话框：从 Help 菜单进入。

  只有两项偏好，都和「整台应用怎么表现」有关，不是对单条任务的操作：
    - 语言：与托盘菜单的语言子菜单同一来源（setLocale），改这里等于改那里。
    - 关闭窗口时：直接关闭程序 / 最小化到托盘。这个值会推给 Rust，
      由原生关闭路径（X 按钮、Alt+F4）按它决定隐藏进托盘还是退出。

  布局遵循桌面应用设置页的主流做法（Windows / GNOME / KDE HIG）：偏好数量
  很少时用单列分组，每项是一行「标签在左、控件在右」，分组用标题 + 分隔线，
  互斥选项用下拉框，单项改动即时生效。
-->
<script>
  import { t, getLocale, setLocale, LANGS } from "../lib/i18n/index.svelte.js";
  import {
    getCloseBehavior,
    saveCloseBehavior,
    CLOSE_QUIT,
    CLOSE_TRAY,
  } from "../lib/settings.js";

  let { onClose } = $props();

  // Local mirrors so the selects track the active choice without a round-trip.
  let lang = $state(getLocale());
  let closeBehavior = $state(getCloseBehavior());

  function onLang(e) {
    lang = e.currentTarget.value;
    setLocale(lang);
  }

  function onCloseBehavior(e) {
    closeBehavior = e.currentTarget.value;
    // Persist + push to Rust (so the native close path honors it next time).
    saveCloseBehavior(closeBehavior);
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onClose?.();
  }}
/>

<div
  class="mask"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && onClose?.()}
>
  <div class="panel" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
    <header class="head">
      <h3 class="title">{t("settings.title")}</h3>
      <button class="x" type="button" aria-label={t("settings.done")} onclick={() => onClose?.()}>
        ×
      </button>
    </header>

    <div class="body">
      <section class="group">
        <h4 class="ghead">{t("settings.general")}</h4>

        <div class="row">
          <label class="rlabel" for="set-lang">{t("settings.language")}</label>
          <div class="rctl">
            <select id="set-lang" class="select" bind:value={lang} onchange={onLang}>
              {#each LANGS as l (l.id)}
                <option value={l.id}>{l.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="row">
          <label class="rlabel" for="set-close">{t("settings.closeBehavior")}</label>
          <div class="rctl">
            <select id="set-close" class="select" bind:value={closeBehavior} onchange={onCloseBehavior}>
              <option value={CLOSE_QUIT}>{t("settings.closeQuit")}</option>
              <option value={CLOSE_TRAY}>{t("settings.closeTray")}</option>
            </select>
            <p class="hint">
              {closeBehavior === CLOSE_TRAY ? t("settings.closeTrayHint") : t("settings.closeQuitHint")}
            </p>
          </div>
        </div>
      </section>
    </div>

    <footer class="foot">
      <button class="done" type="button" onclick={() => onClose?.()} data-testid="settings-done">
        {t("settings.done")}
      </button>
    </footer>
  </div>
</div>

<style>
  .mask {
    position: fixed;
    inset: 0;
    background: rgba(24, 33, 46, 0.42);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 70;
  }

  .panel {
    width: 440px;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 20px 48px rgba(20, 30, 45, 0.28);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 12px 20px;
  }

  .title {
    margin: 0;
    font-size: 16px;
    color: #22303f;
  }

  .x {
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    border-radius: 5px;
    color: #6a7689;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }

  .x:hover {
    background: #eef1f6;
    color: #22303f;
  }

  .body {
    padding: 0 20px 6px;
  }

  .group {
    padding: 4px 0 6px;
  }

  /* 分组标题：小号加粗灰字，与 Windows / GNOME HIG 的「分组用标题 + 分隔线」一致 */
  .ghead {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: #6a7689;
  }

  /* 每项一行：标签列固定宽度，控件列占满剩余；首行无上分隔线 */
  .row {
    display: grid;
    grid-template-columns: 116px 1fr;
    align-items: center;
    gap: 12px;
    padding: 11px 0;
    border-top: 1px solid #eef1f6;
  }

  .row:first-of-type {
    border-top: none;
  }

  .rlabel {
    font-size: 13px;
    color: #2f3742;
  }

  .rctl {
    min-width: 0;
  }

  .select {
    width: 100%;
    max-width: 240px;
    height: 30px;
    border: 1px solid #d8e0ea;
    border-radius: 5px;
    padding: 0 8px;
    font-size: 13px;
    color: #2f3742;
    background: #fff;
    outline: none;
  }

  .select:focus {
    border-color: #1a73e8;
  }

  .hint {
    margin: 6px 0 0;
    font-size: 11.5px;
    color: #8b95a5;
    line-height: 1.5;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    padding: 8px 20px 16px;
  }

  .done {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 16px;
    border: 1px solid #1a73e8;
    background: #1a73e8;
    border-radius: 5px;
    font: inherit;
    font-size: 13px;
    color: #fff;
    cursor: pointer;
  }

  .done:hover {
    background: #1665cc;
    border-color: #1665cc;
  }
</style>
