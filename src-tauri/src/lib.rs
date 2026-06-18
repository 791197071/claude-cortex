//! Claude Cortex —— Tauri 后端 crate 根
//!
//! 本文件只做模块装配，不含业务逻辑。各层职责：
//!   · `models`   —— 跨前后端的序列化数据结构（数据契约）
//!   · `util`     —— 与业务无关的纯工具函数（路径 / 时间 / 大小 / 配置）
//!   · `commands` —— 前端 `invoke` 调用的所有 Tauri 命令，按功能域拆子模块
//!   · `usage`    —— Claude 订阅用量：官方 API 查询 + OAuth 自动刷新 + 缓存
//!   · `app`      —— 应用编排：窗口 / 托盘 / 命令注册 / 后台轮询（含 macOS 平台代码）
//!
//! 入口 `run()` 由 `app` 模块导出，`main.rs` 直接调用它。

mod app;
mod commands;
mod models;
mod usage;
mod util;

pub use app::run;
