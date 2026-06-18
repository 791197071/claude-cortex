//! 记忆（memory）命令：汇总全局记忆与各项目记忆。
//!
//! 全局记忆在 `~/.claude/memory/*.md`；项目记忆在
//! `~/.claude/projects/<hashed>/memory/*.md`。项目真实路径优先从 jsonl 反查，
//! 拿不到时从哈希化的文件夹名里尽量还原一个可读名。

use crate::models::{MemFile, MemoryData, ProjectMemory};
use crate::util::{claude_dir, clean_name_from_hashed_folder, get_mem_type, get_summary, project_name_from_path, project_path_from_jsonl};
use std::fs;
use std::path::{Path, PathBuf};

/// 列出全局 + 项目记忆。
#[tauri::command]
pub fn list_memory() -> MemoryData {
    let claude = claude_dir();

    // 全局记忆
    let global_dir = claude.join("memory");
    let mut global = Vec::new();
    if global_dir.exists() {
        if let Ok(entries) = fs::read_dir(&global_dir) {
            let mut files: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            files.sort_by_key(|e| e.file_name());
            for entry in files {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let content = fs::read_to_string(&path).unwrap_or_default();
                let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                global.push(MemFile {
                    id: format!("g-{}", name),
                    name,
                    path: path.to_string_lossy().to_string(),
                    mem_type: get_mem_type(&path.file_name().unwrap_or_default().to_string_lossy()).to_string(),
                    summary: get_summary(&content),
                    size,
                });
            }
        }
    }

    // 项目记忆
    let projects_dir = claude.join("projects");
    let mut projects = Vec::new();
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let folder = entry.path();
                if !folder.is_dir() {
                    continue;
                }
                let mem_dir = folder.join("memory");
                if !mem_dir.exists() {
                    continue;
                }

                // 取项目真实路径 —— 与 list_project_paths 同样的 find_map 策略
                let real_path = fs::read_dir(&folder)
                    .ok()
                    .and_then(|rd| {
                        rd.filter_map(|e| e.ok())
                            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
                            .find_map(|e| project_path_from_jsonl(&e.path()))
                    })
                    .unwrap_or_default();

                let is_real_path = Path::new(&real_path).is_absolute();

                let project_name = if is_real_path {
                    project_name_from_path(&real_path)
                } else {
                    // 从哈希化文件夹名推导一个可读名
                    let fname = folder.file_name().unwrap_or_default().to_string_lossy();
                    clean_name_from_hashed_folder(&fname)
                };

                let mut files = Vec::new();
                let mut total_size = 0u64;

                if let Ok(mem_entries) = fs::read_dir(&mem_dir) {
                    let mut mf: Vec<_> = mem_entries.filter_map(|e| e.ok()).collect();
                    mf.sort_by_key(|e| e.file_name());
                    for me in mf {
                        let path = me.path();
                        if path.extension().and_then(|e| e.to_str()) != Some("md") {
                            continue;
                        }
                        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                        let content = fs::read_to_string(&path).unwrap_or_default();
                        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                        total_size += size;
                        files.push(MemFile {
                            id: format!("{}-{}", folder.file_name().unwrap_or_default().to_string_lossy(), name),
                            name,
                            path: path.to_string_lossy().to_string(),
                            mem_type: get_mem_type(&path.file_name().unwrap_or_default().to_string_lossy()).to_string(),
                            summary: get_summary(&content),
                            size,
                        });
                    }
                }

                // 项目根与 .claude/ 子目录下是否有 CLAUDE.md
                let claude_md_path = if is_real_path {
                    let cm = PathBuf::from(&real_path).join("CLAUDE.md");
                    let cm_dot = PathBuf::from(&real_path).join(".claude").join("CLAUDE.md");
                    if cm.exists() {
                        Some(cm.to_string_lossy().to_string())
                    } else if cm_dot.exists() {
                        Some(cm_dot.to_string_lossy().to_string())
                    } else {
                        None
                    }
                } else {
                    None
                };

                if !files.is_empty() || claude_md_path.is_some() {
                    let stored_path = if is_real_path { real_path } else { String::new() };
                    projects.push(ProjectMemory { project: project_name, path: stored_path, files, total_size, claude_md_path });
                }
            }
        }
    }

    MemoryData { global, projects }
}
