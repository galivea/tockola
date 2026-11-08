<script>
  import TimeHMS from "./TimeHMS.svelte";
  import { t } from "../lib/i18n/index.svelte.js";

  /**
   * Date + hour / minute / second
   *
   * The native date input is never exposed to the user directly: when it is empty it
   * shows a format placeholder such as "yyyy/mm/dd". Instead:
   *   - the date is an always-visible editable box, blank when unset; the calendar
   *     icon on the right opens a date-only panel
   *   - hour / minute / second are three independent boxes (StartBoundary and
   *     EndBoundary resolve to the second, so second precision is offered)
   * The internal value is always YYYY-MM-DDTHH:mm:ss; space separators and missing
   * seconds in legacy data are still accepted.
   */
  let { value = $bindable(""), placeholder = "" } = $props();

  const ph = $derived(placeholder || t("field.pickDate"));

  let picker = $state(null);
  // Very old Chromium builds have no showPicker(); fall back to the native date input
  // so nothing is lost
  let fallback = $state(false);
  // Raw text while editing: nothing is normalised mid-typing, or the caret fights back
  let editing = $state(null);

  function splitTime(v) {
    const s = String(v || "");
    const t = s.length > 10 ? s.slice(11).trim() : "";
    if (!t) return "00:00:00";
    const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(t);
    if (!m) return "00:00:00";
    const pad = (n) => String(Math.min(+n, 59)).padStart(2, "0");
    return `${pad(m[1])}:${pad(m[2])}:${pad(m[3] || 0)}`;
  }

  const datePart = $derived(
    String(value || "").trim() ? String(value).trim().slice(0, 10) : ""
  );
  const timePart = $derived(splitTime(value));
  const shown = $derived(editing ?? datePart);

  /** Lenient parsing of a hand-typed date: 2026-10-18 / 2026/10/18 / 20261018 all work */
  function parseDate(t) {
    const s = String(t || "").trim();
    if (!s) return "";
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (!m) m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (!m) return "";
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function commit() {
    const d = parseDate(editing ?? datePart);
    editing = null;
    value = d ? `${d}T${timePart}` : "";
  }

  function setTime(t) {
    if (!datePart) return; // without a date the time means nothing
    value = `${datePart}T${t}`;
  }

  function open() {
    if (!picker) return;
    picker.value = datePart;
    try {
      picker.showPicker();
    } catch {
      fallback = true;
      requestAnimationFrame(() => picker?.focus());
    }
  }

  /** The native panel only returns a date — h/m/s are three separate boxes, so only
   * the date part is taken here. */
  function onPick(e) {
    const v = e.currentTarget.value || "";
    if (!v) return (value = "");
    value = `${v.slice(0, 10)}T${timePart}`;
  }
</script>

{#if fallback}
  <span class="dtf">
    <input
      class="native"
      type="date"
      bind:this={picker}
      value={datePart}
      oninput={onPick}
      title={t("field.pickDate")}
    />
    <TimeHMS value={timePart} onchange={setTime} disabled={!datePart} title={t("field.hmsTip")} />
  </span>
{:else}
  <span class="dtf">
    <input
      class="txt"
      type="text"
      spellcheck="false"
      value={shown}
      placeholder={ph}
      data-testid="datetime-text"
      oninput={(e) => (editing = e.currentTarget.value)}
      onblur={commit}
      onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
    <button
      class="pick"
      type="button"
      onclick={open}
      title={datePart ? t("field.pickDate") : t("field.pickDateUnset")}
      data-testid="datetime-pick"
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path
          d="M5 1v2M11 1v2M2 5h12M3 3h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <TimeHMS value={timePart} onchange={setTime} disabled={!datePart} title={t("field.hmsTip")} />
    <!-- The real picker: opens a date-only panel. Invisible — the user can neither see
         nor click it. -->
    <input
      class="hidden-picker"
      type="date"
      bind:this={picker}
      value={datePart}
      oninput={onPick}
    />
  </span>
{/if}

<style>
  .dtf {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: none;
  }

  .txt {
    border: 1px solid #d6dde7;
    border-radius: 5px;
    padding: 6px 5px;
    font-size: 11.5px;
    width: 70px;
    color: #2f3742;
    background: #fff;
    outline: none;
    font-family: inherit;
  }
  .txt:focus {
    border-color: #1a73e8;
    box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.14);
  }
  .txt::placeholder { color: #b6c0cf; }

  .pick {
    border: 1px solid #d6dde7;
    border-radius: 5px;
    background: #fff;
    padding: 0 3px;
    height: 26px;
    color: #7a8699;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    flex: none;
  }
  .pick:hover { border-color: #1a73e8; color: #1a73e8; }

  /* The real picker: kept at 1px so the system panel knows where to anchor, while
     staying invisible and unclickable for the user */
  .hidden-picker {
    width: 1px;
    height: 1px;
    padding: 0;
    border: none;
    opacity: 0;
    pointer-events: none;
  }
  .native { width: 104px; }
</style>
