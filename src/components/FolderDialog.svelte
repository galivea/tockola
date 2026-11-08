<script>
  // Create / rename / delete-confirm folder
  // mode: create | rename | delete
  import { t } from "../lib/i18n/index.svelte.js";

  let { mode, path = "", name = "", busy = false, onConfirm, onClose } = $props();

  let value = $state("");
  let error = $state("");
  let el = $state(null);

  // Reset the input whenever mode / name changes: if the component is reused (swapped
  // to another folder without unmounting), seeding $state once would leave the
  // previous folder's name behind
  $effect(() => {
    value = mode === "rename" ? name : "";
    error = "";
  });

  const ILLEGAL = /[\\/:"]/;

  const title = $derived(
    mode === "create"
      ? t("folder.titleCreate")
      : mode === "rename"
        ? t("folder.titleRename")
        : t("folder.titleDelete")
  );

  // The hint shows the parent path so the user knows which level is created / changed
  const parentOf = $derived.by(() => {
    const segs = String(path || "\\").split("\\").filter(Boolean);
    if (mode === "rename") segs.pop();
    return segs.length ? "\\" + segs.join("\\") + "\\" : "\\";
  });

  $effect(() => {
    if (el) el.focus();
  });

  // Folder names that already exist at this level, for the inline hint (keeping
  // the original name while renaming counts as "unchanged")
  function validate(v) {
    const s = (v ?? "").trim();
    if (!s) return t("folder.emptyErr");
    if (ILLEGAL.test(s)) return t("folder.illegalErr");
    return "";
  }

  function submit() {
    if (mode === "delete") {
      onConfirm?.("");
      return;
    }
    const msg = validate(value);
    if (msg) {
      error = msg;
      return;
    }
    onConfirm?.(value.trim());
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }
</script>

<!-- Esc has to work across the whole dialog: after clicking Confirm the focus sits on
     the button, so listening on the input alone would miss the key event -->
<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      onClose?.();
    }
  }}
/>

<div class="mask" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose?.()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={title} data-testid="folder-dialog">
    <div class="head">
      <h3>{title}</h3>
      <button class="close" type="button" aria-label={t("common.close")} onclick={() => onClose?.()}>✕</button>
    </div>

    <div class="body">
      {#if mode === "delete"}
        <p class="text">
          {t("folder.deleteAskPre")}<b class="mono">{path}</b>{t("folder.deleteAskPost")}
        </p>
        <p class="text warn">
          {t("folder.deleteWarn")}
        </p>
      {:else}
        <label class="field">
          <span class="lb">{t("folder.nameLabel")}</span>
          <input
            bind:this={el}
            bind:value
            type="text"
            placeholder={t("folder.placeholder")}
            data-testid="folder-name-input"
            oninput={() => (error = "")}
            onkeydown={onKeydown}
          />
        </label>
        {#if mode === "create"}
          <p class="hint">{t("folder.createHint")}<b class="mono">{path}</b>{t("folder.hintTailCreate")}</p>
        {:else}
          <p class="hint">{t("folder.renameHint")}<b class="mono">{parentOf}</b>{t("folder.hintTailRename")}</p>
        {/if}
        {#if error}<p class="err">{error}</p>{/if}
      {/if}
    </div>

    <div class="foot">
      <button class="btn" type="button" onclick={() => onClose?.()} disabled={busy}>{t("common.cancel")}</button>
      <button
        class="btn primary"
        class:danger={mode === "delete"}
        type="button"
        onclick={submit}
        disabled={busy}
        data-testid="folder-confirm"
      >
        {busy ? t("folder.busy") : mode === "delete" ? t("folder.delete") : t("common.confirm")}
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
    z-index: 80;
  }

  .dialog {
    width: 400px;
    max-width: calc(100vw - 40px);
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 18px 48px rgba(20, 30, 45, 0.3);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #eef2f8;
  }

  .head h3 {
    margin: 0;
    font-size: 14.5px;
    color: #22303f;
  }

  .close {
    width: 26px;
    height: 26px;
    border: none;
    background: none;
    border-radius: 4px;
    color: #7a8699;
    font-size: 14px;
    cursor: pointer;
  }

  .close:hover {
    background: #f1f4f8;
    color: #22303f;
  }

  .body {
    padding: 14px 16px;
  }

  .text {
    margin: 0 0 8px;
    font-size: 13px;
    color: #2f3742;
    line-height: 1.6;
  }

  .text.warn {
    color: #b34a13;
  }


  .hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: #7a8699;
  }

  .err {
    margin: 8px 0 0;
    font-size: 12px;
    color: #c5221f;
  }

  .mono {
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 12.5px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .lb {
    font-size: 12.5px;
    color: #5a6678;
  }

  .field input {
    height: 30px;
    padding: 0 8px;
    border: 1px solid #d6dde7;
    border-radius: 5px;
    font-size: 13px;
    outline: none;
  }

  .field input:focus {
    border-color: #1a73e8;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid #eef2f8;
    background: #fafbfd;
  }

  .btn {
    min-width: 72px;
    height: 30px;
    border: 1px solid #d6dde7;
    background: #fff;
    border-radius: 5px;
    font-size: 13px;
    color: #44506b;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    border-color: #1a73e8;
    color: #1a73e8;
  }

  .btn.primary:not(.danger) {
    background: #1a73e8;
    border-color: #1a73e8;
    color: #fff;
  }

  .btn.primary:not(.danger):hover:not(:disabled) {
    background: #1668d1;
    color: #fff;
  }

  .btn.danger {
    background: #d93025;
    border-color: #d93025;
    color: #fff;
  }

  .btn.danger:hover:not(:disabled) {
    background: #b9261d;
    color: #fff;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
