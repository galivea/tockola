<script>
  // Add triggers in bulk: pick a field on the left, tick values on the right, and
  // watch it turn into Windows triggers in real time
  //
  // Validation strategy: there is no error panel below waiting to be read. Every
  // action is judged the moment it happens — an invalid one flashes a message and is
  // rolled back (the box returns to the last expression that parsed, ticks go back to
  // what they were).
  import { onDestroy } from "svelte";
  import {
    cronFields,
    initialCronFields,
    parseCron,
    formatCron,
    valuesOf,
    fieldSummary,
    cronToTriggers,
    describeTrigger,
    pickField,
    pickCount,
    dowName,
    dowNames,
    monthName,
    listSep,
  } from "../lib/cron.js";
  import { t as tr } from "../lib/i18n/index.svelte.js";

  let { onAdd, onClose } = $props();

  const FIELDS = cronFields();
  const FD = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
  const MAX_ADD = 100; // hard cap on triggers added in one go

  // Hour / minute / second start empty: the expression box comes up blank and no
  // schedule is assumed
  let fields = $state(initialCronFields());
  let activeKey = $state("mi");
  // Expression box: null means "follow the ticks"; while typing the raw text is kept,
  // and a change in the ticks re-syncs it
  let exprDraft = $state(null);
  let exprError = $state("");
  let lastGood = ""; // the last expression that parsed, used to roll bad input back
  // "From A to B every N": range and step are the two ends of one thing, so they
  // share a single widget. Every N = 1 is a plain range, B = the upper bound is the
  // old-fashioned "from A every N".
  let pickForm = $state({ from: 0, to: 59, every: 1 });

  // Transient notice: floats in when an action is rejected and fades out by itself
  let toast = $state("");
  let toastSeq = 0;
  let toastTimer = null;
  function flash(msg) {
    toast = msg;
    const seq = ++toastSeq;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (seq === toastSeq) toast = "";
    }, 4000);
  }
  function dismiss() {
    toast = "";
    ++toastSeq;
    clearTimeout(toastTimer);
  }
  onDestroy(() => clearTimeout(toastTimer));

  const pad = (n) => String(n).padStart(2, "0");
  // Start date defaults to today — that is what Windows fills in when it creates a
  // trigger, and picking "tomorrow" for the user would be presumptuous
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  let startDate = $state(today());

  // While any field is still unset the expression stays empty; a half-built one
  // would only mislead
  const missing = $derived(FIELDS.filter((fd) => !valuesOf(fields[fd.key], fd).length));
  // Day-of-month and day-of-week both restricted: standard cron means OR here, not
  // AND. It is the easiest trap to fall into, so it gets a loud warning
  const clash = $derived(
    valuesOf(fields.dom, FD.dom).length > 0 &&
      valuesOf(fields.dom, FD.dom).length < 31 &&
      valuesOf(fields.dow, FD.dow).length > 0 &&
      valuesOf(fields.dow, FD.dow).length < 7
  );
  const exprText = $derived(exprDraft ?? (missing.length ? "" : formatCron(fields)));
  const result = $derived(cronToTriggers(fields, { startDate }));
  const active = $derived(FD[activeKey]);
  const selected = $derived(new Set(valuesOf(fields[activeKey], active)));
  // How many values the three boxes would select — visible before hitting "Apply",
  // no trial and error needed
  const pickWill = $derived(pickCount(active, pickForm));
  const pickTotal = $derived(active.max - active.min + 1);
  // Over the cap nothing can be added, so check this before acting
  const tooMany = $derived(result.ok && result.triggers.length > MAX_ADD);

  function onExprInput(e) {
    const text = e.currentTarget.value;
    dismiss(); // touching anything clears the previous notice so it cannot contradict
                 // the new state
    exprDraft = text;
    // While typing, only mark it red, never interrupt: a half-typed "0 9 * * 1-" is
    // legitimately incomplete, judgement waits until typing stops
    try {
      fields = parseCron(text);
      exprError = "";
      lastGood = text.trim();
    } catch (err) {
      exprError = err.message;
    }
  }

  /** Typing stopped (blur / Enter): if it does not parse, warn and roll back to the
   * last expression that did. */
  function commitExpr(e) {
    const el = e?.currentTarget;
    const text = String(el?.value ?? exprDraft ?? "").trim();
    if (!text) {
      fields = initialCronFields();
      exprDraft = null;
      exprError = "";
      lastGood = "";
      return;
    }
    try {
      fields = parseCron(text);
      exprDraft = text;
      lastGood = text;
      exprError = "";
      return;
    } catch (err) {
      exprError = "";
      flash(err.message);
    }
    // roll this edit back
    exprDraft = lastGood || null;
    fields = lastGood ? safeParse(lastGood) : initialCronFields();
    if (el) el.value = lastGood || "";
  }
  function safeParse(text) {
    try {
      return parseCron(text);
    } catch {
      return initialCronFields();
    }
  }

  function pick(key) {
    dismiss();
    activeKey = key;
    const fd = FD[key];
    // When the field already is a "from … to … every …", fill the three boxes back in
    // so it can be fine-tuned in place
    const st = fields[key]?.step;
    pickForm = st ? { ...st } : { from: fd.min, to: fd.max, every: 1 };
  }

  /**
   * One entry point for every tick: change first, judge after; if it does not parse,
   * warn and undo the change. "Some field is still unset" is not an error — it is a
   * normal intermediate state and may stay while the user keeps picking.
   */
  function commit(mutate) {
    dismiss();
    const before = cronToTriggers(fields, { startDate });
    // $state is a deep proxy that structuredClone cannot handle, so round-trip through
    // JSON (it only holds numbers and arrays)
    const backup = JSON.parse(JSON.stringify(fields));
    mutate();
    const after = cronToTriggers(fields, { startDate });
    // If it already failed to convert (a field is still unset, say), that is not this
    // action's fault — let it stand and keep picking
    if (after.ok || !before.ok) return;
    fields = backup;
    flash(after.error);
  }

  function toggle(v) {
    commit(() => {
      const fd = active;
      const cur = new Set(valuesOf(fields[activeKey], fd));
      if (cur.has(v)) cur.delete(v);
      else cur.add(v);
      fields[activeKey] = { values: [...cur].sort((a, b) => a - b), step: null };
      resetExpr();
    });
  }

  const allValues = (fd) => Array.from({ length: fd.max - fd.min + 1 }, (_, i) => fd.min + i);

  function resetExpr() {
    exprDraft = null;
    exprError = "";
  }

  function setAll() {
    commit(() => {
      fields[activeKey] = { values: allValues(active), step: null };
      resetExpr();
    });
  }
  function setNone() {
    commit(() => {
      fields[activeKey] = { values: [], step: null };
      resetExpr();
    });
  }
  function invert() {
    commit(() => {
      const cur = new Set(valuesOf(fields[activeKey], active));
      fields[activeKey] = { values: allValues(active).filter((v) => !cur.has(v)), step: null };
      resetExpr();
    });
  }
  /** Enter in any of the three boxes = "Apply" */
  function enterApply(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
      applyPick();
    }
  }

  /** One entry point covers both "range" and "step": clamping out-of-range, reversed and
   * invalid-step input all happens inside pickField. */
  function applyPick() {
    commit(() => {
      fields[activeKey] = pickField(active, pickForm);
      resetExpr();
    });
  }

  /** "Add all": if any check fails it warns on the spot and neither closes the dialog
   * nor adds anything. */
  function doAdd() {
    dismiss();
    if (missing.length) {
      return flash(tr("cronBuilder.missing", { list: missing.map((f) => f.label).join(listSep()) }));
    }
    if (!result.ok) return flash(result.error);
    if (!result.triggers.length) return flash(tr("cronBuilder.noTriggers"));
    if (result.triggers.length > MAX_ADD) {
      return flash(tr("cronBuilder.tooMany", { max: MAX_ADD, count: result.triggers.length }));
    }
    onAdd?.(result.triggers);
  }

  function optLabel(fd, v) {
    if (fd.key === "dow") return dowNames()[v];
    if (fd.key === "mon") return monthName(v);
    if (fd.key === "dom") return tr("cronBuilder.dayCell", { v });
    return String(v);
  }

  const PREVIEW_MAX = 24;
  const domText = $derived(
    valuesOf(fields.dom, FD.dom)
      .map((d) => tr("cron.desc.day", { d }))
      .join("、")
  );
  const dowText = $derived(
    valuesOf(fields.dow, FD.dow)
      .map((d) => dowName(d))
      .join("、")
  );
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    }
  }}
