<!--
  Frameless windows lose the resize border with the decoration, so the edges are
  drawn here: transparent strips that hand the drag to startResizeDragging.

  Only rendered inside Tauri — in the browser demo there is no window to resize,
  and invisible strips stealing clicks would just be a bug.
-->
<script>
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { isTauri } from "../lib/api.js";

  // Wide enough to catch a mouse aimed at the edge, thin enough that nothing in
  // the UI sits under it (the layout keeps 36px clear on both sides).
  const STRIP = 5;
  const CORNER = 12;

  // Resizing is driven from mousedown, not from the injected drag-region helper:
  // two mechanisms fighting over the same press is how a window ends up stuck.
  function drag(event, direction) {
    if (event.button !== 0) return;
    event.preventDefault();
    getCurrentWindow()
      .startResizeDragging(direction)
      .catch((e) => console.warn("failed to start resizing the window", e));
  }
</script>

{#if isTauri}
  <div class="edges" aria-hidden="true">
    <!-- 左右两边避开四角，角块自己处理斜向拉伸 -->
    <span class="side w" style="top:{CORNER}px; bottom:{CORNER}px; width:{STRIP}px" onmousedown={(e) => drag(e, "West")}></span>
    <span class="side e" style="top:{CORNER}px; bottom:{CORNER}px; width:{STRIP}px" onmousedown={(e) => drag(e, "East")}></span>
    <!-- 顶/底两条避开四角，让角块优先处理斜向拉伸 -->
    <span class="side n" style="left:{CORNER}px; right:{CORNER}px; height:{STRIP}px" onmousedown={(e) => drag(e, "North")}></span>
    <span class="side s" style="left:{CORNER}px; right:{CORNER}px; height:{STRIP}px" onmousedown={(e) => drag(e, "South")}></span>

    <span class="corner nw" style="width:{CORNER}px; height:{CORNER}px" onmousedown={(e) => drag(e, "NorthWest")}></span>
    <span class="corner ne" style="width:{CORNER}px; height:{CORNER}px" onmousedown={(e) => drag(e, "NorthEast")}></span>
    <span class="corner sw" style="width:{CORNER}px; height:{CORNER}px" onmousedown={(e) => drag(e, "SouthWest")}></span>
    <span class="corner se" style="width:{CORNER}px; height:{CORNER}px" onmousedown={(e) => drag(e, "SouthEast")}></span>
  </div>
{/if}

<style>
  .edges > span {
    position: fixed;
    /* Above panels and menu panels, below every dialog and toast */
    z-index: 45;
  }

  .side.w,
  .side.e {
    top: 0;
    bottom: 0;
  }

  .side.w {
    left: 0;
    cursor: ew-resize;
  }

  .side.e {
    right: 0;
    cursor: ew-resize;
  }

  .side.n {
    top: 0;
    cursor: ns-resize;
  }

  .side.s {
    bottom: 0;
    cursor: ns-resize;
  }

  .corner.nw {
    top: 0;
    left: 0;
    cursor: nwse-resize;
  }

  .corner.ne {
    top: 0;
    right: 0;
    cursor: nesw-resize;
  }

  .corner.sw {
    bottom: 0;
    left: 0;
    cursor: nesw-resize;
  }

  .corner.se {
    bottom: 0;
    right: 0;
    cursor: nwse-resize;
  }
</style>
