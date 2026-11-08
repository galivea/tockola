import { invoke } from "@tauri-apps/api/core";
import { defaultConfig, defaultTrigger, triggerSummary } from "./config.js";

export const isTauri =
  typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";

// ---- Demo data for browser development (only used outside Tauri) ----
const demoTasks = [
  {
    name: "Daily Data Backup",
    path: "\\Maintenance\\",
    state: "Ready",
    enabled: true,
    author: "Administrator",
    description: "Backs up the business database to the NAS every night",
    command: "C:\\Scripts\\backup.bat --full --target \\\\nas\\backup",
    execute: "C:\\Scripts\\backup.bat",
    arguments: "--full --target \\\\nas\\backup",
    workingDir: "C:\\Scripts",
    nextRun: "2026-10-16 02:00",
    lastRun: "2026-10-15 02:00",
    lastResult: "0",
    triggers: ["Daily from 02:00 · every 1 day"],
  },
  {
    name: "Log Cleanup",
    path: "\\Maintenance\\",
    state: "Disabled",
    enabled: false,
    author: "Administrator",
    description: "Deletes log files older than 30 days",
    command: "powershell.exe -File C:\\Scripts\\clean-logs.ps1",
    execute: "powershell.exe",
    arguments: "-File C:\\Scripts\\clean-logs.ps1",
    workingDir: "",
    nextRun: "",
    lastRun: "2026-10-10 03:00",
    lastResult: "0",
    triggers: ["Weekly from 03:00 · every 1 week (Mon, Thu)"],
  },
  {
    // Demonstrates that hidden tasks show by default: this one is hidden but
    // must still appear (visibility comes from the folder display config).
    name: "Start Sync Client",
    path: "\\",
    state: "Ready",
    enabled: true,
    hidden: true,
    author: "Administrator",
    description: "Starts the sync client after user logon",
    command: "C:\\Program Files\\Sync\\Sync.exe --silent",
    execute: "C:\\Program Files\\Sync\\Sync.exe",
    arguments: "--silent",
    workingDir: "",
    nextRun: "",
    lastRun: "2026-10-15 08:31",
    lastResult: "267009",
    triggers: ["At user logon"],
  },
  {
    name: "Weekly Report",
    path: "\\Reports\\",
    state: "Running",
    enabled: true,
    author: "report-bot",
    description: "Builds the weekly report every Friday afternoon and emails it",
    command: "python C:\\apps\\report\\main.py --weekly",
    execute: "python",
    arguments: "C:\\apps\\report\\main.py --weekly",
    workingDir: "C:\\apps\\report",
    nextRun: "2026-10-16 17:30",
    lastRun: "2026-10-09 17:30",
    lastResult: "0",
    triggers: ["Weekly from 17:30 · every 1 week (Fri)"],
  },
];

let mockStore = demoTasks.map((t) => ({ ...t }));

