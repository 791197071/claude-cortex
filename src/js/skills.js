/* ── 技能页模块 ────────────────────────────────────────────────
 * 负责技能列表加载、技能卡片渲染、技能详情弹窗、
 * 新建/编辑/删除/保存技能等所有技能相关操作。
 * 依赖：utils.js（invoke, escHtml）、toast.js、modal.js（showConfirm, _editSaveCallback）
 * ──────────────────────────────────────────────────────────────── */

/**
 * 加载并渲染技能列表
 * - 更新统计数字（全局/项目/内置技能数量）
 * - 无技能时隐藏对应区块
 */
async function loadSkills() {
  const skills = await invoke('list_skills').catch(() => []);
  const global  = skills.filter(s => s.scope === 'global');
  const project = skills.filter(s => s.scope === 'project');

  /* 更新统计卡片 */
  const statEl        = document.getElementById('stat-global-skills');
  const statProjEl    = document.getElementById('stat-project-skills');
  const statBuiltinEl = document.getElementById('stat-builtin-skills');
  if (statEl)        statEl.textContent = global.length;
  if (statProjEl)    statProjEl.textContent = project.length;
  if (statBuiltinEl) statBuiltinEl.textContent = document.querySelectorAll('#skills-builtin-cards .card').length;

  /* 更新侧边栏导航徽标 */
  const navBadge = document.getElementById('nav-badge-skills');
  if (navBadge) navBadge.textContent = global.length + project.length;

  /* 渲染全局技能区块 */
  const globalCards   = document.getElementById('skills-global-cards');
  const globalSection = document.getElementById('skills-global-section');
  if (globalCards && globalSection) {
    globalSection.style.display = global.length === 0 ? 'none' : '';
    if (global.length > 0) globalCards.innerHTML = global.map(skillCardHtml).join('');
  }

  /* 渲染项目技能区块 */
  const projectCards   = document.getElementById('skills-project-cards');
  const projectSection = document.getElementById('skills-project-section');
  if (projectCards && projectSection) {
    projectSection.style.display = project.length === 0 ? 'none' : '';
    if (project.length > 0) projectCards.innerHTML = project.map(skillCardHtml).join('');
  }
}

/**
 * 生成单个自定义技能卡片的 HTML
 * 卡片数据通过 data-skill 属性序列化存储，点击时反序列化取用
 * @param {Object} s - 技能数据对象
 */
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

/**
 * 从卡片 data-skill 属性直接打开编辑弹窗（卡片按钮上的"编辑"）
 */
window.editSkillDirect = async function (btn) {
  const card = btn.closest('.card');
  const s = JSON.parse(card.dataset.skill);
  const filePath = s.path.replace(/\/$/, '') + '/SKILL.md';
  const content = await invoke('read_file', { path: filePath })
    .catch(e => { toast('读取失败：' + e, 'danger'); return null; });
  if (content === null) return;

  /* 注入保存回调：保存后刷新技能列表 */
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path: filePath, content: newContent })
      .catch(e => { toast('保存失败：' + e, 'danger'); });
    await loadSkills();
  };
  document.getElementById('edit-title').textContent = s.name;
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
};

/**
 * 从卡片 data-skill 属性直接删除技能（卡片按钮上的"删除"）
 */
window.deleteSkillDirect = function (btn) {
  const card = btn.closest('.card');
  const s = JSON.parse(card.dataset.skill);
  showConfirm('删除技能', `删除技能 "${s.name}"？此操作不可撤销。`, '确认删除', async () => {
    let ok = true;
    await invoke('delete_skill', { path: s.path })
      .catch(e => { toast('删除失败：' + e, 'danger'); ok = false; });
    if (!ok) return;
    card.classList.add('deleted');
    setTimeout(() => card.remove(), 300);
    toast('技能已删除', 'success');
    await loadSkills();
  });
};

/**
 * 从卡片 data-skill 属性打开技能详情弹窗
 */
window.openSkillDetailFromData = function (el) {
  const s = JSON.parse(el.dataset.skill);
  openSkillDetail({
    id:        'skill-dyn-' + s.name,
    name:      s.name,
    icon:      '⚡',
    type:      'custom',
    typeLabel: '自定义',
    scope:     s.scope,
    project:   s.project || null,
    path:      s.path,
    cmds:      s.commands || [],
    desc:      s.description || '暂无描述',
    deletable: true,
    _path:     s.path,
  });
};

/* ── 技能详情弹窗 ── */

/** 当前在详情弹窗中查看的技能 id */
let currentSkillId = null;

/**
 * 打开技能详情弹窗
 * 如果是自定义技能，同时加载 SKILL.md 内容供编辑
 * @param {Object} skill - 技能数据，包含 id/name/icon/type/scope/project/path/cmds/desc/deletable/_path
 */
