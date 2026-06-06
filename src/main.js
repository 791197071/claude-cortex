const { invoke } = window.__TAURI__.core;

// ── 工具函数 ──

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function memTypeBadge(type) {
  const map = {
    feedback: ['badge-feedback','feedback'],
    user:     ['badge-memory','user'],
    project:  ['badge-memory','project'],
    reference:['badge-memory','reference'],
    memory:   ['badge-memory','memory'],
  };
  const [cls, label] = map[type] || map.memory;
  return `<div class="badge ${cls}"><span class="dot"></span>${label}</div>`;
}

// ── 技能 ──

async function loadSkills() {
  const skills = await invoke('list_skills').catch(() => []);
  const global = skills.filter(s => s.scope === 'global');
  const project = skills.filter(s => s.scope === 'project');

  const statEl = document.getElementById('stat-global-skills');
  const statProjEl = document.getElementById('stat-project-skills');
  const statBuiltinEl = document.getElementById('stat-builtin-skills');
  if (statEl) statEl.textContent = global.length;
  if (statProjEl) statProjEl.textContent = project.length;
  if (statBuiltinEl) statBuiltinEl.textContent = document.querySelectorAll('#skills-builtin-cards .card').length;
  const navBadgeSkills = document.getElementById('nav-badge-skills');
  if (navBadgeSkills) navBadgeSkills.textContent = global.length + project.length;

  const globalCards = document.getElementById('skills-global-cards');
  const projectCards = document.getElementById('skills-project-cards');
  const globalSection = document.getElementById('skills-global-section');
  const projectSection = document.getElementById('skills-project-section');

  if (globalCards && globalSection) {
    if (global.length === 0) {
      globalSection.style.display = 'none';
    } else {
      globalSection.style.display = '';
      globalCards.innerHTML = global.map(skillCardHtml).join('');
    }
  }

  if (projectCards && projectSection) {
    if (project.length === 0) {
      projectSection.style.display = 'none';
    } else {
      projectSection.style.display = '';
      projectCards.innerHTML = project.map(skillCardHtml).join('');
    }
  }
}

function skillCardHtml(s) {
  const scopeBadge = s.scope === 'global'
    ? `<div class="scope-badge scope-global">🌐 全局</div>`
    : `<div class="scope-badge scope-project">📁 项目</div>${s.project ? `<div class="scope-project-name">${escHtml(s.project)}</div>` : ''}`;
  const cmds = (s.commands || []).map(c => `<span class="cmd">${escHtml(c)}</span>`).join('');
  const dataAttr = escHtml(JSON.stringify(s));
  return `
  <div class="card clickable" data-skill="${dataAttr}" onclick="openSkillDetailFromData(this)">
    <div class="scope-row">
      <div class="badge badge-custom"><span class="dot"></span>自定义</div>${scopeBadge}
    </div>
    <div class="card-name">${escHtml(s.name)}</div>
    <div class="card-desc">${escHtml(s.description) || '暂无描述'}</div>
    <div class="cmds">${cmds}</div>
    <div class="card-actions">
      <span class="click-hint" style="margin-top:0">点击查看详情 →</span>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();editSkillDirect(this)">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteSkillDirect(this)">删除</button>
      </div>
    </div>
  </div>`;
}

window.editSkillDirect = async function(btn) {
  const card = btn.closest('.card');
  const s = JSON.parse(card.dataset.skill);
  const filePath = s.path.replace(/\/$/, '') + '/SKILL.md';
  const content = await invoke('read_file', { path: filePath }).catch(e => { toast('读取失败：' + e, 'danger'); return null; });
  if (content === null) return;
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path: filePath, content: newContent }).catch(e => { toast('保存失败：' + e, 'danger'); });
    await loadSkills();
  };
  document.getElementById('edit-title').textContent = s.name;
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
};

window.deleteSkillDirect = function(btn) {
  const card = btn.closest('.card');
  const s = JSON.parse(card.dataset.skill);
  showConfirm('删除技能', `删除技能 "${s.name}"？此操作不可撤销。`, '确认删除', async () => {
    let ok = true;
    await invoke('delete_skill', { path: s.path }).catch(e => { toast('删除失败：' + e, 'danger'); ok = false; });
    if (!ok) return;
    card.classList.add('deleted');
    setTimeout(() => card.remove(), 300);
    toast('技能已删除', 'success');
    await loadSkills();
  });
};

window.openSkillDetailFromData = function(el) {
  const s = JSON.parse(el.dataset.skill);
  openSkillDetail({
    id: 'skill-dyn-' + s.name,
    name: s.name,
    icon: '⚡',
    type: 'custom',
    typeLabel: '自定义',
    scope: s.scope,
    project: s.project || null,
    path: s.path,
    cmds: s.commands || [],
    desc: s.description || '暂无描述',
    deletable: true,
    _path: s.path,
  });
};

// ── 确认弹窗辅助 ──

function showConfirm(title, msg, okText, callback) {
  window._confirmCallback = callback;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-ok-btn').textContent = okText || '确认删除';
  document.getElementById('confirm-bg').classList.add('show');
}

// ── 插件元数据（官方图标 + 中文描述） ──

const PLUGIN_META = {
  'rust-analyzer-lsp': {
    descZh: 'Rust 语言服务器，为 Claude Code 提供 Rust 代码智能分析、诊断与自动补全功能。',
  },
  'context7-plugin': {
    descZh: 'Upstash Context7 MCP 服务器，直接从源码仓库拉取最新版本的库文档与代码示例。',
  },
  'claude-hud': {
    descZh: 'Claude Code 实时状态栏插件，显示上下文健康度、工具活动、Agent 追踪和 Todo 进度。',
  },
};

function getPluginIcon(name) {
  const initial = (name || '?')[0].toUpperCase();
  const colors = ['#6c8ef5','#52c79b','#f9a825','#a78bfa','#2dd4bf'];
  const color = colors[name.split('').reduce((a,c) => a + c.charCodeAt(0), 0) % colors.length];
  return `<div style="width:40px;height:40px;border-radius:11px;background:${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;font-weight:700;color:#fff;font-family:-apple-system,sans-serif">${initial}</div>`;
}

function getPluginDesc(p) {
  return PLUGIN_META[p.name]?.descZh || p.description || '暂无描述';
}

// ── 插件 ──

