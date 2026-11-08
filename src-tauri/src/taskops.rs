//! Command-level operations: one `pub fn` per frontend command.
//!
//! This layer orchestrates only — which folder to open, register versus rename,
//! whether to delete the temporary probe task. Field reads and writes live in
//! `taskdef.rs`; threads and connections live in `com.rs`.

#![cfg(target_os = "windows")]

use serde_json::{json, Value};
use windows::core::BSTR;
use windows::Win32::System::TaskScheduler::*;
use windows::Win32::System::Variant::VARIANT;

use crate::error::{err, errd, map, Result};
use crate::taskdef;

fn nil() -> VARIANT {
    VARIANT::default()
}

/// Temporary home for run-time probing; deleted immediately after use.
const PROBE_FOLDER: &str = "\\TaskSchedulerProbe";
const PROBE_TASK: &str = "__probe__";

fn open(svc: &ITaskService, path: &str) -> Result<ITaskFolder> {
    crate::com::open_folder(svc, path)
}

fn one(svc: &ITaskService, name: &str, path: &str) -> Result<IRegisteredTask> {
    if name.is_empty() {
        return Err(err("task.emptyName"));
    }
    let folder = open(svc, path)?;
    unsafe { folder.GetTask(&BSTR::from(name)) }.map_err(|e| errd("task.notFound", format!("{name}: {e}")))
}

/// List every task (hidden included) as one list row.
pub fn list_all() -> Result<Vec<Value>> {
    crate::com::with_service(|svc| {
        let mut out = Vec::new();
        let root = open(svc, "\\")?;
        walk(svc, &root, &mut out, 0)?;
        Ok::<_, crate::error::AppError>(out)
    })?
}

