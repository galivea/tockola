<script>
  let { row } = $props();

  // With a value it shows 2026-10-16 02:00; with none it shows a dash rather than a
  // time-shaped placeholder
  const hasValue = $derived(!!row.nextRun);
  const text = $derived(hasValue ? row.nextRun : "—");
</script>

<span
  class="cell"
  class:muted={!hasValue}
  data-testid="cell-nextrun"
  title={hasValue ? text : ""}>{text}</span
>

<style>
  .cell {
    display: block;
    font-size: 12.5px;
    color: #2f3742;
    font-variant-numeric: tabular-nums;
  }

  .muted {
    color: #9aa5b5;
  }
</style>
