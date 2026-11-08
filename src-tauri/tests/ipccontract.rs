//! Command-layer contract tests
//!
//! This layer covers the functions the frontend actually reaches through
//! `invoke()` — not the taskops / com / taskdef helpers they delegate to.
//! Earlier tests bypassed the command layer entirely, so the meaning and the
//! value domains of its fields went untested. That is exactly where bugs
//! slipped through:
//!
//!   - `path` returned the full task path instead of the folder path, so the
//!     tree could never be built
//!   - the `runLevel` value domain disagreed with the frontend contract
//!   - the details page assembled its fields incompletely
//!
//! Why not `tauri::test::mock_builder()`: the official MockRuntime approach
//! makes the test binary exit with STATUS_ENTRYPOINT_NOT_FOUND here (the DLL
//! linkage the tauri test feature pulls in does not resolve on this machine).
//! We call the command functions directly instead: the IPC serialization step
//! is skipped, but every behaviour and return shape is still exercised, and
//! serialization is covered by the two cases below (JS payload -> command
//! input, and frontend/backend command-name alignment).

use serde_json::{json, Value};

use tockola_lib::tasks::{
    create_folder, delete_folder, delete_task, get_task, get_task_capability, get_task_config,
    get_task_section, list_folders, list_tasks, probe_run_times, rename_folder, run_task,
    save_task, set_task_enabled, update_task_info, ProbeRunTimesInput, SaveTaskInput,
    UpdateTaskInfoInput,
};

/// Cases that touch the real task library all run under this sandbox root
/// folder, to keep the user's own tasks clean.
const SANDBOX: &str = "\\__TSTestRoot__\\IPC\\";

// Cases that touch tasks each use their own sandbox: c7 calls
// delete_folder(SANDBOX) and prunes the whole branch, so never build a task
// under someone else's feet when tests run concurrently. (Seen once: c6 had
// just saved when c7 wiped it, and the error was "task not found 0x80070002"
// — that looked like a broken save but was really tests colliding.)
fn sandbox(tag: &str) -> String {
    format!("\\__TSTestRoot__\\IPC_{tag}\\")
}

fn block<F: std::future::Future>(f: F) -> F::Output {
    tauri::async_runtime::block_on(f)
}

/// Every task in the list must carry these keys; one missing shows up in the
/// UI as blank or `undefined`.
const ITEM_KEYS: &[&str] = &[
    "name",
    "path",
    "state",
    "enabled",
    "author",
    "description",
    "command",
    "nextRun",
    "lastRun",
    "lastResult",
    "triggers",
];

// ---------------------------------------------------------------------------
// Frontend/backend contract: command names and payload shapes

/// Collect every literal `invoke("...")` command name under the frontend src
/// tree. Only scanning api.js produced false positives once locale and close
/// behavior moved into their own modules, so walk the whole directory instead.
fn collect_frontend_invokes(dir: &std::path::Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_frontend_invokes(&path, out);
            continue;
        }
        let is_source = matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("js") | Some("svelte") | Some("ts")
        );
        if !is_source {
            continue;
        }
        let Ok(src) = std::fs::read_to_string(&path) else {
            continue;
        };
        for (i, _) in src.match_indices("invoke(") {
            let rest = src[i + "invoke(".len()..].trim_start();
            let quote = match rest.as_bytes().first() {
                Some(b'"') => b'"',
                Some(b'\'') => b'\'',
                _ => continue,
            };
            if let Some(end) = rest[1..].find(quote as char) {
                out.push(rest[1..1 + end].to_string());
            }
        }
    }
}

