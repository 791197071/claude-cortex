//! 命令层（Tauri commands）
//!
//! 前端通过 `invoke("xxx")` 调用的所有 `#[tauri::command]` 都收在这个子模块树里，
//! 按功能域拆分到独立文件。各文件只关心自己那块业务；`sessions` 里的两个基础查询
//! 被 `stats` / `claude_md` 复用（通过 `crate::commands::sessions::...`）。
//!
//! 这里用 `pub use xxx::*;` 把每个子模块的命令再导出到 `commands::` 顶层，
//! 这样 `app::run()` 注册 `generate_handler!` 时可以直接写 `commands::list_skills`，
//! 不必关心它具体落在哪个文件。

pub mod claude_md;
pub mod fs_ops;
pub mod mcp;
pub mod memory;
pub mod plugins;
pub mod rules;
pub mod sessions;
pub mod skills;
pub mod stats;
pub mod system;

pub use claude_md::*;
pub use fs_ops::*;
pub use mcp::*;
pub use memory::*;
pub use plugins::*;
pub use rules::*;
pub use sessions::*;
pub use skills::*;
pub use stats::*;
pub use system::*;
