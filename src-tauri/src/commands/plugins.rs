//! 插件（plugins）相关命令：列出 / 卸载。
//!
//! 已安装插件以 `~/.claude/plugins/installed_plugins.json` 为权威清单，键形如
//! `"{name}@{marketplace}"`。插件清单 `plugin.json` 可能位于安装目录，也可能在
//! marketplace 目录的多种布局下，`find_plugin_json` 负责把这几种情况都覆盖到。

use crate::models::Plugin;
use crate::util::claude_dir;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// 在一个 marketplace 目录下，按多种已知布局寻找指定插件的 `plugin.json`。
fn find_plugin_json(marketplace_dir: &Path, plugin_name: &str) -> Option<PathBuf> {
    // 1. 直挂：marketplaces/{marketplace}/.claude-plugin/plugin.json（如 claude-hud）
    let direct = marketplace_dir.join(".claude-plugin").join("plugin.json");
    if direct.exists() {
        return Some(direct);
    }
    // 2. 标准布局：marketplaces/{marketplace}/plugins/{plugin_name}/.claude-plugin/plugin.json
    let standard = marketplace_dir.join("plugins").join(plugin_name).join(".claude-plugin").join("plugin.json");
    if standard.exists() {
        return Some(standard);
    }
    // 3. 嵌套布局（如 context7：plugins/claude/{slug}/.claude-plugin/plugin.json）：
    //    扫描 plugins/{任意}/{任意}/.claude-plugin/plugin.json，按 "name" 字段匹配
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

/// 列出所有已安装插件。
#[tauri::command]
pub fn list_plugins() -> Vec<Plugin> {
    let plugins_dir = claude_dir().join("plugins");
    let installed_json = plugins_dir.join("installed_plugins.json");

    let mut plugins = Vec::new();

    // 读 installed_plugins.json —— 键是 "{name}@{marketplace}"
    if let Ok(content) = fs::read_to_string(&installed_json) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(map) = json["plugins"].as_object() {
                for (key, entries) in map {
                    // 拆出插件名（@ 前）与 marketplace（@ 后）
                    let (plugin_name, marketplace) = if let Some(at) = key.find('@') {
                        (&key[..at], &key[at + 1..])
                    } else {
                        (key.as_str(), key.as_str())
                    };

                    // 版本与安装路径取首个条目
                    let version = entries[0]["version"].as_str().unwrap_or("").to_string();
                    let install_path = entries[0]["installPath"].as_str().unwrap_or("").to_string();

                    // 优先读安装路径下的 plugin.json，否则去 marketplace 目录搜
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

    // 兜底：直接子目录里扫 plugin.json（旧布局）
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

/// 卸载插件：先试官方 CLI，失败再退而手动改 installed_plugins.json / 删目录。
#[tauri::command]
pub fn uninstall_plugin(name: String) -> Result<(), String> {
    // 先试官方 CLI
    let ok = Command::new("claude")
        .args(["plugin", "uninstall", &name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if ok {
        return Ok(());
    }
    // 兜底 1：从 installed_plugins.json 移除条目
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
    // 兜底 2：删除旧布局的目录
    let path = plugins_dir.join(&name);
    if path.exists() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        Err(format!("插件 {} 未找到，请尝试手动卸载", name))
    }
}
