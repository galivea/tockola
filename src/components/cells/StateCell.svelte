<script>
  import { formatState } from "../../lib/resultCodes.js";

  let { row } = $props();

  const info = $derived(formatState(row.state));
</script>

<span
  class="badge {info.kind}"
  data-testid="cell-state"
  data-state={row.state ?? "Unknown"}
  title={row.state ?? ""}>{info.text}</span
>

<style>
  /* Dot + text: the dot uses currentColor, so the palette is changed in one place */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    line-height: 1;
    white-space: nowrap;
  }

  .badge::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex: none;
  }

  .run {
    color: #378add;
  }

  .ok {
    color: #22a06b;
  }

  .wait {
    color: #ba7517;
  }

  .off {
    color: #888780;
  }
</style>
