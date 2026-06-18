# Claude Cortex

> 一个 macOS 桌面应用，把 **Claude Code** 散落在本地的数据（会话、技能、插件、记忆、规则、用量、MCP 配置等）汇总成一个可视化面板，统一查看与管理。

基于 [Tauri 2](https://tauri.app/) 构建，Rust 后端 + 原生 HTML/CSS/JS 前端，无前端框架、无打包步骤，启动快、体积小。所有数据均为**本地读取**，不上传任何内容。

---

## ✨ 功能

| 模块 | 说明 |
|------|------|
| **统计用量** | 离线解析 `~/.claude/projects/*.jsonl`，按天 / 项目 / 模型聚合 token 用量，并按定价表估算花费 |
| **技能 Skills** | 列出全局（`~/.claude/skills/`）与项目（`<项目>/.claude/skills/`）技能，支持新建 / 删除 |
| **插件 Plugins** | 列出已安装插件，描述自动获取（本地 README → npm → LLM 翻译三层回退），支持卸载 |
| **规则记忆 Memory** | 查看 / 编辑全局与各项目的记忆文件及 `CLAUDE.md` |
| **会话历史 Sessions** | 浏览会话列表与消息详情、删除、导出，支持**一键 LLM 总结**（含 AI 评分） |
| **MCP 服务器** | 只读聚合展示 `~/.claude.json` 的全局 + 项目级 MCP 服务器，并**主动握手探测连接状态**（正常运行 / 未连接 / 异常） |
| **缓存清理** | 枚举并清理 Claude Code 的各类缓存目录 / 文件，显示各自占用 |
| **设置** | 配置一键总结所用的 LLM 提供商（Claude / DeepSeek / Qwen）API Key |

### 用量额度（macOS）

实时查询 Anthropic 官方 usage API，展示 **5 小时 / 7 天**额度，三处同步显示、数值一致：

- **主程序用量页**
- **菜单栏弹框**（非激活 NSPanel，可浮于其它 App 全屏之上）
- **桌面常驻卡片**（整窗任意处可拖动、位置记忆、可切换是否置顶）

凭证（OAuth token）从 macOS 钥匙串读取，**在过期前或遇 401 时自动用 refresh token 刷新并写回钥匙串**，无需再手动开终端跑 `claude` 续期。

---

## 🧱 技术栈与项目结构

- **后端**：Rust + Tauri 2，按职责分层模块化：

  ```
  src-tauri/src/
    lib.rs          模块声明 + 入口
    models.rs       跨前后端的序列化数据结构
    util.rs         路径 / 时间 / 大小 / 配置等纯工具
    commands/       所有 Tauri 命令，按域拆分
      skills · plugins · memory · fs_ops · sessions ·
      stats · claude_md · rules · system · mcp
    usage.rs        订阅用量缓存 + OAuth 自动刷新 + 命令
    app/
      mod.rs        run() 编排：窗口 / 托盘 / 命令注册 / 后台轮询
      macos.rs      macOS NSPanel / 托盘 / 桌面卡片平台代码
  ```

- **前端**：原生 HTML/CSS/JS（无框架），`src/js/` 下按页面/职责分模块（`stats.js`、`sessions.js`、`mcp.js`、`usage.js`…）。`frontendDist` 直接指向 `src/`，无需构建步骤。

---

## 📂 数据来源

全部本地读取，不联网上传（联网仅用于：可选的用量 API 查询、插件描述获取、一键总结调 LLM）：

- `~/.claude/projects/*/*.jsonl` —— 会话记录与 token 统计
- `~/.claude/{skills,memory,rules,plugins}/` —— 技能 / 记忆 / 规则 / 插件
- `~/.claude.json` —— MCP 服务器配置
- macOS 钥匙串 `Claude Code-credentials` —— 订阅用量的 OAuth 凭证
- Anthropic usage API —— 5 小时 / 7 天额度

> **隐私**：MCP 配置里的 `env` / `headers` 等敏感值在下发到前端前已脱敏为 `***`；用量凭证仅在本机读取与刷新，不外传。

---

## 🚀 开发与构建

环境要求：[Node.js](https://nodejs.org/)、[Rust](https://www.rust-lang.org/) 工具链、Tauri 的系统依赖。

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run tauri dev

# 打包构建（产物在 src-tauri/target/release/bundle/）
npm run tauri build
```

---

## 💻 平台支持

主要面向 **macOS**。以下功能依赖 macOS 平台能力（钥匙串、AppKit/NSPanel）：

- 订阅用量查询与自动刷新（读 macOS 钥匙串）
- 菜单栏弹框 / 桌面卡片浮于全屏之上（NSPanel）

其余数据管理类功能（统计、技能、插件、记忆、会话、MCP 列表等）与平台无关。

---

## 📝 许可

私有项目，暂未开源授权。
