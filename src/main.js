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
  if (statEl) statEl.textContent = global.length;
  if (statProjEl) statProjEl.textContent = project.length;
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
      <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteSkillDirect(this)">删除</button>
    </div>
  </div>`;
}

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

async function loadSessions() {
  const sessions = await invoke('list_sessions').catch(() => []);

  const statEl = document.getElementById('stat-sessions');
  const statWkEl = document.getElementById('stat-week-tokens');
  const statApEl = document.getElementById('stat-active-projects');
  if (statEl) statEl.textContent = sessions.length;

  const now = Date.now() / 1000;
  const weekSessions = sessions.filter(s => s.timestamp > now - 7 * 86400);
  const weekTokens = weekSessions.reduce((a, s) => a + s.input_tokens + s.output_tokens, 0);
  if (statWkEl) statWkEl.textContent = fmtTokens(weekTokens);

  const activeProjects = new Set(sessions.map(s => s.project).filter(Boolean)).size;
  if (statApEl) statApEl.textContent = activeProjects;

  const container = document.getElementById('sessions-list');
  if (!container) return;

  if (sessions.length === 0) {
    container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3)">无会话记录<br><small>~/.claude/projects/ 下未找到含 token 数据的 JSONL 文件</small></div>`;
    return;
  }

  container.innerHTML = sessions.map(s => {
    const projStyle = s.project
      ? 'background:var(--purple-soft);color:#7c3aed;border:0.5px solid rgba(167,139,250,0.2)'
      : 'background:var(--teal-soft);color:#0d9488;border:0.5px solid rgba(45,212,191,0.25)';
    const safeId = escHtml(s.id);
    const safePath = escHtml(s.path);
    return `
    <div class="session-item" id="sess-${safeId}" data-path="${safePath}" data-title="${escHtml(s.title)}" onclick="openSessionDetail(this)">
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
  }).join('');
}

window.doDeleteSession = function(btn, e) {
  if (e) { e.stopPropagation(); e.preventDefault(); }
  const el = btn.closest('.session-item');
  const path = el.dataset.path;
  const elId = el.id;
  showConfirm('确认删除', '删除此会话记录？此操作不可撤销。', '确认删除', async () => {
    await invoke('delete_session', { path }).catch(err => { alert(err); return; });
    const target = document.getElementById(elId);
    if (target) { target.classList.add('deleted'); setTimeout(() => target.remove(), 300); }
    toast('会话已删除', 'success');
  });
};

// ── 使用统计 ──

async function loadStats() {
  const stats = await invoke('get_stats').catch(() => ({ daily: [], projects: [], total_input: 0, total_output: 0, session_count: 0 }));

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

  renderBarChart(stats.daily);
  renderProjTable(stats.projects, totalTokens);
}

function renderBarChart(daily) {
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
    return `
    <div class="bar-col">
      <div class="bar-val">${fmtTokens(total)}</div>
      <div class="bar-area"><div class="bar" style="height:${pct}%"></div></div>
      <div class="bar-label">${d.date.slice(-5)}</div>
    </div>`;
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
  doClearCache(id, card.dataset.path);
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

window.clearAll = async function() {
  const items = await invoke('get_cache_info').catch(() => []);
  for (const item of items) {
    if (item.exists) await invoke('clear_cache', { path: item.path }).catch(() => {});
  }
  await loadCache();
  toast('全部缓存已清除', 'success');
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

async function initApp() {
  await Promise.all([
    loadSkills(),
    loadPlugins(),
    loadMemory(),
    loadSessions(),
    loadStats(),
    loadCache(),
  ]);
}

window.addEventListener('DOMContentLoaded', initApp);
