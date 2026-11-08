//! The single COM channel, replacing the original PowerShell host.
//!
//! `ITaskService` is an STA object: the thread that creates it must stay alive
//! and pump messages. One dedicated STA thread holds the connection; callers
//! dispatch a closure through [`Com::run`] and only `Send` results cross back —
//! never COM pointers. That keeps every `unsafe` COM call inside this file.

#![cfg(target_os = "windows")]

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::OnceLock;
use std::thread;

use windows::core::BSTR;
use windows::Win32::Foundation::VARIANT_BOOL;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::TaskScheduler::{
    IRegisteredTask, ITaskFolder, ITaskService, TaskScheduler, TASK_CREATE_OR_UPDATE,
    TASK_LOGON_NONE,
};
use windows::Win32::System::Variant::VARIANT;

use crate::error::{map, AppError, Result};

/// Include hidden items when enumerating, matching the script's `GetTasks(1)`.
const ENUM_HIDDEN: i32 = 1;

fn nil() -> VARIANT {
    VARIANT::default()
}

// ---------------------------------------------------------------------------
// Threading
// ---------------------------------------------------------------------------

type Job = Box<dyn FnOnce(&ITaskService) + Send>;

struct Com {
    tx: Sender<Job>,
}

/// The cached `Result` is deliberate: a startup failure is reported verbatim to
/// every later caller instead of re-spawning a thread that is doomed to fail.
static COM: OnceLock<std::result::Result<Com, AppError>> = OnceLock::new();

fn com() -> Result<&'static Com> {
    match COM.get_or_init(Com::start) {
        Ok(c) => Ok(c),
        Err(e) => Err(e.clone()),
    }
}

impl Com {
    fn start() -> Result<Com> {
        let (tx, rx) = channel::<Job>();
        let (ready_tx, ready_rx) = channel::<Result<()>>();

        thread::Builder::new()
            .name("tockola-com".into())
            .spawn(move || worker(&rx, &ready_tx))
            .map_err(map("com.threadSpawn"))?;

        // Hand out the handle only after Connect succeeds, otherwise the first
        // caller races against an uninitialized service.
        ready_rx
            .recv()
            .map_err(|_| crate::error::err("com.threadExited"))?
            .map(|_| Com { tx })
    }

    /// Dispatch a closure onto the STA thread and bring its result back.
    pub fn run<T: Send + 'static>(
        &self,
        f: impl FnOnce(&ITaskService) -> T + Send + 'static,
    ) -> Result<T> {
        let (rtx, rrx) = channel::<T>();
        self.tx
            .send(Box::new(move |svc| {
                let _ = rtx.send(f(svc));
            }))
            .map_err(|_| crate::error::err("com.unavailable"))?;
        rrx.recv()
            .map_err(|_| crate::error::err("com.jobAborted"))
    }
}

fn worker(rx: &Receiver<Job>, ready: &Sender<Result<()>>) {
    // COM initialization belongs to this thread and must be paired with
    // CoUninitialize on every exit path below.
    if let Err(e) = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok() {
        let _ = ready.send(Err(crate::error::errd("com.init", e)));
        return;
    }

    let startup: windows::core::Result<ITaskService> =
        unsafe { CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER) };
    let svc = match startup {
        Ok(s) => s,
        Err(e) => {
            let _ = ready.send(Err(crate::error::errd("com.createService", e)));
            unsafe { CoUninitialize() };
            return;
        }
    };

    if let Err(e) = unsafe { svc.Connect(&nil(), &nil(), &nil(), &nil()) } {
        let _ = ready.send(Err(crate::error::errd("com.connect", e)));
        drop(svc);
        unsafe { CoUninitialize() };
        return;
    }
    let _ = ready.send(Ok(()));

    //
    // Each job gets its own connection rather than sharing one. Rationale,
    // in order of weight:
    //   1. A COM handle dies with its target. Holding nothing across jobs is
    //      the cheapest safe default; the cost is one 6 ms Connect per job.
    //   2. Every command maps to exactly one run(), so long-lived reuse would
    //      not save that Connect anyway. A job doing many things can share a
    //      connection internally without promoting it to a global policy.
    //
    // Startup already proved the connection works, so a failure here is a
    // system-level fault: skip this job and keep serving the rest.
    //
    while let Ok(job) = rx.recv() {
        let fresh: windows::core::Result<ITaskService> =
            unsafe { CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER) };
        let Ok(job_svc) = fresh else { continue };
        if unsafe { job_svc.Connect(&nil(), &nil(), &nil(), &nil()) }.is_err() {
            continue;
        }
        //
        // A panic in one job must not take the thread with it: this loop runs
        // once, and if it exits every later command returns "COM channel gone",
        // turning one unparsable task into a dead application.
        //
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            job(&job_svc);
        }));
        drop(job_svc);
    }

    // Released before CoUninitialize, otherwise STA teardown sees dangling refs.
    drop(svc);
    unsafe { CoUninitialize() };
}

