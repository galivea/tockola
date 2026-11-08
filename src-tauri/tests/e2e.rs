//! End-to-end contract tests
//!
//! # Why this layer exists
//! Unit tests prove a function runs as written; they cannot prove the UI works.
//! All three production bugs in the previous release came from here:
//!   · list rows reported `path` as the full task path instead of the containing
//!     folder, so every task became its own folder in the tree and opening
//!     details found nothing ("failed to read all task info")
//!   · `get_task` wrapped the list row in `item` while details read it as a flat
//!     object — the whole page went blank
//!   · `runLevel` returned `Highest` while the UI only accepts
//!     `HighestAvailable` — saving silently downgraded it
//! None of these were logic errors; they were **contract errors between the UI
//! and the backend**. This layer pins the contract:
//! every case drives a full command chain against a real Windows task, then
//! checks the exact fields the UI reads.
//!
//! # Case layout
//!   t1~t4  contract: fields present, types correct, enum values known to the UI
//!   t5~t8  round trip: create / read / update / delete, plus read-back after save
//!   t9     walk every real task on this machine through the details path
//!   t10    a new task starts with no trigger, and reads back the same

#![cfg(target_os = "windows")]

use serde_json::{json, Value};

/// Folder reserved for tests: every case builds tasks here to keep the real
/// task library clean.
const HOME: &str = "\\__TSTestRoot__\\E2E\\";

fn uniq(tag: &str) -> String {
    format!("{tag}_{}", std::process::id())
}

/// The value sets behind the UI dropdowns. Every enum the backend returns must
/// appear here, or the UI renders blank or "unknown" — the missing runLevel
/// assertion was exactly that bug.
const RUN_LEVELS: [&str; 2] = ["LeastPrivilege", "HighestAvailable"];
const LOGON_TYPES: [&str; 7] = [
    "InteractiveToken",
    "S4U",
    "Password",
    "ServiceAccount",
    "Group",
    "InteractiveTokenOrPassword",
    "None",
];
const INSTANCES: [&str; 4] = ["IgnoreNew", "Parallel", "Queue", "StopExisting"];
const SESSION_STATES: [&str; 6] = [
    "ConsoleConnect",
    "ConsoleDisconnect",
    "RemoteConnect",
    "RemoteDisconnect",
    "SessionLock",
    "SessionUnlock",
];
const TRIGGER_KINDS: [&str; 11] = [
    "once",
    "daily",
    "weekly",
    "monthly",
    "monthlyDow",
    "logon",
    "boot",
    "idle",
    "registration",
    "sessionStateChange",
    "event",
];
const STATES: [&str; 5] = ["Ready", "Running", "Disabled", "Queued", "Unknown"];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// One config covering every field kind: weekly trigger + repetition + retry
/// policy + highest privileges + action.
fn fixture() -> Value {
    let d = tockola_lib::runtimes::tomorrow();
    json!({
        "registration": {
            "author": "e2e", "description": "e2e fixture",
            "securityDescriptor": "", "source": "", "version": "", "documentation": ""
        },
        "principal": {
            "userId": "", "groupId": "",
            "logonType": "InteractiveToken", "runLevel": "HighestAvailable"
        },
        "settings": {
            "enabled": true, "allowStartOnDemand": true, "runOnlyIfIdle": false,
            "idleDuration": "PT10M", "waitTimeout": "PT1H",
            "stopOnIdleEnd": false, "restartOnIdle": false,
            "allowHardTerminate": true, "startWhenAvailable": true,
            "runOnlyIfNetworkAvailable": false, "networkId": "", "networkName": "",
            "disallowStartIfOnBatteries": false, "stopIfGoingOnBatteries": false,
            "wakeToRun": false, "executionTimeLimit": "PT2H",
            "multipleInstancesPolicy": "IgnoreNew",
            "restartCount": 3, "restartInterval": "PT15M",
            "deleteExpiredTaskAfter": "PT0S", "hidden": false, "priority": 7,
            "xmlVersion": "1.2", "useUnifiedSchedulingEngine": false,
            "disallowStartOnRemoteAppSession": false, "volatile": false,
            "maintenanceEnabled": false, "maintenancePeriod": "P1D",
            "maintenanceDeadline": "P2D", "maintenanceExclusive": false
        },
        "actions": [{
            "type": "exec", "command": "cmd.exe",
            "arguments": "/c exit 0", "workingDirectory": "C:\\Windows"
        }],
        "triggers": [{
            "type": "weekly", "enabled": true,
            "start": format!("{d}T09:00:00"), "end": "",
            "randomDelay": "PT0S", "executionTimeLimit": "PT0S",
            "repetition": { "interval": "PT30M", "duration": "PT2H", "stopAtDurationEnd": false },
            "daysInterval": 1, "weeksInterval": 2, "daysOfWeek": [2, 8],
            "daysOfMonth": [], "months": [], "monthWeek": 0,
            "delay": "PT0S", "stateChange": "ConsoleConnect",
            "userId": "", "eventLog": "", "eventSource": "", "eventId": ""
        }]
    })
}

