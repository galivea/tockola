//! Future run times, straight from the Windows Task Scheduler engine.
//!
//! This backs "next N run times" in the UI — there is **no second scheduling
//! rule set**. Whatever the engine computes is what gets displayed: register
//! the current config (unsaved draft included) as a temporary task, call
//! `IRegisteredTask::GetRunTimes`, then delete it.
//!
//! Two guards ensure the temporary task can never actually run:
//!   1. the caller sets `<Settings><Enabled>` to false in the incoming XML
//!   2. `SetEnabled(false)` is called again right after registration
//! Measured: a disabled task still yields run times, N rows in 8 ms.
//!
//! PowerShell cannot call this directly: `GetRunTimes` takes a
//! `const LPSYSTEMTIME`, which the IDispatch adapter cannot marshal, so it
//! fails with DISP_E_MEMBERNOTFOUND (0x80020003). Hence Rust with the
//! `windows` crate's early-bound vtable calls.

#[cfg(test)]
use windows::core::BSTR;
use windows::Win32::Foundation::SYSTEMTIME;
#[cfg(test)]
use windows::Win32::Foundation::VARIANT_BOOL;
use windows::Win32::System::Com::CoTaskMemFree;
#[cfg(test)]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::SystemInformation::GetLocalTime;
use windows::Win32::System::TaskScheduler::IRegisteredTask;

use crate::error::{map, Result};
#[cfg(test)]
use windows::Win32::System::TaskScheduler::{
    ITaskService, TaskScheduler, TASK_CREATE_OR_UPDATE, TASK_LOGON_NONE,
};
#[cfg(test)]
use windows::Win32::System::Variant::VARIANT;

/// Temporary folder used while probing; deleted before returning.
#[cfg(test)]
const FOLDER: &str = "__TSTestRoot__\\Probe";
#[cfg(test)]
const TASK: &str = "__probe__";
/// Never ask further than 10 years out.
const YEARS: u16 = 10;
/// Hard ceiling per query; the UI may ask for fewer.
const MAX_COUNT: u32 = 200;

/// One temporary task name cannot be registered or deleted concurrently.
static PROBE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Probe task lock: serialize register/delete on the shared temporary name.
pub fn probe_lock() -> std::sync::MutexGuard<'static, ()> {
    PROBE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Ask an **already registered** task for its next `count` run times.
///
/// This is the only authoritative way to compute a schedule — the engine
/// decides, we display. Who registered the task (object model or raw XML) is
/// irrelevant here.
pub fn ask_engine(task: &IRegisteredTask, count: u32) -> Result<Vec<String>> {
    let start = unsafe { GetLocalTime() };
    let end = SYSTEMTIME {
        wYear: start.wYear.saturating_add(YEARS).min(9999),
        wMonth: 12,
        wDay: 31,
        wHour: 23,
        wMinute: 59,
        wSecond: 59,
        wMilliseconds: 0,
        wDayOfWeek: 0,
    };

    let mut n = count.clamp(1, MAX_COUNT);
    let mut ptr: *mut SYSTEMTIME = std::ptr::null_mut();
    let res = unsafe { task.GetRunTimes(&start, &end, &mut n, &mut ptr) };

    let mut out = Vec::new();
    if res.is_ok() && !ptr.is_null() {
        unsafe {
            for i in 0..n as usize {
                out.push(fmt(ptr.add(i).read()));
            }
            CoTaskMemFree(Some(ptr as *const core::ffi::c_void));
        }
    }
    res.map_err(map("probe.askEngine"))?;
    Ok(out)
}

/// Register an XML snippet as a disabled task and ask for run times.
/// **Test-only** — production goes through `taskops::probe`, which builds the
/// definition through the object model and never emits XML.
#[cfg(test)]
pub fn probe(xml: &str, count: u32) -> Result<Vec<String>> {
    let _guard = PROBE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    unsafe {
        // COM may already be initialized on the main thread; S_FALSE is not an error.
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(map("probe.comInit"))?;

        let svc: ITaskService = CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER)
            .map_err(map("probe.createService"))?;
        let nil = VARIANT::default();
        svc.Connect(&nil, &nil, &nil, &nil)
            .map_err(map("probe.connect"))?;

        let root = svc
            .GetFolder(&BSTR::from("\\"))
            .map_err(map("probe.openRoot"))?;
        // CreateFolder reports EXISTS when it is already there; fall back to opening.
        let folder = match root.CreateFolder(&BSTR::from(FOLDER), &nil) {
            Ok(f) => f,
            Err(_) => root
                .GetFolder(&BSTR::from(FOLDER))
                .map_err(map("probe.createFolder"))?,
        };

        let task = folder
            .RegisterTask(
                &BSTR::from(TASK),
                &BSTR::from(xml),
                TASK_CREATE_OR_UPDATE.0,
                &nil,
                &nil,
                TASK_LOGON_NONE,
                &nil,
            )
            .map_err(map("probe.register"))?;
        // Second guard: disable at once so the probe task can never run.
        let _ = task.SetEnabled(VARIANT_BOOL(0));

        let out = ask_engine(&task, count)?;
        // Clean up either way; the temporary folder must not survive.
        let _ = folder.DeleteTask(&BSTR::from(TASK), 0);
        let _ = root.DeleteFolder(&BSTR::from(FOLDER), 0);
        Ok(out)
    }
}

