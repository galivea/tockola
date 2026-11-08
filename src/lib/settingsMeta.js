/**
 * Short name + tooltip for every property on the edit page.
 *
 * Naming: translate the XML element name when that reads well, otherwise
 * pick a clearer name (DisallowStartIfOnBatteries -> AC only,
 * WakeToRun -> Wake to run).
 *
 * Tooltips: if the short name already explains itself (e.g. "Enabled"), the
 * tooltip is just the element name; if it does not ("Unified engine",
 * "Volatile"), the tooltip carries the full explanation. Units, ranges and
 * what 0 means always go in the tooltip, never in the title.
 *
 * The copy itself does not live here — see meta.* in src/lib/i18n/en.js:
 * English first, Chinese as the fallback. This file only records which keys
 * exist and which ones are uncommon.
 *
 * Entries with advanced = true collapse into the "more settings" area, based
 * on two signals:
 *   1. Items Microsoft exposes on the native Settings / Conditions tabs = common
 *      (Task Settings: https://learn.microsoft.com/previous-versions/cc722178)
 *   2. Measured across 259 real tasks on this machine: Volatile and
 *      NetworkSettings once each, MaintenanceSettings 50 times,
 *      DeleteExpiredTaskAfter 0 times.
 * Anything the native UI hides — XML-only — is collapsed.
 */

import { t } from "./i18n/index.svelte.js";

export const FIELD_META = {
  // ---- Registration ----
  regName: {},
  regPath: {},
  regDescription: {},
  regAuthor: {},
  regSource: {},
  regVersion: {},
  regDocumentation: {},
  regSecurityDescriptor: {},

  // ---- Triggers ----
  trType: {},
  trStart: {},
  trEnd: {},
  trRandomDelay: {},
  trRepeatInterval: {},
  trRepeatDuration: {},
  trStopAtDurationEnd: {},
  trExecutionTimeLimit: {},
  trDelay: {},
  trIntervalType: {},
  trDaysOfMonth: {},
  trMonthWeek: {},
  trDaysOfWeek: {},
  trMonths: {},
  trUserId: {},
  trStateChange: {},
  trEventLog: {},
  trEventSource: {},
  trEventId: {},

  // ---- Actions ----
  actType: {},
  actCommand: {},
  actArguments: {},
  actWorkingDirectory: {},
  actClassId: {},
  actData: {},

  // ---- Conditions (exposed on the native Conditions tab; common) ----
  runOnlyIfIdle: {},
  idleDuration: {},
  waitTimeout: {},
  stopOnIdleEnd: {},
  restartOnIdle: {},
  runOnlyIfNetworkAvailable: {},
  disallowStartIfOnBatteries: {},
  stopIfGoingOnBatteries: {},
  wakeToRun: {},

  // ---- Runtime control (exposed on the native Settings tab; common) ----
  enabled: {},
  allowStartOnDemand: {},
  startWhenAvailable: {},
  executionTimeLimit: { advanced: true },
  allowHardTerminate: {},
  restartCount: {},
  restartInterval: {},
  deleteExpiredTaskAfter: {},
  multipleInstancesPolicy: {},

  // ---- Identity ----
  userId: {},
  logonType: {},
  runLevel: {},
  password: {},

  // ---- Uncommon (collapsed into "more settings") ----
  hidden: { advanced: true },
  priority: { advanced: true },
  useUnifiedSchedulingEngine: { advanced: true },
  disallowStartOnRemoteAppSession: { advanced: true },
  volatile: { advanced: true },
  maintenanceEnabled: { advanced: true },
  maintenancePeriod: { advanced: true },
  maintenanceDeadline: { advanced: true },
  maintenanceExclusive: { advanced: true },
  networkName: { advanced: true },
  networkId: { advanced: true },
};

/** { element, label, tip, advanced } for a property; unlisted keys show as is. */
export function fieldMeta(key) {
  const m = FIELD_META[key];
  if (!m) return { xml: key, label: key, tip: key, advanced: false };
  return {
    xml: t(`meta.${key}.xml`),
    label: t(`meta.${key}.label`),
    tip: t(`meta.${key}.tip`),
    advanced: !!m.advanced,
  };
}

/** Tooltip: self-explanatory properties show just the element name; the
 * others get the detailed explanation. */
export function fieldTip(key) {
  const m = fieldMeta(key);
  return m.tip || m.label;
}

export function fieldLabel(key) {
  return fieldMeta(key).label;
}

export const isAdvanced = (key) => !!FIELD_META[key]?.advanced;
