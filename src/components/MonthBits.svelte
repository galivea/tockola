<script>
  import { monthOptions } from "../lib/config.js";
  // compact = embedded in a trigger row: narrower buttons so the row stays on one line
  let { months = $bindable([]), compact = false } = $props();

  function toggle(value) {
    const set = new Set(months);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    months = [...set].sort((a, b) => a - b);
  }
</script>

<div class="months" class:compact>
  {#each monthOptions() as m (m.value)}
    <button
      type="button"
      class="day"
      class:on={months.includes(m.value)}
      onclick={() => toggle(m.value)}
    >{m.label}</button>
  {/each}
</div>

<style>
  .months { display: flex; gap: 4px; flex-wrap: wrap; }
  .months.compact { gap: 3px; }
  .day {
    min-width: 30px; height: 26px; border: 1px solid #d6dde7; border-radius: 4px;
    background: #fff; font-size: 12px; color: #5a6678; cursor: pointer;
  }
  .months.compact .day { min-width: 25px; height: 24px; font-size: 11px; padding: 0 3px; }
  .day.on { background: #1a73e8; border-color: #1a73e8; color: #fff; }
</style>
