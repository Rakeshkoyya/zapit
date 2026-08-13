//! Process entry wiring (§2, §4): CLI parse → single-instance leader/follower →
//! dispatcher → jobs. The main window exists but stays hidden; job windows are
//! created on demand.

pub mod audio;
pub mod cli;
pub mod config;
pub mod dispatch;
pub mod error;
pub mod exif;
pub mod hash;
pub mod image;
pub mod jobs;
pub mod logging;
pub mod media_protocol;
pub mod naming;
pub mod pdf;
pub mod plan;
pub mod preview;
pub mod probe;
pub mod registry_menu;
pub mod sidecar;

use cli::Invocation;
use dispatch::DispatchMsg;
use error::AppError;
use jobs::JobState;
use std::io::Write;
use std::process::ExitCode;
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

const HELP_TEXT: &str = "Zapit — right-click file actions for Windows

USAGE:
  zapit.exe run <action-id> --file <abs-path>   invoked by the context menu
  zapit.exe settings                            open the settings window
  zapit.exe install-menu | uninstall-menu       shell integration
  zapit.exe smoke <action-id> --file <f> [--file <f>...]
                 [--opt k=v]... [--out <dir>]        headless run for scripts";

/// Best-effort console printing: the exe is a windows-subsystem binary, so we
/// attach to the parent console (if any) for CLI feedback; writes that fail
/// (double-click launch) are silently dropped — which is exactly DoD item 7.
fn attach_parent_console() {
    #[cfg(windows)]
    // SAFETY: AttachConsole has no memory-safety preconditions; it simply
    // fails (returns 0) when there is no parent console to attach to.
    unsafe {
        use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

fn console_line(text: &str) {
    let mut stdout = std::io::stdout();
    let _ = writeln!(stdout, "{text}");
}

struct DispatcherHandle(Mutex<Option<Sender<DispatchMsg>>>);

pub fn run() -> ExitCode {
    logging::init();
    jobs::sweep_stale_temp();
    attach_parent_console();
    let args: Vec<String> = std::env::args().skip(1).collect();

    let invocation = match cli::parse(&args) {
        Ok(inv) => inv,
        Err(err) => {
            console_line(&format!("error: {}\n\n{HELP_TEXT}", err.0));
            return ExitCode::FAILURE;
        }
    };

    match invocation {
        Invocation::Help => {
            console_line(HELP_TEXT);
            ExitCode::SUCCESS
        }
        inv @ (Invocation::Run { .. }
        | Invocation::Smoke { .. }
        | Invocation::Settings
        | Invocation::None
        | Invocation::InstallMenu
        | Invocation::UninstallMenu) => run_app(inv),
    }
}

fn run_app(invocation: Invocation) -> ExitCode {
    let (tx, rx) = std::sync::mpsc::channel::<DispatchMsg>();
    let tx_for_instance = tx.clone();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            move |app, argv, _cwd| {
                // A follower forwarded its argv (skip exe path). Only `run`
                // invocations aggregate; anything else from a follower is ignored.
                let args: Vec<String> = argv.into_iter().skip(1).collect();
                if let Ok(Invocation::Run {
                    action_id,
                    file,
                    options,
                }) = cli::parse(&args)
                {
                    dispatch::send_run(&tx_for_instance, action_id, file, options);
                }
                let _ = app; // reserved: future "bring settings to front"
            },
        ))
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(JobState::default())
        .manage(DispatcherHandle(Mutex::new(Some(tx))))
        // Our own media scheme (ADR 005): Tauri's asset protocol derives
        // Content-Type from `infer`, which calls M4A "audio/m4a" — a type no
        // browser engine knows, so WebView2 refused to play it. Serving the
        // bytes ourselves is the only way to set the header.
        .register_asynchronous_uri_scheme_protocol("zapitmedia", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            std::thread::spawn(move || {
                let state = app.state::<JobState>();
                responder.respond(media_protocol::respond(&state.allowed_media, &request));
            });
        })
        .invoke_handler(tauri::generate_handler![
            webview_ready,
            plan_built,
            plan_needs_options,
            plan_failed,
            submit_options,
            cancel_job,
            js_done,
            read_file_bytes,
            write_file_bytes,
            read_exif,
            preview_allow,
            preview_assets,
            build_preview_proxy,
            cancel_preview,
            compare_hash,
            menu_built,
            get_config,
            save_config,
            apply_menu,
            remove_menu,
            menu_installed,
            log_folder
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let label = window.label().to_string();
                let state = window.state::<JobState>();
                if let Some(job_id) = label.strip_prefix("options-") {
                    // Closing an options window means "never mind".
                    if let Ok(pending) = state.pending_options.lock() {
                        if let Some(tx) = pending.get(job_id) {
                            let _ = tx.send(None);
                        }
                    }
                } else if let Some(job_id) = label.strip_prefix("progress-") {
                    if let Ok(flags) = state.cancel_flags.lock() {
                        if let Some(flag) = flags.get(job_id) {
                            flag.cancel();
                        }
                    }
                }
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            match invocation.clone() {
                Invocation::Run {
                    action_id,
                    file,
                    options,
                } => {
                    let tx = {
                        let state: State<DispatcherHandle> = app.state();
                        let guard = state.0.lock().ok();
                        guard.and_then(|g| g.as_ref().cloned())
                    };
                    if let Some(tx) = tx {
                        dispatch::send_run(&tx, action_id, file, options);
                        spawn_run_dispatcher(handle, rx, tx);
                    }
                }
                Invocation::Smoke {
                    action_id,
                    files,
                    options,
                    out_dir,
                } => {
                    std::thread::spawn(move || {
                        let job_id = jobs::next_job_id();
                        let result = jobs::execute(
                            &handle,
                            &job_id,
                            &action_id,
                            &files,
                            &options,
                            out_dir.as_deref(),
                        );
                        let code = match result {
                            Ok(outputs) => {
                                for path in outputs {
                                    console_line(&format!("output: {}", path.display()));
                                }
                                console_line("smoke: OK");
                                0
                            }
                            Err(err) => {
                                console_line(&format!("smoke: FAILED — {err}"));
                                1
                            }
                        };
                        // Blunt on purpose: tauri's exit event does not reliably
                        // carry the code through run_return; smoke is a CLI
                        // path where skipping webview teardown is fine.
                        std::process::exit(code);
                    });
                }
                Invocation::Settings | Invocation::None => {
                    open_settings_window(&handle);
                    // A window is open, so the idle watchdog must run too.
                    spawn_window_watchdog(handle);
                }
                Invocation::InstallMenu | Invocation::UninstallMenu => {
                    let install = matches!(invocation, Invocation::InstallMenu);
                    std::thread::spawn(move || {
                        let code = match run_menu_command(&handle, install) {
                            Ok(message) => {
                                console_line(&message);
                                0
                            }
                            Err(err) => {
                                console_line(&format!("Zapit: {err}"));
                                1
                            }
                        };
                        std::process::exit(code);
                    });
                }
                _ => {}
            }
            Ok(())
        });

    match builder.build(tauri::generate_context!()) {
        Ok(app) => {
            // run_return propagates the code passed to AppHandle::exit —
            // smoke mode's success/failure signal for scripts.
            let code = app.run_return(|_, _| {});
            u8::try_from(code)
                .map(ExitCode::from)
                .unwrap_or(ExitCode::FAILURE)
        }
        Err(err) => {
            log::error!("failed to start Zapit: {err}");
            ExitCode::FAILURE
        }
    }
}

