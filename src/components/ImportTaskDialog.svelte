<script>
  import * as api from "../lib/api.js";
  import Icon from "./icons/Icon.svelte";
  import { t } from "../lib/i18n/index.svelte.js";
  import { errText } from "../lib/errors.js";

  let { onClose, onImported } = $props();

  // Import is a copy, not an edit: the XML alone decides the name, the folder, the
  // account, the triggers and the actions, so the dialog shows nothing but the file
  // that is about to go in — pick the files, drop the ones you did not mean, confirm.
  // The one thing the XML cannot carry is the password of a task saved with one, so
  // that is the one extra box.
  //
  // Windows registers one task per call, so several files are still N calls; the
  // dialog keeps them together so one failure never takes the rest down with it.
  let items = $state([]);
  // Files that were picked but hold no <Task>; worth naming, since the picker
  // silently accepts them.
  let skipped = $state([]);
  let busy = $state(false);
  let seq = 0;

  // <URI> gives the name — and the folder, which the backend reads from the same
  // tag, so nothing here overrides it. <UserId> is the account it runs as;
  // <LogonType> says whether a password is missing. Nothing is parsed in order to
  // be rewritten — the XML is registered whole.
  function parseMeta(text, fallbackName) {
    const uri = /<URI>([\s\S]*?)<\/URI>/i.exec(text)?.[1]?.trim() ?? "";
    const full = uri.replace(/\//g, "\\");
    const p = full.startsWith("\\") ? full : `\\${full}`;
    const i = p.lastIndexOf("\\");
    return {
      // An XML with no <URI> is unusual but legal; the file name is the only name
      // there is to hand.
      name: (i >= 0 ? p.slice(i + 1) : p.replace(/^\\/, "")) || fallbackName,
      user: /<UserId>([\s\S]*?)<\/UserId>/i.exec(text)?.[1]?.trim() ?? "",
      // XML never contains the password, so a Password logon task cannot run
      // until one is supplied here.
      needPassword: /<LogonType>\s*Password\s*<\/LogonType>/i.test(text),
    };
  }

  async function pick(event) {
    const input = event.currentTarget;
    const files = [...(input.files ?? [])];
    // Clearing lets the same file be picked again after being removed.
    input.value = "";
    if (!files.length) return;

    const bad = [];
    const added = [];
    for (const f of files) {
      try {
        const text = await f.text();
        if (!/<Task[\s>]/i.test(text)) {
          bad.push(f.name);
          continue;
        }
        const fallback = f.name.replace(/\.xml$/i, "");
        added.push({
          id: ++seq,
          file: f.name,
          xml: text,
          password: "",
          error: "",
          ...parseMeta(text, fallback),
        });
      } catch {
        bad.push(f.name);
      }
    }

    skipped = bad;
    // Re-picking a file already in the list refreshes that entry instead of
    // adding a second one — two entries with the same name would fight over
    // the same task.
    const merged = [...items];
    for (const entry of added) {
      const at = merged.findIndex((x) => x.file === entry.file);
      if (at >= 0) merged[at] = entry;
      else merged.push(entry);
    }
    items = merged;
  }

  function removeItem(id) {
    items = items.filter((x) => x.id !== id);
  }

  const ready = $derived(
    items.length > 0 &&
      items.every((i) => !!i.name.trim() && (!i.needPassword || !!i.password))
  );

  async function submit() {
    if (!ready || busy) return;
    busy = true;
    const ok = [];
    const failed = [];
    for (const item of items) {
      item.error = "";
      try {
        // No `path`: the folder comes from the XML's own <URI>, exactly where the
        // task was exported from. The account does too — only the password is ours
        // to add.
        const info = await api.importTaskXml({
          xml: item.xml,
          name: item.name.trim(),
          user: item.user,
          password: item.password,
        });
        ok.push(info?.name ?? item.name.trim());
      } catch (e) {
        const message = errText(e, "import.importFailed");
        item.error = message;
        failed.push({ name: item.name.trim() || item.file, message });
      }
    }
    busy = false;

    // Nothing landed: keep the dialog open with the reason next to each file so the
    // batch can be trimmed and tried again.
    if (!ok.length) return;
    onImported?.({ ok, failed });
  }
</script>

<div
  class="mask"
  role="presentation"
  onclick={(e) => e.target === e.currentTarget && !busy && onClose?.()}
>
  <div class="panel" role="dialog" aria-modal="true" data-testid="import-dialog">
    <h4>{t("import.title")}</h4>

    <label class="file">
      <input
        class="picker"
        type="file"
        accept=".xml,text/xml"
        multiple
        onchange={pick}
        data-testid="import-picker"
      />
      <span class="pick">
        <Icon name="upload" size={14} />
        <span>{t("import.pickFile")}</span>
      </span>
    </label>

    {#if items.length}
      <div class="list">
        {#each items as item (item.id)}
          <div class="item" data-testid="import-item">
            <div class="item-head">
              <span class="file-name" title={item.file} data-testid="import-file">{item.file}</span>
              <button
                class="x"
                type="button"
                onclick={() => removeItem(item.id)}
                disabled={busy}
                title={t("import.removeFile")}
                aria-label={t("import.removeFile")}
                data-testid="import-remove"
              >×</button>
            </div>

            {#if item.needPassword}
              <input
                class="input"
                type="password"
                bind:value={item.password}
                placeholder={t("import.passwordPlaceholder")}
                data-testid="import-password"
              />
            {/if}

            {#if item.error}
              <p class="tip err">{item.error}</p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if skipped.length}
      <p class="tip warn" data-testid="import-skipped">
        {t("import.skipped", { names: skipped.join("、") })}
      </p>
    {/if}

    <div class="actions">
      <button class="btn" type="button" onclick={() => onClose?.()} disabled={busy}>{t("common.cancel")}</button>
      <button
        class="btn primary"
        type="button"
        onclick={submit}
        disabled={!ready || busy}
        data-testid="import-confirm"
      >
        {busy
          ? t("import.busy")
          : items.length > 1
            ? t("import.actionMany", { n: items.length })
            : t("import.action")}
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

  .panel {
    width: 420px;
    max-width: 92vw;
    max-height: 86vh;
    background: #fff;
    border-radius: 8px;
    padding: 18px;
    box-shadow: 0 16px 40px rgba(20, 30, 45, 0.25);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  h4 {
    margin: 0;
    font-size: 15px;
    color: #22303f;
  }

  .file {
    display: block;
  }

  /* The native file input is hidden and triggered by a custom button, so it matches the
     other dialogs */
  .picker {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 1px dashed #c3ccd8;
    border-radius: 5px;
    font-size: 12.5px;
    color: #44506b;
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .pick:hover {
    border-color: #1a73e8;
    color: #1a73e8;
  }

  /* Several files make a tall dialog; the entries scroll and the buttons stay put */
  .list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-right: 2px;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 0;
    border-bottom: 1px solid #f0f3f8;
  }

  .item:last-child {
    border-bottom: none;
  }

  .item-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .file-name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12.5px;
    color: #22303f;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .x {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    border-radius: 4px;
    font-size: 15px;
    line-height: 1;
    color: #8b95a5;
    cursor: pointer;
  }

  .x:hover {
    background: #f1f4f8;
    color: #d93025;
  }

  .input {
    height: 30px;
    border: 1px solid #d8e0ea;
    border-radius: 5px;
    padding: 0 8px;
    font-size: 12.5px;
    color: #2f3742;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }

  .input:focus {
    border-color: #1a73e8;
  }

  .tip {
    margin: 0;
    font-size: 12px;
    color: #8b95a5;
    line-height: 1.6;
  }

  .tip.warn {
    color: #b26a00;
  }

  .tip.err {
    color: #d93025;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 2px;
  }

  .btn {
    min-width: 76px;
    height: 30px;
    border: 1px solid #d6dde7;
    background: #fff;
    border-radius: 5px;
    font-size: 13px;
    color: #44506b;
    cursor: pointer;
  }

  .btn.primary {
    background: #1a73e8;
    border-color: #1a73e8;
    color: #fff;
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
