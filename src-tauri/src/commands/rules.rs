//! 规则（rules）命令：递归列出 `~/.claude/rules/**/*.md`。
//!
//! 规则可以分层目录组织，`category` 取相对 `rules/` 的子目录路径（如 "frontend/style"），
//! 顶层规则的 category 为空串。`id` 由相对路径去掉分隔符与点生成，保证唯一且可作 DOM key。

use crate::models::RuleFile;
use crate::util::claude_dir;
use std::fs;
use std::path::Path;

/// 递归收集某目录下的所有 `.md` 规则到 `result`。`base` 用于算相对路径（category）。
fn collect_rule_files(base: &Path, dir: &Path, result: &mut Vec<RuleFile>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect_rule_files(base, &path, result);
        } else if path.extension().and_then(|x| x.to_str()) == Some("md") {
            let rel = path.strip_prefix(base).unwrap_or(&path);
            let components: Vec<_> = rel.components().collect();
            let category = if components.len() > 1 {
                components[..components.len() - 1]
                    .iter()
                    .map(|c| c.as_os_str().to_string_lossy().to_string())
                    .collect::<Vec<_>>()
                    .join("/")
            } else {
                String::new()
            };
            let name = path
                .file_stem()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let id = rel
                .to_string_lossy()
                .replace(['/', '\\'], "__")
                .replace('.', "_");
            result.push(RuleFile {
                id,
                name,
                path: path.to_string_lossy().to_string(),
                category,
                size,
            });
        }
    }
}

/// 列出所有规则，按 category、再按 name 排序。
#[tauri::command]
pub fn list_rules() -> Vec<RuleFile> {
    let rules_dir = claude_dir().join("rules");
    if !rules_dir.exists() {
        return vec![];
    }
    let mut result = Vec::new();
    collect_rule_files(&rules_dir, &rules_dir, &mut result);
    result.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));
    result
}