/// Consume aggregated jobs on a worker thread: each job gets a progress window
/// (auto-closed on success), then a toast (§5.6). The app exits when the last
/// job finishes — Explorer-launched processes must not linger.
fn spawn_run_dispatcher(
    app: AppHandle,
    rx: std::sync::mpsc::Receiver<DispatchMsg>,
    _tx_keepalive: Sender<DispatchMsg>,
) {
    std::thread::spawn(move || {
        let mut buckets = dispatch::Buckets::default();
        let mut idle_since: Option<std::time::Instant> = None;
        loop {
            let timeout = buckets
                .next_deadline()
                .map(|d| d.saturating_duration_since(std::time::Instant::now()))
                .unwrap_or(std::time::Duration::from_millis(200));
            match rx.recv_timeout(timeout) {
                Ok(DispatchMsg::Run {
                    action_id,
                    file,
                    options,
                }) => {
                    idle_since = None;
                    buckets.add(action_id, options, file, std::time::Instant::now());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
            for job in buckets.take_expired(std::time::Instant::now()) {
                run_one_job(&app, &job);
            }
            // Single-instance followers may still forward work; linger briefly
            // after the queue drains, then exit (leader lifetime policy).
            // Result/metadata windows keep the app alive until dismissed.
            let windows_open = app.webview_windows().keys().any(|label| label != "main");
            if buckets.is_empty() && !windows_open {
                let now = std::time::Instant::now();
                let since = *idle_since.get_or_insert(now);
                if now.duration_since(since) > std::time::Duration::from_secs(3) {
                    app.exit(0);
                    break;
                }
            } else {
                idle_since = None;
            }
        }
    });
}

fn run_one_job(app: &AppHandle, job: &dispatch::Job) {
    let job_id = jobs::next_job_id();
    let window_label = open_progress_window(app, &job_id, &job.action_id);
    let result = jobs::execute(app, &job_id, &job.action_id, &job.files, &job.options, None);
    if let Some(window) = app.get_webview_window(&window_label) {
        let _ = window.close();
    }
    match result {
        Ok(outputs) => {
            let body = match outputs.first() {
                Some(first) if outputs.len() == 1 => format!(
                    "{} created",
                    first.file_name().unwrap_or_default().to_string_lossy()
                ),
                _ => format!("{} files created", outputs.len()),
            };
            notify(app, &body);
            let _ = app.emit(
                "job://done",
                jobs::DoneEvent {
                    job_id: &job_id,
                    outputs: outputs
                        .iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect(),
                },
            );
        }
        Err(err) => {
            match &err {
                AppError::User(_) => log::info!("job {job_id}: {err}"),
                AppError::Engine {
                    context,
                    stderr_tail,
                } => log::error!("job {job_id}: {context}\n{stderr_tail}"),
                AppError::System(_) => log::error!("job {job_id}: {err}"),
            }
            notify(app, &format!("Couldn't complete: {err}"));
            let _ = app.emit(
                "job://error",
                jobs::ErrorEvent {
                    job_id: &job_id,
                    error: (&err).into(),
                },
            );
        }
    }
}

/// Ask the webview for the enabled action list, then write or remove the menu.
fn run_menu_command(app: &AppHandle, install: bool) -> Result<String, AppError> {
    jobs::await_webview(app)?;
    let (tx, rx) = std::sync::mpsc::channel();
    {
        let state = app.state::<JobState>();
        if let Ok(mut pending) = state.pending_menu.lock() {
            *pending = Some(tx);
        };
    }
    app.emit("menu://request", ())
        .map_err(|e| AppError::system(format!("could not reach the engine: {e}")))?;
    let actions = rx
        .recv_timeout(std::time::Duration::from_secs(20))
        .map_err(|_| AppError::system("the engine did not send the action list"))?;

    if install {
        let exe = std::env::current_exe()
            .map_err(|e| AppError::system(format!("could not locate the app: {e}")))?;
        registry_menu::install(&actions, &exe)?;
        Ok(format!(
            "context menu installed ({} actions)",
            actions.len()
        ))
    } else {
        registry_menu::uninstall(&registry_menu::collect_extensions(&actions))?;
        Ok("context menu removed".into())
    }
}

fn open_settings_window(app: &AppHandle) {
    let app_on_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(existing) = app_on_main.get_webview_window("settings") {
            let _ = existing.set_focus();
            return;
        }
        let _ = WebviewWindowBuilder::new(
            &app_on_main,
            "settings",
            WebviewUrl::App("settings.html".into()),
        )
        .title("Zapit Settings")
        // Sidebar nav plus an action list carrying descriptions and file-type
        // chips; the old 560px box forced both into one cramped column.
        .inner_size(880.0, 700.0)
        .min_inner_size(720.0, 540.0)
        .build();
    });
}

