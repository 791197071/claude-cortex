/* ── 规则记忆页模块 ──────────────────────────────────────────
 * 负责加载记忆文件与各位置的 CLAUDE.md，支持按项目分组切换，
 * 以及编辑/删除单个记忆文件。
 * 依赖：utils.js（invoke, escHtml, fmtSize, memTypeBadge）、
 *       toast.js、modal.js（showConfirm, _editSaveCallback）
 * ──────────────────────────────────────────────────────────────── */

/**
 * 加载并渲染全部记忆数据
 * - 全局记忆：~/.claude/memory/
 * - 项目记忆：~/.claude/projects/{project}/memory/（按项目分 Tab）
 * - CLAUDE.md：全局 + 各项目目录（有则在卡片顶部显示）
 */
async function loadMemory() {
  const [data, claudeMds] = await Promise.all([
    invoke('list_memory').catch(() => ({ global: [], projects: [] })),
    invoke('list_claude_mds').catch(() => []),
  ]);

  /* 全局 CLAUDE.md */
  const globalClaudeMd = claudeMds.find(f => !f.project_path) || null;

  /* 项目级 CLAUDE.md 列表（有实际文件的） */
  const projectClaudeMds = claudeMds.filter(c => c.project_path && c.exists);

  /* 为每个记忆项目补充 CLAUDE.md 路径（后端未能检测到时，前端做前缀匹配） */
  const enrichedProjects = data.projects.map(p => {
    if (p.claude_md_path) return p;
    if (!p.path) return p;
    const match = projectClaudeMds.find(c => c.project_path.startsWith(p.path));
    return match ? { ...p, claude_md_path: match.path } : p;
  });

  /* 找出只有 CLAUDE.md、没有记忆文件的项目（不在任何记忆项目的路径前缀下） */
  const claudeMdOnlyProjects = projectClaudeMds
    .filter(c => !enrichedProjects.some(p => p.path && c.project_path.startsWith(p.path)))
    .map(c => ({ project: c.label, path: c.project_path, files: [], total_size: 0, claude_md_path: c.path }));

  const allProjects = [...enrichedProjects, ...claudeMdOnlyProjects];

  /* 更新统计卡片 */
  const statG = document.getElementById('stat-global-mem');
  const statP = document.getElementById('stat-project-mem');
  if (statG) statG.textContent = data.global.length;
  if (statP) statP.textContent = allProjects.length;

  /* 更新侧边栏导航徽标（全局 + 所有项目文件总数） */
  const navBadge = document.getElementById('nav-badge-memory');
  if (navBadge) {
    const total = data.global.length + allProjects.reduce((a, p) => a + p.files.length, 0);
    navBadge.textContent = total;
  }

  /* ── 全局区域 ──
   * 原有逻辑：有记忆文件才显示；扩展：有全局 CLAUDE.md 时也显示 */
  const globalClaudeMdEl = document.getElementById('memory-global-claudemd');
  const globalContainer  = document.getElementById('memory-global-files');
  const globalSection    = document.getElementById('memory-global-section');

  if (globalClaudeMdEl) {
    globalClaudeMdEl.innerHTML = globalClaudeMd
      ? claudeMdFileHtml(globalClaudeMd.path, globalClaudeMd.label)
      : '';
  }
  if (globalContainer && globalSection) {
    if (data.global.length === 0 && !globalClaudeMd) {
      globalSection.style.display = 'none';
    } else {
      globalSection.style.display = '';
      globalContainer.innerHTML = data.global.map(memFileHtml).join('');
    }
  }

  /* ── 项目记忆 Tab ── */
  const tabsContainer  = document.getElementById('mem-proj-tabs');
  const cardsContainer = document.getElementById('mem-proj-cards');
  if (!tabsContainer || !cardsContainer) return;

  if (allProjects.length === 0) {
    tabsContainer.innerHTML = '';
    cardsContainer.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text3)">无项目记忆</div>`;
    return;
  }

  /* 生成项目 Tab 按钮（第一个默认激活） */
  tabsContainer.innerHTML = allProjects.map((p, i) => {
    const label = p.files.length > 0 ? `${p.files.length} 文件` : 'CLAUDE.md';
    return `<button class="mem-proj-tab ${i === 0 ? 'active' : ''}" onclick="switchMemTabDyn(${i},this)">
      📁 ${escHtml(p.project)} <span class="mem-tab-count">${label}</span>
    </button>`;
  }).join('');

  /* 生成各项目的记忆卡片（非首个项目默认隐藏） */
  cardsContainer.innerHTML = allProjects.map((p, i) => {
    const claudeHtml = p.claude_md_path ? claudeMdFileHtml(p.claude_md_path, p.project) : '';
    const pathDisplay = p.path
      ? `<div class="mem-path">${escHtml(p.path)}</div>`
      : `<div class="mem-path" style="color:var(--text3);font-style:italic">路径未解析</div>`;
    const filesHtml = p.files.length > 0
      ? `<div class="mem-files">${p.files.map(memFileHtml).join('')}</div>`
      : (claudeHtml ? '' : `<div style="padding:8px 16px 16px;color:var(--text3);font-size:12px">无记忆文件</div>`);
    return `
    <div class="mem-card mem-proj-card-dyn" id="mem-proj-card-dyn-${i}" style="${i > 0 ? 'display:none' : ''}">
      <div class="mem-card-head">
        <div>
          <div class="mem-project">${escHtml(p.project)}</div>
          ${pathDisplay}
        </div>
        <span class="mem-size">${fmtSize(p.total_size)} · ${p.files.length} 文件</span>
      </div>
      ${claudeHtml}
      ${filesHtml}
    </div>`;
  }).join('');
}

