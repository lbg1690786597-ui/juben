// ===== 视频交付下载器 — Rust 下载引擎 =====
// 特性: 多线程并发 / 断点续传(按大小校验) / 中文标题命名 / 实时进度事件

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Window};
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;

#[derive(Debug, Clone, Deserialize)]
pub struct DownloadItem {
    pub id: i64,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgressPayload {
    pub id: i64,
    pub status: String, // pending | downloading | done | error | skip
    pub progress: u8,   // 0-100
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 清理文件名中的非法字符(Windows/Linux通用)
fn sanitize_filename(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    s = s.trim().trim_matches('.').to_string();
    if s.is_empty() {
        "untitled".to_string()
    } else {
        // 限制长度，避免超出文件系统限制
        if s.chars().count() > 120 {
            s.chars().take(120).collect()
        } else {
            s
        }
    }
}

fn emit_progress(window: &Window, payload: ProgressPayload) {
    let _ = window.emit("download-progress", payload);
}

/// 下载单个视频，返回 (状态字符串, 可选错误信息)
async fn download_one(
    window: Window,
    client: reqwest::Client,
    item: DownloadItem,
    out_dir: PathBuf,
) -> (String, Option<String>) {
    let filename = format!("{}.mp4", sanitize_filename(&item.title));
    let filepath = out_dir.join(&filename);
    let tmp_path = out_dir.join(format!("{}.part", &filename));

    // 1) HEAD 获取远端大小
    let remote_size: u64 = match client.head(&item.url).send().await {
        Ok(resp) => resp
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0),
        Err(_) => 0,
    };

    // 2) 断点续传: 已存在且大小一致 -> 跳过
    if let Ok(meta) = tokio::fs::metadata(&filepath).await {
        if remote_size > 0 && meta.len() == remote_size {
            emit_progress(
                &window,
                ProgressPayload {
                    id: item.id,
                    status: "skip".into(),
                    progress: 100,
                    message: None,
                },
            );
            return ("skip".into(), None);
        }
    }

    // 3) 下载(带最多3次重试)
    let max_retry = 3;
    for attempt in 1..=max_retry {
        emit_progress(
            &window,
            ProgressPayload {
                id: item.id,
                status: "downloading".into(),
                progress: 0,
                message: None,
            },
        );

        match try_download(&window, &client, &item, &tmp_path, remote_size).await {
            Ok(()) => {
                // 校验大小
                if remote_size > 0 {
                    if let Ok(meta) = tokio::fs::metadata(&tmp_path).await {
                        if meta.len() != remote_size {
                            let _ = tokio::fs::remove_file(&tmp_path).await;
                            if attempt == max_retry {
                                let msg = format!(
                                    "大小不符(期望{},实际{})",
                                    remote_size,
                                    meta.len()
                                );
                                emit_progress(
                                    &window,
                                    ProgressPayload {
                                        id: item.id,
                                        status: "error".into(),
                                        progress: 0,
                                        message: Some(msg.clone()),
                                    },
                                );
                                return ("error".into(), Some(msg));
                            }
                            continue;
                        }
                    }
                }
                // 原子重命名
                if let Err(e) = tokio::fs::rename(&tmp_path, &filepath).await {
                    let msg = format!("保存失败: {}", e);
                    emit_progress(
                        &window,
                        ProgressPayload {
                            id: item.id,
                            status: "error".into(),
                            progress: 0,
                            message: Some(msg.clone()),
                        },
                    );
                    return ("error".into(), Some(msg));
                }
                emit_progress(
                    &window,
                    ProgressPayload {
                        id: item.id,
                        status: "done".into(),
                        progress: 100,
                        message: None,
                    },
                );
                return ("done".into(), None);
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                if attempt == max_retry {
                    emit_progress(
                        &window,
                        ProgressPayload {
                            id: item.id,
                            status: "error".into(),
                            progress: 0,
                            message: Some(e.clone()),
                        },
                    );
                    return ("error".into(), Some(e));
                }
                // 重试前稍作等待
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            }
        }
    }

    ("error".into(), Some("未知错误".into()))
}

/// 实际流式下载到 tmp 文件，边下边发进度
async fn try_download(
    window: &Window,
    client: &reqwest::Client,
    item: &DownloadItem,
    tmp_path: &PathBuf,
    remote_size: u64,
) -> Result<(), String> {
    let resp = client
        .get(&item.url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let mut file = tokio::fs::File::create(tmp_path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut last_pct: u8 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("传输中断: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入失败: {}", e))?;
        downloaded += chunk.len() as u64;

        if remote_size > 0 {
            let pct = ((downloaded as f64 / remote_size as f64) * 100.0) as u8;
            let pct = pct.min(99); // 完成前最多显示99%，重命名成功才100
            if pct != last_pct {
                last_pct = pct;
                emit_progress(
                    window,
                    ProgressPayload {
                        id: item.id,
                        status: "downloading".into(),
                        progress: pct,
                        message: None,
                    },
                );
            }
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("刷新失败: {}", e))?;
    Ok(())
}

/// Tauri 命令: 批量下载(受并发信号量控制)
#[tauri::command]
async fn download_videos(
    window: Window,
    items: Vec<DownloadItem>,
    out_dir: String,
    concurrency: usize,
) -> Result<String, String> {
    let out_path = PathBuf::from(&out_dir);
    tokio::fs::create_dir_all(&out_path)
        .await
        .map_err(|e| format!("无法创建输出目录: {}", e))?;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| format!("初始化下载器失败: {}", e))?;

    let sem = Arc::new(Semaphore::new(concurrency.max(1)));
    let mut handles = Vec::new();

    for item in items {
        let permit_sem = sem.clone();
        let w = window.clone();
        let c = client.clone();
        let dir = out_path.clone();
        handles.push(tokio::spawn(async move {
            let _permit = permit_sem.acquire().await.unwrap();
            download_one(w, c, item, dir).await
        }));
    }

    let mut ok = 0;
    let mut skip = 0;
    let mut fail = 0;
    for h in handles {
        match h.await {
            Ok((status, _msg)) => match status.as_str() {
                "done" => ok += 1,
                "skip" => skip += 1,
                _ => fail += 1,
            },
            Err(_) => fail += 1,
        }
    }

    Ok(format!(
        "完成: 成功{} 跳过{} 失败{}",
        ok, skip, fail
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![download_videos])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