/// Keeps a window-only session (Settings) alive, exiting once it closes.
fn spawn_window_watchdog(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let open = app.webview_windows().keys().any(|label| label != "main");
        if !open {
            app.exit(0);
            break;
        }
    });
}

/// Window creation must happen on the event-loop thread on Windows; jobs run
/// on workers, so this marshals over and returns the label for later lookup.
fn open_progress_window(app: &AppHandle, job_id: &str, action_id: &str) -> String {
    let label = format!("progress-{job_id}");
    let url = format!("progress.html?job={job_id}&action={action_id}");
    let app_on_main = app.clone();
    let label_on_main = label.clone();
    let _ = app.run_on_main_thread(move || {
        let _ =
            WebviewWindowBuilder::new(&app_on_main, &label_on_main, WebviewUrl::App(url.into()))
                .title("Zapit")
                .inner_size(420.0, 160.0)
                .resizable(false)
                .maximizable(false)
                .build();
    });
    label
}

fn notify(app: &AppHandle, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title("Zapit")
        .body(body)
        .show();
}

// ---- IPC commands ----

/// The hidden main window signals that the action registry is loaded and the
/// plan://request listener is attached.
#[tauri::command]
fn webview_ready(state: State<JobState>) {
    let (lock, cvar) = &*state.webview_ready;
    if let Ok(mut ready) = lock.lock() {
        *ready = true;
        cvar.notify_all();
    }
}

