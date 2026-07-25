//! Multi-select aggregation (§4). Explorer launches one process per selected
//! file; followers forward argv to the leader (single-instance plugin) and this
//! module buckets them: each arriving `run` resets its action's 400 ms
//! deadline; on expiry the bucket dispatches as ONE job with a naturally
//! sorted, deduped file list.
//!
//! The bucketing logic is pure (`Buckets`) so unit tests need no clock or
//! threads; the timing loop lives in `spawn_dispatcher`.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::time::{Duration, Instant};

pub const AGGREGATION_WINDOW: Duration = Duration::from_millis(400);

pub type Options = BTreeMap<String, String>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    pub action_id: String,
    pub files: Vec<PathBuf>,
    pub options: Options,
}

/// Buckets are keyed by action **and** options: selecting five files and
/// choosing "Under 25 MB" must not merge with a later "Under 50 MB" on the same
/// action, or one of the two choices would be silently discarded.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct BucketKey {
    action_id: String,
    options: Vec<(String, String)>,
}

impl BucketKey {
    fn new(action_id: String, options: &Options) -> Self {
        BucketKey {
            action_id,
            // BTreeMap iterates in key order, so equal option sets give equal keys.
            options: options
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
        }
    }
}

#[derive(Default)]
pub struct Buckets {
    pending: HashMap<BucketKey, (Vec<PathBuf>, Instant)>,
}

impl Buckets {
    /// Record one arriving `run` invocation; that bucket's deadline resets.
    pub fn add(&mut self, action_id: String, options: Options, file: PathBuf, now: Instant) {
        let deadline = now + AGGREGATION_WINDOW;
        let key = BucketKey::new(action_id, &options);
        let entry = self
            .pending
            .entry(key)
            .or_insert_with(|| (Vec::new(), deadline));
        entry.0.push(file);
        entry.1 = deadline;
    }

    /// Pop every bucket whose deadline has passed, as ready-to-run jobs.
    pub fn take_expired(&mut self, now: Instant) -> Vec<Job> {
        let expired: Vec<BucketKey> = self
            .pending
            .iter()
            .filter(|(_, (_, deadline))| *deadline <= now)
            .map(|(key, _)| key.clone())
            .collect();
        let mut jobs = Vec::new();
        for key in expired {
            if let Some((files, _)) = self.pending.remove(&key) {
                jobs.push(Job {
                    action_id: key.action_id,
                    files: normalize(files),
                    options: key.options.into_iter().collect(),
                });
            }
        }
        jobs
    }

    /// The soonest deadline, for the dispatcher's sleep. None when idle.
    pub fn next_deadline(&self) -> Option<Instant> {
        self.pending.values().map(|(_, d)| *d).min()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

/// Explorer does not preserve selection order across processes (§4 documents
/// this), so: natural sort (numeric runs compare as numbers, case-insensitive)
/// then dedupe.
fn normalize(mut files: Vec<PathBuf>) -> Vec<PathBuf> {
    files.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));
    files.dedup();
    files
}

fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek().copied(), bi.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ac), Some(bc)) => {
                if ac.is_ascii_digit() && bc.is_ascii_digit() {
                    let an = take_number(&mut ai);
                    let bn = take_number(&mut bi);
                    match an.cmp(&bn) {
                        Ordering::Equal => {}
                        other => return other,
                    }
                } else {
                    let al = ac.to_lowercase().next().unwrap_or(ac);
                    let bl = bc.to_lowercase().next().unwrap_or(bc);
                    match al.cmp(&bl) {
                        Ordering::Equal => {
                            ai.next();
                            bi.next();
                        }
                        other => return other,
                    }
                }
            }
        }
    }
}

fn take_number(it: &mut std::iter::Peekable<std::str::Chars>) -> u128 {
    let mut n: u128 = 0;
    while let Some(c) = it.peek().copied() {
        if let Some(d) = c.to_digit(10) {
            n = n.saturating_mul(10).saturating_add(u128::from(d));
            it.next();
        } else {
            break;
        }
    }
    n
}

pub enum DispatchMsg {
    Run {
        action_id: String,
        file: PathBuf,
        options: Options,
    },
}