/// Open one level of the folder tree. The UI uses trailing slashes; COM's
/// GetFolder rejects them (the root is the exception: it *is* `\`).
pub fn open_folder(svc: &ITaskService, path: &str) -> Result<ITaskFolder> {
    let normalized = normalize_path(path);
    let arg = com_folder_arg(&normalized);
    unsafe { svc.GetFolder(&BSTR::from(arg)) }
        .map_err(|e| crate::error::err("com.openFolder").with(format!("{normalized}: {e}")))
}

/// Hand a read-only job to the COM thread.
pub fn with_service<T: Send + 'static>(
    f: impl FnOnce(&ITaskService) -> T + Send + 'static,
) -> Result<T> {
    com()?.run(f)
}

// ---------------------------------------------------------------------------
// Path helpers
//
// These mirror the script's Normalize-Path / Get-TaskFolderByPath /
// Split-FolderPath. The UI form of a path always ends with a backslash; COM's
// GetFolder rejects a trailing backslash except for the root, which is `\`.
// ---------------------------------------------------------------------------

/// UI-shaped path: `\A\B\`. An empty string means the root.
pub fn normalize_path(path: &str) -> String {
    let t = path.trim();
    if t.is_empty() {
        return "\\".to_string();
    }
    let mut p = t.replace('/', "\\");
    if !p.starts_with('\\') {
        p.insert(0, '\\');
    }
    if !p.ends_with('\\') {
        p.push('\\');
    }
    p
}

/// Path handed to `GetFolder`.
fn com_folder_arg(normalized: &str) -> &str {
    if normalized == "\\" {
        return normalized;
    }
    normalized.trim_end_matches('\\')
}

/// Split into (parent path with trailing slash, leaf name). `None` for root.
fn split_folder_path(normalized: &str) -> Option<(String, String)> {
    if normalized == "\\" {
        return None;
    }
    let trimmed = normalized.trim_end_matches('\\');
    match trimmed.rfind('\\') {
        Some(i) => Some((trimmed[..=i].to_string(), trimmed[i + 1..].to_string())),
        None => Some(("\\".to_string(), trimmed.to_string())),
    }
}

fn get_folder(svc: &ITaskService, normalized: &str) -> Option<ITaskFolder> {
    unsafe { svc.GetFolder(&BSTR::from(com_folder_arg(normalized))).ok() }
}

fn folder_exists(svc: &ITaskService, normalized: &str) -> bool {
    get_folder(svc, normalized).is_some()
}

fn maybe_err<T>(r: windows::core::Result<T>, e: AppError) -> Result<T> {
    r.map_err(|e2| e.with(e2))
}

// ---------------------------------------------------------------------------
// Task folders
// ---------------------------------------------------------------------------

/// List every folder including the root, depth first, in the UI path shape.
pub fn list_folders() -> Result<Vec<String>> {
    com()?.run(|svc| {
        let mut out = vec!["\\".to_string()];
        walk_folders(svc, "\\", &mut out);
        out
    })
}

fn walk_folders(svc: &ITaskService, path: &str, out: &mut Vec<String>) {
    // Unreachable branches are skipped silently, as in the script.
    let Some(folder) = get_folder(svc, path) else {
        return;
    };
    unsafe {
        let Ok(subs) = folder.GetFolders(ENUM_HIDDEN) else {
            return;
        };
        let n = subs.Count().unwrap_or(0);
        // Task Scheduler collections are **1-based**: valid indices are
        // 1..=Count. Iterating 0..n silently drops the last item of every
        // level — the list still looks populated, so it is easy to miss.
        for i in 1..=n {
            let Ok(sub) = subs.get_Item(&VARIANT::from(i)) else {
                continue;
            };
            let Ok(name) = sub.Name() else { continue };
            let child = format!("{}\\{}\\", path.trim_end_matches('\\'), name);
            out.push(child.clone());
            walk_folders(svc, &child, out);
        }
    }
}

/// Create a folder, creating intermediate levels as needed.
pub fn create_folder(path: &str) -> Result<String> {
    let target = normalize_path(path);
    if target == "\\" {
        return Err(crate::error::err("com.rootExists"));
    }
    com()?.run(move |svc| create_folder_inner(svc, &target))?
}

