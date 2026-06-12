/* ── 导出会话模块 ──────────────────────────────────────────────
 * 管理"导出会话历史"弹窗的状态与导出逻辑。
 * 支持时间范围筛选、导出内容角色过滤（全部/用户/AI）、
 * 格式选择（JSON / Markdown）。
 * 依赖：utils.js（invoke, escHtml, fmtTokens）、toast.js、sessions.js（_sessionsData）
 * ──────────────────────────────────────────────────────────────── */

/** 当前选择的导出格式：'json' | 'md' */
let _exportFmt = 'json';

/** 当前选择的角色过滤：'all' | 'user' | 'assistant' */
let _exportRole = 'all';

/**
 * 打开导出弹窗，重置为默认状态（最近 7 天 / JSON / 全部）
 */
window.openExportModal = function () {
  _exportFmt  = 'json';
  _exportRole = 'all';
  document.querySelectorAll('.export-fmt-card').forEach(c => c.classList.remove('active'));
  document.getElementById('fmt-json')?.classList.add('active');
  document.getElementById('role-all')?.classList.add('active');
  setExportRange(7, document.getElementById('range-pill-7'));
  document.getElementById('export-modal').classList.add('show');
};

/** 关闭导出弹窗 */
window.closeExportModal = function () {
  document.getElementById('export-modal').classList.remove('show');
};

/* 点击遮罩关闭 */
document.getElementById('export-modal').onclick = function (e) {
  if (e.target === this) closeExportModal();
};

/**
 * 设置时间范围快捷选
 * @param {number}      days - 天数（0=全部，-1=自定义，其他=最近N天）
 * @param {HTMLElement} btn  - 被点击的 pill 按钮
 */
window.setExportRange = function (days, btn) {
  document.querySelectorAll('.range-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const today  = new Date();
  const fmt    = d => d.toISOString().slice(0, 10);
  const dateRow = document.getElementById('export-date-row');

  if (days === -1) {
    /* 自定义：显示日期选择行 */
    dateRow.style.display = 'grid';
    updateExportHint();
    return;
  }

  dateRow.style.display = 'none';
  if (days === 0) {
    /* 全部：从 2020 年起 */
    document.getElementById('export-start').value = '2020-01-01';
  } else {
    const from = new Date(today);
    from.setDate(today.getDate() - days);
    document.getElementById('export-start').value = fmt(from);
  }
  document.getElementById('export-end').value = fmt(today);
  updateExportHint();
};

/**
 * 选择导出格式
 */
window.selectFmt = function (fmt, card) {
  _exportFmt = fmt;
  document.querySelectorAll('#fmt-json,#fmt-md').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
};

/**
 * 选择导出的角色（全部/我的消息/Claude 回复）
 */
window.selectRole = function (role, card) {
  _exportRole = role;
  document.querySelectorAll('#role-all,#role-user,#role-assistant').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
};

/** 更新导出范围提示文字 */
function updateExportHint() {
  const hint  = document.getElementById('export-hint');
  if (!hint) return;
  const start = document.getElementById('export-start').value;
  const end   = document.getElementById('export-end').value;
  if (start && end) hint.textContent = `将导出 ${start} 至 ${end} 的会话记录`;
}

/* 日期输入变更时自动更新提示 */
document.addEventListener('DOMContentLoaded', () => {
  ['export-start', 'export-end'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateExportHint);
  });
});

/**
 * 执行导出：
 * 1. 从后端获取指定时间段的会话（含完整消息）
 * 2. 按角色过滤消息
 * 3. 序列化为 JSON 或 Markdown
 * 4. 触发浏览器下载
 */
window.doExport = async function () {
  const start = document.getElementById('export-start').value;
  const end   = document.getElementById('export-end').value;
  if (!start || !end) { toast('请选择时间范围', 'danger'); return; }

  const startTs = Math.floor(new Date(start).getTime() / 1000);
  const endTs   = Math.floor(new Date(end + 'T23:59:59').getTime() / 1000);
  const fmt     = _exportFmt || 'json';
  const role    = _exportRole || 'all';

  let rawSessions = await invoke('export_sessions', { startTs, endTs })
    .catch(e => { toast('导出失败：' + e, 'danger'); return null; });
  if (!rawSessions) return;
  if (rawSessions.length === 0) { toast('该时间段内无会话记录', 'danger'); return; }

  /* 按角色过滤消息，过滤后无消息的会话直接丢弃 */
  const sessions = rawSessions
    .map(s => ({ ...s, messages: role === 'all' ? s.messages : s.messages.filter(m => m.role === role) }))
    .filter(s => s.messages.length > 0);

  if (sessions.length === 0) { toast('过滤后无可导出的消息', 'danger'); return; }

  const roleSuffix = role === 'user' ? '-user' : role === 'assistant' ? '-claude' : '';
  let content, filename, mime;

  if (fmt === 'json') {
    content  = JSON.stringify(sessions, null, 2);
    filename = `claude-sessions-${start}-${end}${roleSuffix}.json`;
    mime     = 'application/json';
  } else {
    /* Markdown 格式：每个会话生成一个章节 */
    const roleLabel = { user: '用户', assistant: 'Claude' };
    content = sessions.map(s => {
      const msgs = s.messages
        .map(m => `**${roleLabel[m.role] || m.role}**\n\n${m.text}`)
        .join('\n\n---\n\n');
      return `# ${s.title}\n\n**项目:** ${s.project || '全局'}  \n**时间:** ${s.date}  \n**Tokens:** ${s.input_tokens + s.output_tokens}\n\n${msgs}`;
    }).join('\n\n---\n\n');
    filename = `claude-sessions-${start}-${end}${roleSuffix}.md`;
    mime     = 'text/markdown';
  }

  /* 触发浏览器下载（Blob URL 方式） */
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);

  closeExportModal();
  toast(`已导出 ${sessions.length} 条会话`, 'success');
};