async function loadPlugins() {
  const plugins = await invoke('list_plugins').catch(() => []);
  const statEl = document.getElementById('stat-plugins');
  if (statEl) statEl.textContent = plugins.length;
  const navBadgePlugins = document.getElementById('nav-badge-plugins');
  if (navBadgePlugins) navBadgePlugins.textContent = plugins.length;
  const statPluginSkills = document.getElementById('stat-plugin-skills');
  if (statPluginSkills) statPluginSkills.textContent = plugins.reduce((a, p) => a + p.skills.length, 0);

  const container = document.getElementById('plugins-list');
  if (!container) return;

  if (plugins.length === 0) {
    container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3)">未找到已安装插件<br><small>~/.claude/plugins/installed_plugins.json 中无记录</small></div>`;
    return;
  }

  container.innerHTML = plugins.map(p => `
    <div class="row" id="plugin-dyn-${escHtml(p.name)}">
      ${getPluginIcon(p.name)}
      <div style="flex:1;min-width:0">
        <div class="row-name">${escHtml(p.name)}</div>
        <div class="row-desc">${escHtml(getPluginDesc(p))}</div>
        <div class="row-path">${escHtml(p.path)}</div>
        ${p.skills.length ? `<div class="row-skills-note">提供技能：${p.skills.map(escHtml).join(' · ')}</div>` : ''}
      </div>
      ${p.version ? `<span class="row-tag">v${escHtml(p.version)}</span>` : ''}
      <div class="row-actions">
        <button class="btn btn-danger" onclick="doUninstallPlugin('${escHtml(p.name)}','plugin-dyn-${escHtml(p.name)}')">卸载</button>
      </div>
    </div>`).join('');
}

window.doUninstallPlugin = async function(name, rowId) {
  showConfirm('确认卸载', `卸载插件 "${name}"？`, '确认卸载', async () => {
    const err = await invoke('uninstall_plugin', { name }).then(() => null).catch(e => String(e));
    if (err) { toast('卸载失败：' + err, 'danger'); return; }
    const el = document.getElementById(rowId);
    if (el) { el.classList.add('deleted'); setTimeout(() => el.remove(), 300); }
    toast('插件已卸载', 'success');
    await loadPlugins();
  });
};

// ── 记忆 ──

async function loadMemory() {
  const data = await invoke('list_memory').catch(() => ({ global: [], projects: [] }));

  const statG = document.getElementById('stat-global-mem');
  const statP = document.getElementById('stat-project-mem');
  if (statG) statG.textContent = data.global.length;
  if (statP) statP.textContent = data.projects.length;
  const navBadgeMemory = document.getElementById('nav-badge-memory');
  if (navBadgeMemory) navBadgeMemory.textContent = data.global.length + data.projects.reduce((a, p) => a + p.files.length, 0);

  const globalContainer = document.getElementById('memory-global-files');
  const globalSection = document.getElementById('memory-global-section');
  if (globalContainer && globalSection) {
    if (data.global.length === 0) {
      globalSection.style.display = 'none';
    } else {
      globalSection.style.display = '';
      globalContainer.innerHTML = data.global.map(memFileHtml).join('');
    }
  }

  // Project tabs
  const tabsContainer = document.getElementById('mem-proj-tabs');
  const cardsContainer = document.getElementById('mem-proj-cards');
  if (!tabsContainer || !cardsContainer) return;

  if (data.projects.length === 0) {
    tabsContainer.innerHTML = '';
    cardsContainer.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text3)">无项目记忆</div>`;
    return;
  }

  tabsContainer.innerHTML = data.projects.map((p, i) =>
    `<button class="mem-proj-tab ${i === 0 ? 'active' : ''}" onclick="switchMemTabDyn(${i},this)">
      📁 ${escHtml(p.project)} <span class="mem-tab-count">${p.files.length} 文件</span>
    </button>`
  ).join('');

  cardsContainer.innerHTML = data.projects.map((p, i) => `
    <div class="mem-card mem-proj-card-dyn" id="mem-proj-card-dyn-${i}" style="${i > 0 ? 'display:none' : ''}">
      <div class="mem-card-head">
        <div><div class="mem-project">${escHtml(p.project)}</div><div class="mem-path">${escHtml(p.path)}</div></div>
        <span class="mem-size">${fmtSize(p.total_size)} · ${p.files.length} 文件</span>
      </div>
      <div class="mem-files">${p.files.map(memFileHtml).join('')}</div>
    </div>`
  ).join('');
}

window.switchMemTabDyn = function(idx, el) {
  document.querySelectorAll('.mem-proj-card-dyn').forEach((c, i) => c.style.display = i === idx ? '' : 'none');
  document.querySelectorAll('.mem-proj-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
};

function memFileHtml(f) {
  const safeId = escHtml(f.id);
  const safePath = escHtml(f.path);
  const safeName = escHtml(f.name);
  return `
  <div class="mem-file" id="memf-${safeId}" data-path="${safePath}" data-name="${safeName}">
    <div class="mem-file-name">${safeName}</div>
    <div class="mem-file-body">
      ${memTypeBadge(f.mem_type)}
      <div class="mem-path" style="font-size:10.5px;word-break:break-all">${safePath}</div>
      <div class="mem-file-summary">${escHtml(f.summary) || '（空文件）'}</div>
      <div class="mem-file-actions">
        <button class="btn btn-ghost" onclick="openMemFileEdit(this)">编辑</button>
        <button class="btn btn-danger" onclick="doDeleteMemFile(this)">删除</button>
      </div>
    </div>
  </div>`;
}

window.openMemFileEdit = async function(btn) {
  const el = btn.closest('.mem-file');
  const path = el.dataset.path;
  const name = el.dataset.name;
  const content = await invoke('read_file', { path }).catch(e => { alert(e); return ''; });
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path, content: newContent }).catch(e => alert(e));
    await loadMemory();
  };
  document.getElementById('edit-title').textContent = name;
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
};

window.doDeleteMemFile = function(btn) {
  const el = btn.closest('.mem-file');
  const path = el.dataset.path;
  const elId = el.id;
  showConfirm('确认删除', '删除此记忆文件？此操作不可撤销。', '确认删除', async () => {
    await invoke('delete_file', { path }).catch(e => alert(e));
    const target = document.getElementById(elId);
    if (target) { target.classList.add('deleted'); setTimeout(() => target.remove(), 300); }
    toast('已删除', 'success');
  });
};

// ── 会话历史 ──

let _sessionsData = [];
let _sessionsActiveProject = '__all__';