async function openSkillDetail(skill) {
  currentSkillId = skill.id;

  document.getElementById('sd-icon').textContent = skill.icon;
  document.getElementById('sd-name').textContent = skill.name;

  /* 渲染类型 + 作用域徽章 */
  const typeClass = { custom: 'badge-custom', builtin: 'badge-builtin', plugin: 'badge-plugin' }[skill.type] || 'badge-builtin';
  let html = `<span class="badge ${typeClass}" style="margin:0"><span class="dot"></span>${skill.typeLabel}</span>`;
  if (skill.scope === 'global') {
    html += `<span class="scope-badge scope-global" style="margin:0">🌐 全局</span>`;
  } else {
    html += `<span class="scope-badge scope-project" style="margin:0">📁 项目</span>`;
    if (skill.project) html += `<span class="scope-project-name" style="font-size:11px;color:var(--text2)">${skill.project}</span>`;
  }
  document.getElementById('sd-badges').innerHTML = html;

  document.getElementById('sd-desc').textContent = skill.desc;
  document.getElementById('sd-cmds').innerHTML = skill.cmds.map(c => `<span class="skill-cmd-tag">${c}</span>`).join('');
  document.getElementById('sd-path').textContent = skill.path;

  /* 保存删除操作所需的路径和名称 */
  window._currentSkillPath = skill.deletable ? skill.path : null;
  window._currentSkillName = skill.name;
  document.getElementById('sd-delete-area').innerHTML = skill.deletable
    ? `<button class="btn btn-danger" onclick="doDeleteSkill()">删除技能</button>`
    : `<span class="skill-readonly-note">内置技能 · 只读</span>`;

  /* 自定义技能：加载 SKILL.md 供直接编辑 */
  const isCustom = skill.type === 'custom' && skill._path;
  const contentSection = document.getElementById('sd-content-section');
  const saveBtn        = document.getElementById('sd-save-btn');
  const contentTa      = document.getElementById('sd-content');

  if (isCustom) {
    contentSection.style.display = '';
    saveBtn.style.display = '';
    window._currentSkillFilePath = skill._path.replace(/\/$/, '') + '/SKILL.md';
    contentTa.value = '加载中…';
    try {
      const raw = await invoke('read_file', { path: window._currentSkillFilePath });
      contentTa.value = raw ?? '';
    } catch (e) {
      contentTa.value = '读取失败：' + e;
    }
  } else {
    contentSection.style.display = 'none';
    saveBtn.style.display = 'none';
    window._currentSkillFilePath = null;
  }

  document.getElementById('skill-detail-modal').classList.add('show');
}

/** 关闭技能详情弹窗 */
function closeSkillDetail() {
  document.getElementById('skill-detail-modal').classList.remove('show');
  currentSkillId = null;
}

/* 点击遮罩关闭技能详情弹窗 */
document.getElementById('skill-detail-modal').onclick = function (e) {
  if (e.target === this) closeSkillDetail();
};

/**
 * 在技能详情弹窗内保存 SKILL.md 修改
 */
window.saveSkillContent = async function () {
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
  } catch (e) {
    toast('保存失败：' + e, 'danger');
  }
  btn.disabled = false;
  btn.textContent = '保存';
};

/**
 * 从技能详情弹窗跳转到编辑模态框（doEditSkill 按钮）
 */
window.doEditSkill = async function () {
  const dirPath = window._currentSkillPath;
  if (!dirPath) return;
  const filePath = dirPath.replace(/\/$/, '') + '/SKILL.md';
  const content = await invoke('read_file', { path: filePath })
    .catch(e => { toast('读取失败：' + e, 'danger'); return null; });
  if (content === null) return;
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path: filePath, content: newContent })
      .catch(e => { toast('保存失败：' + e, 'danger'); });
    await loadSkills();
  };
  document.getElementById('skill-detail-modal').classList.remove('show');
  document.getElementById('edit-title').textContent = window._currentSkillName;
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
};

/**
 * 在技能详情弹窗内删除当前技能
 */
window.doDeleteSkill = function () {
  const path = window._currentSkillPath;
  const name = window._currentSkillName;
  if (!path) return;
  showConfirm('删除技能', `删除技能 "${name}"？此操作不可撤销。`, '确认删除', async () => {
    let ok = true;
    await invoke('delete_skill', { path })
      .catch(e => { toast('删除失败：' + e, 'danger'); ok = false; });
    if (!ok) return;
    closeSkillDetail();
    toast('技能已删除', 'success');
    await loadSkills();
  });
};

/* ── 新建技能 ── */

/**
 * 打开"新建技能"弹窗，同时从后端获取所有项目路径填充范围下拉框
 */
window.openCreateSkill = async function () {
  document.getElementById('create-skill-modal').classList.add('show');
  const projects = await invoke('list_project_paths').catch(() => []);
  const sel = document.getElementById('new-skill-scope');
  if (!sel) return;
  sel.innerHTML = `<option value="global">🌐 全局 (~/.claude/skills/)</option>` +
    projects.map(p => `<option value="${escHtml(p.path)}">📁 ${escHtml(p.name)}</option>`).join('');
};

/**
 * 提交新建技能表单，调用 Rust 后端创建 SKILL.md 文件
 */
window.doCreateSkill = async function () {
  const nameEl    = document.getElementById('new-skill-name');
  const scopeEl   = document.getElementById('new-skill-scope');
  const descEl    = document.getElementById('new-skill-desc');
  const triggerEl = document.getElementById('new-skill-trigger');
  const contentEl = document.getElementById('new-skill-content');

  const name = nameEl?.value.trim();
  if (!name) { alert('请填写技能名称'); return; }

  const scopeVal   = scopeEl?.value || 'global';
  const scope      = scopeVal === 'global' ? 'global' : 'project';
  const projectPath = scope === 'project' ? scopeVal : null;

  let ok = true;
  await invoke('create_skill', {
    name,
    scope,
    projectPath,
    description: descEl?.value.trim() || '',
    trigger:     triggerEl?.value.trim() || '',
    content:     contentEl?.value.trim() || '',
  }).catch(e => { toast('创建失败：' + e, 'danger'); ok = false; });

  if (!ok) return;
  closeCreateSkill();
  toast('技能已创建', 'success');
  await loadSkills();
};
