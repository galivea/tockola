//! Task run history, read from the
//! `Microsoft-Windows-TaskScheduler/Operational` event channel.
//!
//! History is unreachable through the COM object model — `IRegisteredTask`
//! only exposes the *last* result, not the sequence — so the event channel is
//! the only source. This uses the Event Log API (wevtapi.dll) rather than
//! spawning a host process: switching tasks, changing the range, or hitting
//! refresh triggers a query, and a new process costs ~300 ms plus parsing of
//! localized output.
//!
//! The "level" and "task category" strings come from the system itself
//! (`RenderingInfo`); there is deliberately no hand-maintained id -> text
//! table:
//!   level    = localized display name of the event Level
//!   category = localized display name of the event Task
//! Windows renders both according to the current locale, which is exactly what
//! the native History tab shows. An earlier attempt that reverse-engineered
//! id -> text from EventData / Message did not line up (142 came out as
//! "event #142", 140 as "task updated" versus the system's
//! "task registration updated"). Events with no rendering fall back in the UI.

use chrono::{DateTime, Local};
use serde_json::{json, Value};
use std::mem::{size_of, zeroed};
use windows::core::{BOOL, PCWSTR};
use windows::Win32::System::EventLog::{
    EvtClose, EvtFormatMessage, EvtGetChannelConfigProperty, EvtNext, EvtOpenChannelConfig,
    EvtOpenPublisherMetadata, EvtQuery, EvtRender, EvtSaveChannelConfig, EvtSetChannelConfigProperty,
    EvtChannelConfigEnabled, EvtFormatMessageXml, EvtQueryChannelPath, EvtQueryReverseDirection,
    EvtRenderEventXml, EvtVarTypeBoolean, EVT_HANDLE, EVT_VARIANT,
};

use crate::error::{err, map, Result};

const CHANNEL: &str = "Microsoft-Windows-TaskScheduler/Operational";
// Every event in this channel comes from this provider; open its metadata once.
const PROVIDER: &str = "Microsoft-Windows-TaskScheduler";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Special characters must be escaped: a single `&` in a task name is enough
/// to break the whole XPath query.
fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// The TaskName recorded in an event is the **full path**: leading backslash,
/// no trailing one.
fn event_task_name(path: &str, name: &str) -> String {
    let p = path.replace('/', "\\").trim_end_matches('\\').to_string();
    format!("{p}\\{name}")
}

fn build_query(full: &str, days: u32) -> String {
    // timediff is in milliseconds; never pass 0 days or the filter empties it.
    let ms = (days.max(1) as u64) * 86_400_000;
    format!(
        "*[System[TimeCreated[timediff(@SystemTime) <= {ms}]] \
         and EventData[Data[@Name='TaskName'] and (Data='{task}')]]",
        ms = ms,
        task = xml_escape(full)
    )
}

/// Events for one task over the last `days` days, newest first.
pub fn task_events(path: &str, name: &str, limit: u32, days: u32) -> Result<Vec<Value>> {
    let channel = wide(CHANNEL);
    let query = build_query(&event_task_name(path, name), days);
    let query_w = wide(&query);

    let result_set = unsafe {
        EvtQuery(
            None,
            PCWSTR(channel.as_ptr()),
            PCWSTR(query_w.as_ptr()),
            EvtQueryChannelPath.0 | EvtQueryReverseDirection.0,
        )
    }
    .map_err(map("history.query"))?;

    // Display strings (level / category) need provider metadata; one handle
    // per query is enough. Failure to open it (rights, missing metadata) is not
    // an error: the strings are simply absent and the UI falls back to the id.
    let publisher = open_publisher();

    let limit = limit.clamp(1, 500) as usize;
    let mut out: Vec<Value> = Vec::new();
    let mut batch = vec![0isize; 64];

    loop {
        if out.len() >= limit {
            break;
        }
        let mut returned = 0u32;
        // Exhaustion surfaces as ERROR_NO_MORE_ITEMS; treat it as end of loop.
        if unsafe { EvtNext(result_set, &mut batch, 1000, 0, &mut returned) }.is_err() {
            break;
        }
        if returned == 0 {
            break;
        }
        for i in 0..returned as usize {
            let handle = EVT_HANDLE(batch[i]);
            if let Ok(xml) = render_xml(handle) {
                let rendering = publisher.and_then(|p| render_rendering_info(p, handle));
                if let Some(ev) = parse_event(&xml, rendering.as_deref()) {
                    out.push(ev);
                }
            }
            let _ = unsafe { EvtClose(handle) };
        }
    }

    if let Some(p) = publisher {
        let _ = unsafe { EvtClose(p) };
    }
    let _ = unsafe { EvtClose(result_set) };
    Ok(out)
}

