/* ── 设置页模块 ────────────────────────────────────────────────
 * 管理 LLM 提供商选择、API Key 配置与验证。
 * PROVIDERS 对象被 plugins.js、summary.js 共享使用，
 * 因此此模块必须在它们之前加载。
 * 依赖：utils.js（invoke）、toast.js
 * ──────────────────────────────────────────────────────────────── */

/**
 * 支持的 LLM 提供商配置表
 * key: 该提供商 API Key 在配置文件中的字段名
 */
const PROVIDERS = {
  claude: {
    name: 'Claude',
    desc: 'Anthropic',
    icon: '✦',
    bg:   'linear-gradient(135deg,#6c8ef5,#a78bfa)',
    key:  'claude_api_key',
  },
  deepseek: {
    name: 'DeepSeek',
    desc: 'DeepSeek AI',
    icon: 'D',
    bg:   'linear-gradient(135deg,#2dd4bf,#60a5fa)',
    key:  'deepseek_api_key',
  },
  qwen: {
    name: '通义千问',
    desc: '阿里云',
    icon: 'Q',
    bg:   'linear-gradient(135deg,#f9a825,#fb923c)',
    key:  'qwen_api_key',
  },
};

/** 当前激活的提供商标识，默认 claude */
let _activeProvider = 'claude';

/**
 * 获取应用配置文件路径（由 Rust 后端返回平台标准路径）
 * @returns {Promise<string>}
 */
async function getConfigPath() {
  return invoke('get_config_path');
}

/**
 * 加载设置页：从配置文件读取当前选中的提供商和已配置的 Key
 */
async function loadSettings() {
  const path = await getConfigPath();
  const raw = await invoke('read_file', { path }).catch(() => null);
  let cfg = {};
  try { cfg = raw ? JSON.parse(raw) : {}; } catch (_) {}
  window._settingsCfg = cfg;
  /* 恢复上次选择的提供商（不触发保存） */
  selectProvider(cfg.active_provider || 'claude', false);
  /* 恢复 AI 评级开关（默认开启） */
  const toggle = document.getElementById('toggle-ai-rating');
  if (toggle) toggle.checked = cfg.ai_rating_enabled !== false;
}

/**
 * 切换激活的 LLM 提供商，更新 UI 并可选保存配置
 * @param {string}  provider - 提供商标识：'claude' | 'deepseek' | 'qwen'
 * @param {boolean} save     - 是否同时保存到配置文件，默认 true
 */
window.selectProvider = function (provider, save = true) {
  _activeProvider = provider;
  const p = PROVIDERS[provider];

  /* 更新提供商卡片激活状态 */
  document.querySelectorAll('.settings-provider-card').forEach(c => c.classList.remove('active'));
  document.getElementById('provider-card-' + provider)?.classList.add('active');

  /* 更新当前提供商信息展示区 */
  const iconEl = document.getElementById('settings-active-icon');
  if (iconEl) { iconEl.style.background = p.bg; iconEl.textContent = p.icon; }
  const nameEl = document.getElementById('settings-active-name');
  if (nameEl) nameEl.textContent = p.name;
  const descEl = document.getElementById('settings-active-desc');
  if (descEl) descEl.textContent = p.desc;

  /* 加载当前提供商已有的 Key（如有） */
  const cfg = window._settingsCfg || {};
  const key = cfg[p.key] || '';
  const keyInput = document.getElementById('active-api-key');
  if (keyInput) { keyInput.value = key; keyInput.type = 'password'; }

  /* 更新 Key 状态徽章 */
  const statusEl = document.getElementById('settings-key-status');
  if (statusEl) {
    statusEl.className = 'settings-key-status ' + (key ? 'configured' : 'empty');
    statusEl.textContent = key ? '已配置' : '未配置';
  }

  if (save) {
    saveActiveProvider(provider);
    toast(`已选择 ${p.name}`, 'success');
  }
};

/**
 * 持久化当前选择的提供商到配置文件
 */
async function saveActiveProvider(provider) {
  const path = await getConfigPath();
  const raw = await invoke('read_file', { path }).catch(() => null);
  const cfg = raw ? JSON.parse(raw) : {};
  cfg.active_provider = provider;
  window._settingsCfg = cfg;
  await invoke('write_file', { path, content: JSON.stringify(cfg, null, 2) }).catch(() => {});
}

/**
 * 向对应提供商发送最小测试请求验证 API Key 有效性
 * 失败时抛出 Error，调用方负责捕获处理
 */
