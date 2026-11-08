import { isTauri } from "./api.js";
import { t } from "./i18n/index.js";

/**
 * In-app update check.
 *
 * The updater never auto-downloads: asking Windows users whether they want an
 * installer to replace the running right now is the polite thing to do, and it
 * also keeps a broken `latest.json` from bricking every open copy.
 *
 * Everything from here down talks to package this app needs to import lazily:
 * importing `@tauri-apps/plugin-updater` eagerly would put its IPC wiring into
 * the browser demo build, where those commands do not exist.
 */

/** Result kinds handed back to the UI: none | up-to-date | installing | done. */
export async function checkForUpdate() {
  if (!isTauri) return { kind: "demo" };

  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return { kind: "up-to-date" };

  const { ask } = await import("@tauri-apps/plugin-dialog");
  const go = await ask(
    t("app.updaterAsk", { version: update.version, current: update.currentVersion }),
    { title: t("app.updaterTitle"), kind: "info" },
  );
  if (!go) return { kind: "declined" };

  await update.downloadAndInstall(() => {});
  return { kind: "installed", version: update.version };
}
