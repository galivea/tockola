<script>
  let { name, size = 16, color = "currentColor" } = $props();

  const PATHS = {
    // run: filled triangle
    run: "M8 5v14l11-7z",
    // details: info circle
    detail:
      "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v2h-2V7zm0 4h2v6h-2v-6z",
    // edit: pencil
    edit:
      "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
    // delete: trash can
    remove:
      "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
    // refresh
    refresh:
      "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 8 8h-2c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
    // new: plus sign
    plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
    // filter
    filter: "M3 5h18v2l-7 7v6l-4-2v-4L3 7V5z",
    // search: magnifier, the "run the query" button next to the conditions
    search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z",
    // reset
    reset:
      "M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z",
    // right arrow
    chevron: "M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z",
    // down arrow: expand / collapse for "more settings"
    chevronDown: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z",
    // check mark
    check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
    // directory: folder
    folder:
      "M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z",
    // clock: task
    clock:
      "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
    // visibility: open eye (visible)
    eye:
      "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    // stop: filled square (used to end a running task)
    stop: "M6 6h12v12H6z",
    // history: clock with an arrow
    history:
      "M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L8.98 12H6a7 7 0 1 1 2.05 4.94l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12z",
    // import: up arrow
    upload: "M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z",
    // export: down arrow
    download: "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z",
    // export tasks: a tray with an arrow leaving it — the batch counterpart of
    // upload, kept distinct from download so it cannot be read as "update"
    export: "M4 4h10v2H6v10h8v-4h2v6H4V4zm10 0h6v6h-2V7.41l-6.3 6.3-1.4-1.42 6.29-6.29H14V4z",
    // gear: run settings
    gear:
      "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81a.49.49 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41L9.25 5.35c-.59.24-1.13.56-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.03-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  };
</script>

<svg
  class="icon"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill={color}
  aria-hidden="true"
  focusable="false"
>
  <path d={PATHS[name] ?? ""} />
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
