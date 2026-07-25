//! File logger (§5.7): `%APPDATA%\Zapit\logs\zapit.log`, rotating at
//! 1 MB keeping 5 files. Deliberately dependency-free — a `log::Log` impl over
//! a mutex-guarded appender is all this app needs.

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_FILES: u32 = 5;

struct FileLogger {
    path: PathBuf,
    file: Mutex<Option<fs::File>>,
}

pub fn log_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|base| PathBuf::from(base).join("Zapit").join("logs"))
}

/// Install the logger. Failures are swallowed on purpose: logging must never
/// take the app down (§ principles: "no dead ends" applies to users, not logs).
pub fn init() {
    let Some(dir) = log_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("zapit.log");
    let logger = FileLogger {
        path,
        file: Mutex::new(None),
    };
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(log::LevelFilter::Info);
    }
}

impl FileLogger {
    fn rotate_if_needed(&self) {
        let Ok(meta) = fs::metadata(&self.path) else {
            return;
        };
        if meta.len() < MAX_BYTES {
            return;
        }
        // zapit.log -> zapit.log.1 -> ... -> zapit.log.5 (dropped)
        let rotated = |n: u32| self.path.with_extension(format!("log.{n}"));
        let _ = fs::remove_file(rotated(MAX_FILES));
        for n in (1..MAX_FILES).rev() {
            let _ = fs::rename(rotated(n), rotated(n + 1));
        }
        let _ = fs::rename(&self.path, rotated(1));
        if let Ok(mut guard) = self.file.lock() {
            *guard = None;
        }
    }
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        self.rotate_if_needed();
        let Ok(mut guard) = self.file.lock() else {
            return;
        };
        if guard.is_none() {
            *guard = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .ok();
        }
        if let Some(file) = guard.as_mut() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = writeln!(file, "{} [{}] {}", now, record.level(), record.args());
        }
    }

    fn flush(&self) {}
}