fn create(name: &str, cfg: &Value) {
    let input = json!({
        "name": name, "path": HOME,
        "originalName": "", "originalPath": "",
        "config": cfg
    });
    tockola_lib::taskops::save(&input).unwrap_or_else(|e| panic!("failed to create temporary task {name}: {e}"));
}

fn remove(name: &str) {
    let _ = tockola_lib::com::delete_task(&name.to_string(), &HOME.to_string());
}

//// Create a task, run `f`, delete it either way. Cases must not leave garbage
/// behind for each other.
fn with_task<F: FnOnce(&str)>(tag: &str, cfg: &Value, f: F) {
    let name = uniq(tag);
    // A previously aborted case may have left a task with the same name; clear it
// first.
    remove(&name);
    create(&name, cfg);
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&name)));
    remove(&name);
    if let Err(e) = outcome {
        std::panic::resume_unwind(e);
    }
}

fn find_row(name: &str) -> Option<Value> {
    tockola_lib::taskops::list_all()
        .ok()?
        .into_iter()
        .find(|r| r.get("name").and_then(|v| v.as_str()) == Some(name))
}

fn is_date(s: &str) -> bool {
    // The UI renders `YYYY-MM-DD HH:MM`; an empty string means "none".
    if s.is_empty() {
        return true;
    }
    let b = s.as_bytes();
    s.len() == 16 && b[4] == b'-' && b[7] == b'-' && b[10] == b' ' && b[13] == b':'
}

// ---------------------------------------------------------------------------
// t1 - list row contract: are the fields there, are the types right
// ---------------------------------------------------------------------------

#[test]
fn t1_list_row_contract() {
    with_task("t1", &fixture(), |name| {
        let row = find_row(name).unwrap_or_else(|| panic!("newly created task {name} is missing from the list"));

        // Every row must carry these fields; one missing means one missing column.
        for k in [
            "name",
            "path",
            "state",
            "enabled",
            "author",
            "description",
            "command",
            "execute",
            "arguments",
            "workingDir",
            "nextRun",
            "lastRun",
            "lastResult",
            "triggers",
        ] {
            assert!(row.get(k).is_some(), "list row is missing field {k}: {row}");
        }

        // path must be the **containing folder**: trailing backslash, no task name.
        // This was the root cause of "failed to read all task info": given a full
        // task path, buildTaskTree turns every task into a folder.
        let path = row["path"].as_str().unwrap_or_default();
        assert!(
            path.ends_with('\\'),
            "path must be a folder path (ending in a backslash), got {path}"
        );
        assert_eq!(path, HOME, "path should be the task folder {HOME}, got {path}");
        assert!(
            !path.contains(name),
            "path must not contain the task name: {path} / {name}"
        );

        assert!(row["enabled"].is_boolean(), "enabled must be a boolean: {row}");
        assert!(
            STATES.contains(&row["state"].as_str().unwrap_or("")),
            "state must be a value the UI recognises, got {}",
            row["state"]
        );
        assert!(row["triggers"].is_array(), "triggers must be an array: {row}");
        assert!(
            is_date(row["nextRun"].as_str().unwrap_or("x")),
            "nextRun should look like `YYYY-MM-DD HH:MM` or be empty, got {:?}",
            row["nextRun"]
        );
        assert!(
            is_date(row["lastRun"].as_str().unwrap_or("x")),
            "lastRun should look like `YYYY-MM-DD HH:MM` or be empty, got {:?}",
            row["lastRun"]
        );
        assert_eq!(row["author"].as_str().unwrap_or(""), "e2e");
    });
}

