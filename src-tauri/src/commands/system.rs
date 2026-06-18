//! 系统 / 配置 / 缓存清理命令。
//!
//! 包含一些杂项查询（主目录、配置文件路径）和缓存清理页所需的功能：
//! 枚举 Claude Code 各类可清理的缓存目录/文件、计算大小、按需删除。

use crate::models::CacheItem;
use crate::util::{claude_dir, dir_size, format_size, home_dir};
use std::fs;
use std::path::{Path, PathBuf};

/// 返回用户主目录绝对路径。
#[tauri::command]
pub fn get_home_dir() -> String {
    home_dir().to_string_lossy().to_string()
}

/// 返回本应用配置文件 `~/.claude/cortex-config.json` 的路径。
#[tauri::command]
pub fn get_config_path() -> String {
    claude_dir().join("cortex-config.json").to_string_lossy().to_string()
}

/// 枚举可清理的缓存项，附带各自当前占用大小。
#[tauri::command]
pub fn get_cache_info() -> Vec<CacheItem> {
    let claude = claude_dir();
    // (id, 显示名, 绝对路径, 简短相对路径)
    let defs: Vec<(&str, &str, PathBuf, &str)> = vec![
        ("cc-plugins",     "插件下载缓存", claude.join("plugins").join("cache"),        "plugins/cache/"),
        ("cc-filehistory", "文件编辑历史", claude.join("file-history"),                 "file-history/"),
        ("cc-telemetry",   "遥测失败日志", claude.join("telemetry"),                    "telemetry/"),
        ("cc-shellsnap",   "Shell 快照",   claude.join("shell-snapshots"),              "shell-snapshots/"),
        ("cc-cache",       "应用缓存",     claude.join("cache"),                        "cache/"),
        ("cc-history",     "命令历史",     claude.join("history.jsonl"),                "history.jsonl"),
        ("cc-paste",       "粘贴缓存",     claude.join("paste-cache"),                  "paste-cache/"),
        ("cc-backup",      "配置备份",     claude.join("backups"),                      "backups/"),
        ("cc-statscache",  "统计缓存",     claude.join("stats-cache.json"),             "stats-cache.json"),
        ("cc-updatecache", "更新检查缓存", claude.join(".last-update-result.json"),     ".last-update-result.json"),
    ];
    defs.into_iter().map(|(id, label, path, short_path)| {
        let exists = path.exists();
        let bytes = if exists {
            if path.is_dir() { dir_size(&path) }
            else { fs::metadata(&path).map(|m| m.len()).unwrap_or(0) }
        } else { 0 };
        CacheItem {
            id: id.to_string(),
            label: label.to_string(),
            note: label.to_string(),
            short_path: short_path.to_string(),
            size_str: format_size(bytes),
            bytes,
            path: path.to_string_lossy().to_string(),
            exists,
        }
    }).collect()
}

/// 清理（删除）指定缓存路径。目录递归删，文件直接删，不存在则静默成功。
#[tauri::command]
pub fn clear_cache(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    } else if p.is_file() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}
