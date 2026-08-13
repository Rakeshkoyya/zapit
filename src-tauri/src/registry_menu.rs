//! Per-user context-menu integration (§5.5). Everything lives under
//! `HKCU\Software\Classes` — no admin rights, and uninstall removes exactly the
//! keys we created and nothing else.
//!
//! Layout per extension:
//! ```text
//! SystemFileAssociations\.mp4\shell\Zapit      MUIVerb, Icon, SubCommands=""
//! SystemFileAssociations\.mp4\shell\Zapit\shell\010_extract-audio
//!     MUIVerb, MultiSelectModel, \command = "<exe>" run extract-audio --file "%1"
//! ```
//! `SubCommands=""` (empty, present) is what turns the parent into a flyout
//! whose children come from its own `shell` subkey.

use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::path::Path;
use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS, KEY_READ};
use winreg::RegKey;

const CLASSES: &str = r"Software\Classes";
const VERB: &str = "Zapit";
/// The `*` (any-file) class needs a **different key name** from the
/// per-extension verb. Explorer dedupes context-menu verbs by key name, so when
/// both `*\shell\Zapit` and `SystemFileAssociations\.mp4\shell\Zapit` applied to
/// the same file, one flyout shadowed the other and most video actions never
/// appeared. Display text comes from MUIVerb, so both still read "Zapit".
const VERB_ANY: &str = "ZapitAnyFile";
const MENU_LABEL: &str = "Zapit";

/// One entry inside an action's flyout; `options` become `--opt k=v` on the
/// command line, so choosing a preset never opens a window (§7.3).
#[derive(Debug, Clone, Deserialize)]
pub struct MenuPreset {
    pub label: String,
    #[serde(default)]
    pub options: std::collections::BTreeMap<String, String>,
}

/// The webview hands us this for each enabled action (mirrors QuickAction).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuAction {
    pub id: String,
    pub menu_label: String,
    /// Lowercase, no dot. Empty = "any file" (registers under `*`).
    pub extensions: Vec<String>,
    pub multi_file: String,
    /// Non-empty → this entry becomes a nested flyout of preset choices.
    #[serde(default)]
    pub presets: Vec<MenuPreset>,
}

/// `"<exe>" run <id> [--opt k=v]... --file "%1"` — argv only, no shell string.
/// `%1` stays last so Explorer's substitution lands on the file argument.
fn command_line(exe: &str, action_id: &str, options: &[(&str, &str)]) -> String {
    let mut line = format!("\"{exe}\" run {action_id}");
    for (key, value) in options {
        line.push_str(&format!(" --opt {key}={value}"));
    }
    line.push_str(" --file \"%1\"");
    line
}

fn assoc_path(extension: &str) -> String {
    if extension.is_empty() {
        // The `*` class is the "any file" hook (G1 checksum), under its own
        // verb name so it cannot shadow a per-extension flyout.
        format!(r"{CLASSES}\*\shell\{VERB_ANY}")
    } else {
        format!(r"{CLASSES}\SystemFileAssociations\.{extension}\shell\{VERB}")
    }
}

/// Builds before this fix wrote the any-file verb as `*\shell\Zapit`. Uninstall
/// keys off the current name, so that key would linger forever and keep
/// shadowing every per-extension menu — sweep it explicitly.
fn remove_legacy_star_verb() {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let legacy = format!(r"{CLASSES}\*\shell\{VERB}");
    if hkcu.open_subkey_with_flags(&legacy, KEY_READ).is_ok() {
        let _ = hkcu.delete_subkey_all(&legacy);
    }
}

/// Ancestors of a verb key, outermost first — the keys an install may have to
/// create and an uninstall may therefore remove.
fn parent_chain(extension: &str) -> Vec<String> {
    if extension.is_empty() {
        vec![format!(r"{CLASSES}\*"), format!(r"{CLASSES}\*\shell")]
    } else {
        vec![
            format!(r"{CLASSES}\SystemFileAssociations"),
            format!(r"{CLASSES}\SystemFileAssociations\.{extension}"),
            format!(r"{CLASSES}\SystemFileAssociations\.{extension}\shell"),
        ]
    }
}

