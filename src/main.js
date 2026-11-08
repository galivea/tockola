import { mount } from "svelte";
import "./styles/global.css";
import App from "./App.svelte";
import { loadFilters } from "./lib/filters.js";
import { initLocale } from "./lib/i18n/index.svelte.js";
import { loadCloseBehavior } from "./lib/settings.js";
import { restoreWindow } from "./lib/windowState.js";

// Read the persisted UI state before mounting: otherwise the app renders
// one frame with defaults and then jumps to the real values (the tree would
// expand, or the filtered list shrink, right in front of the user).
const initialFilters = await loadFilters();
// Same for the language: settle it before mount so the first frame is not
// English that flips to Chinese.
initLocale();
// Load the close-behavior preference and push it to Rust so the native window
// close (X button / Alt+F4) honors it from the first run.
await loadCloseBehavior();
// Window geometry last: it has nothing to do with the DOM, but restoring it
// here keeps every "what did the user leave behind" concern in one place.
await restoreWindow();

const app = mount(App, {
  target: document.getElementById("app"),
  props: { initialFilters },
});

export default app;