/// The webview answers a plan://request with the built EnginePlan.
#[tauri::command]
fn plan_built(job_id: String, plan: plan::EnginePlan, state: State<JobState>) {
    respond(&state, &job_id, jobs::PlanResponse::Plan(plan));
}

/// The action needs user input first — `window` names the options window.
#[tauri::command]
fn plan_needs_options(job_id: String, window: String, state: State<JobState>) {
    respond(&state, &job_id, jobs::PlanResponse::NeedsOptions(window));
}

/// The action rejected the input with a user-facing message.
#[tauri::command]
fn plan_failed(job_id: String, message: String, state: State<JobState>) {
    respond(&state, &job_id, jobs::PlanResponse::Failed(message));
}

fn respond(state: &State<JobState>, job_id: &str, response: jobs::PlanResponse) {
    if let Ok(mut pending) = state.pending_plans.lock() {
        if let Some(tx) = pending.remove(job_id) {
            let _ = tx.send(response);
        }
    }
}

/// An options window (Trim, …) submits its values.
#[tauri::command]
fn submit_options(
    job_id: String,
    options: std::collections::BTreeMap<String, String>,
    state: State<JobState>,
) {
    if let Ok(pending) = state.pending_options.lock() {
        if let Some(tx) = pending.get(&job_id) {
            let _ = tx.send(Some(options));
        }
    }
}

/// A JS-engine step (pdf-lib, …) reports completion; `error` is a user-facing
/// message on failure, absent on success.
#[tauri::command]
fn js_done(job_id: String, error: Option<String>, state: State<JobState>) {
    if let Ok(pending) = state.pending_js.lock() {
        if let Some(tx) = pending.get(&job_id) {
            let _ = tx.send(error);
        }
    }
}

/// File IO bridge for JS engines: the webview is our own code (strict CSP, no
/// remote content), so it may read/write user files through these commands.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, error::AppError> {
    let bytes = std::fs::read(&path)
        .map_err(|e| error::AppError::system(format!("could not read {path}: {e}")))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Content travels base64-encoded in a normal argument — raw IPC bodies proved
