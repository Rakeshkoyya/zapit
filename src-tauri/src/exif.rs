//! I6 metadata reading (§6): kamadak-exif → a flat table for the Metadata
//! window. Stripping is a plain FFmpeg step in the plan, not our concern here.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExifEntry {
    pub tag: String,
    pub value: String,
    /// GPS/location fields get flagged so the UI can highlight them.
    pub sensitive: bool,
}

pub fn read_exif(path: &Path) -> AppResult<Vec<ExifEntry>> {
    let file = File::open(path)
        .map_err(|e| AppError::user(format!("Couldn't open {}: {e}", path.display())))?;
    let mut reader = BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut reader) {
        Ok(data) => data,
        // "No EXIF" is a normal outcome, not a failure — the window shows an
        // empty table and the strip button stays useful for other metadata.
        Err(_) => return Ok(Vec::new()),
    };
    Ok(exif
        .fields()
        .map(|field| {
            let tag = field.tag.to_string();
            let sensitive = tag.starts_with("GPS");
            ExifEntry {
                value: field.display_value().with_unit(&exif).to_string(),
                tag,
                sensitive,
            }
        })
        .collect())
}