// ---------------------------------------------------------------------------
// t2 - the details object must have the same shape as a list row
// ---------------------------------------------------------------------------

#[test]
fn t2_detail_is_flat() {
    with_task("t2", &fixture(), |name| {
        let detail = tockola_lib::taskops::get_task(name, HOME)
            .unwrap_or_else(|e| panic!("failed to read task details: {e}"));

        // The details page does `data = detail ?? task` and uses both as one object.
        // So list fields must sit flat at the top level — nesting them under `item`
// renders the page as "--".
        for k in ["name", "path", "state", "enabled", "command"] {
            assert!(
                detail.get(k).is_some(),
                "details is missing {k} at the top level (nested under `item`?): {detail}"
            );
        }
        assert!(detail.get("config").is_some(), "details missing config");
        assert!(detail.get("xml").is_some(), "details missing xml");

        assert_eq!(detail["name"].as_str().unwrap_or(""), name);
        assert_eq!(detail["path"].as_str().unwrap_or(""), HOME);
        assert!(detail["config"]["triggers"].is_array(), "config.triggers missing");

        // The xml has to be directly displayable and exportable by the UI.
        let xml = detail["xml"].as_str().unwrap_or("");
        assert!(xml.starts_with("<?xml"), "xml is not a complete task definition: {xml:.80}");
    });
}

// ---------------------------------------------------------------------------
// t3 - enum values must be among the UI options
// ---------------------------------------------------------------------------

#[test]
fn t3_enum_values_match_ui_options() {
    with_task("t3", &fixture(), |name| {
        let cfg = tockola_lib::taskops::config(name, HOME).expect("failed to read config");

        let rl = cfg["principal"]["runLevel"].as_str().unwrap_or("<empty>");
        assert!(
            RUN_LEVELS.contains(&rl),
            "runLevel must be one of the UI RUN_LEVELS (UI expects HighestAvailable), got {rl}"
        );
        // The fixture explicitly asked for highest privileges, so reading it back
// must still say highest privileges.
        assert_eq!(rl, "HighestAvailable", "highest privileges were downgraded on save: {rl}");

        let lt = cfg["principal"]["logonType"].as_str().unwrap_or("<empty>");
        assert!(
            LOGON_TYPES.contains(&lt),
            "logonType must be one of the UI LOGON_TYPES, got {lt}"
        );

        let mi = cfg["settings"]["multipleInstancesPolicy"].as_str().unwrap_or("<empty>");
        assert!(
            INSTANCES.contains(&mi),
            "multipleInstancesPolicy must be a UI option, got {mi}"
        );

        for t in cfg["triggers"].as_array().unwrap_or(&vec![]) {
            let ty = t["type"].as_str().unwrap_or("<empty>");
            assert!(
                TRIGGER_KINDS.contains(&ty),
                "trigger type must be one of the UI TRIGGER_TYPES, got {ty}"
            );
            let sc = t["stateChange"].as_str().unwrap_or("<empty>");
            assert!(
                SESSION_STATES.contains(&sc),
                "stateChange must be a UI option, got {sc}"
            );
            assert!(t["enabled"].is_boolean(), "trigger enabled must be a boolean: {t}");
            assert!(t["repetition"].is_object(), "trigger is missing repetition: {t}");
        }

        for a in cfg["actions"].as_array().unwrap_or(&vec![]) {
            assert!(
                a["type"].as_str() == Some("exec") || a["type"].as_str() == Some("com"),
                "action type: the UI only knows exec / com, got {a}"
            );
        }
    });
}

// ---------------------------------------------------------------------------
// t4 - all five sections must resolve; registration.path is a folder too
// ---------------------------------------------------------------------------

