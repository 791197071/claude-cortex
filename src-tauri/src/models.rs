//! 数据模型层
//!
//! 这里集中存放所有「会跨越 Rust 后端 ↔ 前端」边界的数据结构。
//! 它们统一派生 `Serialize`/`Deserialize`，由 Tauri 在命令返回时自动转成 JSON，
//! 前端 (src/js/*.js) 直接拿到对应字段。把它们集中在一个文件里，方便对照前端的
//! 数据契约，也避免业务逻辑文件里夹杂大量结构体定义。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 一个技能（skill）。全局技能在 `~/.claude/skills/`，项目技能在 `<项目>/.claude/skills/`。
#[derive(Serialize, Deserialize, Clone)]
pub struct Skill {
    pub name: String,
    pub path: String,
    /// "global" 或 "project"
    pub scope: String,
    /// 项目技能才有：项目显示名
    pub project: Option<String>,
    /// 项目技能才有：项目真实路径
    pub project_path: Option<String>,
    pub description: String,
    /// 可触发该技能的斜杠命令，如 ["/foo"]
    pub commands: Vec<String>,
}

/// 一个已安装的插件（plugin）。
#[derive(Serialize, Deserialize, Clone)]
pub struct Plugin {
    pub name: String,
    pub path: String,
    pub description: String,
    pub version: String,
    pub skills: Vec<String>,
}

/// 单个记忆文件（`memory/*.md`）的元信息。
#[derive(Serialize, Deserialize, Clone)]
pub struct MemFile {
    pub id: String,
    pub name: String,
    pub path: String,
    /// 由文件名前缀推断：feedback / user / project / reference / memory
    pub mem_type: String,
    pub summary: String,
    pub size: u64,
}

/// 某个项目下的记忆集合。
#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectMemory {
    pub project: String,
    pub path: String,
    pub files: Vec<MemFile>,
    pub total_size: u64,
    pub claude_md_path: Option<String>,
}

/// 记忆总览：全局记忆 + 各项目记忆。
#[derive(Serialize, Deserialize)]
pub struct MemoryData {
    pub global: Vec<MemFile>,
    pub projects: Vec<ProjectMemory>,
}

/// 一次会话（一个 `.jsonl` 文件）解析出的统计与标题。
#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub id: String,
    pub path: String,
    pub project: String,
    pub project_path: String,
    pub title: String,
    /// 人类可读的相对时间（"今天 14:03" 等）
    pub date: String,
    /// 文件 mtime 的 Unix 秒，用于排序与按日期过滤
    pub timestamp: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    /// 按模型聚合的 (输入+输出) token
    pub model_tokens: HashMap<String, u64>,
    pub model_input_tokens: HashMap<String, u64>,
    pub model_output_tokens: HashMap<String, u64>,
}

/// 按天聚合的用量（用于统计页的趋势图）。
#[derive(Serialize, Deserialize)]
pub struct DayStats {
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub models: HashMap<String, u64>,
}

/// 按项目聚合的用量。
#[derive(Serialize, Deserialize)]
pub struct ProjectStats {
    pub project: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub session_count: u64,
}

/// 统计页的完整数据集（本地 jsonl 聚合，离线计算）。
#[derive(Serialize, Deserialize)]
pub struct Stats {
    pub daily: Vec<DayStats>,
    pub projects: Vec<ProjectStats>,
    pub total_input: u64,
    pub total_output: u64,
    pub session_count: u64,
    pub model_totals: HashMap<String, u64>,
    pub model_input_totals: HashMap<String, u64>,
    pub model_output_totals: HashMap<String, u64>,
    pub total_cache_read: u64,
    pub total_cache_write: u64,
}

/// Claude 订阅用量（5 小时 / 7 天窗口），来自 Anthropic 官方 usage API。
/// `Default` 让出错路径可以只填部分字段。
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct ClaudeUsage {
    pub plan: String,
    pub subscription_type: String,
    pub five_hour_pct: Option<f64>,
    pub five_hour_resets_at: Option<String>,
    pub seven_day_pct: Option<f64>,
    pub seven_day_resets_at: Option<String>,
    pub error: Option<String>,
}

/// 缓存清理页里的一项可清理缓存。
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

/// 会话详情里的一条消息。
#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub text: String,
}

/// 项目下拉框用的项目名 + 路径。
#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
}

/// CLAUDE.md 管理页里的一个条目（全局或某项目）。
#[derive(Serialize, Deserialize, Clone)]
pub struct ClaudeMdFile {
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub size: u64,
    pub project_path: String,
}

/// 规则文件（`~/.claude/rules/**/*.md`）。
#[derive(Serialize, Deserialize, Clone)]
pub struct RuleFile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub category: String,
    pub size: u64,
}

/// 一个 MCP 服务器配置（来自 `~/.claude.json` 的 `mcpServers`，只读展示用）。
/// 敏感值（env / headers）在后端已脱敏，不会下发到前端。
#[derive(Serialize, Deserialize, Clone)]
pub struct McpServer {
    pub name: String,
    /// "global"（用户级）/ "project"（项目级）
    pub scope: String,
    /// 项目级才有：项目显示名
    pub project: Option<String>,
    /// 项目级才有：项目真实路径
    pub project_path: Option<String>,
    /// 传输类型：stdio / sse / http
    pub transport: String,
    /// stdio 型：启动命令
    pub command: Option<String>,
    /// stdio 型：命令参数
    pub args: Vec<String>,
    /// sse/http 型：服务地址
    pub url: Option<String>,
    /// 环境变量的键名（仅键，值已脱敏不下发）
    pub env_keys: Vec<String>,
    /// 脱敏后的完整配置 JSON（供「查看详情」展示）
    pub raw: String,
}

/// 一个 MCP 服务器的连接探测结果。
#[derive(Serialize, Deserialize, Clone)]
pub struct McpStatus {
    pub name: String,
    pub scope: String,
    /// "ok"（正常运行）/ "not_found"（未连接：命令或地址找不到）/ "error"（异常：超时/响应无效）
    pub status: String,
    /// 人类可读的说明，如「握手成功」「命令 xxx 不存在」「握手超时」
    pub detail: String,
}

/// 导出用：一条消息（只需序列化输出，故不派生 Deserialize）。
#[derive(Serialize)]
pub struct ExportMessage {
    pub role: String,
    pub text: String,
}

/// 导出用：一个会话及其完整消息。
#[derive(Serialize)]
pub struct ExportSession {
    pub title: String,
    pub project: String,
    pub date: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub messages: Vec<ExportMessage>,
}