fn render_xml(evt: EVT_HANDLE) -> Result<String> {
    let mut used = 0u32;
    let mut count = 0u32;
    // Ask for the size with a zero-length buffer first. That call always fails
    // with "insufficient buffer" but fills in `used`.
    let _ = unsafe { EvtRender(None, evt, EvtRenderEventXml.0, 0, None, &mut used, &mut count) };
    if used == 0 {
        return Err(err("history.renderSize"));
    }
    let mut buf: Vec<u16> = vec![0u16; (used as usize / 2) + 2];
    let mut used2 = 0u32;
    let mut count2 = 0u32;
    unsafe {
        EvtRender(
            None,
            evt,
            EvtRenderEventXml.0,
            (buf.len() * 2) as u32,
            Some(buf.as_mut_ptr() as *mut _),
            &mut used2,
            &mut count2,
        )
    }
    .map_err(map("history.render"))?;

    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Ok(String::from_utf16_lossy(&buf[..len]))
}

/// Open the event provider metadata handle. `EvtFormatMessage` needs it later
/// to resolve localized strings.
fn open_publisher() -> Option<EVT_HANDLE> {
    let id = wide(PROVIDER);
    unsafe { EvtOpenPublisherMetadata(None, PCWSTR(id.as_ptr()), PCWSTR::null(), 0, 0) }.ok()
}

/// Render the `RenderingInfo` fragment:
/// `<Level>Information</Level><Task>Task disabled</Task><Opcode>Info</Opcode>`.
///
/// Windows generates these from the current locale, the same source the
/// native History tab uses, so they are never re-translated here — a
/// hand-written translation would drift from the system (see module docs).
/// Same two-step as `render_xml`: ask the size, then read the content.
fn render_rendering_info(publisher: EVT_HANDLE, evt: EVT_HANDLE) -> Option<String> {
    let mut used = 0u32;
    let _ = unsafe {
        EvtFormatMessage(
            Some(publisher),
            Some(evt),
            0,
            None,
            EvtFormatMessageXml.0,
            None,
            &mut used,
        )
    };
    if used == 0 {
        return None;
    }

    // `used` is a **byte** count. The windows crate passes the slice length
    // (element count) straight to the API as buffersize, so size the u16
    // buffer in bytes or it always fails with ERROR_INSUFFICIENT_BUFFER.
    // The EvtRender wrapper differs here — do not copy `used / 2` from it.
    let mut buf: Vec<u16> = vec![0u16; (used as usize) + 2];
    let mut used2 = 0u32;
    let ok = unsafe {
        EvtFormatMessage(
            Some(publisher),
            Some(evt),
            0,
            None,
            EvtFormatMessageXml.0,
            Some(&mut buf),
            &mut used2,
        )
    };
    if ok.is_err() {
        return None;
    }

    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let text = String::from_utf16_lossy(&buf[..len]);
    if text.trim().is_empty() {
        return None;
    }
    Some(text)
}

