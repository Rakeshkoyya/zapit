//! P3 compress-to-target pipeline (§6, ADR 004): qpdf lossless first, then the
//! guaranteed-works rasterize floor — pdfium renders pages, JPEGs go into a
//! minimal hand-built PDF (DCTDecode XObjects; no external PDF writer needed).

use crate::error::{AppError, AppResult};
use crate::sidecar::CancelFlag;
use image::codecs::jpeg::JpegEncoder;
use pdfium_render::prelude::*;
use std::path::Path;

/// Rasterize ladder: §6's three attempts, never more.
const RASTER_STEPS: &[(f32, u8)] = &[(120.0, 75), (96.0, 60), (72.0, 60)];

pub struct CompressOutcome {
    /// True when pages were rasterized — text is no longer selectable.
    pub rasterized: bool,
}

/// Quality levels for users who want "smaller" without naming a size.
/// High stays lossless so text survives; the others trade text for size.
#[derive(Debug, Clone, Copy)]
pub enum Quality {
    High,
    Medium,
    Low,
}

impl Quality {
    pub fn parse(text: &str) -> Option<Self> {
        match text.to_ascii_lowercase().as_str() {
            "high" => Some(Quality::High),
            "medium" => Some(Quality::Medium),
            "low" => Some(Quality::Low),
            _ => None,
        }
    }

    /// Render settings for the lossy levels; High never rasterizes.
    fn raster(self) -> Option<(f32, u8)> {
        match self {
            Quality::High => None,
            Quality::Medium => Some((150.0, 75)),
            Quality::Low => Some((96.0, 60)),
        }
    }
}

/// Compress to a quality level rather than a size.
pub fn compress_pdf_quality(
    sidecar_dir: &Path,
    input: &Path,
    out: &Path,
    quality: Quality,
    tmp: &Path,
    cancel: &CancelFlag,
) -> AppResult<CompressOutcome> {
    reject_encrypted(sidecar_dir, input)?;
    let lossless = lossless_pass(sidecar_dir, input, tmp)?;

    let Some((dpi, jpeg_quality)) = quality.raster() else {
        // High: lossless only. Never hand back something larger than the
        // original — if qpdf could not help, say so plainly.
        let original = std::fs::metadata(input)?.len();
        if std::fs::metadata(&lossless)?.len() >= original {
            return Err(AppError::user(
                "This PDF is already as small as it gets without turning its pages into \
                 images. Try Medium or Low quality.",
            ));
        }
        std::fs::rename(&lossless, out)?;
        return Ok(CompressOutcome { rasterized: false });
    };

    let pdfium = load_pdfium(sidecar_dir)?;
    let pages = render_pages(&pdfium, input, dpi, jpeg_quality, cancel)?;
    let bytes = build_jpeg_pdf(&pages);
    // Rasterizing can inflate a text-only PDF; keep whichever is smaller.
    if bytes.len() as u64 >= std::fs::metadata(&lossless)?.len() {
        std::fs::rename(&lossless, out)?;
        return Ok(CompressOutcome { rasterized: false });
    }
    std::fs::write(out, bytes)?;
    Ok(CompressOutcome { rasterized: true })
}

/// qpdf's lossless squeeze — structure and stream recompression only.
fn lossless_pass(sidecar_dir: &Path, input: &Path, tmp: &Path) -> AppResult<std::path::PathBuf> {
    let qpdf = sidecar_dir.join("qpdf.exe");
    let staged = tmp.join("stage1.pdf");
    crate::sidecar::run_capture(
        &qpdf,
        &[
            "--object-streams=generate".into(),
            "--recompress-flate".into(),
            "--compression-level=9".into(),
            input.to_string_lossy().into_owned(),
            staged.to_string_lossy().into_owned(),
        ],
    )?;
    Ok(staged)
}