function sessionCardHtml(s) {
  const projStyle = s.project
    ? 'background:var(--purple-soft);color:#7c3aed;border:0.5px solid rgba(167,139,250,0.2)'
    : 'background:var(--teal-soft);color:#0d9488;border:0.5px solid rgba(45,212,191,0.25)';
  return `
  <div class="session-item" id="sess-${escHtml(s.id)}" data-path="${escHtml(s.path)}" data-title="${escHtml(s.title)}" onclick="openSessionDetail(this)">
    <div class="session-icon">💬</div>
    <div class="session-body">
      <div class="session-title">${escHtml(s.title)}</div>
      <div class="session-meta">
        <span class="session-project" style="${projStyle}">${escHtml(s.project) || '全局'}</span>
        <span class="session-date">${escHtml(s.date)}</span>
      </div>
      <div class="session-preview">${escHtml(s.project_path)}</div>
    </div>
    <div class="session-tokens">
      <div class="session-token-val">${fmtTokens(s.input_tokens + s.output_tokens)}</div>
      <div class="session-token-label">tokens</div>
    </div>
    <div style="margin-left:8px;flex-shrink:0">
      <button class="btn btn-danger btn-sm" onclick="doDeleteSession(this,event)">删除</button>
    </div>
  </div>`;
}

function renderSessionTabs(sessions) {
  const tabsEl = document.getElementById('sessions-proj-tabs');
  const container = document.getElementById('sessions-list');
  if (!tabsEl || !container) return;

  // 统计每个项目的会话数，按数量降序排列
  const projMap = new Map();
  for (const s of sessions) {
    const key = s.project || '全局';
    projMap.set(key, (projMap.get(key) || 0) + 1);
  }
  const projects = [...projMap.entries()].sort((a, b) => b[1] - a[1]);

  // 确保当前选中的项目还存在，否则回到全部
  const validKeys = new Set(['__all__', ...projects.map(p => p[0])]);
  if (!validKeys.has(_sessionsActiveProject)) _sessionsActiveProject = '__all__';

  // 渲染页签
  tabsEl.innerHTML = [['__all__', sessions.length], ...projects].map(([key, count]) => {
    const label = key === '__all__' ? '全部' : key;
    const active = _sessionsActiveProject === key ? 'active' : '';
    return `<button class="range-pill ${active}" onclick="switchSessionProject('${escHtml(key)}')">${escHtml(label)} <span style="opacity:.65;font-size:11px">${count}</span></button>`;
  }).join('');

  // 渲染当前页签的会话
  const filtered = _sessionsActiveProject === '__all__'
    ? sessions
    : sessions.filter(s => (s.project || '全局') === _sessionsActiveProject);

  container.innerHTML = filtered.length === 0
    ? `<div style="padding:32px;text-align:center;color:var(--text3)">该项目下无会话记录</div>`
    : filtered.map(sessionCardHtml).join('');
}

window.switchSessionProject = function(key) {
  _sessionsActiveProject = key;
  renderSessionTabs(_sessionsData);
};

async function loadSessions() {
  const sessions = await invoke('list_sessions').catch(() => []);
  _sessionsData = sessions;
  _sessionsActiveProject = '__all__';

  const now = Date.now() / 1000;
  const weekTokens = sessions
    .filter(s => s.timestamp > now - 7 * 86400)
    .reduce((a, s) => a + s.input_tokens + s.output_tokens, 0);
  const activeProjects = new Set(sessions.map(s => s.project).filter(Boolean)).size;

  const statEl = document.getElementById('stat-sessions');
  const statWkEl = document.getElementById('stat-week-tokens');
  const statApEl = document.getElementById('stat-active-projects');
  if (statEl) statEl.textContent = sessions.length;
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

window.doDeleteSession = function(btn, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  const el = btn.closest('.session-item');
  const path = el.dataset.path;
  showConfirm('确认删除', '删除此会话记录？此操作不可撤销。', '确认删除', async () => {
    await invoke('delete_session', { path }).catch(err => { alert(err); return; });
    _sessionsData = _sessionsData.filter(s => s.path !== path);
    renderSessionTabs(_sessionsData);
    toast('会话已删除', 'success');
  });
};

// ── 导出会话 ──

let _exportFmt = 'json';
let _exportRole = 'all';

window.openExportModal = function() {
  _exportFmt = 'json';
  _exportRole = 'all';
  document.querySelectorAll('.export-fmt-card').forEach(c => c.classList.remove('active'));
  document.getElementById('fmt-json')?.classList.add('active');
  document.getElementById('role-all')?.classList.add('active');
  setExportRange(7, document.getElementById('range-pill-7'));
  document.getElementById('export-modal').classList.add('show');
};

window.closeExportModal = function() {
  document.getElementById('export-modal').classList.remove('show');
};

window.setExportRange = function(days, btn) {
  document.querySelectorAll('.range-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  const dateRow = document.getElementById('export-date-row');
  if (days === -1) {
    dateRow.style.display = 'grid';
    updateExportHint();
    return;
  }
  dateRow.style.display = 'none';
  if (days === 0) {
    document.getElementById('export-start').value = '2020-01-01';
  } else {
    const from = new Date(today); from.setDate(today.getDate() - days);
    document.getElementById('export-start').value = fmt(from);
  }
  document.getElementById('export-end').value = fmt(today);
  updateExportHint();
};

window.selectFmt = function(fmt, card) {
  _exportFmt = fmt;
  document.querySelectorAll('#fmt-json,#fmt-md').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
};

window.selectRole = function(role, card) {
  _exportRole = role;
  document.querySelectorAll('#role-all,#role-user,#role-assistant').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
};

function updateExportHint() {
  const hint = document.getElementById('export-hint');
  if (!hint) return;
  const start = document.getElementById('export-start').value;
  const end = document.getElementById('export-end').value;
  if (start && end) hint.textContent = `将导出 ${start} 至 ${end} 的会话记录`;
}

document.addEventListener('DOMContentLoaded', () => {
  ['export-start', 'export-end'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateExportHint);
  });
});

