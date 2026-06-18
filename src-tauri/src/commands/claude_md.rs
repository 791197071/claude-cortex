//! CLAUDE.md 管理命令：列出全局与各项目的 CLAUDE.md。
//!
//! 项目的 CLAUDE.md 可能在项目根，也可能在 `<项目>/.claude/CLAUDE.md`，两处都检查。
//! 项目清单复用 `sessions::list_project_paths`。

use crate::commands::sessions::list_project_paths;
use crate::models::ClaudeMdFile;
use crate::util::claude_dir;
use std::fs;
use std::path::PathBuf;

/// 列出全局 + 各项目的 CLAUDE.md（不存在的项目项也返回，标 `exists=false`）。
#[tauri::command]
pub fn list_claude_mds() -> Vec<ClaudeMdFile> {
    let mut result = Vec::new();
    let claude = claude_dir();

    // 全局 CLAUDE.md
    let global_path = claude.join("CLAUDE.md");
    let global_size = if global_path.exists() {
        fs::metadata(&global_path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    result.push(ClaudeMdFile {
        label: "全局".to_string(),
        path: global_path.to_string_lossy().to_string(),
        exists: global_path.exists(),
        size: global_size,
        project_path: String::new(),
    });

    // 各项目 CLAUDE.md
    for p in list_project_paths() {
        if p.path.is_empty() {
            continue;
        }
        let claude_md = PathBuf::from(&p.path).join("CLAUDE.md");
        let claude_md_dot = PathBuf::from(&p.path).join(".claude").join("CLAUDE.md");
        let (final_path, exists) = if claude_md.exists() {
            (claude_md, true)
        } else if claude_md_dot.exists() {
            (claude_md_dot, true)
        } else {
            (claude_md, false)
        };
        let size = if exists { fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0) } else { 0 };
        result.push(ClaudeMdFile {
            label: p.name,
            path: final_path.to_string_lossy().to_string(),
            exists,
            size,
            project_path: p.path,
        });
    }
    result
}