/// unreliable on this webview, and engine outputs are small enough to eat the
/// 33% overhead.
#[tauri::command]
fn write_file_bytes(path: String, data_b64: String) -> Result<(), error::AppError> {
    let bytes = base64_decode(&data_b64)
        .ok_or_else(|| error::AppError::system("invalid base64 payload"))?;
    std::fs::write(&path, bytes)
        .map_err(|e| error::AppError::system(format!("could not write {path}: {e}")))?;
    Ok(())
}

/// Standard-alphabet base64 decode; a dependency would be overkill for one call.
fn base64_decode(text: &str) -> Option<Vec<u8>> {
    fn value(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some(u32::from(c - b'A')),
            b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let input: Vec<u8> = text.bytes().filter(|b| *b != b'=').collect();
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    for chunk in input.chunks(4) {
        let mut acc: u32 = 0;
        for (i, &c) in chunk.iter().enumerate() {
            acc |= value(c)? << (18 - 6 * i);
        }
        let byte_count = match chunk.len() {
            4 => 3,
            3 => 2,
            2 => 1,
            _ => return None,
        };
        for i in 0..byte_count {
            #[allow(clippy::cast_possible_truncation)]
            out.push(((acc >> (16 - 8 * i)) & 0xFF) as u8);
        }
    }
    Some(out)
}

/// I6's Metadata window reads EXIF itself; the strip decision comes back
/// through the normal options round-trip.
#[tauri::command]
fn read_exif(path: String) -> Result<Vec<exif::ExifEntry>, error::AppError> {
    exif::read_exif(std::path::Path::new(&path))
}

// ---- Trim window previews (ADR 005) ----

/// Let the webview stream one specific file over the asset protocol. The static
/// scope in `tauri.conf.json` is empty, so nothing is readable until a window
/// asks for a path it was handed in its own URL.
#[tauri::command]
fn preview_allow(app: AppHandle, path: String) -> Result<(), error::AppError> {
    let file = std::path::Path::new(&path);
    if !file.is_file() {
        return Err(error::AppError::user(format!("File not found: {path}")));
    }
    share(&app, file)
        .map(|_| ())
        .ok_or_else(|| error::AppError::system("could not share the file with the window"))
}

/// Grant one file to `zapitmedia://`, returning its path on success. The scheme
/// serves nothing that has not been through here.
fn share(app: &AppHandle, file: &std::path::Path) -> Option<String> {
    match app.state::<JobState>().allowed_media.lock() {
        Ok(mut allowed) => {
            allowed.insert(file.to_path_buf());
            Some(file.to_string_lossy().into_owned())
        }
        Err(_) => {
            log::warn!("could not share {}: state poisoned", file.display());
            None
        }
    }
}

/// Filmstrip + waveform for the timeline. Either can fail without sinking the
/// window — they are navigation aids, not the edit itself.
#[tauri::command]
async fn preview_assets(
    app: AppHandle,
    job_id: String,
    path: String,
    has_video: bool,
    has_audio: bool,
    duration_s: f64,
) -> Result<preview::PreviewAssets, error::AppError> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let sidecars = jobs::sidecar_dir(&handle)?;
        let dir = preview::preview_dir(&job_id);
        std::fs::create_dir_all(&dir)?;
        let src = std::path::Path::new(&path);
        let mut assets = preview::PreviewAssets::default();
        if has_video && duration_s > 0.0 {
            let out = dir.join("strip.png");
            match preview::filmstrip(&sidecars, src, &out, duration_s) {
                Ok(()) => assets.filmstrip = share(&handle, &out),
                Err(err) => log::info!("filmstrip unavailable: {err}"),
            }
        }
        if has_audio {
            let out = dir.join("wave.png");
            match preview::waveform(&sidecars, src, &out) {
                Ok(()) => assets.waveform = share(&handle, &out),
                Err(err) => log::info!("waveform unavailable: {err}"),
            }
        }
        Ok(assets)
    })
    .await
    .map_err(|e| error::AppError::system(format!("preview task failed: {e}")))?
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PreviewProgress<'a> {
    job_id: &'a str,
    percent: u8,
}