window.doExport = async function() {
  const start = document.getElementById('export-start').value;
  const end = document.getElementById('export-end').value;
  if (!start || !end) { toast('请选择时间范围', 'danger'); return; }
  const startTs = Math.floor(new Date(start).getTime() / 1000);
  const endTs = Math.floor(new Date(end + 'T23:59:59').getTime() / 1000);
  const fmt = _exportFmt || 'json';

  const role = _exportRole || 'all';
  let rawSessions = await invoke('export_sessions', { startTs, endTs }).catch(e => { toast('导出失败：' + e, 'danger'); return null; });
  if (!rawSessions) return;
  if (rawSessions.length === 0) { toast('该时间段内无会话记录', 'danger'); return; }

  const sessions = rawSessions.map(s => ({
    ...s,
    messages: role === 'all' ? s.messages : s.messages.filter(m => m.role === role),
  })).filter(s => s.messages.length > 0);

  if (sessions.length === 0) { toast('过滤后无可导出的消息', 'danger'); return; }

  const roleSuffix = role === 'user' ? '-user' : role === 'assistant' ? '-claude' : '';
  let content, filename, mime;
  if (fmt === 'json') {
    content = JSON.stringify(sessions, null, 2);
    filename = `claude-sessions-${start}-${end}${roleSuffix}.json`;
    mime = 'application/json';
  } else {
    const roleLabel = { user: '用户', assistant: 'Claude' };
    content = sessions.map(s => {
      const msgs = s.messages.map(m => `**${roleLabel[m.role] || m.role}**\n\n${m.text}`).join('\n\n---\n\n');
      return `# ${s.title}\n\n**项目:** ${s.project || '全局'}  \n**时间:** ${s.date}  \n**Tokens:** ${s.input_tokens + s.output_tokens}\n\n${msgs}`;
    }).join('\n\n---\n\n');
    filename = `claude-sessions-${start}-${end}${roleSuffix}.md`;
    mime = 'text/markdown';
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  closeExportModal();
  toast(`已导出 ${sessions.length} 条会话`, 'success');
};

// ── 一键总结 ──

const DEFAULT_SUMMARY_PROMPT = `# 智能生成

深度理解业务背景，用自己的话总结修改了哪些功能点。

## 收集信息（按顺序执行）

1. **深度读代码**
   - 对每个改动文件，Read 关键函数/逻辑段，理解改动的真实意图
   - 不只看 diff，要理解上下文：这段代码原来是干什么的，改动后行为发生了什么变化
2. **理解业务背景**
   - 结合 commit message、AI 标记注释、函数名、变量名，推断业务场景

## 输出格式要求

- **不要大标题和小标题**
- **不区分已提交 / 未提交**
- **不统计工时或小时数**
- **最少 3 条，最多 5 条**，每条聚焦一个独立功能主题，改动较多时合并同类项而非无限拆分
- 每条格式：\`**功能点名称**：具体说明修改了什么，改动了哪些行为或交互\`
- 用词要体现理解深度，不能只是 commit message 的复述`;

let _summaryStart = '';
let _summaryEnd = '';

let _summaryPromptTimer = null;
async function saveSummaryPrompt(value) {
  const path = await getConfigPath();
  const raw = await invoke('read_file', { path }).catch(() => null);
  const cfg = raw ? JSON.parse(raw) : {};
  cfg.summary_prompt = value;
  window._settingsCfg = cfg;
  await invoke('write_file', { path, content: JSON.stringify(cfg, null, 2) }).catch(() => {});
}

let _summarySelectedProjects = new Set();

window.toggleSummaryProject = function(name, el) {
  if (_summarySelectedProjects.has(name)) {
    _summarySelectedProjects.delete(name);
    el.classList.remove('active');
  } else {
    _summarySelectedProjects.add(name);
    el.classList.add('active');
  }
};

window.toggleAllSummaryProjects = function() {
  const chips = document.querySelectorAll('#summary-project-list .sum-proj-chip');
  const allSelected = chips.length > 0 && [...chips].every(c => c.classList.contains('active'));
  if (allSelected) {
    _summarySelectedProjects.clear();
    chips.forEach(c => c.classList.remove('active'));
    document.getElementById('sum-proj-toggle-all').textContent = '全选';
  } else {
    chips.forEach(c => {
      _summarySelectedProjects.add(c.dataset.name);
      c.classList.add('active');
    });
    document.getElementById('sum-proj-toggle-all').textContent = '取消全选';
  }
};

let _promptExpanded = false;
window.toggleSummaryPromptExpand = function() {
  _promptExpanded = !_promptExpanded;
  const ta = document.getElementById('summary-prompt');
  const icon = document.getElementById('summary-prompt-expand-icon');
  const btn = document.getElementById('summary-prompt-expand-btn');
  const rangeBlock = document.getElementById('summary-range-block');
  const dateRow = document.getElementById('summary-date-row');
  const projBlock = document.getElementById('summary-project-block');

  if (_promptExpanded) {
    rangeBlock.style.display = 'none';
    dateRow.style.display = 'none';
    projBlock.style.display = 'none';
    ta.rows = 20;
    icon.innerHTML = '<path d="M5 1H1v4M13 5V1H9M9 13h4V9M1 9v4h4"/>';
    btn.style.background = 'var(--accent-soft)';
    btn.style.borderColor = 'var(--accent)';
    btn.style.color = 'var(--accent)';
  } else {
    rangeBlock.style.display = '';
    projBlock.style.display = '';
    ta.rows = 5;
    // dateRow 由 setSummaryRange 控制，收起时不强制显示
    icon.innerHTML = '<path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>';
    btn.style.background = '';
    btn.style.borderColor = '';
    btn.style.color = '';
  }
};

window.openSummaryModal = async function() {
  _promptExpanded = false;
  document.getElementById('summary-prompt').rows = 5;
  document.getElementById('summary-range-block').style.display = '';
  document.getElementById('summary-project-block').style.display = '';
  document.getElementById('summary-date-row').style.display = 'none';
  document.getElementById('summary-prompt-expand-icon').innerHTML = '<path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>';
  const btn = document.getElementById('summary-prompt-expand-btn');
  btn.style.background = btn.style.borderColor = btn.style.color = '';
  setSummaryRange(0, document.getElementById('sum-pill-0'));
  document.getElementById('summary-loading-mask').style.display = 'none';
  document.getElementById('summary-modal').classList.add('show');

  const path = await getConfigPath();
  const raw = await invoke('read_file', { path }).catch(() => null);
  const cfg = raw ? JSON.parse(raw) : {};

  const promptEl = document.getElementById('summary-prompt');
  promptEl.value = cfg.summary_prompt || DEFAULT_SUMMARY_PROMPT;
  if (!promptEl._bound) {
    promptEl._bound = true;
    promptEl.addEventListener('input', () => {
      clearTimeout(_summaryPromptTimer);
      _summaryPromptTimer = setTimeout(() => saveSummaryPrompt(promptEl.value.trim()), 600);
    });
  }

  // 加载项目列表
  _summarySelectedProjects.clear();
  const allProjects = await invoke('list_project_paths').catch(() => []);
  const uniqueProjects = [...new Map(allProjects.map(p => [p.name, p])).values()];
  const listEl = document.getElementById('summary-project-list');
  listEl.innerHTML = uniqueProjects.length === 0
    ? '<span style="font-size:12px;color:var(--text3)">暂无项目</span>'
    : uniqueProjects.map(p => `<button class="sum-proj-chip range-pill" data-name="${escHtml(p.name)}" onclick="toggleSummaryProject('${escHtml(p.name)}',this)">${escHtml(p.name)}</button>`).join('');
  document.getElementById('sum-proj-toggle-all').textContent = '全选';

  const active = cfg.active_provider || 'claude';
  const hasKey = !!(cfg[PROVIDERS[active].key]);
  if (!hasKey) {
    document.getElementById('summary-api-hint-name').textContent = PROVIDERS[active].name;
  }
  document.getElementById('summary-api-hint').style.display = hasKey ? 'none' : 'flex';
  document.getElementById('summary-generate-btn').disabled = !hasKey;
  document.getElementById('summary-generate-btn').style.opacity = hasKey ? '' : '0.45';
};

window.closeSummaryModal = function() {
  document.getElementById('summary-modal').classList.remove('show');
};

window.setSummaryRange = function(days, btn) {
  document.querySelectorAll('#sum-pill-0,#sum-pill-7,#sum-pill-14,#sum-pill-30,#sum-pill-custom').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const today = new Date();
  // 用本地时间格式化，避免 toISOString() 返回 UTC 日期导致跨时区偏移
  const fmtLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const dateRow = document.getElementById('summary-date-row');
  if (days === -1) {
    dateRow.style.display = 'grid';
    return;
  }
  dateRow.style.display = 'none';
  const from = new Date(today); if (days > 0) from.setDate(today.getDate() - days);
  _summaryStart = fmtLocal(from);
  _summaryEnd = fmtLocal(today);
  document.getElementById('summary-start').value = _summaryStart;
  document.getElementById('summary-end').value = _summaryEnd;
};

window.doSummary = async function() {
  const start = document.getElementById('summary-start').value || _summaryStart;
  const end = document.getElementById('summary-end').value || _summaryEnd;
  if (!start || !end) { toast('请先选择时间范围', 'danger'); return; }
  const userPrompt = document.getElementById('summary-prompt').value.trim();

  // 用本地时间解析日期，避免 UTC 时区偏差漏掉当天 0-8 点的会话
  const startTs = Math.floor(new Date(start + 'T00:00:00').getTime() / 1000);
  const endTs   = Math.floor(new Date(end   + 'T23:59:59').getTime() / 1000);

  // 读取 API 配置
  const cfgPath = await getConfigPath();
  const cfgRaw = await invoke('read_file', { path: cfgPath }).catch(() => null);
  const cfg = cfgRaw ? JSON.parse(cfgRaw) : {};
  const provider = cfg.active_provider || 'claude';
  const providerInfo = PROVIDERS[provider];
  const apiKey = cfg[providerInfo.key] || '';
  if (!apiKey) { toast('请先在设置页配置 API Key', 'danger'); return; }

  const genBtn = document.getElementById('summary-generate-btn');
  const mask = document.getElementById('summary-loading-mask');
  const maskText = document.getElementById('summary-loading-text');
  const showMask = (text) => { mask.style.display = 'flex'; maskText.textContent = text; };
  const hideMask = () => { mask.style.display = 'none'; };
  const resetBtn = () => {
    genBtn.disabled = false;
    genBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h10M2 7h7M2 10h5"/></svg> 生成总结';
  };

  genBtn.disabled = true;
  genBtn.innerHTML = '<span class="spin-icon">⟳</span> 生成中…';
  showMask('正在读取会话数据…');

  try {
    // 1. 拉取时间范围内的会话（含完整对话消息）
    let sessions = await invoke('export_sessions', { startTs, endTs }).catch(() => []);

    // 2. 按选中项目过滤（未选 = 全部）
    if (_summarySelectedProjects.size > 0) {
      sessions = sessions.filter(s => _summarySelectedProjects.has(s.project));
    }

    // 3. 过滤掉没有消息内容的会话
    sessions = sessions.filter(s => s.messages && s.messages.length > 0);

    if (sessions.length === 0) {
      hideMask();
      toast('该时间段内无会话记录', 'danger');
      resetBtn();
      return;
    }

    const totalTokens = sessions.reduce((a, s) => a + s.input_tokens + s.output_tokens, 0);
    const projects    = [...new Set(sessions.map(s => s.project).filter(Boolean))];
    const msgCount    = sessions.reduce((a, s) => a + s.messages.length, 0);

    showMask(`正在调用 ${providerInfo.name} 生成总结（${sessions.length} 条会话）…`);

    // 4. 按模型上下文规格填满内容，优先 token 最多的会话，不跳过任何会话
    // 每个模型预留 2000 字符给 systemInstruction + metadata，剩余全部给会话内容
    const MODEL_LIMITS = { claude: 120000, deepseek: 50000, qwen: 80000 };
    const BUDGET = (MODEL_LIMITS[provider] || 60000);

    // 按 token 量从多到少排序，内容最多的优先获得更大空间
    const ranked = [...sessions].sort((a, b) =>
      (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens)
    );

    let remaining = BUDGET;
    const included = [];

    for (const s of ranked) {
      if (remaining <= 0) break;
      const header = `【${s.date}】[${s.project || '未知项目'}] ${s.title}\n`;
      const msgs = s.messages
        .map(m => `[${m.role === 'user' ? '用户' : 'AI'}] ${m.text.trim()}`)
        .join('\n');

      // 该会话可用的字符预算（header 也算在内）
      const sessionBudget = remaining - header.length;
      if (sessionBudget <= 0) break;

      let body;
      if (msgs.length <= sessionBudget) {
        body = msgs;
      } else {
        // 内容超出预算：截取到预算上限，保证内容是满的
        body = msgs.slice(0, sessionBudget - 6) + '\n…';
      }

      const block = header + body;
      included.push({ s, block });
      remaining -= block.length;
    }

    // 输出时按日期升序排列，保持时间脉络
    included.sort((a, b) => a.s.date.localeCompare(b.s.date));
    const sessionBlocks = included.map(x => x.block);
    const omitted = sessions.length - included.length;
    if (omitted > 0) sessionBlocks.push(`\n…（另有 ${omitted} 条会话因超出模型上下文上限已省略）`);

    // 5. 系统指令 + 用户数据分离
    const systemInstruction = userPrompt ||
      '你是一个工作助手，请根据用户提供的 AI 对话记录，生成一份简洁的工作总结，' +
      '重点列出完成的工作内容、涉及的项目和技术点，语言简洁专业。';

    const userContent =
      `时间范围：${start} 至 ${end}\n` +
      `会话数：${sessions.length}，消息数：${msgCount}，累计 Token：${fmtTokens(totalTokens)}\n` +
      `涉及项目：${projects.length ? projects.join('、') : '无'}\n\n` +
      `以下是会话对话记录：\n\n` +
      sessionBlocks.join('\n\n---\n\n');

    // 6. 调用对应 API
    let resultText = '';

    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: systemInstruction,
          messages: [{ role: 'user', content: userContent }],
        }),
      });
      if (res.status === 401 || res.status === 403) throw new Error('API Key 无效，请在设置页重新配置');
      if (!res.ok) throw new Error(`API 请求失败（${res.status}）`);
      const data = await res.json();
      resultText = data.content?.[0]?.text || '';
    } else {
      const endpoint = provider === 'deepseek'
        ? 'https://api.deepseek.com/v1/chat/completions'
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      const model = provider === 'deepseek' ? 'deepseek-chat' : 'qwen-plus';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user',   content: userContent },
          ],
        }),
      });
      if (res.status === 401 || res.status === 403) throw new Error('API Key 无效，请在设置页重新配置');
      if (!res.ok) throw new Error(`API 请求失败（${res.status}）`);
      const data = await res.json();
      resultText = data.choices?.[0]?.message?.content || '';
    }

    if (!resultText) throw new Error('模型返回内容为空');

    hideMask();
    openSummaryResult(resultText);
    toast('总结已生成', 'success');
  } catch (e) {
    hideMask();
    toast('生成失败：' + e.message, 'danger');
  } finally {
    resetBtn();
  }
};

