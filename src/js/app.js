/* ── 应用入口模块 ────────────────────────────────────────────────
 * 统筹初始化所有功能模块，并绑定 Tauri 原生窗口控制按钮。
 * 必须作为最后一个 <script> 标签加载，确保所有模块函数均已定义。
 * 依赖：全部其余 JS 模块（utils → toast → modal → router →
 *         settings → skills → plugins → memory → sessions →
 *         export → summary → stats → cache）
 * ──────────────────────────────────────────────────────────────── */

/**
 * 并发初始化所有页面模块
 * 使用 Promise.allSettled 并发加载，减少首屏等待时间
 */
async function initApp() {
  await Promise.allSettled([
    loadSkills(),
    loadPlugins(),
    loadMemory(),
    loadSessions(),
    loadStats(),
    loadCache(),
    loadSettings(),
    loadClaudeUsage(),
  ]);
}

/* ── Tauri 原生窗口控制 ── */

document.addEventListener('DOMContentLoaded', () => {
  /* 使用 getCurrentWindow（Tauri v2 推荐 API） */
  const { getCurrentWindow } = window.__TAURI__?.window ?? {};
  if (getCurrentWindow) {
    const win = getCurrentWindow();
    document.getElementById('btn-close')?.addEventListener('click', () => win.close());
    document.getElementById('btn-minimize')?.addEventListener('click', () => win.minimize());
    document.getElementById('btn-maximize')?.addEventListener('click', async () => {
      /* 全屏切换（与原始行为一致） */
      const isFull = await win.isFullscreen();
      await win.setFullscreen(!isFull);
    });
  }

  /* 所有模块均已加载，启动应用 */
  initApp();

  /* ── 窗口获焦 / 切回时刷新统计和用量 ── */
  let _lastFocusRefresh = 0;
  function _onFocus() {
    const now = Date.now();
    if (now - _lastFocusRefresh < 60_000) return;
    _lastFocusRefresh = now;
    loadStats();
    loadClaudeUsage(false, true);
  }

  window.addEventListener('focus', _onFocus);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) _onFocus();
  });

  /* Tauri 原生窗口焦点事件（比 web focus 更可靠） */
  const { listen } = window.__TAURI__?.event ?? {};
  if (listen) listen('tauri://focus', _onFocus);

});

