//! Claude 订阅用量（5 小时 / 7 天窗口）
//!
//! 这是与本地 jsonl 统计**完全不同**的另一条数据线：它实时查询 Anthropic 官方
//! usage API，反映账号当前的限流额度，而非历史 token 累计。
//!
//! 数据流：
//!   后台轮询线程（见 `app::run`）每 30s 调一次 `fetch_and_cache`
//!     → 写入进程内单例缓存 `UsageCache`
//!     → 通过 `usage-updated` 事件广播给三处窗口（主程序用量页 / 菜单栏弹框 / 桌面卡片）。
//!   前端只渲染这同一份数据，所以三处数字与精度永远一致。
//!
//! 鉴权与续期（macOS）：
//!   token 存在 macOS 钥匙串里，access token 约 8 小时过期。本模块在过期前主动、
//!   或遇到 401/403 时被动地用 refresh token 换新 token 并无损写回钥匙串，
//!   因此用户无需再开终端跑 `claude` 来刷新凭证。

use crate::models::ClaudeUsage;
use std::process::Command;

// ── 进程内单例缓存 ──

/// 后端统一用量缓存：唯一的数据源，三处窗口都只读它，保证一致。
#[derive(Default)]
struct UsageCache {
    data: Option<ClaudeUsage>,
    fetched_at: Option<std::time::Instant>,
    /// 命中 429 后的退避截止时刻，期间不再打 API
    backoff_until: Option<std::time::Instant>,
}

fn usage_cache() -> &'static std::sync::Mutex<UsageCache> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<UsageCache>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(UsageCache::default()))
}

/// 命中 429 后的退避时长。
const USAGE_BACKOFF: std::time::Duration = std::time::Duration::from_secs(15 * 60);
/// 后台轮询间隔：唯一的拉取源，每隔这么久刷新一次缓存并广播给三处窗口。
pub(crate) const USAGE_REFRESH_SECS: u64 = 30;

/// 唯一的「拉取 + 写缓存」入口（阻塞）。后台轮询和 force 刷新都走它，保证全程只有一份数据。
/// 尊重 429 退避；其它错误时保留旧缓存（不把三处界面闪成错误）。
pub(crate) fn fetch_and_cache() -> ClaudeUsage {
    // 退避期：不打 API，直接给缓存
    {
        let c = usage_cache().lock().unwrap();
        if c.backoff_until.map_or(false, |b| b > std::time::Instant::now()) {
            if let Some(d) = &c.data {
                return d.clone();
            }
        }
    }

    let fresh = get_claude_usage_blocking();

    let mut c = usage_cache().lock().unwrap();
    let now = std::time::Instant::now();
    match &fresh.error {
        Some(e) if e.contains("过于频繁") => {
            c.backoff_until = Some(now + USAGE_BACKOFF);
            c.data.clone().unwrap_or(fresh)
        }
        Some(_) => c.data.clone().unwrap_or(fresh), // 网络/token 错误：有旧值就留着
        None => {
            c.data = Some(fresh.clone());
            c.fetched_at = Some(now);
            c.backoff_until = None;
            fresh
        }
    }
}

/// 命令只负责「初次渲染」：有缓存直接返回（后台轮询保持其新鲜）；force 或冷启动才主动拉一次。
#[tauri::command]
pub async fn get_claude_usage(force: Option<bool>) -> ClaudeUsage {
    if !force.unwrap_or(false) {
        let c = usage_cache().lock().unwrap();
        if let Some(d) = &c.data {
            return d.clone();
        }
    }
    tauri::async_runtime::spawn_blocking(fetch_and_cache)
        .await
        .unwrap_or_else(|_| ClaudeUsage {
            error: Some("执行失败，请重试".to_string()),
            ..Default::default()
        })
}

// ── macOS：钥匙串凭证 + OAuth 刷新 + usage API ──

// Claude Code 官方 OAuth client_id —— 用 refresh token 换新 access token 时必填
#[cfg(target_os = "macos")]
const OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

/// 钥匙串里的完整 Claude Code 凭证（保留全部字段，便于无损写回）。
#[cfg(target_os = "macos")]
struct OAuthCreds {
    account: String,         // 钥匙串条目的 account 名，写回时必须保留
    cred: serde_json::Value, // 完整外层 { "claudeAiOauth": { ... } }
}

