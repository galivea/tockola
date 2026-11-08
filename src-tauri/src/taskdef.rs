//! Bidirectional mapping between the COM object model and UI JSON.
//!
//! # Why this layer never touches the Task Scheduler schema
//! The `<Task>` XML the UI reads is a complete format defined by Windows:
//! `<Week>Last</Week>`, `PT72H`, weekday/month bitmasks, version differences
//! from 1.2 to 1.6, which elements may appear in which version... Those
//! rules add up to 1696 lines of PowerShell. Reimplementing them would move
//! ownership of that schema onto us — which is exactly how `<Week>5</Week>`
//! got rejected.
//!
//! The **bilateral object model** owns all of it now:
//!   - read: `task.Definition()` then one getter per field; Windows already
//!     parsed the XML for us
//!   - write: `NewTask` then one setter per field; `ITaskDefinition` renders
//!     the values into valid XML
//! S9 / S10 measured this path: 252 real tasks x ~84 fields, zero failures,
//! and definitions built through the object model register successfully.
//!
//! This layer only **shuttles JSON to fields**. No schema semantics here.
#![cfg(target_os = "windows")]

use chrono::Datelike;
use serde_json::{json, Value};
use windows::core::{BSTR, Interface};
use windows::Win32::Foundation::VARIANT_BOOL;
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::System::TaskScheduler::*;

use crate::error::{errd, map, Result};

// COM getters in this crate use the out-parameter style (IRegisteredTask is the
// exception, see read_item). S9 showed these calls succeed locally; fall back to
// each field's default when a value cannot be read.
macro_rules! rd {
    ($o:expr, $m:ident, str) => {{
        let mut v = BSTR::new();
        let _ = unsafe { $o.$m(&mut v) };
        v.to_string()
    }};
    ($o:expr, $m:ident, bool) => {{
        let mut v = VARIANT_BOOL(0);
        let _ = unsafe { $o.$m(&mut v) };
        v.0 != 0
    }};
    ($o:expr, $m:ident, i32) => {{
        let mut v = 0i32;
        let _ = unsafe { $o.$m(&mut v) };
        v
    }};
    ($o:expr, $m:ident, i16) => {{
        let mut v = 0i16;
        let _ = unsafe { $o.$m(&mut v) };
        v
    }};
    ($o:expr, $m:ident, enu $t:ty) => {{
        let mut v = <$t>::default();
        let _ = unsafe { $o.$m(&mut v) };
        v.0
    }};
}

fn vb(b: bool) -> VARIANT_BOOL {
    VARIANT_BOOL(if b { -1 } else { 0 })
}

/// Bitmask -> the array the UI wants (which weekday/month nodes appear -> bit values).
fn bits_to_arr(mask: i64, count: usize) -> Vec<Value> {
    let mut out = Vec::new();
    for i in 0..count {
        let bit = 1i64 << i;
        if mask & bit != 0 {
            out.push(json!(bit));
        }
    }
    out
}

/// Value array -> bitmask. Input is either a bit-value array or an already combined mask.
fn arr_to_bits(v: &Value) -> i64 {
    match v {
        Value::Array(a) => a
            .iter()
            .filter_map(|x| x.as_i64())
            .fold(0i64, |acc, x| acc | x),
        other => other.as_i64().unwrap_or(0),
    }
}

/// ISO 8601 duration normalization: empty string and PT0S both become PT0S;
/// everything else passes through unchanged (no conversion).
fn norm_dur(s: &str) -> String {
    let t = s.trim().to_uppercase();
    if t.is_empty() || t == "PT0S" {
        "PT0S".to_string()
    } else {
        t
    }
}

fn has_dur(s: &str) -> bool {
    let t = s.trim().to_uppercase();
    !t.is_empty() && t != "PT0S"
}

/// Duration in minutes. Only used to derive a default when the user gave no end time.
fn dur_minutes(s: &str) -> i64 {
    let t = s.trim().to_uppercase();
    if !has_dur(&t) {
        return 0;
    }
    let (date, time) = match t.split_once('T') {
        Some((d, x)) => (d, Some(x)),
        None => (t.as_str(), None),
    };
    let mut total = 0i64;
    for (unit, mul) in [('Y', 525_600i64), ('M', 43_200), ('W', 10_080), ('D', 1_440)] {
        if let Some(n) = num_before(date, unit) {
            total += n * mul;
        }
    }
    if let Some(tm) = time {
        for (unit, mul) in [('H', 60i64), ('M', 1), ('S', 0)] {
            if unit == 'S' {
                continue;
            }
            if let Some(n) = num_before(tm, unit) {
                total += n * mul;
            }
        }
    }
    total
}

fn num_before(s: &str, unit: char) -> Option<i64> {
    let idx = s.find(unit)?;
    let start = s[..idx]
        .char_indices()
        .rev()
        .take_while(|(_, c)| c.is_ascii_digit())
        .map(|(i, _)| i)
        .last()?;
    s[start..idx].parse().ok()
}

/// 1900 and earlier counts as "no time", matching the script's
/// ConvertTo-SafeDate / ConvertTo-FullDate.
fn year_ok(s: &str) -> bool {
    match s.get(..4) {
        Some(y) => y.parse::<i64>().map(|y| y > 1900).unwrap_or(false),
                None => true, // shorter than 4 chars means it is not a date; let formatting cope
    }
}

/// `2026-01-01T03:30:00` -> `2026-01-01 03:30:00`. Second precision so the
/// editor round-trips the value unchanged.
fn full_date(s: &str) -> String {
    if s.is_empty() || !year_ok(s) {
        return String::new();
    }
    let t = s.replace('T', " ");
    // Use get rather than slicing: if non-ASCII sneaks in, return it as-is rather
    // than panic. One panic kills the whole COM thread and every later command.
    t.get(..19).map(|x| x.to_string()).unwrap_or(t)
}


/// `2026-01-01T03:30:00` -> `2026-01-01 03:30`. Minute precision, used by list
/// columns and trigger text.
fn minute_date(s: &str) -> String {
    let f = full_date(s);
    f.get(..16).map(|x| x.to_string()).unwrap_or(f)
}

/// COM DATE (raw form of `NextRunTime` / `LastRunTime`) -> minute-precision string.
fn com_date(v: f64) -> String {
    if v <= 0.0 {
        return String::new();
    }
    let ms = (v * 86_400_000.0).round() as i64;
    let base = chrono::NaiveDate::from_ymd_opt(1899, 12, 30).and_then(|d| d.and_hms_opt(0, 0, 0));
    match base.and_then(|b| b.checked_add_signed(chrono::Duration::milliseconds(ms))) {
        Some(t) if t.year() > 1900 => t.format("%Y-%m-%d %H:%M").to_string(),
        _ => String::new(),
    }
}

/// Windows stores service accounts as SIDs; resolve them to friendly names and
/// keep the original when resolution fails.
fn sid_to_name(s: &str) -> String {
    if !s.starts_with("S-1-") {
        return s.to_string();
    }
    use windows::Win32::Security::{LookupAccountSidW, PSID, SID_NAME_USE};
    let wide: Vec<u16> = s.encode_utf16().chain(std::iter::once(0)).collect();
    let mut sid = PSID::default();
    if unsafe {
        windows::Win32::Security::Authorization::ConvertStringSidToSidW(
            windows::core::PCWSTR(wide.as_ptr()),
            &mut sid,
        )
    }
    .is_err()
    {
        return s.to_string();
    }
    let mut name = [0u16; 256];
    let mut name_len = name.len() as u32;
    let mut domain = [0u16; 256];
    let mut domain_len = domain.len() as u32;
    let mut use_ = SID_NAME_USE::default();
    unsafe {
        let _ = LookupAccountSidW(
            None,
            sid,
            Some(windows::core::PWSTR(name.as_mut_ptr())),
            &mut name_len,
            Some(windows::core::PWSTR(domain.as_mut_ptr())),
            &mut domain_len,
            &mut use_,
        );
    }
    let n = String::from_utf16_lossy(&name[..name_len as usize]);
    let d = String::from_utf16_lossy(&domain[..domain_len as usize]);
    if n.is_empty() {
        s.to_string()
    } else if d.is_empty() {
        n
    } else {
        format!("{d}\\{n}")
    }
}

