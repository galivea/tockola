<script>
  import { onMount, untrack } from "svelte";
  import * as api from "../lib/api.js";
  import { normalizePath } from "../lib/utils.js";
  import {
    defaultConfig,
    normalizeConfig,
    validateForSave,
    defaultTrigger,
    triggerTypes,
    weekOptions,
    monthOptions,
    sessionStateOptions,
    logonTypes,
    runLevels,
    multipleInstances,
    SERVICE_ACCOUNTS,
    EVENT_LOGS,
  } from "../lib/config.js";
  import { errText } from "../lib/errors.js";
  import MonthBits from "./MonthBits.svelte";
  import FolderTreeSelect from "./FolderTreeSelect.svelte";
  import DateTimeField from "./DateTimeField.svelte";
  import DurationField from "./DurationField.svelte";
  import CommandField from "./CommandField.svelte";
  import Toggle from "./Toggle.svelte";
  import IconButton from "./IconButton.svelte";
  import Icon from "./icons/Icon.svelte";
  import Switch from "./Switch.svelte";
  import CronBuilder from "./CronBuilder.svelte";
  import { splitCommand, mergeCommand } from "../lib/command.js";
  import { fieldLabel, fieldTip } from "../lib/settingsMeta.js";
  import { t as tr } from "../lib/i18n/index.svelte.js";
  import { dowName, listSep } from "../lib/cron.js";
  import { LIMITS, toSeconds } from "../lib/duration.js";
  import { formatStamp, parseStamp, formatRelative } from "../lib/utils.js";

  // Creating and editing share one page: the whole configuration arrives in one
  // piece and every section is edited right here. It used to be split into two
  // entries ("General" / "Run settings"), which only forced people to guess which
  // bucket their change belonged to — sections already have anchors on the left to
  // jump to, so splitting bought nothing.
  let { task = null, defaultPath = "\\", groupTree = null, onClose, onSaved } = $props();

  const isEdit = $derived(!!task);
  // Anchors follow the underlying data source: each top-level XML node is one fetch
  // unit, so each gets an anchor. Conditions (idle / power / network) read as
  // "conditions" in the UI but live under <Settings> and arrive in the same fetch as
  // the settings, so they merge into one "Settings and conditions" module. The create
  // and the edit page share the same modules.
  const SECTIONS = [
    { id: "identity", label: tr("editor.sectionIdentity"), src: "RegistrationInfo" },
    { id: "triggers", label: tr("editor.sectionTriggers"), src: "Triggers" },
    { id: "actions", label: tr("editor.sectionActions"), src: "Actions" },
    { id: "settings", label: tr("editor.sectionSettings"), src: "Settings" },
    { id: "principal", label: tr("editor.sectionPrincipal"), src: "Principals" },
  ];
  // Saving rewrites the whole XML, so every section has to hold real data before
  // submit — all five are read back first
  const loadIds = SECTIONS.map((s) => s.id);
  const title = $derived(isEdit ? tr("editor.titleEdit") : tr("editor.titleNew"));
  let active = $state("identity");
  let bodyEl = $state(null);

  function scrollTo(id) {
    active = id;
    const el = document.getElementById("sec-" + id);
    if (!el || !bodyEl) return;
    // Computed from rect deltas, not offsetParent (the scroll container need not be
    // the positioned element)
    const top =
      el.getBoundingClientRect().top -
      bodyEl.getBoundingClientRect().top +
      bodyEl.scrollTop;
    bodyEl.scrollTo({ top: Math.max(top - 4, 0), behavior: "smooth" });
  }

  function onScroll() {
    if (!bodyEl) return;
    const base = bodyEl.getBoundingClientRect().top;
    let current = SECTIONS[0].id;
    for (const a of SECTIONS) {
      const el = document.getElementById("sec-" + a.id);
      if (!el) continue;
      if (el.getBoundingClientRect().top - base <= 32) current = a.id;
    }
    active = current;
  }

  let saving = $state(false);
  let exporting = $state(false);
  let exportMsg = $state("");
  let error = $state("");
  // Dialog that adds triggers in bulk (cron)
  let cronOpen = $state(false);

  let name = $state(untrack(() => task?.name ?? ""));
  let path = $state(untrack(() => task?.path ?? normalizePath(defaultPath)));
  let cfg = $state(defaultConfig());
  // "More" starts collapsed: author / source / version / documentation / security
  // descriptor are all "nice to have, works without" metadata, and the room they take
  // only squeezes the task name, folder and description.
  let moreOpen = $state(false);

  // One load state per section: idle / loading / ready / error. On open every section
  // calls its own command concurrently and renders as soon as it lands; a failing
  // section affects only itself and can be retried alone.
  let status = $state(Object.fromEntries(SECTIONS.map((s) => [s.id, "idle"])));
  let sectionError = $state({});
  // What this machine supports, plus the task's nodes that are not parsed (but are
  // preserved verbatim)
  let capability = $state(null);
  let unsupportedNodes = $state([]);
  const busy = $derived(loadIds.some((id) => status[id] === "loading"));

  // Fetch function per section: each one only reads its own slice
  const loaders = {
    identity: async () => {
      const d = await api.getTaskSection(task.name, task.path, "registration");
      if (d?.name) name = d.name;
      if (d?.path) path = d.path;
      cfg.registration.description = d?.description ?? "";
      cfg.registration.author = d?.author ?? "";
      cfg.registration.securityDescriptor = d?.securityDescriptor ?? "";
      cfg.registration.source = d?.source ?? "";
      cfg.registration.version = d?.version ?? "";
      cfg.registration.documentation = d?.documentation ?? "";
      // Nodes this tool cannot recognise: not lost, but the UI has to say so
      unsupportedNodes = Array.isArray(d?.unsupported) ? d.unsupported : [];
    },
    triggers: async () => {
      const d = await api.getTaskSection(task.name, task.path, "triggers");
      cfg.triggers = normalizeConfig({
        ...defaultConfig(),
        triggers: Array.isArray(d) ? d : [],
      }).triggers;
    },
    actions: async () => {
      const d = await api.getTaskSection(task.name, task.path, "actions");
      cfg.actions = normalizeConfig({
        ...defaultConfig(),
        actions: Array.isArray(d) ? d : [],
      }).actions;
    },
    settings: async () => {
      const d = await api.getTaskSection(task.name, task.path, "settings");
      cfg.settings = normalizeConfig({
        ...defaultConfig(),
        settings: d && typeof d === "object" ? d : {},
      }).settings;
    },
    principal: async () => {
      const d = await api.getTaskSection(task.name, task.path, "principal");
      cfg.principal = normalizeConfig({
        ...defaultConfig(),
        principal: d && typeof d === "object" ? d : {},
      }).principal;
    },
  };

  async function loadSection(id) {
    status[id] = "loading";
    sectionError[id] = "";
    try {
      await loaders[id]();
      status[id] = "ready";
    } catch (e) {
      status[id] = "error";
      sectionError[id] = errText(e, "editor.loadFailed");
    }
  }

  onMount(() => {
    // Task XML capabilities of this machine: decides which advanced settings are
    // available. A failure never blocks editing — it degrades to "all supported".
    api
      .getTaskCapability()
      .then((c) => (capability = c))
      .catch(() => (capability = null));
    if (!isEdit) {
      // Creating: there is nothing to read, every section starts from defaults
      for (const s of SECTIONS) status[s.id] = "ready";
      return;
    }
    // The sections this mode needs are requested together and never wait for each
    // other; the rest stay idle (unread) and ensureLoaded fills them in before
    // saving. They must not be faked as ready, or defaults would overwrite the
    // real configuration.
    loadIds.forEach((id) => loadSection(id));
  });

  // Saving rewrites the whole task, so all sections must be read back before submit
  // or defaults would overwrite the real configuration
  async function ensureLoaded() {
    const need = SECTIONS.map((s) => s.id).filter((id) => status[id] !== "ready");
    if (!need.length) return;
    await Promise.all(need.map((id) => loadSection(id)));
    const bad = need.filter((id) => status[id] !== "ready");
    if (bad.length) throw new Error(tr("editor.notLoaded") + bad.join("、") + "）");
  }

  // capability.supported is the intersection of "properties this machine's CIM
  // exposes" and "the project's manifest": keys are XML element names, values the
  // minimum XML version required. Anything outside the intersection is unusable here.
  // When probing fails it degrades to "all supported" so a missing capability never
  // locks a feature away.
  const isSupported = (name) => !capability?.supported || !!capability.supported[name];

  // While collapsed, hovering shows what is filled in — no need to expand for a peek
  const REG_MORE = [
    [tr("editor.metaAuthor"), "author"],
    [tr("editor.metaSource"), "source"],
    [tr("editor.metaVersion"), "version"],
    [tr("editor.metaDoc"), "documentation"],
    [tr("editor.metaSd"), "securityDescriptor"],
  ];
  const moreTip = $derived(
    REG_MORE.map(([label, key]) => `${label}：${brief(cfg.registration[key])}`).join("\n")
  );
  const moreFilled = $derived(
    REG_MORE.filter(([, key]) => String(cfg.registration[key] ?? "").trim()).length
  );
  // A security descriptor is a long SDDL string: a snippet is enough on hover, the full
  // value lives in the expanded input
  function brief(v) {
    const s = String(v ?? "").trim();
    return s.length > 48 ? `${s.slice(0, 48)}…` : s || tr("editor.moreEmpty");
  }

  const supported = $derived.by(() => ({
    use: isSupported("UseUnifiedSchedulingEngine"),
    dsras: isSupported("DisallowStartOnRemoteAppSession"),
    vol: isSupported("Volatile"),
    maint: isSupported("MaintenanceSettings"),
  }));

  function toggleBit(arr, value) {
    const set = new Set(arr);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    return [...set].sort((a, b) => a - b);
  }

  function parseDays(text) {
    return String(text || "")
      .split(/[,，\s]+/)
      .map((v) => parseInt(v, 10))
      .filter((v) => Number.isFinite(v) && v >= 1 && v <= 31);
  }

  // Inline expansion: only one block per section is expanded at a time, so two never
  // stack and wreck the table
  let trExpand = $state({ kind: null, index: -1 });
  function toggleTr(kind, i) {
    trExpand =
      trExpand.kind === kind && trExpand.index === i
        ? { kind: null, index: -1 }
        : { kind, index: i };
  }

  function addTrigger() {
    cfg.triggers = [...cfg.triggers, defaultTrigger("daily")];
  }
  // Bulk add: the cron output is appended right after the existing triggers
  function addTriggers(list) {
    cfg.triggers = [...cfg.triggers, ...list.map((t) => normalizeConfig({ triggers: [t] }).triggers[0])];
    cronOpen = false;
  }
  function removeTrigger(i) {
    cfg.triggers = cfg.triggers.filter((_, idx) => idx !== i);
    if (trExpand.index === i) trExpand = { kind: null, index: -1 };
  }

  function addAction() {
    cfg.actions = [
      ...cfg.actions,
      { type: "exec", command: "", arguments: "", workingDirectory: "", commandLine: "" },
    ];
  }
  function removeAction(i) {
    cfg.actions = cfg.actions.filter((_, idx) => idx !== i);
  }

  // Summary for "Choose a schedule": compresses this row's recurrence into one
  // readable line on the button
  const weekText = (bits) =>
    (bits || []).length
      ? weekOptions().filter((d) => bits.includes(d.value)).map((d) => d.label).join("、")
      : tr("editor.unset");
  const monthText = (bits) =>
    (bits || []).length
      ? monthOptions().filter((m) => bits.includes(m.value)).map((m) => m.label).join("、")
      : tr("editor.monthly");

  function periodSummary(t) {
    switch (t.type) {
      case "once":
        return tr("editor.once");
      case "daily":
        return tr("editor.everyNDays", { n: t.daysInterval || 1 });
      case "weekly":
        return tr("editor.everyNWeeks", { n: t.weeksInterval || 1, dow: weekText(t.daysOfWeek) });
      case "monthly":
        return tr("editor.monthlyDays", { days: (t.daysOfMonth || []).join(",") || tr("editor.unset"), months: monthText(t.months) });
      case "monthlyDow":
        // 5 = last week: Windows only offers weeks 1-4 and "last"; there is no fifth
        // week
        return tr("editor.nthDowDesc", {
          nth: [tr("editor.nth0"), tr("editor.nth1"), tr("editor.nth2"), tr("editor.nth3"), tr("editor.nth4"), tr("editor.nthLast")][t.monthWeek] || tr("editor.nth0"),
          dow: weekText(t.daysOfWeek),
          months: monthText(t.months),
        });
      case "event":
        return t.eventId ? tr("editor.eventId", { id: t.eventId }) : tr("editor.anyEvent");
      case "sessionStateChange":
        return sessionStateOptions().find((o) => o.value === t.stateChange)?.label ?? tr("editor.sessionChange");
      default:
        return triggerTypes().find((o) => o.value === t.type)?.label ?? t.type;
    }
  }

  // Only calendar triggers offer a schedule; for every other kind this column is a
  // read-only summary
  const hasPeriod = (type) =>
    ["weekly", "monthly", "monthlyDow"].includes(type);

  // ---- Next N run times ----
  // Scheduling rules are never re-derived here: the current configuration (unsaved
  // edits included) is registered temporarily as a disabled task, Windows itself is
  // asked for the authoritative moments (IRegisteredTask::GetRunTimes), and the
  // temporary task is deleted right after. Whatever the engine decides is the
  // truth — no second copy of the rules is maintained.
  let nextCount = $state(5);
  let nowMs = $state(Date.now());
  const nrCount = $derived(Math.max(1, Math.min(200, Math.round(+nextCount || 5))));
  let nr = $state({ busy: false, times: [], error: "", unsupported: false });
  const nrRows = $derived(
    (nr.times || []).map((s) => parseStamp(s)).filter((ms) => Number.isFinite(ms))
  );
  
  const weekShort = (ms) => tr("editor.weekPrefix", { dow: dowName(new Date(ms).getDay()) });
  const noList = (arr) => (arr || []).map((i) => `#${i}`).join(listSep());
  // Event triggers have no fixed moment and the engine cannot list them; say so
  // explicitly so it does not look like something was missed
  const UNTIMED = ["logon", "boot", "idle", "registration", "sessionStateChange", "event"];
  const untimedTriggers = $derived(
    (cfg.triggers || [])
      .map((t, i) => (t && t.enabled !== false && UNTIMED.includes(t.type) ? i + 1 : 0))
      .filter(Boolean)
  );
  // Disabled triggers are not sent to the engine: it would happily count them, and
  // that is not what the user asked for
  const liveTriggers = $derived((cfg.triggers || []).filter((t) => t && t.enabled !== false));
  const hasRandomDelay = $derived(
    liveTriggers.some((t) => toSeconds(t.randomDelay) > 0)
  );

  // Any change re-asks the engine, debounced so typing one cell does not register one
  // task per keystroke; only the latest result counts
  let nrToken = 0;
  $effect(() => {
    const spec = JSON.stringify(liveTriggers);
    const n = nrCount;
    if (!liveTriggers.length) {
      nr = { busy: false, times: [], error: "", unsupported: false };
      return;
    }
    nr = { busy: true, times: [], error: "", unsupported: false };
    const token = ++nrToken;
    const id = setTimeout(async () => {
      try {
        const times = await api.probeRunTimes(
          { ...cfg, triggers: JSON.parse(spec) },
          n,
          name || "__probe__"
        );
        if (token !== nrToken) return;
        // null = not inside the desktop shell (browser preview), there is no scheduler
        // service to call
        nr = times
          ? { busy: false, times, error: "", unsupported: false }
          : { busy: false, times: [], error: "", unsupported: true };
      } catch (e) {
        if (token !== nrToken) return;
        nr = { busy: false, times: [], error: errText(e, "editor.probeFailed"), unsupported: false };
      }
    }, 350);
    return () => clearTimeout(id);
  });
  // Relative wording such as "in 3 hours" has to move with the clock, so the
  // baseline refreshes every minute
  $effect(() => {
    const id = setInterval(() => (nowMs = Date.now()), 60000);
    return () => clearInterval(id);
  });

  // ---- Trigger table columns ----
  // Every attribute sits inline; nothing is folded into a "more settings" popover —
  // when there are many columns the outer container scrolls horizontally.
  // on(t) says which trigger kinds a column applies to: if any row needs it, the
  // column shows up, so no row is left with a stretch of empty cells.
  const CALENDAR_TRIGGERS = ["once", "daily", "weekly", "monthly", "monthlyDow"];
  const DELAY_TRIGGERS = ["logon", "boot", "registration", "event", "sessionStateChange"];
  const TRIG_COLS = [
    { key: "grip", label: "", tip: tr("editor.dragReorder"), w: 20 },
    { key: "idx", label: "#", w: 20 },
    { key: "type", label: tr("editor.period"), tip: fieldTip("trType"), w: 96 },
    // Always present: for calendar triggers clicking it expands weekdays / days /
    // months; other kinds show a read-only summary
    { key: "period", label: tr("editor.pickPeriod"), tip: tr("editor.cellHint"), w: 106 },
    { key: "start", label: tr("editor.startDate"), tip: fieldTip("trStart"), w: 214 },
    { key: "interval", label: fieldLabel("trRepeatInterval"), tip: fieldTip("trRepeatInterval"), w: 104 },
    { key: "duration", label: fieldLabel("trRepeatDuration"), tip: fieldTip("trRepeatDuration"), w: 104 },
    { key: "stop", label: fieldLabel("trStopAtDurationEnd"), tip: fieldTip("trStopAtDurationEnd"), w: 92 },
    { key: "end", label: tr("editor.endDate"), tip: fieldTip("trEnd"), w: 214 },
    { key: "limit", label: fieldLabel("trExecutionTimeLimit"), tip: fieldTip("trExecutionTimeLimit"), w: 104 },
    { key: "gap", label: fieldLabel("trIntervalType"), tip: fieldTip("trIntervalType"), w: 84, on: (t) => t.type === "daily" || t.type === "weekly" },
    { key: "randomDelay", label: fieldLabel("trRandomDelay"), tip: fieldTip("trRandomDelay"), w: 104, on: (t) => CALENDAR_TRIGGERS.includes(t.type) },
    { key: "delay", label: fieldLabel("trDelay"), tip: fieldTip("trDelay"), w: 104, on: (t) => DELAY_TRIGGERS.includes(t.type) },
    { key: "eventLog", label: fieldLabel("trEventLog"), tip: fieldTip("trEventLog"), w: 104, on: (t) => t.type === "event" },
    { key: "eventSource", label: fieldLabel("trEventSource"), tip: fieldTip("trEventSource"), w: 132, on: (t) => t.type === "event" },
    { key: "eventId", label: fieldLabel("trEventId"), tip: fieldTip("trEventId"), w: 76, on: (t) => t.type === "event" },
    { key: "stateChange", label: fieldLabel("trStateChange"), tip: fieldTip("trStateChange"), w: 140, on: (t) => t.type === "sessionStateChange" },
    { key: "userId", label: fieldLabel("trUserId"), tip: fieldTip("trUserId"), w: 118, on: (t) => t.type === "sessionStateChange" },
    { key: "enabled", label: fieldLabel("enabled"), tip: fieldTip("enabled"), w: 46 },
    { key: "ops", label: "", tip: "", w: 36 },
  ];
  // Fixed column widths; header and rows share one template. min-width is derived
  // from the real column count and handed to the horizontal scrollbar
  const trigCols = $derived(TRIG_COLS.filter((c) => !c.on || cfg.triggers.some(c.on)));
  const trigTpl = $derived(trigCols.map((c) => `${c.w}px`).join(" "));
  const trigMin = $derived(trigCols.reduce((n, c) => n + c.w, 0) + trigCols.length * 6 + 10);

  // Drag to reorder: only the handle on the left is draggable, so inline inputs keep
  // normal text selection and clicks
  let dragKind = $state(null); // "triggers" | "actions"
  let dragIndex = $state(-1);
  let overIndex = $state(-1);

  function onDragStart(e, kind, i) {
    dragKind = kind;
    dragIndex = i;
    overIndex = i;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(i));
      // The default drag image is the small handle; the whole row looks better
      const row = e.currentTarget?.parentElement;
      if (row) e.dataTransfer.setDragImage(row, 12, 12);
    }
  }

  function onDragOver(e, i) {
    if (!dragKind) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    overIndex = i;
  }

  function onDrop(e, kind, i) {
    if (dragKind !== kind || dragIndex < 0 || dragIndex === i) return onDragEnd();
    e.preventDefault();
    const arr = kind === "triggers" ? [...cfg.triggers] : [...cfg.actions];
    const [moved] = arr.splice(dragIndex, 1);
    arr.splice(i, 0, moved);
    if (kind === "triggers") cfg.triggers = arr;
    else cfg.actions = arr;
    onDragEnd();
  }

  function onDragEnd() {
    dragKind = null;
    dragIndex = -1;
    overIndex = -1;
  }

  function setPresetAccount(acct) {
    cfg.principal.userId = acct;
    cfg.principal.logonType = acct ? "ServiceAccount" : "InteractiveToken";
    cfg.principal.groupId = "";
  }

  function num(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  async function submit() {
    error = "";
    // The name can be judged without a backend round trip, so check it first and skip
    // a pointless fetch
    if (!name.trim()) {
      error = tr("editor.nameEmpty");
      return;
    }
    saving = true;
    try {
      // Sections such as identity / triggers / actions are not read in "General";
      // fill them in before submit
      if (isEdit) await ensureLoaded();
      // Triggers and actions are the two things a task cannot run without: missing
      // either one stops the save and jumps to that section
      const bad = validateForSave(cfg, SECTIONS.map((s) => s.id));
      if (bad) {
        error = bad.error;
        scrollTo(bad.section);
        return;
      }
      await api.saveTask({
        name: name.trim(),
        path: normalizePath(path),
        originalName: isEdit ? task.name : "",
        originalPath: isEdit ? task.path : "",
        config: {
          registration: {
            author: cfg.registration.author || "",
            description: cfg.registration.description || "",
            securityDescriptor: cfg.registration.securityDescriptor || "",
            source: cfg.registration.source || "",
            version: cfg.registration.version || "",
            documentation: cfg.registration.documentation || "",
          },
          principal: {
            // A group principal and a user principal are mutually exclusive: pick a
            // group and no user may go with it (and vice versa), otherwise the XML
            // carries both UserId and GroupId and the engine rejects it.
            userId: cfg.principal.logonType === "Group" ? "" : cfg.principal.userId || "",
            groupId: cfg.principal.logonType === "Group" ? cfg.principal.groupId || "" : "",
            logonType: cfg.principal.logonType || "InteractiveToken",
            runLevel: cfg.principal.runLevel || "LeastPrivilege",
            password: cfg.principal.password || "",
          },
          settings: {
            enabled: !!cfg.settings.enabled,
            allowStartOnDemand: !!cfg.settings.allowStartOnDemand,
            runOnlyIfIdle: !!cfg.settings.runOnlyIfIdle,
            // Duration fields are always ISO strings (PT10M / P3D) and must never go
            // through num(): Number("PT10M") is NaN, which falls back to a default
            // number, and the backend then treats that invalid value as PT0S —
            // silently wiping the setting.
            idleDuration: cfg.settings.idleDuration || "PT0S",
            waitTimeout: cfg.settings.waitTimeout || "PT0S",
            stopOnIdleEnd: !!cfg.settings.stopOnIdleEnd,
            restartOnIdle: !!cfg.settings.restartOnIdle,
            allowHardTerminate: !!cfg.settings.allowHardTerminate,
            startWhenAvailable: !!cfg.settings.startWhenAvailable,
            runOnlyIfNetworkAvailable: !!cfg.settings.runOnlyIfNetworkAvailable,
            networkId: cfg.settings.networkId || "",
            networkName: cfg.settings.networkName || "",
            disallowStartIfOnBatteries: !!cfg.settings.disallowStartIfOnBatteries,
            stopIfGoingOnBatteries: !!cfg.settings.stopIfGoingOnBatteries,
            wakeToRun: !!cfg.settings.wakeToRun,
            executionTimeLimit: cfg.settings.executionTimeLimit || "PT0S",
            multipleInstancesPolicy: cfg.settings.multipleInstancesPolicy || "IgnoreNew",
            restartCount: num(cfg.settings.restartCount, 0),
            restartInterval: cfg.settings.restartInterval || "PT1M",
            deleteExpiredTaskAfter: cfg.settings.deleteExpiredTaskAfter || "PT0S",
            hidden: !!cfg.settings.hidden,
            priority: num(cfg.settings.priority, 7),
            xmlVersion: cfg.settings.xmlVersion || "1.2",
            useUnifiedSchedulingEngine: !!cfg.settings.useUnifiedSchedulingEngine,
            disallowStartOnRemoteAppSession: !!cfg.settings.disallowStartOnRemoteAppSession,
            volatile: !!cfg.settings.volatile,
            maintenanceEnabled: !!cfg.settings.maintenanceEnabled,
            maintenancePeriod: cfg.settings.maintenancePeriod || "P1D",
            maintenanceDeadline: cfg.settings.maintenanceDeadline || "P2D",
            maintenanceExclusive: !!cfg.settings.maintenanceExclusive,
          },
          // The UI shows a single "command line" row; here it is split into the
          // Command + Arguments the XML wants
          actions: cfg.actions.map((a) => {
            if (a.type !== "exec") return { ...a };
            return { ...a, ...splitCommand(a.commandLine) };
          }),
          triggers: cfg.triggers.map((t) => ({ ...t, repetition: { ...t.repetition } })),
        },
      });
      await onSaved?.();
      onClose?.();
    } catch (e) {
      error = errText(e, "editor.saveFailed");
    } finally {
      saving = false;
    }
  }

  // Export: the system save dialog only picks a path; writing the file is the
  // backend's job. The XML may carry credential-related settings, and this keeps them
  // out of the frontend and avoids granting the frontend file-system access.
  async function exportXml() {
    if (!api.isTauri || exporting) return;
    exporting = true;
    exportMsg = "";
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const file = await save({
        defaultPath: `${task?.name ?? "task"}.xml`,
        filters: [{ name: tr("editor.xmlTitle"), extensions: ["xml"] }],
      });
      if (!file) return;
      await api.exportTaskXml(task.name, task.path ?? "\\", file);
      exportMsg = tr("editor.exported");
      setTimeout(() => (exportMsg = ""), 2600);
    } catch (e) {
      error = errText(e, "editor.exportFailed");
    } finally {
      exporting = false;
    }
  }
