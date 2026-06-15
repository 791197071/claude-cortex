/* ── Claude Pro 官方用量模块 ─────────────────────────────────────
 * 通过 Rust 后端调用 Anthropic OAuth Usage API，展示：
 *  - 5小时窗口已用百分比 + 倒计时
 *  - 本周额度已用百分比 + 重置日期
 * 应用启动时自动请求一次；有 5 分钟内存缓存，期间不重复请求。
 * 依赖：utils.js（invoke）、toast.js
 * ──────────────────────────────────────────────────────────────── */

const USAGE_CACHE_TTL = 5 * 60 * 1000;
let _usageCache    = null;   // { data, fetchedAt }
let _countdownTimer = null;
let _fetching      = false;

/**
 * 主入口：启动时和切换到统计页时调用。
 * - 有缓存且未过期 → 直接渲染，不请求网络
 * - 无缓存 → 显示加载状态后请求
 * - 有缓存但已过期 → 保持旧数据可见，静默后台刷新
 */
window.loadClaudeUsage = async function (force = false, silent = false) {
  const now = Date.now();

  // 缓存有效，直接渲染
  if (!force && _usageCache && now - _usageCache.fetchedAt < USAGE_CACHE_TTL) {
    _renderUsage(_usageCache.data, _usageCache.fetchedAt);
    return;
  }

  // silent 模式（焦点刷新）：有旧数据时不显示转圈，直接后台更新
  if (!silent && !_usageCache) _showLoading(true);

  // 防止并发重复请求
  if (_fetching) return;
  _fetching = true;

  try {
    const data = await invoke('get_claude_usage');
    _usageCache = { data, fetchedAt: Date.now() };
    _renderUsage(data, _usageCache.fetchedAt);
  } catch (e) {
    // 只在没有旧数据时才展示错误块
    if (!_usageCache) _showError(String(e));
  } finally {
    _fetching = false;
    _showLoading(false);
  }
};

function _showLoading(show) {
  const el = document.getElementById('usage-loading');
  if (el) el.style.display = show ? 'flex' : 'none';
  if (show) {
    const block = document.getElementById('usage-error-block');
    if (block) block.style.display = 'none';
  }
}

function _showError(msg) {
  const block = document.getElementById('usage-error-block');
  if (block) block.style.display = 'flex';
  const msgEl = document.getElementById('usage-error-msg');
  if (msgEl) msgEl.textContent = msg;
  const content = document.getElementById('usage-content');
  if (content) content.style.display = 'none';
}

function _renderUsage(data, fetchedAt) {
  _showLoading(false);

  // 套餐名无论成败都展示（凭证读到即可得到）
  if (data.plan) {
    const planEl = document.getElementById('usage-plan-name');
    if (planEl) planEl.textContent = data.plan.replace(/\s+\S+$/, '');
    const badgeEl = document.getElementById('usage-plan-badge');
    if (badgeEl) {
      const badge = data.plan.replace(/^Claude\s+/i, '');
      badgeEl.textContent = badge;
      badgeEl.style.display = badge && badge !== data.plan ? '' : 'none';
    }
  }

  if (data.error) {
    _showError(data.error);
    return;
  }

  // 隐藏错误，显示内容
  const block = document.getElementById('usage-error-block');
  if (block) block.style.display = 'none';
  const content = document.getElementById('usage-content');
  if (content) content.style.display = '';

  // 5h 卡
  _renderCard({
    pctEl: 'usage-5h-pct', barEl: 'usage-5h-bar',
    descEl: 'usage-5h-desc', resetEl: 'usage-5h-reset',
    pct: data.five_hour_pct, resetsAt: data.five_hour_resets_at,
    isCountdown: true,
  });

  // 7d 卡
  _renderCard({
    pctEl: 'usage-7d-pct', barEl: 'usage-7d-bar',
    descEl: 'usage-7d-desc', resetEl: 'usage-7d-reset',
    pct: data.seven_day_pct, resetsAt: data.seven_day_resets_at,
    isCountdown: false,
  });

  // 更新时间
  const upEl = document.getElementById('usage-updated-at');
  if (upEl) {
    const t = new Date(fetchedAt);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    upEl.textContent = `上次更新：${hh}:${mm}:${ss}`;
  }

  // 5h 倒计时
  if (_countdownTimer) clearInterval(_countdownTimer);
  if (data.five_hour_resets_at) {
    const target = new Date(data.five_hour_resets_at).getTime();
    _countdownTimer = setInterval(() => _tickCountdown('usage-5h-reset', target), 1000);
    _tickCountdown('usage-5h-reset', target);
  }
}

function _renderCard({ pctEl, barEl, descEl, resetEl, pct, resetsAt, isCountdown }) {
  const pctVal = pct != null ? Math.round(pct) : null;
  const color  = _pctColor(pctVal);

  const pctNode = document.getElementById(pctEl);
  if (pctNode) pctNode.textContent = pctVal != null ? `${pctVal}%` : '--';

  const barNode = document.getElementById(barEl);
  if (barNode) {
    barNode.style.width      = `${Math.min(pctVal ?? 0, 100)}%`;
    barNode.style.background = color;
  }

  const descNode = document.getElementById(descEl);
  if (descNode) {
    if (pctVal == null)    { descNode.textContent = '暂无数据'; descNode.style.color = 'var(--text3)'; }
    else if (pctVal >= 90) { descNode.textContent = '⚠ 即将用尽'; descNode.style.color = 'var(--red)'; }
    else if (pctVal >= 70) { descNode.textContent = '用量较高';   descNode.style.color = 'var(--amber)'; }
    else                   { descNode.textContent = '用量正常';   descNode.style.color = 'var(--green)'; }
  }

  const resetNode = document.getElementById(resetEl);
  if (!resetNode || !resetsAt) { if (resetNode) resetNode.textContent = ''; return; }

  if (isCountdown) {
    _tickCountdown(resetEl, new Date(resetsAt).getTime());
  } else {
    const d = new Date(resetsAt);
    resetNode.textContent = `${d.getMonth() + 1}月${d.getDate()}日 重置`;
  }
}

function _tickCountdown(elId, targetMs) {
  const el = document.getElementById(elId);
  if (!el) return;
  const diff = Math.max(0, targetMs - Date.now());
  if (diff === 0) { el.textContent = '即将重置'; return; }
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} 后重置`;
}

function _pctColor(pct) {
  if (pct == null) return 'var(--accent)';
  if (pct >= 90)   return 'var(--red)';
  if (pct >= 70)   return 'var(--amber)';
  return 'var(--accent)';
}