// ---------------------------------------------------------------------------
// String forms of enum values — shared by the UI and the XML, matching the
// Task Scheduler documentation.
// ---------------------------------------------------------------------------

fn state_text(v: i32) -> &'static str {
    match v {
        1 => "Disabled",
        2 => "Queued",
        3 => "Ready",
        4 => "Running",
        _ => "Unknown",
    }
}

fn instances_text(v: i32) -> &'static str {
    match v {
        0 => "Parallel",
        1 => "Queue",
        3 => "StopExisting",
        _ => "IgnoreNew",
    }
}

fn instances_code(s: &str) -> TASK_INSTANCES_POLICY {
    match s {
        "Parallel" => TASK_INSTANCES_PARALLEL,
        "Queue" => TASK_INSTANCES_QUEUE,
        "StopExisting" => TASK_INSTANCES_STOP_EXISTING,
        _ => TASK_INSTANCES_IGNORE_NEW,
    }
}

fn logon_text(v: i32) -> &'static str {
    match v {
        1 => "Password",
        2 => "S4U",
        3 => "InteractiveToken",
        4 => "Group",
        5 => "ServiceAccount",
        6 => "InteractiveTokenOrPassword",
        _ => "None",
    }
}

fn logon_code(s: &str) -> Option<TASK_LOGON_TYPE> {
    Some(match s {
        "Password" => TASK_LOGON_PASSWORD,
        "S4U" => TASK_LOGON_S4U,
        "Group" => TASK_LOGON_GROUP,
        "ServiceAccount" => TASK_LOGON_SERVICE_ACCOUNT,
        "InteractiveTokenOrPassword" => TASK_LOGON_INTERACTIVE_TOKEN_OR_PASSWORD,
        "InteractiveToken" => TASK_LOGON_INTERACTIVE_TOKEN,
        "None" => TASK_LOGON_NONE,
        _ => return None,
    })
}

/// The UI's RUN_LEVELS values are `LeastPrivilege` / `HighestAvailable`; the
/// latter is also the literal value `<RunLevel>` takes in the XML. Read and
/// write must use the same names.
fn runlevel_text(v: i32) -> &'static str {
    if v == 1 {
        "HighestAvailable"
    } else {
        "LeastPrivilege"
    }
}

/// Both spellings of "highest privilege" are accepted: historical data may
/// contain `Highest`.
fn runlevel_highest(s: &str) -> bool {
    s == "HighestAvailable" || s == "Highest"
}

fn statechange_text(v: i32) -> &'static str {
    match v {
        2 => "ConsoleDisconnect",
        3 => "RemoteConnect",
        4 => "RemoteDisconnect",
        7 => "SessionLock",
        8 => "SessionUnlock",
        _ => "ConsoleConnect",
    }
}

fn statechange_code(s: &str) -> TASK_SESSION_STATE_CHANGE_TYPE {
    match s {
        "ConsoleDisconnect" => TASK_CONSOLE_DISCONNECT,
        "RemoteConnect" => TASK_REMOTE_CONNECT,
        "RemoteDisconnect" => TASK_REMOTE_DISCONNECT,
        "SessionLock" => TASK_SESSION_LOCK,
        "SessionUnlock" => TASK_SESSION_UNLOCK,
        _ => TASK_CONSOLE_CONNECT,
    }
}

/// Trigger type -> the name the UI uses. `None` when unrecognized; the caller
/// then treats it as "unrecognized".
fn trigger_kind(v: i32) -> Option<&'static str> {
    Some(match v {
        1 => "once",
        2 => "daily",
        3 => "weekly",
        4 => "monthly",
        5 => "monthlyDow",
        6 => "idle",
        7 => "registration",
        8 => "boot",
        9 => "logon",
        11 => "sessionStateChange",
        0 => "event",
        _ => return None,
    })
}