/// Encrypted input gets a clear UserError up front (M4 gate requirement).
fn reject_encrypted(sidecar_dir: &Path, input: &Path) -> AppResult<()> {
    let qpdf = sidecar_dir.join("qpdf.exe");
    // qpdf --is-encrypted: exit 0 = encrypted, 2 = not encrypted.
    let encrypted = std::process::Command::new(&qpdf)
        .args(["--is-encrypted", &input.to_string_lossy()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if encrypted {
        return Err(AppError::user(format!(
            "\"{}\" is password-protected — unlock it first (right-click -> Unlock PDF).",
            input.file_name().unwrap_or_default().to_string_lossy()
        )));
    }
    Ok(())
}

pub fn compress_pdf(
    sidecar_dir: &Path,
    input: &Path,
    out: &Path,
    target_kb: u64,
    tmp: &Path,
    cancel: &CancelFlag,
) -> AppResult<CompressOutcome> {
    let target_bytes = target_kb.saturating_mul(1024);
    let qpdf = sidecar_dir.join("qpdf.exe");

    // Encrypted inputs get a clear UserError up front (gate requirement).
    // qpdf --is-encrypted: exit 0 = encrypted, 2 = not encrypted.
    let encrypted = std::process::Command::new(&qpdf)
        .args(["--is-encrypted", &input.to_string_lossy()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if encrypted {
        return Err(AppError::user(format!(
            "\"{}\" is password-protected — unlock it first (right-click → Unlock PDF).",
            input.file_name().unwrap_or_default().to_string_lossy()
        )));
    }

    // Stage 1: lossless qpdf squeeze.
    let stage1 = tmp.join("stage1.pdf");
    crate::sidecar::run_capture(
        &qpdf,
        &[
            "--object-streams=generate".into(),
            "--recompress-flate".into(),
            "--compression-level=9".into(),
            input.to_string_lossy().into_owned(),
            stage1.to_string_lossy().into_owned(),
        ],
    )?;
    if std::fs::metadata(&stage1)?.len() <= target_bytes {
        std::fs::rename(&stage1, out)?;
        return Ok(CompressOutcome { rasterized: false });
    }

    // Stage 3 (ADR 004: stage 2 deferred): rasterize floor.
    let pdfium = load_pdfium(sidecar_dir)?;

    for (dpi, quality) in RASTER_STEPS {
        if cancel.is_cancelled() {
            return Err(AppError::user("Cancelled"));
        }
        let pages = render_pages(&pdfium, input, *dpi, *quality, cancel)?;
        let bytes = build_jpeg_pdf(&pages);
        if bytes.len() as u64 <= target_bytes {
            std::fs::write(out, bytes)?;
            return Ok(CompressOutcome { rasterized: true });
        }
    }
    Err(AppError::user(format!(
        "Couldn't get this PDF under {target_kb} KB — even fully rasterized it stays larger."
    )))
}

/// P4: render every page to its own PNG. `out_pattern` contains `{n}`, replaced
/// with a 1-based, zero-padded page number (§6: pad when >9 pages).
pub fn render_to_pngs(
    sidecar_dir: &Path,
    input: &Path,
    out_pattern: &str,
    dpi: u32,
    cancel: &CancelFlag,
) -> AppResult<Vec<std::path::PathBuf>> {
    let pdfium = load_pdfium(sidecar_dir)?;
    let doc = pdfium
        .load_pdf_from_file(input, None)
        .map_err(|e| AppError::user(format!("This PDF couldn't be read: {e}")))?;
    let page_count = doc.pages().len();
    let width = if page_count > 9 { 2 } else { 1 };
    let mut written = Vec::new();
    for (index, page) in doc.pages().iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(AppError::user("Cancelled"));
        }
        #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
        let px_w = ((page.width().value / 72.0) * dpi as f32).round().max(1.0) as i32;
        let bitmap = page
            .render_with_config(&PdfRenderConfig::new().set_target_width(px_w))
            .map_err(|e| AppError::system(format!("PDF render failed: {e}")))?;
        let rgba = bitmap
            .as_image()
            .map_err(|e| AppError::system(format!("PDF bitmap conversion failed: {e}")))?
            .to_rgba8();
        let number = format!("{:0width$}", index + 1, width = width);
        let path = std::path::PathBuf::from(out_pattern.replace("{n}", &number));
        rgba.save(&path)
            .map_err(|e| AppError::system(format!("could not write page image: {e}")))?;
        written.push(path);
    }
    if written.is_empty() {
        return Err(AppError::user("This PDF has no pages."));
    }
    Ok(written)
}

/// P5: extract text; an empty result gets the honest "looks scanned" hint.
pub fn extract_text(sidecar_dir: &Path, input: &Path, out: &Path) -> AppResult<()> {
    let pdfium = load_pdfium(sidecar_dir)?;
    let doc = pdfium
        .load_pdf_from_file(input, None)
        .map_err(|e| AppError::user(format!("This PDF couldn't be read: {e}")))?;
    let mut text = String::new();
    for (index, page) in doc.pages().iter().enumerate() {
        let page_text = page
            .text()
            .map(|t| t.all())
            .map_err(|e| AppError::system(format!("text extraction failed: {e}")))?;
        if index > 0 {
            text.push_str("\n\n");
        }
        text.push_str(&page_text);
    }
    if text.trim().is_empty() {
        return Err(AppError::user(
            "No text found — this PDF looks scanned (it holds images, not text).",
        ));
    }
    std::fs::write(out, text)?;
    Ok(())
}

fn load_pdfium(sidecar_dir: &Path) -> AppResult<Pdfium> {
    let bindings = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(
        &sidecar_dir.to_string_lossy().into_owned(),
    ))
    .map_err(|e| AppError::system(format!("could not load pdfium: {e}")))?;
    Ok(Pdfium::new(bindings))
}

struct RasterPage {
    jpeg: Vec<u8>,
    width_pts: f32,
    height_pts: f32,
}

fn render_pages(
    pdfium: &Pdfium,
    input: &Path,
    dpi: f32,
    quality: u8,
    cancel: &CancelFlag,
) -> AppResult<Vec<RasterPage>> {
    let doc = pdfium
        .load_pdf_from_file(input, None)
        .map_err(|e| AppError::user(format!("This PDF couldn't be read: {e}")))?;
    let mut pages = Vec::new();
    for page in doc.pages().iter() {
        if cancel.is_cancelled() {
            return Err(AppError::user("Cancelled"));
        }
        let width_pts = page.width().value;
        let height_pts = page.height().value;
        #[allow(clippy::cast_possible_truncation)]
        let px_w = ((width_pts / 72.0) * dpi).round().max(1.0) as i32;
        let bitmap = page
            .render_with_config(&PdfRenderConfig::new().set_target_width(px_w))
            .map_err(|e| AppError::system(format!("PDF render failed: {e}")))?;
        let rgb = bitmap
            .as_image()
            .map_err(|e| AppError::system(format!("PDF bitmap conversion failed: {e}")))?
            .to_rgb8();
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, quality)
            .encode_image(&rgb)
            .map_err(|e| AppError::system(format!("JPEG encode failed: {e}")))?;
        pages.push(RasterPage {
            jpeg,
            width_pts,
            height_pts,
        });
    }
    if pages.is_empty() {
        return Err(AppError::user("This PDF has no pages."));
    }
    Ok(pages)
}

