/* ── Claude Pro 官方用量模块 ─────────────────────────────────────
 * 通过 Rust 后端调用 Anthropic OAuth Usage API，展示：
 *  - 5小时窗口已用百分比 + 倒计时
 *  - 本周额度已用百分比 + 重置日期
 *
 * 缓存策略（重要）：
 *  - 真正的缓存与 429 退避都在 Rust 后端（get_claude_usage 内），
 *    菜单栏弹框与本页共用同一份，保证两边数字与刷新一致。
 *  - 本页的 localStorage 仅用于「打开瞬间即时渲染」与「重启后首屏兜底」，
 *    不再做 TTL 闸门，每次都会向后端要一次（后端 TTL 内会秒回缓存）。
 * 依赖：utils.js（invoke）、toast.js
 * ──────────────────────────────────────────────────────────────── */

const LS_CACHE_KEY  = 'cortex_usage_cache_v1';

let _countdownTimer = null;
let _fetching       = false;

function _readCache() {
  try { return JSON.parse(localStorage.getItem(LS_CACHE_KEY)); } catch { return null; }
}
function _writeCache(data, fetchedAt) {
  try { localStorage.setItem(LS_CACHE_KEY, JSON.stringify({ data, fetchedAt })); } catch {}
}

/**
 * 主入口：启动时和切换到用量页时调用。
 * 先用本地旧值即时渲染（避免空白/闪烁），再向后端取统一数据。
 * 后端负责 TTL 缓存与 429 退避，所以这里无条件请求即可。
 */
window.loadClaudeUsage = async function (force = false, silent = false) {
  const cache = _readCache();

  // 即时渲染上次的值，等后端返回再覆盖
  if (cache && cache.data) {
    _renderUsage(cache.data, cache.fetchedAt);
  } else if (!silent) {
    _showLoading(true);
  }

  if (_fetching) return;
  _fetching = true;

  try {
    const data      = await invoke('get_claude_usage', { force });
    const fetchedAt = Date.now();

    if (data.error) {
      // 后端无可用数据时才报错；本地有旧值则保留旧渲染，不闪成错误
      if (!(cache && cache.data)) _renderUsage(data, fetchedAt);
    } else {
      _writeCache(data, fetchedAt);
      _renderUsage(data, fetchedAt);
    }
  } catch (e) {
    if (!cache) _showError(String(e));
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

/* 与菜单栏弹框、桌面卡片统一：绿/琥珀/红渐变，阈值 50 / 80 */
function _pctColor(pct) {
  if (pct == null) return 'linear-gradient(90deg,#34c759,#30d158)';
  if (pct >= 80)   return 'linear-gradient(90deg,#ff3b30,#ff6961)';
  if (pct >= 50)   return 'linear-gradient(90deg,#ff9f0a,#ffcc02)';
  return 'linear-gradient(90deg,#34c759,#30d158)';
}

/* 实时同步：监听后台轮询的广播，与弹框、桌面卡片渲染同一份数据 */
window.__TAURI__?.event?.listen('usage-updated', (e) => {
  const data = e.payload;
  if (!data) return;
  if (!data.error) _writeCache(data, Date.now());
  _renderUsage(data, Date.now());
});

