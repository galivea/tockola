//! Task import / export plus batch operations.
//!
//! Imported XML is registered **wholesale** (`ITaskFolder::RegisterTask`) and
//! never routed through the config parser — otherwise nodes this tool does not
//! know would be dropped, contradicting the keep-unknown-nodes policy.
//!
//! Batch work is one command rather than a frontend loop, so N tasks produce
//! one summary instead of N notifications.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use windows::core::BSTR;
use windows::Win32::System::TaskScheduler::{
    TASK_CREATE_OR_UPDATE, TASK_LOGON_NONE, TASK_LOGON_PASSWORD,
};
use windows::Win32::System::Variant::VARIANT;

use crate::error::{err, map, Result};
use crate::com;

fn nil() -> VARIANT {
    VARIANT::default()
}

/// Export: write the task's XML straight to `file` (UTF-8, no BOM).
pub fn export_xml(name: &str, path: &str, file: &str) -> Result<()> {
    let detail = crate::taskops::get_task(name, path)?;
    let xml = detail.get("xml").and_then(|v| v.as_str()).unwrap_or_default();
    if xml.trim().is_empty() {
        return Err(err("export.noXml"));
    }
    fs::write(file, xml).map_err(map("export.write"))
}

/// Batch export: one XML file per task, all of them into `dir`.
///
/// The COM interface has no bulk form of this — `IRegisteredTask::Xml` hands
/// back a single task definition and `RegisterTask` takes exactly one back — so
/// a set of tasks is a directory of files, one per task. Each file is an
/// ordinary task XML, which is precisely what the import dialog reads, so an
/// export can be imported again as it is.
///
/// Partial failure is reported per task and never rolled back: one task whose
/// definition is empty must not lose the ninety-nine that came out fine.
pub fn export_all(input: &Value) -> Result<Value> {
    const MAX: usize = 200;

    let dir = input
        .get("dir")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    // The directory is checked before any task is read: discovering halfway
    // through that there is nowhere to write is the most annoying way to fail.
    let target = PathBuf::from(&dir);
    if dir.trim().is_empty() || !target.is_dir() {
        return Err(err("export.noDir").with(&dir));
    }

    let items = task_list(input);
    if items.is_empty() {
        return Err(err("export.empty"));
    }
    if items.len() > MAX {
        return Err(err("export.tooMany").with(format!("{MAX} / {}", items.len())));
    }

    let mut used: HashSet<String> = HashSet::new();
    let mut ok = 0usize;
    let mut files: Vec<Value> = Vec::new();
    let mut failed: Vec<Value> = Vec::new();

    for (name, path) in items {
        match export_one(&name, &path, &target, &mut used) {
            Ok(file) => {
                ok += 1;
                files.push(json!({ "name": name, "path": path, "file": file }));
            }
            Err(e) => failed.push(json!({ "name": name, "path": path, "error": e })),
        }
    }

    Ok(json!({ "ok": ok, "dir": dir, "files": files, "failed": failed }))
}

/// Write one task's XML into `dir`, under a name nothing else in this batch
/// has taken yet (two folders may hold tasks of the same name).
fn export_one(name: &str, path: &str, dir: &Path, used: &mut HashSet<String>) -> Result<String> {
    let detail = crate::taskops::get_task(name, path)?;
    let xml = detail.get("xml").and_then(|v| v.as_str()).unwrap_or_default();
    if xml.trim().is_empty() {
        return Err(err("export.noXml"));
    }
    let file = unique_file_name(&safe_file_name(name), used);
    fs::write(dir.join(&file), xml).map_err(map("export.write"))?;
    Ok(file)
}

