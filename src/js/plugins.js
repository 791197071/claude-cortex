/* ── 插件页模块 ────────────────────────────────────────────────
 * 负责插件列表加载、描述自动获取（本地 README → npm → LLM 翻译）、
 * 插件卸载等功能。
 *
 * 描述获取策略（三层回退，优先本地不联网）：
 *   1. 本地 README.md（读取插件安装目录，无需网络）
 *   2. npm registry 公开接口（联网，无需 API Key）
 *   3. LLM 翻译为中文（需配置 API Key，可选）
 *
 * 依赖：utils.js（invoke, escHtml）、toast.js、modal.js（showConfirm）、
 *       settings.js（PROVIDERS，用于可选的 LLM 翻译）
 * ──────────────────────────────────────────────────────────────── */

/**
 * 硬编码中文描述的已知插件表
 * 当本地/网络均无法获取描述时使用，优先级最高
 */
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

/** localStorage 缓存 key 生成器，带版本号便于后续升级清理 */
const PLUGIN_DESC_CACHE_KEY = n => `cortex_plugin_desc_v1_${n}`;

/**
 * 根据插件名生成带颜色的首字母头像
 * 颜色通过字符编码哈希确定，相同插件名始终得到相同颜色
 */
function getPluginIcon(name) {
  const initial = (name || '?')[0].toUpperCase();
  const colors = ['#0ea5e9', '#10b981', '#f59e0b', '#a78bfa', '#38bdf8'];
  const color = colors[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length];
  return `<div style="width:40px;height:40px;border-radius:11px;background:${color};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;font-weight:700;color:#fff;font-family:-apple-system,sans-serif">${initial}</div>`;
}

/**
 * 获取插件的已缓存描述（不联网）
 * 优先级：硬编码元数据 > localStorage 缓存 > 后端返回的原始描述
 */
function getPluginDescCached(p) {
  return PLUGIN_META[p.name]?.descZh
    || localStorage.getItem(PLUGIN_DESC_CACHE_KEY(p.name))
    || p.description
    || null;
}

/**
 * 从插件安装目录读取本地 README，提取第一段有效描述文字
 * 尝试多个候选文件名，成功即返回，不联网
 * @returns {Promise<string|null>}
 */