fn create_folder_inner(svc: &ITaskService, target: &str) -> Result<String> {
    if folder_exists(svc, target) {
        return Err(crate::error::errd("com.folderExists", target));
    }
    let (parent, name) = split_folder_path(target)
        .ok_or_else(|| crate::error::err("com.rootExists"))?;
    ensure_folder(svc, &parent)?;
    let parent_folder = get_folder(svc, &parent)
        .ok_or_else(|| crate::error::errd("com.parentFolder", &parent))?;
    unsafe {
        maybe_err(
            parent_folder.CreateFolder(&BSTR::from(name.as_str()), &nil()),
            crate::error::errd("com.createFolder", &name),
        )?;
    }
    Ok(target.to_string())
}

/// Create each segment in turn, reusing the ones that already exist.
fn ensure_folder(svc: &ITaskService, normalized: &str) -> Result<()> {
    let target = normalize_path(normalized);
    if target == "\\" {
        return Ok(());
    }
    let mut acc = String::new();
    for seg in target.trim_matches('\\').split('\\') {
        if seg.is_empty() {
            continue;
        }
        acc.push('\\');
        acc.push_str(seg);
        let current = normalize_path(&acc);
        if folder_exists(svc, &current) {
            continue;
        }
        let (parent, name) = split_folder_path(&current)
            .ok_or_else(|| crate::error::err("com.invalidPath"))?;
        let parent_folder = get_folder(svc, &parent)
            .ok_or_else(|| crate::error::errd("com.parentFolder", &parent))?;
        unsafe {
            maybe_err(
                parent_folder.CreateFolder(&BSTR::from(name.as_str()), &nil()),
                crate::error::errd("com.createFolder", &name),
            )?;
        }
    }
    Ok(())
}

/// Open a folder, creating it when missing — importing may target a new path.
pub fn ensure_folder_open(svc: &ITaskService, path: &str) -> Result<ITaskFolder> {
    let target = normalize_path(path);
    ensure_folder(svc, &target)?;
    get_folder(svc, &target).ok_or_else(|| crate::error::errd("com.openFolder", &target))
}

/// Delete a folder with everything under it. Returns the task count before deletion.
pub fn delete_folder(path: &str) -> Result<i64> {
    let target = normalize_path(path);
    if target == "\\" {
        return Err(crate::error::err("com.rootNoDelete"));
    }
    com()?.run(move |svc| {
        if !folder_exists(svc, &target) {
            return Err(crate::error::errd("com.folderNotFound", &target));
        }
        let count = count_tasks(svc, &target);
        remove_folder_recursive(svc, &target)?;
        Ok(count)
    })?
}

fn count_tasks(svc: &ITaskService, path: &str) -> i64 {
    let Some(folder) = get_folder(svc, path) else {
        return 0;
    };
    let mut total = 0i64;
    unsafe {
        if let Ok(tasks) = folder.GetTasks(ENUM_HIDDEN) {
            total += i64::from(tasks.Count().unwrap_or(0));
        }
        if let Ok(subs) = folder.GetFolders(ENUM_HIDDEN) {
            let n = subs.Count().unwrap_or(0);
            for i in 1..=n {
                let Ok(sub) = subs.get_Item(&VARIANT::from(i)) else {
                    continue;
                };
                let Ok(name) = sub.Name() else { continue };
                let child = format!("{}\\{}\\", path.trim_end_matches('\\'), name);
                total += count_tasks(svc, &child);
            }
        }
    }
    total
}

fn remove_folder_recursive(svc: &ITaskService, path: &str) -> Result<()> {
    let Some(folder) = get_folder(svc, path) else {
        return Ok(());
    };
    unsafe {
        // Delete this level's tasks first. A single failure must not abort the
        // whole deletion.
        if let Ok(tasks) = folder.GetTasks(ENUM_HIDDEN) {
            let n = tasks.Count().unwrap_or(0);
            for i in 1..=n {
                let Ok(t) = tasks.get_Item(&VARIANT::from(i)) else {
                    continue;
                };
                let Ok(name) = t.Name() else { continue };
                let s = name.to_string();
                let _ = folder.DeleteTask(&BSTR::from(s.as_str()), 0);
            }
        }
        // Then recurse into subfolders.
        if let Ok(subs) = folder.GetFolders(ENUM_HIDDEN) {
            let n = subs.Count().unwrap_or(0);
            for i in 1..=n {
                let Ok(sub) = subs.get_Item(&VARIANT::from(i)) else {
                    continue;
                };
                let Ok(name) = sub.Name() else { continue };
                let child = format!("{}\\{}\\", path.trim_end_matches('\\'), name);
                remove_folder_recursive(svc, &child)?;
            }
        }
    }
    let (parent, name) = split_folder_path(path)
        .ok_or_else(|| crate::error::err("com.rootNoDelete"))?;
    let parent_folder = get_folder(svc, &parent)
        .ok_or_else(|| crate::error::errd("com.parentFolder", &parent))?;
    unsafe {
        maybe_err(
            parent_folder.DeleteFolder(&BSTR::from(name.as_str()), 0),
            crate::error::errd("com.deleteFolder", &name),
        )?;
    }
    Ok(())
}