fn trigger_type(kind: &str) -> Option<TASK_TRIGGER_TYPE2> {
    Some(match kind {
        "once" => TASK_TRIGGER_TIME,
        "daily" => TASK_TRIGGER_DAILY,
        "weekly" => TASK_TRIGGER_WEEKLY,
        "monthly" => TASK_TRIGGER_MONTHLY,
        "monthlyDow" => TASK_TRIGGER_MONTHLYDOW,
        "idle" => TASK_TRIGGER_IDLE,
        "registration" => TASK_TRIGGER_REGISTRATION,
        "boot" => TASK_TRIGGER_BOOT,
        "logon" => TASK_TRIGGER_LOGON,
        "sessionStateChange" => TASK_TRIGGER_SESSION_STATE_CHANGE,
        "event" => TASK_TRIGGER_EVENT,
        _ => return None,
    })
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

/// `\group\subgroup\taskname` -> `\group\subgroup\`
///
/// `IRegisteredTask::Path()` returns the **task's own full path**, while every
/// `path` in the UI means **the folder the task lives in** (the old script read
/// the CIM `TaskPath`, which is the latter). Skip that strip and the list tree
/// treats every task as a folder, and the detail view cannot find the task.
pub fn folder_path(full: &str) -> String {
    let t = full.replace('/', "\\");
    match t.rfind('\\') {
        Some(i) if i > 0 => format!("{}\\", &t[..i]),
        _ => "\\".to_string(),
    }
}

/// Last segment of a full path. Fallback when `Name()` returns nothing.
fn task_name_of(full: &str) -> String {
    let t = full.replace('/', "\\");
    t.rsplit('\\').next().unwrap_or("").to_string()
}

pub fn read_item(task: &IRegisteredTask) -> Result<Value> {
    let full = unsafe { task.Path() }.map(|v| v.to_string()).unwrap_or_default();
    let mut name = unsafe { task.Name() }.map(|v| v.to_string()).unwrap_or_default();
    if name.is_empty() {
        name = task_name_of(&full);
    }
    let path = folder_path(&full);
    let state = state_text(unsafe { task.State() }.map(|v| v.0).unwrap_or(0));

    let enabled = unsafe { task.Enabled() }
        .map(|v| v.0 != 0)
        .unwrap_or_else(|_| state != "Disabled");

    let next = unsafe { task.NextRunTime() }.map(com_date).unwrap_or_default();
    let last = unsafe { task.LastRunTime() }.map(com_date).unwrap_or_default();
    let result = unsafe { task.LastTaskResult() }
        .map(|v| v.to_string())
        .unwrap_or_default();

    let mut author = String::new();
    let mut description = String::new();
    let mut execute = String::new();
    let mut arguments = String::new();
    let mut working_dir = String::new();
    let mut triggers = Vec::new();
    let mut hidden = false;

    if let Ok(def) = unsafe { task.Definition() } {
        if let Ok(reg) = unsafe { def.RegistrationInfo() } {
            author = rd!(reg, Author, str);
            description = rd!(reg, Description, str);
        }
        if let Ok(st) = unsafe { def.Settings() } {
            let mut h = VARIANT_BOOL(0);
            if unsafe { st.Hidden(&mut h) }.is_ok() {
                hidden = h.0 != 0;
            }
        }
        execute = read_first_exec(&def);
        (arguments, working_dir) = read_first_exec_rest(&def);
        triggers = read_trigger_shapes(&def);
    }

    let command = if arguments.is_empty() {
        execute.clone()
    } else {
        format!("{execute} {arguments}")
    }
    .trim()
    .to_string();

    Ok(json!({
        "name": name,
        "path": path,
        "state": state,
        "enabled": enabled,
        "author": author,
        "description": description,
        "command": command,
        "execute": execute,
        "arguments": arguments,
        "workingDir": working_dir,
        "nextRun": next,
        "lastRun": last,
        "lastResult": result,
        "hidden": hidden,
        "triggers": triggers,
    }))
}

fn each_action(def: &ITaskDefinition, mut f: impl FnMut(&IAction, TASK_ACTION_TYPE)) {
    let Ok(coll) = (unsafe { def.Actions() }) else { return };
    let mut n = 0i32;
    let _ = unsafe { coll.Count(&mut n) };
    for i in 1..=n {
        if let Ok(a) = unsafe { coll.get_Item(i) } {
            let ty = rd!(a, Type, enu TASK_ACTION_TYPE);
            f(&a, TASK_ACTION_TYPE(ty));
        }
    }
}

fn read_first_exec(def: &ITaskDefinition) -> String {
    let mut out = String::new();
    each_action(def, |a, ty| {
        if out.is_empty() && ty == TASK_ACTION_EXEC {
            if let Ok(e) = a.cast::<IExecAction>() {
                out = rd!(e, Path, str);
            }
        }
    });
    out
}

fn read_first_exec_rest(def: &ITaskDefinition) -> (String, String) {
    let mut args = String::new();
    let mut wd = String::new();
    each_action(def, |a, ty| {
        if ty == TASK_ACTION_EXEC {
            if let Ok(e) = a.cast::<IExecAction>() {
                args = rd!(e, Arguments, str);
                wd = rd!(e, WorkingDirectory, str);
            }
        }
    });
    (args, wd)
}

/// One trigger as the UI wants it: facts only, no wording. The frontend
/// renders it in the active language.
fn read_trigger_shapes(def: &ITaskDefinition) -> Vec<Value> {
    let mut out = Vec::new();
    each_trigger(def, |tr, _| {
        if let Some(v) = trigger_shape(tr) {
            out.push(v);
        }
    });
    out
}

fn trigger_shape(tr: &ITrigger) -> Option<Value> {
    let ty = rd!(tr, Type, enu TASK_TRIGGER_TYPE2);
    let kind = trigger_kind(ty)?;
    let mut m = serde_json::Map::new();
    m.insert("type".to_string(), json!(kind));
    // The list column is scanned at a glance, so minute precision — matching
    // the script's Get-TriggerText.
    let start = minute_date(&rd!(tr, StartBoundary, str));
    if !start.is_empty() {
        m.insert("start".to_string(), json!(start));
    }
    m.insert("enabled".to_string(), json!(rd!(tr, Enabled, bool)));
    match kind {
        "daily" => {
            let iv = tr.cast::<IDailyTrigger>()
                .map(|t| rd!(t, DaysInterval, i16).max(1))
                .unwrap_or(1);
            m.insert("interval".to_string(), json!(iv));
        }
        "weekly" => {
            let t = tr.cast::<IWeeklyTrigger>();
            let iv = t.as_ref().map(|t| rd!(t, WeeksInterval, i16).max(1)).unwrap_or(1);
            let mask = t.as_ref().map(|t| rd!(t, DaysOfWeek, i16) as i64).unwrap_or(0);
            m.insert("interval".to_string(), json!(iv));
            m.insert("weekdays".to_string(), json!(bits_to_arr(mask, 7)));
        }
        "monthly" => {
            let t = tr.cast::<IMonthlyTrigger>();
            let mask = t.as_ref().map(|t| rd!(t, DaysOfMonth, i32) as i64).unwrap_or(0);
            let mmask = t.as_ref().map(|t| rd!(t, MonthsOfYear, i16) as i64).unwrap_or(0);
            m.insert("days".to_string(), json!(days_of_month(mask)));
            m.insert("months".to_string(), json!(bits_to_arr(mmask, 12)));
        }
        "monthlyDow" => {
            let t = tr.cast::<IMonthlyDOWTrigger>();
            let mmask = t.as_ref().map(|t| rd!(t, MonthsOfYear, i16) as i64).unwrap_or(0);
            m.insert("months".to_string(), json!(bits_to_arr(mmask, 12)));
        }
        _ => {}
    }
    if let Some(rep) = tr_repetition(tr) {
        m.insert("repetition".to_string(), rep);
    }
    Some(Value::Object(m))
}

/// `<DaysOfMonth>` is a bit set such as "1, 15, last day".
fn days_of_month(mask: i64) -> Vec<Value> {
    let mut out = Vec::new();
    for d in 1..=31i64 {
        if mask & (1i64 << (d - 1)) != 0 {
            out.push(json!(d));
        }
    }
    out
}

/// Repetition pattern, or `None` when the trigger does not repeat.
fn tr_repetition(tr: &ITrigger) -> Option<Value> {
    let Ok(rep) = (unsafe { tr.Repetition() }) else {
        return None;
    };
    let iv = rd!(rep, Interval, str);
    if !has_dur(&iv) {
        return None;
    }
    Some(json!({
        "interval": iv,
        "duration": norm_dur(&rd!(rep, Duration, str)),
        "stopAtDurationEnd": rd!(rep, StopAtDurationEnd, bool),
    }))
}

fn each_trigger(def: &ITaskDefinition, mut f: impl FnMut(&ITrigger, i32)) {
    let Ok(coll) = (unsafe { def.Triggers() }) else { return };
    let mut n = 0i32;
    let _ = unsafe { coll.Count(&mut n) };
    for i in 1..=n {
        if let Ok(tr) = unsafe { coll.get_Item(i) } {
            let ty = rd!(tr, Type, enu TASK_TRIGGER_TYPE2);
            f(&tr, ty);
        }
    }
}

pub fn read_config(task: &IRegisteredTask) -> Result<Value> {
    let def = unsafe { task.Definition() }.map_err(map("def.readDefinition"))?;


    let xml = unsafe { task.Xml() }.map(|v| v.to_string()).unwrap_or_default();
    let xml_version = extract_task_version(&xml);

    Ok(json!({
        "registration": read_registration(&def),
        "principal": read_principal(&def),
        "settings": read_settings(&def, &xml_version),
        "actions": read_actions(&def),
        "triggers": read_triggers(&def),
        "unsupported": read_unsupported(&def, &xml),
    }))
}

///
fn extract_task_version(xml: &str) -> String {
    let Some(start) = xml.find("<Task") else {
        return "1.2".to_string();
    };
    let Some(end) = xml[start..].find('>').map(|i| start + i) else {
        return "1.2".to_string();
    };
    let head = &xml[start..end];
    let Some(k) = head.find("version=") else {
        return "1.2".to_string();
    };
    let rest = &head[k + 8..];
    let q = rest.find(|c| c == '"' || c == '\'');
    let Some(s0) = q else { return "1.2".to_string() };
    let inner = &rest[s0 + 1..];
    let end = inner.find(|c| c == '"' || c == '\'');
    let Some(e) = end else { return "1.2".to_string() };
    let v = inner[..e].trim();
    if v.chars().all(|c| c.is_ascii_digit() || c == '.') && !v.is_empty() {
        v.to_string()
    } else {
        "1.2".to_string()
    }
}

fn read_security_descriptor(reg: &IRegistrationInfo) -> String {
    let mut v = VARIANT::default();
    if unsafe { reg.SecurityDescriptor(&mut v) }.is_err() {
        return String::new();
    }
    unsafe {
        if v.Anonymous.Anonymous.vt.0 != 8 {
            return String::new();
        }
        (*(*v.Anonymous.Anonymous).Anonymous.bstrVal).to_string()
    }
}

fn read_registration(def: &ITaskDefinition) -> Value {
    let Ok(reg) = (unsafe { def.RegistrationInfo() }) else {
        return json!({});
    };
    json!({
        "author": rd!(reg, Author, str),
        "description": rd!(reg, Description, str),
        "securityDescriptor": read_security_descriptor(&reg),
        "source": rd!(reg, Source, str),
        "version": rd!(reg, Version, str),
        "documentation": rd!(reg, Documentation, str),
    })
}

fn read_principal(def: &ITaskDefinition) -> Value {
    let Ok(p) = (unsafe { def.Principal() }) else {
        return json!({"userId":"","groupId":"","logonType":"InteractiveToken","runLevel":"LeastPrivilege"});
    };
    let group_id = rd!(p, GroupId, str);
    let user_id = rd!(p, UserId, str);
    let mut logon = logon_text(rd!(p, LogonType, enu TASK_LOGON_TYPE));
    let run_level = runlevel_text(rd!(p, RunLevel, enu TASK_RUNLEVEL_TYPE));

    let group_row = if group_id.is_empty() { String::new() } else { group_id.clone() };
    if !group_row.is_empty() {
        logon = "Group";
    } else if !user_id.is_empty() {
        let friendly = sid_to_name(&user_id);
        let svc = [
            "SYSTEM",
            "LOCAL SERVICE",
            "NETWORK SERVICE",
            "NT AUTHORITY\\SYSTEM",
            "NT AUTHORITY\\LOCAL SERVICE",
            "NT AUTHORITY\\NETWORK SERVICE",
        ];
        if svc.contains(&friendly.as_str()) && logon != "ServiceAccount" {
            logon = "ServiceAccount";
        }
    }

    json!({
        "userId": sid_to_name(&user_id),
        "groupId": sid_to_name(&group_row),
        "logonType": logon,
        "runLevel": run_level,
    })
}

fn read_settings(def: &ITaskDefinition, xml_version: &str) -> Value {
    let Ok(s) = (unsafe { def.Settings() }) else {
        return json!({});
    };
    let idle = unsafe { s.IdleSettings() }.ok();
    let net = unsafe { s.NetworkSettings() }.ok();

    let mut out = json!({
        "enabled": rd!(s, Enabled, bool),
        "allowStartOnDemand": rd!(s, AllowDemandStart, bool),
        "runOnlyIfIdle": rd!(s, RunOnlyIfIdle, bool),
        "allowHardTerminate": rd!(s, AllowHardTerminate, bool),
        "startWhenAvailable": rd!(s, StartWhenAvailable, bool),
        "runOnlyIfNetworkAvailable": rd!(s, RunOnlyIfNetworkAvailable, bool),
        "disallowStartIfOnBatteries": rd!(s, DisallowStartIfOnBatteries, bool),
        "stopIfGoingOnBatteries": rd!(s, StopIfGoingOnBatteries, bool),
        "wakeToRun": rd!(s, WakeToRun, bool),
        "hidden": rd!(s, Hidden, bool),
        "executionTimeLimit": norm_dur(&rd!(s, ExecutionTimeLimit, str)),
        "deleteExpiredTaskAfter": norm_dur(&rd!(s, DeleteExpiredTaskAfter, str)),
        "restartInterval": norm_dur(&rd!(s, RestartInterval, str)),
        "restartCount": rd!(s, RestartCount, i32),
        "priority": rd!(s, Priority, i32),
        "multipleInstancesPolicy": instances_text(rd!(s, MultipleInstances, enu TASK_INSTANCES_POLICY)),
        "xmlVersion": xml_version,
        "idleDuration": idle.as_ref().map(|i| norm_dur(&rd!(i, IdleDuration, str))).unwrap_or_else(|| "PT10M".into()),
        "waitTimeout": idle.as_ref().map(|i| norm_dur(&rd!(i, WaitTimeout, str))).unwrap_or_else(|| "PT1H".into()),
        "stopOnIdleEnd": idle.as_ref().map(|i| rd!(i, StopOnIdleEnd, bool)).unwrap_or(false),
        "restartOnIdle": idle.as_ref().map(|i| rd!(i, RestartOnIdle, bool)).unwrap_or(false),
        "networkId": net.as_ref().map(|n| rd!(n, Id, str)).unwrap_or_default(),
        "networkName": net.as_ref().map(|n| rd!(n, Name, str)).unwrap_or_default(),
        "useUnifiedSchedulingEngine": false,
        "disallowStartOnRemoteAppSession": false,
        "volatile": false,
        "maintenanceEnabled": false,
        "maintenancePeriod": "P1D",
        "maintenanceDeadline": "P2D",
        "maintenanceExclusive": false,
    });

    if let Ok(s2) = s.cast::<ITaskSettings2>() {
        out["useUnifiedSchedulingEngine"] = json!(rd!(s2, UseUnifiedSchedulingEngine, bool));
        out["disallowStartOnRemoteAppSession"] = json!(rd!(s2, DisallowStartOnRemoteAppSession, bool));
    }
    if let Ok(s3) = s.cast::<ITaskSettings3>() {
        out["volatile"] = json!(rd!(s3, Volatile, bool));
        if let Ok(m) = unsafe { s3.MaintenanceSettings() } {
            let period = rd!(m, Period, str);
            let deadline = rd!(m, Deadline, str);
            if has_dur(&period) || !period.is_empty() {
                out["maintenanceEnabled"] = json!(true);
                out["maintenancePeriod"] = json!(period);
                out["maintenanceDeadline"] = json!(deadline);
                out["maintenanceExclusive"] = json!(rd!(m, Exclusive, bool));
            }
        }
    }
    out
}

fn read_actions(def: &ITaskDefinition) -> Value {
    let mut acts = Vec::new();
    each_action(def, |a, ty| {
        let mut row = json!({
            "type": "unknown",
            "command": "", "arguments": "", "workingDirectory": "",
            "server": "", "from": "", "to": "", "subject": "", "body": "",
            "attachments": "", "title": "", "message": "", "classId": "", "data": "",
        });
        if ty == TASK_ACTION_EXEC {
            if let Ok(e) = a.cast::<IExecAction>() {
                row["type"] = json!("exec");
                row["command"] = json!(rd!(e, Path, str));
                row["arguments"] = json!(rd!(e, Arguments, str));
                row["workingDirectory"] = json!(rd!(e, WorkingDirectory, str));
            }
        } else if ty == TASK_ACTION_COM_HANDLER {
            if let Ok(c) = a.cast::<IComHandlerAction>() {
                row["type"] = json!("com");
                row["classId"] = json!(rd!(c, ClassId, str));
                row["data"] = json!(rd!(c, Data, str));
            }
        } else {
            row["type"] = json!("unknown");
        }
        acts.push(row);
    });
    if acts.is_empty() {
        acts.push(json!({
            "type": "exec", "command": "", "arguments": "", "workingDirectory": "",
            "server": "", "from": "", "to": "", "subject": "", "body": "",
            "attachments": "", "title": "", "message": "", "classId": "", "data": "",
        }));
    }
    Value::Array(acts)
}

fn read_triggers(def: &ITaskDefinition) -> Value {
    let mut rows = Vec::new();
    each_trigger(def, |tr, ty| {
        if let Some(row) = read_trigger(tr, ty) {
            rows.push(row);
        }
    });
    Value::Array(rows)
}

fn random_delay(tr: &ITrigger, ty: i32) -> String {
    match trigger_kind(ty).unwrap_or("") {
        "once" => tr.cast::<ITimeTrigger>().map(|t| rd!(t, RandomDelay, str)),
        "daily" => tr.cast::<IDailyTrigger>().map(|t| rd!(t, RandomDelay, str)),
        "weekly" => tr.cast::<IWeeklyTrigger>().map(|t| rd!(t, RandomDelay, str)),
        "monthly" => tr.cast::<IMonthlyTrigger>().map(|t| rd!(t, RandomDelay, str)),
        "monthlyDow" => tr.cast::<IMonthlyDOWTrigger>().map(|t| rd!(t, RandomDelay, str)),
        _ => Err(windows::core::Error::from_hresult(
            windows::Win32::Foundation::E_NOTIMPL,
        )),
    }
    .unwrap_or_default()
}

fn read_trigger(tr: &ITrigger, ty: i32) -> Option<Value> {
    let kind = trigger_kind(ty)?;
    let mut row = json!({
        "type": kind,
        "enabled": rd!(tr, Enabled, bool),
        "start": full_date(&rd!(tr, StartBoundary, str)),
        "end": full_date(&rd!(tr, EndBoundary, str)),
        "randomDelay": norm_dur(&random_delay(tr, ty)),
        "executionTimeLimit": norm_dur(&rd!(tr, ExecutionTimeLimit, str)),
        "repetition": read_repetition(tr),
        "daysInterval": 1,
        "weeksInterval": 1,
        "daysOfWeek": [],
        "daysOfMonth": [],
        "months": [],
        "monthWeek": 0,
        "delay": "PT0S",
        "stateChange": "ConsoleConnect",
        "userId": "",
        "eventLog": "",
        "eventSource": "",
        "eventId": "",
    });

    match kind {
        "daily" => {
            if let Ok(t) = tr.cast::<IDailyTrigger>() {
                row["daysInterval"] = json!(rd!(t, DaysInterval, i16).max(1));
            }
        }
        "weekly" => {
            if let Ok(t) = tr.cast::<IWeeklyTrigger>() {
                row["weeksInterval"] = json!(rd!(t, WeeksInterval, i16).max(1));
                row["daysOfWeek"] = json!(bits_to_arr(rd!(t, DaysOfWeek, i16) as i64, 7));
            }
        }
        "monthly" => {
            if let Ok(t) = tr.cast::<IMonthlyTrigger>() {
                let mask = rd!(t, DaysOfMonth, i32) as i64;
                let mut days = Vec::new();
                for d in 1..=31i64 {
                    if mask & (1i64 << (d - 1)) != 0 {
                        days.push(json!(d));
                    }
                }
                if days.is_empty() {
                    days.push(json!(1));
                }
                row["daysOfMonth"] = json!(days);
                row["months"] = json!(bits_to_arr(rd!(t, MonthsOfYear, i16) as i64, 12));
            }
        }
        "monthlyDow" => {
            if let Ok(t) = tr.cast::<IMonthlyDOWTrigger>() {
                if rd!(t, RunOnLastWeekOfMonth, bool) {
                    row["monthWeek"] = json!(5);
                } else {
                    let wom = rd!(t, WeeksOfMonth, i16) as i64;
                    row["monthWeek"] = json!(match wom {
                        m if m & 1 != 0 => 1,
                        m if m & 2 != 0 => 2,
                        m if m & 4 != 0 => 3,
                        m if m & 8 != 0 => 4,
                        _ => 0,
                    });
                }
                row["daysOfWeek"] = json!(bits_to_arr(rd!(t, DaysOfWeek, i16) as i64, 7));
                row["months"] = json!(bits_to_arr(rd!(t, MonthsOfYear, i16) as i64, 12));
            }
        }
        "sessionStateChange" => {
            if let Ok(t) = tr.cast::<ISessionStateChangeTrigger>() {
                row["stateChange"] = json!(statechange_text(rd!(t, StateChange, enu TASK_SESSION_STATE_CHANGE_TYPE)));
                row["userId"] = json!(rd!(t, UserId, str));
                row["delay"] = json!(norm_dur(&rd!(t, Delay, str)));
            }
        }
        "event" => {
            if let Ok(t) = tr.cast::<IEventTrigger>() {
                let sub = rd!(t, Subscription, str);
                row["eventLog"] = json!(between(&sub, "Path=\"", "\""));
                row["eventSource"] = json!(between(&sub, "Provider[@Name='", "'"));
                row["eventId"] = json!(between(&sub, "EventID=", "]").trim_matches(|c: char| !c.is_ascii_digit()));
            }
        }
        "logon" | "boot" | "registration" => {
            let d = match tr.cast::<ILogonTrigger>() {
                Ok(t) => rd!(t, Delay, str),
                Err(_) => match tr.cast::<IBootTrigger>() {
                    Ok(t) => rd!(t, Delay, str),
                    Err(_) => tr
                        .cast::<IRegistrationTrigger>()
                        .map(|t| rd!(t, Delay, str))
                        .unwrap_or_default(),
                },
            };
            row["delay"] = json!(norm_dur(&d));
        }
        _ => {}
    }
    Some(row)
}

fn read_repetition(tr: &ITrigger) -> Value {
    let Ok(rep) = (unsafe { tr.Repetition() }) else {
        return json!({"interval":"PT0S","duration":"PT0S","stopAtDurationEnd":false});
    };
    json!({
        "interval": norm_dur(&rd!(rep, Interval, str)),
        "duration": norm_dur(&rd!(rep, Duration, str)),
        "stopAtDurationEnd": rd!(rep, StopAtDurationEnd, bool),
    })
}

fn between<'a>(s: &'a str, open: &str, close: &str) -> &'a str {
    let Some(i) = s.find(open) else { return "" };
    let rest = &s[i + open.len()..];
    match rest.find(close) {
        Some(j) => &rest[..j],
        None => "",
    }
}

