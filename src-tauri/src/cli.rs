//! CLI grammar (§4), hand-parsed: four verbs, flat flags. `tauri-plugin-cli`
//! stays wired for future use, but the grammar is simple enough that a direct
//! parser is clearer and unit-testable without a Tauri context.

use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    /// `run <action-id> [--opt k=v]... --file <path>` — one file per Explorer
    /// process; the dispatcher aggregates. Options carry the preset the user
    /// picked in the context-menu flyout (§7.3).
    Run {
        action_id: String,
        file: PathBuf,
        options: BTreeMap<String, String>,
    },
    /// `smoke <action-id> --file <f>... [--opt k=v]... [--out <dir>]` — headless.
    Smoke {
        action_id: String,
        files: Vec<PathBuf>,
        options: BTreeMap<String, String>,
        out_dir: Option<PathBuf>,
    },
    Settings,
    InstallMenu,
    UninstallMenu,
    Help,
    /// Bare launch (double-clicked exe): treated as `settings` later; distinct for now.
    None,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ParseError(pub String);

pub fn parse(args: &[String]) -> Result<Invocation, ParseError> {
    let mut it = args.iter();
    let Some(verb) = it.next() else {
        return Ok(Invocation::None);
    };
    match verb.as_str() {
        "--help" | "-h" => Ok(Invocation::Help),
        "settings" => Ok(Invocation::Settings),
        "install-menu" => Ok(Invocation::InstallMenu),
        "uninstall-menu" => Ok(Invocation::UninstallMenu),
        "run" => {
            let action_id = expect_action_id(it.next())?;
            let mut file = None;
            let mut options = BTreeMap::new();
            let rest: Vec<&String> = it.collect();
            let mut i = 0;
            while i < rest.len() {
                match rest[i].as_str() {
                    "--file" => {
                        let value = rest
                            .get(i + 1)
                            .ok_or_else(|| ParseError("--file needs a path".into()))?;
                        file = Some(PathBuf::from(value));
                        i += 2;
                    }
                    "--opt" => {
                        let value = rest
                            .get(i + 1)
                            .ok_or_else(|| ParseError("--opt needs k=v".into()))?;
                        let (k, v) = value
                            .split_once('=')
                            .ok_or_else(|| ParseError(format!("--opt '{value}' is not k=v")))?;
                        options.insert(k.to_string(), v.to_string());
                        i += 2;
                    }
                    other => return Err(ParseError(format!("unexpected argument '{other}'"))),
                }
            }
            let file = file.ok_or_else(|| ParseError("run requires --file <path>".into()))?;
            Ok(Invocation::Run {
                action_id,
                file,
                options,
            })
        }
        "smoke" => {
            let action_id = expect_action_id(it.next())?;
            let mut files = Vec::new();
            let mut options = BTreeMap::new();
            let mut out_dir = None;
            let rest: Vec<&String> = it.collect();
            let mut i = 0;
            while i < rest.len() {
                match rest[i].as_str() {
                    "--file" => {
                        let value = rest
                            .get(i + 1)
                            .ok_or_else(|| ParseError("--file needs a path".into()))?;
                        files.push(PathBuf::from(value));
                        i += 2;
                    }
                    "--opt" => {
                        let value = rest
                            .get(i + 1)
                            .ok_or_else(|| ParseError("--opt needs k=v".into()))?;
                        let (k, v) = value
                            .split_once('=')
                            .ok_or_else(|| ParseError(format!("--opt '{value}' is not k=v")))?;
                        options.insert(k.to_string(), v.to_string());
                        i += 2;
                    }
                    "--out" => {
                        let value = rest
                            .get(i + 1)
                            .ok_or_else(|| ParseError("--out needs a directory".into()))?;
                        out_dir = Some(PathBuf::from(value));
                        i += 2;
                    }
                    "--help" => return Ok(Invocation::Help),
                    other => return Err(ParseError(format!("unexpected argument '{other}'"))),
                }
            }
            if files.is_empty() {
                return Err(ParseError("smoke requires at least one --file".into()));
            }
            Ok(Invocation::Smoke {
                action_id,
                files,
                options,
                out_dir,
            })
        }
        other => Err(ParseError(format!("unknown command '{other}'"))),
    }
}

fn expect_action_id(arg: Option<&String>) -> Result<String, ParseError> {
    match arg {
        Some(id) if !id.starts_with('-') => Ok(id.clone()),
        _ => Err(ParseError("expected an <action-id>".into())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn run_with_file() {
        let inv = parse(&v(&["run", "extract-audio", "--file", "C:\\a b\\x.mp4"]));
        assert_eq!(
            inv,
            Ok(Invocation::Run {
                action_id: "extract-audio".into(),
                file: PathBuf::from("C:\\a b\\x.mp4"),
                options: BTreeMap::new(),
            })
        );
    }

    #[test]
    fn run_carries_preset_options() {
        let inv = parse(&v(&[
            "run",
            "compress-video",
            "--opt",
            "targetMb=25",
            "--file",
            "C:\\a\\x.mp4",
        ]));
        match inv {
            Ok(Invocation::Run { options, .. }) => {
                assert_eq!(options.get("targetMb").map(String::as_str), Some("25"));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn run_requires_file() {
        assert!(parse(&v(&["run", "extract-audio"])).is_err());
    }

    #[test]
    fn smoke_full_grammar() {
        let inv = parse(&v(&[
            "smoke", "noop", "--file", "a.bin", "--file", "b.bin", "--opt", "k=v", "--out", "out",
        ]));
        match inv {
            Ok(Invocation::Smoke {
                action_id,
                files,
                options,
                out_dir,
            }) => {
                assert_eq!(action_id, "noop");
                assert_eq!(files.len(), 2);
                assert_eq!(options.get("k").map(String::as_str), Some("v"));
                assert_eq!(out_dir, Some(PathBuf::from("out")));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn smoke_requires_a_file() {
        assert!(parse(&v(&["smoke", "noop"])).is_err());
    }

    #[test]
    fn plain_verbs() {
        assert_eq!(parse(&v(&["settings"])), Ok(Invocation::Settings));
        assert_eq!(parse(&v(&["install-menu"])), Ok(Invocation::InstallMenu));
        assert_eq!(
            parse(&v(&["uninstall-menu"])),
            Ok(Invocation::UninstallMenu)
        );
        assert_eq!(parse(&v(&[])), Ok(Invocation::None));
        assert_eq!(parse(&v(&["--help"])), Ok(Invocation::Help));
    }

    #[test]
    fn unknown_verb_errors() {
        assert!(parse(&v(&["frobnicate"])).is_err());
    }
}