window.openSummaryResult = function(text) {
  document.getElementById('summary-result-text').value = text;
  document.getElementById('summary-result-modal').classList.add('show');
};

window.closeSummaryResult = function() {
  document.getElementById('summary-result-modal').classList.remove('show');
};

window.copySummaryResult = async function() {
  const text = document.getElementById('summary-result-text').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板', 'success');
  } catch {
    document.getElementById('summary-result-text').select();
    document.execCommand('copy');
    toast('已复制到剪贴板', 'success');
  }
};

// ── 使用统计 ──

const MODEL_COLORS = [
  '#6c8ef5','#a78bfa','#2dd4bf','#52c79b','#f9a825',
  '#f87171','#60a5fa','#fb923c','#e879f9','#34d399',
];

function modelColor(model, allModels) {
  const idx = allModels.indexOf(model);
  return MODEL_COLORS[idx % MODEL_COLORS.length];
}

function shortModelName(model) {
  return model
    .replace('claude-', '')
    .replace(/-\d{8,}$/, '')
    .replace('20251001', '');
}

async function loadStats() {
  const stats = await invoke('get_stats').catch(() => ({ daily: [], projects: [], total_input: 0, total_output: 0, session_count: 0, model_totals: {} }));

  const totalTokens = stats.total_input + stats.total_output;
  const avg = stats.session_count > 0 ? Math.round(totalTokens / stats.session_count) : 0;

  const els = {
    'stat-total-sessions': stats.session_count,
    'stat-total-tokens': fmtTokens(totalTokens),
    'stat-avg-tokens': fmtTokens(avg),
    'stat-proj-count': stats.projects.length,
  };
  Object.entries(els).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });

  const allModels = Object.entries(stats.model_totals || {})
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m);

  renderBarChart(stats.daily, allModels);
  renderModelLegend(allModels, stats.model_totals || {});
  renderProjTable(stats.projects, totalTokens);
  renderModelTable(stats.model_totals || {}, allModels);
}