/>

<div class="mask" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose?.()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={tr("cronBuilder.title")} data-testid="cron-dialog">
    <div class="head">
      <h3>{tr("cronBuilder.title")}</h3>
      <button class="close" type="button" aria-label={tr("cronBuilder.close")} onclick={() => onClose?.()}>✕</button>
    </div>

    {#if toast}
      <div class="toast" role="alert" data-testid="cron-toast">
        <span class="tico">⚠</span>
        <span class="tmsg">{toast}</span>
        <button class="tx" type="button" aria-label={tr("cronBuilder.closeTip")} onclick={dismiss}>✕</button>
      </div>
    {/if}

    <div class="body">
      <div class="top">
        <label class="fld grow">
          <span class="lb">{tr("cronBuilder.exprLabel")}</span>
          <input
            class="mono"
            class:bad={!!exprError}
            value={exprText}
            placeholder={tr("cronBuilder.exprPlaceholder")}
            oninput={onExprInput}
            onblur={commitExpr}
            onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            spellcheck="false"
            data-testid="cron-expr"
          />
        </label>
        <label class="fld">
          <span class="lb">{tr("cronBuilder.startDate")}</span>
          <input type="date" bind:value={startDate} data-testid="cron-start" />
        </label>
      </div>
      {#if clash}
        <p class="clash" data-testid="cron-clash">
          {tr("cronBuilder.andWarnPre")}<b>{tr("cronBuilder.orLabel")}</b>{tr("cronBuilder.andWarnMid", { dom: domText, dow: dowText })}
          <code>{tr("cronBuilder.nthDow")}</code>{tr("cronBuilder.likePrefix")}<code>2#2</code>{tr("cronBuilder.andWarnTail")}
        </p>
      {:else if missing.length}
        <p class="hint" data-testid="cron-missing">
          {tr("cronBuilder.missingHint", { list: missing.map((f) => f.label).join(listSep()) })}
        </p>
      {:else}
        <p class="hint">{tr("cronBuilder.hint1")}<code>*</code> <code>*/5</code> <code>1-5</code> <code>0,15,30</code> <code>MON-FRI</code>。</p>
      {/if}
      <!-- Conversion notes (not errors): second-level repetition has to split into several
           chains, an expression that looks like it meant "the Nth weekday", ... -->
      {#each result.warnings as w (w)}
        <p class="warn" data-testid="cron-warn">⚠ {w}</p>
      {/each}

      <div class="grid">
        <div class="fields" role="tablist">
          {#each FIELDS as fd (fd.key)}
            <button
              class="frow"
              class:on={activeKey === fd.key}
              class:warn={clash && (fd.key === "dom" || fd.key === "dow")}
              type="button"
              role="tab"
              aria-selected={activeKey === fd.key}
              onclick={() => pick(fd.key)}
              data-testid={`cron-field-${fd.key}`}
            >
              <span class="fk">{fd.label}{clash && (fd.key === "dom" || fd.key === "dow") ? " ⚠" : ""}</span>
              <span class="fv">{fieldSummary(fields[fd.key], fd)}</span>
            </button>
          {/each}
        </div>

        <div class="panel">
          <div class="bar">
            <!-- Range and step form one group: from A to B every N, a single "Apply" -->
            <span class="pick" role="group" aria-label={tr("cronBuilder.batchHint")}>
              <span class="lb">{tr("cronBuilder.from")}</span>
              <input
                class="num"
                type="number"
                bind:value={pickForm.from}
                min={active.min}
                max={active.max}
                onkeydown={enterApply}
                data-testid="cron-pick-from"
              />
              <span class="lb">{tr("cronBuilder.to")}</span>
              <input
                class="num"
                type="number"
                bind:value={pickForm.to}
                min={active.min}
                max={active.max}
                onkeydown={enterApply}
                data-testid="cron-pick-to"
              />
              <span class="lb">{tr("cronBuilder.every")}</span>
              <input
                class="num"
                type="number"
                bind:value={pickForm.every}
                min="1"
                onkeydown={enterApply}
                data-testid="cron-pick-every"
              />
              <button class="mini go" type="button" onclick={applyPick} data-testid="cron-pick-apply">{tr("cronBuilder.apply")}</button>
              <span class="pick-note" data-testid="cron-pick-note">{tr("cronBuilder.pickSelected", { will: pickWill, total: pickTotal })}</span>
            </span>
            <!-- Select all / invert / clear act on the whole range: kept at the far right,
                 visually apart from the range widgets -->
            <span class="right">
              <button class="mini" type="button" onclick={setAll} data-testid="cron-all">{tr("cronBuilder.selectAll")}</button>
              <button class="mini" type="button" onclick={invert} data-testid="cron-invert">{tr("cronBuilder.invert")}</button>
              <button class="mini" type="button" onclick={setNone} data-testid="cron-clear">{tr("cronBuilder.clear")}</button>
            </span>
          </div>

          <div class="opts" data-testid="cron-opts">
            {#each allValues(active) as v (v)}
              <label class="opt" class:on={selected.has(v)} title={optLabel(active, v)}>
                <input
                  type="checkbox"
                  checked={selected.has(v)}
                  onchange={() => toggle(v)}
                  data-testid={`cron-opt-${activeKey}-${v}`}
                />
                <span>{optLabel(active, v)}</span>
              </label>
            {/each}
          </div>

          {#if activeKey === "year"}
            <p class="hint">{tr("cronBuilder.yearNote")}</p>
          {/if}
        </div>
      </div>
    </div>

    <div class="foot">
      {#if result.ok && result.triggers.length}
        <details class="preview" data-testid="cron-preview">
          <summary>
            {tr("cronBuilder.willAddPre")}<b>{result.triggers.length}</b>{tr("cronBuilder.willAddPost", { plan: result.planLabel, count: result.planCount })}
          </summary>
          <ol class="list">
            {#each result.triggers.slice(0, PREVIEW_MAX) as t, i (i)}
              <li><span class="mono">{t.start.slice(11)}</span> · {describeTrigger(t)}</li>
            {/each}
          </ol>
          {#if result.triggers.length > PREVIEW_MAX}
            <p class="hint">{tr("cronBuilder.andMore", { n: result.triggers.length - PREVIEW_MAX })}</p>
          {/if}
        </details>
      {/if}
      <div class="actions">
        <button class="btn" type="button" onclick={() => onClose?.()}>{tr("cronBuilder.cancel")}</button>
        <button class="btn primary" type="button" onclick={doAdd} data-testid="cron-add">
          {tr("cronBuilder.batchAdd")}{result.ok && result.triggers.length ? `（${result.triggers.length}）` : ""}
        </button>
      </div>
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
    z-index: 90;
  }

  .dialog {
    position: relative;
    width: 1120px;
    max-width: calc(100vw - 40px);
    max-height: calc(100vh - 40px);
    display: flex;
    flex-direction: column;
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

  /* Transient notice: floats over the top of the dialog, takes no layout space, and
     fades out by itself */
  .toast {
    position: absolute;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    max-width: calc(100% - 40px);
    padding: 9px 12px;
    border: 1px solid #f3c3bf;
    border-radius: 6px;
    background: #fdecea;
    box-shadow: 0 8px 20px rgba(160, 40, 30, 0.18);
    font-size: 12.5px;
    line-height: 1.6;
    color: #a3231d;
  }
  .tico {
    flex: none;
    font-size: 13px;
  }
  .tmsg {
    flex: 1;
  }
  .tx {
    flex: none;
    border: none;
    background: none;
    color: #a3231d;
    cursor: pointer;
    font-size: 12px;
    padding: 0;
    line-height: 1.4;
  }

  .body {
    padding: 12px 16px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .top {
    display: flex;
    gap: 10px;
    align-items: flex-end;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fld.grow {
    flex: 1;
  }
  .lb {
    font-size: 12px;
    color: #5a6678;
  }
  .fld input {
    height: 32px;
    padding: 0 8px;
    border: 1px solid #d6dde7;
    border-radius: 5px;
    font-size: 13px;
    outline: none;
    background: #fff;
  }
  .fld input:focus {
    border-color: #1a73e8;
  }
  .fld input.bad {
    border-color: #c5221f;
    background: #fff7f6;
  }
  .mono {
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 13px;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: #7a8699;
  }
  .hint code {
    background: #f2f5f9;
    padding: 0 3px;
    border-radius: 3px;
    font-size: 11.5px;
  }
  .warn {
    margin: 0;
    font-size: 12px;
    line-height: 1.6;
    color: #b34a13;
  }
  .clash {
    margin: 0;
    padding: 6px 8px;
    border: 1px solid #f0c9a6;
    border-radius: 5px;
    background: #fdf3ea;
    font-size: 12px;
    line-height: 1.6;
    color: #a8480f;
  }
  .clash b {
    color: #c5221f;
  }
  .clash code {
    background: #fff;
    padding: 0 3px;
    border-radius: 3px;
    font-size: 11.5px;
  }

  /* The settings area is scaled up: the common fields (minute / hour / day / month /
     weekday) fill one screen without scrolling */
  .grid {
    display: grid;
    grid-template-columns: 176px 1fr;
    gap: 10px;
    align-items: stretch;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid #e6ebf2;
    border-radius: 6px;
    padding: 5px;
    background: #fbfcfe;
  }
  .frow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    height: 34px;
    padding: 0 9px;
    border: none;
    background: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 13px;
    color: #44506b;
  }
  .frow:hover {
    background: #eef3fa;
  }
  .frow.on {
    background: #e6f0fd;
    color: #1a73e8;
    font-weight: 600;
  }
  .frow.warn {
    background: #fdf1e6;
    color: #b34a13;
  }
  .fk {
    flex: none;
  }
  .fv {
    font-size: 12px;
    color: #7a8699;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .frow.on .fv {
    color: #1a73e8;
  }

  .panel {
    border: 1px solid #e6ebf2;
    border-radius: 6px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 268px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  /* "From A to B every N" + "Apply" is one thing, so a light panel wraps it and keeps it
     apart from the range-wide buttons on the right */
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 7px;
    border: 1px solid #e6ebf2;
    border-radius: 6px;
    background: #fbfcfe;
  }
  .pick-note {
    font-size: 12px;
    color: #7a8699;
    white-space: nowrap;
  }
  /* Range-wide buttons sit at the right: they are a different kind of action from
     "pick a range", and neighbours get mis-clicked */
  .bar .right {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .num {
    width: 58px;
    height: 28px;
    padding: 0 4px;
    border: 1px solid #d6dde7;
    border-radius: 4px;
    font-size: 12.5px;
    outline: none;
  }
  .num:focus {
    border-color: #1a73e8;
  }
  .mini {
    height: 28px;
    padding: 0 10px;
    border: 1px solid #d6dde7;
    background: #fff;
    border-radius: 4px;
    font-size: 12.5px;
    color: #44506b;
    cursor: pointer;
  }
  .mini:hover {
    border-color: #1a73e8;
    color: #1a73e8;
  }
  /* The lone "Apply" in the group gets some colour so it does not blur into the three
     number boxes */
  .mini.go {
    border-color: #9dc0f5;
    background: #f2f7fe;
    color: #1a73e8;
  }
  .mini.go:hover {
    border-color: #1a73e8;
    background: #e6f0fd;
  }

  /* Value list: no height cap — 60 values still fit, no scrolling needed */
  .opts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
    gap: 6px;
    padding: 2px;
  }
  .opt {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    height: 40px;
    border: 1px solid #e6ebf2;
    border-radius: 5px;
    font-size: 12.5px;
    color: #5a6678;
    cursor: pointer;
    user-select: none;
  }
  .opt:hover {
    border-color: #9dc0f5;
    background: #f6f9fe;
  }
  .opt.on {
    border-color: #1a73e8;
    background: #e8f1fe;
    color: #1a73e8;
    font-weight: 600;
  }
  .opt input {
    width: 12px;
    height: 12px;
    margin: 0;
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    border-top: 1px solid #eef2f8;
    background: #fafbfd;
  }
  /* The preview starts collapsed and costs one line; it only expands on demand, so it
     never steals room from the settings area */
  .preview {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: #44506b;
  }
  .preview summary {
    cursor: pointer;
    color: #2f3742;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .preview summary b {
    color: #1a73e8;
  }
  .preview[open] summary {
    margin-bottom: 4px;
  }
  .list {
    margin: 2px 0 0;
    padding-left: 18px;
    max-height: 150px;
    overflow: auto;
    font-size: 12px;
    color: #44506b;
    line-height: 1.7;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex: none;
  }
  .btn {
    min-width: 72px;
    height: 32px;
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
  .btn.primary {
    background: #1a73e8;
    border-color: #1a73e8;
    color: #fff;
  }
  .btn.primary:hover:not(:disabled) {
    background: #1668d1;
    color: #fff;
  }
  .btn:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