#[test]
fn t4_sections() {
    with_task("t4", &fixture(), |name| {
        let reg = tockola_lib::taskops::section(name, HOME, "registration").expect("failed to read the registration section");
        for k in ["name", "path", "author", "description", "unsupported"] {
            assert!(reg.get(k).is_some(), "registration section is missing {k}: {reg}");
        }
        assert_eq!(reg["path"].as_str().unwrap_or(""), HOME);
        assert!(reg["unsupported"].is_array(), "unsupported must be an array");

        let trg = tockola_lib::taskops::section(name, HOME, "triggers").expect("failed to read the triggers section");
        assert!(trg.is_array() && !trg.as_array().unwrap().is_empty(), "triggers section is empty");

        let act = tockola_lib::taskops::section(name, HOME, "actions").expect("failed to read the actions section");
        assert!(act.is_array() && !act.as_array().unwrap().is_empty(), "actions section is empty");

        let st = tockola_lib::taskops::section(name, HOME, "settings").expect("failed to read the settings section");
        assert!(st.get("enabled").is_some(), "settings section is missing enabled: {st}");

        let pr = tockola_lib::taskops::section(name, HOME, "principal").expect("failed to read the principal section");
        assert!(pr.get("runLevel").is_some(), "principal section is missing runLevel: {pr}");

        // An unknown section must fail rather than silently return nothing.
        assert!(
            tockola_lib::taskops::section(name, HOME, "nope").is_err(),
            "an unknown section should fail"
        );
    });
}

// ---------------------------------------------------------------------------
// t5 - read back after save (round-trip consistency)
// ---------------------------------------------------------------------------

#[test]
fn t5_save_then_read_roundtrip() {
    with_task("t5", &fixture(), |name| {
        let got = tockola_lib::taskops::config(name, HOME).expect("failed to read config");
        let want = fixture();

        assert_eq!(
            got["registration"]["author"], want["registration"]["author"],
            "author did not persist"
        );
        assert_eq!(
            got["registration"]["description"], want["registration"]["description"],
            "description did not persist"
        );

        for k in [
            "enabled",
            "allowStartOnDemand",
            "allowHardTerminate",
            "startWhenAvailable",
            "runOnlyIfIdle",
            "wakeToRun",
            "hidden",
            "stopOnIdleEnd",
            "restartOnIdle",
            "disallowStartIfOnBatteries",
            "stopIfGoingOnBatteries",
        ] {
            assert_eq!(
                got["settings"][k], want["settings"][k],
                "setting {k} did not round trip"
            );
        }
        assert_eq!(
            got["settings"]["executionTimeLimit"], want["settings"]["executionTimeLimit"],
            "execution time limit did not round trip"
        );
        assert_eq!(
            got["settings"]["restartCount"], want["settings"]["restartCount"],
            "retry count did not round trip"
        );
        assert_eq!(
            got["settings"]["restartInterval"], want["settings"]["restartInterval"],
            "retry interval did not round trip"
        );
        assert_eq!(
            got["settings"]["priority"], want["settings"]["priority"],
            "priority did not round trip"
        );
        assert_eq!(
            got["settings"]["multipleInstancesPolicy"], want["settings"]["multipleInstancesPolicy"],
            "multiple instances policy did not round trip"
        );

        assert_eq!(got["actions"][0]["command"], "cmd.exe", "action did not persist");
        assert_eq!(got["actions"][0]["arguments"], "/c exit 0");
        assert_eq!(got["actions"][0]["workingDirectory"], "C:\\Windows");

        let t = &got["triggers"][0];
        assert_eq!(t["type"], "weekly", "trigger type did not round trip");
        assert_eq!(t["enabled"], true, "trigger enabled flag did not round trip");
        assert_eq!(t["weeksInterval"], 2, "weeks interval did not round trip");
        assert_eq!(t["daysOfWeek"], json!([2, 8]), "weekday bit mask did not round trip");
        assert_eq!(t["repetition"]["interval"], "PT30M", "repetition interval did not round trip");
        assert_eq!(t["repetition"]["duration"], "PT2H", "repetition duration did not round trip");
    });
}

// ---------------------------------------------------------------------------
// t6 - full lifecycle: create -> rename -> update info -> disable -> enable
//      -> delete
// ---------------------------------------------------------------------------

