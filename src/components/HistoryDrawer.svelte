<script>
  import Icon from "./icons/Icon.svelte";
  import * as api from "../lib/api.js";
  import { formatResult, formatEventText, formatLevel } from "../lib/resultCodes.js";
  import { t } from "../lib/i18n/index.svelte.js";
  import { errText } from "../lib/errors.js";

  let { task, onClose } = $props();

  let loading = $state(false);
  let enabled = $state(true);
  let events = $state([]);
  let days = $state(7);
  let onlyFail = $state(false);
  let busyEnable = $state(false);
  let error = $state("");

  const shown = $derived(
    onlyFail
      ? events.filter(
          (e) =>
            e.level === "error" ||
            e.level === "critical" ||
            (Number(e.resultCode ?? 0) !== 0 && e.resultCode !== "")
        )
      : events
  );

  async function load() {
    if (!task?.name) return;
    loading = true;
    error = "";
    try {
      const res = await api.getTaskHistory(task.name, task.path ?? "\\", 200, days);
      enabled = !!res?.enabled;
      // The backend already returns newest first; sorted again here as a guard so the
      // newest row is always on top
      events = [...(res?.events ?? [])].sort((a, b) =>
        String(b.time ?? "").localeCompare(String(a.time ?? ""))
      );
    } catch (e) {
      error = errText(e, "history.loadFailed");
    } finally {
      loading = false;
    }
  }

  async function enableHistory() {
    busyEnable = true;
    error = "";
    try {
      await api.setHistoryEnabled(true);
      await load();
    } catch (e) {
      error = errText(e, "history.enableFailed");
    } finally {
      busyEnable = false;
    }
  }

  // Refetch whenever the task or the time range changes
  $effect(() => {
    void task?.name;
    void task?.path;
    void days;
    load();
  });
</script>