fn read_unsupported(def: &ITaskDefinition, xml: &str) -> Value {
    let mut out: Vec<String> = Vec::new();

    let mut kinds = Vec::new();
    each_trigger(def, |_, ty| kinds.push(ty));
    for ty in kinds {
        if trigger_kind(ty).is_none() {
            out.push(format!("trigger/unknownType({ty})"));
        }
    }

    each_action(def, |_, ty| {
        if ty != TASK_ACTION_EXEC && ty != TASK_ACTION_COM_HANDLER {
            out.push(match ty {
                TASK_ACTION_SEND_EMAIL => "action/SendEmail".to_string(),
                TASK_ACTION_SHOW_MESSAGE => "action/ShowMessage".to_string(),
                other => format!("action/unknownType({:?})", other.0),
            });
        }
    });

    let _ = xml;
    Value::Array(out.into_iter().map(Value::String).collect())
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

fn current_user() -> String {
    let d = std::env::var("USERDOMAIN").unwrap_or_default();
    let u = std::env::var("USERNAME").unwrap_or_default();
    if d.is_empty() {
        u
    } else {
        format!("{d}\\{u}")
    }
}

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or_default().to_string()
}
fn b(v: &Value, key: &str, def: bool) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(def)
}
fn i(v: &Value, key: &str, def: i32) -> i32 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(def as i64) as i32
}