/// Rename a folder.
///
/// Windows has no `MoveFolder`, so this keeps the script's approach: re-register
/// every task under the new path with its XML untouched, then delete the emptied
/// folders bottom-up.
pub fn rename_folder(path: &str, new_name: &str) -> Result<String> {
    let source = normalize_path(path);
    if source == "\\" {
        return Err(crate::error::err("com.rootNoRename"));
    }
    if new_name.is_empty() {
        return Err(crate::error::err("com.emptyName"));
    }
    if new_name.contains(['\\', '/', ':', '"']) {
        return Err(crate::error::err("com.illegalName"));
    }
    let (parent, _) = split_folder_path(&source)
        .ok_or_else(|| crate::error::err("com.rootNoRename"))?;
    let target = normalize_path(&format!("{parent}{new_name}"));
    if source == target {
        return Ok(target);
    }
    com()?.run(move |svc| {
        if !folder_exists(svc, &source) {
            return Err(crate::error::errd("com.folderNotFound", &source));
        }
        if folder_exists(svc, &target) {
            return Err(crate::error::errd("com.folderExists", &target));
        }
        move_contents(svc, &source, &target)?;
        remove_empty_folders(svc, &source);
        Ok(target)
    })?
}

/// Move everything from one folder to another.
fn move_contents(svc: &ITaskService, from: &str, to: &str) -> Result<()> {
    ensure_folder(svc, to)?;
    let Some(src) = get_folder(svc, from) else {
        return Ok(());
    };
    let dst = get_folder(svc, to).ok_or_else(|| crate::error::errd("com.openFolder", to))?;

    unsafe {
        if let Ok(tasks) = src.GetTasks(ENUM_HIDDEN) {
            let n = tasks.Count().unwrap_or(0);
            for i in 1..=n {
                let Ok(t) = tasks.get_Item(&VARIANT::from(i)) else {
                    continue;
                };
                let Ok(name) = t.Name() else { continue };
                // Register the original XML verbatim: triggers, settings and
                // unmanaged nodes all survive untouched.
                let Ok(xml) = t.Xml() else { continue };
                // Export omits Enabled, so re-registering would lose "disabled".
                let was_disabled = t.Enabled().map(|b| b.0 == 0).unwrap_or(false);
                let name = name.to_string();

                maybe_err(
                    dst.RegisterTask(
                        &BSTR::from(name.as_str()),
                        &xml,
                        TASK_CREATE_OR_UPDATE.0,
                        &nil(),
                        &nil(),
                        TASK_LOGON_NONE,
                        &nil(),
                    ),
                    crate::error::errd("com.moveTask", &name),
                )?;
                if was_disabled {
                    if let Ok(moved) = dst.GetTask(&BSTR::from(name.as_str())) {
                        let _ = moved.SetEnabled(VARIANT_BOOL(0));
                    }
                }
                let _ = src.DeleteTask(&BSTR::from(name.as_str()), 0);
            }
        }
        if let Ok(subs) = src.GetFolders(ENUM_HIDDEN) {
            let n = subs.Count().unwrap_or(0);
            for i in 1..=n {
                let Ok(sub) = subs.get_Item(&VARIANT::from(i)) else {
                    continue;
                };
                let Ok(name) = sub.Name() else { continue };
                let child_from = format!("{}\\{}\\", from.trim_end_matches('\\'), name);
                let child_to = format!("{}\\{}\\", to.trim_end_matches('\\'), name);
                move_contents(svc, &child_from, &child_to)?;
            }
        }
    }
    Ok(())
}

/// Delete folders left empty after a rename, deepest first.
fn remove_empty_folders(svc: &ITaskService, path: &str) {
    let target = normalize_path(path);
    if target == "\\" {
        return;
    }
    let Some(folder) = get_folder(svc, &target) else {
        return;
    };
    unsafe {
        if let Ok(subs) = folder.GetFolders(ENUM_HIDDEN) {
            let n = subs.Count().unwrap_or(0);
            for i in 1..=n {
                let Ok(sub) = subs.get_Item(&VARIANT::from(i)) else {
                    continue;
                };
                let Ok(name) = sub.Name() else { continue };
                let child = format!("{}\\{}\\", target.trim_end_matches('\\'), name);
                remove_empty_folders(svc, &child);
            }
        }
    }
    let Some((parent, name)) = split_folder_path(&target) else {
        return;
    };
    if let Some(parent_folder) = get_folder(svc, &parent) {
        let _ = unsafe { parent_folder.DeleteFolder(&BSTR::from(name.as_str()), 0) };
    }
}

