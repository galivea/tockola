/** Default values and dropdown options for the full task config schema. */
import { mergeCommand } from "./command.js";
import { isoFromSeconds, toSeconds } from "./duration.js";
import { t, has } from "./i18n/index.js";

// Windows durations only carry days/hours/minutes/seconds: P1M (months) and
// P1Y (years) are always rejected on registration. The UI cannot produce such
// a value, but legacy tasks may contain one, so it is folded into days on read to
// make sure the task can still be saved back.
const normDur = (v) => (v == null ? v : isoFromSeconds(toSeconds(v)));

/** Trigger start time: Windows fills in "now"; no business hour is picked for
 * the user. */
export function defaultStart() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function defaultConfig() {
  return {
    registration: {
      author: "",
      description: "",
      // The four items below are optional RegistrationInfo fields, rarely used,
      // but system tasks almost always carry a SecurityDescriptor; missing it on
      // read means it is wiped when the task is saved.
      securityDescriptor: "",
      source: "",
      version: "",
      documentation: "",
    },
    principal: {
      userId: "",
      groupId: "",
      // Engine defaults: LogonType=3 (run only while the user is logged on),
      // RunLevel=0 (least privilege, no elevation).
      logonType: "InteractiveToken",
      runLevel: "LeastPrivilege",
    },
    // What follows is not "defaults we find sensible" — it is what the Windows
    // Task Scheduler engine writes into <Settings> after NewTask (checked
    // against an exported XML). New tasks match it exactly, so the switches on
    // screen are the switches the task is really registered with.
    settings: {
      enabled: true,
      allowStartOnDemand: true,
      runOnlyIfIdle: false,
      idleDuration: "PT10M",
      waitTimeout: "PT1H",
      stopOnIdleEnd: true,
      restartOnIdle: false,
      allowHardTerminate: true,
      startWhenAvailable: false,
      runOnlyIfNetworkAvailable: false,
      networkId: "",
      networkName: "",
      disallowStartIfOnBatteries: true,
      stopIfGoingOnBatteries: true,
      wakeToRun: false,
      // The engine writes PT72H; the UI shows days. Same value.
      executionTimeLimit: "P3D",
      multipleInstancesPolicy: "IgnoreNew",
      restartCount: 0,
      // The retry interval is only written when retry count > 0. Retries are off
      // by default, so there is nothing to fill in here.
      restartInterval: "PT0S",
      deleteExpiredTaskAfter: "PT0S",
      hidden: false,
      priority: 7,
      // Task XML version: 1.2 and up; 1.3 adds the unified scheduling engine and
      // remote session control, 1.4 adds maintenance settings and volatile. The
      // version is read back from the task and bumped automatically on save.
      xmlVersion: "1.2",
      useUnifiedSchedulingEngine: false,
      disallowStartOnRemoteAppSession: false,
      volatile: false,
      maintenanceEnabled: false,
      // While automatic maintenance is off the engine omits these two elements; once
      // enabled the user fills them in — no preset value here.
      maintenancePeriod: "PT0S",
      maintenanceDeadline: "PT0S",
      maintenanceExclusive: false,
    },
    // New tasks also start with an empty action list: what it does is the user's call.
    // A blank preset action only suggests the command is already configured (and
    // saving still stops on the empty command).
    actions: [],
    // New tasks start with an empty trigger list: when it runs is the user's call.
    // Presetting "daily at 09:00" reads as already configured and produces a pile
    // of tasks running at the wrong time. This is also the fallback in
    // normalizeConfig — a task with no triggers must stay empty there too; making
    // one up would display "no triggers" as "one daily trigger".
    triggers: [],
  };
}

export function defaultTrigger(type = "daily") {
  return {
    type,
    enabled: true,
    start: defaultStart(),
    end: "",
    randomDelay: "PT0S",
    repetition: { interval: "PT0S", duration: "PT0S", stopAtDurationEnd: false },
    // Trigger-level execution timeout: 0 = omit the element and inherit
    // ExecutionTimeLimit from the task settings.
    executionTimeLimit: "PT0S",
    daysInterval: 1,
    weeksInterval: 1,
    // The three groups below are required on Windows: a weekly trigger without
    // DaysOfWeek, or a monthly one without DaysOfMonth, is rejected outright with
    // "the format is incorrect", so each gets a value. The values match the
    // Windows UI: weekly defaults to Monday, monthly to day 1 with every month
    // selected (the engine default for MonthsOfYear is 4095, all twelve).
    daysOfWeek: [2],
    daysOfMonth: [1],
    months: monthOptions().map((o) => o.value),
    // "The Nth weekday of the month": Windows defaults to "first", and the
    // engine default for WeeksOfMonth is 1 as well.
    monthWeek: 1,
    delay: "PT0S",
    // Required fields for the session-state and event-log triggers; the first
    // option shown in the Windows UI.
    stateChange: "ConsoleConnect",
    userId: "",
    eventLog: "Application",
    eventSource: "",
    eventId: "",
  };
}

/** Fill missing fields from the defaults so the UI never trips on partial
 * backend data. */
