<script>
  import EditableCell from "./EditableCell.svelte";

  let { row } = $props();

  // The description column was dropped from the list; hovering the task name now shows
  // it in full on a card
  let tip = $state(null);
  let timer = null;

  function show(event) {
    clearTimeout(timer);
    const el = event.currentTarget;
    timer = setTimeout(() => {
      const r = el.getBoundingClientRect();
      tip = {
        top: Math.min(r.bottom + 6, window.innerHeight - 130),
        left: Math.min(Math.max(r.left, 8), window.innerWidth - 320),
      };
    }, 220);
  }

  function hide() {
    clearTimeout(timer);
    tip = null;
  }

  const desc = $derived(String(row?.description ?? "").trim());
</script>

<div class="wrap" role="presentation" onmouseenter={show} onmouseleave={hide}>
  <EditableCell {row} field="name" nativeTip={false} />

  <!-- Only the task description is shown; with no description no card pops up, so no
       empty box appears -->
  {#if tip && desc}
    <div class="tip" style="top:{tip.top}px; left:{tip.left}px" data-testid="name-tip">
      <div class="tp-desc" data-testid="name-tip-desc">{desc}</div>
    </div>
  {/if}
</div>

<style>
  .wrap {
    display: block;
    position: relative;
  }

  .tip {
    position: fixed;
    z-index: 9999;
    width: 300px;
    max-width: calc(100vw - 20px);
    background: #fff;
    border: 1px solid #d6dde7;
    border-radius: 6px;
    box-shadow: 0 10px 26px rgba(20, 30, 45, 0.18);
    padding: 9px 11px 10px;
    pointer-events: none;
  }

  /* A description can be long: it wraps and shows in full rather than being truncated */
  .tp-desc {
    font-size: 12.5px;
    line-height: 1.6;
    color: #3c4757;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 168px;
    overflow: hidden;
  }
</style>
