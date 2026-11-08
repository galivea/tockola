<script>
  import Icon from "./icons/Icon.svelte";

  /**
   * Icon button at the end of a table row
   *
   * Styling copies IconButtonCell from the task list pixel for pixel (28x28, light
   * blue / light red hover background), minus the dependency on the grid context so
   * the editor can use it directly.
   */
  let {
    icon = "detail",
    label = "",
    danger = false,
    active = false,
    disabled = false,
    onclick,
  } = $props();
</script>

<button
  class="icon-btn"
  class:danger
  class:active
  type="button"
  title={label}
  aria-label={label}
  {disabled}
  onclick={(e) => {
    e.stopPropagation();
    onclick?.();
  }}
  data-testid={`icon-btn-${icon}`}
>
  <!-- Down arrow for "more settings"; it flips up once expanded -->
  <span class="ico" class:up={active && icon === "chevronDown"}>
    <Icon name={icon} size={17} />
  </span>
</button>

<style>
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #5a6678;
    cursor: pointer;
    flex: none;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .icon-btn:hover:not(:disabled) {
    background: #eaf1fb;
    border-color: #cfe0f8;
    color: #1a73e8;
  }

  .icon-btn.danger:hover:not(:disabled) {
    background: #fdeceb;
    border-color: #f8cfcb;
    color: #d93025;
  }

  /* Expanded state: stays lit to say "this block is open" */
  .icon-btn.active {
    background: #eaf1fb;
    border-color: #cfe0f8;
    color: #1a73e8;
  }

  .ico {
    display: inline-flex;
    transition: transform 0.14s ease;
  }
  .ico.up { transform: rotate(180deg); }

  .icon-btn:active:not(:disabled) { transform: translateY(0.5px); }

  .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
