/* ── 路由 / 页面切换模块 ─────────────────────────────────────
 * 管理侧边栏导航与页面显示切换逻辑。
 * 使用简单的 CSS class 切换（.active）而非单页应用路由框架，
 * 因为此项目页面数量固定，不需要 URL 路由。
 * 依赖：无
 * ──────────────────────────────────────────────────────────────── */

/**
 * 切换当前可见页面
 * @param {string}      name - 页面名称，对应 id="page-{name}" 的 DOM 元素
 * @param {HTMLElement} el   - 被点击的导航按钮（用于更新 active 样式）
 */
function switchPage(name, el) {
  /* 隐藏所有页面 */
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  /* 取消所有导航项的激活状态 */
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  /* 激活目标页面和对应导航项 */
  document.getElementById('page-' + name).classList.add('active');
  el.classList.add('active');
}

/**
 * 静态记忆项目 Tab 切换（已弃用，由 switchMemTabDyn 替代）
 * 保留以防旧版 HTML 仍有引用
 */
function switchMemTab(id, el) {
  document.querySelectorAll('.mem-proj-card').forEach(c => c.style.display = 'none');
  document.querySelectorAll('.mem-proj-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(id).style.display = '';
  el.classList.add('active');
}