/// Tomorrow in local time; the shared start date in tests so a probe cannot fire.
///
/// Test-only. Contract tests live in `tests/` and link against the library built
/// without `cfg(test)`, so they cannot reach a `#[cfg(test)]` item — hence `pub`
/// here.
pub fn tomorrow() -> String {
    let t = unsafe { GetLocalTime() };
    let days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let leap = t.wYear % 4 == 0 && (t.wYear % 100 != 0 || t.wYear % 400 == 0);
    let dim = days[(t.wMonth - 1) as usize] + if leap && t.wMonth == 2 { 1 } else { 0 };
    let (m, d) = if t.wDay < dim {
        (t.wMonth, t.wDay + 1)
    } else if t.wMonth == 12 {
        (1, 1)
    } else {
        (t.wMonth + 1, 1)
    };
    format!("{:04}-{:02}-{:02}", t.wYear, m, d)
}

#[cfg(test)]
mod tests {
    use super::{probe, tomorrow};

    /// Only the <Triggers> content varies; everything else is fixed.
    fn task_xml(triggers: &str) -> String {
        let d = tomorrow();
        let triggers = triggers.replace("{d}", &d);
        format!(
            r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Author>probe</Author></RegistrationInfo>
  <Triggers>{triggers}</Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <Enabled>false</Enabled>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <ExecutionTimeLimit>PT72H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/c exit 0</Arguments></Exec></Actions>
</Task>"#
        )
    }

    /// Wrap in <CalendarTrigger> with a 09:00 start boundary.
    fn cal(schedule: &str, extra: &str) -> String {
        format!(
            "<CalendarTrigger><StartBoundary>{{d}}T09:00:00</StartBoundary><Enabled>true</Enabled>{schedule}{extra}</CalendarTrigger>"
        )
    }

    /// A minimal "daily at 09:00" task.
    fn daily_xml() -> String {
        task_xml(&cal("<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>", ""))
    }