/// Transcode a low-res stand-in for containers WebView2 cannot decode. Reported
/// through `preview://progress` and abandonable via `cancel_preview`.
#[tauri::command]
async fn build_preview_proxy(
    app: AppHandle,
    job_id: String,
    path: String,
    has_video: bool,
    source_height: Option<u32>,
    duration_s: f64,
) -> Result<String, error::AppError> {
    let cancel = sidecar::CancelFlag::default();
    if let Ok(mut flags) = app.state::<JobState>().preview_cancels.lock() {
        flags.insert(job_id.clone(), cancel.clone());
    }
    let handle = app.clone();
    let id = job_id.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let sidecars = jobs::sidecar_dir(&handle)?;
        let dir = preview::preview_dir(&id);
        std::fs::create_dir_all(&dir)?;
        let out = dir.join(preview::proxy_name(has_video));
        // Truncation and sign loss are both fine: a duration is positive and
        // far below u64::MAX microseconds.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let total_us = if duration_s > 0.0 {
            Some((duration_s * 1_000_000.0) as u64)
        } else {
            None
        };
        let app_for_progress = handle.clone();
        let id_for_progress = id.clone();
        preview::proxy(
            &sidecars,
            &preview::ProxySpec {
                src: std::path::Path::new(&path),
                out: &out,
                has_video,
                source_height,
                total_us,
            },
            &cancel,
            move |percent| {
                let _ = app_for_progress.emit(
                    "preview://progress",
                    PreviewProgress {
                        job_id: &id_for_progress,
                        percent,
                    },
                );
            },
        )?;
        share(&handle, &out).ok_or_else(|| error::AppError::system("could not share the preview"))
    })
    .await
    .map_err(|e| error::AppError::system(format!("preview task failed: {e}")))?;

    if let Ok(mut flags) = app.state::<JobState>().preview_cancels.lock() {
        flags.remove(&job_id);
    }
    outcome
}

/// Abandon an in-flight proxy build without cancelling the job behind it.
#[tauri::command]
fn cancel_preview(job_id: String, state: State<JobState>) {
    if let Ok(flags) = state.preview_cancels.lock() {
        if let Some(flag) = flags.get(&job_id) {
            flag.cancel();
        }
    }
}

/// G1's result window compares a pasted hash in constant time.
#[tauri::command]
fn compare_hash(a: String, b: String) -> bool {
    hash::hashes_match(&a, &b)
}

/// The webview answers `menu://request` with the enabled action list.
#[tauri::command]
fn menu_built(actions: Vec<registry_menu::MenuAction>, state: State<JobState>) {
    if let Ok(mut pending) = state.pending_menu.lock() {
        if let Some(tx) = pending.take() {
            let _ = tx.send(actions);
        }
    }
}

#[tauri::command]
fn get_config() -> config::Config {
    config::load()
}

#[tauri::command]
fn save_config(config: config::Config) -> Result<(), error::AppError> {
    config::save(&config).map_err(|e| error::AppError::system(e.to_string()))
}

/// Settings "apply": rewrite the menu from the currently enabled actions.
#[tauri::command]
fn apply_menu(actions: Vec<registry_menu::MenuAction>) -> Result<(), error::AppError> {
    let exe = std::env::current_exe()
        .map_err(|e| error::AppError::system(format!("could not locate the app: {e}")))?;
    registry_menu::install(&actions, &exe)
}

/// Settings "remove": sweep every extension the catalog knows about.
#[tauri::command]
fn remove_menu(extensions: Vec<String>) -> Result<(), error::AppError> {
    registry_menu::uninstall(&extensions)
}

/// True when our menu keys are present — Settings shows install vs remove.
#[tauri::command]
fn menu_installed() -> bool {
    registry_menu::is_installed()
}

#[tauri::command]
fn log_folder() -> String {
    logging::log_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Cancel button in a progress window.
#[tauri::command]
fn cancel_job(job_id: String, state: State<JobState>) {
    if let Ok(flags) = state.cancel_flags.lock() {
        if let Some(flag) = flags.get(&job_id) {
            flag.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    // CLI parsing tests live in cli.rs; nothing to test at the wiring layer yet.
}