/// Write menu keys for the given actions. Idempotent: the tree is removed
/// first, so a rewrite after a Settings toggle never leaves stale entries.
///
/// Parent keys that did not already exist are recorded in the config so
/// uninstall can remove exactly what we added and nothing else.
pub fn install(actions: &[MenuAction], exe: &Path) -> AppResult<()> {
    uninstall_internal(&collect_extensions(actions))?;
    remove_legacy_star_verb();

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let exe_str = exe.to_string_lossy().into_owned();
    let mut created: Vec<String> = Vec::new();
    for extension in collect_extensions(actions) {
        for parent in parent_chain(&extension) {
            if hkcu.open_subkey_with_flags(&parent, KEY_READ).is_err() {
                created.push(parent);
            }
        }
    }

    // Group actions by extension, preserving registry-list order for numbering.
    for extension in collect_extensions(actions) {
        let relevant: Vec<(usize, &MenuAction)> = actions
            .iter()
            .enumerate()
            .filter(|(_, a)| {
                if extension.is_empty() {
                    a.extensions.is_empty()
                } else {
                    // Any-file actions (G1 checksum) belong in every flyout too.
                    // Relying on the `*` verb to supply them meant a video's
                    // menu depended on two verbs coexisting, which Explorer
                    // does not allow when they share a key name.
                    a.extensions.contains(&extension) || a.extensions.is_empty()
                }
            })
            .collect();
        if relevant.is_empty() {
            continue;
        }

        let (parent, _) = hkcu
            .create_subkey(assoc_path(&extension))
            .map_err(|e| AppError::system(format!("could not write the menu entry: {e}")))?;
        parent.set_value("MUIVerb", &MENU_LABEL)?;
        parent.set_value("Icon", &exe_str)?;
        // Present-but-empty: makes Windows read children from our shell subkey.
        parent.set_value("SubCommands", &"")?;

        for (order, action) in relevant {
            // Numeric prefix controls display order; the id after it must match
            // QuickAction.id (dispatch parses the verb name).
            let key_name = format!("{:03}_{}", (order + 1) * 10, action.id);
            let (item, _) = parent
                .create_subkey(format!(r"shell\{key_name}"))
                .map_err(|e| AppError::system(format!("could not write a menu item: {e}")))?;
            item.set_value("MUIVerb", &action.menu_label)?;
            if action.multi_file != "single" {
                // Player = one process per selected file, no 15-file prompt.
                item.set_value("MultiSelectModel", &"Player")?;
            }

            if action.presets.is_empty() {
                let (command, _) = item.create_subkey("command")?;
                command.set_value("", &command_line(&exe_str, &action.id, &[]))?;
                continue;
            }

            // Nested flyout: the entry itself gets SubCommands="" and its own
            // shell subkey, exactly like the top-level Zapit verb.
            item.set_value("SubCommands", &"")?;
            for (preset_order, preset) in action.presets.iter().enumerate() {
                let preset_key = format!("{:03}_p{}", (preset_order + 1) * 10, preset_order);
                let (choice, _) = item
                    .create_subkey(format!(r"shell\{preset_key}"))
                    .map_err(|e| AppError::system(format!("could not write a preset: {e}")))?;
                choice.set_value("MUIVerb", &preset.label)?;
                if action.multi_file != "single" {
                    choice.set_value("MultiSelectModel", &"Player")?;
                }
                let pairs: Vec<(&str, &str)> = preset
                    .options
                    .iter()
                    .map(|(k, v)| (k.as_str(), v.as_str()))
                    .collect();
                let (command, _) = choice.create_subkey("command")?;
                command.set_value("", &command_line(&exe_str, &action.id, &pairs))?;
            }
        }
    }

    // Merge, never replace: a second install finds the parents already there
    // (we made them the first time), so replacing would forget them.
    let mut config = crate::config::load();
    created.extend(config.created_registry_keys.iter().cloned());
    created.sort();
    created.dedup();
    config.created_registry_keys = created;
    let _ = crate::config::save(&config);
    Ok(())
}

/// Remove every key we own, then the parent keys our install created (recorded
/// in the config) — never one the user already had.
pub fn uninstall(extensions: &[String]) -> AppResult<()> {
    uninstall_internal(extensions)?;
    remove_legacy_star_verb();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut config = crate::config::load();
    // Innermost first: `…\.mp4\shell` must go before `…\.mp4`.
    let mut ours = config.created_registry_keys.clone();
    ours.sort_by_key(|path| std::cmp::Reverse(path.len()));
    for path in &ours {
        prune_if_empty(&hkcu, path);
    }
    config.created_registry_keys.clear();
    let _ = crate::config::save(&config);
    Ok(())
}