// ---------------------------------------------------------------------------
// Task delete / enable / run / stop
// ---------------------------------------------------------------------------

fn get_task(svc: &ITaskService, folder_path: &str, name: &str) -> Option<IRegisteredTask> {
    let folder = get_folder(svc, folder_path)?;
    unsafe { folder.GetTask(&BSTR::from(name)).ok() }
}

pub fn delete_task(name: &str, path: &str) -> Result<()> {
    let folder_path = normalize_path(path);
    let n = name.to_string();
    com()?.run(move |svc| {
        let folder = get_folder(svc, &folder_path)
            .ok_or_else(|| crate::error::errd("com.folderNotFound", &folder_path))?;
        unsafe {
            maybe_err(
                folder.DeleteTask(&BSTR::from(n.as_str()), 0),
                crate::error::errd("com.deleteTask", &n),
            )
        }
    })?
}

pub fn run_task(name: &str, path: &str) -> Result<()> {
    let folder_path = normalize_path(path);
    let n = name.to_string();
    com()?.run(move |svc| {
        let task = get_task(svc, &folder_path, &n)
            .ok_or_else(|| crate::error::errd("com.taskNotFound", format!("{folder_path}{n}")))?;
        // Run returns IRunningTask, which is not cross-thread and should not
        // leave this thread. Drop it here — we only need to know it started.
        unsafe { maybe_err(task.Run(&nil()).map(|_running| ()), crate::error::errd("com.runTask", &n)) }
    })?
}

pub fn stop_task(name: &str, path: &str) -> Result<()> {
    let folder_path = normalize_path(path);
    let n = name.to_string();
    com()?.run(move |svc| {
        let task = get_task(svc, &folder_path, &n)
            .ok_or_else(|| crate::error::errd("com.taskNotFound", format!("{folder_path}{n}")))?;
        unsafe {
            maybe_err(
                task.Stop(0),
                crate::error::errd("com.stopTask", &n),
            )
        }
    })?
}

pub fn set_task_enabled(name: &str, path: &str, enabled: bool) -> Result<()> {
    let folder_path = normalize_path(path);
    let n = name.to_string();
    com()?.run(move |svc| {
        let task = get_task(svc, &folder_path, &n)
            .ok_or_else(|| crate::error::errd("com.taskNotFound", format!("{folder_path}{n}")))?;
        unsafe {
            maybe_err(
                task.SetEnabled(VARIANT_BOOL(if enabled { -1 } else { 0 })),
                crate::error::err(if enabled { "com.enableTask" } else { "com.disableTask" })
                .with(&n),
            )
        }
    })?
}

// ---------------------------------------------------------------------------
// Unit tests: pure functions that need no real tasks
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_path_keeps_folder_form() {
        assert_eq!(normalize_path(""), "\\");
        assert_eq!(normalize_path("   "), "\\");
        assert_eq!(normalize_path("\\"), "\\");
        assert_eq!(normalize_path("A"), "\\A\\");
        assert_eq!(normalize_path("\\A"), "\\A\\");
        assert_eq!(normalize_path("A\\"), "\\A\\");
        assert_eq!(normalize_path("\\A\\B"), "\\A\\B\\");
        assert_eq!(normalize_path("A/B"), "\\A\\B\\");
        assert_eq!(normalize_path(" /A/B/ "), "\\A\\B\\");
    }

    #[test]
    fn com_folder_arg_strips_trailing_slash() {
        // GetFolder accepts "\A\B"; root is "\". A trailing slash fails with 0x8007007B.
        assert_eq!(com_folder_arg("\\"), "\\");
        assert_eq!(com_folder_arg("\\A\\"), "\\A");
        assert_eq!(com_folder_arg("\\A\\B\\"), "\\A\\B");
    }

    #[test]
    fn split_folder_path_separates_parent_from_name() {
        assert_eq!(split_folder_path("\\"), None);
        assert_eq!(
            split_folder_path("\\A\\"),
            Some(("\\".to_string(), "A".to_string()))
        );
        assert_eq!(
            split_folder_path("\\A\\B\\"),
            Some(("\\A\\".to_string(), "B".to_string()))
        );
    }
}
