<script>
  import { getContext } from "svelte";
  import { t } from "../../lib/i18n/index.svelte.js";

  let { row } = $props();
  const actions = getContext("task-actions");
  let busy = $state(false);

  async function toggle() {
    if (busy) return;
    busy = true;
    try {
      await actions?.toggle(row, !row.enabled);
    } finally {
      busy = false;
    }
  }
</script>

<button
  class="switch"
  class:on={row.enabled}
  class:busy
  type="button"
  role="switch"
  aria-checked={row.enabled}
  aria-label={row.enabled ? t("cell.enableOn") : t("cell.enableOff")}
  disabled={busy}
  onclick={toggle}
>
  <span class="knob"></span>
</button>

<style>
  .switch {
    position: relative;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    border: 1px solid #c3ccd8;
    background: #e6eaf1;
    cursor: pointer;
    padding: 0;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .switch.on {
    background: #1a73e8;
    border-color: #1a73e8;
  }

  .switch:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 0.15s ease;
  }

  .switch.on .knob {
    transform: translateX(18px);
  }
</style>
