// Contract tests live in `tests/` (cargo's integration directory), not in `src`.
// They drive real tasks, so these layers have to be public; everything else stays
// private.
pub mod com;
pub mod runtimes;
pub mod taskops;
pub mod tasks;

mod error;
mod history;
mod taskdef;
mod taskio;

use std::sync::Mutex;

use tauri::{
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};

/// Handle to the system tray so its menu can be rebuilt when the UI language
/// changes. Stored in app state; the tray lives for the whole process.
struct TrayHandle(Mutex<Option<TrayIcon<tauri::Wry>>>);

/// User preference for what the window-close action does. Frontend sets it
/// ("quit" | "tray"); Rust honors it on CloseRequested. Default is "quit" so
/// the X button closes the app unless the user opts into minimize-to-tray.
/// `explicit_quit` is raised by the tray's "Quit Tockola" item so the
/// ExitRequested guard below still lets an intentional quit through even when
/// the close behavior is "tray".
struct AppPrefs {
    close_behavior: Mutex<String>,
    explicit_quit: Mutex<bool>,
}

/// Tray menu copy for a given locale. English is the fallback and the source of
/// truth; Chinese mirrors the frontend pack. These strings are independent of the
/// JS i18n dict because the native menu is built in Rust.
fn tray_labels(locale: &str) -> (&'static str, &'static str, &'static str) {
    match locale {
        "zh" => ("显示窗口", "退出 Tockola", "语言"),
        _ => ("Show Window", "Quit Tockola", "Language"),
    }
}

/// Build a fresh tray menu for `locale`, with a Language submenu (English /
/// 简体中文) whose active entry is checked.
fn build_tray_menu<M: tauri::Manager<tauri::Wry>>(
    app: &M,
    locale: &str,
) -> tauri::menu::Menu<tauri::Wry> {
    let (show_text, quit_text, lang_text) = tray_labels(locale);
    let show_i = MenuItemBuilder::with_id("show", show_text)
        .build(app)
        .expect("build tray show item");
    let quit_i = MenuItemBuilder::with_id("quit", quit_text)
        .build(app)
        .expect("build tray quit item");
    let en_i = CheckMenuItemBuilder::with_id("lang-en", "English")
        .checked(locale == "en")
        .build(app)
        .expect("build tray language item");
    let zh_i = CheckMenuItemBuilder::with_id("lang-zh", "简体中文")
        .checked(locale == "zh")
        .build(app)
        .expect("build tray language item");
    let lang_sub = SubmenuBuilder::new(app, lang_text)
        .items(&[&en_i, &zh_i])
        .build()
        .expect("build tray language submenu");
    MenuBuilder::new(app)
        .item(&show_i)
        .separator()
        .item(&lang_sub)
        .separator()
        .item(&quit_i)
        .build()
        .expect("build tray menu")
}

/// Rebuild the tray menu in the chosen locale. Called from the frontend whenever
/// the UI language changes (and once at startup).
#[tauri::command]
fn set_tray_locale(app: tauri::AppHandle, state: tauri::State<TrayHandle>, locale: String) {
    let menu = build_tray_menu(&app, locale.trim());
    if let Some(tray) = state.0.lock().expect("tray lock").as_ref() {
        if let Err(e) = tray.set_menu(Some(menu)) {
            eprintln!("failed to update tray menu: {e}");
        }
    }
}

/// Persist the window-close preference. "tray" parks the window in the system
/// tray on close; anything else (including the default) closes the app.
#[tauri::command]
fn set_close_behavior(state: State<AppPrefs>, behavior: String) {
    let value = if behavior == "tray" { "tray" } else { "quit" }.to_string();
    *state.close_behavior.lock().expect("prefs lock") = value;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            tasks::list_tasks,
            tasks::list_folders,
            tasks::create_folder,
            tasks::rename_folder,
            tasks::delete_folder,
            tasks::get_task,
            tasks::get_task_config,
            tasks::get_task_section,
            tasks::get_task_capability,
            tasks::save_task,
            tasks::update_task_info,
            tasks::delete_task,
            tasks::run_task,
            tasks::stop_task,
            tasks::set_task_enabled,
            tasks::probe_run_times,
            tasks::get_task_history,
            tasks::get_history_enabled,
            tasks::set_history_enabled,
            tasks::export_task_xml,
            tasks::export_tasks_xml,
            tasks::import_task_xml,
            tasks::bulk_task_action,
            set_tray_locale,
            set_close_behavior,
        ])
        .setup(|app| {
            // One-time migration for the product rename: changing the Tauri
            // identifier moved the per-app data directory. Copy the store files
            // over only when the new directory has none, so existing UI
            // preferences survive. The old identifier is intentionally kept
            // here as the migration source.
            if let Ok(new_dir) = app.path().app_data_dir() {
                let old_dir = new_dir.with_file_name("galivea.rhyzal");
                let _ = std::fs::create_dir_all(&new_dir);
                for file in ["filters.json", "settings.json"] {
                    let src = old_dir.join(file);
                    let dst = new_dir.join(file);
                    if src.is_file() && !dst.exists() {
                        if let Err(e) = std::fs::copy(&src, &dst) {
                            eprintln!("failed to migrate {file}: {e}");
                        }
                    }
                }
            }
            // System tray: a persistent icon with a context menu (show / language
            // / quit) and click-to-toggle. The app keeps running in the background;
            // the window only hides to the tray on close (see on_window_event below),
            // so the task state and COM handles stay alive.
            let icon = app
                .default_window_icon()
                .cloned()
                .expect("a window icon must be configured for the tray");
            let menu = build_tray_menu(app, "en");
            let tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Tockola")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        // Mark the exit as intentional so the ExitRequested
                        // guard keeps the app alive only for tray-minimized
                        // closes, not for an explicit quit from the tray.
                        if let Ok(mut flag) = app.state::<AppPrefs>().explicit_quit.lock() {
                            *flag = true;
                        }
                        app.exit(0);
                    }
                    // Picking a language from the tray menu switches the whole UI.
                    "lang-en" => {
                        let _ = app.emit("tray-set-locale", "en");
                    }
                    "lang-zh" => {
                        let _ = app.emit("tray-set-locale", "zh");
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            app.manage(TrayHandle(Mutex::new(Some(tray))));
            app.manage(AppPrefs {
                close_behavior: Mutex::new("quit".to_string()),
                explicit_quit: Mutex::new(false),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Honor the user's close preference. The frameless window has no
            // system close box, so the X button and Alt+F4 both land here.
            //   - "tray": park the window in the tray, keep running.
            //   - "quit" (default): let it close so the process exits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let behavior = window
                    .state::<AppPrefs>()
                    .close_behavior
                    .lock()
                    .expect("prefs lock")
                    .clone();
                if behavior != "tray" {
                    return;
                }
                let _ = window.hide();
                api.prevent_close();
            }
        })
        // Keep the process alive while it is merely parked in the tray. In tray
        // mode the CloseRequested handler hides the window (it is never
        // destroyed), so Tauri would otherwise treat "no windows left" as a
        // request to exit and drop the tray. We veto that exit — but only when
        // the user has NOT explicitly chosen Quit from the tray (see the
        // `explicit_quit` flag above), so the tray's "Quit Tockola" still closes
        // cleanly.
        .build(tauri::generate_context!())
        .expect("failed to start Task Scheduler")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let prefs = app.state::<AppPrefs>();
                let behavior = prefs.close_behavior.lock().expect("prefs lock").clone();
                let quitting = *prefs.explicit_quit.lock().expect("prefs lock");
                if behavior == "tray" && !quitting {
                    api.prevent_exit();
                }
            }
        });
}