#[test]
fn c0_command_names_match_frontend() {
    // The command names the frontend calls have to match the ones registered
    // here. If one side renames and the other does not follow, all you get at
    // runtime is a vague "command not found" that is hard to trace.
    // `cargo test` usually runs from src-tauri, but may run from the repo root.
    // Require lib/api.js inside the candidate so src-tauri/src (Rust sources)
    // is never mistaken for the frontend tree.
    let mut src_root = None;
    for p in ["../src", "src", "../../src"] {
        let candidate = std::path::Path::new(p);
        if candidate.join("lib/api.js").is_file() {
            src_root = Some(candidate);
            break;
        }
    }
    let src_root = src_root.unwrap_or_else(|| {
        panic!(
            "cannot find the frontend src/ directory (cwd {:?})",
            std::env::current_dir()
        )
    });

    let mut called: Vec<String> = Vec::new();
    collect_frontend_invokes(src_root, &mut called);
    called.sort();
    called.dedup();
    assert!(
        !called.is_empty(),
        "no command name was parsed out of the frontend src/ tree"
    );

    // Registered commands are read out of lib.rs rather than copied into this
    // list. A hand-maintained copy goes stale the moment a command is added —
    // `export_tasks_xml` was registered in lib.rs, called from api.js, and this
    // test still failed on it, because the third copy here was the one nobody
    // remembered. The registry is the source; this is only the reader.
    let mut lib = None;
    for p in [
        "src/lib.rs",
        "../src-tauri/src/lib.rs",
        "src-tauri/src/lib.rs",
        "../../src-tauri/src/lib.rs",
    ] {
        if let Ok(s) = std::fs::read_to_string(p) {
            lib = Some(s);
            break;
        }
    }
    let lib = lib.unwrap_or_else(|| {
        panic!(
            "cannot read src-tauri/src/lib.rs (cwd {:?})",
            std::env::current_dir()
        )
    });

    let Some(open) = lib.find("generate_handler![") else {
        panic!("no generate_handler! in lib.rs — has the app entry point moved?");
    };
    let body = &lib[open + "generate_handler![".len()..];
    let Some(close) = body.find("])") else {
        panic!("unterminated generate_handler! in lib.rs");
    };
    let registered: Vec<&str> = body[..close]
        .split(',')
        .filter_map(|entry| entry.trim().rsplit("::").next())
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .collect();
    assert!(
        registered.len() > 10,
        "only parsed {} commands out of lib.rs — the handler format changed",
        registered.len()
    );

    let unused: Vec<&str> = registered
        .iter()
        .filter(|r| !called.contains(&r.to_string()))
        .copied()
        .collect();
    assert!(
        unused.is_empty(),
        "commands registered but never called by the frontend (rename drift?): {unused:?}"
    );

    let unknown: Vec<&String> = called.iter().filter(|c| !registered.contains(&c.as_str())).collect();
    assert!(
        unknown.is_empty(),
        "the frontend calls a command that does not exist: {unknown:?}"
    );
}

//// The payload from the frontend must deserialize into the command input.
//// If the camelCase-to-field mapping breaks, the UI just looks like
/// "saving does nothing".
#[test]
fn c0b_frontend_payload_deserializes() {
    let cfg = sandbox_config();

    let save: SaveTaskInput = serde_json::from_value(json!({
        "name": "x", "path": SANDBOX, "originalName": "", "originalPath": "",
        "config": cfg
    }))
    .expect("SaveTaskInput failed to deserialize");
    assert_eq!(save.name, "x");
    assert!(save.config.is_object());

    let upd: UpdateTaskInfoInput = serde_json::from_value(json!({
        "name": "x", "path": SANDBOX,
        "author": "a", "description": "d"
    }))
    .expect("UpdateTaskInfoInput failed to deserialize");
    assert_eq!(upd.author, "a");
    assert_eq!(upd.description, "d");

    let probe: ProbeRunTimesInput = serde_json::from_value(json!({
        "name": "x", "count": 3, "config": cfg
    }))
    .expect("ProbeRunTimesInput failed to deserialize");
    assert_eq!(probe.count, 3);
}

// ---------------------------------------------------------------------------
// Read-path contracts

#[test]
fn c1_list_tasks_shape_and_path_semantics() {
    let list = block(list_tasks()).expect("list_tasks should succeed");
    for item in &list {
        for k in ITEM_KEYS {
            assert!(
                item.get(k).is_some(),
                "list item is missing field {k}: {}",
                item.get("name").and_then(|v| v.as_str()).unwrap_or("?")
            );
        }
        // path must be a **folder path**: it starts and ends with a backslash.
        // It once returned the full task path (\folder\task), and the tree could
// never be built again.
        let path = item["path"].as_str().unwrap_or("");
        assert!(
            path.starts_with('\\') && path.ends_with('\\'),
            "path must be a folder path (backslash at both ends), got {path:?}"
        );
    }
}