</script>

<div class="mask" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose?.()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
    <header>
      <h3>{title}</h3>
      <button class="close" type="button" onclick={() => onClose?.()}>×</button>
    </header>

    <div class="panes">
      <nav class="anchors" aria-label={tr("editor.navAria")}>
        {#each SECTIONS as a (a.id)}
          <button
            class="anchor"
            class:active={active === a.id}
            type="button"
            onclick={() => scrollTo(a.id)}
          >
            <span class="a-line">
              <span class="a-label">{a.label}</span>
              {#if status[a.id] === "loading"}
                <span class="a-badge spin" title={tr("editor.loading")}>…</span>
              {:else if status[a.id] === "error"}
                <span class="a-badge bad" title={tr("editor.loadFailed")}>!</span>
              {/if}
            </span>
            <span class="a-src">{a.src}</span>
          </button>
        {/each}
      </nav>

      <div class="body" bind:this={bodyEl} onscroll={onScroll}>
        <!-- General: identical in create and edit mode -->
        <section id="sec-identity" class="pane" data-section="identity">
          <div class="pane-head">{tr("editor.sectionIdentity")}</div>
          {#if status.identity === "loading"}
            <div class="loading-box">{tr("editor.loadingIdentity")}</div>
          {:else if status.identity === "error"}
            <div class="err-box">
              <span>{sectionError.identity}</span>
              <button class="mini" type="button" onclick={() => loadSection("identity")}>{tr("editor.retry")}</button>
            </div>
          {:else}
            <div class="grid2">
              <label class="field">
                <span class="lb" title={fieldTip("regName")}>{fieldLabel("regName")} <i>*</i></span>
                <input bind:value={name} placeholder={tr("editor.namePlaceholder")} data-testid="edit-name" />
              </label>
              <div class="field">
                <span class="lb" title={fieldTip("regPath")}>{fieldLabel("regPath")}</span>
                <FolderTreeSelect
                  tree={groupTree}
                  value={path}
                  onSelect={(p) => (path = p)}
                />
              </div>
            </div>

            <label class="field">
              <span class="lb" title={fieldTip("regDescription")}>{fieldLabel("regDescription")}</span>
              <input bind:value={cfg.registration.description} placeholder={tr("editor.descPlaceholder")} />
            </label>

            {#if unsupportedNodes.length}
              <p class="warn" data-testid="unsupported-nodes">
                {tr("editor.unsupportedPre", { n: unsupportedNodes.length })}<b>{tr("editor.keepAsIs")}</b>{tr("editor.unsupportedPost")}
                {unsupportedNodes.join(listSep())}
              </p>
            {/if}

            <!-- Author and registration info live under "More", collapsed by default -->
            <details class="adv more" bind:open={moreOpen}>
              <summary title={moreTip} data-testid="reg-more">
                <span class="caret">▾</span><span>{tr("editor.more")}</span>
                {#if !moreOpen}
                  <span class="more-fields">{tr("editor.moreFields")}</span>
                {/if}
                {#if moreFilled}
                  <span class="more-cnt">{tr("editor.moreFilled", { n: moreFilled })}</span>
                {/if}
              </summary>
              <div class="adv-body">
                <label class="field">
                  <span class="lb" title={fieldTip("regAuthor")}>{fieldLabel("regAuthor")}</span>
                  <input
                    bind:value={cfg.registration.author}
                    placeholder={tr("editor.authorPlaceholder")}
                    data-testid="edit-author"
                  />
                </label>
                <div class="divider"></div>
                <div class="grid2">
                  <label class="field">
                    <span class="lb" title={fieldTip("regSource")}>{fieldLabel("regSource")}</span>
                    <input bind:value={cfg.registration.source} placeholder={tr("editor.sourcePlaceholder")} />
                  </label>
                  <label class="field">
                    <span class="lb" title={fieldTip("regVersion")}>{fieldLabel("regVersion")}</span>
                    <input bind:value={cfg.registration.version} placeholder="1.0.0" />
                  </label>
                </div>
                <label class="field">
                  <span class="lb" title={fieldTip("regDocumentation")}>{fieldLabel("regDocumentation")}</span>
                  <input bind:value={cfg.registration.documentation} placeholder={tr("editor.docPlaceholder")} />
                </label>
                <label class="field">
                  <span class="lb" title={fieldTip("regSecurityDescriptor")}>{fieldLabel("regSecurityDescriptor")}</span>
                  <input
                    class="mono"
                    spellcheck="false"
                    bind:value={cfg.registration.securityDescriptor}
                    placeholder={tr("editor.sdPlaceholder")}
                  />
                </label>
              </div>
            </details>
          {/if}
        </section>

        <section id="sec-triggers" class="pane">
          <div class="pane-head">{tr("editor.sectionTriggers")}</div>
          {#if status.triggers === "loading"}
            <div class="loading-box">{tr("editor.loadingTriggers")}</div>
          {:else if status.triggers === "error"}
            <div class="err-box">
              <span>{sectionError.triggers}</span>
              <button class="mini" type="button" onclick={() => loadSection("triggers")}>{tr("editor.retry")}</button>
            </div>
          {:else}
          <div class="block">
            <div class="blk-head">
              <button class="tb" type="button" onclick={() => (cronOpen = true)} data-testid="add-trigger-batch">
                <Icon name="plus" size={15} /><span>{tr("editor.addTriggersFromCron")}</span>
              </button>
              <button class="tb primary" type="button" onclick={addTrigger} data-testid="add-trigger">
                <Icon name="plus" size={15} /><span>{tr("editor.addTrigger")}</span>
              </button>
            </div>

            {#if cfg.triggers.length}
            <div class="tgrid trig" style:--cols={trigTpl} style:min-width="{trigMin}px">
              <div class="thead">
                {#each trigCols as c (c.key)}
                  <span title={c.tip || ""}>{c.label}</span>
                {/each}
              </div>

              {#each cfg.triggers as tg, i (i)}
                <div
                  class="trow"
                  class:over={dragKind === "triggers" && overIndex === i}
                  class:dragging={dragKind === "triggers" && dragIndex === i}
                  class:expanded={trExpand.index === i}
                  ondragover={(e) => onDragOver(e, i)}
                  ondrop={(e) => onDrop(e, "triggers", i)}
                >
                  {#each trigCols as c (c.key)}
                    {#if c.key === "grip"}
                      <span
                        role="button"
                        class="grip"
                        draggable="true"
                        ondragstart={(e) => onDragStart(e, "triggers", i)}
                        ondragend={onDragEnd}
                        title={tr("editor.dragReorder")}>⣿</span
                      >
                    {:else if c.key === "idx"}
                      <span class="idx">{i + 1}</span>
                    {:else if c.key === "type"}
                      <select class="cell-min tp" bind:value={tg.type} title={fieldTip("trType")}>
                        {#each triggerTypes() as o (o.value)}
                          <option value={o.value}>{o.label}</option>
                        {/each}
                      </select>
                    {:else if c.key === "period"}
                      <!-- Schedule: calendar triggers expand in place here, other kinds only get a read-only summary -->
                      <button
                        class="per"
                        type="button"
                        class:on={trExpand.kind === "period" && trExpand.index === i}
                        disabled={!hasPeriod(tg.type)}
                        title={hasPeriod(tg.type) ? tr("editor.cellHintShort") : periodSummary(tg)}
                        onclick={() => toggleTr("period", i)}
                        data-testid="period-btn"
                      >
                        <span class="per-txt">{periodSummary(tg)}</span>
                        {#if hasPeriod(tg.type)}
                          <span class="per-arrow">▾</span>
                        {/if}
                      </button>
                    {:else if c.key === "interval"}
                      <DurationField
                        bind:value={tg.repetition.interval}
                        min={LIMITS.repeatInterval.min}
                        max={LIMITS.repeatInterval.max}
                        zeroText={tr("editor.noRepeat")}
                        title={fieldTip("trRepeatInterval")}
                      />
                    {:else if c.key === "duration"}
                      <DurationField
                        bind:value={tg.repetition.duration}
                        min={Math.max(LIMITS.repeatDuration.min, toSeconds(tg.repetition.interval))}
                        max={LIMITS.repeatDuration.max}
                        zeroText={tr("editor.repeatForever")}
                        title={fieldTip("trRepeatDuration")}
                      />
                    {:else if c.key === "stop"}
                      <!-- Without a duration there is nothing to "stop at", so disable it -->
                      <Toggle
                        bind:checked={tg.repetition.stopAtDurationEnd}
                        label={fieldLabel("trStopAtDurationEnd")}
                        disabled={!toSeconds(tg.repetition.duration)}
                      />
                    {:else if c.key === "limit"}
                      <DurationField
                        bind:value={tg.executionTimeLimit}
                        min={LIMITS.executionTimeLimit.min}
                        max={LIMITS.executionTimeLimit.max}
                        zeroText={tr("editor.noLimit")}
                        title={fieldTip("trExecutionTimeLimit")}
                      />
                    {:else if c.key === "start"}
                      <DateTimeField bind:value={tg.start} />
                    {:else if c.key === "end"}
                      <DateTimeField bind:value={tg.end} />
                    {:else if c.key === "randomDelay"}
                      {#if CALENDAR_TRIGGERS.includes(tg.type)}
                        <DurationField
                          bind:value={tg.randomDelay}
                          min={LIMITS.randomDelay.min}
                          max={LIMITS.randomDelay.max}
                          zeroText={tr("editor.noDelay")}
                          title={fieldTip("trRandomDelay")}
                        />
                      {:else}
                        <span></span>
                      {/if}
                    {:else if c.key === "gap"}
                      {#if tg.type === "daily"}
                        <span class="cell">
                          <input class="num xs" type="number" min="1" bind:value={tg.daysInterval} />
                          <span class="unit">{tr("editor.dayUnit")}</span>
                        </span>
                      {:else if tg.type === "weekly"}
                        <span class="cell">
                          <input class="num xs" type="number" min="1" bind:value={tg.weeksInterval} />
                          <span class="unit">{tr("editor.weekUnit")}</span>
                        </span>
                      {:else}
                        <span></span>
                      {/if}
                    {:else if c.key === "delay"}
                      {#if DELAY_TRIGGERS.includes(tg.type)}
                        <DurationField
                          bind:value={tg.delay}
                          min={LIMITS.delay.min}
                          max={LIMITS.delay.max}
                          zeroText={tr("editor.immediate")}
                          title={fieldTip("trDelay")}
                        />
                      {:else}
                        <span></span>
                      {/if}
                    {:else if c.key === "eventLog"}
                      {#if tg.type === "event"}
                        <select class="cell-min" bind:value={tg.eventLog} title={fieldTip("trEventLog")}>
                          {#each EVENT_LOGS as l (l)}
                            <option value={l}>{l}</option>
                          {/each}
                        </select>
                      {:else}
                        <span></span>
                      {/if}
                    {:else if c.key === "eventSource"}
                      {#if tg.type === "event"}
                        <input class="cell-min sm" bind:value={tg.eventSource} placeholder={tr("editor.anySource")} title={fieldTip("trEventSource")} />
                      {:else}
                        <span></span>
                      {/if}
                    {:else if c.key === "eventId"}
                      {#if tg.type === "event"}
                        <input class="num xs" type="number" min="0" bind:value={tg.eventId} title={fieldTip("trEventId")} />
                      {:else}
                        <span></span>
                      {/if}
                    {:else if c.key === "stateChange"}
                      {#if tg.type === "sessionStateChange"}
                        <select class="cell-min" bind:value={tg.stateChange} title={fieldTip("trStateChange")}>
                          {#each sessionStateOptions() as o (o.value)}
                            <option value={o.value}>{o.label}</option>
                          {/each}
                        </select>
                      {:else}
                        <span></span>
                      {/if}
                    {:else if c.key === "userId"}
                      {#if tg.type === "sessionStateChange"}
                        <input class="cell-min sm" bind:value={tg.userId} placeholder={tr("editor.anyUser")} title={fieldTip("trUserId")} />
                      {:else}
                        <span></span>
                      {/if}
                    {:else if c.key === "enabled"}
                      <Toggle bind:checked={tg.enabled} label={fieldLabel("enabled")} />
                    {:else}
                      <span class="ops">
                        <IconButton icon="remove" label={tr("editor.deleteRow")} danger onclick={() => removeTrigger(i)} />
                      </span>
                    {/if}
                  {/each}
                </div>

                {#if trExpand.kind === "period" && trExpand.index === i}
                  <div class="texpand" data-testid="tg-expand">
                      {#if tg.type === "weekly"}
                        <span class="ex-lb">{fieldLabel("trDaysOfWeek")}</span>
                        <span class="days">
                          {#each weekOptions() as d (d.value)}
                            <button
                              type="button"
                              class="day"
                              class:on={tg.daysOfWeek.includes(d.value)}
                              onclick={() => (tg.daysOfWeek = toggleBit(tg.daysOfWeek, d.value))}
                            >{d.label}</button>
                          {/each}
                        </span>
                      {:else if tg.type === "monthly"}
                        <span class="ex-lb">{fieldLabel("trDaysOfMonth")}</span>
                        <span class="daygrid">
                          {#each Array.from({ length: 31 }, (_, k) => k + 1) as d (d)}
                            <button
                              type="button"
                              class="day sq"
                              class:on={tg.daysOfMonth.includes(d)}
                              onclick={() => (tg.daysOfMonth = toggleBit(tg.daysOfMonth, d))}
                            >{d}</button>
                          {/each}
                        </span>
                        <span class="ex-lb">{fieldLabel("trMonths")}</span>
                        <MonthBits compact bind:months={tg.months} />
                      {:else if tg.type === "monthlyDow"}
                        <span class="ex-lb">{fieldLabel("trMonthWeek")}</span>
                        <select class="cell-min" bind:value={tg.monthWeek}>
                          <option value={0}>{tr("editor.everyWeek")}</option>
                          <option value={1}>{tr("editor.week1")}</option>
                          <option value={2}>{tr("editor.week2")}</option>
                          <option value={3}>{tr("editor.week3")}</option>
                          <option value={4}>{tr("editor.week4")}</option>
                          <option value={5} title={tr("editor.noFifthWeek")}>{tr("editor.weekLast")}</option>
                        </select>
                        <span class="ex-lb">{fieldLabel("trDaysOfWeek")}</span>
                        <span class="days">
                          {#each weekOptions() as d (d.value)}
                            <button
                              type="button"
                              class="day"
                              class:on={tg.daysOfWeek.includes(d.value)}
                              onclick={() => (tg.daysOfWeek = toggleBit(tg.daysOfWeek, d.value))}
                            >{d.label}</button>
                          {/each}
                        </span>
                        <span class="ex-lb">{fieldLabel("trMonths")}</span>
                        <MonthBits compact bind:months={tg.months} />
                      {/if}
                  </div>
                {/if}
              {/each}
            </div>

            <div class="nextrun" data-testid="next-run">
              <div class="nr-head">
                <span class="nr-lb">{tr("editor.nextRunsPre")}</span>
                <input
                  class="num xs"
                  type="number"
                  min="1"
                  max="200"
                  bind:value={nextCount}
                  title={tr("editor.nextRunsTip")}
                  data-testid="next-run-count"
                />
                <span class="nr-lb">{tr("editor.nextRunsPost")}</span>
                {#if nr.busy}
                  <span class="nr-note" data-testid="next-run-busy">{tr("editor.computing")}</span>
                {/if}
              </div>

              {#if nr.error}
                <p class="err" data-testid="next-run-err">{nr.error}</p>
              {:else if nr.unsupported}
                <p class="hint" data-testid="next-run-unsupported">
                  {tr("editor.demoUnavailablePre")}<code>npm run tauri:dev</code>{tr("editor.demoUnavailablePost")}
                </p>
              {:else if !liveTriggers.length}
                <p class="hint" data-testid="next-run-empty">{tr("editor.noEnabledTrigger")}</p>
              {:else if !nr.busy && !nrRows.length}
                <p class="hint" data-testid="next-run-empty">{tr("editor.noRunIn10y")}</p>
              {/if}

              {#if nrRows.length}
                <ol class="nr-list" data-testid="next-run-list">
                  {#each nrRows as ms (ms)}
                    <li>
                      <span class="nr-t">{formatStamp(ms)}</span>
                      <span class="nr-w">{weekShort(ms)}</span>
                      <span class="nr-rel">{tr("editor.relPrefix", { t: formatRelative(ms, nowMs) })}</span>
                    </li>
                  {/each}
                </ol>
                {#if nrRows.length < nrCount}
                  <p class="hint">{tr("editor.onlyNIn10y", { n: nrRows.length })}</p>
                {/if}
              {/if}
              {#if hasRandomDelay && nrRows.length}
                <p class="hint">
                  {tr("editor.randomDelayNote")}
                </p>
              {/if}

              {#if untimedTriggers.length}
                <p class="hint" data-testid="next-run-untimed">
                  {tr("editor.untimedNote", { list: noList(untimedTriggers) })}
                </p>
              {/if}
            </div>
            {/if}
          </div>
          {/if}
        </section>

        <section id="sec-actions" class="pane">
          <div class="pane-head">{tr("editor.sectionActions")}</div>
          {#if status.actions === "loading"}
            <div class="loading-box">{tr("editor.loadingActions")}</div>
          {:else if status.actions === "error"}
            <div class="err-box">
              <span>{sectionError.actions}</span>
              <button class="mini" type="button" onclick={() => loadSection("actions")}>{tr("editor.retry")}</button>
            </div>
          {:else}
          <div class="block">
            <div class="blk-head">
              <button class="tb primary" type="button" onclick={addAction} data-testid="add-action">
                <Icon name="plus" size={15} /><span>{tr("editor.addAction")}</span>
              </button>
            </div>

            {#if cfg.actions.length}
            <div class="tgrid act">
              <div class="thead">
                <span></span>
                <span>#</span>
                <span title={fieldTip("actType")}>{tr("editor.actType")}</span>
                <span title={fieldTip("actCommand")}>{tr("editor.actCommand")}<i>*</i></span>
                <span title={fieldTip("actWorkingDirectory")}>{tr("editor.actWorkDir")}</span>
                <span></span>
              </div>

              {#each cfg.actions as a, i (i)}
                <div
                  class="trow"
                  class:over={dragKind === "actions" && overIndex === i}
                  class:dragging={dragKind === "actions" && dragIndex === i}
                  ondragover={(e) => onDragOver(e, i)}
                  ondrop={(e) => onDrop(e, "actions", i)}
                >
                  <span
                    role="button"
                    class="grip"
                    draggable="true"
                    ondragstart={(e) => onDragStart(e, "actions", i)}
                    ondragend={onDragEnd}
                    title={tr("editor.dragReorder")}>⣿</span
                  >
                  <span class="idx">{i + 1}</span>
                  <select
                    class="cell-min"
                    bind:value={a.type}
                    disabled={a.type === "com" || a.type === "unknown"}
                    title={fieldTip("actType")}
                  >
                    <option value="exec">{tr("editor.actExec")}</option>
                    {#if a.type === "com"}
                      <option value="com">{tr("editor.actCom")}</option>
                    {:else if a.type === "unknown"}
                      <option value="unknown">{tr("editor.actUnknown")}</option>
                    {/if}
                  </select>

                  {#if a.type === "com"}
                    <span class="cell note">{tr("editor.actComHandler", { id: a.classId || "—" })}</span>
                    <span class="cell note">{tr("editor.actReadonly")}</span>
                  {:else if a.type === "unknown"}
                    <span class="cell note">{tr("editor.actUnsupported")}</span>
                    <span class="cell note">{tr("editor.actKeep")}</span>
                  {:else}
                    <CommandField bind:value={a.commandLine} />
                    <input
                      class="cell-min wd"
                      bind:value={a.workingDirectory}
                      placeholder={tr("editor.useSystemDefault")}
                      title={fieldTip("actWorkingDirectory")}
                    />
                  {/if}

                  <span class="ops">
                    <IconButton icon="remove" label={tr("editor.deleteRow")} danger onclick={() => removeAction(i)} />
                  </span>
                </div>
              {/each}
            </div>
            {/if}
          </div>
          {/if}
        </section>

        <!-- Conditions and settings both come from <Settings>, i.e. one fetch, so they merge into a single anchor module -->
        <section id="sec-settings" class="pane">
          <div class="pane-head">{tr("editor.sectionSettings")}</div>
          {#if status.settings === "loading"}
            <div class="loading-box">{tr("editor.loadingSettings")}</div>
          {:else if status.settings === "error"}
            <div class="err-box">
              <span>{sectionError.settings}</span>
              <button class="mini" type="button" onclick={() => loadSection("settings")}>{tr("editor.retry")}</button>
            </div>
          {:else}
          <!-- Conditions: semantically related fields share a row and wrap when they do not fit -->
          <div class="section">
            <div class="sec-title">{tr("editor.conditions")}</div>
            <div class="group">
              <Switch bind:checked={cfg.settings.runOnlyIfIdle} label={fieldLabel("runOnlyIfIdle")} title={fieldTip("runOnlyIfIdle")} />
              <span class="cell">
                <span class="lb" title={fieldTip("idleDuration")}>{fieldLabel("idleDuration")}</span>
                <DurationField
                  bind:value={cfg.settings.idleDuration}
                  min={LIMITS.idleDuration.min}
                  max={LIMITS.idleDuration.max}
                  zeroText={tr("editor.systemDefault")}
                  title={fieldTip("idleDuration")}
                />
              </span>
              <span class="cell">
                <span class="lb" title={fieldTip("waitTimeout")}>{fieldLabel("waitTimeout")}</span>
                <DurationField
                  bind:value={cfg.settings.waitTimeout}
                  min={LIMITS.waitTimeout.min}
                  max={LIMITS.waitTimeout.max}
                  zeroText={tr("editor.noWait")}
                  title={fieldTip("waitTimeout")}
                />
              </span>
              <Switch bind:checked={cfg.settings.stopOnIdleEnd} label={fieldLabel("stopOnIdleEnd")} title={fieldTip("stopOnIdleEnd")} />
              <Switch bind:checked={cfg.settings.restartOnIdle} label={fieldLabel("restartOnIdle")} title={fieldTip("restartOnIdle")} />
            </div>

            <div class="divider"></div>
            <div class="group">
              <Switch
                bind:checked={cfg.settings.runOnlyIfNetworkAvailable}
                label={fieldLabel("runOnlyIfNetworkAvailable")}
                title={fieldTip("runOnlyIfNetworkAvailable")}
              />
            </div>

            <div class="divider"></div>
            <div class="group">
              <Switch bind:checked={cfg.settings.disallowStartIfOnBatteries} label={fieldLabel("disallowStartIfOnBatteries")} title={fieldTip("disallowStartIfOnBatteries")} />
              <Switch bind:checked={cfg.settings.stopIfGoingOnBatteries} label={fieldLabel("stopIfGoingOnBatteries")} title={fieldTip("stopIfGoingOnBatteries")} />
              <Switch bind:checked={cfg.settings.wakeToRun} label={fieldLabel("wakeToRun")} title={fieldTip("wakeToRun")} />
            </div>
          </div>

          <!-- Runtime control -->
          <div class="section">
            <div class="sec-title">{tr("editor.controls")}</div>
            <div class="group">
              <Switch bind:checked={cfg.settings.enabled} label={fieldLabel("enabled")} title={fieldTip("enabled")} />
              <Switch bind:checked={cfg.settings.allowStartOnDemand} label={fieldLabel("allowStartOnDemand")} title={fieldTip("allowStartOnDemand")} />
              <Switch bind:checked={cfg.settings.startWhenAvailable} label={fieldLabel("startWhenAvailable")} title={fieldTip("startWhenAvailable")} />
              <Switch bind:checked={cfg.settings.allowHardTerminate} label={fieldLabel("allowHardTerminate")} title={fieldTip("allowHardTerminate")} />
            </div>

            <div class="divider"></div>
            <div class="group">
              <span class="cell">
                <span class="lb" title={fieldTip("restartCount")}>{fieldLabel("restartCount")}</span>
                <input class="num xs" type="number" min="0" bind:value={cfg.settings.restartCount} />
              </span>
              <span class="cell">
                <span class="lb" title={fieldTip("restartInterval")}>{fieldLabel("restartInterval")}</span>
                <DurationField
                  bind:value={cfg.settings.restartInterval}
                  min={LIMITS.restartInterval.min}
                  max={LIMITS.restartInterval.max}
                  noZero
                  title={fieldTip("restartInterval")}
                />
              </span>
              <span class="cell">
                <span class="lb" title={fieldTip("deleteExpiredTaskAfter")}>{fieldLabel("deleteExpiredTaskAfter")}</span>
                <DurationField
                  bind:value={cfg.settings.deleteExpiredTaskAfter}
                  min={LIMITS.deleteExpired.min}
                  max={LIMITS.deleteExpired.max}
                  zeroText={tr("editor.noDelete")}
                  title={fieldTip("deleteExpiredTaskAfter")}
                />
              </span>
            </div>

            <div class="divider"></div>
            <div class="group">
              <span class="cell">
                <span class="lb" title={fieldTip("multipleInstancesPolicy")}>{fieldLabel("multipleInstancesPolicy")}</span>
                <select bind:value={cfg.settings.multipleInstancesPolicy}>
                  {#each multipleInstances() as o (o.value)}
                    <option value={o.value}>{o.label}</option>
                  {/each}
                </select>
              </span>
            </div>
          </div>

          <!-- Less common options move under "More settings" to keep the surface small -->
          <details class="adv">
            <summary><span class="caret">▾</span>{tr("editor.moreSettings")}</summary>
            <div class="adv-body">
              <div class="group">
                <span class="cell">
                  <span class="lb muted" title={fieldTip("executionTimeLimit")}>{fieldLabel("executionTimeLimit")}</span>
                  <DurationField
                    bind:value={cfg.settings.executionTimeLimit}
                    min={LIMITS.executionTimeLimit.min}
                    max={LIMITS.executionTimeLimit.max}
                    zeroText={tr("editor.noTimeLimit")}
                    title={fieldTip("executionTimeLimit")}
                  />
                </span>
                <Switch bind:checked={cfg.settings.hidden} label={fieldLabel("hidden")} title={fieldTip("hidden")} muted />
                <span class="cell">
                  <span class="lb muted" title={fieldTip("priority")}>{fieldLabel("priority")}</span>
                  <input class="num xs" type="number" min="0" max="9" bind:value={cfg.settings.priority} />
                </span>
              </div>

              <div class="divider"></div>
              <div class="group">
                <Switch bind:checked={cfg.settings.useUnifiedSchedulingEngine} label={fieldLabel("useUnifiedSchedulingEngine")} title={fieldTip("useUnifiedSchedulingEngine")} disabled={!supported.use} muted />
                <Switch bind:checked={cfg.settings.disallowStartOnRemoteAppSession} label={fieldLabel("disallowStartOnRemoteAppSession")} title={fieldTip("disallowStartOnRemoteAppSession")} disabled={!supported.dsras} muted />
                <Switch bind:checked={cfg.settings.volatile} label={fieldLabel("volatile")} title={fieldTip("volatile")} disabled={!supported.vol} muted />
                <Switch bind:checked={cfg.settings.maintenanceEnabled} label={fieldLabel("maintenanceEnabled")} title={fieldTip("maintenanceEnabled")} disabled={!supported.maint} muted />
                {#if cfg.settings.maintenanceEnabled}
                  <span class="cell">
                    <span class="lb muted" title={fieldTip("maintenancePeriod")}>{fieldLabel("maintenancePeriod")}</span>
                    <DurationField
                      bind:value={cfg.settings.maintenancePeriod}
                      units={LIMITS.maintenancePeriod.units}
                      min={LIMITS.maintenancePeriod.min}
                      max={LIMITS.maintenancePeriod.max}
                      noZero
                      title={fieldTip("maintenancePeriod")}
                    />
                  </span>
                  <span class="cell">
                    <span class="lb muted" title={fieldTip("maintenanceDeadline")}>{fieldLabel("maintenanceDeadline")}</span>
                    <DurationField
                      bind:value={cfg.settings.maintenanceDeadline}
                      units={LIMITS.maintenanceDeadline.units}
                      min={Math.max(
                        LIMITS.maintenanceDeadline.min,
                        toSeconds(cfg.settings.maintenancePeriod) + 86400
                      )}
                      max={LIMITS.maintenanceDeadline.max}
                      noZero
                      title={fieldTip("maintenanceDeadline")}
                    />
                  </span>
                  <Switch bind:checked={cfg.settings.maintenanceExclusive} label={fieldLabel("maintenanceExclusive")} title={fieldTip("maintenanceExclusive")} muted />
                {/if}
              </div>

              <div class="divider"></div>
              <div class="group">
                <span class="cell">
                  <span class="lb muted" title={fieldTip("networkName")}>{fieldLabel("networkName")}</span>
                  <input class="sm" bind:value={cfg.settings.networkName} />
                </span>
                <span class="cell">
                  <span class="lb muted" title={fieldTip("networkId")}>{fieldLabel("networkId")}</span>
                  <input class="sm" bind:value={cfg.settings.networkId} />
                </span>
              </div>
            </div>
          </details>

          {#if isEdit}
            <div class="meta">
              <span>{tr("editor.metaState")}{task.state}</span>
              <span>{tr("editor.metaNextRun")}{task.nextRun || tr("editor.notScheduled")}</span>
              <span>{tr("editor.metaLastRun")}{task.lastRun || tr("editor.never")}</span>
              <span>{tr("editor.metaLastResult")}{task.lastResult || "—"}</span>
            </div>
          {/if}
          {/if}
        </section>

        <section id="sec-principal" class="pane">
          <div class="pane-head">{tr("editor.sectionPrincipal")}</div>
          <div class="pane-sub">{tr("editor.principalHint")}</div>
          {#if status.principal === "loading"}
            <div class="loading-box">{tr("editor.loadingPrincipal")}</div>
          {:else if status.principal === "error"}
            <div class="err-box">
              <span>{sectionError.principal}</span>
              <button class="mini" type="button" onclick={() => loadSection("principal")}>{tr("editor.retry")}</button>
            </div>
          {:else}
          <div class="section">
            {#if cfg.principal.logonType !== "Group"}
            <label class="field">
              <span class="lb" title={fieldTip("userId")}>{fieldLabel("userId")}</span>
              <div class="inline">
                <input bind:value={cfg.principal.userId} placeholder={tr("editor.currentUserShort")} />
                <button class="mini" type="button" onclick={() => setPresetAccount("")}>{tr("editor.currentUser")}</button>
                {#each SERVICE_ACCOUNTS as sa (sa)}
                  <button class="mini" type="button" onclick={() => setPresetAccount(sa)}>{sa}</button>
                {/each}
              </div>
            </label>
            {/if}

            <label class="field">
              <span class="lb" title={fieldTip("logonType")}>{fieldLabel("logonType")}</span>
              <select bind:value={cfg.principal.logonType}>
                {#each logonTypes() as o (o.value)}
                  <option value={o.value}>{o.label}</option>
                {/each}
              </select>
            </label>

            {#if cfg.principal.logonType === "Group"}
              <label class="field">
                <span class="lb" title={tr("editor.groupHint")}>{tr("editor.group")}</span>
                <input
                  bind:value={cfg.principal.groupId}
                  placeholder={tr("editor.groupPlaceholder")}
                  data-testid="principal-group-id"
                />
                <span class="hint">
                  {tr("editor.groupPrincipalNote")}
                </span>
              </label>
            {/if}

            {#if cfg.principal.logonType === "Password"}
              <label class="field">
                <span class="lb" title={fieldTip("password")}>{fieldLabel("password")}</span>
                <input type="password" bind:value={cfg.principal.password} placeholder={tr("editor.passwordOnce")} />
                <span class="hint">{tr("editor.passwordHint")}</span>
              </label>
            {/if}

            <label class="field">
              <span class="lb" title={fieldTip("runLevel")}>{fieldLabel("runLevel")}</span>
              <select bind:value={cfg.principal.runLevel}>
                {#each runLevels() as o (o.value)}
                  <option value={o.value}>{o.label}</option>
                {/each}
              </select>
            </label>
          </div>
          {/if}
        </section>
      </div>
    </div>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    <footer>
      {#if busy}
        <span class="busy" data-testid="editor-busy">{tr("editor.partialLoading")}</span>
      {/if}
      {#if isEdit}
        <button
          class="btn export"
          type="button"
          onclick={exportXml}
          disabled={!api.isTauri || exporting}
          title={api.isTauri ? tr("editor.exportTip") : tr("editor.exportTipDemo")}
          data-testid="export-task-xml"
        >
          <Icon name="download" size={13} />
          <span>{exporting ? tr("editor.exporting") : tr("editor.exportBtn")}</span>
        </button>
      {/if}
      {#if exportMsg}<span class="ex">{exportMsg}</span>{/if}
      <span class="flex-spacer"></span>
      <button class="btn" type="button" onclick={() => onClose?.()} disabled={saving}>{tr("editor.cancel")}</button>
      <button class="btn primary" type="button" onclick={submit} disabled={saving || busy}>
        {saving ? tr("editor.saving") : tr("editor.save")}
      </button>
    </footer>
  </div>
</div>

<!-- Add triggers in bulk: a dialog layered over the editor; Esc or a backdrop click closes it -->
{#if cronOpen}
  <CronBuilder onClose={() => (cronOpen = false)} onAdd={addTriggers} />
{/if}

<style>
  .mask {
    position: fixed;
    inset: 0;
    background: rgba(24, 33, 46, 0.42);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  /* There are many settings, so the dialog fills the screen instead of scrolling inside a small window */
  .dialog {
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
    background: #fff;
    border-radius: 0;
    box-shadow: none;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid #e8edf4;
  }

  h3 { margin: 0; font-size: 15px; color: #22303f; }

  .close {
    border: none; background: none; font-size: 20px; line-height: 1;
    color: #8b95a5; cursor: pointer;
  }

  /* Long form with anchor navigation on the left: modules stack vertically and clicking an anchor scrolls to it */
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .anchors {
    width: 148px;
    flex: none;
    border-right: 1px solid #e8edf4;
    background: #f7f9fc;
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }

  .anchor {
    border: none;
    background: none;
    text-align: left;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-left: 3px solid transparent;
    font-family: inherit;
  }
  .anchor:hover { background: #eef3fb; }
  .anchor.active { background: #e7f0fe; border-left-color: #1a73e8; }

  .a-line { display: flex; align-items: center; gap: 5px; }
  .a-label { font-size: 13px; color: #44506b; }
  .anchor.active .a-label { color: #1a73e8; font-weight: 600; }

  /* Per-section load markers: reading / failed */
  .a-badge {
    font-size: 11px;
    line-height: 1;
    min-width: 13px;
    height: 13px;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #8b95a5;
    background: #eef2f8;
  }
  .a-badge.spin { animation: pulse 1s ease-in-out infinite; }
  .a-badge.bad { background: #fdeceb; color: #c5221f; font-weight: 700; }
  @keyframes pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }

  .loading-box {
    padding: 14px 12px;
    font-size: 12.5px;
    color: #8b95a5;
    background: #f7f9fc;
    border: 1px dashed #dde4ee;
    border-radius: 6px;
    animation: pulse 1.2s ease-in-out infinite;
  }

  .err-box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    font-size: 12.5px;
    color: #c5221f;
    background: #fdeceb;
    border: 1px solid #f6cfcc;
    border-radius: 6px;
  }
  .err-box span { flex: 1; }
  .a-src {
    font-size: 10.5px;
    color: #9aa5b5;
    font-family: "Cascadia Mono", Consolas, monospace;
  }

  .pane { display: flex; flex-direction: column; gap: 12px; padding-top: 4px; }
  .pane + .pane { margin-top: 18px; border-top: 1px solid #eef2f8; padding-top: 16px; }
  .pane-head { font-size: 13.5px; font-weight: 700; color: #22303f; }
  .pane-sub { font-size: 11.5px; color: #8b95a5; margin-top: -6px; }

  .body {
    flex: 1;
    min-height: 0;
    padding: 16px 18px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .field { display: flex; flex-direction: column; gap: 5px; }

  .lb { font-size: 12px; color: #5a6678; font-weight: 600; }
  .lb i { color: #d93025; font-style: normal; }

  input, select {
    border: 1px solid #d6dde7; border-radius: 5px; padding: 7px 9px;
    font-size: 13px; font-family: inherit; color: #2f3742; background: #fff; outline: none;
  }
  input:focus, select:focus { border-color: #1a73e8; box-shadow: 0 0 0 2px rgba(26,115,232,0.14); }

  .hint { font-size: 11.5px; color: #8b95a5; }
  .err { font-size: 11.5px; color: #c5221f; }
  .warn {
    margin: 4px 0 8px;
    padding: 6px 9px;
    font-size: 11.5px;
    line-height: 1.5;
    color: #b26a00;
    background: #fff7e6;
    border: 1px solid #ffe0a3;
    border-radius: 4px;
  }

  .inline { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

  .mini {
    border: 1px solid #d6dde7; background: #fff; border-radius: 4px; font-size: 12px;
    padding: 3px 8px; cursor: pointer; color: #44506b;
  }
  .mini:hover { border-color: #1a73e8; color: #1a73e8; }


  .section { border: 1px solid #e8edf4; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .sec-title { font-size: 12px; font-weight: 700; color: #22303f; }
  /* Semantically related fields share a row and wrap when they do not fit; no more one field per line */
  .group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }

  /* Scroll horizontally when there are many columns rather than squeezing a row into two lines */
  .block { display: flex; flex-direction: column; gap: 8px; overflow-x: auto; }

  /* Section header: a one-line description on the left, the "Add" button on the right
     — same spot as the outer task list toolbar */
  .blk-head { display: flex; align-items: center; justify-content: flex-end; }
  .tb {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    border: 1px solid #d8e0ea;
    background: #fff;
    border-radius: 5px;
    padding: 0 12px;
    font-size: 12.5px;
    color: #44506b;
    cursor: pointer;
    flex: none;
  }
  .tb.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  .tb.primary:hover { background: #1665cc; }

  /* Triggers / actions: a table with field names. Header and rows share one set of
     column widths, so everything lines up. Triggers have many columns, so --cols
     and min-width are computed from the column definitions and written into
     style; the container handles the horizontal scrolling */
  .tgrid { display: flex; flex-direction: column; min-width: 100%; }
  .tgrid.act { --cols: 22px 22px 100px minmax(220px, 1fr) 220px 36px; }

  .thead,
  .trow {
    display: grid;
    grid-template-columns: var(--cols);
    align-items: center;
    gap: 6px;
  }

  .thead {
    padding: 0 8px 5px;
    font-size: 11.5px;
    font-weight: 700;
    color: #5a6678;
    border-bottom: 1px solid #e4eaf2;
  }
  /* Column names can be long (e.g. "Stop when the duration ends"), so they wrap
     instead of being cut into an ellipsis */
  .thead span { line-height: 1.25; word-break: break-all; }
  .thead i { color: #d93025; font-style: normal; }

  .trow {
    padding: 5px 8px;
    border-bottom: 1px solid #f1f4f9;
    min-height: 44px;
  }
  .trow:hover { background: #f8fafd; }
  .trow.dragging { opacity: 0.45; }
  .trow.over { background: #eaf1fb; box-shadow: inset 0 0 0 1px #1a73e8; }
  .trow.expanded { background: #f4f8fe; }

  /* The two icon buttons at the end of a row: same style as the task list buttons,
     pinned to the right */
  .ops { display: inline-flex; align-items: center; gap: 2px; justify-content: flex-end; }

  /* Next N run times: sits under the trigger table, the count is editable */
  .nextrun {
    margin-top: 10px;
    padding: 9px 11px;
    border: 1px solid #e2e9f2;
    border-radius: 6px;
    background: #f8fafd;
  }
  .nr-head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .nr-lb { font-size: 12.5px; color: #44506b; font-weight: 600; }
  .nr-note { font-size: 11.5px; color: #8b95a5; }
  .nr-list {
    margin: 0;
    padding-left: 20px;
    max-height: 210px;
    overflow: auto;
    font-size: 12.5px;
    color: #2f3742;
    line-height: 1.85;
  }
  .nr-list li { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .nr-t {
    font-family: "Cascadia Mono", Consolas, monospace;
    font-size: 12px;
    color: #1a73e8;
    font-weight: 600;
  }
  .nr-w { color: #5a6678; font-size: 12px; }
  .nr-rel { color: #b34a13; font-size: 11.5px; }
  .nr-src { color: #8b95a5; font-size: 11.5px; }
  .ok { margin: 2px 0 0; font-size: 11.5px; color: #137333; }

  /* Schedule picker: a one-line summary until clicked, then it expands in place */
  .per {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    min-width: 0;
    height: 28px;
    padding: 0 6px;
    border: 1px solid #d6dde7;
    border-radius: 5px;
    background: #fff;
    font-size: 12px;
    font-family: inherit;
    color: #2f3742;
    cursor: pointer;
    overflow: hidden;
  }
  .per:hover:not(:disabled) { border-color: #1a73e8; color: #1a73e8; }
  .per.on { border-color: #1a73e8; background: #eaf1fb; color: #1a73e8; }
  .per:disabled { color: #8b95a5; background: #fbfcfe; cursor: default; }
  .per-txt { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  .per-arrow { flex: none; font-size: 10px; color: #8b95a5; }

  /* Inline expansion: less common fields and schedule details live here and wrap freely */
  .texpand {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    padding: 9px 10px;
    margin: 0 0 4px;
    background: #f4f8fe;
    border: 1px solid #dbe7f8;
    border-radius: 6px;
    font-size: 12px;
  }
  .ex-lb { font-size: 11.5px; color: #8b95a5; font-weight: 600; }
  .ex-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
  .daygrid { display: grid; grid-template-columns: repeat(16, 1fr); gap: 3px; }
  .day.sq { min-width: 24px; height: 24px; padding: 0 2px; font-size: 11px; }

  .grip {
    cursor: grab;
    color: #b6c0cf;
    font-size: 12px;
    line-height: 1;
    user-select: none;
    padding: 0 1px;
  }
  .grip:active { cursor: grabbing; }
  .grip:hover { color: #1a73e8; }

  .cell { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
  .cell.note { font-size: 12px; color: #8b95a5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lb.muted { color: #8b95a5; font-weight: 500; }
  .unit { font-size: 11px; color: #8b95a5; line-height: 1; }
  .split { font-size: 11.5px; color: #3c4757; word-break: break-all; }

  .idx { width: 20px; height: 20px; border-radius: 50%; background: #1a73e8; color: #fff; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; }
  .days { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .day {
    min-width: 26px; height: 26px; border: 1px solid #d6dde7; border-radius: 4px;
    background: #fff; font-size: 12px; color: #5a6678; cursor: pointer;
  }
  .day.on { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  .num { width: 70px; }
  .num.xs { width: 50px; }
  .sm { width: 132px; }
  .tp { min-width: 0; }
  /* Controls inside the table always fill their own column and never spill into the
     next one */
  .cell-min { min-width: 0; width: 100%; }
  .wd { font-size: 12.5px; padding: 6px 8px; }


  .meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: #7a8699; border-top: 1px dashed #e8edf4; padding-top: 10px; }

  /* Thin divider that splits one group into semantic chunks */
  .divider { height: 1px; background: #eef2f8; margin: 2px 0; }

  /* Collapsible: uses the built-in arrow characters — pointing right when collapsed,
     down when expanded. No third-party icon set */
  .adv { margin-top: 10px; border: 1px dashed #d6dde7; border-radius: 6px; padding: 8px 10px; background: #fbfcfe; }
  .adv > summary {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12.5px;
    color: #5a6678;
    font-weight: 600;
    list-style: none;
  }
  .adv > summary::-webkit-details-marker { display: none; }
  .adv > summary .caret { flex: none; color: #8b95a5; transform: rotate(-90deg); transition: transform 0.15s; }
  .adv[open] > summary .caret { transform: none; }
  .more-fields { font-weight: 400; color: #8b95a5; }
  .more-cnt { font-weight: 400; color: #1a73e8; }
  .adv-body { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
  .mono { font-family: "Cascadia Mono", Consolas, "Courier New", monospace; font-size: 12px; }

  .error { margin: 0 18px 8px; padding: 8px 10px; background: #fdeceb; color: #c5221f; border-radius: 5px; font-size: 12.5px; }

  footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid #e8edf4; background: #fbfcfe; }

  .flex-spacer { flex: 1; }

  .btn.export { display: inline-flex; align-items: center; gap: 5px; }

  .ex { font-size: 12px; color: #22a06b; }

  .busy { flex: 1; font-size: 12px; color: #8b95a5; }

  .btn { min-width: 84px; height: 32px; border: 1px solid #d6dde7; background: #fff; border-radius: 5px; font-size: 13px; color: #44506b; cursor: pointer; }
  .btn.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  .btn.primary:hover:not(:disabled) { background: #1665cc; }
  .btn:disabled { opacity: 0.6; cursor: progress; }
</style>