/**
 * 渲染 CLAUDE.md 文件行，样式与 memFileHtml 保持一致
 * @param {string} filePath - CLAUDE.md 的绝对路径
 * @param {string} label    - 显示标签（项目名 or "全局"）
 */
function claudeMdFileHtml(filePath, label) {
  const safePath  = escHtml(filePath);
  const safeLabel = escHtml(label);
  return `
  <div class="mem-file" data-path="${safePath}" data-label="${safeLabel}">
    <div class="mem-file-name">CLAUDE.md</div>
    <div class="mem-file-body">
      <div class="badge badge-memory"><span class="dot"></span>claude</div>
      <div class="mem-path" style="font-size:10.5px;word-break:break-all">${safePath}</div>
      <div class="mem-file-summary">Claude 行为配置文件</div>
      <div class="mem-file-actions">
        <button class="btn btn-ghost" onclick="openClaudeMdEdit(this)">编辑</button>
      </div>
    </div>
  </div>`;
}

/**
 * 打开 CLAUDE.md 编辑弹窗
 * 从按钮的父级 .claudemd-inline 读取 data-path / data-label
 */
window.openClaudeMdEdit = async function (btn) {
  const wrapper = btn.closest('.mem-file');
  const path    = wrapper.dataset.path;
  const label   = wrapper.dataset.label;
  const content = await invoke('read_file', { path }).catch(() => `# ${label}\n\n`);
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path, content: newContent }).catch(e => { toast(String(e), 'danger'); });
    await loadMemory();
  };
  document.getElementById('edit-title').textContent = `CLAUDE.md — ${label}`;
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
};

/**
 * 生成单个记忆文件行的 HTML
 * 使用 data-path 和 data-name 存储元数据，供编辑/删除操作读取
 * @param {Object} f - 记忆文件对象，包含 id/path/name/mem_type/summary
 */
function memFileHtml(f) {
  const safeId   = escHtml(f.id);
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

/**
 * 打开记忆文件的编辑弹窗，从后端读取文件内容
 */
window.openMemFileEdit = async function (btn) {
  const el   = btn.closest('.mem-file');
  const path = el.dataset.path;
  const name = el.dataset.name;
  const content = await invoke('read_file', { path }).catch(e => { toast(String(e), 'danger'); return ''; });

  /* 注入保存回调：保存后刷新记忆列表 */
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path, content: newContent }).catch(e => { toast(String(e), 'danger'); });
    await loadMemory();
  };
  document.getElementById('edit-title').textContent = name;
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
};

/**
 * 切换项目记忆 Tab（显示对应卡片，隐藏其余）
 */
window.switchMemTabDyn = function (i, btn) {
  document.querySelectorAll('.mem-proj-card-dyn').forEach((c, idx) => {
    c.style.display = idx === i ? '' : 'none';
  });
  document.querySelectorAll('.mem-proj-tab').forEach((t, idx) => {
    t.classList.toggle('active', idx === i);
  });
};

/**
 * 删除记忆文件（确认后调用 Rust 后端）
 */
window.doDeleteMemFile = function (btn) {
  const el   = btn.closest('.mem-file');
  const path = el.dataset.path;
  const elId = el.id;
  showConfirm('确认删除', '删除此记忆文件？此操作不可撤销。', '确认删除', async () => {
    await invoke('delete_file', { path }).catch(e => { toast(String(e), 'danger'); });
    const target = document.getElementById(elId);
    if (target) { target.classList.add('deleted'); setTimeout(() => target.remove(), 300); }
    toast('已删除', 'success');
  });
};
