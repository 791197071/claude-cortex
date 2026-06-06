use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn claude_dir() -> PathBuf {
    home_dir().join(".claude")
}

// ── Structs ──

#[derive(Serialize, Deserialize, Clone)]
pub struct Skill {
    pub name: String,
    pub path: String,
    pub scope: String,
    pub project: Option<String>,
    pub project_path: Option<String>,
    pub description: String,
    pub commands: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Plugin {
    pub name: String,
    pub path: String,
    pub description: String,
    pub version: String,
    pub skills: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MemFile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mem_type: String,
    pub summary: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectMemory {
    pub project: String,
    pub path: String,
    pub files: Vec<MemFile>,
    pub total_size: u64,
}

#[derive(Serialize, Deserialize)]
pub struct MemoryData {
    pub global: Vec<MemFile>,
    pub projects: Vec<ProjectMemory>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub path: String,
    pub project: String,
    pub project_path: String,
    pub title: String,
    pub date: String,
    pub timestamp: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub model_tokens: HashMap<String, u64>,
}

#[derive(Serialize, Deserialize)]
pub struct DayStats {
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub models: HashMap<String, u64>,
}

#[derive(Serialize, Deserialize)]
pub struct ProjectStats {
    pub project: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub session_count: u64,
}

#[derive(Serialize, Deserialize)]
pub struct Stats {
    pub daily: Vec<DayStats>,
    pub projects: Vec<ProjectStats>,
    pub total_input: u64,
    pub total_output: u64,
    pub session_count: u64,
    pub model_totals: HashMap<String, u64>,
}

#[derive(Serialize, Deserialize)]
pub struct CacheItem {
    pub id: String,
    pub label: String,
    pub path: String,
    pub short_path: String,
    pub size_str: String,
    pub bytes: u64,
    pub note: String,
    pub exists: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
}

// ── Helpers ──

fn parse_frontmatter_field<'a>(content: &'a str, field: &str) -> &'a str {
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

fn get_summary(content: &str) -> String {
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

fn get_mem_type(filename: &str) -> &'static str {
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

fn dir_size(path: &Path) -> u64 {
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

fn format_size(bytes: u64) -> String {
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

fn get_size_str(path: &Path) -> String {
    if path.is_dir() {
        format_size(dir_size(path))
    } else if path.is_file() {
        format_size(fs::metadata(path).map(|m| m.len()).unwrap_or(0))
    } else {
        "0 B".to_string()
    }
}

fn format_timestamp(secs: u64) -> String {
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

fn day_key_from_timestamp(secs: u64) -> String {
    let (y, mo, d) = unix_to_ymd(secs);
    format!("{}/{:02}/{:02}", y, mo, d)
}

// Extract project path from first few lines of a JSONL session file
fn project_path_from_jsonl(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines().take(10) {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if let Some(cwd) = val["cwd"].as_str() {
            return Some(cwd.to_string());
        }
    }
    None
}

fn project_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

// ── Skills ──

#[tauri::command]
fn list_skills() -> Vec<Skill> {
    let mut skills = Vec::new();
    let claude = claude_dir();

    // Global skills
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

    // Project skills
    let projects_dir = claude.join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = fs::read_dir(&projects_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let folder = entry.path();
                if !folder.is_dir() {
                    continue;
                }
                // Try to get real project path from a JSONL file
                let real_path = fs::read_dir(&folder)
                    .ok()
                    .and_then(|mut rd| rd.find(|e| e.as_ref().map(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl")).unwrap_or(false)))
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

#[tauri::command]
fn delete_skill(path: String) -> Result<(), String> {
    fs::remove_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_skill(
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

// ── Plugins ──

fn find_plugin_json(marketplace_dir: &Path, plugin_name: &str) -> Option<PathBuf> {
    // 1. Direct: marketplaces/{marketplace}/.claude-plugin/plugin.json (e.g. claude-hud)
    let direct = marketplace_dir.join(".claude-plugin").join("plugin.json");
    if direct.exists() {
        return Some(direct);
    }
    // 2. Standard layout: marketplaces/{marketplace}/plugins/{plugin_name}/.claude-plugin/plugin.json
    let standard = marketplace_dir.join("plugins").join(plugin_name).join(".claude-plugin").join("plugin.json");
    if standard.exists() {
        return Some(standard);
    }
    // 3. Nested layout (e.g. context7: plugins/claude/{slug}/.claude-plugin/plugin.json)
    //    Scan plugins/{any}/{any}/.claude-plugin/plugin.json and match by "name" field
    let plugins_dir = marketplace_dir.join("plugins");
    if plugins_dir.is_dir() {
        if let Ok(l1) = fs::read_dir(&plugins_dir) {
            for e1 in l1.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
                if let Ok(l2) = fs::read_dir(e1.path()) {
                    for e2 in l2.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
                        let candidate = e2.path().join(".claude-plugin").join("plugin.json");
                        if candidate.exists() {
                            if let Ok(content) = fs::read_to_string(&candidate) {
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                                    if json["name"].as_str() == Some(plugin_name) {
                                        return Some(candidate);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

#[tauri::command]
fn list_plugins() -> Vec<Plugin> {
    let plugins_dir = claude_dir().join("plugins");
    let installed_json = plugins_dir.join("installed_plugins.json");

    let mut plugins = Vec::new();

    // Read installed_plugins.json — keys are "{name}@{marketplace}"
    if let Ok(content) = fs::read_to_string(&installed_json) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(map) = json["plugins"].as_object() {
                for (key, entries) in map {
                    // Extract plugin name (before @) and marketplace (after @)
                    let (plugin_name, marketplace) = if let Some(at) = key.find('@') {
                        (&key[..at], &key[at + 1..])
                    } else {
                        (key.as_str(), key.as_str())
                    };

                    // Get version and install path from first entry
                    let version = entries[0]["version"].as_str().unwrap_or("").to_string();
                    let install_path = entries[0]["installPath"].as_str().unwrap_or("").to_string();

                    // Try to read plugin.json from install path first, then search marketplace dir
                    let manifest_json = {
                        let from_install = PathBuf::from(&install_path).join(".claude-plugin").join("plugin.json");
                        if from_install.exists() {
                            fs::read_to_string(&from_install).ok()
                                .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                        } else {
                            let marketplace_dir = plugins_dir.join("marketplaces").join(marketplace);
                            find_plugin_json(&marketplace_dir, plugin_name)
                                .and_then(|p| fs::read_to_string(&p).ok())
                                .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                        }
                    };

                    let (description, skills, display_version) = if let Some(ref j) = manifest_json {
                        (
                            j["description"].as_str().unwrap_or("").to_string(),
                            j["skills"].as_array()
                                .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                .unwrap_or_default(),
                            j["version"].as_str().unwrap_or(&version).to_string(),
                        )
                    } else {
                        (String::new(), Vec::new(), version)
                    };

                    plugins.push(Plugin {
                        name: plugin_name.to_string(),
                        path: if install_path.is_empty() {
                            plugins_dir.join("marketplaces").join(marketplace).to_string_lossy().to_string()
                        } else {
                            install_path
                        },
                        description,
                        version: display_version,
                        skills,
                    });
                }
            }
        }
    }

    // Fallback: scan for plugin.json in direct subdirs (legacy layout)
    if plugins.is_empty() {
        if let Ok(entries) = fs::read_dir(&plugins_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if !path.is_dir() { continue; }
                let manifest = path.join("plugin.json");
                if !manifest.exists() { continue; }
                let Ok(content) = fs::read_to_string(&manifest) else { continue; };
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else { continue; };
                let name = json["name"]
                    .as_str()
                    .unwrap_or_else(|| path.file_name().unwrap_or_default().to_str().unwrap_or(""))
                    .to_string();
                plugins.push(Plugin {
                    name,
                    path: path.to_string_lossy().to_string(),
                    description: json["description"].as_str().unwrap_or("").to_string(),
                    version: json["version"].as_str().unwrap_or("").to_string(),
                    skills: json["skills"]
                        .as_array()
                        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                        .unwrap_or_default(),
                });
            }
        }
    }

    plugins
}

#[tauri::command]
fn uninstall_plugin(name: String) -> Result<(), String> {
    // Try CLI first
    let ok = Command::new("claude")
        .args(["plugin", "uninstall", &name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if ok {
        return Ok(());
    }
    // Fallback: remove entry from installed_plugins.json
    let plugins_dir = claude_dir().join("plugins");
    let installed_json = plugins_dir.join("installed_plugins.json");
    if installed_json.exists() {
        let content = fs::read_to_string(&installed_json).map_err(|e| e.to_string())?;
        let mut json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        if let Some(map) = json["plugins"].as_object_mut() {
            let keys_to_remove: Vec<String> = map.keys()
                .filter(|k| k.starts_with(&format!("{}@", name)) || *k == name.as_str())
                .cloned()
                .collect();
            if !keys_to_remove.is_empty() {
                for key in &keys_to_remove {
                    map.remove(key);
                }
                let new_content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
                fs::write(&installed_json, new_content).map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }
    // Legacy: remove directory
    let path = plugins_dir.join(&name);
    if path.exists() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        Err(format!("插件 {} 未找到，请尝试手动卸载", name))
    }
}

// ── Memory ──

#[tauri::command]
fn list_memory() -> MemoryData {
    let claude = claude_dir();

    // Global
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

    // Projects
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

                // Get real project path
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
                    .unwrap_or_else(|| folder.file_name().unwrap_or_default().to_string_lossy().to_string());

                let project_name = project_name_from_path(&real_path);
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

                if !files.is_empty() {
                    projects.push(ProjectMemory { project: project_name, path: real_path, files, total_size });
                }
            }
        }
    }

    MemoryData { global, projects }
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

// ── Sessions ──

fn parse_jsonl_session(path: &Path, project: &str, project_path: &str) -> Option<Session> {
    let content = fs::read_to_string(path).ok()?;
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut cache_read = 0u64;
    let mut cache_write = 0u64;
    let mut title = String::new();
    let mut model_tokens: HashMap<String, u64> = HashMap::new();

    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        // Extract title from first user text
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
        // Sum tokens from assistant messages
        if val["type"].as_str() == Some("assistant") {
            if let Some(usage) = val["message"]["usage"].as_object() {
                let msg_input = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let msg_output = usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                input_tokens += msg_input;
                output_tokens += msg_output;
                cache_read += usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                cache_write += usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let model = val["message"]["model"].as_str().unwrap_or("unknown").to_string();
                *model_tokens.entry(model).or_default() += msg_input + msg_output;
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
    })
}

#[tauri::command]
fn list_sessions() -> Vec<Session> {
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

        let project_path = jsonl_files
            .first()
            .and_then(|e| project_path_from_jsonl(&e.path()))
            .unwrap_or_default();
        let project_name = project_name_from_path(&project_path);

        for file in &jsonl_files {
            if let Some(session) = parse_jsonl_session(&file.path(), &project_name, &project_path) {
                sessions.push(session);
            }
        }
    }
    sessions.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    sessions
}

#[tauri::command]
fn delete_session(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ExportMessage {
    pub role: String,
    pub text: String,
}

#[derive(Serialize)]
pub struct ExportSession {
    pub title: String,
    pub project: String,
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub messages: Vec<ExportMessage>,
}

#[tauri::command]
fn export_sessions(start_ts: u64, end_ts: u64) -> Vec<ExportSession> {
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

#[tauri::command]
fn list_project_paths() -> Vec<ProjectInfo> {
    let projects_dir = claude_dir().join("projects");
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    let Ok(entries) = fs::read_dir(&projects_dir) else { return result };
    for entry in entries.filter_map(|e| e.ok()) {
        let folder = entry.path();
        if !folder.is_dir() { continue; }
        let real_path = fs::read_dir(&folder).ok()
            .and_then(|mut rd| rd.find(|e| e.as_ref().map(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl")).unwrap_or(false)))
            .and_then(|e| e.ok())
            .and_then(|e| project_path_from_jsonl(&e.path()))
            .unwrap_or_default();
        if real_path.is_empty() || !seen.insert(real_path.clone()) { continue; }
        result.push(ProjectInfo { name: project_name_from_path(&real_path), path: real_path });
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    result
}

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

#[tauri::command]
fn read_session_messages(path: String) -> Vec<ChatMessage> {
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

// ── Stats ──

#[tauri::command]
fn get_stats() -> Stats {
    let sessions = list_sessions();
    let mut total_input = 0u64;
    let mut total_output = 0u64;
    let mut proj_map: HashMap<String, (u64, u64, u64)> = HashMap::new();
    let mut day_map: HashMap<String, (u64, u64, HashMap<String, u64>)> = HashMap::new();
    let mut model_totals: HashMap<String, u64> = HashMap::new();

    for s in &sessions {
        total_input += s.input_tokens;
        total_output += s.output_tokens;

        let p = proj_map.entry(s.project.clone()).or_default();
        p.0 += s.input_tokens;
        p.1 += s.output_tokens;
        p.2 += 1;

        let day = day_key_from_timestamp(s.timestamp);
        let d = day_map.entry(day).or_default();
        d.0 += s.input_tokens;
        d.1 += s.output_tokens;
        for (model, tokens) in &s.model_tokens {
            *d.2.entry(model.clone()).or_default() += tokens;
            *model_totals.entry(model.clone()).or_default() += tokens;
        }
    }

    let mut projects: Vec<ProjectStats> = proj_map
        .into_iter()
        .map(|(project, (i, o, c))| ProjectStats {
            project,
            input_tokens: i,
            output_tokens: o,
            session_count: c,
        })
        .collect();
    projects.sort_by(|a, b| (b.input_tokens + b.output_tokens).cmp(&(a.input_tokens + a.output_tokens)));

    let mut daily: Vec<DayStats> = day_map
        .into_iter()
        .map(|(date, (i, o, models))| DayStats { date, input_tokens: i, output_tokens: o, models })
        .collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));
    if daily.len() > 14 {
        daily = daily.split_off(daily.len() - 14);
    }

    Stats { daily, projects, total_input, total_output, session_count: sessions.len() as u64, model_totals }
}

#[tauri::command]
fn get_home_dir() -> String {
    home_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn get_config_path() -> String {
    claude_dir().join("cortex-config.json").to_string_lossy().to_string()
}

// ── Cache ──

#[tauri::command]
fn get_cache_info() -> Vec<CacheItem> {
    let claude = claude_dir();
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

#[tauri::command]
fn clear_cache(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    } else if p.is_file() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Run ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_skills,
            delete_skill,
            create_skill,
            list_plugins,
            uninstall_plugin,
            list_memory,
            read_file,
            write_file,
            delete_file,
            list_sessions,
            delete_session,
            export_sessions,
            read_session_messages,
            list_project_paths,
            get_stats,
            get_cache_info,
            clear_cache,
            get_home_dir,
            get_config_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