///
fn remove_managed_actions(coll: &IActionCollection) -> Result<()> {
    let mut n = 0i32;
    unsafe { coll.Count(&mut n) }.map_err(map("def.countActions"))?;
    for i in (1..=n).rev() {
        let known = unsafe { coll.get_Item(i) }
            .map(|a| {
                let ty = TASK_ACTION_TYPE(rd!(a, Type, enu TASK_ACTION_TYPE));
                ty == TASK_ACTION_EXEC || ty == TASK_ACTION_COM_HANDLER
            })
            .unwrap_or(false);
        if known {
            let _ = unsafe { coll.Remove(&VARIANT::from(i)) };
        }
    }
    Ok(())
}

pub fn apply_config(def: &ITaskDefinition, cfg: &Value, name: &str) -> Result<()> {
    apply_registration(def, cfg, name)?;
    apply_principal(def, cfg)?;
    apply_settings(def, cfg)?;
    apply_triggers(def, cfg, false)?;
    apply_actions(def, cfg, false)?;
    Ok(())
}

pub fn apply_config_keep(def: &ITaskDefinition, cfg: &Value, name: &str) -> Result<()> {
    apply_registration(def, cfg, name)?;
    apply_principal(def, cfg)?;
    apply_settings(def, cfg)?;
    apply_triggers(def, cfg, true)?;
    apply_actions(def, cfg, true)?;
    Ok(())
}

