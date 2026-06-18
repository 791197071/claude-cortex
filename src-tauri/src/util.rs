//! 通用工具函数
//!
//! 与具体业务（技能 / 插件 / 会话…）无关的纯函数都放这里：路径、时间格式化、
//! 文件大小、frontmatter 解析、项目名推断等。各命令模块按需 `use crate::util::*`。
//! 这些函数全部是 `pub(crate)`——只在本 crate 内共享，不对外暴露。

use std::fs;
use std::path::{Path, PathBuf};

/// 用户主目录；取不到时退化为根目录，保证后续 join 不 panic。
pub(crate) fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

/// `~/.claude` —— Claude Code 的数据根目录，几乎所有读取都从这里出发。
pub(crate) fn claude_dir() -> PathBuf {
    home_dir().join(".claude")
}

// ── frontmatter / 摘要 ──

/// 从 Markdown 头部的 `--- ... ---` frontmatter 里取某字段的值。
/// `field` 需带冒号，例如 `"description:"`。取不到返回空串。
pub(crate) fn parse_frontmatter_field<'a>(content: &'a str, field: &str) -> &'a str {
    if !content.starts_with("---") {
        return "";
    }
    let rest = &content[3..];
    let end = rest.find("---").unwrap_or(0);
    let frontmatter = &rest[..end];
    for line in frontmatter.lines() {
        if line.starts_with(field) {
            let val = line[field.len()..].trim();
            return val.trim_matches('"').trim_matches('\'');
        }
    }
    ""
}

/// 取一段内容的摘要：跳过 frontmatter、空行、标题行，返回第一段正文（截断到 100 字）。
pub(crate) fn get_summary(content: &str) -> String {
    let mut in_fm = false;
    let mut fm_count = 0;
    for line in content.lines() {
        let t = line.trim();
        if t == "---" {
            fm_count += 1;
            in_fm = fm_count == 1;
            if fm_count == 2 {
                in_fm = false;
            }
            continue;
        }
        if in_fm || t.is_empty() || t.starts_with('#') {
            continue;
        }
        return t.chars().take(100).collect();
    }
    String::new()
}

/// 由记忆文件名前缀推断类型。约定：`feedback_` / `user_` / `project_` / `reference_`，
/// 其余归为通用 `memory`。
pub(crate) fn get_mem_type(filename: &str) -> &'static str {
    if filename.starts_with("feedback_") {
        "feedback"
    } else if filename.starts_with("user_") {
        "user"
    } else if filename.starts_with("project_") {
        "project"
    } else if filename.starts_with("reference_") {
        "reference"
    } else {
        "memory"
    }
}

// ── 文件大小 ──

/// 递归累加目录下所有文件字节数。读不到的目录算 0。
pub(crate) fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| {
            let p = e.path();
            if p.is_dir() {
                dir_size(&p)
            } else {
                fs::metadata(&p).map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

/// 把字节数格式化成人类可读的 B / KB / MB。
pub(crate) fn format_size(bytes: u64) -> String {
    if bytes == 0 {
        "0 B".to_string()
    } else if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

// ── 时间 ──

/// 把 Unix 秒格式化成相对时间：今天 / 昨天 / N 天前 / 年月日。
pub(crate) fn format_timestamp(secs: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let diff = now.saturating_sub(secs);
    let days = diff / 86400;
    let today_start = (now / 86400) * 86400;
    let yesterday_start = today_start.saturating_sub(86400);

    if secs >= today_start {
        let h = (secs % 86400) / 3600;
        let m = (secs % 3600) / 60;
        format!("今天 {:02}:{:02}", h, m)
    } else if secs >= yesterday_start {
        let h = (secs % 86400) / 3600;
        let m = (secs % 3600) / 60;
        format!("昨天 {:02}:{:02}", h, m)
    } else if days < 7 {
        format!("{} 天前", days)
    } else {
        let (y, mo, d) = unix_to_ymd(secs);
        format!("{}/{:02}/{:02}", y, mo, d)
    }
}

/// 把 Unix 秒换算成 (年, 月, 日)。用 Howard Hinnant 的 civil-from-days 算法，
/// 不依赖时区库、纯整数运算。
fn unix_to_ymd(secs: u64) -> (u64, u64, u64) {
    let days = secs / 86400;
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, d)
}

/// 把时间戳转成 "年/月/日" 形式的天键，用于统计按天分组。
pub(crate) fn day_key_from_timestamp(secs: u64) -> String {
    let (y, mo, d) = unix_to_ymd(secs);
    format!("{}/{:02}/{:02}", y, mo, d)
}

// ── 项目路径推断 ──

/// 从一个 `.jsonl` 会话文件的前若干行里读出 `cwd`（项目真实路径）。
pub(crate) fn project_path_from_jsonl(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines().take(10) {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if let Some(cwd) = val["cwd"].as_str() {
            return Some(cwd.to_string());
        }
    }
    None
}

/// 取路径最后一段作为项目显示名。
pub(crate) fn project_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

/// Claude Code 把项目路径编码成文件夹名时，会把每个非 `[a-zA-Z0-9-]` 字符替换成 `-`，
/// 所以中文会变成 `-`。连续 2 个以上的 `-` 标记了「这里曾是非 ASCII 字符」的边界。
/// 当没有 jsonl 能给出真实路径时，从这种哈希化文件夹名里尽量还原出项目名。
pub(crate) fn clean_name_from_hashed_folder(folder_name: &str) -> String {
    let name = folder_name.trim_start_matches('-');
    let b = name.as_bytes();
    let mut last_multi_end: Option<usize> = None;
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'-' {
            let start = i;
            while i < b.len() && b[i] == b'-' {
                i += 1;
            }
            if i - start >= 2 {
                last_multi_end = Some(i);
            }
        } else {
            i += 1;
        }
    }
    if let Some(pos) = last_multi_end {
        let after = &name[pos..];
        if !after.is_empty() {
            return after.to_string();
        }
    }
    // 没有多连字符边界：取最后一个 `-` 分段（适配纯 ASCII 路径）
    name.rsplitn(2, '-').next().unwrap_or(name).to_string()
}

// ── 配置 ──

/// 读 `~/.claude/cortex-config.json` 里某个布尔配置项，缺失或出错时用 `default`。
pub(crate) fn read_config_bool(key: &str, default: bool) -> bool {
    let path = claude_dir().join("cortex-config.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .and_then(|j| j[key].as_bool())
        .unwrap_or(default)
}
