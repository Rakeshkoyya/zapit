//! Config (§5.7): `%APPDATA%\Zapit\config.json`, schema-versioned.
//! A corrupt file is renamed `.bad` and replaced with defaults — never a crash.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutputPolicy {
    /// Output lands next to the source file (the default UX contract).
    SameFolder,
    /// Ask per job (used automatically when the source dir is read-only).
    Ask,
    /// Always write into `fixed_dir`.
    Fixed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Schema version; bump + migrate on breaking changes.
    pub v: u32,
    pub output_policy: OutputPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_dir: Option<PathBuf>,
    /// Action ids the user disabled in Settings (M6 rewrites the menu from this).
    #[serde(default)]
    pub disabled_actions: Vec<String>,
    /// Registry parent keys that did not exist before we installed the menu.
    /// Uninstall removes exactly these — never a key the user already had
    /// (GOALS.md DoD item 6: the registry ends up as it started).
    #[serde(default)]
    pub created_registry_keys: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            v: 1,
            output_policy: OutputPolicy::SameFolder,
            fixed_dir: None,
            disabled_actions: Vec::new(),
            created_registry_keys: Vec::new(),
        }
    }
}

pub fn config_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|base| PathBuf::from(base).join("Zapit").join("config.json"))
}

pub fn load() -> Config {
    let Some(path) = config_path() else {
        return Config::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return Config::default();
    };
    match serde_json::from_str::<Config>(&raw) {
        Ok(cfg) if cfg.v == 1 => cfg,
        _ => {
            // Corrupt or from-the-future: keep the evidence, start fresh.
            let _ = fs::rename(&path, path.with_extension("json.bad"));
            let fresh = Config::default();
            let _ = save(&fresh);
            fresh
        }
    }
}

pub fn save(cfg: &Config) -> std::io::Result<()> {
    let Some(path) = config_path() else {
        return Ok(());
    };
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(std::io::Error::other)?;
    fs::write(path, json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_v1_same_folder() {
        let cfg = Config::default();
        assert_eq!(cfg.v, 1);
        assert_eq!(cfg.output_policy, OutputPolicy::SameFolder);
    }

    #[test]
    fn roundtrips_through_json() {
        let cfg = Config::default();
        let json = serde_json::to_string(&cfg).expect("serializes");
        let back: Config = serde_json::from_str(&json).expect("deserializes");
        assert_eq!(back.output_policy, cfg.output_policy);
    }
}