fn apply_registration(def: &ITaskDefinition, cfg: &Value, name: &str) -> Result<()> {
    let reg = unsafe { def.RegistrationInfo() }.map_err(map("def.registrationInfo"))?;
    let r = cfg.get("registration").cloned().unwrap_or(Value::Null);

    let author = s(&r, "author");
    let author = if author.is_empty() { current_user() } else { author };
    let desc = s(&r, "description");

    unsafe { reg.SetAuthor(&BSTR::from(&author)) }.map_err(map("def.author"))?;
    unsafe { reg.SetDescription(&BSTR::from(&desc)) }.map_err(map("def.description"))?;

    unsafe { reg.SetURI(&BSTR::from(name)) }.map_err(map("def.uri"))?;

    for (k, m) in [
        ("source", Option::Some("SetSource")),
        ("version", Option::Some("SetVersion")),
        ("documentation", Option::Some("SetDocumentation")),
    ] {
        let v = s(&r, k);
        if v.is_empty() {
            continue;
        }
        let _ = m;
        let res = match k {
            "source" => unsafe { reg.SetSource(&BSTR::from(&v)) },
            "version" => unsafe { reg.SetVersion(&BSTR::from(&v)) },
            _ => unsafe { reg.SetDocumentation(&BSTR::from(&v)) },
        };
        res.map_err(|e| errd("def.registrationField", format!("{k}: {e}")))?;
    }

    let sd = s(&r, "securityDescriptor");
    if !sd.is_empty() {
        let mut v = VARIANT::default();
        let _ = unsafe { reg.SecurityDescriptor(&mut v) };
        let vt = VARIANT::from(BSTR::from(&sd));
        unsafe { reg.SetSecurityDescriptor(&vt) }.map_err(map("def.securityDescriptor"))?;
    }
    Ok(())
}

fn apply_principal(def: &ITaskDefinition, cfg: &Value) -> Result<()> {
    let p = unsafe { def.Principal() }.map_err(map("def.principal"))?;
    let pr = cfg.get("principal").cloned().unwrap_or(Value::Null);

    let mut user_id = s(&pr, "userId");
    let group_id = s(&pr, "groupId");
    let mut logon = s(&pr, "logonType");
    if logon.is_empty() {
        logon = "InteractiveToken".to_string();
    }
    let run_level = s(&pr, "runLevel");

    if user_id.is_empty() && matches!(logon.as_str(), "S4U" | "Password") {
        user_id = current_user();
    }
    if logon == "ServiceAccount" && user_id.is_empty() {
        user_id = "SYSTEM".to_string();
    }

    if !group_id.is_empty() {
        unsafe { p.SetGroupId(&BSTR::from(&group_id)) }.map_err(map("def.groupId"))?;
    } else {
        if !user_id.is_empty() {
            unsafe { p.SetUserId(&BSTR::from(&user_id)) }.map_err(map("def.userId"))?;
        }
        if logon != "ServiceAccount" {
            if let Some(code) = logon_code(&logon) {
                unsafe { p.SetLogonType(code) }.map_err(map("def.logonType"))?;
            }
        }
    }

    let highest = runlevel_highest(&run_level);
    unsafe { p.SetRunLevel(if highest { TASK_RUNLEVEL_HIGHEST } else { TASK_RUNLEVEL_LUA }) }
        .map_err(map("def.runLevel"))?;
    Ok(())
}

fn apply_settings(def: &ITaskDefinition, cfg: &Value) -> Result<()> {
    let st = unsafe { def.Settings() }.map_err(map("def.settings"))?;
    let v = cfg.get("settings").cloned().unwrap_or(Value::Null);

    let mut set: Vec<(&str, windows::core::Result<()>)> = Vec::new();
    set.push(("Enabled", unsafe { st.SetEnabled(vb(b(&v, "enabled", true))) }));
    set.push(("AllowDemandStart", unsafe {
        st.SetAllowDemandStart(vb(b(&v, "allowStartOnDemand", true)))
    }));
    set.push(("RunOnlyIfIdle", unsafe {
        st.SetRunOnlyIfIdle(vb(b(&v, "runOnlyIfIdle", false)))
    }));
    set.push(("AllowHardTerminate", unsafe {
        st.SetAllowHardTerminate(vb(b(&v, "allowHardTerminate", true)))
    }));
    set.push(("StartWhenAvailable", unsafe {
        st.SetStartWhenAvailable(vb(b(&v, "startWhenAvailable", true)))
    }));
    set.push(("RunOnlyIfNetworkAvailable", unsafe {
        st.SetRunOnlyIfNetworkAvailable(vb(b(&v, "runOnlyIfNetworkAvailable", false)))
    }));
    set.push(("DisallowStartIfOnBatteries", unsafe {
        st.SetDisallowStartIfOnBatteries(vb(b(&v, "disallowStartIfOnBatteries", false)))
    }));
    set.push(("StopIfGoingOnBatteries", unsafe {
        st.SetStopIfGoingOnBatteries(vb(b(&v, "stopIfGoingOnBatteries", false)))
    }));
    set.push(("WakeToRun", unsafe { st.SetWakeToRun(vb(b(&v, "wakeToRun", false))) }));
    set.push(("Hidden", unsafe { st.SetHidden(vb(b(&v, "hidden", false))) }));

    let etl = s(&v, "executionTimeLimit");
    let etl = if etl.is_empty() { "PT72H".to_string() } else { etl };
    set.push(("ExecutionTimeLimit", unsafe {
        st.SetExecutionTimeLimit(&BSTR::from(&etl))
    }));

    let del = norm_dur(&s(&v, "deleteExpiredTaskAfter"));
    if has_dur(&del) {
        set.push(("DeleteExpiredTaskAfter", unsafe {
            st.SetDeleteExpiredTaskAfter(&BSTR::from(&del))
        }));
    }

    let ri = s(&v, "restartInterval");
    let ri = if ri.is_empty() { "PT1H".to_string() } else { ri };
    let rc = i(&v, "restartCount", 0);
    if rc > 0 {
        set.push(("RestartInterval", unsafe { st.SetRestartInterval(&BSTR::from(&ri)) }));
        set.push(("RestartCount", unsafe { st.SetRestartCount(rc) }));
    }
    set.push(("Priority", unsafe { st.SetPriority(i(&v, "priority", 7)) }));
    set.push(("MultipleInstances", unsafe {
        st.SetMultipleInstances(instances_code(&s(&v, "multipleInstancesPolicy")))
    }));

    for (what, r) in set {
        r.map_err(|e| errd("def.setting", format!("{what}: {e}")))?;
    }

    if let Ok(idle) = unsafe { st.IdleSettings() } {
        let idur = s(&v, "idleDuration");
        let idur = if idur.is_empty() { "PT10M".to_string() } else { idur };
        let wt = s(&v, "waitTimeout");
        let wt = if wt.is_empty() { "PT1H".to_string() } else { wt };
        unsafe { idle.SetIdleDuration(&BSTR::from(&idur)) }.map_err(map("def.idleDuration"))?;
        unsafe { idle.SetWaitTimeout(&BSTR::from(&wt)) }.map_err(map("def.idleWait"))?;
        unsafe { idle.SetStopOnIdleEnd(vb(b(&v, "stopOnIdleEnd", false))) }
            .map_err(map("def.idleStop"))?;
        unsafe { idle.SetRestartOnIdle(vb(b(&v, "restartOnIdle", false))) }
            .map_err(map("def.idleRestart"))?;
    }

    if b(&v, "runOnlyIfNetworkAvailable", false) {
        if let Ok(net) = unsafe { st.NetworkSettings() } {
            let _ = unsafe { net.SetId(&BSTR::from(&s(&v, "networkId"))) };
            let _ = unsafe { net.SetName(&BSTR::from(&s(&v, "networkName"))) };
        }
    }

    if let Ok(s2) = st.cast::<ITaskSettings2>() {
        let _ = unsafe { s2.SetUseUnifiedSchedulingEngine(vb(b(&v, "useUnifiedSchedulingEngine", false))) };
        let _ = unsafe {
            s2.SetDisallowStartOnRemoteAppSession(vb(b(&v, "disallowStartOnRemoteAppSession", false)))
        };
    }
    if let Ok(s3) = st.cast::<ITaskSettings3>() {
        let _ = unsafe { s3.SetVolatile(vb(b(&v, "volatile", false))) };
        if let Ok(m) = unsafe { s3.MaintenanceSettings() } {
            let period = s(&v, "maintenancePeriod");
            let deadline = s(&v, "maintenanceDeadline");
            let _ = unsafe { m.SetPeriod(&BSTR::from(&period)) };
            let _ = unsafe { m.SetDeadline(&BSTR::from(&deadline)) };
            let _ = unsafe { m.SetExclusive(vb(b(&v, "maintenanceExclusive", false))) };
        }
    }
    Ok(())
}