/// Convenience used by the single-instance callback and the leader itself.
pub fn send_run(tx: &Sender<DispatchMsg>, action_id: String, file: PathBuf, options: Options) {
    let _ = tx.send(DispatchMsg::Run {
        action_id,
        file,
        options,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t0() -> Instant {
        Instant::now()
    }

    fn no_opts() -> Options {
        Options::new()
    }

    fn opts(pairs: &[(&str, &str)]) -> Options {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn different_presets_stay_separate_jobs() {
        let mut b = Buckets::default();
        let start = t0();
        b.add(
            "compress-video".into(),
            opts(&[("targetMb", "25")]),
            PathBuf::from("a.mp4"),
            start,
        );
        b.add(
            "compress-video".into(),
            opts(&[("targetMb", "50")]),
            PathBuf::from("b.mp4"),
            start,
        );
        let jobs = b.take_expired(start + Duration::from_millis(500));
        assert_eq!(jobs.len(), 2, "one job per preset, never merged");
    }

    #[test]
    fn same_preset_on_many_files_merges() {
        let mut b = Buckets::default();
        let start = t0();
        for name in ["a.mp4", "b.mp4", "c.mp4"] {
            b.add(
                "compress-video".into(),
                opts(&[("targetMb", "25")]),
                PathBuf::from(name),
                start,
            );
        }
        let jobs = b.take_expired(start + Duration::from_millis(500));
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].files.len(), 3);
        assert_eq!(
            jobs[0].options.get("targetMb").map(String::as_str),
            Some("25")
        );
    }

    #[test]
    fn same_action_files_merge_into_one_job() {
        let mut b = Buckets::default();
        let start = t0();
        b.add("noop".into(), no_opts(), PathBuf::from("b.bin"), start);
        b.add(
            "noop".into(),
            no_opts(),
            PathBuf::from("a.bin"),
            start + Duration::from_millis(100),
        );
        assert!(
            b.take_expired(start + Duration::from_millis(300))
                .is_empty(),
            "deadline was reset by the second arrival"
        );
        let jobs = b.take_expired(start + Duration::from_millis(600));
        assert_eq!(jobs.len(), 1);
        assert_eq!(
            jobs[0].files,
            vec![PathBuf::from("a.bin"), PathBuf::from("b.bin")]
        );
        assert!(b.is_empty());
    }

    #[test]
    fn different_actions_stay_separate_jobs() {
        let mut b = Buckets::default();
        let start = t0();
        b.add("noop".into(), no_opts(), PathBuf::from("a.bin"), start);
        b.add("checksum".into(), no_opts(), PathBuf::from("a.bin"), start);
        let jobs = b.take_expired(start + Duration::from_millis(500));
        assert_eq!(jobs.len(), 2);
    }

    #[test]
    fn duplicates_are_removed() {
        let mut b = Buckets::default();
        let start = t0();
        b.add("noop".into(), no_opts(), PathBuf::from("a.bin"), start);
        b.add("noop".into(), no_opts(), PathBuf::from("a.bin"), start);
        let jobs = b.take_expired(start + Duration::from_millis(500));
        assert_eq!(jobs[0].files.len(), 1);
    }

    #[test]
    fn natural_sort_orders_numbered_files_sanely() {
        let files = vec![
            PathBuf::from("clip10.mp4"),
            PathBuf::from("clip2.mp4"),
            PathBuf::from("Clip1.mp4"),
        ];
        let files = normalize(files);
        assert_eq!(
            files,
            vec![
                PathBuf::from("Clip1.mp4"),
                PathBuf::from("clip2.mp4"),
                PathBuf::from("clip10.mp4"),
            ]
        );
    }

    #[test]
    fn next_deadline_tracks_minimum() {
        let mut b = Buckets::default();
        assert!(b.next_deadline().is_none());
        let start = t0();
        b.add("a".into(), no_opts(), PathBuf::from("x"), start);
        b.add(
            "b".into(),
            no_opts(),
            PathBuf::from("y"),
            start + Duration::from_millis(50),
        );
        let d = b.next_deadline().expect("has deadline");
        assert_eq!(d, start + AGGREGATION_WINDOW);
    }
}