/// A task name goes into a filename, and a task name may contain any of the
/// characters Windows refuses in one. Control characters and `\/:*?"<>|` become
/// underscores; trailing dots and spaces are dropped rather than silently
/// ignored by the OS; the legacy device names (CON, NUL, COM1…) are unusable as
/// filenames no matter the extension.
pub fn safe_file_name(name: &str) -> String {
    const BAD: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| if c.is_control() || BAD.contains(&c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim_end_matches(['.', ' ']).trim().to_string();
    if trimmed.is_empty() {
        return "task".to_string();
    }
    let capped: String = trimmed.chars().take(80).collect();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.iter().any(|r| capped.eq_ignore_ascii_case(r)) {
        return format!("_{capped}");
    }
    capped
}

/// `stem.xml`, or `stem (2).xml` when that one is taken.
fn unique_file_name(stem: &str, used: &mut HashSet<String>) -> String {
    let first = format!("{stem}.xml");
    if used.insert(first.clone()) {
        return first;
    }
    for i in 2..1000 {
        let next = format!("{stem} ({i}).xml");
        if used.insert(next.clone()) {
            return next;
        }
    }
    first
}

/// `[{name, path}]` as every batch command takes it.
fn task_list(input: &Value) -> Vec<(String, String)> {
    input
        .get("tasks")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let name = t.get("name").and_then(|x| x.as_str())?.to_string();
                    let path = t
                        .get("path")
                        .and_then(|x| x.as_str())
                        .unwrap_or("\\")
                        .to_string();
                    Some((name, path))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Read `<URI>\path\name</URI>` from an imported XML to prefill the dialog.
pub fn parse_uri(xml: &str) -> (String, String) {
    let uri = match (xml.find("<URI>"), xml.find("</URI>")) {
        (Some(s), Some(e)) if e > s + 5 => xml[s + 5..e].trim().to_string(),
        _ => String::new(),
    };
    let full = uri.replace('/', "\\");
    let full = if full.starts_with('\\') {
        full
    } else {
        format!("\\{full}")
    };
    match full.rfind('\\') {
        Some(i) => (full[i + 1..].to_string(), format!("{}\\", &full[..i])),
        None => (full, "\\".to_string()),
    }
}

/// Import: register the whole XML under the given folder.
///
/// If the XML's `<Principals>` uses the Password logon type, the **XML carries
/// no password** and the caller must supply one. This only picks the matching
/// LogonType based on whether a password arrived.
pub fn import_xml(input: &Value) -> Result<Value> {
    let xml = input
        .get("xml")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if xml.trim().is_empty() {
        return Err(err("import.empty"));
    }
    let (uri_name, uri_path) = parse_uri(&xml);

    let name = input
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(&uri_name)
        .to_string();
    let path = input
        .get("path")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or(uri_path);
    let user = input
        .get("user")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let password = input
        .get("password")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let folder_path = com::normalize_path(&path);
    let n = name.clone();
    com::with_service(move |svc| {
        let folder = com::ensure_folder_open(svc, &folder_path)?;
        let xml_b = BSTR::from(xml.as_str());
        let name_b = BSTR::from(n.as_str());

        let registered = if !user.is_empty() && !password.is_empty() {
            let u = VARIANT::from(BSTR::from(user.as_str()));
            let p = VARIANT::from(BSTR::from(password.as_str()));
            unsafe {
                folder.RegisterTask(
                    &name_b,
                    &xml_b,
                    TASK_CREATE_OR_UPDATE.0,
                    &u,
                    &p,
                    TASK_LOGON_PASSWORD,
                    &nil(),
                )
            }
        } else {
            unsafe {
                folder.RegisterTask(
                    &name_b,
                    &xml_b,
                    TASK_CREATE_OR_UPDATE.0,
                    &nil(),
                    &nil(),
                    TASK_LOGON_NONE,
                    &nil(),
                )
            }
        };

        let task = registered.map_err(map("import.register"))?;
        let full = unsafe { task.Path() }
            .map(|v| v.to_string())
            .unwrap_or_default();
        let saved_name = unsafe { task.Name() }
            .map(|v| v.to_string())
            .unwrap_or(n.clone());
        Ok::<_, crate::error::AppError>(json!({
            "name": saved_name,
            "path": crate::taskdef::folder_path(&full),
        }))
    })?
}

/// Batch enable / disable / run / stop / delete.
///
/// Task operations have no transaction: each one runs and is recorded
/// individually. Partial failure is reported as-is, never rolled back.
pub fn bulk(input: &Value) -> Result<Value> {
    const MAX: usize = 200;

    let action = input
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let items = task_list(input);

    if items.is_empty() {
        return Ok(json!({ "ok": 0, "failed": [] }));
    }
    if items.len() > MAX {
        return Err(err("bulk.tooMany").with(format!("{MAX} / {}", items.len())));
    }

    let mut ok = 0usize;
    let mut failed: Vec<Value> = Vec::new();

    for (name, path) in items {
        let result = match action.as_str() {
            "enable" => com::set_task_enabled(&name, &path, true),
            "disable" => com::set_task_enabled(&name, &path, false),
            "run" => com::run_task(&name, &path),
            "stop" => com::stop_task(&name, &path),
            "delete" => com::delete_task(&name, &path),
            _ => Err(err("bulk.unsupported").with(&action)),
        };
        match result {
            Ok(()) => ok += 1,
            Err(e) => failed.push(json!({ "name": name, "path": path, "error": e })),
        }
    }

    Ok(json!({ "ok": ok, "failed": failed }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_uri_splits_path_and_name() {
        let xml = "<Task><RegistrationInfo><URI>\\Maintenance\\DailyBackup</URI></RegistrationInfo></Task>";
        assert_eq!(
            parse_uri(xml),
            ("DailyBackup".to_string(), "\\Maintenance\\".to_string())
        );
    }

    #[test]
    fn parse_uri_root_task() {
        let xml = "<URI>\\RootTask</URI>";
        assert_eq!(parse_uri(xml), ("RootTask".to_string(), "\\".to_string()));
    }

    #[test]
    fn safe_file_name_replaces_what_windows_refuses() {
        assert_eq!(safe_file_name("backup/db:full"), "backup_db_full");
        assert_eq!(safe_file_name(" noon *log* "), "noon _log_");
        // Trailing dots and spaces are dropped by the OS silently; two names
        // differing only by them would fight over one file.
        assert_eq!(safe_file_name("report."), "report");
        assert_eq!(safe_file_name("   "), "task");
        assert_eq!(safe_file_name("CON"), "_CON");
        // Chinese names are perfectly legal filenames and must survive as is.
        assert_eq!(safe_file_name("每日备份"), "每日备份");
    }

    #[test]
    fn safe_file_name_caps_length() {
        let out = safe_file_name(&"a".repeat(200));
        assert_eq!(out.chars().count(), 80);
    }

    // Two folders can hold tasks of the same name; both files have to survive.
    #[test]
    fn unique_file_name_never_repeats() {
        let mut used = HashSet::new();
        assert_eq!(unique_file_name("Daily", &mut used), "Daily.xml");
        assert_eq!(unique_file_name("Daily", &mut used), "Daily (2).xml");
        assert_eq!(unique_file_name("Daily", &mut used), "Daily (3).xml");
    }

    #[test]
    fn export_all_needs_a_real_directory() {
        let out = export_all(&json!({ "dir": "C:\\no\\such\\folder", "tasks": [{ "name": "a", "path": "\\" }] }));
        assert!(out.is_err());
        assert_eq!(out.unwrap_err().code, "export.noDir");
    }

    #[test]
    fn export_all_rejects_an_empty_selection() {
        let dir = std::env::temp_dir().join("tockola-export-test");
        fs::create_dir_all(&dir).unwrap();
        let out = export_all(&json!({ "dir": dir.to_string_lossy(), "tasks": [] }));
        assert!(out.is_err());
        assert_eq!(out.unwrap_err().code, "export.empty");
    }

    #[test]
    fn export_all_caps_batch_size() {
        let dir = std::env::temp_dir().join("tockola-export-test");
        fs::create_dir_all(&dir).unwrap();
        let tasks: Vec<Value> = (0..201)
            .map(|i| json!({ "name": format!("t{i}"), "path": "\\" }))
            .collect();
        let out = export_all(&json!({ "dir": dir.to_string_lossy(), "tasks": tasks }));
        assert!(out.is_err());
        assert_eq!(out.unwrap_err().code, "export.tooMany");
    }

    #[test]
    fn task_list_defaults_the_folder_to_root() {
        assert_eq!(
            task_list(&json!({ "tasks": [{ "name": "a" }] })),
            vec![("a".to_string(), "\\".to_string())]
        );
        assert!(task_list(&json!({ "tasks": [{ "path": "\\" }] })).is_empty());
    }

    #[test]
    fn bulk_rejects_unknown_action() {
        let out = bulk(&json!({ "action": "fly", "tasks": [{ "name": "a", "path": "\\" }] })).unwrap();
        assert_eq!(out["ok"], 0);
        assert_eq!(out["failed"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn bulk_caps_batch_size() {
        let tasks: Vec<Value> = (0..201)
            .map(|i| json!({ "name": format!("t{}", i), "path": "\\" }))
            .collect();
        let err = bulk(&json!({ "action": "delete", "tasks": tasks }));
        assert!(err.is_err());
    }
}