/// Minimal PDF writer: one DCTDecode image XObject per page. Hand-rolled on
/// purpose — the structure is fixed and tiny, and no license-clean crate embeds
/// ready-made JPEG streams without re-encoding.
fn build_jpeg_pdf(pages: &[RasterPage]) -> Vec<u8> {
    let mut objects: Vec<Vec<u8>> = Vec::new();
    let page_count = pages.len();
    // Object layout: 1 catalog, 2 pages tree, then per page i (0-based):
    //   page obj    = 3 + i*3
    //   content obj = 4 + i*3
    //   image obj   = 5 + i*3
    let kids: Vec<String> = (0..page_count)
        .map(|i| format!("{} 0 R", 3 + i * 3))
        .collect();
    objects.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
    objects.push(
        format!(
            "<< /Type /Pages /Kids [{}] /Count {page_count} >>",
            kids.join(" ")
        )
        .into_bytes(),
    );
    for (i, page) in pages.iter().enumerate() {
        let content = format!(
            "q {} 0 0 {} 0 0 cm /Im0 Do Q",
            page.width_pts, page.height_pts
        );
        let (w, h) = jpeg_dimensions(&page.jpeg).unwrap_or((1, 1));
        objects.push(
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] \
                 /Resources << /XObject << /Im0 {} 0 R >> >> /Contents {} 0 R >>",
                page.width_pts,
                page.height_pts,
                5 + i * 3,
                4 + i * 3
            )
            .into_bytes(),
        );
        let mut content_obj = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
        content_obj.extend_from_slice(content.as_bytes());
        content_obj.extend_from_slice(b"\nendstream");
        objects.push(content_obj);
        let mut image_obj = format!(
            "<< /Type /XObject /Subtype /Image /Width {w} /Height {h} \
             /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode \
             /Length {} >>\nstream\n",
            page.jpeg.len()
        )
        .into_bytes();
        image_obj.extend_from_slice(&page.jpeg);
        image_obj.extend_from_slice(b"\nendstream");
        objects.push(image_obj);
    }

    let mut pdf: Vec<u8> = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::with_capacity(objects.len());
    for (idx, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n", idx + 1).as_bytes());
        pdf.extend_from_slice(body);
        pdf.extend_from_slice(b"\nendobj\n");
    }
    let xref_at = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
    pdf.extend_from_slice(b"0000000000 65535 f \n");
    for offset in &offsets {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    pdf
}

