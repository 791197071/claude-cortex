//! MCP 服务器管理命令（只读 + 连接探测）
//!
//! Claude Code 的 MCP 服务器配置存在 `~/.claude.json` 里两处：
//!   · 全局/用户级 → 顶层 `mcpServers` 对象
//!   · 项目级       → `projects.<项目路径>.mcpServers` 对象
//! 单个服务器有两种形态：
//!   · stdio：`{ "type":"stdio", "command":..., "args":[...], "env":{...} }`
//!   · sse/http：`{ "type":"sse"|"http", "url":..., "headers":{...} }`
//!
//! `list_mcp_servers` 只读聚合展示（敏感值脱敏，不写 `~/.claude.json`）。
//! `check_mcp_server` 主动发一次 MCP `initialize` 握手，真实判断服务器是否连得上。

use crate::models::{McpServer, McpStatus};
use crate::util::{home_dir, project_name_from_path};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

/// MCP 握手探测的超时时间。用交互式登录 shell 启动，需容忍 shell 自身的初始化耗时。
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// 标准的 MCP initialize 握手请求（JSON-RPC 2.0）。
const INITIALIZE_REQ: &str = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"claude-cortex","version":"1.0.0"}}}"#;

// ── 只读列表 ──

/// 把单个服务器的 JSON 配置解析成 `McpServer`，并对敏感值脱敏。
fn parse_server(
    name: &str,
    scope: &str,
    project: Option<String>,
    project_path: Option<String>,
    cfg: &serde_json::Value,
) -> McpServer {
    let transport = cfg["type"].as_str().unwrap_or("stdio").to_string();
    let command = cfg["command"].as_str().map(|s| s.to_string());
    let args = cfg["args"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let url = cfg["url"].as_str().map(|s| s.to_string());
    let env_keys = cfg["env"]
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();

    // 脱敏：env / headers 的值替换成 ***，再美化成 JSON 供「查看详情」展示，
    // 避免把 API Key / Token 等明文下发到前端。
    let mut sanitized = cfg.clone();
    for secret_field in ["env", "headers"] {
        if let Some(obj) = sanitized.get_mut(secret_field).and_then(|v| v.as_object_mut()) {
            for (_, val) in obj.iter_mut() {
                *val = serde_json::Value::String("***".into());
            }
        }
    }
    let raw = serde_json::to_string_pretty(&sanitized).unwrap_or_default();

    McpServer { name: name.to_string(), scope: scope.to_string(), project, project_path, transport, command, args, url, env_keys, raw }
}

/// 读取并返回整个 `~/.claude.json`（解析为 JSON）。
fn read_claude_json() -> Option<serde_json::Value> {
    let path = home_dir().join(".claude.json");
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// 列出所有 MCP 服务器（全局 + 项目级），全局在前、再按名称排序。
#[tauri::command]
pub fn list_mcp_servers() -> Vec<McpServer> {
    let Some(json) = read_claude_json() else {
        return vec![];
    };

    let mut out = Vec::new();

    // 全局 mcpServers
    if let Some(map) = json["mcpServers"].as_object() {
        for (name, cfg) in map {
            out.push(parse_server(name, "global", None, None, cfg));
        }
    }

    // 项目级 projects.<path>.mcpServers
    if let Some(projects) = json["projects"].as_object() {
        for (proj_path, pcfg) in projects {
            if let Some(map) = pcfg["mcpServers"].as_object() {
                for (name, cfg) in map {
                    out.push(parse_server(
                        name,
                        "project",
                        Some(project_name_from_path(proj_path)),
                        Some(proj_path.clone()),
                        cfg,
                    ));
                }
            }
        }
    }

    // 全局("global") 排在项目("project") 前，同组内按名称
    out.sort_by(|a, b| a.scope.cmp(&b.scope).then(a.name.cmp(&b.name)));
    out
}

// ── 连接探测 ──

/// 取登录 shell 的完整 PATH。
/// GUI 应用从 Dock 启动时环境 PATH 很可能不含 nvm / homebrew 等用户路径，
/// 直接 spawn 会找不到命令而误报「未连接」；用登录 shell 解析出真实 PATH 注入子进程可避免。
/// 把一个参数安全地包成单引号形式，供拼进 shell 命令行（处理其中的单引号）。
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// 从原始配置里取某个服务器的**完整**（未脱敏）配置——探测时需要真实的 env / headers。
fn find_raw_config(name: &str, scope: &str, project_path: Option<&str>) -> Option<serde_json::Value> {
    let json = read_claude_json()?;
    if scope == "global" {
        json["mcpServers"].get(name).cloned()
    } else {
        let path = project_path?;
        json["projects"][path]["mcpServers"].get(name).cloned()
    }
}

/// 探测 stdio 型：实际启动进程并发一次 initialize 握手。
///
/// 关键：通过用户的**交互式登录 shell**（`$SHELL -ilc '<命令>'`）来执行，
/// 这样命令运行在和「用户在终端里」完全一致的环境中——
/// 尤其是 nvm 这类把 PATH 初始化写在 `.zshrc`（仅交互式 shell 读取）里的工具，
/// 否则 GUI 应用从 Dock 启动时 PATH 不全，会把本可连接的服务器误判为「未连接」。
fn probe_stdio(cfg: &serde_json::Value) -> (String, String) {
    let command = match cfg["command"].as_str() {
        Some(c) if !c.is_empty() => c,
        _ => return ("error".into(), "配置缺少 command".into()),
    };
    let args: Vec<String> = cfg["args"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    // 拼成一条 shell 命令行：command arg1 arg2 …（各段单引号转义）
    let mut cmdline = shell_quote(command);
    for a in &args {
        cmdline.push(' ');
        cmdline.push_str(&shell_quote(a));
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    let mut proc = Command::new(&shell);
    proc.arg("-ilc")
        .arg(&cmdline)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped()); // 捕获 stderr，失败时附为诊断信息
    // 叠加配置里声明的 env（用真实值）
    if let Some(env) = cfg["env"].as_object() {
        for (k, v) in env {
            if let Some(s) = v.as_str() {
                proc.env(k, s);
            }
        }
    }

    let mut child = match proc.spawn() {
        Ok(c) => c,
        Err(e) => return ("error".into(), format!("无法启动 shell：{}", e)),
    };

    // 写入 initialize 请求；stdin 句柄保留到探测结束再释放（绑定到 _stdin_keep），
    // 避免过早关闭管道导致部分 server 因 stdin EOF 提前退出。
    let _stdin_keep = child.stdin.take().map(|mut stdin| {
        let _ = writeln!(stdin, "{}", INITIALIZE_REQ);
        let _ = stdin.flush();
        stdin
    });

    // 用独立线程逐行读 stdout，跳过日志行，找到第一条 JSON-RPC 响应
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            return ("error".into(), "无法读取进程输出".into());
        }
    };
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = tx.send(None); // EOF
                    break;
                }
                Ok(_) => {
                    let t = line.trim();
                    if t.is_empty() {
                        continue;
                    }
                    // 只认 JSON-RPC 响应，日志等非 JSON 行跳过
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(t) {
                        if v.get("jsonrpc").is_some() {
                            let _ = tx.send(Some(v));
                            break;
                        }
                    }
                }
                Err(_) => {
                    let _ = tx.send(None);
                    break;
                }
            }
        }
    });

    let result = rx.recv_timeout(PROBE_TIMEOUT);
    let _ = child.kill();
    let _ = child.wait();

    // 握手成功直接返回；失败时读取 stderr 作为诊断依据
    if let Ok(Some(v)) = &result {
        if v.get("result").is_some() {
            return ("ok".into(), "握手成功，服务器正常响应".into());
        }
        if let Some(err) = v.get("error") {
            let msg = err["message"].as_str().unwrap_or("未知错误");
            return ("error".into(), format!("服务器返回错误：{}", msg));
        }
        return ("error".into(), "响应不是有效的 MCP 握手".into());
    }

    // 读取 stderr 残留（截断），用于判断「命令找不到」并给出可读原因
    let mut errbuf = String::new();
    if let Some(se) = child.stderr.take() {
        let _ = se.take(4096).read_to_string(&mut errbuf);
    }
    let err_snip = errbuf.trim().chars().take(200).collect::<String>();

    // shell 报「command not found」「No such file」→ 命令未安装，归为「未连接」
    let lower = errbuf.to_lowercase();
    if lower.contains("command not found") || lower.contains("no such file") {
        return ("not_found".into(), format!("命令 {} 不存在（未安装或不在 PATH）", command));
    }

    match result {
        Err(_) => ("error".into(), "握手超时（10 秒内无响应）".into()),
        _ => {
            if err_snip.is_empty() {
                ("error".into(), "进程无有效输出即退出（可能启动失败）".into())
            } else {
                ("error".into(), format!("启动失败：{}", err_snip))
            }
        }
    }
}