#[test]
fn c2_get_task_returns_detail_contract() {
    let list = block(list_tasks()).expect("list_tasks should succeed");
    let Some(first) = list.first() else {
        eprintln!("no task on this machine, skipping");
        return;
    };
    let name = first["name"].as_str().unwrap_or("").to_string();
    let path = first["path"].as_str().unwrap_or("\\").to_string();

    let got = block(get_task(name.clone(), path.clone())).expect("get_task should succeed");

    // The details page does `data = detail ?? task` and treats the list row and
    // the detail as one object, so list fields must sit flat at the top level,
    // alongside `config` / `xml`.
    for k in ITEM_KEYS {
        assert!(got.get(k).is_some(), "get_task is missing {k} at the top level");
    }
    for k in ["config", "xml"] {
        assert!(got.get(k).is_some(), "get_task response is missing {k}");
    }
    assert!(
        got["xml"].as_str().unwrap_or("").contains("<Task"),
        "the xml field should be a task definition XML document"
    );

    // The config shape has to match what the frontend TaskEditor expects.
    let cfg = &got["config"];
    for k in ["registration", "principal", "settings", "triggers", "actions"] {
        assert!(cfg.get(k).is_some(), "config is missing section {k}");
    }
    assert!(cfg["triggers"].is_array(), "triggers must be an array");
    assert!(cfg["actions"].is_array(), "actions must be an array");
}

#[test]
fn c3_principal_runlevel_domain() {
    let list = block(list_tasks()).expect("list_tasks should succeed");

    for item in list.iter().take(30) {
        let name = item["name"].as_str().unwrap_or("").to_string();
        let path = item["path"].as_str().unwrap_or("\\").to_string();
        let Ok(cfg) = block(get_task_config(name, path)) else {
            continue;
        };
        let rl = cfg["principal"]["runLevel"].as_str().unwrap_or("");
        assert!(
            rl == "HighestAvailable" || rl == "LeastPrivilege",
            "runLevel has an unexpected value domain: {rl:?}"
        );
    }
}

#[test]
fn c4_sections_return_expected_shape() {
    let list = block(list_tasks()).expect("list_tasks should succeed");
    let Some(first) = list.first() else {
        return;
    };
    let name = first["name"].as_str().unwrap_or("").to_string();
    let path = first["path"].as_str().unwrap_or("\\").to_string();

    let reg = block(get_task_section(
        name.clone(),
        path.clone(),
        "registration".to_string(),
    ))
    .expect("the registration section should resolve");
    assert!(reg.is_object(), "registration should be an object, got {reg}");
    for k in ["name", "path", "author", "description"] {
        assert!(reg.get(k).is_some(), "registration is missing {k}");
    }

    for sec in ["triggers", "actions"] {
        let got =
            block(get_task_section(name.clone(), path.clone(), sec.to_string())).expect(sec);
        assert!(got.is_array(), "{sec} should be an array, got {got}");
    }
    for sec in ["settings", "principal"] {
        let got =
            block(get_task_section(name.clone(), path.clone(), sec.to_string())).expect(sec);
        assert!(got.is_object(), "{sec} should be an object, got {got}");
    }
}

#[test]
fn c5_capability_contract() {
    let cap = block(get_task_capability()).expect("the capability probe should succeed");
    assert!(
        cap.get("supported").map(|v| v.is_object()) == Some(true),
        "capability.supported should be an object, got {cap}"
    );
    assert!(
        cap.get("maxVersion").is_some(),
        "capability is missing maxVersion: {cap}"
    );
}

// ---------------------------------------------------------------------------
// Write-path contracts: everything happens under the sandbox folder.