async function testApiKey(provider, key) {
  if (provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Key 无效');
    if (!res.ok && res.status !== 400) throw new Error('请求失败 ' + res.status);
    return true;
  }

  if (provider === 'deepseek') {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-chat', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Key 无效');
    if (!res.ok && res.status !== 400) throw new Error('请求失败 ' + res.status);
    return true;
  }

  if (provider === 'qwen') {
    const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'qwen-turbo', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.status === 401 || res.status === 403) throw new Error('Key 无效');
    if (!res.ok && res.status !== 400) throw new Error('请求失败 ' + res.status);
    return true;
  }
}

/**
 * 保存 API Key：先验证有效性，通过后写入配置文件
 */
window.saveApiKey = async function () {
  const key = document.getElementById('active-api-key').value.trim();
  if (!key) { toast('请输入 API Key', 'danger'); return; }

  const saveBtn = document.querySelector('.settings-key-row .btn-primary');
  const statusEl = document.getElementById('settings-key-status');

  /* 切换到验证中状态 */
  saveBtn.textContent = '验证中…';
  saveBtn.disabled = true;
  statusEl.className = 'settings-key-status empty';
  statusEl.textContent = '验证中…';

  /* 验证 Key */
  try {
    await testApiKey(_activeProvider, key);
  } catch (e) {
    saveBtn.textContent = '保存';
    saveBtn.disabled = false;
    statusEl.className = 'settings-key-status empty';
    statusEl.textContent = '未配置';
    toast('验证失败：' + e.message, 'danger');
    return;
  }

  /* 验证通过，写入配置 */
  const path = await getConfigPath();
  const raw = await invoke('read_file', { path }).catch(() => null);
  const cfg = raw ? JSON.parse(raw) : {};
  cfg[PROVIDERS[_activeProvider].key] = key;
  cfg.active_provider = _activeProvider;
  window._settingsCfg = cfg;
  await invoke('write_file', { path, content: JSON.stringify(cfg, null, 2) })
    .catch(e => { toast('保存失败：' + e, 'danger'); return; });

  saveBtn.textContent = '保存';
  saveBtn.disabled = false;
  statusEl.className = 'settings-key-status configured';
  statusEl.textContent = '已配置';
  toast('验证通过，已保存', 'success');
};

/**
 * 保存 AI 评级开关状态到配置文件
 * @param {boolean} enabled
 */
window.saveRatingToggle = async function (enabled) {
  const path = await getConfigPath();
  const raw  = await invoke('read_file', { path }).catch(() => null);
  let cfg = {};
  try { cfg = raw ? JSON.parse(raw) : {}; } catch (_) {}
  cfg.ai_rating_enabled = enabled;
  window._settingsCfg = cfg;
  await invoke('write_file', { path, content: JSON.stringify(cfg, null, 2) }).catch(() => {});
  toast(enabled ? 'AI 评级已开启' : 'AI 评级已关闭', 'success');
};

/**
 * 切换密码框显示/隐藏状态
 * @param {string}      inputId - 密码输入框 id
 * @param {HTMLElement} btn     - 眼睛按钮元素（切换高亮色）
 */
window.toggleKeyVisibility = function (inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.style.color = isHidden ? 'var(--accent)' : '';
};

/**
 * 重置所有已配置的 API Key（不影响 active_provider 和 summary_prompt）
 */
window.resetAllKeys = function () {
  showConfirm(
    '重置所有 API Key',
    '将清除全部已配置的 API Key，此操作不可撤销。',
    '确认重置',
    async () => {
      const path = await getConfigPath();
      const raw = await invoke('read_file', { path }).catch(() => null);
      const cfg = raw ? JSON.parse(raw) : {};
      /* 只删除 key 字段，保留其他配置（如 summary_prompt、active_provider） */
      delete cfg.claude_api_key;
      delete cfg.deepseek_api_key;
      delete cfg.qwen_api_key;
      window._settingsCfg = cfg;
      await invoke('write_file', { path, content: JSON.stringify(cfg, null, 2) });

      const keyInput = document.getElementById('active-api-key');
      if (keyInput) { keyInput.value = ''; keyInput.type = 'password'; }
      const statusEl = document.getElementById('settings-key-status');
      if (statusEl) { statusEl.className = 'settings-key-status empty'; statusEl.textContent = '未配置'; }
      toast('已重置所有 API Key', 'success');
    }
  );
};