function mockDelay(fn) {
  return new Promise((resolve) => setTimeout(() => resolve(fn()), 220));
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// ---- Command wrappers ----

export async function listTasks() {
  if (!isTauri) return mockDelay(() => clone(mockStore));
  return invoke("list_tasks");
}

export async function getTask(name, path) {
  if (!isTauri) {
    return mockDelay(() => {
      const hit = mockStore.find((t) => t.name === name && t.path === path);
      if (!hit) throw new Error("Task not found");
      const config = demoConfig(hit);
      return { ...clone(hit), config, xml: "<Task><!-- demo data --></Task>" };
    });
  }
  return invoke("get_task", { name, path });
}

// Demo mode: build a config from the list row, reused by detail / edit / section reads.
function demoConfig(hit) {
  const config = structuredClone(defaultConfig());
  config.registration = { author: hit.author || "", description: hit.description || "" };
  config.settings.enabled = !!hit.enabled;
  config.actions = [
    {
      type: "exec",
      command: hit.execute || "",
      arguments: hit.arguments || "",
      workingDirectory: hit.workingDir || "",
    },
  ];
  const t = defaultTrigger("daily");
  t.start = (hit.nextRun || "").replace(" ", "T") || t.start;
  config.triggers = [t];
  return config;
}

// Edit page only: fetch the config without building a task view (one CIM round trip less).
export async function getTaskConfig(name, path) {
  if (!isTauri) {
    return mockDelay(() => {
      const hit = mockStore.find((t) => t.name === name && t.path === path);
      if (!hit) throw new Error("Task not found");
      return demoConfig(hit);
    });
  }
  return invoke("get_task_config", { name, path });
}

// Section reads: registration / triggers / actions / settings / principal.
// The edit page calls each section once, concurrently and independently.
export async function getTaskSection(name, path, section) {
  if (!isTauri) {
    return mockDelay(() => {
      const hit = mockStore.find((t) => t.name === name && t.path === path);
      if (!hit) throw new Error("Task not found");
      const cfg = demoConfig(hit);
      switch (section) {
        case "registration":
          return {
            name: hit.name,
            path: hit.path,
            author: cfg.registration.author,
            description: cfg.registration.description,
          };
        case "triggers":
          return cfg.triggers;
        case "actions":
          return cfg.actions;
        case "settings":
          return cfg.settings;
        case "principal":
          return cfg.principal;
        default:
          throw new Error(`Unknown config section: ${section}`);
      }
    });
  }
  return invoke("get_task_section", { name, path, section });
}

// Task XML capability of this machine: highest supported version, settings CIM
// class, and which advanced settings are available. `supported` is the
// intersection of the CIM properties present here and the project manifest:
// keys are XML element names, values the minimum version. The block below is
// the browser-preview fallback, used only to wire up the UI.
export async function getTaskCapability() {
  if (!isTauri) {
    return mockDelay(() => ({
      maxVersion: 1.4,
      settingsClass: "MSFT_TaskSettings3",
      supported: {
        MultipleInstancesPolicy: 1.2,
        DisallowStartIfOnBatteries: 1.2,
        StopIfGoingOnBatteries: 1.2,
        AllowHardTerminate: 1.2,
        StartWhenAvailable: 1.2,
        RunOnlyIfNetworkAvailable: 1.2,
        IdleSettings: 1.2,
        AllowStartOnDemand: 1.2,
        Enabled: 1.2,
        Hidden: 1.2,
        RunOnlyIfIdle: 1.2,
        WakeToRun: 1.2,
        ExecutionTimeLimit: 1.2,
        DeleteExpiredTaskAfter: 1.2,
        Priority: 1.2,
        RestartOnFailure: 1.2,
        UseUnifiedSchedulingEngine: 1.3,
        DisallowStartOnRemoteAppSession: 1.3,
        NetworkSettings: 1.3,
        MaintenanceSettings: 1.4,
        Volatile: 1.4,
      },
      requiredVersion: {
        UseUnifiedSchedulingEngine: 1.3,
        DisallowStartOnRemoteAppSession: 1.3,
        Volatile: 1.4,
        MaintenanceSettings: 1.4,
      },
    }));
  }
  return invoke("get_task_capability");
}

// Registration info only (name / path / description / author); triggers and
// settings are kept as they are.
export async function updateTaskInfo(payload) {
  if (!isTauri) {
    return mockDelay(() => {
      const i = mockStore.findIndex(
        (t) => t.name === payload.originalName && t.path === payload.originalPath
      );
      if (i < 0) throw new Error("Task not found");
      const cur = mockStore[i];
      const next = {
        ...cur,
        name: payload.name,
        path: payload.path || "\\",
        description: payload.description ?? "",
        author: payload.author ?? "",
      };
      mockStore.splice(i, 1, next);
      return clone(next);
    });
  }
  return invoke("update_task_info", { input: payload });
}

export async function saveTask(payload) {
  if (!isTauri) {
    return mockDelay(() => {
      const orig = mockStore.findIndex(
        (t) => t.name === payload.originalName && t.path === payload.originalPath
      );
      const cfg = payload.config || {};
      const exec = (cfg.actions || []).find((a) => a.type === "exec") || {};
      const command = [exec.command, exec.arguments].filter(Boolean).join(" ");
      const next = {
        name: payload.name,
        path: payload.path || "\\",
        state: cfg.settings?.enabled ? "Ready" : "Disabled",
        enabled: !!cfg.settings?.enabled,
        author: cfg.registration?.author || "Administrator",
        description: cfg.registration?.description || "",
        command,
        execute: exec.command || "",
        arguments: exec.arguments || "",
        workingDir: exec.workingDirectory || "",
        nextRun: "",
        lastRun: "",
        lastResult: "",
        triggers: (cfg.triggers || []).map((t) => triggerSummary(t)),
      };
      if (orig >= 0) mockStore.splice(orig, 1, next);
      else mockStore.push(next);
      return true;
    });
  }
  return invoke("save_task", { input: payload });
}

export async function deleteTask(name, path) {
  if (!isTauri) {
    return mockDelay(() => {
      mockStore = mockStore.filter((t) => !(t.name === name && t.path === path));
      return true;
    });
  }
  return invoke("delete_task", { name, path });
}

export async function runTask(name, path) {
  if (!isTauri) {
    return mockDelay(() => {
      const hit = mockStore.find((t) => t.name === name && t.path === path);
      if (hit) hit.lastRun = new Date().toISOString().slice(0, 16).replace("T", " ");
      return true;
    });
  }
  return invoke("run_task", { name, path });
}

export async function stopTask(name, path) {
  if (!isTauri) return mockDelay(() => true);
  return invoke("stop_task", { name, path });
}

export async function setTaskEnabled(name, path, enabled) {
  if (!isTauri) {
    return mockDelay(() => {
      const hit = mockStore.find((t) => t.name === name && t.path === path);
      if (hit) {
        hit.enabled = enabled;
        hit.state = enabled ? "Ready" : "Disabled";
      }
      return true;
    });
  }
  return invoke("set_task_enabled", { name, path, enabled });
}

/**
 * Ask the Windows Task Scheduler engine for the next N run times (authoritative).
 *
 * Scheduling rules always belong to the engine: the current config — drafts
 * included — is temporarily registered as a **disabled** task, GetRunTimes is
 * called, and the temporary task is deleted right away. Browser preview has no
 * scheduler service, so this returns null and callers must handle that.
 */
export async function probeRunTimes(config, count = 5, name = "") {
  if (!isTauri) return null;
  return invoke("probe_run_times", { input: { name, count, config } });
}

// ---- Task folders ----

// Demo mode keeps an extra list of empty folders so edits are visible.
let mockFolders = [];

function mockFolderSet() {
  return [
    ...new Set([
      "\\",
      ...mockFolders,
      ...mockStore.map((t) => normalize(t.path)),
      ...mockParents(mockStore.map((t) => normalize(t.path))),
    ]),
  ];
}

function mockParents(paths) {
  const out = [];
  for (const p of paths) {
    const segs = p.split("\\").filter(Boolean);
    let acc = "";
    for (const s of segs) {
      acc += "\\" + s;
      out.push(acc + "\\");
    }
  }
  return out;
}

function normalize(p) {
  const s = String(p || "\\").replace(/\//g, "\\");
  return ("\\" + s.replace(/^\\+/, "").replace(/\\+$/, "")).replace(/\\+/g, "\\") + "\\";
}

export async function listFolders() {
  if (!isTauri) return mockDelay(() => mockFolderSet());
  return invoke("list_folders");
}

export async function createFolder(path) {
  if (!isTauri) {
    return mockDelay(() => {
      const p = normalize(path);
      if (mockFolderSet().includes(p)) throw new Error(`Folder "${p}" already exists`);
      mockFolders.push(p);
      return p;
    });
  }
  return invoke("create_folder", { path });
}

export async function renameFolder(path, name) {
  if (!isTauri) {
    return mockDelay(() => {
      const src = normalize(path);
      const nm = String(name || "").trim();
      if (!nm) throw new Error("Folder name cannot be empty");
      const parent = src.split("\\").filter(Boolean).slice(0, -1);
      const target = normalize("\\" + [...parent, nm].join("\\"));
      if (target !== src && mockFolderSet().includes(target))
        throw new Error(`Folder "${target}" already exists`);
      mockStore = mockStore.map((t) =>
        normalize(t.path) === src || normalize(t.path).startsWith(src)
          ? { ...t, path: target + normalize(t.path).slice(src.length).replace(/^\\/, "") }
          : t
      );
      mockFolders = mockFolders.map((f) =>
        normalize(f) === src || normalize(f).startsWith(src)
          ? target + normalize(f).slice(src.length).replace(/^\\/, "")
          : f
      );
      return target;
    });
  }
  return invoke("rename_folder", { path, name });
}

export async function deleteFolder(path) {
  if (!isTauri) {
    return mockDelay(() => {
      const p = normalize(path);
      const hit = mockStore.filter((t) => normalize(t.path) === p || normalize(t.path).startsWith(p));
      mockStore = mockStore.filter((t) => !hit.includes(t));
      mockFolders = mockFolders.filter((f) => !(normalize(f) === p || normalize(f).startsWith(p)));
      return hit.length;
    });
  }
  return invoke("delete_folder", { path });
}

// ---- Run history ----

// Demo data: one full chain (triggered -> started -> process -> action ->
// completed) plus a registration change, a warning for a missed schedule, and a
// failure from a day earlier — enough to check layout, values and result-code
// colours. `category` and `levelText` mirror what a Windows English install
// renders (TaskDisplayName / LevelDisplayName), the same source the backend
// reads from RenderingInfo.
function demoHistory(name) {
  const now = Date.now();
  // Local time with seconds and slashes: toISOString is UTC, which would shift
  // every row by hours and make the history look scrambled.
  const fmt = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const run = now - 3600 * 1000;
  // Level and category text is rendered by the system (on a real machine the
  // backend sends levelText / category). Demo mode must not fake them: hardcoding
  // English would show "Task completed" inside a Chinese UI. Left empty, the
  // frontend falls back to the active language, exactly as on a Chinese Windows.
  return [
    { time: fmt(run), id: 102, level: "info", resultCode: "0" },
    { time: fmt(run), id: 201, level: "info", resultCode: "0" },
    { time: fmt(run), id: 200, level: "info", resultCode: "" },
    { time: fmt(run), id: 129, level: "info", resultCode: "" },
    { time: fmt(run), id: 100, level: "info", resultCode: "" },
    // Saving a definition leaves two rows: registration updated, then disabled.
    { time: fmt(run - 30000), id: 142, level: "info", resultCode: "" },
    { time: fmt(run - 30000), id: 140, level: "info", resultCode: "" },
    // Warning level: a missed schedule was rejected, so the Level column is
    // not limited to Information and Error.
    { time: fmt(run - 60000), id: 153, level: "warning", resultCode: "" },
    { time: fmt(now - 86400 * 1000), id: 203, level: "error", resultCode: "2147942405" },
  ];
}

export async function getTaskHistory(name, path, limit = 200, days = 7) {
  if (!isTauri) return mockDelay(() => ({ enabled: true, events: demoHistory(name) }));
  return invoke("get_task_history", { name, path, limit, days });
}

export async function getHistoryEnabled() {
  if (!isTauri) return mockDelay(() => ({ enabled: true, elevateNeeded: false }));
  return invoke("get_history_enabled");
}

export async function setHistoryEnabled(enabled) {
  if (!isTauri) throw new Error("Task history cannot be enabled in browser demo mode");
  return invoke("set_history_enabled", { enabled });
}

// ---- Import / export ----

// Both need a native file dialog, so they are unavailable in browser demo mode;
// throwing here lets the caller disable the entry point.
export async function exportTaskXml(name, path, file) {
  if (!isTauri) throw new Error("Exporting tasks is not available in browser demo mode");
  return invoke("export_task_xml", { name, path, file });
}

// Batch export: every task in the selection becomes one XML file in `dir`.
// Returns { ok, dir, files, failed } — one task failing never loses the rest.
export async function exportTasksXml(tasks, dir) {
  if (!isTauri) throw new Error("Exporting tasks is not available in browser demo mode");
  return invoke("export_tasks_xml", { input: { tasks, dir } });
}

export async function importTaskXml(input) {
  if (!isTauri) throw new Error("Importing tasks is not available in browser demo mode");
  return invoke("import_task_xml", { input });
}

// ---- Batch actions ----
// Batching goes through a dedicated command: one call, one summary, instead of
// N toasts. Demo mode applies the same logic synchronously against the mock.

export async function bulkTaskAction(input) {
  if (!isTauri) {
    return mockDelay(() => {
      const { action = "", tasks = [], enabled } = input ?? {};
      let ok = 0;
      const failed = [];
      for (const t of tasks) {
        const hit = mockStore.find((x) => x.name === t.name && x.path === t.path);
        if (!hit) {
          failed.push({ name: t?.name ?? "", path: t?.path ?? "", error: "Task not found" });
          continue;
        }
        if (action === "delete") {
          mockStore = mockStore.filter((x) => !(x.name === t.name && x.path === t.path));
        } else if (action === "enable" || action === "disable") {
          hit.enabled = enabled ?? action === "enable";
          hit.state = hit.enabled ? "Ready" : "Disabled";
        }
        ok += 1;
      }
      return { ok, failed };
    });
  }
  return invoke("bulk_task_action", { input });
}