fn sandbox_config() -> Value {
    let d = tockola_lib::runtimes::tomorrow();
    json!({
        "registration": {
            "author": "ipc-contract", "description": "contract test",
            "securityDescriptor": "", "source": "", "version": "", "documentation": ""
        },
        "principal": { "userId": "", "groupId": "", "logonType": "InteractiveToken", "runLevel": "LeastPrivilege" },
        "settings": {
            "enabled": true, "allowStartOnDemand": true, "runOnlyIfIdle": false,
            "idleDuration": "PT10M", "waitTimeout": "PT1H", "stopOnIdleEnd": false, "restartOnIdle": false,
            "allowHardTerminate": true, "startWhenAvailable": true, "runOnlyIfNetworkAvailable": false,
            "networkId": "", "networkName": "", "disallowStartIfOnBatteries": false, "stopIfGoingOnBatteries": false,
            "wakeToRun": false, "executionTimeLimit": "PT2H", "multipleInstancesPolicy": "IgnoreNew",
            "restartCount": 0, "restartInterval": "PT1H", "deleteExpiredTaskAfter": "PT0S",
            "hidden": false, "priority": 7, "xmlVersion": "1.2", "useUnifiedSchedulingEngine": false,
            "disallowStartOnRemoteAppSession": false, "volatile": false, "maintenanceEnabled": false,
            "maintenancePeriod": "P1D", "maintenanceDeadline": "P2D", "maintenanceExclusive": false
        },
        "actions": [{ "type": "exec", "command": "cmd.exe", "arguments": "/c exit 0", "workingDirectory": "C:\\Windows" }],
        "triggers": [{
            "type": "daily", "enabled": true, "start": format!("{d}T09:00:00"), "end": "",
            "randomDelay": "PT0S", "executionTimeLimit": "PT0S",
            "repetition": { "interval": "PT0S", "duration": "PT0S", "stopAtDurationEnd": false },
            "daysInterval": 1, "weeksInterval": 1, "daysOfWeek": [], "daysOfMonth": [],
            "months": [], "monthWeek": 0, "delay": "PT0S", "stateChange": "ConsoleConnect",
            "userId": "", "eventLog": "", "eventSource": "", "eventId": ""
        }]
    })
}

#[test]
fn c6_save_then_read_roundtrip_in_sandbox() {
    let sb = sandbox("c6");
    let _ = block(create_folder(sb.clone()));
    let name = "__ipc_rt__";

    block(save_task(SaveTaskInput {
        name: name.to_string(),
        path: sb.clone(),
        original_name: String::new(),
        original_path: String::new(),
        config: sandbox_config(),
    }))
    .expect("save should succeed");

    let cfg = block(get_task_config(name.to_string(), sb.clone())).expect("should read back after save");

    assert_eq!(cfg["registration"]["author"], "ipc-contract");
    assert_eq!(cfg["principal"]["runLevel"], "LeastPrivilege");
    assert_eq!(cfg["settings"]["executionTimeLimit"], "PT2H");
    assert_eq!(cfg["triggers"][0]["type"], "daily");
    assert_eq!(cfg["actions"][0]["command"], "cmd.exe");

    // After saving it has to appear in the list, with path being a folder path.
    let list = block(list_tasks()).expect("list_tasks should succeed");
    let hit = list
        .iter()
        .find(|t| t["name"] == name)
        .unwrap_or_else(|| panic!("the saved task never showed up in the list"));
    assert_eq!(hit["path"], sb, "path in a list row must be a folder path");

    let _ = block(delete_task(name.to_string(), sb.clone()));
    let _ = block(delete_folder(sb));
}

