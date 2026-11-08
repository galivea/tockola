<script>
  import NumSeg from "./NumSeg.svelte";
  import { t } from "../lib/i18n/index.svelte.js";

  /**
   * Three boxes: hour / minute / second
   *
   * Second precision is offered because the start / end date interfaces (the XML
   * StartBoundary / EndBoundary) resolve to the second. Each box gets its own
   * always-visible stepper on the right; there is no dropdown.
   *
   * 0 is a perfectly normal value, so there is no greyed-out placeholder: it is
   * always rendered as solid text such as 00:00:00.
   */
  let { value = $bindable("00:00:00"), disabled = false, title = "", onchange } = $props();

  const p = $derived.by(() => {
    const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(String(value || "").trim());
    return m ? { h: +m[1], m: +m[2], s: m[3] ? +m[3] : 0 } : { h: 0, m: 0, s: 0 };
  });

  const pad = (n, max) => String(Math.min(Math.max(0, Number(n) || 0), max)).padStart(2, "0");

  function emit(next) {
    value = next;
    onchange?.(next);
  }
  function setH(v) {
    emit(`${pad(v, 23)}:${pad(p.m, 59)}:${pad(p.s, 59)}`);
  }
  function setM(v) {
    emit(`${pad(p.h, 23)}:${pad(v, 59)}:${pad(p.s, 59)}`);
  }
  function setS(v) {
    emit(`${pad(p.h, 23)}:${pad(p.m, 59)}:${pad(v, 59)}`);
  }
</script>

<span class="hms" class:disabled {title}>
  <NumSeg value={p.h} min={0} max={23} {disabled} testid="time-h" aria={t("field.hour")} onchange={setH} />
  <span class="sep">:</span>
  <NumSeg value={p.m} min={0} max={59} {disabled} testid="time-m" aria={t("field.minute")} onchange={setM} />
  <span class="sep">:</span>
  <NumSeg value={p.s} min={0} max={59} {disabled} testid="time-s" aria={t("field.second")} onchange={setS} />
</span>

<style>
  .hms {
    display: inline-flex;
    align-items: center;
    flex: none;
  }
  .hms.disabled { opacity: 0.6; }

  .sep { font-size: 12px; color: #8b95a5; line-height: 1; padding: 0 1px; }
</style>
