// Windows subsystem so no console window ever flashes when Explorer launches us
// (GOALS.md DoD item 7). CLI feedback for `smoke` runs goes through logs until
// M1 attaches to the parent console.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    zapit_lib::run()
}