function renderBarChart(daily, allModels) {
  const container = document.getElementById('stats-bar-chart');
  if (!container) return;
  if (daily.length === 0) {
    container.innerHTML = '<div style="color:var(--text3);font-size:12px;text-align:center;padding:20px">暂无数据</div>';
    return;
  }
  const maxVal = Math.max(...daily.map(d => d.input_tokens + d.output_tokens), 1);
  container.innerHTML = daily.map(d => {
    const total = d.input_tokens + d.output_tokens;
    const pct = Math.max((total / maxVal) * 100, 3);
    const models = d.models || {};
    const segments = allModels
      .filter(m => models[m])
      .map(m => {
        const segPct = (models[m] / total) * 100;
        return `<div class="bar-segment" style="height:${segPct}%;background:${modelColor(m, allModels)}" title="${shortModelName(m)}: ${fmtTokens(models[m])}"></div>`;
      }).join('');
    return `
    <div class="bar-col">
      <div class="bar-val">${fmtTokens(total)}</div>
      <div class="bar-area"><div class="bar-stack" style="height:${pct}%">${segments}</div></div>
      <div class="bar-label">${d.date.slice(-5)}</div>
    </div>`;
  }).join('');
}

function renderModelLegend(allModels, modelTotals) {
  const el = document.getElementById('model-legend');
  if (!el) return;
  if (allModels.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = allModels.map(m => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${modelColor(m, allModels)}"></div>
      <span>${shortModelName(m)}</span>
      <span style="color:var(--text3)">${fmtTokens(modelTotals[m])}</span>
    </div>`).join('');
}

window.switchStatsTab = function(tab) {
  document.getElementById('stats-panel-proj').style.display = tab === 'proj' ? '' : 'none';
  document.getElementById('stats-panel-model').style.display = tab === 'model' ? '' : 'none';
  document.getElementById('stats-tab-proj').classList.toggle('active', tab === 'proj');
  document.getElementById('stats-tab-model').classList.toggle('active', tab === 'model');
};

function renderModelTable(modelTotals, allModels) {
  const tbody = document.getElementById('stats-model-tbody');
  if (!tbody) return;
  const total = Object.values(modelTotals).reduce((a, b) => a + b, 0);
  if (allModels.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text3);padding:20px">暂无数据</td></tr>';
    return;
  }
  tbody.innerHTML = allModels.map((m, i) => {
    const tokens = modelTotals[m] || 0;
    const pct = total > 0 ? Math.round((tokens / total) * 100) : 0;
    const color = modelColor(m, allModels);
    return `
    <tr>
      <td style="display:flex;align-items:center;gap:8px">
        <span style="width:8px;height:8px;border-radius:2px;background:${color};flex-shrink:0;display:inline-block"></span>
        ${escHtml(shortModelName(m))}
      </td>
      <td>${fmtTokens(tokens)}</td>
      <td><div class="progress-wrap"><div class="progress-bg"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div><span class="progress-pct">${pct}%</span></div></td>
    </tr>`;
  }).join('');
}

function renderProjTable(projects, totalTokens) {
  const tbody = document.getElementById('stats-proj-tbody');
  if (!tbody) return;
  if (projects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:20px">暂无数据</td></tr>';
    return;
  }
  const colors = ['var(--accent)', 'var(--purple)', 'var(--teal)', 'var(--green)', 'var(--amber)'];
  tbody.innerHTML = projects.map((p, i) => {
    const total = p.input_tokens + p.output_tokens;
    const pct = totalTokens > 0 ? Math.round((total / totalTokens) * 100) : 0;
    return `
    <tr>
      <td>${escHtml(p.project) || '全局'}</td>
      <td>${fmtTokens(total)}</td>
      <td>${p.session_count}</td>
      <td><div class="progress-wrap"><div class="progress-bg"><div class="progress-fill" style="width:${pct}%;background:${colors[i % colors.length]}"></div></div><span class="progress-pct">${pct}%</span></div></td>
    </tr>`;
  }).join('');
}

// ── 缓存 ──

async function loadCache() {
  const items = await invoke('get_cache_info').catch(() => []);
  const grid = document.getElementById('cache-grid');
  if (!grid) return;

  const existItems = items.filter(i => i.exists);
  const totalBytes = existItems.reduce((s, i) => s + i.bytes, 0);
  const largest = existItems.reduce((a, b) => b.bytes > (a?.bytes || 0) ? b : a, null);

  const totalEl = document.getElementById('total-size');
  const largestEl = document.getElementById('cache-largest-size');
  const countEl = document.getElementById('cache-item-count');
  const hintEl = document.getElementById('clear-all-size');
  if (totalEl) { totalEl.textContent = fmtSize(totalBytes); totalEl.className = 'stat-val ' + (totalBytes > 10*1024*1024 ? 'c-amber' : 'c-green'); }
  if (largestEl) largestEl.textContent = largest ? largest.size_str : '0 B';
  if (countEl) countEl.textContent = existItems.length;
  if (hintEl) hintEl.textContent = totalBytes > 0 ? `（共 ${fmtSize(totalBytes)}）` : '';

  grid.innerHTML = items.map(item => {
    const big = item.bytes > 5 * 1024 * 1024;
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

window.clearCache = function(id) {
  const card = document.getElementById(id);
  if (!card || !card.dataset.path) return;
  showConfirm('确认清除', `确定要清除该缓存吗？此操作不可撤销。`, '确认清除', () => doClearCache(id, card.dataset.path));
};

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

window.clearAll = function() {
  showConfirm('确认清除全部', '确定要清除全部缓存吗？此操作不可撤销。', '全部清除', async () => {
    const items = await invoke('get_cache_info').catch(() => []);
    for (const item of items) {
      if (item.exists) await invoke('clear_cache', { path: item.path }).catch(() => {});
    }
    await loadCache();
    toast('全部缓存已清除', 'success');
  });
};

// ── Edit modal save callback ──

let _editSaveCallback = null;

window.saveEdit = async function() {
  const content = document.getElementById('edit-textarea').value;
  if (_editSaveCallback) {
    await _editSaveCallback(content);
    toast('已保存', 'success');
  }
  document.getElementById('edit-modal').classList.remove('show');
  _editSaveCallback = null;
};

// ── 编辑技能 ──

window.doEditSkill = async function() {
  const dirPath = window._currentSkillPath;
  if (!dirPath) return;
  const filePath = dirPath.replace(/\/$/, '') + '/SKILL.md';
  const content = await invoke('read_file', { path: filePath }).catch(e => { toast('读取失败：' + e, 'danger'); return null; });
  if (content === null) return;
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path: filePath, content: newContent }).catch(e => { toast('保存失败：' + e, 'danger'); });
    await loadSkills();
  };
  document.getElementById('skill-detail-modal').classList.remove('show');
  document.getElementById('edit-title').textContent = window._currentSkillName;
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
};

// ── 保存技能内容 ──

window.saveSkillContent = async function() {
  const path = window._currentSkillFilePath;
  if (!path) return;
  const content = document.getElementById('sd-content').value;
  const btn = document.getElementById('sd-save-btn');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    await invoke('write_file', { path, content });
    toast('已保存', 'success');
    await loadSkills();
  } catch(e) {
    toast('保存失败：' + e, 'danger');
  }
  btn.disabled = false;
  btn.textContent = '保存';
};

// ── 删除技能 ──

window.doDeleteSkill = function() {
  const path = window._currentSkillPath;
  const name = window._currentSkillName;
  if (!path) return;
  showConfirm('删除技能', `删除技能 "${name}"？此操作不可撤销。`, '确认删除', async () => {
    let ok = true;
    await invoke('delete_skill', { path }).catch(e => { toast('删除失败：' + e, 'danger'); ok = false; });
    if (!ok) return;
    closeSkillDetail();
    toast('技能已删除', 'success');
    await loadSkills();
  });
};

// ── 创建技能 ──

window.openCreateSkill = async function() {
  document.getElementById('create-skill-modal').classList.add('show');
  const projects = await invoke('list_project_paths').catch(() => []);
  const sel = document.getElementById('new-skill-scope');
  if (!sel) return;
  sel.innerHTML = `<option value="global">🌐 全局 (~/.claude/skills/)</option>` +
    projects.map(p => `<option value="${escHtml(p.path)}">📁 ${escHtml(p.name)}</option>`).join('');
};

window.doCreateSkill = async function() {
  const nameEl = document.getElementById('new-skill-name');
  const scopeEl = document.getElementById('new-skill-scope');
  const descEl = document.getElementById('new-skill-desc');
  const triggerEl = document.getElementById('new-skill-trigger');
  const contentEl = document.getElementById('new-skill-content');

  const name = nameEl?.value.trim();
  if (!name) { alert('请填写技能名称'); return; }

  const scopeVal = scopeEl?.value || 'global';
  const scope = scopeVal === 'global' ? 'global' : 'project';
  const projectPath = scope === 'project' ? scopeVal : null;

  let ok = true;
  await invoke('create_skill', {
    name, scope, projectPath,
    description: descEl?.value.trim() || '',
    trigger: triggerEl?.value.trim() || '',
    content: contentEl?.value.trim() || '',
  }).catch(e => { toast('创建失败：' + e, 'danger'); ok = false; });

  if (!ok) return;

  closeCreateSkill();
  toast('技能已创建', 'success');
  await loadSkills();
};

// ── 会话详情 ──

window.openSessionDetail = async function(el) {
  const path = el.dataset.path;
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
    const long = m.text.length > 600 || m.text.split('\n').length > 12;
    const textDiv = `<div class="chat-msg-text${long ? '' : ' expanded'}" id="cmt-${i}">${escHtml(m.text)}</div>`;
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

window.expandMsg = function(i) {
  const el = document.getElementById('cmt-' + i);
  if (!el) return;
  el.classList.add('expanded');
  const btn = el.nextElementSibling;
  if (btn) btn.style.display = 'none';
};

// ── Init ──

// ── 设置 ──

const PROVIDERS = {
  claude:   { name: 'Claude',    desc: 'Anthropic',   icon: '✦', bg: 'linear-gradient(135deg,#6c8ef5,#a78bfa)', key: 'claude_api_key' },
  deepseek: { name: 'DeepSeek',  desc: 'DeepSeek AI', icon: 'D',  bg: 'linear-gradient(135deg,#2dd4bf,#60a5fa)', key: 'deepseek_api_key' },
  qwen:     { name: '通义千问',   desc: '阿里云',       icon: 'Q',  bg: 'linear-gradient(135deg,#f9a825,#fb923c)', key: 'qwen_api_key' },
};

let _activeProvider = 'claude';

async function getConfigPath() {
  return invoke('get_config_path');
}

async function loadSettings() {
  const path = await getConfigPath();
  const raw = await invoke('read_file', { path }).catch(() => null);
  const cfg = raw ? JSON.parse(raw) : {};
  window._settingsCfg = cfg;
  const active = cfg.active_provider || 'claude';
  selectProvider(active, false);
}

window.selectProvider = function(provider, save = true) {
  _activeProvider = provider;
  const p = PROVIDERS[provider];
  document.querySelectorAll('.settings-provider-card').forEach(c => c.classList.remove('active'));
  document.getElementById('provider-card-' + provider)?.classList.add('active');
  document.getElementById('settings-active-icon').style.background = p.bg;
  document.getElementById('settings-active-icon').textContent = p.icon;
  document.getElementById('settings-active-name').textContent = p.name;
  document.getElementById('settings-active-desc').textContent = p.desc;
  const cfg = window._settingsCfg || {};
  const key = cfg[p.key] || '';
  document.getElementById('active-api-key').value = key;
  document.getElementById('active-api-key').type = 'password';
  const statusEl = document.getElementById('settings-key-status');
  statusEl.className = 'settings-key-status ' + (key ? 'configured' : 'empty');
  statusEl.textContent = key ? '已配置' : '未配置';
  if (save) {
    saveActiveProvider(provider);
    toast(`已选择 ${p.name}`, 'success');
  }
};

async function saveActiveProvider(provider) {
  const path = await getConfigPath();
  const raw = await invoke('read_file', { path }).catch(() => null);
  const cfg = raw ? JSON.parse(raw) : {};
  cfg.active_provider = provider;
  window._settingsCfg = cfg;
  await invoke('write_file', { path, content: JSON.stringify(cfg, null, 2) }).catch(() => {});
}

async function testApiKey(provider, key) {
  if (provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Key 无效');
    if (!res.ok && res.status !== 400) throw new Error('请求失败 ' + res.status);
    return true;
  }
  if (provider === 'deepseek') {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Key 无效');
    if (!res.ok && res.status !== 400) throw new Error('请求失败 ' + res.status);
    return true;
  }
  if (provider === 'qwen') {
    const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'qwen-turbo', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Key 无效');
    if (!res.ok && res.status !== 400) throw new Error('请求失败 ' + res.status);
    return true;
  }
}

window.saveApiKey = async function() {
  const key = document.getElementById('active-api-key').value.trim();
  if (!key) { toast('请输入 API Key', 'danger'); return; }

  const saveBtn = document.querySelector('.settings-key-row .btn-primary');
  const statusEl = document.getElementById('settings-key-status');
  saveBtn.textContent = '验证中…'; saveBtn.disabled = true;
  statusEl.className = 'settings-key-status empty'; statusEl.textContent = '验证中…';

  try {
    await testApiKey(_activeProvider, key);
  } catch (e) {
    saveBtn.textContent = '保存'; saveBtn.disabled = false;
    statusEl.className = 'settings-key-status empty'; statusEl.textContent = '未配置';
    toast('验证失败：' + e.message, 'danger');
    return;
  }

  const path = await getConfigPath();
  const raw = await invoke('read_file', { path }).catch(() => null);
  const cfg = raw ? JSON.parse(raw) : {};
  cfg[PROVIDERS[_activeProvider].key] = key;
  cfg.active_provider = _activeProvider;
  window._settingsCfg = cfg;
  await invoke('write_file', { path, content: JSON.stringify(cfg, null, 2) })
    .catch(e => { toast('保存失败：' + e, 'danger'); return; });

  saveBtn.textContent = '保存'; saveBtn.disabled = false;
  statusEl.className = 'settings-key-status configured'; statusEl.textContent = '已配置';
  toast('验证通过，已保存', 'success');
};

window.toggleKeyVisibility = function(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.style.color = isHidden ? 'var(--accent)' : '';
};

window.resetAllKeys = function() {
  showConfirm(
    '重置所有 API Key',
    '将清除全部已配置的 API Key，此操作不可撤销。',
    '确认重置',
    async () => {
      const path = await getConfigPath();
      const raw = await invoke('read_file', { path }).catch(() => null);
      const cfg = raw ? JSON.parse(raw) : {};
      // 只删除 key 字段，保留 summary_prompt / active_provider 等其他配置
      delete cfg.claude_api_key;
      delete cfg.deepseek_api_key;
      delete cfg.qwen_api_key;
      window._settingsCfg = cfg;
      await invoke('write_file', { path, content: JSON.stringify(cfg, null, 2) });
      document.getElementById('active-api-key').value = '';
      document.getElementById('active-api-key').type = 'password';
      const statusEl = document.getElementById('settings-key-status');
      statusEl.className = 'settings-key-status empty';
      statusEl.textContent = '未配置';
      toast('已重置所有 API Key', 'success');
    }
  );
};

async function initApp() {
  await Promise.all([
    loadSkills(),
    loadPlugins(),
    loadMemory(),
    loadSessions(),
    loadStats(),
    loadCache(),
    loadSettings(),
  ]);
}

window.addEventListener('DOMContentLoaded', initApp);
