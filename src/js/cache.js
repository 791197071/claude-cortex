/* ── 缓存管理页模块 ──────────────────────────────────────────────
 * 列出 Claude Code 的本地缓存文件，支持单条清除和一键全部清除。
 *
 * 后端 get_cache_info 返回：
 * [{ id, path, short_path, label, bytes, size_str, exists }]
 *
 * 依赖：utils.js（invoke, escHtml, fmtSize）、toast.js、modal.js（showConfirm）
 * ──────────────────────────────────────────────────────────────── */

/**
 * 加载并渲染缓存列表，同时更新顶部统计卡片
 */
async function loadCache() {
  const items = await invoke('get_cache_info').catch(() => []);
  const grid  = document.getElementById('cache-grid');
  if (!grid) return;

  /* 仅统计实际存在的缓存项 */
  const existItems = items.filter(i => i.exists);
  const totalBytes = existItems.reduce((s, i) => s + i.bytes, 0);
  const largest    = existItems.reduce((a, b) => b.bytes > (a?.bytes || 0) ? b : a, null);

  /* 更新统计卡片 */
  const totalEl   = document.getElementById('total-size');
  const largestEl = document.getElementById('cache-largest-size');
  const countEl   = document.getElementById('cache-item-count');
  const hintEl    = document.getElementById('clear-all-size');

  if (totalEl) {
    totalEl.textContent = fmtSize(totalBytes);
    totalEl.className   = 'stat-val ' + (totalBytes > 10 * 1024 * 1024 ? 'c-amber' : 'c-green');
  }
  if (largestEl) largestEl.textContent = largest ? largest.size_str : '0 B';
  if (countEl)   countEl.textContent   = existItems.length;
  if (hintEl)    hintEl.textContent    = totalBytes > 0 ? `（共 ${fmtSize(totalBytes)}）` : '';

  /* 更新侧边栏徽标：显示总缓存大小，为 0 时隐藏 */
  const navBadge = document.getElementById('nav-badge-cache');
  if (navBadge) {
    if (totalBytes > 0) {
      navBadge.textContent    = fmtSize(totalBytes);
      navBadge.style.display  = '';
    } else {
      navBadge.textContent   = '';
      navBadge.style.display = 'none';
    }
  }

  /* 渲染缓存卡片网格 */
  grid.innerHTML = items.map(item => {
    const big       = item.bytes > 5 * 1024 * 1024;
    const sizeClass = 'cache-size' + (big ? ' warn' : '') + (!item.exists ? ' cleared-text' : '');
    const cardClass = 'cache-card' + (big ? ' warn' : '') + (!item.exists ? ' cleared' : '');
    return `
    <div class="${cardClass}" id="${escHtml(item.id)}" data-path="${escHtml(item.path)}">
      <div class="${sizeClass}">${item.exists ? escHtml(item.size_str) : '已清除'}</div>
      <div class="cache-path">${escHtml(item.short_path)}</div>
      <div class="cache-note">${escHtml(item.label)}</div>
      <div class="cache-actions">
        ${item.exists ? `<button class="btn btn-warning" onclick="clearCache('${escHtml(item.id)}')">清除</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

/**
 * 清除单条缓存（确认后执行）
 * @param {string} id - 缓存卡片的 DOM id，同时也是 item.id
 */
window.clearCache = function (id) {
  const card = document.getElementById(id);
  if (!card || !card.dataset.path) return;
  showConfirm('确认清除', '确定要清除该缓存吗？此操作不可撤销。', '确认清除',
    () => doClearCache(id, card.dataset.path));
};

/**
 * 执行单条缓存清除：调用后端 → 更新卡片 UI → 刷新统计
 */
async function doClearCache(id, path) {
  await invoke('clear_cache', { path }).catch(e => { toast('清除失败：' + e, 'danger'); return; });
  const card = document.getElementById(id);
  if (card) {
    card.classList.add('cleared');
    const sz = card.querySelector('.cache-size');
    if (sz) { sz.className = 'cache-size cleared-text'; sz.textContent = '已清除'; }
    const btn = card.querySelector('.btn');
    if (btn) btn.remove();
  }
  await loadCache();
  toast('已清除', 'success');
}

/**
 * 一键清除所有存在的缓存（遍历调用 clear_cache）
 */
window.clearAll = function () {
  showConfirm('确认清除全部', '确定要清除全部缓存吗？此操作不可撤销。', '全部清除', async () => {
    const items = await invoke('get_cache_info').catch(() => []);
    for (const item of items) {
      if (item.exists) await invoke('clear_cache', { path: item.path }).catch(() => {});
    }
    await loadCache();
    toast('全部缓存已清除', 'success');
  });
};
