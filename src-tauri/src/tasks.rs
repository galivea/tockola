//! Bridge layer for reading and writing Windows scheduled tasks.
//!
//! Reads and writes go through the Task Scheduler COM object model (see
//! `taskdef.rs`); the old PowerShell host was retired once the COM channel
//! reached feature parity.
//!
//! Config model: backend and frontend exchange a *complete* config object, from
//! which the backend rebuilds the whole task XML. Changing any field therefore
//! needs no special "keep the untouched fields" logic.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{map, Result};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTaskInput {
    pub name: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub original_name: String,
    #[serde(default)]
    pub original_path: String,
    pub config: Value,
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_tasks() -> Result<Vec<Value>> {
    tauri::async_runtime::spawn_blocking(crate::taskops::list_all)
        .await
        .map_err(map("app.join"))?
}

#[tauri::command]
pub async fn get_task(name: String, path: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || crate::taskops::get_task(&name, &path))
        .await
        .map_err(map("app.join"))?
}

#[tauri::command]
pub async fn save_task(input: SaveTaskInput) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || -> Result<()> {
        let payload = serde_json::to_value(&input).map_err(map("app.join"))?;
        crate::taskops::save(&payload)
    })
    .await
    .map_err(map("app.join"))?
}

// Editor-only: return the config without building a task view.
// The editor no longer shows name / description / folder / author, so
// Get-TaskView is unnecessary — which also drops the CIM round trip it made
// internally (~84 ms measured).
#[tauri::command]
pub async fn get_task_config(name: String, path: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || crate::taskops::config(&name, &path))
        .await
        .map_err(map("app.join"))?
}

// Returns which settings this machine can actually write; the UI uses it to
// decide which rows to render and which to grey out. The machine side comes
// from the live engine (HighestVersion + whether ITaskSettings casts to
// Settings2/Settings3), the property list and its minimum versions live in
// taskops::capability.
#[tauri::command]
pub async fn get_task_capability() -> Result<Value> {
    tauri::async_runtime::spawn_blocking(crate::taskops::capability)
        .await
        .map_err(map("app.join"))?
}

// Read task config section by section:
// registration / triggers / actions / settings / principal.
// Unlike get_task_config it returns one section per call, so each region of the
// editor fetches in parallel, renders as it arrives, and one failure does not
// affect the others.
#[tauri::command]
pub async fn get_task_section(name: String, path: String, section: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::taskops::section(&name, &path, &section)
    })
    .await
    .map_err(map("app.join"))?
}

// Update the registration info only (name / path / description / author).
// Unlike save_task this does not rebuild the whole XML; it rewrites just the
// <RegistrationInfo> node and leaves triggers, actions, settings and conditions
// untouched. Inline editing in the list needs one call and does not have to
// fetch the full config first.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskInfoInput {
    pub name: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub original_name: String,
    #[serde(default)]
    pub original_path: String,
}

#[tauri::command]
pub async fn update_task_info(input: UpdateTaskInfoInput) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Value> {
        let payload = serde_json::to_value(&input).map_err(map("app.join"))?;
        crate::taskops::update_info(&payload)
    })
    .await
    .map_err(map("app.join"))?
}

// ---------------------------------------------------------------------------
// Task folder commands: list / create / rename / delete
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_folders() -> Result<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        // P1: moved to COM. The script version, Get-TaskFolderList, was already
        // New-Object ComObject plus a recursive GetFolders; here we do the same
        // thing against COM directly.
        tauri::async_runtime::spawn_blocking(crate::com::list_folders)
            .await
            .map_err(map("app.join"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err(errd("app.windowsOnly", "unsupported platform"))
    }
}

#[tauri::command]
pub async fn create_folder(path: String) -> Result<String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || crate::com::create_folder(&path))
            .await
            .map_err(map("app.join"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err(errd("app.windowsOnly", "unsupported platform"))
    }
}

/// Rename a task folder. Windows has no MoveFolder interface, so this
/// re-registers recursively at the new path and then deletes the original.
#[tauri::command]
pub async fn rename_folder(path: String, name: String) -> Result<String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || crate::com::rename_folder(&path, &name))
            .await
            .map_err(map("app.join"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (path, name);
        Err(errd("app.windowsOnly", "unsupported platform"))
    }
}

/// Recursively delete a folder with all its sub-folders and tasks; returns the
/// number of tasks deleted.
#[tauri::command]
pub async fn delete_folder(path: String) -> Result<i64> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || crate::com::delete_folder(&path))
            .await
            .map_err(map("app.join"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err(errd("app.windowsOnly", "unsupported platform"))
    }
}

/// Ask the Task Scheduler engine for the next N run times — the source behind
/// the "next N runs" panel. Scheduling rules belong to the engine; this only
/// feeds it a draft config and returns the answer.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeRunTimesInput {
    /// The UI still passes a task name; probing does not need it (the definition
    /// is built on the fly).
    #[serde(default)]
    #[allow(dead_code)]
    pub name: String,
    #[serde(default)]
    pub count: u32,
    pub config: Value,
}

