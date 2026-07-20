// Windows 发布版隐藏控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    drama_video_downloader_lib::run()
}