fn uninstall_internal(extensions: &[String]) -> AppResult<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for extension in extensions {
        let path = assoc_path(extension);
        // Deleting a missing key is success — uninstall must be idempotent.
        if hkcu.open_subkey_with_flags(&path, KEY_READ).is_ok() {
            hkcu.delete_subkey_all(&path)
                .map_err(|e| AppError::system(format!("could not remove a menu entry: {e}")))?;
        }
    }
    Ok(())
}

fn prune_if_empty(hkcu: &RegKey, path: &str) {
    let Ok(key) = hkcu.open_subkey_with_flags(path, KEY_ALL_ACCESS) else {
        return;
    };
    let has_subkeys = key.enum_keys().next().is_some();
    let has_values = key.enum_values().any(|v| match v {
        // A lone empty default value counts as "nothing here".
        Ok((name, _)) => !name.is_empty(),
        Err(_) => true,
    });
    drop(key);
    if !has_subkeys && !has_values {
        let _ = hkcu.delete_subkey(path);
    }
}

/// Cheap presence probe for the Settings screen: any of our verb keys existing
/// counts as installed (a partial state still needs a "remove" offer).
pub fn is_installed() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let star = hkcu
        .open_subkey_with_flags(assoc_path(""), KEY_READ)
        .is_ok()
        // A pre-fix install left its any-file verb under the old name; Settings
        // must still offer "remove" for it.
        || hkcu
            .open_subkey_with_flags(format!(r"{CLASSES}\*\shell\{VERB}"), KEY_READ)
            .is_ok();
    if star {
        return true;
    }
    let Ok(assocs) =
        hkcu.open_subkey_with_flags(format!(r"{CLASSES}\SystemFileAssociations"), KEY_READ)
    else {
        return false;
    };
    assocs.enum_keys().flatten().any(|extension| {
        assocs
            .open_subkey_with_flags(format!(r"{extension}\shell\{VERB}"), KEY_READ)
            .is_ok()
    })
}

pub fn collect_extensions(actions: &[MenuAction]) -> Vec<String> {
    let mut all: Vec<String> = Vec::new();
    for action in actions {
        if action.extensions.is_empty() {
            all.push(String::new());
        }
        for extension in &action.extensions {
            all.push(extension.clone());
        }
    }
    all.sort();
    all.dedup();
    all
}

#[cfg(test)]
mod tests {
    use super::{assoc_path, collect_extensions, MenuAction};

    fn action(id: &str, extensions: &[&str]) -> MenuAction {
        MenuAction {
            id: id.into(),
            menu_label: id.into(),
            extensions: extensions.iter().map(|e| (*e).to_string()).collect(),
            multi_file: "both".into(),
            presets: Vec::new(),
        }
    }

    #[test]
    fn command_line_puts_options_before_the_file() {
        let line = super::command_line("C:\\z\\zapit.exe", "compress-video", &[("targetMb", "25")]);
        assert_eq!(
            line,
            "\"C:\\z\\zapit.exe\" run compress-video --opt targetMb=25 --file \"%1\""
        );
    }

    #[test]
    fn command_line_without_options_is_unchanged() {
        let line = super::command_line("C:\\z\\zapit.exe", "extract-audio", &[]);
        assert_eq!(line, "\"C:\\z\\zapit.exe\" run extract-audio --file \"%1\"");
    }

    #[test]
    fn any_file_actions_register_under_the_star_class() {
        assert!(assoc_path("").contains(r"Classes\*\shell\ZapitAnyFile"));
        assert!(assoc_path("mp4").contains(r"SystemFileAssociations\.mp4\shell\Zapit"));
    }

    #[test]
    fn the_two_verbs_never_share_a_key_name() {
        // Explorer dedupes verbs by key name: when `*` and the per-extension
        // class both used "Zapit", one flyout shadowed the other and most
        // video actions vanished from the menu.
        let star = assoc_path("");
        let specific = assoc_path("mp4");
        let leaf = |path: &str| path.rsplit('\\').next().unwrap_or_default().to_string();
        assert_ne!(leaf(&star), leaf(&specific));
    }

    #[test]
    fn extensions_are_deduped_and_include_the_any_file_slot() {
        let actions = vec![
            action("a", &["mp4", "mkv"]),
            action("b", &["mp4"]),
            action("checksum", &[]),
        ];
        let all = collect_extensions(&actions);
        assert_eq!(
            all,
            vec!["".to_string(), "mkv".to_string(), "mp4".to_string()]
        );
    }
}
