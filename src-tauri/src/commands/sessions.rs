//! 会话（sessions）命令：解析本地 `.jsonl` 会话记录。
//!
//! Claude Code 把每次会话写成 `~/.claude/projects/<hashed>/<uuid>.jsonl`，逐行一个
//! JSON 事件。这里离线解析这些文件，聚合 token 用量、提取标题与消息，供会话列表、
//! 统计、导出、CLAUDE.md 等多个页面复用。
//!
//! `list_sessions` 与 `list_project_paths` 是本模块对外的两个基础查询，
//! 也被 `stats` / `claude_md` 模块复用。

use crate::models::{ChatMessage, ExportMessage, ExportSession, ProjectInfo, Session};
use crate::util::{claude_dir, format_timestamp, project_name_from_path, project_path_from_jsonl};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

/// 解析单个会话 jsonl，聚合 token 并提取标题。无有效 token 的会话返回 `None`。
fn parse_jsonl_session(path: &Path, project: &str, project_path: &str) -> Option<Session> {
    let content = fs::read_to_string(path).ok()?;
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut cache_read = 0u64;
    let mut cache_write = 0u64;
    let mut title = String::new();
    let mut model_tokens: HashMap<String, u64> = HashMap::new();
    let mut model_input_tokens: HashMap<String, u64> = HashMap::new();
    let mut model_output_tokens: HashMap<String, u64> = HashMap::new();

    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        // 标题取第一条用户文本
        if title.is_empty() && val["type"].as_str() == Some("user") {
            if let Some(arr) = val["message"]["content"].as_array() {
                for item in arr {
                    if item["type"].as_str() == Some("text") {
                        if let Some(t) = item["text"].as_str() {
                            title = t.chars().take(60).collect();
                            break;
                        }
                    }
                }
            }
            if title.is_empty() {
                if let Some(t) = val["message"]["content"].as_str() {
                    title = t.chars().take(60).collect();
                }
            }
        }
        // token 累加自 assistant 消息
        if val["type"].as_str() == Some("assistant") {
            if let Some(usage) = val["message"]["usage"].as_object() {
                let msg_input = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let msg_output = usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                input_tokens += msg_input;
                output_tokens += msg_output;
                cache_read += usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                cache_write += usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let model = val["message"]["model"].as_str().unwrap_or("unknown").to_string();
                *model_tokens.entry(model.clone()).or_default() += msg_input + msg_output;
                *model_input_tokens.entry(model.clone()).or_default() += msg_input;
                *model_output_tokens.entry(model).or_default() += msg_output;
            }
        }
    }

    if input_tokens == 0 && output_tokens == 0 {
        return None;
    }

    let mtime = path
        .metadata()
        .and_then(|m| m.modified())
        .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
        .unwrap_or(0);

    let id = path.file_stem().unwrap_or_default().to_string_lossy().to_string();

    Some(Session {
        id: id.clone(),
        path: path.to_string_lossy().to_string(),
        project: project.to_string(),
        project_path: project_path.to_string(),
        title: if title.is_empty() { format!("会话 {}", &id[..8.min(id.len())]) } else { title },
        date: format_timestamp(mtime),
        timestamp: mtime,
        input_tokens,
        output_tokens,
        cache_read_tokens: cache_read,
        cache_write_tokens: cache_write,
        model_tokens,
        model_input_tokens,
        model_output_tokens,
    })
}

/// 列出所有会话，按时间倒序。`stats` 模块也复用它做聚合。
#[tauri::command]
pub fn list_sessions() -> Vec<Session> {
    let mut sessions = Vec::new();
    let projects_dir = claude_dir().join("projects");
    if !projects_dir.exists() {
        return sessions;
    }
    let Ok(entries) = fs::read_dir(&projects_dir) else {
        return sessions;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let folder = entry.path();
        if !folder.is_dir() {
            continue;
        }
        let Ok(files) = fs::read_dir(&folder) else {
            continue;
        };
        let jsonl_files: Vec<_> = files
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
            .collect();

        let project_path = jsonl_files.iter()
            .find_map(|e| project_path_from_jsonl(&e.path()))
            .unwrap_or_default();
        let project_name = if project_path.is_empty() {
            folder.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string()
        } else {
            project_name_from_path(&project_path)
        };

        for file in &jsonl_files {
            if let Some(session) = parse_jsonl_session(&file.path(), &project_name, &project_path) {
                sessions.push(session);
            }
        }
    }
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    sessions
}

/// 删除单个会话文件。
#[tauri::command]
pub fn delete_session(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// 导出指定时间区间内的会话（含完整消息正文）。
#[tauri::command]
pub fn export_sessions(start_ts: u64, end_ts: u64) -> Vec<ExportSession> {
    let sessions = list_sessions();
    let mut result = Vec::new();
    for s in sessions {
        if s.timestamp < start_ts || s.timestamp > end_ts { continue; }
        let content = match fs::read_to_string(&s.path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let mut messages = Vec::new();
        for line in content.lines() {
            let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            let msg_type = val["type"].as_str().unwrap_or("");
            if msg_type != "user" && msg_type != "assistant" { continue; }
            let text = extract_message_text(&val["message"]["content"]);
            if text.is_empty() { continue; }
            messages.push(ExportMessage { role: msg_type.to_string(), text });
        }
        result.push(ExportSession {
            title: s.title,
            project: s.project,
            date: s.date,
            input_tokens: s.input_tokens,
            output_tokens: s.output_tokens,
            messages,
        });
    }
    result
}

/// 列出去重后的项目（名 + 真实路径），按名排序。`claude_md` 模块复用它。
#[tauri::command]
pub fn list_project_paths() -> Vec<ProjectInfo> {
    let projects_dir = claude_dir().join("projects");
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    let Ok(entries) = fs::read_dir(&projects_dir) else { return result };
    for entry in entries.filter_map(|e| e.ok()) {
        let folder = entry.path();
        if !folder.is_dir() { continue; }
        let real_path = fs::read_dir(&folder)
            .ok()
            .and_then(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
                    .find_map(|e| project_path_from_jsonl(&e.path()))
            })
            .unwrap_or_default();
        let (name, key) = if real_path.is_empty() {
            let fname = folder.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            (fname.clone(), folder.to_string_lossy().to_string())
        } else {
            (project_name_from_path(&real_path), real_path.clone())
        };
        if name.is_empty() || !seen.insert(key) { continue; }
        result.push(ProjectInfo { name, path: real_path });
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

/// 从一条消息的 `content`（字符串或 block 数组）里抽取纯文本，单段截断到 8000 字。
fn extract_message_text(content: &serde_json::Value) -> String {
    if let Some(s) = content.as_str() {
        return s.chars().take(8000).collect();
    }
    if let Some(arr) = content.as_array() {
        return arr.iter()
            .filter_map(|block| {
                if block["type"].as_str() == Some("text") {
                    block["text"].as_str().map(|s| s.chars().take(8000).collect::<String>())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

/// 读取单个会话的全部 user/assistant 消息（会话详情页用）。
#[tauri::command]
pub fn read_session_messages(path: String) -> Vec<ChatMessage> {
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut messages = Vec::new();
    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let msg_type = val["type"].as_str().unwrap_or("");
        if msg_type != "user" && msg_type != "assistant" { continue; }
        let text = extract_message_text(&val["message"]["content"]);
        if text.is_empty() { continue; }
        messages.push(ChatMessage { role: msg_type.to_string(), text });
    }
    messages
}