// ---- Run history ----
// History is not part of the COM object model (IRegisteredTask exposes only
// the *last* result, not the sequence), so the event channel is the only
// source. The channel is off by default, and "history disabled" is a normal
// state to report rather than an error — the UI uses it to offer the
// "enable history" action.

#[tauri::command]
pub async fn get_task_history(
    name: String,
    path: String,
    limit: Option<u32>,
    days: Option<u32>,
) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let enabled = crate::history::channel_enabled().unwrap_or(false);
        let events = if enabled {
            crate::history::task_events(&path, &name, limit.unwrap_or(200), days.unwrap_or(7))?
        } else {
            Vec::new()
        };
        Ok(serde_json::json!({ "enabled": enabled, "events": events }))
    })
    .await
    .map_err(map("app.join"))?
}

#[tauri::command]
pub async fn get_history_enabled() -> Result<Value> {
    tauri::async_runtime::spawn_blocking(|| {
        let enabled = crate::history::channel_enabled().unwrap_or(false);
        Ok(serde_json::json!({ "enabled": enabled, "elevateNeeded": !enabled }))
    })
    .await
    .map_err(map("app.join"))?
}

/// Whether the channel is enabled. Enabling requires administrator rights, so
/// a disabled channel also tells the frontend that elevation is needed.
#[tauri::command]
pub async fn set_history_enabled(enabled: bool) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || crate::history::set_channel_enabled(enabled))
        .await
        .map_err(map("app.join"))?
}

// ---- Import / export ----

#[tauri::command]
pub async fn export_task_xml(name: String, path: String, file: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || crate::taskio::export_xml(&name, &path, &file))
        .await
        .map_err(map("app.join"))?
}

/// Export every task in the selection into one directory, one XML file each.
///
/// A batch command rather than a frontend loop: the alternative is N dialogs
/// and N notifications for an action the user thought of as one thing.
#[tauri::command]
pub async fn export_tasks_xml(input: Value) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || crate::taskio::export_all(&input))
        .await
        .map_err(map("app.join"))?
}

#[tauri::command]
pub async fn import_task_xml(input: Value) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || crate::taskio::import_xml(&input))
        .await
        .map_err(map("app.join"))?
}

// ---- Bulk ----
// One call, one summary: looping over N tasks in the frontend would raise N
// notifications, and 30 prompts for a 30-task delete is unusable.

#[tauri::command]
pub async fn bulk_task_action(input: Value) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || crate::taskio::bulk(&input))
        .await
        .map_err(map("app.join"))?
}

#[tauri::command]
pub async fn probe_run_times(input: ProbeRunTimesInput) -> Result<Vec<String>> {
    let count = input.count;
    tauri::async_runtime::spawn_blocking(move || crate::taskops::probe(&input.config, count))
        .await
        .map_err(map("app.join"))?
}

#[tauri::command]
pub async fn delete_task(name: String, path: String) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || crate::com::delete_task(&name, &path))
            .await
            .map_err(map("app.join"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (name, path);
        Err(errd("app.windowsOnly", "unsupported platform"))
    }
}

#[tauri::command]
pub async fn run_task(name: String, path: String) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || crate::com::run_task(&name, &path))
            .await
            .map_err(map("app.join"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (name, path);
        Err(errd("app.windowsOnly", "unsupported platform"))
    }
}

#[tauri::command]
pub async fn stop_task(name: String, path: String) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || crate::com::stop_task(&name, &path))
            .await
            .map_err(map("app.join"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (name, path);
        Err(errd("app.windowsOnly", "unsupported platform"))
    }
}

