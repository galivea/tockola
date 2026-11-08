/**
 * English — source of truth.
 * Every key used anywhere in the app must be defined here; other locales follow
 * the same key set. Missing translations fall back to this file.
 *
 * Field wording follows Microsoft's own Task Scheduler UI so that users who
 * know the native dialog recognize the setting.
 */

export default {
  // Error codes. The key suffix is the `code` field of the Rust `AppError`;
  // `{detail}` is filled with the neutral context the backend attached.
  err: {
    unknown: "Something went wrong ({detail})",

    "app.windowsOnly": "This feature is only available on Windows",
    "app.join": "The background worker did not respond to the request",

    "bulk.tooMany": "Too many tasks in one batch ({detail})",
    "bulk.unsupported": "Unsupported batch action: {detail}",

    "com.threadSpawn": "Could not start the Task Scheduler worker thread",
    "com.threadExited": "The Task Scheduler worker thread stopped before it was ready",
    "com.unavailable": "The Task Scheduler worker thread is no longer accepting work",
    "com.jobAborted": "The Task Scheduler worker thread aborted the request",
    "com.init": "Could not initialize COM: {detail}",
    "com.createService": "Could not create the Task Scheduler service object: {detail}",
    "com.connect": "Could not connect to the Task Scheduler service: {detail}",
    "com.openFolder": "Could not open the task folder: {detail}",
    "com.rootExists": "The task folder root already exists",
    "com.folderExists": "The task folder already exists: {detail}",
    "com.parentFolder": "Could not open the parent folder: {detail}",
    "com.createFolder": "Could not create the task folder: {detail}",
    "com.invalidPath": "The task folder path is not valid",
    "com.rootNoDelete": "The task folder root cannot be deleted",
    "com.folderNotFound": "The task folder was not found: {detail}",
    "com.deleteFolder": "Could not delete the task folder: {detail}",
    "com.rootNoRename": "The task folder root cannot be renamed",
    "com.emptyName": "The task folder name cannot be empty",
    "com.illegalName": 'The task folder name cannot contain \\ / : or a double quote',
    "com.moveTask": "Could not move the task: {detail}",
    "com.deleteTask": "Could not delete the task: {detail}",
    "com.taskNotFound": "The task was not found: {detail}",
    "com.runTask": "Could not start the task: {detail}",
    "com.stopTask": "Could not stop the task: {detail}",

    "def.readDefinition": "Could not read the task definition",
    "def.countActions": "Could not count the task actions",
    "def.registrationInfo": "Could not read the registration information",
    "def.author": "Could not write the author",
    "def.description": "Could not write the description",
    "def.uri": "Could not write the task path",
    "def.registrationField": "Could not write the registration information: {detail}",
    "def.securityDescriptor": "Could not write the security descriptor",
    "def.principal": "Could not read the principal",
    "def.groupId": "Could not write the group",
    "def.userId": "Could not write the user",
    "def.logonType": "Could not write the logon type",
    "def.runLevel": "Could not write the run level",
    "def.settings": "Could not read the settings",
    "def.setting": "Could not write a setting: {detail}",
    "def.idleDuration": "Could not write the idle duration",
    "def.idleWait": "Could not write the idle wait timeout",
    "def.idleStop": "Could not write the idle stop flag",
    "def.idleRestart": "Could not write the idle restart flag",
    "def.triggerCollection": "Could not read the triggers",
    "def.clearTriggers": "Could not clear the existing triggers",
    "def.createTrigger": "Could not create the trigger",
    "def.startBoundary": "Could not write the trigger start time",
    "def.endBoundary": "Could not write the trigger end time",
    "def.triggerEnabled": "Could not write the trigger enabled flag",
    "def.repetition": "Could not read the trigger repetition",
    "def.repetitionInterval": "Could not write the repetition interval",
    "def.repetitionDuration": "Could not write the repetition duration",
    "def.repetitionStop": "Could not write the repetition stop flag",
    "def.countTriggers": "Could not count the task triggers",
    "def.actionCollection": "Could not read the actions",
    "def.clearActions": "Could not clear the existing actions",
    "def.createExec": "Could not create the action",
    "def.execCast": "The action is not a start-program action",
    "def.execPath": "Could not write the program path",
    "def.execArguments": "Could not write the arguments",
    "def.execWorkingDir": "Could not write the working directory",
    "def.createComHandler": "Could not create the COM handler action",
    "def.comHandlerCast": "The action is not a COM handler action",
    "def.comClassId": "Could not write the COM class id",
    "def.sectionUnknown": "Unknown configuration section: {detail}",

    "export.noXml": "The task definition is empty, so there is nothing to export",
    "export.write": "Could not write the export file",
    "export.noDir": "The export folder is unusable: {detail}",
    "export.empty": "There is no task to export",
    "export.tooMany": "Too many tasks in one export ({detail})",

    "history.query": "Could not query the task history",
    "history.renderSize": "Could not measure the history event",
    "history.render": "Could not read the history event",
    "history.readState": "Could not read whether the task history is enabled",
    "history.openChannel": "Could not open the task history channel",
    "history.enableDenied": "Enabling the task history needs administrator rights",

    "import.empty": "The file does not contain a task definition",
    "import.register": "Could not register the imported task",

    "probe.askEngine": "Could not ask the engine for the next run times",
    "probe.comInit": "Could not initialize COM for the schedule probe",
    "probe.createService": "Could not create the probe service object",
    "probe.connect": "Could not connect to the Task Scheduler service for the probe",
    "probe.openRoot": "Could not open the root folder for the probe",
    "probe.createFolder": "Could not create the temporary probe folder",
    "probe.register": "Could not register the temporary probe task",

    "task.emptyName": "The task name cannot be empty",
    "task.notFound": "The task was not found: {detail}",
    "task.newDefinition": "Could not create a task definition",
    "task.loadDefinition": "Could not load the task definition XML",
    "task.probeFolder": "Could not open the temporary probe folder",
    "task.probeDefinition": "Could not create the probe definition",
    "task.probeRegister": "Could not register the temporary probe task",
    "task.register": "Could not register the task",
    "task.registerWithCredentials": "Could not register the task with the given credentials",
    "task.createFolder": "Could not create the task folder: {detail}",
  },

  meta: {
    // ---- Registration ----
    regName: { xml: "RegistrationInfo/URI", label: "Name", tip: "Task name" },
    regPath: {
      xml: "Task path",
      label: "Folder",
      tip: "The folder this task belongs to; a single backslash means the root",
    },
    regDescription: {
      xml: "RegistrationInfo/Description",
      label: "Description",
      tip: "What this task does. Shown as a tooltip in the task list",
    },
    regAuthor: {
      xml: "RegistrationInfo/Author",
      label: "Author",
      tip: "Creator. Leave empty to use the current user",
    },
    regSource: {
      xml: "RegistrationInfo/Source",
      label: "Source",
      tip: "Product that created this task. Leave empty to omit it",
    },
    regVersion: {
      xml: "RegistrationInfo/Version",
      label: "Version",
      tip: "Custom version string, for example 1.0.0",
    },
    regDocumentation: {
      xml: "RegistrationInfo/Documentation",
      label: "Documentation",
      tip: "Link to a document describing this task. Leave empty to omit it",
    },
    regSecurityDescriptor: {
      xml: "RegistrationInfo/SecurityDescriptor",
      label: "Security descriptor",
      tip: "SDDL string. System tasks usually carry one and it is written back verbatim. An invalid SDDL can lock you out of editing this task",
    },

    // ---- Triggers ----
    trType: { xml: "Trigger", label: "Trigger", tip: "What starts this task" },
    trStart: {
      xml: "StartBoundary",
      label: "Start",
      tip: "The trigger takes effect from this moment. Empty means immediately",
    },
    trEnd: {
      xml: "EndBoundary",
      label: "Expire",
      tip: "The trigger stops firing after this moment. Empty means never expires",
    },
    trRandomDelay: {
      xml: "RandomDelay",
      label: "Random delay",
      tip: "Postpone the scheduled time by a random amount up to this value. Useful to spread out similar tasks. Minimum 1 second, maximum 31 days; 0 disables it",
    },
    trRepeatInterval: {
      xml: "Repetition/Interval",
      label: "Repeat every",
      tip: "Run again this often after firing. Minimum 1 minute, maximum 31 days (Windows rejects sub-second intervals). 0 disables repetition",
    },
    trRepeatDuration: {
      xml: "Repetition/Duration",
      label: "For a duration of",
      tip: "How long the repetition lasts. Minimum 1 minute and not shorter than the repeat interval, otherwise Windows refuses to save. 0 repeats forever",
    },
    trStopAtDurationEnd: {
      xml: "Repetition/StopAtDurationEnd",
      label: "Stop when duration ends",
      tip: "Kill the running instance as soon as the duration expires. Unchecked lets it finish on its own",
    },
    trExecutionTimeLimit: {
      xml: "ExecutionTimeLimit",
      label: "Execution time limit",
      tip: "How long an instance started by this trigger may run before it is stopped. 0 means no limit (inherits the setting from Settings and Conditions)",
    },
    trDelay: {
      xml: "Delay",
      label: "Delay",
      tip: "Wait this long after the condition is met before running. Minimum 1 second; 0 runs immediately",
    },
    trIntervalType: {
      xml: "ScheduleByDay/DaysInterval, ScheduleByWeek/WeeksInterval",
      label: "Every",
      tip: "Recur every N days (daily trigger) or every N weeks (weekly trigger)",
    },
    trDaysOfMonth: {
      xml: "ScheduleByMonth/DaysOfMonth",
      label: "Days",
      tip: "Which days of the month, comma separated, for example 1,15",
    },
    trMonthWeek: {
      xml: "ScheduleByMonthDayOfWeek/Weeks",
      label: "Week",
      tip: "Which week of the month. Choosing every week fires on every matching weekday",
    },
    trDaysOfWeek: { xml: "DaysOfWeek", label: "Days of week", tip: "Which weekdays fire" },
    trMonths: {
      xml: "Months",
      label: "Months",
      tip: "Which months fire. Selecting none means every month",
    },
    trUserId: {
      xml: "UserId",
      label: "User",
      tip: "Only fire for this user's session changes. Empty means any user",
    },
    trStateChange: {
      xml: "StateChange",
      label: "State change",
      tip: "Which session change triggers the task",
    },
    trEventLog: { xml: "Subscription", label: "Log", tip: "Which event log to watch" },
    trEventSource: {
      xml: "Subscription",
      label: "Source",
      tip: "Event source name. Empty means any source",
    },
    trEventId: {
      xml: "Subscription",
      label: "Event ID",
      tip: "Event ID to match. Empty means any",
    },

    // ---- Actions ----
    actType: { xml: "Actions", label: "Action", tip: "What this action does" },
    actCommand: {
      xml: "Exec/Command + Exec/Arguments",
      label: "Program/script",
      tip: "Write the full command line (program plus arguments) as you would in cmd. It is split into program and arguments on save; use the gear on the right to preview the split",
    },
    actArguments: {
      xml: "Exec/Arguments",
      label: "Arguments",
      tip: "Arguments passed to the program, derived automatically from the command line",
    },
    actWorkingDirectory: {
      xml: "Exec/WorkingDirectory",
      label: "Start in",
      tip: "Working directory at runtime. Empty uses the system default",
    },
    actClassId: {
      xml: "ComHandler/ClassId",
      label: "ClassId",
      tip: "COM class identifier. Read-only in this tool",
    },
    actData: {
      xml: "ComHandler/Data",
      label: "Data",
      tip: "Data passed to the COM handler. Read-only in this tool",
    },

    // ---- Conditions ----
    runOnlyIfIdle: {
      xml: "RunOnlyIfIdle",
      label: "Only if idle",
      tip: "Run only while the computer is idle",
    },
    idleDuration: {
      xml: "IdleSettings/Duration",
      label: "Idle for",
      tip: "How long the computer must stay idle to count as idle. Minimum 1 second; 0 uses the system default",
    },
    waitTimeout: {
      xml: "IdleSettings/WaitTimeout",
      label: "Wait for idle",
      tip: "Give up this run if the computer does not become idle within this time. Minimum 1 second; 0 waits forever",
    },
    stopOnIdleEnd: {
      xml: "IdleSettings/StopOnIdleEnd",
      label: "Stop when idle ends",
      tip: "Stop the task once the computer is no longer idle",
    },
    restartOnIdle: {
      xml: "IdleSettings/RestartOnIdle",
      label: "Restart when idle again",
      tip: "Start over from the beginning when the computer becomes idle again",
    },
    runOnlyIfNetworkAvailable: {
      xml: "RunOnlyIfNetworkAvailable",
      label: "Only if network available",
      tip: "Start only when a network connection is available",
    },
    disallowStartIfOnBatteries: {
      xml: "DisallowStartIfOnBatteries",
      label: "Only on AC power",
      tip: "Do not start while the computer runs on battery",
    },
    stopIfGoingOnBatteries: {
      xml: "StopIfGoingOnBatteries",
      label: "Stop on battery",
      tip: "Stop the task if the computer switches to battery while it runs",
    },
    wakeToRun: {
      xml: "WakeToRun",
      label: "Wake to run",
      tip: "Wake the computer from sleep when the trigger fires",
    },

    // ---- Settings ----
    enabled: { xml: "Enabled", label: "Enabled", tip: "Enabled" },
    allowStartOnDemand: {
      xml: "AllowStartOnDemand",
      label: "Run on demand",
      tip: "Allow starting this task manually, outside its schedule",
    },
    startWhenAvailable: {
      xml: "StartWhenAvailable",
      label: "Run missed start",
      tip: "Run as soon as possible after a scheduled start was missed, for example because the machine was off",
    },
    executionTimeLimit: {
      xml: "ExecutionTimeLimit",
      label: "Execution time limit",
      tip: "Stop the task if it runs longer than this. Accepts values like 1 hour or 3 days; 0 means no limit",
    },
    allowHardTerminate: {
      xml: "AllowHardTerminate",
      label: "Force stop",
      tip: "Kill the process outright if it does not respond to a stop request",
    },
    restartCount: {
      xml: "RestartOnFailure",
      label: "Restart on failure",
      tip: "Retry up to this many times when the previous result was not success. 0 never retries",
    },
    restartInterval: {
      xml: "RestartOnFailure",
      label: "Restart interval",
      tip: "Wait this long between retries. Minimum 1 minute, maximum 31 days",
    },
    deleteExpiredTaskAfter: {
      xml: "DeleteExpiredTaskAfter",
      label: "Delete when expired",
      tip: "Delete the task this long after it has no scheduled run left. Accepts values like 30 days or 1 hour; 0 never deletes",
    },
    multipleInstancesPolicy: {
      xml: "MultipleInstancesPolicy",
      label: "If already running",
      tip: "What to do when a new trigger fires while the previous instance still runs",
    },

    // ---- Principal ----
    userId: {
      xml: "Principal/UserId",
      label: "Account",
      tip: "Which account runs the task. Empty means the current user",
    },
    logonType: {
      xml: "Principal/LogonType",
      label: "Logon type",
      tip: "Decides whether a user must be logged on and whether the password is stored",
    },
    runLevel: {
      xml: "Principal/RunLevel",
      label: "Privilege",
      tip: "Normal, or elevated to highest privileges (administrator)",
    },
    password: {
      xml: "Supplied at registration",
      label: "Password",
      tip: "Only needed for logon types that require one. Never stored",
    },

    // ---- Advanced ----
    hidden: {
      xml: "Hidden",
      label: "Hidden",
      tip: "Sets the Hidden flag in the task definition; the native Task Scheduler hides such tasks by default. This app's list is unaffected — visibility there is decided by each folder's display settings",
    },
    priority: {
      xml: "Priority",
      label: "Priority",
      tip: "0-9, higher wins (default 7). This is scheduling priority, not process priority",
    },
    useUnifiedSchedulingEngine: {
      xml: "UseUnifiedSchedulingEngine",
      label: "Unified engine",
      tip: "Hand scheduling to the unified engine. It does not support some features (a specific network, force stop, stopping an existing instance), and registration is rejected when they are combined",
    },
    disallowStartOnRemoteAppSession: {
      xml: "DisallowStartOnRemoteAppSession",
      label: "Block RemoteApp session",
      tip: "Do not start when triggered inside a RemoteApp (RAIL) session",
    },
    volatile: {
      xml: "Volatile",
      label: "Volatile",
      tip: "Automatically disabled at every boot; must be re-enabled explicitly. Failover clusters use it to keep only one node active at a time",
    },
    maintenanceEnabled: {
      xml: "MaintenanceSettings",
      label: "Only in maintenance window",
      tip: "Run only inside the Windows automatic maintenance window",
    },
    maintenancePeriod: {
      xml: "MaintenanceSettings/Period",
      label: "Period",
      tip: "How often the task must run at least. Days only, minimum 1 day (Windows rejects anything shorter)",
    },
    maintenanceDeadline: {
      xml: "MaintenanceSettings/Deadline",
      label: "Deadline",
      tip: "How long after the period a missed run may still be made up. Days only, minimum 1 day, and at least one day longer than the period",
    },
    maintenanceExclusive: {
      xml: "MaintenanceSettings/Exclusive",
      label: "Exclusive",
      tip: "No other maintenance task may run during this window",
    },
    networkName: {
      xml: "NetworkSettings/Name",
      label: "Network name",
      tip: "Run only while connected to this network. Takes effect together with Only if network available",
    },
    networkId: {
      xml: "NetworkSettings/Id",
      label: "Network GUID",
      tip: "GUID of the network, more precise than the name. Takes effect together with Only if network available",
    },
  },

  // Last run result. The value is the unsigned form of an HRESULT; the wording follows Microsoft's.
  result: {
    0: { text: "Success", tip: "The operation completed successfully" },
    1: { text: "Failed", tip: "0x1 Incorrect function (generic failure)" },
    2: { text: "File not found", tip: "0x2 The system cannot find the file specified" },
    5: { text: "Access denied", tip: "0x5 Access is denied" },
    267008: { text: "Terminated", tip: "0x41300 The task was terminated" },
    267009: { text: "Running", tip: "0x41301 The task is running" },
    267010: { text: "Disabled", tip: "0x41302 The task is disabled and will not run" },
    267011: { text: "Never run", tip: "0x41303 The task has not run yet" },
    267012: { text: "No more runs", tip: "0x41304 The task has no more scheduled runs" },
    267014: { text: "Missed start", tip: "0x41306 The scheduled start time was missed" },
    2147942405: { text: "Access denied", tip: "0x80070005 Access is denied" },
    2147942402: { text: "File not found", tip: "0x80070002 The system cannot find the file specified" },
    2147942403: { text: "Path not found", tip: "0x80070003 The system cannot find the path specified" },
    2147942487: { text: "Already exists", tip: "0x800700B7 Cannot create a file when that file already exists" },
    2147750687: { text: "Timed out", tip: "0x8004131F The task was stopped because it exceeded its execution time limit" },
    unknown: { tip: "{value} (0x{hex}) — unrecognized return code, shown as-is" },
  },

  // Fallback wording for history events. Windows normally renders the Task display name itself; this is only used when that is unavailable.
  event: {
    100: "Task started",
    101: "Task start failed",
    102: "Task completed",
    103: "Action start failed",
    106: "Task registered",
    107: "Task triggered by scheduler",
    108: "Task triggered by event",
    110: "Task triggered by user",
    111: "Task terminated",
    112: "Start condition not met: network unavailable",
    114: "Lost task started",
    118: "Task triggered at startup",
    119: "Task triggered at logon",
    129: "Task process created",
    140: "Task registration updated",
    141: "Task registration deleted",
    142: "Task disabled",
    153: "Missed task start rejected",
    200: "Action started",
    201: "Action completed",
    202: "Action failed",
    203: "Action failed to start",
    322: "Start ignored, instance already running",
    324: "Start queued, instance already running",
    325: "Start request queued",
    330: "Task stopping on user request",
    400: "Service started",
    402: "Service shutting down",
    700: "Compatibility module started",
    unknown: "Event",
    fallback: "Event #{id}",
  },

  level: {
    critical: "Critical",
    error: "Error",
    warning: "Warning",
    info: "Information",
  },

  state: {
    Running: "Running",
    Ready: "Ready",
    Disabled: "Disabled",
    Queued: "Queued",
    unknown: "Unknown",
  },

  // Duration units. The abbreviations feed humanize; the leading space inside each value plus sep makes English read as "1 d, 30 min".
  unit: { sep: ", ", y: " y", mo: " mo", d: " d", h: " h", mi: " min", s: " s" },
  unitFull: { s: "seconds", mi: "minutes", h: "hours", d: "days" },

  duration: {
    from: "{value} and up",
  },

  group: {
    root: "Task Scheduler Library",
    library: "Task Scheduler Library",
  },

  relative: {
    expired: "Overdue",
    underMinute: "In less than 1 minute",
    minutes: "{count} min",
    hours: "{h} hr{m}",
    days: "{d} days{h}",
    months: "{count} months",
  },

  // Trigger types: triggerType is the full name in the dropdown, triggerShort the short name in list summaries.
  triggerType: {
    once: "One time",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly (by date)",
    monthlyDow: "Monthly (by weekday)",
    logon: "At log on",
    boot: "At startup",
    idle: "When the computer is idle",
    registration: "When the task is created or modified",
    sessionStateChange: "On session state change",
    event: "On an event",
  },
  triggerShort: {
    once: "One time",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly (date)",
    monthlyDow: "Monthly (weekday)",
    logon: "At log on",
    boot: "At startup",
    idle: "On idle",
    registration: "On registration",
    sessionStateChange: "Session change",
    event: "On event",
  },

  // Keys are bit values: 1=Sunday 2=Monday … 64=Saturday
  weekday: { 1: "Sun", 2: "Mon", 4: "Tue", 8: "Wed", 16: "Thu", 32: "Fri", 64: "Sat" },
  // Same here: keys are bit values
  month: {
    1: "Jan", 2: "Feb", 4: "Mar", 8: "Apr", 16: "May", 32: "Jun",
    64: "Jul", 128: "Aug", 256: "Sep", 512: "Oct", 1024: "Nov", 2048: "Dec",
  },

  sessionState: {
    ConsoleConnect: "Console connect",
    ConsoleDisconnect: "Console disconnect",
    RemoteConnect: "Remote connect",
    RemoteDisconnect: "Remote disconnect",
    SessionLock: "Workstation lock",
    SessionUnlock: "Workstation unlock",
  },

  logonType: {
    InteractiveToken: "Run only when user is logged on (default)",
    S4U: "Run whether user is logged on or not (no password)",
    Password: "Run whether user is logged on or not (password required)",
    ServiceAccount: "Use a system account (SYSTEM and similar)",
    Group: "Run as a group member (group principal)",
  },

  runLevel: {
    LeastPrivilege: "Standard",
    HighestAvailable: "Highest privileges (elevated)",
  },

  instance: {
    IgnoreNew: "Do not start a new instance",
    Parallel: "Run a new instance in parallel",
    Queue: "Queue a new instance",
    StopExisting: "Stop the existing instance",
  },

  save: {
    noTrigger: "At least one trigger is required — without one the task never runs on its own, only manually",
    noAction: "At least one Start a program action with a command is required",
  },

  lang: {
    switch: "Interface language",
  },

  // Menu bar, sitting next to the window title
  menu: {
    help: "Help",
    about: "About",
    settings: "Settings",
    language: "Language",
    aboutApp: "About Tockola",
    close: "Close",
  },

  // The Settings dialog (Help -> Settings)
  settings: {
    title: "Settings",
    general: "General",
    language: "Language",
    closeBehavior: "When closing the window",
    closeQuit: "Quit the app",
    closeQuitHint: "Close the window to exit Tockola.",
    closeTray: "Minimize to system tray",
    closeTrayHint: "Keep running in the background; click the tray icon to restore.",
    done: "Done",
  },

  // The three buttons the window draws itself
  winctl: {
    minimize: "Minimize",
    maximize: "Maximize",
    restore: "Restore down",
    close: "Close",
  },

  // The About box
  about: {
    tagline: "A thin shell over Windows Task Scheduler, keeping an eye on the tasks you wrote yourself.",
    versionLine: "Version {version}",
    originTitle: "Where the name comes from",
    origin:
      "tock, the second beat of a clock, plus a made-up -ola ending: a small steady metronome for the schedules you wrote yourself.",
    license: "MIT licensed",
    homepage: "Project home",
  },

  // Add triggers in bulk (the cron builder)
  cronBuilder: {
    title: "Add triggers from cron",
    close: "Close",
    closeTip: "Close",
    cancel: "Cancel",
    exprLabel: "Cron expression",
    exprPlaceholder: "e.g. 0 9 * * 1-5 (9am on weekdays), or @daily",
    startDate: "Start date",
    orLabel: "OR",
    nthDow: "weekday#nth",
    likePrefix: "(e.g. ",
    hint1: "Changing any cell recalculates the result; the expression supports",
    yearNote:
      'Windows triggers have no notion of a "year": the year only sets the start date, it cannot filter by year.',
    from: "From",
    to: "to",
    every: "every",
    apply: "Apply",
    selectAll: "Select all",
    invert: "Invert",
    clear: "Clear",
    batchHint: "Select a range or a step",
    pickSelected: "Selected {will} / {total}",
    missing: "Not set yet: {list} — tick the boxes on the right, or type the expression",
    // Same situation as `missing`, shown inline under the expression box with the
    // full set of ways to fill a field in.
    missingHint:
      "Not set yet: {list} — tick the boxes on the right, or pick a whole range with \"From … to … every …\" above (the range-wide buttons are at the far right), or just type the expression.",
    andWarnPre: "⚠ Day of month and day of week are both set: cron combines them with ",
    andWarnMid:
      ", not AND — {dom} and {dow} each fire, so an overlapping day runs twice. For \"the Nth weekday of the month\" write it as ",
    andWarnTail: " and leave the day of month empty.",
    willAddPre: "Will add ",
    willAddPost: " triggers · grouping: {plan} (compared {count} splits)",
    andMore: "…{n} more, all added together",
    batchAdd: "Add all",
    noTriggers: "No trigger to add",
    tooMany:
      "At most {max} triggers can be added at once; this one needs {count}, so simplify the expression",
    dayCell: "{v}",
  },

  // The cron builder. err.* are the messages shown when a conversion fails; each
  // carries the concrete value, because knowing which field is wrong and why is
  // far more useful than a flat "invalid expression".
  cron: {
    field: {
      sec: "second", mi: "minute", h: "hour",
      dom: "day of month", mon: "month", dow: "day of week", year: "year",
    },
    // The index is the cron number: 0=Sunday
    dow: { 0: "Sun", 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" },
    // The index is the month number: 1=January
    month: {
      1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
      7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
    },
    nth: { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", last: "last" },
    // Separator when weekday / month names are listed side by side: an ideographic comma in Chinese, a plain comma in English
    listSep: ", ",

    // Summary of the field's current shape
    shape: {
      none: "not set",
      selected: "{count} selected",
      empty: "empty",
      single: "single moment",
      arithmetic: "evenly spaced",
      minuteOffset: "minute offsets",
      longChain: "long chain",
      hourlyBlocks: "hourly blocks",
    },
    everyN: "every {every} {field}",

    err: {
      dowLast: 'Cannot convert "{p}" in the day-of-week field (last weekday of month): Windows\' "Nth weekday" only takes the 1st through 5th — there is no "last"',
      domLast: 'Cannot convert "{p}" in the day-of-month field (last day, or Nth from last): a Windows monthly schedule lists explicit days and fires once per listed day; there is no "last day"',
      fieldEmpty: "The {field} field is empty",
      stepNotInt: 'The step "{step}" in the {field} field is not a positive integer',
      stepOutOfRange: "The step range in the {field} field is outside {min}-{max}",
      stepReversed: "The step range {from}-{to} in the {field} field is reversed",
      domNearestWeekday: 'Cannot convert "{p}" in the day-of-month field (nearest weekday): Windows never shifts a weekend to a weekday — write the day you mean',
      jenkinsHash: '"{p}" in the {field} field is a Jenkins-only hash, not standard cron, and cannot be converted',
      hashOnlyDow: '"#" is valid only in the day-of-week field (for example 6#3 = 3rd Friday); the {field} field does not support it',
      dowHashMalformed: 'Malformed "{p}" in the day-of-week field: expected "weekday#nth" such as 6#3 or FRI#3, with nth from 1 to 5',
      dowNameUnknown: 'Unknown weekday name in "{p}" in the day-of-week field; use SUN-SAT or 0-6',
      dowOutOfRange: '"{p}" in the day-of-week field is outside 0-6',
      dowNthOutOfRange: '"{p}" in the day-of-week field asks for the {week}th, which is out of range: Windows accepts only the 1st through 5th',
      notANumber: '"{p}" in the {field} field is neither a number nor a notation this field understands',
      outOfRange: '"{p}" in the {field} field is outside {min}-{max}',
      rangeReversed: 'The range in "{p}" in the {field} field is reversed ({a} > {b})',
      noValidValue: "The {field} field has no valid value",
      dowMixed: 'An "Nth weekday" value such as 6#3 cannot be mixed with plain weekday values in the day-of-week field — split them into two expressions',
      timezone: 'Timezone prefix "{tz}" is not supported: Windows triggers always run in the machine\'s own timezone, so convert the time first',
      atReboot: '"@reboot" means run at startup, which cron cannot express — add a separate "At startup" trigger in the trigger list instead',
      unknownMacro: 'Unknown macro "{text}"; only @yearly / @monthly / @weekly / @daily / @midnight / @hourly are supported',
      tooFewFields: "A cron expression needs 5 to 7 fields (second? minute hour day-of-month month day-of-week year?), but {count} were given",
      looksLikeCommand: 'A cron expression takes only the time part; the last field "{last}" looks like a command or script — remove it',
      tooManyFields: 'A cron expression takes only the time part (5 to 7 fields), but {count} were given — drop the extra "{extra}"',
      missingFields: 'Some fields are not set: {missing}. Complete the expression, or tick the boxes on the right and use Select all',
      noMoment: "No moment is selected",
      tooManyMoments: "There are {count} moment combinations, more than one conversion can handle — narrow the values in the second / minute / hour fields",
      yearIgnored: "Windows triggers cannot filter by year, so the year is ignored; the earliest year {year} is used as the start date",
      gapTooSmall: 'Windows\' shortest repetition interval is 1 minute, so moments as dense as "every {gap} seconds" cannot merge into one repetition — each moment needs its own trigger. That would be {total}, more than the 100 allowed at once. Spread the second / minute values at least 1 minute apart',
      tooManyTriggers: "The conversion needs {total} triggers ({patterns} day patterns x {groups} moment groups), more than the 100 allowed at once — simplify the expression",
      partialRepetition: "Some moments are expressed as a repetition interval: Windows fires from the start time at that interval, and the repeat count is written into each trigger's description",
      gapSmallSplit: "Neighbouring moments are only {gap} seconds apart. Windows' shortest repetition interval is 1 minute, so these cannot merge into one repetition and have to be split into {groups} triggers",
      willCreateMany: "This will create {count} triggers, which is a lot — consider simplifying the cron expression",
    },

    // Explanations and warnings for the conversion result
    note: {
      fifthBecomesLast: 'cron\'s "5th weekday" becomes "last" in Windows: in months with only four such weekdays cron never fires, while Windows fires on the fourth',
      domAndDowSplit: 'Both day-of-month and "Nth weekday" are set, which cron reads as OR; Windows has to split them into two trigger groups, so days matching both fire twice',
      monthAndDowSplit: "Months and weekdays are both restricted: a Windows weekly trigger carries no month, so this splits into the 1st through 4th plus the last weekday of each month — 5 triggers in total",
      fourthAndLastOverlap: 'The "4th" and "last" coincide in months with only four such weekdays, so that day runs twice',
      domAndDowDetail: 'Both day-of-month and day-of-week are set: in cron these two are OR, not AND, so {dom} and {dow} each fire on their own, and overlapping days run twice. Windows cannot put both in one trigger, hence the two groups above',
      looksLikeNth: 'This looks like it means "the {nth} {names} of the month". That needs AND, which standard cron cannot do — writing {lo}-{hi} turns it into an OR and fires far more often. Windows can: set day-of-week to "{dow}#{nthNum}" and leave day-of-month empty',
    },

    // Plain-English description of a trigger
    desc: {
      day: "day {d}",
      weeklyOn: "weekly on {d}",
      everyNDays: "every {n} days",
      daily: "daily",
      monthlyOn: "monthly on {days}{months}",
      monthlyNth: "monthly on the {nth} {dow}{months}",
      nthDow: "the {nth} {dow}",
      repeatTail: ", then every {interval} for {count} times",
    },
  },

  // Editor dialog (new task / full edit / basic settings all share one template)
  editor: {
    sectionIdentity: "General",
    sectionTriggers: "Triggers",
    sectionActions: "Actions",
    sectionSettings: "Settings and conditions",
    sectionPrincipal: "Security options",
    navAria: "Configuration sections",

    titleEdit: "Edit task",
    titleNew: "New task",
    loadFailed: "Failed to load",
    probeFailed: "Could not read the next run times",
    notLoaded: "The configuration has not finished loading, please retry (",
    loadingIdentity: "Loading registration info…",
    loadingTriggers: "Loading triggers…",
    loadingActions: "Loading actions…",
    loadingSettings: "Loading settings…",
    loadingPrincipal: "Loading security options…",
    loading: "Loading",
    partialLoading: "Some sections are still loading…",
    retry: "Retry",
    cancel: "Cancel",
    keepAsIs: "Keep as is",

    more: "More",
    moreFields: "Author · Source · Version · Documentation · Security descriptor",
    moreFilled: "{n} filled",
    moreEmpty: "not set",

    // A task can carry top-level XML nodes this tool does not model. They are
    // preserved on save, so the editor only has to say so.
    unsupportedPre: "This task has {n} node(s) this tool does not recognise; on save they are written back ",
    unsupportedPost: " unchanged — nothing is lost:",

    namePlaceholder: "e.g. daily data backup",
    descPlaceholder: "What this task does",
    authorPlaceholder: "Leave empty to use the current user",
    sourcePlaceholder: "The product that created this task",
    docPlaceholder: "Link to documentation",
    sdPlaceholder: "Leave empty to use the system default permissions",

    addTrigger: "Add trigger",
    addTriggersFromCron: "Add from cron",
    everyNDays: "Every {n} days",
    everyNWeeks: "Every {n} weeks · {dow}",
    monthlyDays: "Day {days} · {months}",
    once: "One time",
    monthly: "Monthly",
    unset: "not set",
    everyWeek: "Every week",
    week1: "1st week",
    week2: "2nd week",
    week3: "3rd week",
    week4: "4th week",
    weekLast: "Last week",
    nth1: "1st",
    nth2: "2nd",
    nth3: "3rd",
    nth4: "4th",
    nthLast: "Last",
    noFifthWeek: 'Windows has no "5th week"; this option is the last week',
    dayUnit: "days",
    weekUnit: "weeks",
    eventId: "Event #{id}",
    anyEvent: "Any event",
    sessionChange: "Session change",
    weekPrefix: "{dow}",

    dragReorder: "Drag to reorder",
    period: "Schedule",
    pickPeriod: "Choose a schedule",
    cellHint: "Click this cell to expand and pick weekdays / days / months",
    cellHintShort: "Click to expand and pick weekdays / days / months",
    startDate: "Start date",
    endDate: "End date",
    nextRunsPre: "Next",
    nextRunsPost: "run times",
    nextRunsTip: "How many run times to list",
    computing: "Computing…",
    noEnabledTrigger: "No trigger is enabled, so there is no run time to list.",
    noRunIn10y: "No run time in the next 10 years.",
    demoUnavailablePre: "Browser preview mode cannot reach the Task Scheduler service — run the desktop app to see run times (",
    demoUnavailablePost: ").",
    relPrefix: "in {t}",
    onlyNIn10y: "Only {n} run time(s) in the next 10 years; there is nothing after that.",
    randomDelayNote:
      "A trigger sets a random delay, so the real start time is pushed back by a random amount from each moment above.",
    untimedNote:
      "Trigger {list} is event-based (logon / startup / idle / registration / session change / event log): it has no fixed moment, so the engine cannot list run times for it.",
    groupPrincipalNote:
      'A group principal writes only <GroupId> into the XML, with no logon type — Windows has no "group" value in its logon-type enumeration.',

    addAction: "Add action",
    actType: "Type",
    actCommand: "Program/script",
    actWorkDir: "Start in",
    actExec: "Start a program",
    actCom: "COM handler",
    actUnknown: "Unsupported action",
    actComHandler: "COM handler: {id}",
    actReadonly: "Read-only here; written back unchanged on save",
    actUnsupported: "This action type is outside what this tool supports",
    actKeep: "Written back unchanged on save; nothing is lost",

    conditions: "Conditions",
    controls: "Settings",
    moreSettings: "More settings",

    principalHint: "Decides which account the task runs as",
    currentUser: "Current user",
    currentUserShort: "empty = current user",
    group: "Group",
    groupHint:
      "The task runs as a member of this group. Enter a group name (BUILTIN\\Users) or a SID (S-1-5-32-545)",
    groupPlaceholder: "e.g. BUILTIN\\Users or S-1-5-32-545",
    passwordHint: "The password is used for this registration only and is never stored.",
    passwordOnce: "For this registration only",

    noRepeat: "no repetition",
    repeatForever: "repeat forever",
    noLimit: "no limit",
    noDelay: "no delay",
    immediate: "immediately",
    anySource: "Any source",
    anyUser: "Any user",
    useSystemDefault: "Leave empty to use the system default",
    systemDefault: "System default",
    noWait: "do not wait",
    noDelete: "never delete",
    noTimeLimit: "no limit",
    notScheduled: "Not scheduled",
    never: "Never",

    metaState: "State: ",
    metaNextRun: "Next run: ",
    metaLastRun: "Last run: ",
    metaLastResult: "Last result: ",

    nameEmpty: "The task name cannot be empty",
    saveFailed: "Failed to save",
    xmlTitle: "Task XML",
    exported: "Exported",
    exportFailed: "Failed to export the task",
    deleteRow: "Delete",

    save: "Save",
    saving: "Saving…",
    exportBtn: "Export as XML",
    exporting: "Exporting…",
    exportTip: "Export the task to an XML file",
    exportTipDemo: "Export is not available in browser demo mode",

    // Field names inside the "More" collapsible
    metaAuthor: "Author",
    metaSource: "Source",
    metaVersion: "Version",
    metaDoc: "Documentation",
    metaSd: "Security descriptor",

    // Nth weekday of the month: nth0 means "every week on this day"
    nth0: "Every",
    nthDowDesc: "{nth} {dow} · {months}",
  },

  // Buttons shared by every dialog
  common: {
    cancel: "Cancel",
    confirm: "OK",
    close: "Close",
    selectAll: "Select all",
    clear: "Clear",
    name: "Name",
  },

  // Shared input controls
  field: {
    cmdPlaceholder: "For example: C:\\Scripts\\backup.bat --all",
    cmdProgram: "Program",
    cmdArgs: "Arguments",
    cmdEmpty: "(not set)",
    cmdNone: "(none)",
    hour: "Hours",
    minute: "Minutes",
    second: "Seconds",
    stepUp: "{name} + 1",
    stepDown: "{name} - 1",
    toggleOn: "{label} (on)",
    toggleOff: "{label} (off)",
    pickDate: "Pick a date",
    hmsTip: "Hour : Minute : Second",
    pickDateUnset: "Not set — click to pick a date",
  },

  // Import task dialog
  import: {
    title: "Import task",
    pickFile: "Choose task XML files…",
    removeFile: "Remove from the list",
    skipped: "Ignored: {names} (not task XML)",
    importFailed: "Failed to import the task",
    passwordPlaceholder: "This task runs with a stored password — enter it",
    busy: "Importing…",
    action: "Import",
    actionMany: "Import {n}",
  },

  // New / rename / delete folder dialogs
  folder: {
    titleCreate: "New subfolder",
    titleRename: "Rename folder",
    titleDelete: "Delete folder",
    nameLabel: "Folder name",
    placeholder: "For example: My tasks",
    createHint: "Will be created under ",
    hintTailCreate: ".",
    renameHint: "Will become the new name under ",
    hintTailRename: ".",
    emptyErr: "The folder name cannot be empty",
    illegalErr: 'The name cannot contain \\ / : " characters',
    deleteAskPre: "Delete folder ",
    deleteAskPost: "?",
    deleteWarn:
      "This folder, all of its subfolders and every task under it will be deleted. This cannot be undone.",
    busy: "Working…",
    delete: "Delete",
  },

  // Folder visibility dialog
  visible: {
    title: "Folder display settings",
    hint: "Select the folders to show on the left. Unselected folders hide their whole branch, and selecting a parent folder shows all of its subfolders.",
    allGroups: "All folders",
    errNone: "Keep at least one folder — selecting none would empty the tree.",
    tipAll: "All folders are currently shown.",
  },

  // Run history drawer
  history: {
    title: "Run history",
    close: "Close",
    range: "Range",
    days: "Last {n} days",
    onlyFail: "Failures only",
    refresh: "Refresh",
    loading: "Loading…",
    loadFailed: "Failed to read the run history",
    enableFailed: "Failed to enable task history. Run this program as administrator.",
    disabledTitle: "Task history is not enabled",
    disabledSubPre: "Windows does not record task history by default. Recording starts once you enable it, and it does ",
    disabledSubEm: "not",
    disabledSubPost: " backfill runs that happened earlier.",
    enableBtn: "Enable task history",
    enabling: "Enabling…",
    demoWarn: "Enabling is not possible in browser demo mode; this button only exercises the UI.",
    emptyTitle: "No records",
    emptySubFail: "No failures in this range.",
    emptySubNone: "Recording starts only after history is enabled, and it is never backfilled.",
    colLevel: "Level",
    colTime: "Date and Time",
    colId: "Event ID",
    colCategory: "Task Category",
  },

  // Task list headers
  grid: {
    colName: "Name",
    colState: "Status",
    colNextRun: "Next run time",
    colEnabled: "Enabled",
    colEdit: "Edit",
    colRun: "Run",
    colHistory: "History",
    colRemove: "Delete",
  },

  // Tooltips and accessible names inside list cells
  cell: {
    sortTip: "Click to cycle sorting (ascending → descending → default)",
    editHint: "Ctrl+Enter to save · Esc to cancel",
    enableOn: "Enabled, click to disable",
    enableOff: "Disabled, click to enable",
    actEdit: "Edit",
    actRun: "Run",
    actHistory: "History",
    actRemove: "Delete",
    actStop: "Stop",
    actGeneric: "Action",
    ariaAct: "{label}: {name}",
  },

  // Folder tree on the left
  tree: {
    groups: "Folders",
    visibleConfig: "Display settings",
    collapseAll: "Collapse all",
    expandAll: "Expand all",
    subPicked: "The list shows only the selected tasks",
    subRestricted: "Some folders are hidden by the display settings",
    // Tooltips and accessible names on a node
    nodeCollapse: "Collapse",
    nodeExpand: "Expand",
    selectGroup: "Select folder",
    unselectGroup: "Clear selection for this folder",
    selectGroupTip: "Select this folder (including subfolders)",
    selectTask: "Select task",
    root: "Root",
    unnamed: "Untitled",
    newAtRoot: "Create a folder under the root",
    newSub: "Create a subfolder under this folder",
    rename: "Rename folder",
    remove: "Delete this folder and all tasks under it",
    pickRoot: "Select root",
  },

  app: {
    // Re-read tasks from the system using the current conditions: it runs the
    // filter row it sits at the end of.
    search: "Query",
    searchTip: "Re-query tasks using the conditions above",
    importTask: "Import",
    importTip: "Import a task from an XML file",
    importTipDemo: "Import is not available in browser demo mode",
    exportTask: "Export",
    exportTip: "Export the tasks the query returns, one XML file each",
    exportTipDemo: "Export is not available in browser demo mode",
    exportPickDir: "Choose a folder to export into",
    exporting: "Exporting…",
    create: "New task",

    // Filter bar
    filterName: "Task name",
    filterNextRun: "Next run",
    filterFrom: "From",
    filterTo: "To",
    filterEnabled: "Enabled",
    filterState: "State",
    enabledAll: "All",
    enabledYes: "Enabled",
    enabledNo: "Disabled",
    stateRunning: "Running only",
    stateDisabled: "Disabled only",
    stateFailed: "Recently failed only",
    namePlaceholder: "Match by name contains",
    reset: "Reset",
    resetTip: "Clear all filters",
    // Layout preference: width of the group panel. Kept when filters are reset
    // — it is not a filter.
    resizeHint: "Drag to resize, double-click to restore the default width",
    resetLayoutTip: "Panel width is kept on reset",
    loading: "Loading…",
    showing: "Showing {visible} / {total} tasks",

    // Confirmation box
    confirmDelete: "Delete task",
    confirmSuffix: "?",
    confirmAskPre: "Really delete task ",
    confirmFolder: "Folder: ",

    // In-app update check
    updaterCheck: "Updates",
    updaterTip: "Check for a newer version",
    updaterTipDemo: "Updates are only available in the desktop app",
    updaterTitle: "Update available",
    updaterAsk: "Version {version} is out (you have {current}). Download it and restart now?",
    updaterChecking: "Checking for updates…",
    updaterNone: "Already running the latest version.",
    updaterDone: "Update installed — the app restarts to finish.",
    updaterDemo: "Updates only work in the desktop app.",
    updaterFailed: "The update check failed: {detail}",

    verbEnable: "Enabled",
    verbDisable: "Disabled",

    cancel: "Cancel",
    delete: "Delete",

    // Notice bar
    resetFilters: "Filters reset",
    groupVisibleSaved: "Folder display settings updated",
    groupAllShown: "All folders are shown",
    folderCreated: 'Folder "{name}" created',
    folderRenamed: 'Folder renamed to "{path}"',
    folderDeleted: 'Folder "{path}" and all its tasks deleted',
    folderFailed: "Folder operation failed",
    loadFailed: "Failed to load the task list",
    toggled: 'Task "{name}" {verb}',
    toggleFailed: "Failed to switch the enabled state",
    ran: 'Triggered task "{name}"',
    runFailed: "Failed to run the task",
    stopped: 'Stopped task "{name}"',
    stopFailed: "Failed to stop the task",
    saved: "Changes saved",
    saveFailed: "Failed to save the changes",
    deleted: 'Task "{name}" deleted',
    deleteFailed: "Failed to delete the task",
    imported: 'Task "{name}" imported; review its configuration in the editor',
    importedMany: "Imported {n} tasks; review their configuration in the editor",
    importedPartial: "Import finished: {ok} succeeded, {failed} failed",
    exportedMany: "Exported {n} tasks",
    exportedPartial: "Export finished: {ok} succeeded, {failed} failed",
    exportFailed: "Could not export the tasks",
  },

  // Tooltips and accessible names for the duration input
  dur: {
    xmlOf: "Written to XML: {iso}",
    range: "Allowed: {text}",
    rangeWithZero: "Allowed: 0 ({zero}) or {text}",
    value: "Duration value",
    unit: "Duration unit",
    stepUp: "Increase",
    stepDown: "Decrease",
  },
};