fn walk(svc: &ITaskService, folder: &ITaskFolder, out: &mut Vec<Value>, depth: usize) -> Result<()> {
    if depth > 8 {
        return Ok(());
    }
    let _ = depth;
    if let Ok(coll) = unsafe { folder.GetTasks(1) } {
        if let Ok(n) = unsafe { coll.Count() } {
            for i in 1..=n {
                if let Ok(t) = unsafe { coll.get_Item(&VARIANT::from(i)) } {
                    if let Ok(row) = taskdef::read_item(&t) {
                        out.push(row);
                    }
                }
            }
        }
    }
    if let Ok(sub) = unsafe { folder.GetFolders(1) } {
        if let Ok(n) = unsafe { sub.Count() } {
            for i in 1..=n {
                if let Ok(f) = unsafe { sub.get_Item(&VARIANT::from(i)) } {
                    if let Ok(p) = unsafe { f.Path() } {
                        if let Ok(child) = unsafe { svc.GetFolder(&p) } {
                            let _ = walk(svc, &child, out, depth + 1);
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// Detail view: list row plus full config plus raw XML.
pub fn get_task(name: &str, path: &str) -> Result<Value> {
    let name = name.to_string();
    let path = path.to_string();
    crate::com::with_service(move |svc| {
        let t = one(svc, &name, &path)?;
        let item = taskdef::read_item(&t)?;
        let config = taskdef::read_config(&t)?;
        let xml = unsafe { t.Xml() }.map(|v| v.to_string()).unwrap_or_default();

        // The detail page reuses the list row as the same object
        // (`data = detail ?? task`), so list fields must stay **flat at the top
        // level**, siblings of config / xml. Nesting them under `item` blanks
        // the whole page.
        let mut out = item;
        out["config"] = config;
        out["xml"] = Value::String(xml);
        Ok::<_, crate::error::AppError>(out)
    })?
}

pub fn config(name: &str, path: &str) -> Result<Value> {
    let name = name.to_string();
    let path = path.to_string();
    crate::com::with_service(move |svc| {
        let t = one(svc, &name, &path)?;
        taskdef::read_config(&t)
    })?
}

pub fn section(name: &str, path: &str, sec: &str) -> Result<Value> {
    let name = name.to_string();
    let path = path.to_string();
    let sec = sec.to_string();
    crate::com::with_service(move |svc| {
        let t = one(svc, &name, &path)?;
        taskdef::read_section(&t, &sec)
    })?
}

/// Which properties are both configurable here and supported on this machine.
///
/// Deriving this used to mean enumerating three CIM Settings classes (628 ms
/// measured, one cause of editor lag). Two instant signals replace it:
///   - the engine's own `ITaskService::HighestVersion`
///   - whether `ITaskSettings` casts to Settings2 / Settings3
/// Only a three-row static table remains: four properties were introduced in
/// 1.3 / 1.4; everything else exists since 1.2.
pub fn capability() -> Result<Value> {
    crate::com::with_service(|svc| {
        let mut major_minor = (1u16, 2u16);
        if let Ok(v) = unsafe { svc.HighestVersion() } {
            major_minor = ((v >> 16) as u16, (v & 0xffff) as u16);
        }
        let max = major_minor.0 as f64 + major_minor.1 as f64 / 10.0;

        let req_1_3 = ["UseUnifiedSchedulingEngine", "DisallowStartOnRemoteAppSession"];
        let req_1_4 = ["Volatile", "MaintenanceSettings"];

        let all = [
            "DisallowStartIfOnBatteries", "MultipleInstancesPolicy", "StopIfGoingOnBatteries",
            "IdleSettings", "UseUnifiedSchedulingEngine", "ExecutionTimeLimit",
            "StartWhenAvailable", "RunOnlyIfNetworkAvailable", "Hidden", "Enabled",
            "AllowHardTerminate", "Priority", "RunOnlyIfIdle", "AllowStartOnDemand",
            "WakeToRun", "DisallowStartOnRemoteAppSession", "MaintenanceSettings",
            "RestartOnFailure", "NetworkSettings", "Volatile", "DeleteExpiredTaskAfter",
        ];

        let mut supported = serde_json::Map::new();
        for name in all {
            let need = if req_1_4.contains(&name) {
                1.4
            } else if req_1_3.contains(&name) {
                1.3
            } else {
                1.2
            };
            if max >= need {
                supported.insert(name.to_string(), json!(need));
            }
        }

        Ok::<_, crate::error::AppError>(json!({
            "maxVersion": max,
            "settingsClass": if max >= 1.4 { "MSFT_TaskSettings3" }
                             else if max >= 1.3 { "MSFT_TaskSettings2" }
                             else { "MSFT_TaskSettings" },
            "supported": supported,
            "requiredVersion": {
                "UseUnifiedSchedulingEngine": if max >= 1.3 { 1.3 } else { 0.0 },
                "DisallowStartOnRemoteAppSession": if max >= 1.3 { 1.3 } else { 0.0 },
                "Volatile": if max >= 1.4 { 1.4 } else { 0.0 },
                "MaintenanceSettings": if max >= 1.4 { 1.4 } else { 0.0 },
            },
        }))
    })?
}

/// Save: create or update.
pub fn save(input: &Value) -> Result<()> {
    let input = input.clone();
    crate::com::with_service(move |svc| {
        let name = input
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            return Err(err("task.emptyName"));
        }
        let path = crate::com::normalize_path(
            input.get("path").and_then(|v| v.as_str()).unwrap_or_default(),
        );
        let orig_name = input
            .get("originalName")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let orig_path = crate::com::normalize_path(
            input
                .get("originalPath")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
        );
        let cfg = input.get("config").cloned().unwrap_or(Value::Null);

        let folder = ensure_folder(svc, &path)?;

        // On update, load the existing definition wholesale so unknown nodes
        // come along; apply_config_keep then overwrites only what we know.
        // On create there is no original, so start from an empty definition.
        let mut xml = String::new();
        if !orig_name.is_empty() {
            if let Ok(f) = open(svc, &orig_path) {
                if let Ok(t) = unsafe { f.GetTask(&BSTR::from(&orig_name)) } {
                    xml = unsafe { t.Xml() }.map(|v| v.to_string()).unwrap_or_default();
                }
            }
        }

        let def = unsafe { svc.NewTask(0) }.map_err(map("task.newDefinition"))?;
        if !xml.is_empty() {
            unsafe { def.SetXmlText(&BSTR::from(&xml)) }
                .map_err(map("task.loadDefinition"))?;
        }

        if xml.is_empty() {
            taskdef::apply_config(&def, &cfg, &name)?;
        } else {
            taskdef::apply_config_keep(&def, &cfg, &name)?;
        }

        register(svc, &folder, &name, &def, &cfg)?;

        // Renamed or moved: drop the old one, or two copies remain.
        if !orig_name.is_empty() && (orig_name != name || orig_path != path) {
            if let Ok(f) = open(svc, &orig_path) {
                let _ = unsafe { f.DeleteTask(&BSTR::from(&orig_name), 0) };
            }
        }
        Ok::<_, crate::error::AppError>(())
    })?
}

/// A `<Principals>` node in the XML forces NONE plus an empty identity,
/// otherwise registration fails with "unexpected node" (0x80041316). A real
/// account is only used when the UI supplied one.
fn register(
    _svc: &ITaskService,
    folder: &ITaskFolder,
    name: &str,
    def: &ITaskDefinition,
    cfg: &Value,
) -> Result<()> {
    let pr = cfg.get("principal").cloned().unwrap_or(Value::Null);
    let user = pr
        .get("userId")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let pw = pr
        .get("password")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    if !user.is_empty() && !pw.is_empty() {
        let u = VARIANT::from(BSTR::from(&user));
        let p = VARIANT::from(BSTR::from(&pw));
        unsafe {
            folder.RegisterTaskDefinition(
                &BSTR::from(name),
                def,
                TASK_CREATE_OR_UPDATE.0,
                &u,
                &p,
                TASK_LOGON_PASSWORD,
                &nil(),
            )
        }
        .map_err(map("task.registerWithCredentials"))?;
    } else {
        unsafe {
            folder.RegisterTaskDefinition(
                &BSTR::from(name),
                def,
                TASK_CREATE_OR_UPDATE.0,
                &nil(),
                &nil(),
                TASK_LOGON_NONE,
                &nil(),
            )
        }
        .map_err(map("task.register"))?;
    }
    Ok(())
}

fn ensure_folder(svc: &ITaskService, path: &str) -> Result<ITaskFolder> {
    if let Ok(f) = open(svc, path) {
        return Ok(f);
    }
    let mut cur = open(svc, "\\")?;
    for seg in path.trim_matches('\\').split('\\').filter(|s| !s.is_empty()) {
        cur = match unsafe { cur.CreateFolder(&BSTR::from(seg), &nil()) } {
            Ok(f) => f,
            Err(_) => unsafe { cur.GetFolder(&BSTR::from(seg)) }
                .map_err(|e| errd("task.createFolder", format!("{seg}: {e}")))?,
        };
    }
    Ok(cur)
}

/// Update registration info only — name, description, author, folder.
pub fn update_info(input: &Value) -> Result<Value> {
    let input = input.clone();
    crate::com::with_service(move |svc| {
        let name = input
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            return Err(err("task.emptyName"));
        }
        let path = crate::com::normalize_path(
            input.get("path").and_then(|v| v.as_str()).unwrap_or_default(),
        );
        let orig_name = input
            .get("originalName")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let orig_path = crate::com::normalize_path(
            input
                .get("originalPath")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
        );
        let src = if orig_name.is_empty() { &name } else { &orig_name };
        let src_path = if orig_name.is_empty() { &path } else { &orig_path };

        let task = one(svc, src, src_path)?;
        let xml = unsafe { task.Xml() }.map(|v| v.to_string()).unwrap_or_default();
        let def = unsafe { svc.NewTask(0) }.map_err(map("task.newDefinition"))?;
        unsafe { def.SetXmlText(&BSTR::from(&xml)) }.map_err(map("task.loadDefinition"))?;

        let reg = unsafe { def.RegistrationInfo() }.map_err(map("def.registrationInfo"))?;
        let author = input.get("author").and_then(|v| v.as_str()).unwrap_or_default();
        if !author.is_empty() {
            unsafe { reg.SetAuthor(&BSTR::from(author)) }.map_err(map("def.author"))?;
        }
        unsafe { reg.SetDescription(&BSTR::from(input.get("description").and_then(|v| v.as_str()).unwrap_or_default())) }
            .map_err(map("def.description"))?;

        let folder = ensure_folder(svc, &path)?;
        register(svc, &folder, &name, &def, &Value::Null)?;

        if src != &name || src_path != &path {
            if let Ok(f) = open(svc, src_path) {
                let _ = unsafe { f.DeleteTask(&BSTR::from(src.as_str()), 0) };
            }
        }

        let t = one(svc, &name, &path)?;
        taskdef::read_item(&t)
    })?
}

/// Ask the engine when it would run next.
///
/// Same technique as before: register the current config (draft included) as a
/// temporary task, call `GetRunTimes` for the next N occurrences, delete it.
/// The difference is that the temporary definition is now **built through the
/// object model** instead of generated as XML.
pub fn probe(cfg: &Value, count: u32) -> Result<Vec<String>> {
    let mut cfg = cfg.clone();
    // Disabled triggers are filtered out: GetRunTimes would count them anyway,
    // and what the user wants is "given the triggers I ticked, when does it run".
    if let Some(arr) = cfg.get_mut("triggers").and_then(|v| v.as_array_mut()) {
        arr.retain(|t| t.get("enabled").and_then(|v| v.as_bool()) != Some(false));
    }
    // Probing run times has nothing to do with the principal, and carrying one
    // can get the definition rejected by the schema — always clear it.
    cfg["principal"] = json!({});
    // Disable right after registering, delete right after asking: this probe
    // task can never actually execute.
    cfg["settings"] = json!({ "enabled": false, "deleteExpiredTaskAfter": "PT0S" });
    cfg["actions"] = json!([{ "type": "exec", "command": "cmd.exe", "arguments": "/c exit 0", "workingDirectory": "" }]);

    crate::com::with_service(move |svc| {
        let root = crate::com::open_folder(svc, "\\")?;
        let folder = match unsafe { root.CreateFolder(&BSTR::from(PROBE_FOLDER), &nil()) } {
            Ok(f) => f,
            Err(_) => unsafe { root.GetFolder(&BSTR::from(PROBE_FOLDER)) }
                .map_err(map("task.probeFolder"))?,
        };

        // One temporary task name cannot be registered/deleted concurrently.
        let _guard = crate::runtimes::probe_lock();

        let def = unsafe { svc.NewTask(0) }.map_err(map("task.probeDefinition"))?;
        taskdef::apply_config(&def, &cfg, PROBE_TASK)?;

        let task = unsafe {
            folder.RegisterTaskDefinition(
                &BSTR::from(PROBE_TASK),
                &def,
                TASK_CREATE_OR_UPDATE.0,
                &nil(),
                &nil(),
                TASK_LOGON_NONE,
                &nil(),
            )
        }
        .map_err(map("task.probeRegister"))?;

        let times = crate::runtimes::ask_engine(&task, count);
        let _ = unsafe { folder.DeleteTask(&BSTR::from(PROBE_TASK), 0) };
        times
    })?
}