#[test]
fn t6_lifecycle() {
    let src = uniq("t6a");
    let dst = uniq("t6b");
    remove(&src);
    remove(&dst);

    create(&src, &fixture());

    // Rename plus move: goes through save.
    let input = json!({
        "name": dst, "path": HOME,
        "originalName": src, "originalPath": HOME,
        "config": fixture()
    });
    tockola_lib::taskops::save(&input).expect("failed to rename");

    assert!(
        find_row(&src).is_none(),
        "the old task {src} still exists after rename"
    );
    assert!(find_row(&dst).is_some(), "cannot find the new task {dst} after rename");

    // Update registration info only: triggers and settings must survive untouched.
    let before = tockola_lib::taskops::config(&dst, HOME).expect("failed to read config");
    let info = json!({
        "name": dst, "path": HOME,
        "originalName": dst, "originalPath": HOME,
        "author": "updated", "description": "only these two changed"
    });
    tockola_lib::taskops::update_info(&info).expect("failed to update registration info");
    let after = tockola_lib::taskops::config(&dst, HOME).expect("failed to read config");

    assert_eq!(
        after["registration"]["author"].as_str().unwrap_or(""),
        "updated",
        "author was not updated"
    );
    assert_eq!(
        after["registration"]["description"].as_str().unwrap_or(""),
        "only these two changed",
        "description was not updated"
    );
    assert_eq!(
        after["triggers"], before["triggers"],
        "updating registration info changed the triggers"
    );
    assert_eq!(
        after["settings"], before["settings"],
        "updating registration info changed the settings"
    );

    // Disable / enable: the list row has to follow.
    tockola_lib::com::set_task_enabled(&dst, &HOME.to_string(), false).expect("disable failed");
    let row = find_row(&dst).expect("the disabled task should still be listed");
    assert_eq!(row["enabled"], false, "row still reads enabled after disable");
    assert_eq!(row["state"], "Disabled", "state should be Disabled after disable");

    tockola_lib::com::set_task_enabled(&dst, &HOME.to_string(), true).expect("enable failed");
    let row = find_row(&dst).expect("the enabled task should be listed");
    assert_eq!(row["enabled"], true, "row still reads disabled after enable");

    // Delete
    tockola_lib::com::delete_task(&dst, &HOME.to_string()).expect("delete failed");
    assert!(find_row(&dst).is_none(), "task still exists after delete");
}

// ---------------------------------------------------------------------------
// t7 - folder CRUD, and the list/tree must reflect it immediately
// ---------------------------------------------------------------------------

#[test]
fn t7_folder_crud() {
    let base = format!("{HOME}{}_sub", std::process::id());
    let _ = tockola_lib::com::delete_folder(&base);

    tockola_lib::com::create_folder(&base).expect("failed to create the folder");
    let folders = tockola_lib::com::list_folders().expect("failed to list folders");
    assert!(
        folders.iter().any(|f| f == &format!("{base}\\") || f == &base),
        "folder {base} is missing from the listing after create"
    );

    // Put a task inside the folder; the row path must land in that folder.
    let name = uniq("t7");
    let input = json!({
        "name": name, "path": format!("{base}\\"),
        "originalName": "", "originalPath": "", "config": fixture()
    });
    tockola_lib::taskops::save(&input).expect("failed to create the task in the sub-folder");
    let row = find_row(&name).expect("the task in the sub-folder never reached the list");
    assert_eq!(
        row["path"].as_str().unwrap_or(""),
        format!("{base}\\"),
        "sub-folder task has the wrong path: {row}"
    );

    let renamed = format!("{HOME}{}_renamed", std::process::id());
    let _ = tockola_lib::com::delete_folder(&renamed);
    tockola_lib::com::rename_folder(&base, &format!("{}_renamed", std::process::id()))
        .expect("failed to rename the folder");
    let row = find_row(&name).expect("task disappeared after the rename");
    assert_eq!(
        row["path"].as_str().unwrap_or(""),
        format!("{renamed}\\"),
        "after a folder rename the task path did not follow: {row}"
    );

    let _ = tockola_lib::com::delete_folder(&renamed);
    assert!(find_row(&name).is_none(), "task still exists after the folder was deleted");
}

// ---------------------------------------------------------------------------
// t8 - capability probe: complete structure, directly usable by the UI
// ---------------------------------------------------------------------------