/// Pull the displayed fields out of the event XML. Targeted extraction only;
/// no XML parser dependency. `rendering` is the optional `RenderingInfo`
/// fragment the level and category strings come from.
fn parse_event(xml: &str, rendering: Option<&str>) -> Option<Value> {
    let id = tag_text(xml, "EventID")?.parse::<u32>().ok()?;
    let raw_time = attr_value(xml, "SystemTime").unwrap_or_default();
    // Level: 1=critical 2=error 3=warning 4=information. The UI shows all
    // four rather than collapsing to "error / other", because warning-level
    // events (missed schedule, instance already running) are exactly the
    // ones you need while troubleshooting.
    let level = tag_text(xml, "Level")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(4);
    let result_code = data_value(xml, "ResultCode").unwrap_or_default();
    let task_name = data_value(xml, "TaskName").unwrap_or_default();

    // Strings come from the system; leave them empty when unavailable and let
    // the UI fall back to the event id instead of guessing here.
    let (level_text, category) = match rendering {
        Some(r) => (
            rendering_text(r, "Level").unwrap_or_default(),
            rendering_text(r, "Task").unwrap_or_default(),
        ),
        None => (String::new(), String::new()),
    };

    Some(json!({
        "time": fmt_time(&raw_time),
        "id": id,
        // `level` only drives row colour; `levelText` is the displayed string.
        "level": match level {
            1 => "critical",
            2 => "error",
            3 => "warning",
            _ => "info",
        },
        "levelText": level_text,
        "category": category,
        "resultCode": result_code,
        "taskName": task_name,
    }))
}

/// Read localized strings out of an `EvtFormatMessage(EvtFormatMessageXml)`
/// result.
///
/// That call returns the **full** event XML (System + RenderingInfo), not just
/// RenderingInfo.
/// System carries numeric `<Level>4</Level>` / `<Task>102</Task>` nodes that
/// come first.
/// A naive whole-document search picks up the numbers (a real machine returned
/// "4" / "102"), so the System section must be skipped.
fn rendering_text(xml: &str, tag: &str) -> Option<String> {
    let start = xml.find("<RenderingInfo")?;
    tag_text(&xml[start..], tag)
}

/// `<Tag ...>text</Tag>` -> text. EventID may carry a Qualifiers attribute,
/// so it is split on the first `>`.
fn tag_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let start = xml.find(&open)?;
    let gt = xml[start..].find('>')? + start + 1;
    let end = xml[gt..].find(&format!("</{}>", tag))? + gt;
    Some(xml[gt..end].trim().to_string())
}

/// `Name='value'` / `Name="value"` → value
fn attr_value(xml: &str, name: &str) -> Option<String> {
    for quote in ['\'', '"'] {
        let key = format!("{}={}", name, quote);
        if let Some(start) = xml.find(&key) {
            let from = start + key.len();
            if let Some(rel) = xml[from..].find(quote) {
                return Some(xml[from..from + rel].to_string());
            }
        }
    }
    None
}

/// `<Data Name='X'>value</Data>` inside EventData -> value.
fn data_value(xml: &str, name: &str) -> Option<String> {
    for quote in ['\'', '"'] {
        let key = format!("<Data Name={}{}{}>", quote, name, quote);
        if let Some(start) = xml.find(&key) {
            let from = start + key.len();
            if let Some(rel) = xml[from..].find("</Data>") {
                return Some(xml[from..from + rel].trim().to_string());
            }
        }
    }
    None
}

/// Event times are UTC (`2026-10-21T05:26:05.1234567Z`); the UI always
/// shows local time.
/// Slash separators and seconds match the native "Date and Time" column;
/// zero-padding is the one deliberate difference.
/// The native column follows the locale (`8:29:26`) and looks ragged;
/// padding scans better.
fn fmt_time(raw: &str) -> String {
    match DateTime::parse_from_rfc3339(raw) {
        Ok(dt) => dt.with_timezone(&Local).format("%Y/%m/%d %H:%M:%S").to_string(),
        // Fall back to a truncated original when parsing fails.
        Err(_) => raw.get(..16).unwrap_or(raw).replace('T', " "),
    }
}

