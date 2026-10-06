// Without this a release build opens a console window beside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  choir_seating_tool_lib::run();
}
