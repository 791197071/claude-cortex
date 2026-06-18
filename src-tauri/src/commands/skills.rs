//! 技能（skills）相关命令：列出 / 删除 / 新建。
//!
//! 技能分两类：
//!   · 全局技能 —— `~/.claude/skills/<name>/SKILL.md`
//!   · 项目技能 —— `<项目>/.claude/skills/<name>/SKILL.md`
//! 项目路径通过项目对应的 jsonl 会话文件里的 `cwd` 反查得到。

use crate::models::Skill;
use crate::util::{claude_dir, get_summary, parse_frontmatter_field, project_name_from_path, project_path_from_jsonl};
use std::fs;
use std::path::PathBuf;

/// 列出所有技能（全局 + 项目）。
#[tauri::command]
pub fn list_skills() -> Vec<Skill> {
    let mut skills = Vec::new();
    let claude = claude_dir();

    // 全局技能
    let global_dir = claude.join("skills");
    if global_dir.exists() {
        if let Ok(entries) = fs::read_dir(&global_dir) {
            let mut dirs: Vec<_> = entries.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).collect();
            dirs.sort_by_key(|e| e.file_name());
            for entry in dirs {
                let path = entry.path();
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let skill_md = path.join("SKILL.md");
                let (desc, cmds) = if skill_md.exists() {
                    let content = fs::read_to_string(&skill_md).unwrap_or_default();
                    let d = {
                        let fm = parse_frontmatter_field(&content, "description:").to_string();
                        if fm.is_empty() { get_summary(&content) } else { fm }
                    };
                    let c = vec![format!("/{}", name)];
                    (d, c)
                } else {
                    (String::new(), vec![format!("/{}", name)])
                };
                skills.push(Skill {
                    name,
                    path: path.to_string_lossy().to_string(),
                    scope: "global".to_string(),
                    project: None,
                    project_path: None,
                    description: desc,
                    commands: cmds,
                });
            }
        }
    }

    // 项目技能
    let projects_dir = claude.join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let folder = entry.path();
                if !folder.is_dir() {
                    continue;
                }
                // 从某个 jsonl 文件里反查项目真实路径
                let real_path = fs::read_dir(&folder)
                    .ok()
                    .and_then(|mut rd| {
                        rd.find(|e| {
                            e.as_ref()
                                .map(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
                                .unwrap_or(false)
                        })
                    })
                    .and_then(|e| e.ok())
                    .and_then(|e| project_path_from_jsonl(&e.path()))
                    .unwrap_or_default();

                if real_path.is_empty() {
                    continue;
                }

                let skill_dir = PathBuf::from(&real_path).join(".claude").join("skills");
                if skill_dir == global_dir || !skill_dir.exists() {
                    continue;
                }

                let project_name = project_name_from_path(&real_path);

                if let Ok(skill_entries) = fs::read_dir(&skill_dir) {
                    let mut dirs: Vec<_> = skill_entries.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).collect();
                    dirs.sort_by_key(|e| e.file_name());
                    for se in dirs {
                        let sp = se.path();
                        let name = sp.file_name().unwrap_or_default().to_string_lossy().to_string();
                        let skill_md = sp.join("SKILL.md");
                        let desc = if skill_md.exists() {
                            fs::read_to_string(&skill_md)
                                .map(|c| {
                                    let fm = parse_frontmatter_field(&c, "description:").to_string();
                                    if fm.is_empty() { get_summary(&c) } else { fm }
                                })
                                .unwrap_or_default()
                        } else {
                            String::new()
                        };
                        skills.push(Skill {
                            commands: vec![format!("/{}", name)],
                            name,
                            path: sp.to_string_lossy().to_string(),
                            scope: "project".to_string(),
                            project: Some(project_name.clone()),
                            project_path: Some(real_path.clone()),
                            description: desc,
                        });
                    }
                }
            }
        }
    }

    skills
}

/// 删除一个技能目录。
#[tauri::command]
pub fn delete_skill(path: String) -> Result<(), String> {
    fs::remove_dir_all(&path).map_err(|e| e.to_string())
}

/// 新建一个技能，写出最小的 `SKILL.md`（含 description / trigger frontmatter）。
#[tauri::command]
pub fn create_skill(
    name: String,
    scope: String,
    project_path: Option<String>,
    description: String,
    trigger: String,
    content: String,
) -> Result<(), String> {
    let base = if scope == "global" {
        claude_dir().join("skills")
    } else {
        PathBuf::from(project_path.ok_or("需要指定项目路径")?).join(".claude").join("skills")
    };
    let skill_dir = base.join(&name);
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    let text = format!(
        "---\ndescription: \"{}\"\ntrigger: \"{}\"\n---\n\n{}",
        description.replace('"', "\\\""),
        trigger.replace('"', "\\\""),
        content
    );
    fs::write(skill_dir.join("SKILL.md"), text).map_err(|e| e.to_string())
}