/// JPEG SOF scan for pixel dimensions (avoids re-decoding the whole image).
fn jpeg_dimensions(data: &[u8]) -> Option<(u16, u16)> {
    let mut i = 2usize;
    while i + 9 < data.len() {
        if data[i] != 0xFF {
            return None;
        }
        let marker = data[i + 1];
        // SOF0..SOF15 except DHT(C4)/JPG(C8)/DAC(CC).
        if (0xC0..=0xCF).contains(&marker) && ![0xC4, 0xC8, 0xCC].contains(&marker) {
            let h = u16::from(data[i + 5]) << 8 | u16::from(data[i + 6]);
            let w = u16::from(data[i + 7]) << 8 | u16::from(data[i + 8]);
            return Some((w, h));
        }
        let len = usize::from(data[i + 2]) << 8 | usize::from(data[i + 3]);
        i += 2 + len;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{build_jpeg_pdf, jpeg_dimensions, RasterPage};

    fn tiny_jpeg() -> Vec<u8> {
        // Encode a real 2x3 JPEG with the image crate so dimension parsing is honest.
        let img = image::RgbImage::from_pixel(2, 3, image::Rgb([200, 10, 10]));
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
            .encode_image(&img)
            .expect("encodes");
        out
    }

    #[test]
    fn jpeg_dimensions_reads_sof() {
        let jpeg = tiny_jpeg();
        assert_eq!(jpeg_dimensions(&jpeg), Some((2, 3)));
    }

    #[test]
    fn built_pdf_has_header_pages_and_xref() {
        let pdf = build_jpeg_pdf(&[
            RasterPage {
                jpeg: tiny_jpeg(),
                width_pts: 595.0,
                height_pts: 842.0,
            },
            RasterPage {
                jpeg: tiny_jpeg(),
                width_pts: 595.0,
                height_pts: 842.0,
            },
        ]);
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/Count 2"));
        assert!(text.contains("/DCTDecode"));
        assert!(text.contains("startxref"));
        assert!(text.ends_with("%%EOF\n"));
    }
}