#[cfg(target_os = "macos")]
impl OAuthCreds {
    fn oauth(&self) -> &serde_json::Value { &self.cred["claudeAiOauth"] }
    fn access_token(&self) -> &str { self.oauth()["accessToken"].as_str().unwrap_or("") }
    fn refresh_token(&self) -> &str { self.oauth()["refreshToken"].as_str().unwrap_or("") }
    fn subscription_type(&self) -> &str { self.oauth()["subscriptionType"].as_str().unwrap_or("") }
    fn expires_at(&self) -> i64 { self.oauth()["expiresAt"].as_i64().unwrap_or(0) }
}

#[cfg(target_os = "macos")]
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 从钥匙串读出完整凭证 + account 名。
#[cfg(target_os = "macos")]
fn read_oauth_creds() -> Result<OAuthCreds, String> {
    let w = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
        .map_err(|_| "无法读取 Keychain，请确认已登录 Claude Code".to_string())?;
    if !w.status.success() {
        return Err("无法读取 Keychain，请确认已登录 Claude Code".into());
    }
    let raw = String::from_utf8_lossy(&w.stdout).trim().to_string();
    let cred: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "Keychain 凭证格式错误".to_string())?;

    // 另取一次条目属性，解析出 account 名（写回时需要，缺失则用空串）
    let account = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", "Claude Code-credentials"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .and_then(|s| {
            s.lines().find_map(|l| {
                l.trim()
                    .strip_prefix("\"acct\"<blob>=\"")
                    .and_then(|r| r.strip_suffix('"'))
                    .map(|a| a.to_string())
            })
        })
        .unwrap_or_default();

    Ok(OAuthCreds { account, cred })
}

/// 用 refresh token 换新的 access token，成功后无损写回钥匙串并返回新凭证。
/// refresh token 会被服务端轮换，所以必须把新 refresh token 一并写回，否则下次刷新失败。
#[cfg(target_os = "macos")]
fn refresh_oauth_token(creds: &OAuthCreds) -> Result<OAuthCreds, String> {
    let refresh = creds.refresh_token();
    if refresh.is_empty() {
        return Err("无 refresh token".into());
    }
    let body = format!(
        "{{\"grant_type\":\"refresh_token\",\"refresh_token\":\"{}\",\"client_id\":\"{}\"}}",
        refresh, OAUTH_CLIENT_ID
    );
    // 注意：刷新端点是 claude.ai（不是 api.anthropic.com / console.*）；且必须带
    // claude-code 的 User-Agent，否则会被 Cloudflare 以 1010 拦截。
    let out = Command::new("curl")
        .arg("-s")
        .arg("--max-time").arg("20")
        .arg("-X").arg("POST")
        .arg("-H").arg("Content-Type: application/json")
        .arg("-H").arg("User-Agent: claude-code/2.1")
        .arg("-d").arg(&body)
        .arg("https://claude.ai/v1/oauth/token")
        .output()
        .map_err(|_| "刷新请求失败".to_string())?;
    let resp: serde_json::Value = serde_json::from_str(&String::from_utf8_lossy(&out.stdout))
        .map_err(|_| "刷新响应解析失败".to_string())?;
    let new_access = resp["access_token"]
        .as_str()
        .ok_or_else(|| "刷新失败：无 access_token".to_string())?
        .to_string();
    let new_refresh = resp["refresh_token"].as_str().unwrap_or(refresh).to_string();
    let expires_in = resp["expires_in"].as_i64().unwrap_or(28800);

    // 复制完整凭证，只更新三处字段，其余原样保留
    let mut cred = creds.cred.clone();
    cred["claudeAiOauth"]["accessToken"] = serde_json::Value::String(new_access);
    cred["claudeAiOauth"]["refreshToken"] = serde_json::Value::String(new_refresh);
    cred["claudeAiOauth"]["expiresAt"] = serde_json::Value::from(now_ms() + expires_in * 1000);
    let new_json = cred.to_string();

    let mut args: Vec<String> = vec!["add-generic-password".into(), "-U".into()];
    if !creds.account.is_empty() {
        args.push("-a".into());
        args.push(creds.account.clone());
    }
    args.push("-s".into());
    args.push("Claude Code-credentials".into());
    args.push("-w".into());
    args.push(new_json);
    let w = Command::new("/usr/bin/security")
        .args(&args)
        .output()
        .map_err(|_| "写回 Keychain 失败".to_string())?;
    if !w.status.success() {
        return Err("写回 Keychain 失败".into());
    }
    Ok(OAuthCreds { account: creds.account.clone(), cred })
}

