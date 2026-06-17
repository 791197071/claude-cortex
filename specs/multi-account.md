# 多账号切换功能方案

## 核心原理

Claude Code 账号数据只存在两处：

| 位置 | 内容 |
|------|------|
| `~/.claude.json` → `oauthAccount` 字段 | 邮箱、UUID 等元信息 |
| macOS Keychain，服务名 `"Claude Code-credentials"`，账号名为系统用户名 | 实际 OAuth Token |

**切换账号 = 原子性替换这两个数据**，纯本地操作，毫秒级，无需 WebView，无需处理 Google OAuth。

账号展示用邮箱（`oauthAccount.emailAddress`），不需要别名。

---

## 数据存储设计

每个账号在 Keychain 单独存一条：
- 服务名：`"Claude Cortex-account-{accountUuid}"`
- 账号名：同系统用户名（保持一致）
- 内容：完整的 OAuth Token 字符串

活跃账号继续存在 `"Claude Code-credentials"`（Claude Code 原生读取位置，不改它）。

账号列表存在 `~/.claude/cortex-accounts.json`：
```json
[
  {
    "uuid": "766bb47e-...",
    "email": "a791197071@gmail.com",
    "addedAt": "2026-06-17T..."
  }
]
```

---

## 流程

### 切换账号
1. 从 Keychain 读取目标账号 `"Claude Cortex-account-{uuid}"` 的 token
2. 把该 token 写入 `"Claude Code-credentials"`（覆盖）
3. 更新 `~/.claude.json` 的 `oauthAccount` 字段为目标账号的元信息
4. UI 更新活跃标记

### 添加账号（唯一需要用户配合的步骤，低频）
1. 备份当前 token（已在 Keychain 中有槽位，跳过）和 `oauthAccount`
2. 删除 `"Claude Code-credentials"` 条目（让 Claude Code 认为未登录）
3. 弹窗提示：「请在终端执行 `claude auth login`，完成后回到这里」
4. 监听 `~/.claude.json` 文件变化（`notify` crate）
5. 检测到 `oauthAccount.accountUuid` 变为未知账号时：
   a. 读取新 token（Claude Code 已写入 `"Claude Code-credentials"`）
   b. 复制到 `"Claude Cortex-account-{newUuid}"` 保存
   c. 追加到 `cortex-accounts.json`
   d. 恢复上一个账号为活跃（执行"切换"流程）
   e. 关闭弹窗，列表显示新账号

### 删除账号
1. 若是当前活跃账号，先切换到列表第一个其他账号
2. 删除 Keychain 中 `"Claude Cortex-account-{uuid}"` 条目
3. 从 `cortex-accounts.json` 移除该条目

---

## Rust 实现关键点

```toml
# Cargo.toml 新增依赖
security-framework = "2"   # macOS Keychain 读写
notify = "6"               # 文件变化监听（添加账号时用）
```

Keychain 操作示例：
```rust
use security_framework::passwords::{get_generic_password, set_generic_password, delete_generic_password};

// 读
let token = get_generic_password("Claude Code-credentials", "zhuxingxing")?;
// 写
set_generic_password("Claude Cortex-account-{uuid}", "zhuxingxing", token_bytes)?;
// 删
delete_generic_password("Claude Cortex-account-{uuid}", "zhuxingxing")?;
```

`~/.claude.json` 的 `oauthAccount` 修改：读取整个 JSON → 替换该字段 → 写回（其他字段不动）。

---

## Tauri 命令清单（待实现）

| 命令 | 参数 | 说明 |
|------|------|------|
| `list_accounts` | — | 读 `cortex-accounts.json`，标注哪个是活跃账号 |
| `switch_account` | `uuid: String` | 切换到指定账号 |
| `delete_account` | `uuid: String` | 删除账号 |
| `begin_add_account` | — | 备份当前凭据、清空、开始监听 |
| `cancel_add_account` | — | 恢复备份，中止监听 |

`begin_add_account` 触发后在后台监听 `~/.claude.json`，检测到新账号后通过 Tauri `emit` 推送 `account-added` 事件到前端。

---

## 边界情况

| 情况 | 处理 |
|------|------|
| 只有一个账号 | 删除按钮禁用 |
| 添加已存在账号（UUID 相同） | 检测到重复，提示并恢复，不存新槽位 |
| 用户在添加流程中关闭软件 | `cancel_add_account` 在 window close 事件中自动触发恢复 |
| Token 过期 | 列表里标记"已失效"（可通过调一次 claude.ai API 验证），点击引导重新 `claude auth login` |

---

## 不在范围内

- 多账号同时运行
- 账号数据同步
- 与 claude.ai WebView 相关的任何内容