/// 探测 sse/http 型：用 curl 连 url 看可达性（http 额外尝试 initialize 握手）。
fn probe_url(cfg: &serde_json::Value) -> (String, String) {
    let url = match cfg["url"].as_str() {
        Some(u) if !u.is_empty() => u,
        _ => return ("error".into(), "配置缺少 url".into()),
    };

    let mut cmd = Command::new("curl");
    cmd.arg("-s")
        .arg("--max-time").arg("6")
        .arg("-X").arg("POST")
        .arg("-H").arg("Content-Type: application/json")
        .arg("-H").arg("Accept: application/json, text/event-stream");
    // 带上配置里的真实 headers（如鉴权）
    if let Some(headers) = cfg["headers"].as_object() {
        for (k, v) in headers {
            if let Some(s) = v.as_str() {
                cmd.arg("-H").arg(format!("{}: {}", k, s));
            }
        }
    }
    cmd.arg("-d").arg(INITIALIZE_REQ)
        .arg("-w").arg("\n%{http_code}")
        .arg(url);

    let out = match cmd.output() {
        Ok(o) => o,
        Err(_) => return ("error".into(), "无法执行 curl".into()),
    };
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let (body, code) = match text.rfind('\n') {
        Some(p) => (text[..p].to_string(), text[p + 1..].trim().to_string()),
        None => (String::new(), text.clone()),
    };

    match code.as_str() {
        // 连不上：DNS/连接失败 curl 给 000
        "000" | "" => ("not_found".into(), format!("无法连接 {}", url)),
        c if c.starts_with('2') => {
            // 能连上且返回 2xx：若 body 含 JSON-RPC 响应则更确定
            if body.contains("\"jsonrpc\"") || body.contains("\"result\"") || body.contains("event:") {
                ("ok".into(), "握手成功，服务器正常响应".into())
            } else {
                ("ok".into(), format!("可达（HTTP {}）", c))
            }
        }
        // 4xx/5xx：连得上但服务端拒绝/出错
        c => ("error".into(), format!("服务器返回 HTTP {}", c)),
    }
}