/// 实际拉取一次用量（阻塞）。读凭证 → 必要时刷新 → 调 usage API → 解析。
#[cfg(target_os = "macos")]
fn get_claude_usage_blocking() -> ClaudeUsage {
    let mut creds = match read_oauth_creds() {
        Ok(c) => c,
        Err(e) => return ClaudeUsage { error: Some(e), ..Default::default() },
    };
    if creds.access_token().is_empty() {
        return ClaudeUsage {
            error: Some("未找到 OAuth Token，请确认已用官方账号登录 Claude Code".into()),
            ..Default::default()
        };
    }

    // 套餐名 + 订阅类型（后续错误响应也要携带）
    let sub = creds.subscription_type().to_string();
    let plan = match sub.as_str() {
        "pro"                => "Claude Pro",
        "max" | "claude_max" => "Claude Max",
        "team"               => "Claude Team",
        "enterprise"         => "Claude Enterprise",
        s if !s.is_empty()   => s,
        _                    => "Unknown",
    }
    .to_string();

    macro_rules! err_plan {
        ($msg:expr) => {
            ClaudeUsage {
                plan: plan.clone(),
                subscription_type: sub.clone(),
                error: Some($msg.to_string()),
                ..Default::default()
            }
        };
    }

    // 即将过期（剩余不足 5 分钟）则先主动刷新，省掉一次注定 401 的请求
    if creds.expires_at() - now_ms() < 5 * 60 * 1000 {
        if let Ok(c) = refresh_oauth_token(&creds) {
            creds = c;
        }
    }

    // 调一次 usage API，返回 (body, http_code)
    let call = |token: &str| -> (String, String) {
        let out = Command::new("curl")
            .arg("-s")
            .arg("-w").arg("\n%{http_code}")
            .arg("--max-time").arg("15")
            .arg("-H").arg(format!("Authorization: Bearer {}", token))
            .arg("-H").arg("anthropic-beta: oauth-2025-04-20")
            .arg("-H").arg("User-Agent: claude-code/2.1")
            .arg("https://api.anthropic.com/api/oauth/usage")
            .output();
        match out {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                match s.rfind('\n') {
                    Some(p) => (s[..p].to_string(), s[p + 1..].trim().to_string()),
                    None => (s, String::new()),
                }
            }
            Err(_) => (String::new(), "000".to_string()),
        }
    };

    let (mut body, mut status) = call(creds.access_token());

    // 仍然 401/403：access token 可能刚好过期，刷新一次再重试
    if status == "401" || status == "403" {
        match refresh_oauth_token(&creds) {
            Ok(c) => {
                creds = c;
                let (b, s) = call(creds.access_token());
                body = b;
                status = s;
            }
            Err(_) => return err_plan!("Token 无效或已过期，请重启 Claude Code 刷新凭证"),
        }
    }

    match status.as_str() {
        "401" | "403" => return err_plan!("Token 无效或已过期，请重启 Claude Code 刷新凭证"),
        "429" => return err_plan!("请求过于频繁，请稍后重试"),
        "000" => return err_plan!("网络请求失败，请检查网络连接"),
        s if !s.is_empty() && s != "200" => return err_plan!(&format!("API 错误 (HTTP {})", s)),
        _ => {}
    }

    let data: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return err_plan!("响应解析失败"),
    };

    ClaudeUsage {
        plan,
        subscription_type: sub,
        five_hour_pct:      data["five_hour"]["utilization"].as_f64(),
        five_hour_resets_at: data["five_hour"]["resets_at"].as_str().map(|s| s.to_string()),
        seven_day_pct:      data["seven_day"]["utilization"].as_f64(),
        seven_day_resets_at: data["seven_day"]["resets_at"].as_str().map(|s| s.to_string()),
        error: None,
    }
}

/// 非 macOS 平台：暂不支持官方用量查询（依赖 macOS 钥匙串读取凭证）。
#[cfg(not(target_os = "macos"))]
fn get_claude_usage_blocking() -> ClaudeUsage {
    ClaudeUsage {
        error: Some("官方用量查询仅支持 macOS，Windows/Linux 版本暂不支持此功能".to_string()),
        ..Default::default()
    }
}
