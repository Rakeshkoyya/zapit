# The pre-commit quality gate (IMPLEMENTATION_PLAN.md section 12): formatting, linting,
# clippy, and every test suite. Must be green before every commit.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/check.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Cargo lives per-user and is not on PATH by default on this machine.
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
}

$steps = @(
    @{ name = "prettier";      cmd = { npx prettier --check . } },
    @{ name = "eslint";        cmd = { npx eslint . } },
    @{ name = "tsc";           cmd = { npx tsc --noEmit } },
    @{ name = "vitest";        cmd = { npx vitest run } },
    @{ name = "cargo fmt";     cmd = { cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check } },
    @{ name = "cargo clippy";  cmd = { cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings } },
    @{ name = "cargo test";    cmd = { cargo test --manifest-path src-tauri/Cargo.toml } }
)

foreach ($step in $steps) {
    Write-Host "==> $($step.name)" -ForegroundColor Cyan
    & $step.cmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $($step.name)" -ForegroundColor Red
        exit 1
    }
}

Write-Host "All checks green." -ForegroundColor Green