async function readLocalReadme(pluginPath) {
  try {
    const candidates = ['README.md', 'readme.md', 'README.txt', 'DESCRIPTION.md'];
    for (const fname of candidates) {
      const content = await invoke('read_file', { path: pluginPath + '/' + fname }).catch(() => null);
      if (!content) continue;
      /* 去掉标题行（# 开头），取第一行有效文字，去除 Markdown 修饰符 */
      const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      if (lines.length) return lines[0].replace(/[*_`]/g, '').slice(0, 200);
    }
  } catch {}
  return null;
}

/**
 * 向 npm registry 公开接口查询插件描述
 * 尝试三种包名变体：原名、@anthropic-ai/name、claude-name
 * 使用公开接口，无需 API Key，超时 6 秒
 * @returns {Promise<string|null>}
 */
async function fetchNpmDesc(name) {
  const variants = [name, `@anthropic-ai/${name}`, `claude-${name}`];
  for (const n of variants) {
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(n)}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      /* 优先取顶层 description，其次取最新版本的 description */
      const desc = data.description || Object.values(data.versions || {}).pop()?.description;
      if (desc) return desc;
    } catch { /* 当前变体失败，继续尝试下一个 */ }
  }
  return null;
}

/**
 * 使用已配置的 LLM 将插件描述翻译为中文（可选功能）
 * 如果未配置 API Key，直接返回 null，调用方会展示原始英文描述
 * @returns {Promise<string|null>}
 */
async function translateToZh(pluginName, rawDesc) {
  const cfg      = window._settingsCfg || {};
  const provider = cfg.active_provider || 'claude';
  const p        = PROVIDERS[provider];
  if (!p) return null;

  const apiKey = cfg[p.key];
  if (!apiKey) return null; /* 无 Key → 跳过翻译，展示原文 */

  const prompt = `将以下插件描述翻译成简洁中文（30字以内），只返回中文，不加任何前缀：\n插件名：${pluginName}\n原文：${rawDesc}`;

  try {
    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 80,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      return (await res.json()).content?.[0]?.text?.trim() || null;
    } else {
      const endpoint = provider === 'deepseek'
        ? 'https://api.deepseek.com/v1/chat/completions'
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      const model = provider === 'deepseek' ? 'deepseek-chat' : 'qwen-plus';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 80, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      return (await res.json()).choices?.[0]?.message?.content?.trim() || null;
    }
  } catch {
    return null;
  }
}

/**
 * 异步补充某个插件的描述（不阻塞首次渲染）
 * 执行顺序：本地 README → npm registry → LLM 翻译
 * 完成后直接更新 DOM 中的描述文字，并写入 localStorage 缓存
 */
async function enrichPluginDesc(p) {
  const descEl = document.querySelector(`#plugin-dyn-${CSS.escape(p.name)} .row-desc`);
  if (!descEl) return;

  /* 1. 尝试本地 README（不联网） */
  const readmeDesc = await readLocalReadme(p.path);

  /* 2. 本地无结果则查询 npm registry */
  const rawDesc = readmeDesc || await fetchNpmDesc(p.name);

  if (!rawDesc) {
    descEl.textContent = '暂无描述';
    descEl.style.color = 'var(--text3)';
    return;
  }

  /* 3. 如果已是中文直接使用，否则尝试 LLM 翻译（有 Key 才执行） */
  const hasChinese = /[一-鿿]/.test(rawDesc);
  const finalDesc = hasChinese ? rawDesc : (await translateToZh(p.name, rawDesc) || rawDesc);

  /* 持久化缓存，下次打开无需重新查询 */
  localStorage.setItem(PLUGIN_DESC_CACHE_KEY(p.name), finalDesc);
  descEl.textContent = finalDesc;
  descEl.style.color = '';
}

/**
 * 加载并渲染插件列表
 * - 已知插件：直接显示缓存/硬编码描述
 * - 新插件（首次出现）：异步后台补充描述，先显示"查询中"占位
 */
async function loadPlugins() {
  const plugins = await invoke('list_plugins').catch(() => []);

  /* 更新统计 */
  const statEl = document.getElementById('stat-plugins');
  if (statEl) statEl.textContent = plugins.length;
  const navBadge = document.getElementById('nav-badge-plugins');
  if (navBadge) navBadge.textContent = plugins.length;
  const statSkills = document.getElementById('stat-plugin-skills');
  if (statSkills) statSkills.textContent = plugins.reduce((a, p) => a + p.skills.length, 0);

  const container = document.getElementById('plugins-list');
  if (!container) return;

  if (plugins.length === 0) {
    container.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3)">未找到已安装插件<br><small>~/.claude/plugins/installed_plugins.json 中无记录</small></div>`;
    return;
  }

  const needsEnrich = []; /* 需要异步补充描述的新插件 */

  container.innerHTML = plugins.map(p => {
    const knownDesc = getPluginDescCached(p);
    if (!knownDesc) needsEnrich.push(p);
    const descHtml = knownDesc
      ? escHtml(knownDesc)
      : `<span class="plugin-desc-loading" style="color:var(--text3);font-size:11px">⟳ 正在查询描述…</span>`;
    return `
    <div class="row" id="plugin-dyn-${escHtml(p.name)}">
      ${getPluginIcon(p.name)}
      <div style="flex:1;min-width:0">
        <div class="row-name">${escHtml(p.name)}</div>
        <div class="row-desc">${descHtml}</div>
        <div class="row-path">${escHtml(p.path)}</div>
        ${p.skills.length ? `<div class="row-skills-note">提供技能：${p.skills.map(escHtml).join(' · ')}</div>` : ''}
      </div>
      ${p.version ? `<span class="row-tag">v${escHtml(p.version)}</span>` : ''}
      <div class="row-actions">
        <button class="btn btn-danger" onclick="doUninstallPlugin('${escHtml(p.name)}','plugin-dyn-${escHtml(p.name)}')">卸载</button>
      </div>
    </div>`;
  }).join('');

  /* 异步补充新插件的描述，不阻塞 UI 渲染 */
  for (const p of needsEnrich) {
    enrichPluginDesc(p).catch(() => {});
  }
}

/**
 * 卸载插件（确认后调用 Rust 后端并更新 UI）
 * @param {string} name  - 插件名称
 * @param {string} rowId - 对应列表行的 DOM id
 */
window.doUninstallPlugin = async function (name, rowId) {
  showConfirm('确认卸载', `卸载插件 "${name}"？`, '确认卸载', async () => {
    const err = await invoke('uninstall_plugin', { name })
      .then(() => null)
      .catch(e => String(e));
    if (err) { toast('卸载失败：' + err, 'danger'); return; }
    const el = document.getElementById(rowId);
    if (el) { el.classList.add('deleted'); setTimeout(() => el.remove(), 300); }
    toast('插件已卸载', 'success');
    await loadPlugins();
  });
};
