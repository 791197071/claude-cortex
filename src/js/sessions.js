/* ── 会话历史页模块 ────────────────────────────────────────────
 * 负责会话列表加载、按项目分 Tab 展示、查看对话详情和删除会话。
 * _sessionsData 用 var 声明以便 summary.js 等模块跨文件访问。
 * 依赖：utils.js（invoke, escHtml, fmtTokens）、toast.js、modal.js（showConfirm）
 * ──────────────────────────────────────────────────────────────── */

/** 所有会话数据（供 export.js 和 summary.js 共享读取） */
var _sessionsData = [];

/** 当前选中的项目筛选器（'__all__' 表示全部） */
var _sessionsActiveProject = '__all__';

/**
 * 估算单次会话费用（USD）
 * 用会话自身的 input/output 比例分摊给各模型
 */
function sessionCost(s) {
  const totalTokens = s.input_tokens + s.output_tokens;
  if (totalTokens === 0) return 0;
  const inputRatio = s.input_tokens / totalTokens;
  return Object.entries(s.model_tokens || {}).reduce((sum, [model, tokens]) => {
    const { input, output } = getModelPricing(model);
    return sum + (tokens * inputRatio * input + tokens * (1 - inputRatio) * output) / 1_000_000;
  }, 0);
}

/**
 * 生成单条会话卡片 HTML
 * 使用 data-path / data-title 存储元数据，onclick 点击查看详情
 */
function sessionCardHtml(s) {
  const projStyle = s.project
    ? 'background:var(--purple-soft);color:#7c3aed;border:0.5px solid rgba(167,139,250,.2)'
    : 'background:var(--teal-soft);color:#0d9488;border:0.5px solid rgba(45,212,191,.25)';
  const cost = sessionCost(s);
  const costStr = cost > 0 ? `<div class="session-cost">≈ ${fmtCost(cost)}</div>` : '';
  return `
  <div class="session-item" id="sess-${escHtml(s.id)}" data-path="${escHtml(s.path)}" data-title="${escHtml(s.title)}" onclick="openSessionDetail(this)">
    <div class="session-icon">💬</div>
    <div class="session-body">
      <div class="session-title">${escHtml(s.title)}</div>
      <div class="session-meta">
        <span class="session-project" style="${projStyle}">${escHtml(s.project)}</span>
        <span class="session-date">${escHtml(s.date)}</span>
      </div>
      <div class="session-preview">${escHtml(s.project_path)}</div>
    </div>
    <div class="session-tokens">
      <div class="session-token-val">${fmtTokens(s.input_tokens + s.output_tokens)}</div>
      <div class="session-token-label">tokens</div>
      ${costStr}
    </div>
    <div style="margin-left:8px;flex-shrink:0">
      <button class="btn btn-danger btn-sm" onclick="doDeleteSession(this,event)">删除</button>
    </div>
  </div>`;
}

/**
 * 渲染项目 Tab 和当前筛选下的会话列表
 * 此函数可在筛选切换时重复调用，不重新请求数据
 */
function renderSessionTabs(sessions) {
  const tabsEl    = document.getElementById('sessions-proj-tabs');
  const container = document.getElementById('sessions-list');
  if (!tabsEl || !container) return;

  /* 统计每个项目的会话数，按数量降序排列 */
  const projMap = new Map();
  for (const s of sessions) {
    const key = s.project;
    projMap.set(key, (projMap.get(key) || 0) + 1);
  }
  const projects = [...projMap.entries()].sort((a, b) => b[1] - a[1]);

  /* 若当前选中的项目已不存在，回到全部视图 */
  const validKeys = new Set(['__all__', ...projects.map(p => p[0])]);
  if (!validKeys.has(_sessionsActiveProject)) _sessionsActiveProject = '__all__';

  /* 渲染项目筛选 Tab */
  tabsEl.innerHTML = [['__all__', sessions.length], ...projects].map(([key, count]) => {
    const label  = key === '__all__' ? '全部' : key;
    const active = _sessionsActiveProject === key ? 'active' : '';
    return `<button class="range-pill ${active}" onclick="switchSessionProject('${escHtml(key)}')">${escHtml(label)} <span style="opacity:.65;font-size:11px">${count}</span></button>`;
  }).join('');

  /* 筛选并渲染当前 Tab 的会话 */
  const filtered = _sessionsActiveProject === '__all__'
    ? sessions
    : sessions.filter(s => (s.project || '全局') === _sessionsActiveProject);

  container.innerHTML = filtered.length === 0
    ? `<div style="padding:32px;text-align:center;color:var(--text3)">该项目下无会话记录</div>`
    : filtered.map(sessionCardHtml).join('');
}

