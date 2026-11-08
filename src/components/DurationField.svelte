<script>
  import {
    ALL_UNITS,
    UNIT_SEC,
    unitLabel,
    LIMITS,
    bestUnit,
    clampSeconds,
    isoFromSeconds,
    rangeText,
    toSeconds,
  } from "../lib/duration.js";
  import { t } from "../lib/i18n/index.svelte.js";

  /**
   * Duration input: one number + one unit
   *
   * Windows durations only cover days / hours / minutes / seconds — no months or
   * years (P1M and P1Y are rejected outright at registration). So there is no
   * free-text box: the number field takes digits only, the unit comes from a
   * dropdown, and an invalid value simply cannot be entered. Each field is clamped
   * to the measured range (see LIMITS); overflow converges and 0 always passes.
   *
   *   repetition / retry interval   1 minute ~ 31 days
   *   duration                      1 minute and up (never below the interval)
   *   random delay                  1 second ~ 31 days
   *   everything else               1 second and up
   *
   * What is stored and written into the XML is always a standard ISO string
   * (PT1H30M / P1D / PT45S); hovering shows it.
   */
  let {
    value = $bindable("PT0S"),
    // Allowed units; defaults to second / minute / hour / day. A maintenance
    // window passes ["d"] only.
    units = ALL_UNITS,
    // Min and max in seconds for non-zero values; max = null means no upper bound
    min = 0,
    max = null,
    // What 0 stands for, shown on hover: 0 (no repetition) / 0 (no time limit)
    zeroText = "",
    // This field rejects 0 (a 0 here fails registration), so the minimum lands on
    // min directly
    noZero = false,
    disabled = false,
    title = "",
  } = $props();

  let sticky = $state(null); // unit the user picked by hand; kept while the value holds
  let raw = $state(null); // raw text being edited in the number box
  let lastIso = value;

  const sec = $derived(toSeconds(value));
  const unit = $derived(sticky && units.includes(sticky) ? sticky : bestUnit(sec, units));
  const num = $derived(Math.round(sec / (UNIT_SEC[unit] ?? 1)));
  const shown = $derived(raw ?? String(num));
  const iso = $derived(isoFromSeconds(sec));
  const tip = $derived(
    [
      title,
      t("dur.xmlOf", { iso }),
      noZero || !zeroText
        ? t("dur.range", { text: rangeText(min, max) })
        : t("dur.rangeWithZero", { zero: zeroText, text: rangeText(min, max) }),
    ]
      .filter(Boolean)
      .join("\n")
  );

  // When the value is swapped in from outside (reading a task, switching fields) forget
  // the hand-picked unit and pick the most natural one again
  $effect(() => {
    if (value !== lastIso) {
      sticky = null;
      lastIso = value;
    }
  });

  function setSec(s) {
    let v = clampSeconds(s, min, max);
    if (noZero && v === 0) v = min || 1;
    const next = isoFromSeconds(v);
    lastIso = next;
    value = next;
  }
  function setNum(n) {
    setSec(n * (UNIT_SEC[unit] ?? 1));
  }
  function oninput(e) {
    const digits = e.currentTarget.value.replace(/\D/g, "").slice(0, 7);
    raw = digits;
    if (digits !== "") setNum(Number(digits));
  }
  function commit() {
    if (raw === null) return;
    const n = Number(raw || 0);
    raw = null;
    setNum(n);
  }
  function step(d) {
    raw = null;
    setNum(Math.max(0, num + d));
  }
  function onunit(e) {
    sticky = e.currentTarget.value;
    raw = null;
    setSec(sec); // same total, just shown in another unit
  }
  function onkey(e) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(-1);
    }
  }
</script>

<span class="dur" class:disabled title={tip}>
  <span class="box">
    <input
      class="val"
      type="text"
      inputmode="numeric"
      spellcheck="false"
      value={shown}
      {disabled}
      aria-label={t("dur.value")}
      data-testid="dur-input"
      oninput={oninput}
      onblur={commit}
      onkeydown={onkey}
    />
    <span class="step">
      <button type="button" tabindex="-1" {disabled} aria-label={t("dur.stepUp")} onclick={() => step(1)}>
        <svg viewBox="0 0 8 5" width="7" height="5" aria-hidden="true"><path d="M4 0l4 5H0z" fill="currentColor" /></svg>
      </button>
      <button type="button" tabindex="-1" {disabled} aria-label={t("dur.stepDown")} onclick={() => step(-1)}>
        <svg viewBox="0 0 8 5" width="7" height="5" aria-hidden="true"><path d="M0 0h8L4 5z" fill="currentColor" /></svg>
      </button>
    </span>
  </span>
  <select
    class="unit"
    value={unit}
    {disabled}
    aria-label={t("dur.unit")}
    data-testid="dur-unit"
    onchange={onunit}
  >
    {#each units as u (u)}
      <option value={u}>{unitLabel(u)}</option>
    {/each}
  </select>
</span>

<style>
  .dur { display: inline-flex; align-items: stretch; gap: 2px; flex: none; }
  .dur.disabled { opacity: 0.6; }

  .box {
    display: inline-flex;
    align-items: stretch;
    height: 26px;
    border: 1px solid #d6dde7;
    border-radius: 4px;
    background: #fff;
    overflow: hidden;
    flex: none;
  }
  .box:focus-within {
    border-color: #1a73e8;
    box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.14);
  }

  .val {
    width: 38px;
    border: none;
    outline: none;
    padding: 0 3px;
    font-size: 12px;
    color: #2f3742;
    background: transparent;
    font-family: inherit;
    text-align: right;
    min-width: 0;
  }
  .val:disabled { color: #9aa5b5; }

  .step {
    display: flex;
    flex-direction: column;
    width: 13px;
    border-left: 1px solid #e4eaf2;
    flex: none;
  }
  .step button {
    flex: 1;
    border: none;
    background: #f7f9fc;
    color: #7a8699;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  .step button:hover:not(:disabled) { background: #eaf1fb; color: #1a73e8; }
  .step button:disabled { opacity: 0.4; cursor: not-allowed; }

  .unit {
    height: 26px;
    border: 1px solid #d6dde7;
    border-radius: 4px;
    background: #fff;
    color: #2f3742;
    font-size: 12px;
    font-family: inherit;
    padding: 0 2px;
    cursor: pointer;
    flex: none;
  }
  .unit:focus { border-color: #1a73e8; outline: none; }
  .unit:disabled { color: #9aa5b5; background: #f5f7fa; cursor: not-allowed; }
</style>
