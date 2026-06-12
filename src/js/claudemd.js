/* ── CLAUDE.md 编辑器模块 ──────────────────────────────────────
 * 列出并管理全局及各项目的 CLAUDE.md 文件。
 * 依赖：utils.js（invoke, escHtml, fmtSize）、toast.js、modal.js
 * ──────────────────────────────────────────────────────────────── */

/**
 * 加载所有 CLAUDE.md 文件并渲染页面
 */
async function loadClaudeMd() {
  const files = await invoke('list_claude_mds').catch(() => []);

  const existing = files.filter(f => f.exists).length;
  const el1 = document.getElementById('stat-claudemd-existing');
  const el2 = document.getElementById('stat-claudemd-total');
  if (el1) el1.textContent = existing;
  if (el2) el2.textContent = files.length;

  const globalFile   = files.find(f => !f.project_path);
  const projectFiles = files.filter(f => f.project_path);

  renderClaudeMdGlobal(globalFile);
  renderClaudeMdProjects(projectFiles);
}

/**
 * 渲染全局 CLAUDE.md 卡片
 */
function renderClaudeMdGlobal(f) {
  const el = document.getElementById('claudemd-global-card');
  if (!el || !f) return;
  el.innerHTML = claudeMdCardHtml(f);
}

/**
 * 渲染项目 CLAUDE.md 列表
 */
function renderClaudeMdProjects(files) {
  const el = document.getElementById('claudemd-proj-list');
  if (!el) return;
  if (files.length === 0) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3)">未检测到任何项目</div>';
    return;
  }
  el.innerHTML = files.map(claudeMdCardHtml).join('');
}

/**
 * 生成单张 CLAUDE.md 卡片的 HTML
 */
function claudeMdCardHtml(f) {
  const scopeLabel = f.project_path ? escHtml(f.label) : '全局';
  const scopeClass = f.project_path ? 'scope-project' : 'scope-global';
  const scopeIcon  = f.project_path ? '📁' : '🌐';
  const sizeStr    = f.exists ? fmtSize(f.size) : '';
  const statusDot  = f.exists
    ? '<span style="color:var(--green);font-size:11px">● 已配置</span>'
    : '<span style="color:var(--text3);font-size:11px">○ 未创建</span>';

  const actionBtn = f.exists
    ? `<button class="btn btn-ghost" style="font-size:12px;padding:5px 12px" onclick="openClaudeMdEdit(${JSON.stringify(f.path)},${JSON.stringify(f.label)})">编辑</button>`
    : `<button class="btn btn-primary" style="font-size:12px;padding:5px 12px" onclick="createClaudeMd(${JSON.stringify(f.path)},${JSON.stringify(f.label)})">新建</button>`;

  return `
  <div class="claudemd-card" data-path="${escHtml(f.path)}">
    <div class="claudemd-card-left">
      <div class="scope-badge ${scopeClass}" style="font-size:11px;padding:2px 8px">${scopeIcon} ${scopeLabel}</div>
      <div class="claudemd-path">${escHtml(f.path)}</div>
    </div>
    <div class="claudemd-card-right">
      ${statusDot}
      ${sizeStr ? `<span style="font-size:11px;color:var(--text3)">${sizeStr}</span>` : ''}
      ${actionBtn}
    </div>
  </div>`;
}

/**
 * 打开已有 CLAUDE.md 的编辑弹窗
 */
window.openClaudeMdEdit = async function (path, label) {
  const content = await invoke('read_file', { path }).catch(e => { toast(String(e), 'danger'); return ''; });
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path, content: newContent }).catch(e => { toast(String(e), 'danger'); });
    await loadClaudeMd();
    toast('已保存', 'success');
  };
  document.getElementById('edit-title').textContent = `CLAUDE.md — ${label}`;
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
};

/**
 * 新建一个空的 CLAUDE.md 文件，打开编辑弹窗
 */
window.createClaudeMd = async function (path, label) {
  const defaultContent = `# ${label}\n\n<!-- 在此描述项目背景、约定和偏好，帮助 Claude 更好地理解你的项目 -->\n`;
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path, content: newContent }).catch(e => { toast(String(e), 'danger'); });
    await loadClaudeMd();
    toast('已创建', 'success');
  };
  document.getElementById('edit-title').textContent = `新建 CLAUDE.md — ${label}`;
  document.getElementById('edit-textarea').value = defaultContent;
  document.getElementById('edit-modal').classList.add('show');
};
