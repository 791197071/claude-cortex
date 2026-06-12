/* ── 弹窗公共模块 ──────────────────────────────────────────────
 * 管理"确认删除"弹窗和"编辑文件"弹窗的状态与事件。
 * 对外暴露 showConfirm / closeConfirm / openEdit / closeEdit / saveEdit。
 * 依赖：toast.js（用于保存成功提示）
 * ──────────────────────────────────────────────────────────────── */

/* ── 确认弹窗状态 ── */

/**
 * 旧版简单确认：通过 DOM id 标识待操作的元素（逐步被 showConfirm 替代）
 * 保留是为了兼容少量仍使用 confirmDelete 的 HTML onclick 属性
 */
let pendingId = null;

/**
 * 新版确认弹窗：通过回调函数执行具体操作，支持异步
 * 由 showConfirm 设置，confirm-ok-btn 点击后执行
 */
window._confirmCallback = null;

/**
 * 通用确认弹窗（推荐使用此方式替代 confirmDelete）
 * @param {string}   title    - 弹窗标题
 * @param {string}   msg      - 提示内容
 * @param {string}   okText   - 确认按钮文字
 * @param {Function} callback - 确认后执行的（异步）回调
 */
function showConfirm(title, msg, okText, callback) {
  window._confirmCallback = callback;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-ok-btn').textContent = okText || '确认删除';
  document.getElementById('confirm-bg').classList.add('show');
}

/**
 * 关闭确认弹窗，清空状态
 */
function closeConfirm() {
  document.getElementById('confirm-bg').classList.remove('show');
  pendingId = null;
  window._confirmCallback = null;
}

/**
 * 旧版 confirmDelete：通过 DOM id 驱动的简单确认
 * 仍保留以兼容 HTML 中少量 onclick="confirmDelete(...)" 调用
 */
function confirmDelete(id, name) {
  event && event.stopPropagation && event.stopPropagation();
  pendingId = id;
  const isPlugin = id.startsWith('plugin-');
  const isCache  = id.startsWith('cc-');
  document.getElementById('confirm-title').textContent =
    isPlugin ? '确认卸载插件' : isCache ? '确认清除缓存' : '确认删除';
  document.getElementById('confirm-msg').textContent =
    isPlugin ? `卸载 ${name} 后，该插件提供的所有技能将不可用。确认继续？`
    : isCache ? `将清除 ${name} 的缓存文件。此操作不可撤销。`
    : `删除 ${name}？此操作不可撤销。`;
  const btn = document.getElementById('confirm-ok-btn');
  btn.textContent = isPlugin ? '确认卸载' : isCache ? '确认清除' : '确认删除';
  document.getElementById('confirm-bg').classList.add('show');
}

/* 确认按钮点击：优先执行回调，其次处理 pendingId */
document.getElementById('confirm-ok-btn').onclick = function () {
  if (window._confirmCallback) {
    const cb = window._confirmCallback;
    window._confirmCallback = null;
    closeConfirm();
    cb();
    return;
  }
  if (!pendingId) { closeConfirm(); return; }
  const el = document.getElementById(pendingId);
  if (el) { el.classList.add('deleted'); setTimeout(() => el.remove(), 300); }
  const id = pendingId;
  closeConfirm();
  /* closeSkillDetail 定义在 skills.js，此时已加载 */
  if (typeof closeSkillDetail === 'function') closeSkillDetail();
  toast(
    id.startsWith('plugin-') ? '插件已卸载'
    : id.startsWith('cc-')   ? '缓存已清除'
    : '已删除',
    'success'
  );
};

/* 点击遮罩关闭确认弹窗 */
document.getElementById('confirm-bg').onclick = function (e) {
  if (e.target === this) closeConfirm();
};

/* ── 编辑文件弹窗 ── */

/** 编辑完成后的保存回调（由各功能模块注入） */
let _editSaveCallback = null;

/** 当前正在编辑的元素 id */
let editingId = null;

/**
 * 打开编辑弹窗，加载文件内容
 * @param {string} id       - 关联的元素 id（用于更新 UI）
 * @param {string} filename - 显示在弹窗标题的文件名
 * @param {string} content  - 文件初始内容
 */
function openEdit(id, filename, content) {
  event && event.stopPropagation && event.stopPropagation();
  editingId = id;
  document.getElementById('edit-title').textContent = filename;
  document.getElementById('edit-textarea').value = content;
  document.getElementById('edit-modal').classList.add('show');
}

/** 关闭编辑弹窗，清空回调 */
function closeEdit() {
  document.getElementById('edit-modal').classList.remove('show');
  editingId = null;
}

/** 保存编辑内容：执行回调后关闭弹窗 */
window.saveEdit = async function () {
  const content = document.getElementById('edit-textarea').value;
  if (_editSaveCallback) {
    await _editSaveCallback(content);
    toast('已保存', 'success');
  }
  document.getElementById('edit-modal').classList.remove('show');
  _editSaveCallback = null;
};

/* 点击遮罩关闭编辑弹窗 */
document.getElementById('edit-modal').onclick = function (e) {
  if (e.target === this) closeEdit();
};

/* ── 创建技能弹窗 ── */

/** 关闭"新建技能"弹窗 */
function closeCreateSkill() {
  document.getElementById('create-skill-modal').classList.remove('show');
}

/* 点击遮罩关闭新建技能弹窗 */
document.getElementById('create-skill-modal').onclick = function (e) {
  if (e.target === this) closeCreateSkill();
};