#[tauri::command]
pub async fn set_task_enabled(name: String, path: String, enabled: bool) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            crate::com::set_task_enabled(&name, &path, enabled)
        })
        .await
        .map_err(map("app.join"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (name, path, enabled);
        Err(errd("app.windowsOnly", "unsupported platform"))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    fn daily_config() -> Value {
        let d = crate::runtimes::tomorrow();
        json!({
            "registration": { "author": "probe", "description": "" },
            "principal": { "userId": "", "groupId": "", "logonType": "InteractiveToken", "runLevel": "LeastPrivilege" },
            "settings": {
                "enabled": true, "allowStartOnDemand": true, "runOnlyIfIdle": false,
                "idleDuration": "PT10M", "waitTimeout": "PT1H", "stopOnIdleEnd": false, "restartOnIdle": false,
                "allowHardTerminate": true, "startWhenAvailable": true, "runOnlyIfNetworkAvailable": false,
                "networkId": "", "networkName": "", "disallowStartIfOnBatteries": false, "stopIfGoingOnBatteries": false,
                "wakeToRun": false, "executionTimeLimit": "PT72H", "multipleInstancesPolicy": "IgnoreNew",
                "restartCount": 0, "restartInterval": "PT1H", "deleteExpiredTaskAfter": "PT0S",
                "hidden": false, "priority": 7, "xmlVersion": "1.2", "useUnifiedSchedulingEngine": false,
                "disallowStartOnRemoteAppSession": false, "volatile": false, "maintenanceEnabled": false,
                "maintenancePeriod": "P1D", "maintenanceDeadline": "P2D", "maintenanceExclusive": false
            },
            "actions": [],
            "triggers": [{
                "type": "daily", "enabled": true, "start": format!("{d}T09:00:00"), "end": "",
                "randomDelay": "PT0S",
                "repetition": { "interval": "PT0S", "duration": "PT0S", "stopAtDurationEnd": false },
                "daysInterval": 1, "weeksInterval": 1, "daysOfWeek": [], "daysOfMonth": [],
                "months": [], "monthWeek": 0, "delay": "PT0S", "stateChange": "ConsoleConnect",
                "userId": "", "eventLog": "Application", "eventSource": "", "eventId": ""
            }]
        })
    }

    // Full chain: UI config -> build the definition on the object model ->
    // register temporarily -> ask the engine -> delete.
    #[test]
    fn probe_end_to_end_from_config() {
        let got = crate::taskops::probe(&daily_config(), 3).expect("probe should succeed");
        assert_eq!(got.len(), 3, "expected 3 rows, got {:?}", got);
        for s in &got {
            assert!(s.ends_with("09:00:00"), "unexpected time: {:?}", got);
        }
        println!("end-to-end probe result: {:#?}", got);
    }

    /// Inferring run times has nothing to do with the identity a task runs under,
    /// so probing never carries a principal. An earlier version generated one too,
    /// and group-principal tasks were rejected by the schema (0x80041316) — the
    /// very bug that was reported. This path no longer touches XML, but the
    /// behaviour still has to hold.
    #[test]
    fn probe_works_for_group_principal_task() {
        let mut cfg = daily_config();
        cfg["principal"] = json!({
            "userId": "", "groupId": "S-1-5-32-545",
            "logonType": "InteractiveToken", "runLevel": "LeastPrivilege"
        });
        let got = crate::taskops::probe(&cfg, 3).expect("group-principal tasks must be probed too");
        assert_eq!(got.len(), 3, "expected 3 rows, got {:?}", got);
    }

    /// Disabled triggers are never sent to the engine: GetRunTimes counts them
    /// anyway.
    #[test]
    fn probe_drops_disabled_triggers() {
        let mut cfg = daily_config();
        cfg["triggers"] = json!([
            { "type": "daily", "enabled": false, "start": "2020-01-01T03:00:00",
              "repetition": { "interval": "PT0S", "duration": "PT0S" },
              "daysInterval": 1, "weeksInterval": 1, "daysOfWeek": [], "daysOfMonth": [],
              "months": [], "monthWeek": 0 },
            daily_config()["triggers"][0].clone()
        ]);
        let got = crate::taskops::probe(&cfg, 2).expect("probe should succeed");
        for s in &got {
            assert!(s.ends_with("09:00:00"), "03:00 must not appear: {:?}", got);
        }
    }

    #[test]
    fn p1_folder_create_and_delete() {
        let root = "\\__TSTestRoot__\\P1Create\\";
        let _ = crate::com::delete_folder(root);

        let deep = format!("{root}RT\\Sub\\");
        let created = crate::com::create_folder(&deep).expect("COM should create every level in one call");
        assert_eq!(created, deep);

        assert!(crate::com::list_folders().unwrap().contains(&created));

        let dup = crate::com::create_folder(&deep);
        assert!(dup.is_err(), "duplicate create must fail");
        assert_eq!(dup.unwrap_err().code, "com.folderExists");

        // Returns the task count; there are none here.
        assert_eq!(crate::com::delete_folder(root).unwrap(), 0);
        // Note: root is a &str while contains() wants a &String, hence the iter().any() below.
        let still = crate::com::list_folders().unwrap();
        assert!(
            !still.iter().any(|f| f == root),
            "temporary folder should be gone, still present: {still:?}"
        );
    }

    #[test]
    fn p1_folder_guard_errors() {
        assert_eq!(
            crate::com::create_folder("\\").unwrap_err().code,
            "com.rootExists"
        );
        assert_eq!(
            crate::com::delete_folder("\\").unwrap_err().code,
            "com.rootNoDelete"
        );
        assert_eq!(
            crate::com::rename_folder("\\", "x").unwrap_err().code,
            "com.rootNoRename"
        );
        assert_eq!(
            crate::com::delete_folder("\\__no_such__\\")
                .unwrap_err()
                .code,
            "com.folderNotFound"
        );
    }

    #[test]
    fn p1_rename_folder() {
        let root = "\\__TSTestRoot__\\P1Rename\\";
        let _ = crate::com::delete_folder(root);
        let source = format!("{root}A\\");
        crate::com::create_folder(&source).expect("failed to create the source folder");

        let target = crate::com::rename_folder(&source, "B").expect("rename should succeed");
        assert_eq!(target, format!("{root}B\\"));

        let list = crate::com::list_folders().unwrap();
        assert!(list.contains(&target), "the new name should exist");
        assert!(!list.contains(&source), "the old name should be gone");

        let _ = crate::com::delete_folder(root);
    }
}