export function normalizeConfig(input) {
  const d = defaultConfig();
  if (!input || typeof input !== "object") return d;
  const cfg = structuredClone(d);
  if (input.registration) Object.assign(cfg.registration, input.registration);
  if (input.principal) Object.assign(cfg.principal, input.principal);
  if (input.settings) Object.assign(cfg.settings, input.settings);
  if (Array.isArray(input.actions) && input.actions.length) {
    cfg.actions = input.actions.map((a) => {
      const act = { ...defaultAction(), ...a };
      // The backend sends Command + Arguments, the UI wants one line; if
      // commandLine is missing it is joined back together.
      if (!act.commandLine && (act.command || act.arguments)) {
        act.commandLine = mergeCommand(act.command, act.arguments);
      }
      return act;
    });
  }
  for (const k of [
    "idleDuration",
    "waitTimeout",
    "executionTimeLimit",
    "restartInterval",
    "deleteExpiredTaskAfter",
    "maintenancePeriod",
    "maintenanceDeadline",
  ]) {
    cfg.settings[k] = normDur(cfg.settings[k]);
  }
  if (Array.isArray(input.triggers) && input.triggers.length) {
    cfg.triggers = input.triggers.map((t) => {
      const x = { ...defaultTrigger(), ...t, repetition: { ...defaultTrigger().repetition, ...(t.repetition || {}) } };
      x.randomDelay = normDur(x.randomDelay);
      x.delay = normDur(x.delay);
      x.repetition.interval = normDur(x.repetition.interval);
      x.repetition.duration = normDur(x.repetition.duration);
      x.executionTimeLimit = normDur(x.executionTimeLimit);
      return x;
    });
  }
  return cfg;
}

/**
 * Pre-save validation: walk the sections in UI order, return the first hard
 * problem found, or null when everything is fine.
 *
 * Only shells that "would never run anyway" are blocked — Windows happily
 * registers a task with no trigger, but it will never fire and the user thinks
 * it is configured. A missing action is the same story: the task runs and does
 * nothing.
 *
 * `sections` are the ones this mode actually shows (basic settings shows only
 * identity). Only visible sections are checked: a hidden one cannot be edited
 * from this screen, so blocking on it would push the user to another entry point
 * even though the edit itself is fine. The task name is not checked here — it can
 * be judged without the backend, so it is checked before fetching to skip a
 * pointless round trip.
 */
export function validateForSave(cfg, sections = null) {
  const inScope = (id) => !sections || sections.includes(id);
  if (inScope("triggers") && !(cfg?.triggers || []).length) {
    return { section: "triggers", error: t("save.noTrigger") };
  }
  // COM handlers and unknown action types cannot be edited here, but their
  // presence still counts as a valid action (written back verbatim on save).
  if (inScope("actions")) {
    const usable = (cfg?.actions || []).filter(
      (a) =>
        (a.type === "exec" && String(a.commandLine || "").trim()) ||
        (a.type === "com" && String(a.classId || "").trim()) ||
        a.type === "unknown"
    );
    if (!usable.length) {
      return { section: "actions", error: t("save.noAction") };
    }
  }
  return null;
}

// Actions keep only the two kinds on the manifest: Exec (start a program) and
// ComHandler (COM handler, read-only). SendEmail / ShowMessage are no longer
// configurable, so the UI does not offer them; when present the backend keeps
// them as `unknown`.
function defaultAction() {
  return {
    type: "exec",
    command: "",
    arguments: "",
    workingDirectory: "",
    // The single command line shown in the UI; commandLine wins, otherwise
    // Command + Arguments are joined.
    commandLine: "",
    classId: "",
    data: "",
  };
}

// The option tables below keep values only — the display name comes from the
// language pack. They are functions rather than constant arrays so a language
// switch simply re-evaluates them; no stale copy survives.

export const triggerTypes = () =>
  ["once", "daily", "weekly", "monthly", "monthlyDow", "logon", "boot", "idle",
   "registration", "sessionStateChange", "event"]
    .map((value) => ({ value, label: t(`triggerType.${value}`) }));

/** { bit, label }; the bit values match the Windows DaysOfWeek / Months
 * bit masks. */
export const weekOptions = () =>
  [1, 2, 4, 8, 16, 32, 64].map((value) => ({ value, label: t(`weekday.${value}`) }));

export const monthOptions = () =>
  [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048].map((value) => ({
    value,
    label: t(`month.${value}`),
  }));

export const sessionStateOptions = () =>
  ["ConsoleConnect", "ConsoleDisconnect", "RemoteConnect", "RemoteDisconnect",
   "SessionLock", "SessionUnlock"].map((value) => ({
    value,
    label: t(`sessionState.${value}`),
  }));

export const logonTypes = () =>
  ["InteractiveToken", "S4U", "Password", "ServiceAccount", "Group"].map((value) => ({
    value,
    label: t(`logonType.${value}`),
  }));

export const runLevels = () =>
  ["LeastPrivilege", "HighestAvailable"].map((value) => ({
    value,
    label: t(`runLevel.${value}`),
  }));

export const multipleInstances = () =>
  ["IgnoreNew", "Parallel", "Queue", "StopExisting"].map((value) => ({
    value,
    label: t(`instance.${value}`),
  }));

export const SERVICE_ACCOUNTS = ["SYSTEM", "LOCAL SERVICE", "NETWORK SERVICE"];

export const EVENT_LOGS = ["Application", "System", "Security"];

export function triggerSummary(tr) {
  if (!tr) return "";
  const key = `triggerShort.${tr.type}`;
  return has(key) ? t(key) : tr.type;
}