<aside class="drawer" data-testid="history-drawer" aria-label={t("history.title")}>
  <header class="head">
    <h3>{t("history.title")}</h3>
    <button class="x" type="button" aria-label={t("history.close")} onclick={() => onClose?.()}>✕</button>
  </header>

  <div class="path" title={`${task?.path ?? "\\"}${task?.name ?? ""}`}>
    {task?.path ?? "\\"}{task?.name ?? ""}
  </div>

  <div class="bar">
    <label class="mini">
      <span>{t("history.range")}</span>
      <select class="sel" bind:value={days} data-testid="history-days">
        {#each [1, 7, 30] as n (n)}
          <option value={n}>{t("history.days", { n })}</option>
        {/each}
      </select>
    </label>
    <label class="mini check">
      <input class="cb" type="checkbox" bind:checked={onlyFail} data-testid="history-only-fail" />
      <span>{t("history.onlyFail")}</span>
    </label>
    <button class="tb" type="button" onclick={load} disabled={loading} data-testid="history-refresh">
      <Icon name="refresh" size={13} />
      <span>{t("history.refresh")}</span>
    </button>
  </div>

  <div class="body">
    {#if loading}
      <p class="hint">{t("history.loading")}</p>
    {:else if error}
      <p class="hint err">{error}</p>
    {:else if !enabled}
      <div class="empty">
        <p class="empty-title">{t("history.disabledTitle")}</p>
        <p class="empty-sub">
          {t("history.disabledSubPre")}<b>{t("history.disabledSubEm")}</b>{t(
            "history.disabledSubPost"
          )}
        </p>
        <button
          class="btn primary"
          type="button"
          onclick={enableHistory}
          disabled={busyEnable}
          data-testid="history-enable"
        >
          {busyEnable ? t("history.enabling") : t("history.enableBtn")}
        </button>
        {#if !api.isTauri}
          <p class="empty-sub warn">{t("history.demoWarn")}</p>
        {/if}
      </div>
    {:else if shown.length === 0}
      <div class="empty">
        <p class="empty-title">{t("history.emptyTitle")}</p>
        <p class="empty-sub">
          {onlyFail ? t("history.emptySubFail") : t("history.emptySubNone")}
        </p>
      </div>
    {:else}
      <!-- Columns mirror the native History tab: level / date and time / event ID / task
           category. The event ID no longer gets a row of its own — it is just the number of the
           category, and only side by side does the pairing show. -->
      <table class="list" data-testid="history-table">
        <thead>
          <tr>
            <th class="c-lv">{t("history.colLevel")}</th>
            <th class="c-time">{t("history.colTime")}</th>
            <th class="c-id">{t("history.colId")}</th>
            <th class="c-cat">{t("history.colCategory")}</th>
          </tr>
        </thead>
        <tbody>
          {#each shown as e, i (e.time + "|" + e.id + "|" + i)}
            {@const lv = formatLevel(e.level)}
            <!-- Level and category prefer the wording the backend read from the system
                 (RenderingInfo): Windows renders it per locale, same source as the native History
                 tab; only when it is unavailable does it fall back to the event-ID table -->
            <tr class="row" data-testid="history-row" data-level={lv.kind}>
              <td class="c-lv"><span class="lv {lv.kind}">{e.levelText || lv.text}</span></td>
              <td class="c-time">{e.time ?? ""}</td>
              <td class="c-id">{e.id ?? ""}</td>
              <td class="c-cat">
                <span class="cat" class:err={lv.kind === "error" || lv.kind === "critical"}
                  >{e.category || formatEventText(e.id)}</span
                >
                {#if e.resultCode !== "" && e.resultCode !== undefined && e.resultCode !== null}
                  {@const r = formatResult(e.resultCode)}
                  <span class="code {r.kind}" title={r.tip}>{r.text}</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</aside>

<style>
  /* Slides in from the right: covers the right of the content area while the folder tree
     stays clickable, so tasks can be inspected one by one */
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    /* History is a four-column table (level / time / event ID / task category); at 420 the
       category gets squeezed into an ellipsis */
    width: 560px;
    max-width: 92vw;
    background: #fff;
    border-left: 1px solid #e3e8ef;
    box-shadow: -12px 0 32px rgba(20, 30, 45, 0.16);
    display: flex;
    flex-direction: column;
    z-index: 70;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px 8px;
  }

  h3 {
    margin: 0;
    font-size: 15px;
    color: #22303f;
  }

  .x {
    width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #5a6678;
    cursor: pointer;
    font-size: 13px;
  }

  .x:hover {
    background: #f1f4f8;
    color: #22303f;
  }

  .path {
    padding: 0 16px 10px;
    font-size: 12px;
    color: #8b95a5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px 10px;
    border-bottom: 1px solid #eef1f6;
  }

  .mini {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: #7a8699;
  }

  .mini.check {
    cursor: pointer;
    color: #44506b;
  }

  .sel {
    height: 26px;
    border: 1px solid #d8e0ea;
    border-radius: 5px;
    font-size: 12px;
    color: #2f3742;
    padding: 0 4px;
    background: #fff;
  }

  .cb {
    width: 13px;
    height: 13px;
    margin: 0;
    accent-color: #1a73e8;
  }

  .tb {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    margin-left: auto;
    border: 1px solid #d8e0ea;
    background: #fff;
    border-radius: 5px;
    padding: 0 9px;
    font-size: 12px;
    color: #44506b;
    cursor: pointer;
  }

  .tb:hover:not(:disabled) {
    border-color: #1a73e8;
    color: #1a73e8;
  }

  .tb:disabled {
    opacity: 0.5;
    cursor: progress;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 8px 16px;
  }

  .list {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
    table-layout: fixed;
  }

  .list thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: #fff;
    padding: 6px 8px;
    border-bottom: 1px solid #e3e8ef;
    font-weight: 600;
    font-size: 12px;
    color: #7a8699;
    text-align: left;
  }

  .c-lv {
    width: 52px;
  }

  .c-time {
    width: 146px;
  }

  .c-id {
    width: 62px;
  }

  .row td {
    padding: 7px 8px;
    border-bottom: 1px solid #f1f4f8;
    vertical-align: top;
  }

  .row:hover td {
    background: #f6f8fc;
  }

  .row[data-level="error"] td,
  .row[data-level="critical"] td {
    background: #fdf3f2;
  }

  .row[data-level="warning"] td {
    background: #fffaf0;
  }

  .time {
    color: #7a8699;
    font-variant-numeric: tabular-nums;
  }

  .c-time,
  .c-id {
    color: #5a6678;
    font-variant-numeric: tabular-nums;
  }

  .lv {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11.5px;
    background: #eef1f6;
    color: #7a8699;
  }

  .lv.error,
  .lv.critical {
    background: #fdeceb;
    color: #d93025;
  }

  .lv.warning {
    background: #fdf3e3;
    color: #b26a00;
  }

  .cat {
    color: #2f3742;
  }

  .cat.err {
    color: #d93025;
  }

  /* The result code hangs under the task category: it only means anything for completed
     / failed events, and its own column would be empty almost all the time */
  .code {
    display: block;
    margin-top: 2px;
    font-variant-numeric: tabular-nums;
    font-size: 11.5px;
    color: #8b95a5;
  }

  .code.ok {
    color: #22a06b;
  }

  .code.run {
    color: #378add;
  }

  .code.err {
    color: #d93025;
  }

  .code.idle {
    color: #8b95a5;
  }

  .hint {
    margin: 16px 8px;
    font-size: 12.5px;
    color: #7a8699;
  }

  .hint.err {
    color: #d93025;
  }

  .empty {
    margin: 26px 12px;
    text-align: center;
  }

  .empty-title {
    margin: 0 0 6px;
    font-size: 13px;
    color: #22303f;
  }

  .empty-sub {
    margin: 0 0 12px;
    font-size: 12px;
    color: #8b95a5;
    line-height: 1.7;
  }

  .empty-sub.warn {
    color: #b26a00;
  }

  .btn {
    min-width: 110px;
    height: 30px;
    border: 1px solid #d6dde7;
    background: #fff;
    border-radius: 5px;
    font-size: 12.5px;
    color: #44506b;
    cursor: pointer;
  }

  .btn.primary {
    background: #1a73e8;
    border-color: #1a73e8;
    color: #fff;
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }
</style>
