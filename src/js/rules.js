/* ── Rules 管理页模块 ──────────────────────────────────────────
 * 列出 ~/.claude/rules/ 目录下所有规则文件，按分类分 Tab 展示，
 * 支持查看/编辑/删除单个规则文件。
 * 依赖：utils.js（invoke, escHtml, fmtSize）、toast.js、modal.js
 * ──────────────────────────────────────────────────────────────── */

/** 当前激活的分类 Tab 索引 */
let _rulesActiveTab = 0;

/**
 * 加载所有规则文件并渲染页面
 */
async function loadRules() {
  const files = await invoke('list_rules').catch(() => []);

  const categories = [...new Set(files.map(f => f.category || '根目录'))];
  const el1 = document.getElementById('stat-rules-total');
  const el2 = document.getElementById('stat-rules-cats');
  const badge = document.getElementById('nav-badge-rules');
  if (el1) el1.textContent = files.length;
  if (el2) el2.textContent = categories.length;
  if (badge) badge.textContent = files.length;

  renderRuleTabs(files, categories);
}

/**
 * 按分类分组，渲染 Tab 和规则列表
 */
function renderRuleTabs(files, categories) {
  const tabsEl  = document.getElementById('rules-tabs');
  const bodyEl  = document.getElementById('rules-body');
  if (!tabsEl || !bodyEl) return;

  if (files.length === 0) {
    tabsEl.innerHTML = '';
    bodyEl.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text3)">~/.claude/rules/ 目录为空或不存在</div>';
    return;
  }

  /* 确保激活 Tab 索引有效 */
  if (_rulesActiveTab >= categories.length) _rulesActiveTab = 0;

  tabsEl.innerHTML = categories.map((cat, i) => {
    const count = files.filter(f => (f.category || '根目录') === cat).length;
    return `<button class="mem-proj-tab ${i === _rulesActiveTab ? 'active' : ''}" onclick="switchRulesTab(${i},this)">${escHtml(cat)} <span class="mem-tab-count">${count}</span></button>`;
  }).join('');

  bodyEl.innerHTML = categories.map((cat, i) => {
    const catFiles = files.filter(f => (f.category || '根目录') === cat);
    return `
    <div class="rules-cat-panel" id="rules-panel-${i}" style="${i !== _rulesActiveTab ? 'display:none' : ''}">
      <div class="mem-card">
        <div class="mem-files">${catFiles.map(ruleFileHtml).join('')}</div>
      </div>
    </div>`;
  }).join('');
}

/**
 * 生成单个规则文件行的 HTML（横排布局：名称 + 路径 + 大小 + 操作）
 */
function ruleFileHtml(f) {
  return `
  <div class="mem-file" id="rulef-${escHtml(f.id)}" data-path="${escHtml(f.path)}" data-name="${escHtml(f.name)}">
    <div class="mem-file-body">
      <span class="mem-file-name" style="margin-bottom:0;flex-shrink:0">${escHtml(f.name)}.md</span>
      <span class="mem-path" style="font-size:10.5px;word-break:break-all;flex:1;min-width:0">${escHtml(f.path)}</span>
      <span style="font-size:10.5px;color:var(--text3);flex-shrink:0">${fmtSize(f.size)}</span>
      <div class="mem-file-actions" style="padding-top:0;margin-left:0">
        <button class="btn btn-ghost" onclick="openRuleFileEdit(this)">编辑</button>
        <button class="btn btn-danger" onclick="doDeleteRuleFile(this)">删除</button>
      </div>
    </div>
  </div>`;
}

/**
 * 切换规则分类 Tab
 */
window.switchRulesTab = function (idx, el) {
  _rulesActiveTab = idx;
  document.querySelectorAll('.rules-cat-panel').forEach((p, i) => {
    p.style.display = i === idx ? '' : 'none';
  });
  document.querySelectorAll('#rules-tabs .mem-proj-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
};

/**
 * 打开规则文件编辑弹窗
 */
window.openRuleFileEdit = async function (btn) {
  const el   = btn.closest('.mem-file');
  const path = el.dataset.path;
  const name = el.dataset.name;
  const content = await invoke('read_file', { path }).catch(e => { toast(String(e), 'danger'); return ''; });
  _editSaveCallback = async (newContent) => {
    await invoke('write_file', { path, content: newContent }).catch(e => { toast(String(e), 'danger'); });
    await loadRules();
    toast('已保存', 'success');
  };
  document.getElementById('edit-title').textContent = name + '.md';
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
};

/**
 * 删除规则文件（二次确认）
 */
window.doDeleteRuleFile = function (btn) {
  const el   = btn.closest('.mem-file');
  const path = el.dataset.path;
  const name = el.dataset.name;
  const elId = el.id;
  showConfirm('确认删除', `删除规则文件 "${name}.md"？此操作不可撤销。`, '确认删除', async () => {
    await invoke('delete_file', { path }).catch(e => { toast(String(e), 'danger'); });
    const target = document.getElementById(elId);
    if (target) { target.classList.add('deleted'); setTimeout(() => target.remove(), 300); }
    toast('已删除', 'success');
  });
};