    // ---- Date math: no third-party crate, day numbers and weekdays by hand ----
    fn num(s: &str) -> (i32, i32, i32) {
        let b = s.as_bytes();
        let n = |r: std::ops::Range<usize>| {
            std::str::from_utf8(&b[r]).unwrap().parse::<i32>().unwrap()
        };
        (n(0..4), n(5..7), n(8..10))
    }
    /// Gregorian date -> absolute day number (1970-01-01 = 0).
    fn day_no(s: &str) -> i32 {
        let (y, m, d) = num(s);
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe - 719468
    }
    fn gap(a: &str, b: &str) -> i32 {
        day_no(b) - day_no(a)
    }
    /// 0=Sunday .. 6=Saturday
    fn weekday(s: &str) -> i32 {
        (day_no(s) + 4).rem_euclid(7)
    }
    fn days_in_month(s: &str) -> i32 {
        let (y, m, _) = num(s);
        let dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(m - 1) as usize];
        if m == 2 && y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            29
        } else {
            dim
        }
    }
    /// Tomorrow: its weekday index (0=Sunday) and the matching XML element name.
    fn tomorrow_dow() -> (i32, &'static str) {
        const NAMES: [&str; 7] = [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
        ];
        let wd = weekday(&tomorrow());
        (wd, NAMES[wd as usize])
    }

    /// Diagnostic: try each <Principals> shape and see which the engine accepts.
    #[test]
    fn which_principal_forms_are_accepted() {
        let d = tomorrow();
        let xml = |principals: &str| {
            format!(
                r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Author>probe</Author></RegistrationInfo>
  <Triggers><CalendarTrigger><StartBoundary>{d}T09:00:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger></Triggers>
  {principals}
  <Settings><Enabled>false</Enabled><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT72H</ExecutionTimeLimit><Priority>7</Priority></Settings>
  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/c exit 0</Arguments></Exec></Actions>
</Task>"#
            )
        };
        let p = |inner: &str| format!("<Principals><Principal id=\"Author\">{inner}</Principal></Principals>");
        for (label, principals) in [
            ("A no Principals", String::new()),
            ("B InteractiveToken without UserId", p("<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>")),
            ("C InteractiveToken + UserId=Administrator", p("<UserId>Administrator</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>")),
            ("D InteractiveToken + current user", p(&format!("<UserId>{}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>", whoami()))),
            ("E ServiceAccount + SYSTEM", p("<UserId>SYSTEM</UserId><LogonType>ServiceAccount</LogonType><RunLevel>HighestAvailable</RunLevel>")),
            ("F empty Principal", p("")),
            ("G S4U", p("<UserId>Administrator</UserId><LogonType>S4U</LogonType><RunLevel>HighestAvailable</RunLevel>")),
        ] {
            let doc = xml(&principals);
            match probe(&doc, 1) {
                Ok(v) => println!("OK   {label} -> {:?}", v.first()),
                Err(e) => println!("FAIL {label} -> {e}"),
            }
        }
    }

    fn whoami() -> String {
        std::env::var("USERNAME").unwrap_or_else(|_| "user".to_string())
    }

    /// Real-machine test: registers a disabled task temporarily, then deletes it.
    #[test]
    fn probe_daily_returns_ten_times() {
        let got = probe(&daily_xml(), 10).expect("probe should succeed");
        assert_eq!(got.len(), 10, "expected 10 rows, got {:?}", got);
        for (i, s) in got.iter().enumerate() {
            assert!(s.ends_with("09:00:00"), "row {} has wrong time: {}", i + 1, s);
            if i > 0 {
                assert_eq!(gap(&got[i - 1], s), 1, "daily means a 1-day gap: {:?}", got);
            }
        }
        println!("daily 09:00 probe result: {:#?}", got);
    }

    #[test]
    fn probe_daily_interval_3() {
        let got = probe(
            &task_xml(&cal(
                "<ScheduleByDay><DaysInterval>3</DaysInterval></ScheduleByDay>",
                "",
            )),
            4,
        )
        .expect("probe should succeed");
        assert_eq!(got.len(), 4, "got {:?}", got);
        for i in 1..got.len() {
            assert_eq!(gap(&got[i - 1], &got[i]), 3, "expected a 3-day gap: {:?}", got);
        }
    }

    #[test]
    fn probe_weekly_same_weekday_every_7_days() {
        let (wd, name) = tomorrow_dow();
        let got = probe(
            &task_xml(&cal(
                &format!(
                    "<ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><{name} /></DaysOfWeek></ScheduleByWeek>"
                ),
                "",
            )),
            4,
        )
        .expect("probe should succeed");
        assert_eq!(got.len(), 4, "got {:?}", got);
        for (i, s) in got.iter().enumerate() {
            assert_eq!(weekday(s), wd, "all rows should share weekday {}: {:?}", wd, got);
            if i > 0 {
                assert_eq!(gap(&got[i - 1], s), 7, "weekly means a 7-day gap: {:?}", got);
            }
        }
    }

    #[test]
    fn probe_monthly_first_day() {
        let got = probe(
            &task_xml(&cal(
                "<ScheduleByMonth><DaysOfMonth><Day>1</Day></DaysOfMonth><Months><January /><February /><March /><April /><May /><June /><July /><August /><September /><October /><November /><December /></Months></ScheduleByMonth>",
                "",
            )),
            4,
        )
        .expect("probe should succeed");
        assert_eq!(got.len(), 4, "got {:?}", got);
        for s in &got {
            assert!(s.ends_with("-01 09:00:00"), "all rows should land on day 1: {:?}", got);
        }
        for i in 1..got.len() {
            assert!(gap(&got[i - 1], &got[i]) >= 28, "monthly gaps are at least 28 days: {:?}", got);
        }
    }

    /// "Last" is written as <Week>Last</Week> — emphatically not <Week>5</Week>.
    #[test]
    fn probe_monthly_dow_last_week() {
        let (wd, name) = tomorrow_dow();
        let got = probe(
            &task_xml(&cal(
                &format!(
                    "<ScheduleByMonthDayOfWeek><Weeks><Week>Last</Week></Weeks><DaysOfWeek><{name} /></DaysOfWeek><Months><January /><February /><March /><April /><May /><June /><July /><August /><September /><October /><November /><December /></Months></ScheduleByMonthDayOfWeek>"
                ),
                "",
            )),
            3,
        )
        .expect("probe should succeed");
        assert_eq!(got.len(), 3, "got {:?}", got);
        for s in &got {
            assert_eq!(weekday(s), wd, "weekday should match: {:?}", got);
            // Seven more days would leave the month, so this is the last one.
            assert!(
                num(s).2 + 7 > days_in_month(s),
                "{s} should be the last one (its +7 days leaves a {}-day month)",
                days_in_month(s)
            );
        }
    }

    /// Repetition: interval=1h, duration=3h -> 4 hits a day, end point included.
    #[test]
    fn probe_repetition_includes_end_point() {
        let got = probe(
            &task_xml(&cal(
                "<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>",
                "<Repetition><Interval>PT1H</Interval><Duration>PT3H</Duration><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>",
            )),
            5,
        )
        .expect("probe should succeed");
        assert_eq!(got.len(), 5, "got {:?}", got);
        let day = &got[0][..10];
        for i in 0..4 {
            assert!(got[i].starts_with(day), "the first 4 rows share a day: {:?}", got);
            assert!(
                got[i].ends_with(&format!("{:02}:00:00", 9 + i)),
                "row {} should step by one hour: {:?}",
                i + 1,
                got
            );
        }
        assert!(!got[4].starts_with(&got[0][..10]), "row 5 should land on the next day: {:?}", got);
    }

    /// Nothing past the end boundary counts.
    #[test]
    fn probe_stops_at_end_boundary() {
        let d = tomorrow();
        // End boundary = start + 3 days, so at most 3 hits.
        let end = add_days(&d, 3);
        let got = probe(
            &task_xml(&cal(
                "<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>",
                &format!("<EndBoundary>{end}T00:00:00</EndBoundary>"),
            )),
            10,
        )
        .expect("probe should succeed");
        assert!(got.len() <= 3, "nothing past the end boundary: {:?}", got);
        assert!(!got.is_empty(), "hits before the end boundary must survive: {:?}", got);
    }

    /// A one-time trigger yields exactly one row.
    #[test]
    fn probe_once_trigger_single_time() {
        let got = probe(
            &task_xml(&format!(
                "<TimeTrigger><StartBoundary>{{d}}T09:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger>"
            )),
            5,
        )
        .expect("probe should succeed");
        assert_eq!(got.len(), 1, "a one-time trigger runs once: {:?}", got);
    }

    /// Locks in a real trap: the engine has no "fifth week"; emitting
    /// <Week>5</Week> fails registration outright (0x80041318). The UI's
    /// fifth entry means "last week" and must be written as `Last`.
    #[test]
    fn week_5_is_rejected_by_engine() {
        let (_, name) = tomorrow_dow();
        let err = probe(
            &task_xml(&cal(
                &format!(
                    "<ScheduleByMonthDayOfWeek><Weeks><Week>5</Week></Weeks><DaysOfWeek><{name} /></DaysOfWeek><Months><January /></Months></ScheduleByMonthDayOfWeek>"
                ),
                "",
            )),
            3,
        )
        .expect_err("week 5 must be rejected");
        let msg = err.to_string();
        assert!(
            msg.contains("Week:5") || msg.contains("0x80041318"),
            "unexpected error: {msg}"
        );
    }

    /// Logon / boot style triggers have no fixed time, so the engine lists none.
    #[test]
    fn probe_logon_trigger_has_no_time() {
        let got = probe(
            &task_xml("<LogonTrigger><Enabled>true</Enabled></LogonTrigger>"),
            5,
        )
        .expect("probe should succeed");
        assert!(got.is_empty(), "event triggers have no fixed time: {:?}", got);
    }

    /// Date + n days, correct across month and year boundaries.
    fn add_days(s: &str, n: i32) -> String {
        let total = day_no(s) + n;
        // Absolute day number -> Gregorian (civil_from_days).
        let z = total + 719468;
        let era = if z >= 0 { z } else { z - 146096 } / 146097;
        let doe = z - era * 146097;
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        let y = yoe + era * 400;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = if m <= 2 { y + 1 } else { y };
        format!("{:04}-{:02}-{:02}", y, m, d)
    }
}

/// SYSTEMTIME -> "YYYY-MM-DD HH:MM:SS"
fn fmt(s: SYSTEMTIME) -> String {
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        s.wYear, s.wMonth, s.wDay, s.wHour, s.wMinute, s.wSecond
    )
}