/// Whether the channel is enabled. Windows records no task history by
/// default, so a disabled channel means an empty query.
pub fn channel_enabled() -> Result<bool> {
    let channel = wide(CHANNEL);
    let handle = unsafe { EvtOpenChannelConfig(None, PCWSTR(channel.as_ptr()), 0) }
        .map_err(map("history.readState"))?;

    let mut variant: EVT_VARIANT = unsafe { zeroed() };
    let mut used = 0u32;
    let result = unsafe {
        EvtGetChannelConfigProperty(
            handle,
            EvtChannelConfigEnabled,
            0,
            size_of::<EVT_VARIANT>() as u32,
            Some(&mut variant),
            &mut used,
        )
    };
    let _ = unsafe { EvtClose(handle) };
    result.map_err(map("history.readState"))?;

    Ok(unsafe { variant.Anonymous.BooleanVal }.as_bool())
}

/// Enable / disable task history (the built-in "Enable All Tasks History").
/// Administrator rights are required.
pub fn set_channel_enabled(enabled: bool) -> Result<()> {
    let channel = wide(CHANNEL);
    let handle = unsafe { EvtOpenChannelConfig(None, PCWSTR(channel.as_ptr()), 0) }
        .map_err(map("history.openChannel"))?;

    let mut variant: EVT_VARIANT = unsafe { zeroed() };
    variant.Type = EvtVarTypeBoolean.0 as u32;
    // EVT_VARIANT is a union: the field you write selects the type, declared above.
    variant.Anonymous.BooleanVal = BOOL(enabled as i32);

    let result = unsafe {
        EvtSetChannelConfigProperty(handle, EvtChannelConfigEnabled, 0, &variant)
            .and_then(|_| EvtSaveChannelConfig(handle, 0))
    };
    let _ = unsafe { EvtClose(handle) };

    result.map_err(|_| err("history.enableDenied"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_handles_ampersand() {
        assert_eq!(xml_escape("A&B"), "A&amp;B");
        assert_eq!(xml_escape("a'b"), "a&apos;b");
    }

    #[test]
    fn task_name_is_full_path() {
        assert_eq!(
            event_task_name("\\Maintenance\\", "DailyBackup"),
            "\\Maintenance\\DailyBackup"
        );
        assert_eq!(event_task_name("\\", "RootTask"), "\\RootTask");
    }

    #[test]
    fn query_escapes_task_name() {
        let q = build_query("\\A&B\\c", 7);
        assert!(q.contains("A&amp;B"));
        assert!(q.contains("timediff"));
    }

    #[test]
    fn parse_extracts_fields() {
        let xml = r#"<Event xmlns='x'><System><EventID Qualifiers=''>102</EventID><Level>4</Level>
            <TimeCreated SystemTime='2026-10-21T05:26:05.1234567Z'/></System>
            <EventData><Data Name='TaskName'>\Maintenance\DailyBackup</Data>
            <Data Name='ResultCode'>0</Data></EventData></Event>"#;
        let v = parse_event(xml, None).expect("event should parse");
        assert_eq!(v["id"], 102);
        assert_eq!(v["level"], "info");
        assert_eq!(v["resultCode"], "0");
        assert_eq!(v["taskName"], "\\Maintenance\\DailyBackup");
        assert!(v["time"].as_str().unwrap().contains('/'));
    }

    /// Level and category strings come from the rendered RenderingInfo,
    /// not from a hand-written table.
    #[test]
    fn parse_takes_wording_from_rendering_info() {
        let xml = r#"<Event xmlns='x'><System><EventID Qualifiers=''>153</EventID><Level>3</Level>
            <TimeCreated SystemTime='2026-10-15T05:43:30.0000000Z'/></System>
            <EventData><Data Name='TaskName'>\A\B</Data></EventData></Event>"#;
        // EvtFormatMessage(EvtFormatMessageXml) yields the full XML: System
        // holds numbers (Level=3 / Task=153), RenderingInfo holds the text.
        let rendering = r#"<Event xmlns='x'><System><EventID>153</EventID><Level>3</Level>
            <Task>153</Task><Opcode>2</Opcode></System>
            <RenderingInfo Culture='en-US'><Message>Task Scheduler did not launch task...</Message>
            <Level>Warning</Level><Task>Missed task start rejected</Task><Opcode>Info</Opcode>
            </RenderingInfo></Event>"#;

        let v = parse_event(xml, Some(rendering)).expect("event should parse");
        assert_eq!(v["id"], 153);
        assert_eq!(v["level"], "warning"); // colouring still follows System/Level
        assert_eq!(v["levelText"], "Warning"); // not the raw "3" from System
        assert_eq!(v["category"], "Missed task start rejected"); // not "153"
    }

    /// With only a System section (no RenderingInfo) the numbers must not be
    /// shown as if they were text.
    #[test]
    fn parse_ignores_system_level_and_task_numbers() {
        let xml = r#"<Event xmlns='x'><System><EventID>102</EventID><Level>4</Level><Task>102</Task>
            </System></Event>"#;
        let v = parse_event(xml, Some(xml)).expect("event should parse");
        assert_eq!(v["levelText"], "");
        assert_eq!(v["category"], "");
    }

    /// Without RenderingInfo both text fields stay empty so the UI can fall
    /// back to the event id.
    #[test]
    fn parse_leaves_wording_empty_without_rendering_info() {
        let xml = r#"<Event xmlns='x'><System><EventID Qualifiers=''>142</EventID><Level>4</Level>
            <TimeCreated SystemTime='2026-10-21T04:22:00.0000000Z'/></System></Event>"#;
        let v = parse_event(xml, None).expect("event should parse");
        assert_eq!(v["levelText"], "");
        assert_eq!(v["category"], "");
    }

    /// Real-machine check: read the newest event in the channel and use its
    /// TaskName as the sample. No prior knowledge of local tasks needed;
    /// returns None when the channel is disabled or empty.
    fn sample_task_name() -> Option<String> {
        let channel = wide(CHANNEL);
        let q = wide("*[System[TimeCreated[timediff(@SystemTime) <= 2592000000]]]");
        let rs = unsafe {
            EvtQuery(
                None,
                PCWSTR(channel.as_ptr()),
                PCWSTR(q.as_ptr()),
                EvtQueryChannelPath.0 | EvtQueryReverseDirection.0,
            )
        }
        .ok()?;

        let mut batch = vec![0isize; 8];
        let mut returned = 0u32;
        let ok = unsafe { EvtNext(rs, &mut batch, 1000, 0, &mut returned) };
        let mut name = None;
        if ok.is_ok() && returned > 0 {
            let handle = EVT_HANDLE(batch[0]);
            if let Ok(xml) = render_xml(handle) {
                name = data_value(&xml, "TaskName");
            }
            let _ = unsafe { EvtClose(handle) };
        }
        let _ = unsafe { EvtClose(rs) };
        name.filter(|s| !s.is_empty())
    }

    /// Real-machine check: level / category text must come from system
    /// rendering, not the frontend table. Skipped (not failed) when the
    /// channel is off or the sample task has no events in range.
    #[test]
    fn live_events_carry_system_wording() {
        let Some(full) = sample_task_name() else {
            return;
        };
        let (path, name) = full.rsplit_once('\\').unwrap_or(("\\", full.as_str()));
        let path = format!("{}\\", path.trim_end_matches('\\'));

        let Ok(events) = task_events(&path, name, 5, 365) else {
            return;
        };
        if events.is_empty() {
            return;
        }

        let with_category = events
            .iter()
            .filter(|e| !e["category"].as_str().unwrap_or_default().is_empty())
            .count();
        assert!(
            with_category > 0,
            "{} events returned but none carries system text: EvtFormatMessage did not
             run, so the UI falls back to the id table (which does not match)",
            events.len()
        );
    }
}