/// 同步探测逻辑：读配置 → 按传输类型握手。会阻塞（最长 PROBE_TIMEOUT），
/// 因此由命令层放到 `spawn_blocking` 的线程里跑，不占用主线程。
fn check_mcp_blocking(name: String, scope: String, project_path: Option<String>) -> McpStatus {
    let cfg = match find_raw_config(&name, &scope, project_path.as_deref()) {
        Some(c) => c,
        None => {
            return McpStatus { name, scope, status: "error".into(), detail: "配置已不存在".into() };
        }
    };

    let transport = cfg["type"].as_str().unwrap_or("stdio");
    let (status, detail) = if transport == "stdio" {
        probe_stdio(&cfg)
    } else {
        probe_url(&cfg)
    };

    McpStatus { name, scope, status, detail }
}

/// 探测单个 MCP 服务器的连接状态。
///
/// 命令本身是 `async`，把会阻塞的探测丢进 `spawn_blocking` 的后台线程，
/// 避免冻结主线程 / webview（之前同步命令会让点「重测」时整页卡住）。
#[tauri::command]
pub async fn check_mcp_server(name: String, scope: String, project_path: Option<String>) -> McpStatus {
    let (n, s) = (name.clone(), scope.clone());
    tauri::async_runtime::spawn_blocking(move || check_mcp_blocking(name, scope, project_path))
        .await
        .unwrap_or_else(|_| McpStatus { name: n, scope: s, status: "error".into(), detail: "探测任务执行失败".into() })
}
