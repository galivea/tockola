<!--
  关于对话框：产品是什么、版本号、以及名字的来处。

  名字需要解释，否则第一次看到的人只会把它当成一串随机字母。
-->
<script>
  import { t } from "../lib/i18n/index.svelte.js";
  import { APP_VERSION } from "../lib/version.js";

  let { onClose } = $props();
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
  <div class="about" role="dialog" aria-modal="true" aria-label={t("menu.aboutApp")}>
    <div class="head">
      <img class="logo" src="/favicon.svg" alt="" />
      <div class="id">
        <span class="wordmark">Tockola</span>
        <span class="ver">{t("about.versionLine", { version: APP_VERSION })}</span>
      </div>
    </div>

    <p class="tagline">{t("about.tagline")}</p>

    <div class="origin">
      <span class="cap">{t("about.originTitle")}</span>
      <p>{t("about.origin")}</p>
    </div>

    <div class="foot">
      <span>{t("about.license")}</span>
      <span class="dot">·</span>
      <span>{t("about.homepage")}</span>
      <a href="https://github.com/galivea/tockola" target="_blank" rel="noreferrer">
        github.com/galivea/tockola
      </a>
      <span class="grow"></span>
      <button class="tb" type="button" onclick={() => onClose?.()} data-testid="about-close">
        <span>{t("menu.close")}</span>
      </button>
    </div>
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

  .about {
    width: 460px;
    background: #fff;
    border-radius: 10px;
    padding: 20px 22px 16px;
    box-shadow: 0 20px 48px rgba(20, 30, 45, 0.28);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo {
    width: 46px;
    height: 46px;
    border-radius: 10px;
  }

  .id {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .wordmark {
    font-size: 19px;
    font-weight: 700;
    color: #22303f;
    letter-spacing: 0.3px;
  }

  .ver {
    font-size: 12px;
    color: #8b95a5;
  }

  .tagline {
    margin: 14px 0 0;
    font-size: 13px;
    line-height: 1.7;
    color: #4d5867;
  }

  .origin {
    margin-top: 14px;
    padding: 10px 12px;
    background: #f6f8fc;
    border: 1px solid #e8edf5;
    border-radius: 8px;
  }

  .cap {
    font-size: 11.5px;
    color: #8b95a5;
  }

  .origin p {
    margin: 4px 0 0;
    font-size: 12.5px;
    line-height: 1.75;
    color: #3c4757;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 16px;
    font-size: 12px;
    color: #8b95a5;
  }

  .foot a {
    color: #1a73e8;
    text-decoration: none;
  }

  .foot a:hover {
    text-decoration: underline;
  }

  .dot {
    color: #c2cad6;
  }

  .grow {
    flex: 1;
  }

  .tb {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 12px;
    border: 1px solid #d8e0ea;
    background: #fff;
    border-radius: 5px;
    font: inherit;
    font-size: 12.5px;
    color: #44506b;
    cursor: pointer;
  }

  .tb:hover {
    border-color: #1a73e8;
    color: #1a73e8;
  }
</style>