fn resolve_end(cfg_end: &str, start: &str, rep_interval: &str, rep_duration: &str, require_end: bool) -> String {
    if !cfg_end.is_empty() {
        return cfg_end.to_string();
    }
    if !has_dur(rep_interval) && !require_end {
        return String::new();
    }
    let mins = dur_minutes(rep_duration);
    let mins = if mins <= 0 { 525_600 } else { mins };
    add_minutes(start, mins)
}

fn add_minutes(start: &str, mins: i64) -> String {
    let t = start.replace('T', " ");
    let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&t, "%Y-%m-%d %H:%M:%S") else {
        return String::new();
    };
    match dt.checked_add_signed(chrono::Duration::minutes(mins)) {
        Some(x) => x.format("%Y-%m-%dT%H:%M:%S").to_string(),
        None => String::new(),
    }
}

fn now_text() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

///
fn apply_triggers(def: &ITaskDefinition, cfg: &Value, keep_unknown: bool) -> Result<()> {
    let coll = unsafe { def.Triggers() }.map_err(map("def.triggerCollection"))?;
    if keep_unknown {
        remove_managed(&coll)?;
    } else {
        unsafe { coll.Clear() }.map_err(map("def.clearTriggers"))?;
    }

    let arr = cfg.get("triggers").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let del = norm_dur(&s(cfg.get("settings").unwrap_or(&Value::Null), "deleteExpiredTaskAfter"));
    let require_end = has_dur(&del);

    for tr in &arr {
        let kind = s(tr, "type");
        let Some(ty) = trigger_type(&kind) else { continue };
        let t = unsafe { coll.Create(ty) }.map_err(map("def.createTrigger"))?;

        let rep = tr.get("repetition").cloned().unwrap_or(Value::Null);
        let iv = norm_dur(&s(&rep, "interval"));
        let dur = norm_dur(&s(&rep, "duration"));
        let stop = b(&rep, "stopAtDurationEnd", false);
        let enabled = b(tr, "enabled", true);

        let mut start = s(tr, "start");
        let calendar = matches!(kind.as_str(), "once" | "daily" | "weekly" | "monthly" | "monthlyDow");
        if calendar {
            if start.is_empty() {
                start = now_text();
            }
            start = normalize_dt(&start);
            unsafe { t.SetStartBoundary(&BSTR::from(&start)) }
                .map_err(map("def.startBoundary"))?;
            let end = resolve_end(&s(tr, "end"), &start, &iv, &dur, require_end);
            if !end.is_empty() {
                unsafe { t.SetEndBoundary(&BSTR::from(&normalize_dt(&end))) }
                    .map_err(map("def.endBoundary"))?;
            }
        }

        unsafe { t.SetEnabled(vb(enabled)) }.map_err(map("def.triggerEnabled"))?;

        let rd = norm_dur(&s(tr, "randomDelay"));
        if has_dur(&rd) {
            if let Ok(x) = t.cast::<ITimeTrigger>() {
                let _ = unsafe { x.SetRandomDelay(&BSTR::from(&rd)) };
            } else if let Ok(x) = t.cast::<IDailyTrigger>() {
                let _ = unsafe { x.SetRandomDelay(&BSTR::from(&rd)) };
            } else if let Ok(x) = t.cast::<IWeeklyTrigger>() {
                let _ = unsafe { x.SetRandomDelay(&BSTR::from(&rd)) };
            } else if let Ok(x) = t.cast::<IMonthlyTrigger>() {
                let _ = unsafe { x.SetRandomDelay(&BSTR::from(&rd)) };
            } else if let Ok(x) = t.cast::<IMonthlyDOWTrigger>() {
                let _ = unsafe { x.SetRandomDelay(&BSTR::from(&rd)) };
            }
        }

        if has_dur(&iv) {
            let r = unsafe { t.Repetition() }.map_err(map("def.repetition"))?;
            unsafe { r.SetInterval(&BSTR::from(&iv)) }.map_err(map("def.repetitionInterval"))?;
            if has_dur(&dur) {
                unsafe { r.SetDuration(&BSTR::from(&dur)) }.map_err(map("def.repetitionDuration"))?;
            }
            unsafe { r.SetStopAtDurationEnd(vb(stop)) }.map_err(map("def.repetitionStop"))?;
        }

        let etl = norm_dur(&s(tr, "executionTimeLimit"));
        if has_dur(&etl) {
            let _ = unsafe { t.SetExecutionTimeLimit(&BSTR::from(&etl)) };
        }

        match kind.as_str() {
            "daily" => {
                if let Ok(x) = t.cast::<IDailyTrigger>() {
                    let n = i(tr, "daysInterval", 1).max(1);
                    let _ = unsafe { x.SetDaysInterval(n.clamp(0, i16::MAX as i32) as i16) };
                }
            }
            "weekly" => {
                if let Ok(x) = t.cast::<IWeeklyTrigger>() {
                    let n = i(tr, "weeksInterval", 1).max(1);
                    let _ = unsafe { x.SetWeeksInterval(n.clamp(0, i16::MAX as i32) as i16) };
                    let m = arr_to_bits(tr.get("daysOfWeek").unwrap_or(&Value::Null));
                    let m = if m == 0 { 2 } else { m };
                    let _ = unsafe { x.SetDaysOfWeek(m.clamp(0, i16::MAX as i64) as i16) };
                }
            }
            "monthly" => {
                if let Ok(x) = t.cast::<IMonthlyTrigger>() {
                    let mut days = 0i64;
                    for d in tr.get("daysOfMonth").and_then(|x| x.as_array()).unwrap_or(&vec![]) {
                        if let Some(n) = d.as_i64() {
                            if (1..=31).contains(&n) {
                                days |= 1i64 << (n - 1);
                            }
                        }
                    }
                    if days == 0 {
                        days = 1;
                    }
                    let _ = unsafe { x.SetDaysOfMonth(days as i32) };
                    let mut m = arr_to_bits(tr.get("months").unwrap_or(&Value::Null));
                    if m == 0 {
                        m = 0x0fff;
                    }
                    let _ = unsafe { x.SetMonthsOfYear(m.clamp(0, i16::MAX as i64) as i16) };
                }
            }
            "monthlyDow" => {
                if let Ok(x) = t.cast::<IMonthlyDOWTrigger>() {
                    let wk = i(tr, "monthWeek", 0);
                    if wk == 5 {
                        let _ = unsafe { x.SetRunOnLastWeekOfMonth(vb(true)) };
                    } else if wk >= 1 {
                        let bits = 1i16 << (wk - 1);
                        let _ = unsafe { x.SetWeeksOfMonth(bits) };
                        let _ = unsafe { x.SetRunOnLastWeekOfMonth(vb(false)) };
                    }
                    let mut dw = arr_to_bits(tr.get("daysOfWeek").unwrap_or(&Value::Null));
                    if dw == 0 {
                        dw = 2;
                    }
                    let _ = unsafe { x.SetDaysOfWeek(dw.clamp(0, i16::MAX as i64) as i16) };
                    let mut m = arr_to_bits(tr.get("months").unwrap_or(&Value::Null));
                    if m == 0 {
                        m = 0x0fff;
                    }
                    let _ = unsafe { x.SetMonthsOfYear(m.clamp(0, i16::MAX as i64) as i16) };
                }
            }
            "sessionStateChange" => {
                if let Ok(x) = t.cast::<ISessionStateChangeTrigger>() {
                    let _ = unsafe { x.SetStateChange(statechange_code(&s(tr, "stateChange"))) };
                    let uid = s(tr, "userId");
                    if !uid.is_empty() {
                        let _ = unsafe { x.SetUserId(&BSTR::from(&uid)) };
                    }
                    let d = norm_dur(&s(tr, "delay"));
                    let _ = unsafe { x.SetDelay(&BSTR::from(&d)) };
                }
            }
            "event" => {
                if let Ok(x) = t.cast::<IEventTrigger>() {
                    let sub = build_subscription(tr);
                    let _ = unsafe { x.SetSubscription(&BSTR::from(&sub)) };
                }
            }
            "logon" | "boot" | "registration" => {
                let d = norm_dur(&s(tr, "delay"));
                if kind == "logon" {
                    if let Ok(x) = t.cast::<ILogonTrigger>() {
                        let _ = unsafe { x.SetDelay(&BSTR::from(&d)) };
                    }
                } else if kind == "boot" {
                    if let Ok(x) = t.cast::<IBootTrigger>() {
                        let _ = unsafe { x.SetDelay(&BSTR::from(&d)) };
                    }
                } else if let Ok(x) = t.cast::<IRegistrationTrigger>() {
                    let _ = unsafe { x.SetDelay(&BSTR::from(&d)) };
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn build_subscription(tr: &Value) -> String {
    let log = s(tr, "eventLog");
    let log = if log.is_empty() { "Application".to_string() } else { log };
    let src = s(tr, "eventSource");
    let id = s(tr, "eventId");
    let mut sel = format!("*[System[Provider[@Name='{src}']");
    if !id.is_empty() {
        sel.push_str(&format!(" and (EventID={id})"));
    }
    sel.push_str("]]");
    format!(
        "<QueryList><Query Id=\"0\" Path=\"{log}\"><Select Path=\"{log}\">{sel}</Select></Query></QueryList>"
    )
}

/// `2026-01-01 03:30` / `2026-01-01T03:30` -> `2026-01-01T03:30:00`
fn normalize_dt(s: &str) -> String {
    let t = s.trim().replace('T', " ");
    let (d, tm) = match t.split_once(' ') {
        Some((a, b)) => (a, b),
        None => (t.as_str(), "00:00:00"),
    };
    let mut parts: Vec<&str> = tm.split(':').collect();
    while parts.len() < 3 {
        parts.push("00");
    }
    format!("{}T{:02}:{:02}:{:02}", d, parts[0], parts[1], parts[2])
}

fn remove_managed(coll: &ITriggerCollection) -> Result<()> {
    let mut n = 0i32;
    unsafe { coll.Count(&mut n) }.map_err(map("def.countTriggers"))?;
    for i in (1..=n).rev() {
        let known = unsafe { coll.get_Item(i) }
            .map(|t| trigger_kind(rd!(t, Type, enu TASK_TRIGGER_TYPE2)).is_some())
            .unwrap_or(false);
        if known {
            let _ = unsafe { coll.Remove(&VARIANT::from(i)) };
        }
    }
    Ok(())
}

fn apply_actions(def: &ITaskDefinition, cfg: &Value, keep_unknown: bool) -> Result<()> {
    let coll = unsafe { def.Actions() }.map_err(map("def.actionCollection"))?;
    if keep_unknown {
        remove_managed_actions(&coll)?;
    } else {
        unsafe { coll.Clear() }.map_err(map("def.clearActions"))?;
    }

    let arr = cfg.get("actions").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    for a in &arr {
        match s(a, "type").as_str() {
            "exec" => {
                let act = unsafe { coll.Create(TASK_ACTION_EXEC) }
                    .map_err(map("def.createExec"))?;
                let e = act
                    .cast::<IExecAction>()
                    .map_err(map("def.execCast"))?;
                unsafe { e.SetPath(&BSTR::from(&s(a, "command"))) }
                    .map_err(map("def.execPath"))?;
                unsafe { e.SetArguments(&BSTR::from(&s(a, "arguments"))) }
                    .map_err(map("def.execArguments"))?;
                unsafe { e.SetWorkingDirectory(&BSTR::from(&s(a, "workingDirectory"))) }
                    .map_err(map("def.execWorkingDir"))?;
            }
            "com" => {
                let act = unsafe { coll.Create(TASK_ACTION_COM_HANDLER) }
                    .map_err(map("def.createComHandler"))?;
                let c = act
                    .cast::<IComHandlerAction>()
                    .map_err(map("def.comHandlerCast"))?;
                unsafe { c.SetClassId(&BSTR::from(&s(a, "classId"))) }
                    .map_err(map("def.comClassId"))?;
                let data = s(a, "data");
                if !data.is_empty() {
                    let _ = unsafe { c.SetData(&BSTR::from(&data)) };
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn read_section(task: &IRegisteredTask, section: &str) -> Result<Value> {
    let cfg = read_config(task)?;
    Ok(match section {
        "triggers" => cfg["triggers"].clone(),
        "actions" => cfg["actions"].clone(),
        "settings" => cfg["settings"].clone(),
        "principal" => cfg["principal"].clone(),
        "registration" => {
            let r = cfg["registration"].clone();
            let full = unsafe { task.Path() }.map(|v| v.to_string()).unwrap_or_default();
            let mut tname = unsafe { task.Name() }.map(|v| v.to_string()).unwrap_or_default();
            if tname.is_empty() {
                tname = task_name_of(&full);
            }
            json!({
                "name": tname,
                "path": folder_path(&full),
                "author": r["author"],
                "description": r["description"],
                "securityDescriptor": r["securityDescriptor"],
                "source": r["source"],
                "version": r["version"],
                "documentation": r["documentation"],
                "unsupported": cfg["unsupported"],
            })
        }
        other => return Err(errd("def.sectionUnknown", other)),
    })
}