#[test]
fn c7_folder_commands_contract() {
    // Every operation stays inside the sandbox: leaving junk under the root would
    // pollute the user's real task library, and leftovers make the next run fail
// for no visible reason ("folder already exists").
    let _ = block(delete_folder(SANDBOX.to_string()));
    block(create_folder(SANDBOX.to_string())).expect("creating the folder should succeed");

    let folders = block(list_folders()).expect("listing folders should succeed");
    assert!(
        folders.iter().any(|f| f == SANDBOX),
        "the new folder is missing from the listing: {folders:?}"
    );

    // Renaming happens inside the sandbox so no stray folder is left at the root.
    let sub = format!("{SANDBOX}sub\\");
    let sub2 = format!("{SANDBOX}sub2\\");
    block(create_folder(sub.clone())).expect("creating the sub folder should succeed");
    block(rename_folder(sub.clone(), "sub2".to_string())).expect("renaming should succeed");

    let folders = block(list_folders()).expect("listing folders should succeed");
    assert!(
        folders.iter().any(|f| f == &sub2),
        "the renamed folder did not appear: {folders:?}"
    );
    assert!(
        !folders.iter().any(|f| f == &sub),
        "the old name must be gone after the rename: {folders:?}"
    );

    let _ = block(delete_folder(SANDBOX.to_string()));
    let folders = block(list_folders()).expect("listing folders should succeed");
    assert!(
        !folders.iter().any(|f| f.starts_with(SANDBOX)),
        "nothing should remain after the sandbox was deleted: {folders:?}"
    );
}

#[test]
fn c8_probe_run_times_contract() {
    let got = block(probe_run_times(ProbeRunTimesInput {
        name: String::new(),
        count: 3,
        config: sandbox_config(),
    }))
    .expect("the probe should succeed");
    assert_eq!(got.len(), 3, "expected 3 run times, got {got:?}");
    for s in &got {
        assert!(s.ends_with("09:00:00"), "run time should land on 09:00, got {got:?}");
    }
}

#[test]
fn c9_unknown_section_fails_cleanly() {
    // The message does not matter here; what matters is that it fails cleanly.
    // A panic takes the whole COM worker thread down with it and every later
    // command fails too — that is where "failed to read all task info" comes from.
    let err = block(get_task_section(
        "any".to_string(),
        "\\".to_string(),
        "no-such-section".to_string(),
    ));
    assert!(err.is_err(), "an unknown section should fail, not succeed");
}

#[test]
fn c10_missing_task_fails_cleanly() {
    // Same idea: a missing task must return Err, never panic.
    let err = block(get_task(
        "__definitely_not_here__".to_string(),
        SANDBOX.to_string(),
    ));
    assert!(err.is_err(), "a missing task should return an error");

    // And the command layer keeps working afterwards — the worker thread survived.
    let list = block(list_tasks()).expect("list_tasks must still work after a failure");
    assert!(list.iter().all(|v| v.is_object()), "every list item should be an object");
    let _ = block(run_task("__definitely_not_here__".to_string(), SANDBOX.to_string()));
    let _ = block(set_task_enabled(
        "__definitely_not_here__".to_string(),
        SANDBOX.to_string(),
        true,
    ));
    let list2 = block(list_tasks()).expect("list_tasks must still work after repeated failures");
    assert!(list2.iter().all(|v| v.is_object()), "every list item should be an object");
    // The two counts are deliberately not compared: built-in tasks (Edge, Google
    // Update, ...) register and unregister at will — a real run went 266 -> 263
    // between two calls, so asserting equality only buys flakiness. What is under
    // test is that the command layer survived, not the number of rows.
    assert!(!list2.is_empty(), "the list must not be empty after repeated failures");
}

#[test]
fn c11_update_task_info_roundtrip_in_sandbox() {
    let sb = sandbox("c11");
    let _ = block(create_folder(sb.clone()));
    let name = "__ipc_upd__";

    block(save_task(SaveTaskInput {
        name: name.to_string(),
        path: sb.clone(),
        original_name: String::new(),
        original_path: String::new(),
        config: sandbox_config(),
    }))
    .expect("creating the task should succeed");

    block(update_task_info(UpdateTaskInfoInput {
        name: name.to_string(),
        path: sb.clone(),
        author: "edited author".to_string(),
        description: "edited description".to_string(),
        original_name: String::new(),
        original_path: String::new(),
    }))
    .expect("updating the info should succeed");

    let cfg = block(get_task_config(name.to_string(), sb.clone())).expect("read back");
    assert_eq!(cfg["registration"]["author"], "edited author");
    assert_eq!(cfg["registration"]["description"], "edited description");

    let _ = block(delete_task(name.to_string(), sb.clone()));
    let _ = block(delete_folder(sb));
}