/** 切换会话列表的项目筛选器并重新渲染 */
window.switchSessionProject = function (key) {
  _sessionsActiveProject = key;
  renderSessionTabs(_sessionsData);
};

/**
 * 从后端加载所有会话数据，计算统计数值并渲染列表
 */
async function loadSessions() {
  const sessions = await invoke('list_sessions').catch(() => []);
  _sessionsData = sessions;
  _sessionsActiveProject = '__all__';

  /* 计算统计数值 */
  const now          = Date.now() / 1000;
  const weekTokens   = sessions.filter(s => s.timestamp > now - 7 * 86400)
                                .reduce((a, s) => a + s.input_tokens + s.output_tokens, 0);
  const activeProjects = new Set(sessions.map(s => s.project).filter(Boolean)).size;

  const statEl   = document.getElementById('stat-sessions');
  const statWkEl = document.getElementById('stat-week-tokens');
  const statApEl = document.getElementById('stat-active-projects');
  if (statEl)   statEl.textContent = sessions.length;
  if (statWkEl) statWkEl.textContent = fmtTokens(weekTokens);
  if (statApEl) statApEl.textContent = activeProjects;

  const container = document.getElementById('sessions-list');
  if (!container) return;

  if (sessions.length === 0) {
    document.getElementById('sessions-proj-tabs').innerHTML = '';
    container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3)">无会话记录<br><small>~/.claude/projects/ 下未找到含 token 数据的 JSONL 文件</small></div>`;
    return;
  }

  renderSessionTabs(sessions);
}

/**
 * 删除单条会话（确认后调用 Rust 后端并从内存中移除）
 */
window.doDeleteSession = function (btn, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  const el   = btn.closest('.session-item');
  const path = el.dataset.path;
  showConfirm('确认删除', '删除此会话记录？此操作不可撤销。', '确认删除', async () => {
    await invoke('delete_session', { path }).catch(err => { toast(String(err), 'danger'); return; });
    _sessionsData = _sessionsData.filter(s => s.path !== path);
    renderSessionTabs(_sessionsData);
    toast('会话已删除', 'success');
  });
};

/* ── 会话详情弹窗 ── */

/**
 * 打开会话详情，加载完整对话消息并渲染为聊天气泡样式
 */
window.openSessionDetail = async function (el) {
  const path  = el.dataset.path;
  const title = el.dataset.title;
  document.getElementById('session-detail-title').textContent = title;
  const chatBody = document.getElementById('session-chat-body');
  chatBody.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3)">加载中…</div>';
  document.getElementById('session-detail-modal').classList.add('show');

  const messages = await invoke('read_session_messages', { path }).catch(() => []);
  if (messages.length === 0) {
    chatBody.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3)">无消息内容</div>';
    return;
  }

  chatBody.innerHTML = messages.map((m, i) => {
    const isUser = m.role === 'user';
    /* 超过 600 字符或 12 行时，默认折叠并显示"展开"按钮 */
    const long = m.text.length > 600 || m.text.split('\n').length > 12;
    const textDiv  = `<div class="chat-msg-text${long ? '' : ' expanded'}" id="cmt-${i}">${escHtml(m.text)}</div>`;
    const expandBtn = long ? `<button class="chat-expand-btn" onclick="expandMsg(${i})">展开全文 ↓</button>` : '';

    if (isUser) {
      return `
      <div class="chat-msg chat-msg-user">
        <div class="chat-msg-avatar">👤</div>
        <div class="chat-msg-content">
          <div class="chat-msg-bubble">${textDiv}${expandBtn}</div>
        </div>
      </div>`;
    }
    return `
    <div class="chat-msg chat-msg-assistant">
      <div class="chat-msg-avatar">✦</div>
      <div class="chat-msg-content">
        <div class="chat-msg-role">Claude</div>
        <div class="chat-msg-bubble">${textDiv}${expandBtn}</div>
      </div>
    </div>`;
  }).join('');
};

/** 展开折叠的消息气泡 */
window.expandMsg = function (i) {
  const el = document.getElementById('cmt-' + i);
  if (!el) return;
  el.classList.add('expanded');
  const btn = el.nextElementSibling;
  if (btn) btn.style.display = 'none';
};

/** 关闭会话详情弹窗 */
function closeSessionDetail() {
  document.getElementById('session-detail-modal').classList.remove('show');
}

/* 点击遮罩关闭弹窗 */
document.getElementById('session-detail-modal').onclick = function (e) {
  if (e.target === this) closeSessionDetail();
};