#[test]
fn t8_capability() {
    let cap = tockola_lib::taskops::capability().expect("capability probe failed");
    assert!(cap["maxVersion"].is_number(), "maxVersion missing: {cap}");
    assert!(
        cap["maxVersion"].as_f64().unwrap_or(0.0) >= 1.2,
        "maxVersion must not be below 1.2: {cap}"
    );
    assert!(cap["supported"].is_object(), "supported must be an object: {cap}");
    assert!(cap["requiredVersion"].is_object(), "requiredVersion must be an object: {cap}");
    assert!(
        cap["settingsClass"].as_str().unwrap_or("").starts_with("MSFT_TaskSettings"),
        "unexpected settingsClass shape: {cap}"
    );
}

// ---------------------------------------------------------------------------
// t9 - walk every real task on this machine through the details path
//
// The most direct guard against "editing details is broken". Local tasks vary
// wildly (system, hidden, V1 legacy, unknown triggers) — fixtures cannot
// cover them all.
// ---------------------------------------------------------------------------

#[test]
fn t9_every_real_task_is_readable() {
    let rows = tockola_lib::taskops::list_all().expect("failed to list all tasks");
    assert!(!rows.is_empty(), "not a single task was listed on this machine");

    let mut failed: Vec<String> = Vec::new();
    let mut checked = 0usize;

    for r in &rows {
        let name = match r.get("name").and_then(|v| v.as_str()) {
            Some(n) if !n.is_empty() => n.to_string(),
            _ => {
                failed.push(format!("a list row has no name: {r}"));
                continue;
            }
        };
        let path = r.get("path").and_then(|v| v.as_str()).unwrap_or("");
        if !path.ends_with('\\') {
            failed.push(format!("{path}|{name} path is not a folder path"));
            continue;
        }

        // This is the exact path the details page takes: get_task(name, path).
        match tockola_lib::taskops::get_task(&name, path) {
            Ok(d) => {
                if d.get("config").is_none() {
                    failed.push(format!("{path}|{name} details has no config"));
                }
                checked += 1;
            }
            Err(e) => failed.push(format!("{path}|{name} failed to read details: {e}")),
        }
    }

    assert!(
        checked > 0,
        "not a single task could be read. All failures:\n{}",
        failed.join("\n")
    );
    // A handful of system tasks may be unreadable because of rights, but a
// failure rate above 2% signals a systemic problem.
    let ratio = failed.len() as f64 / (failed.len() + checked) as f64;
    assert!(
        ratio <= 0.02,
        "{} / {} tasks failed to read details ({:.1}%), above the tolerance:\n{}",
        failed.len(),
        failed.len() + checked,
        ratio * 100.0,
        failed.join("\n")
    );
}

// ---------------------------------------------------------------------------
// t11 - new task: the trigger list starts empty
//
// defaultConfig() used to preset a "daily" trigger, deciding the run time for
// the user; saving without looking produced tasks firing at the wrong moment.
// It now starts empty and the user adds their own.
// This case pins two things:
//   1. an empty trigger list registers fine; the engine accepts it
//   2. it reads back empty; the UI never invents a trigger
// ---------------------------------------------------------------------------

#[test]
fn t11_new_task_starts_with_no_trigger() {
    let mut cfg = fixture();
    cfg["triggers"] = json!([]); // the initial value from the UI defaultConfig()

    with_task("t11", &cfg, |name| {
        let got = tockola_lib::taskops::config(name, HOME).expect("failed to read config");
        let arr = got["triggers"]
            .as_array()
            .unwrap_or_else(|| panic!("triggers must be an array: {}", got["triggers"]));
        assert!(arr.is_empty(), "a new task must not read back any trigger, got {arr:?}");

        // The section read has to be empty too: the TaskEditor triggers region uses
// this path.
        let sec = tockola_lib::taskops::section(name, HOME, "triggers").expect("failed to read the triggers section");
        let sec = sec.as_array().unwrap_or_else(|| panic!("triggers section must be an array: {sec}"));
        assert!(sec.is_empty(), "triggers section must read back empty, got {sec:?}");

        // A task with no trigger still shows up in the list, with a "ready / never
        // runs automatically" state rather than an error.
        let row = find_row(name).unwrap_or_else(|| panic!("newly created task {name} is missing from the list"));
        assert_eq!(row["name"].as_str().unwrap_or(""), name);
        assert!(STATES.contains(&row["state"].as_str().unwrap_or("")), "unexpected state: {}", row["state"]);
    });
}
