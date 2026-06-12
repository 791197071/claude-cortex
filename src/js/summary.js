/* ── 一键总结模块 ──────────────────────────────────────────────
 * 管理"一键总结"弹窗：时间范围选择、项目筛选、提示词编辑、
 * 调用 LLM 生成总结、AI 评分（含印章特效和粒子动画）。
 * 依赖：utils.js（invoke, escHtml, fmtTokens）、toast.js、
 *       settings.js（PROVIDERS, getConfigPath）、sessions.js（_sessionsData）
 * ──────────────────────────────────────────────────────────────── */

/**
 * 默认总结提示词（用户可在弹窗内修改，修改后持久化到配置文件）
 * 强调对会话内容的深度理解，不允许简单复述 commit message
 */
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

/** 总结时间范围（本地格式化日期字符串，如 '2025-06-01'） */
let _summaryStart = '';
let _summaryEnd   = '';

/** 提示词防抖保存定时器 */
let _summaryPromptTimer = null;

/** 当前选中的项目（空集合 = 全部项目） */
let _summarySelectedProjects = new Set();

/**
 * 持久化用户修改的提示词到配置文件
 * 由防抖定时器调用（输入停止 600ms 后触发）
 */
async function saveSummaryPrompt(value) {
  const path = await getConfigPath();
  const raw  = await invoke('read_file', { path }).catch(() => null);
  const cfg  = raw ? JSON.parse(raw) : {};
  cfg.summary_prompt = value;
  window._settingsCfg = cfg;
  await invoke('write_file', { path, content: JSON.stringify(cfg, null, 2) }).catch(() => {});
}

/**
 * 切换单个项目的选中状态
 */
window.toggleSummaryProject = function (name, el) {
  if (_summarySelectedProjects.has(name)) {
    _summarySelectedProjects.delete(name);
    el.classList.remove('active');
  } else {
    _summarySelectedProjects.add(name);
    el.classList.add('active');
  }
};

/** 全选/取消全选项目 */
window.toggleAllSummaryProjects = function () {
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

/** 提示词区域是否已展开为全屏模式 */
let _promptExpanded = false;

/**
 * 切换提示词区域的展开/收起状态
 * 展开时隐藏时间范围和项目筛选，仅显示大尺寸 textarea
 */
window.toggleSummaryPromptExpand = function () {
  _promptExpanded = !_promptExpanded;
  const ta         = document.getElementById('summary-prompt');
  const icon       = document.getElementById('summary-prompt-expand-icon');
  const btn        = document.getElementById('summary-prompt-expand-btn');
  const rangeBlock = document.getElementById('summary-range-block');
  const dateRow    = document.getElementById('summary-date-row');
  const projBlock  = document.getElementById('summary-project-block');

  if (_promptExpanded) {
    rangeBlock.style.display = 'none';
    dateRow.style.display    = 'none';
    projBlock.style.display  = 'none';
    ta.rows = 20;
    icon.innerHTML = '<path d="M5 1H1v4M13 5V1H9M9 13h4V9M1 9v4h4"/>';
    btn.style.background   = 'var(--accent-soft)';
    btn.style.borderColor  = 'var(--accent)';
    btn.style.color        = 'var(--accent)';
  } else {
    rangeBlock.style.display = '';
    projBlock.style.display  = '';
    ta.rows = 5;
    /* dateRow 由 setSummaryRange 控制，不在此强制显示 */
    icon.innerHTML = '<path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>';
    btn.style.background = btn.style.borderColor = btn.style.color = '';
  }
};

/**
 * 打开"一键总结"弹窗
 * - 重置 UI 状态
 * - 从配置文件加载上次保存的提示词
 * - 从已加载的会话数据提取项目列表（默认选中最近活跃项目）
 */
window.openSummaryModal = async function () {
  /* 重置展开状态 */
  _promptExpanded = false;
  document.getElementById('summary-prompt').rows = 5;
  document.getElementById('summary-range-block').style.display = '';
  document.getElementById('summary-project-block').style.display = '';
  document.getElementById('summary-date-row').style.display = 'none';
  document.getElementById('summary-prompt-expand-icon').innerHTML = '<path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>';
  const expandBtn = document.getElementById('summary-prompt-expand-btn');
  expandBtn.style.background = expandBtn.style.borderColor = expandBtn.style.color = '';
  setSummaryRange(0, document.getElementById('sum-pill-0'));
  document.getElementById('summary-loading-mask').style.display = 'none';

  /* 加载配置（先加载再显示，防止用户在 textarea 更新前就点击生成） */
  const path = await getConfigPath();
  const raw  = await invoke('read_file', { path }).catch(() => null);
  const cfg  = raw ? JSON.parse(raw) : {};

  const promptEl = document.getElementById('summary-prompt');
  promptEl.value = cfg.summary_prompt || DEFAULT_SUMMARY_PROMPT;

  document.getElementById('summary-modal').classList.add('show');

  /* 绑定提示词输入防抖保存（只绑定一次） */
  if (!promptEl._bound) {
    promptEl._bound = true;
    promptEl.addEventListener('input', () => {
      clearTimeout(_summaryPromptTimer);
      _summaryPromptTimer = setTimeout(() => saveSummaryPrompt(promptEl.value.trim()), 600);
    });
  }

  /* 从已加载的会话数据提取项目，按最近活跃时间降序 */
  _summarySelectedProjects.clear();
  const projLatest = new Map();
  for (const s of _sessionsData) {
    if (s.project) {
      const cur = projLatest.get(s.project) || 0;
      if (s.timestamp > cur) projLatest.set(s.project, s.timestamp);
    }
  }
  const projectNames = [...projLatest.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  /* 默认选中最近活跃的项目 */
  if (projectNames.length > 0) _summarySelectedProjects.add(projectNames[0]);

  const listEl = document.getElementById('summary-project-list');
  listEl.innerHTML = projectNames.length === 0
    ? '<span style="font-size:12px;color:var(--text3)">暂无项目</span>'
    : projectNames.map(name =>
        `<button class="sum-proj-chip range-pill${_summarySelectedProjects.has(name) ? ' active' : ''}" data-name="${escHtml(name)}" onclick="toggleSummaryProject('${escHtml(name)}',this)">${escHtml(name)}</button>`
      ).join('');
  document.getElementById('sum-proj-toggle-all').textContent = '全选';

  /* 检查当前提供商是否已配置 API Key */
  const active = cfg.active_provider || 'claude';
  const hasKey = !!(cfg[PROVIDERS[active].key]);
  document.getElementById('summary-api-hint-name').textContent = PROVIDERS[active].name;
  document.getElementById('summary-api-hint').style.display    = hasKey ? 'none' : 'flex';
  const genBtn = document.getElementById('summary-generate-btn');
  genBtn.disabled     = !hasKey;
  genBtn.style.opacity = hasKey ? '' : '0.45';
};

/** 关闭总结弹窗 */
window.closeSummaryModal = function () {
  document.getElementById('summary-modal').classList.remove('show');
};

/* 点击遮罩关闭 */
document.getElementById('summary-modal').onclick = function (e) {
  if (e.target === this) closeSummaryModal();
};

/**
 * 设置总结时间范围
 * 使用本地时间格式化避免 UTC 时区偏移（跨时区时 toISOString 会返回前一天）
 */
window.setSummaryRange = function (days, btn) {
  document.querySelectorAll('#sum-pill-0,#sum-pill-7,#sum-pill-14,#sum-pill-30,#sum-pill-custom')
    .forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const today = new Date();
  const fmtLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const dateRow = document.getElementById('summary-date-row');

  if (days === -1) {
    dateRow.style.display = 'grid';
    return;
  }
  dateRow.style.display = 'none';
  const from = new Date(today);
  if (days > 0) from.setDate(today.getDate() - days);
  _summaryStart = fmtLocal(from);
  _summaryEnd   = fmtLocal(today);
  document.getElementById('summary-start').value = _summaryStart;
  document.getElementById('summary-end').value   = _summaryEnd;
};

/**
 * 执行总结生成：
 * 1. 获取时间范围内的会话数据
 * 2. 按项目过滤
 * 3. 按模型上下文预算智能截断（优先 token 多的会话）
 * 4. 调用对应 LLM API 生成总结
 * 5. 展示结果并触发 AI 评分
 */
window.doSummary = async function () {
  const start = document.getElementById('summary-start').value || _summaryStart;
  const end   = document.getElementById('summary-end').value   || _summaryEnd;
  if (!start || !end) { toast('请先选择时间范围', 'danger'); return; }

  const userPrompt = document.getElementById('summary-prompt').value.trim();
  /* 生成前立即保存提示词，不等防抖 */
  clearTimeout(_summaryPromptTimer);
  await saveSummaryPrompt(userPrompt);

  /* 使用本地时间解析，避免 UTC 时区偏差漏掉当天 0-8 点的会话 */
  const startTs = Math.floor(new Date(start + 'T00:00:00').getTime() / 1000);
  const endTs   = Math.floor(new Date(end   + 'T23:59:59').getTime() / 1000);

  /* 读取 API 配置 */
  const cfgPath  = await getConfigPath();
  const cfgRaw   = await invoke('read_file', { path: cfgPath }).catch(() => null);
  const cfg      = cfgRaw ? JSON.parse(cfgRaw) : {};
  const provider = cfg.active_provider || 'claude';
  const pInfo    = PROVIDERS[provider];
  const apiKey   = cfg[pInfo.key] || '';
  if (!apiKey) { toast('请先在设置页配置 API Key', 'danger'); return; }

  const genBtn  = document.getElementById('summary-generate-btn');
  const mask    = document.getElementById('summary-loading-mask');
  const maskText = document.getElementById('summary-loading-text');
  const showMask = text => { mask.style.display = 'flex'; maskText.textContent = text; };
  const hideMask = () => { mask.style.display = 'none'; };
  const resetBtn = () => {
    genBtn.disabled = false;
    genBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h10M2 7h7M2 10h5"/></svg> 生成总结';
  };

  genBtn.disabled = true;
  genBtn.innerHTML = '<span class="spin-icon">⟳</span> 生成中…';
  showMask('正在读取会话数据…');

  try {
    /* 1. 拉取会话数据 */
    let sessions = await invoke('export_sessions', { startTs, endTs }).catch(() => []);

    /* 2. 按选中项目过滤（未选 = 全部） */
    if (_summarySelectedProjects.size > 0) {
      sessions = sessions.filter(s => _summarySelectedProjects.has(s.project));
    }

    /* 3. 过滤无消息内容的会话 */
    sessions = sessions.filter(s => s.messages && s.messages.length > 0);

    if (sessions.length === 0) {
      hideMask(); toast('该时间段内无会话记录', 'danger'); resetBtn(); return;
    }

    const totalTokens = sessions.reduce((a, s) => a + s.input_tokens + s.output_tokens, 0);
    const projects    = [...new Set(sessions.map(s => s.project).filter(Boolean))];
    const msgCount    = sessions.reduce((a, s) => a + s.messages.length, 0);

    showMask(`正在调用 ${pInfo.name} 生成总结（${sessions.length} 条会话，提示词 ${userPrompt.length} 字符）…`);

    /* 4. 按模型上下文预算填充内容，优先 token 最多的会话 */
    const MODEL_LIMITS = { claude: 120000, deepseek: 50000, qwen: 80000 };
    const BUDGET = MODEL_LIMITS[provider] || 60000;

    const ranked = [...sessions].sort((a, b) =>
      (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens)
    );

    let remaining = BUDGET;
    const included = [];

    for (const s of ranked) {
      if (remaining <= 0) break;
      const header = `【${s.date}】[${s.project || '未知项目'}] ${s.title}\n`;
      const msgs   = s.messages
        .map(m => `[${m.role === 'user' ? '用户' : 'AI'}] ${m.text.trim()}`)
        .join('\n');

      const sessionBudget = remaining - header.length;
      if (sessionBudget <= 0) break;

      const body = msgs.length <= sessionBudget
        ? msgs
        : msgs.slice(0, sessionBudget - 6) + '\n…'; /* 超出预算时截断 */

      const block = header + body;
      included.push({ s, block });
      remaining -= block.length;
    }

    /* 按日期升序排列，保持时间脉络 */
    included.sort((a, b) => a.s.date.localeCompare(b.s.date));
    const sessionBlocks = included.map(x => x.block);
    const omitted = sessions.length - included.length;
    if (omitted > 0) sessionBlocks.push(`\n…（另有 ${omitted} 条会话因超出模型上下文上限已省略）`);

    /* 5. 构造请求 payload */
    const systemInstruction = userPrompt ||
      '你是一个工作助手，请根据用户提供的 AI 对话记录，生成一份简洁的工作总结，' +
      '重点列出完成的工作内容、涉及的项目和技术点，语言简洁专业。';

    const userContent =
      `时间范围：${start} 至 ${end}\n` +
      `会话数：${sessions.length}，消息数：${msgCount}，累计 Token：${fmtTokens(totalTokens)}\n` +
      `涉及项目：${projects.length ? projects.join('、') : '无'}\n\n` +
      `以下是会话对话记录：\n\n` +
      sessionBlocks.join('\n\n---\n\n');

    /* 6. 调用 LLM API */
    let resultText = '';

    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: systemInstruction,
          messages: [{ role: 'user', content: userContent }],
        }),
      });
      if (res.status === 401 || res.status === 403) throw new Error('API Key 无效，请在设置页重新配置');
      if (!res.ok) throw new Error(`API 请求失败（${res.status}）`);
      resultText = (await res.json()).content?.[0]?.text || '';
    } else {
      const endpoint = provider === 'deepseek'
        ? 'https://api.deepseek.com/v1/chat/completions'
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      const model = provider === 'deepseek' ? 'deepseek-chat' : 'qwen-plus';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 2048,
          messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: userContent }],
        }),
      });
      if (res.status === 401 || res.status === 403) throw new Error('API Key 无效，请在设置页重新配置');
      if (!res.ok) throw new Error(`API 请求失败（${res.status}）`);
      resultText = (await res.json()).choices?.[0]?.message?.content || '';
    }

    if (!resultText) throw new Error('模型返回内容为空');

    hideMask();
    openSummaryResult(resultText);
    toast('总结已生成', 'success');
    /* 异步触发 AI 评分（仅当设置中启用时） */
    if (window._settingsCfg?.ai_rating_enabled !== false) {
      rateSummary(resultText, provider, apiKey, totalTokens)
        .then(r => { if (r) showRatingBadge(r.grade, r.comment); });
    }

  } catch (e) {
    hideMask();
    toast('生成失败：' + e.message, 'danger');
  } finally {
    resetBtn();
  }
};

/* ── AI 评分系统 ── */

/**
 * 各评级的视觉样式（印章颜色和发光效果）
 * 等级从高到低：夯 > 顶级 > NPC > 拉 > 拉完了
 */
const RATING_STYLES = {
  '夯':     { ink:'#f59e0b', shadow:`0 0 14px #fde68a,0 0 32px #fbbf24,0 0 64px #f59e0bbb,0 0 100px #d9770677,5px 4px 0 #92400e55`, glowVar:'#fbbf24' },
  '顶级':   { ink:'#a78bfa', shadow:`0 0 14px #c4b5fd,0 0 32px #a78bfa,0 0 64px #7c3aedaa,0 0 100px #5b21b666,4px 4px 0 #4c1d9544`, glowVar:'#a78bfa' },
  'NPC':    { ink:'#9ca3af', shadow:`2px 2px 0 #1f2937,3px 3px 0 #111827,-1px -1px 0 #6b7280aa,0 0 6px #9ca3af33`, glowVar:'#9ca3af' },
  '拉':     { ink:'#f43f5e', shadow:`0 0 14px #fda4af,0 0 32px #f43f5e,0 0 64px #e11d48bb,0 0 100px #be123c77,5px 4px 0 #9f123444`, glowVar:'#f43f5e' },
  '拉完了': { ink:'#71717a', shadow:`4px 4px 0 #09090b,2px 2px 0 #18181b,0 0 4px #52525b66,-2px -2px 0 #3f3f4688,0 0 18px #71717a33`, glowVar:'#52525b' },
};

/**
 * 调用 LLM 对生成的总结进行评分
 * @returns {Promise<{grade: string, comment: string}|null>}
 */
async function rateSummary(text, provider, apiKey, tokens = 0) {
  const fmtTok = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n);
  const tokenLine = tokens > 0 ? `\n今日累计消耗 Token：${fmtTok(tokens)}（若消耗极高但总结内容贫乏，需从严扣分）` : '';
  const prompt = `你是一个眼光毒辣、不会轻易给高分的工作总结评审官。评分要真实，宁可低打也不能虚高。${tokenLine}

评分标准（默认先考虑NPC，有充分理由才能往上或往下）：
- 夯：极其罕见，不仅有深度亮点，还要表达有力、结构清晰，缺一不可，一般不该出现
- 顶级：有明确的具体成果和真实价值，且逻辑清晰无废话，仅"写得不错"不够
- NPC：能完整记录工作内容即可到达，是绝大多数总结的正常水平
- 拉：明显空洞、重复、或内容与实际工作脱节
- 拉完了：毫无价值，纯粹是在敷衍

输出格式：等级|评语（15字以内，带情绪、有个性、每次都不一样，禁止换行）
- 评语必须是AI当场生成的真实感受，不能套模板，每次都要不一样
- 评语中选1～2个情绪最强烈的词，用**词**包裹作为重点标记（禁止整句都加）
示例：夯|哥们这份总结**封神**了！
只输出这一行，不要其他内容。

待评分总结：\n${text.slice(0, 1600)}`;

  try {
    let raw = '';
    if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 60, messages: [{ role: 'user', content: prompt }] }),
      });
      raw = (await res.json()).content?.[0]?.text?.trim() || '';
    } else {
      const endpoint = provider === 'deepseek'
        ? 'https://api.deepseek.com/v1/chat/completions'
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      const model = provider === 'deepseek' ? 'deepseek-chat' : 'qwen-plus';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 60, messages: [{ role: 'user', content: prompt }] }),
      });
      raw = (await res.json()).choices?.[0]?.message?.content?.trim() || '';
    }

    const [gradeRaw, comment = ''] = raw.split('|');
    let grade = null;
    if (gradeRaw.includes('拉完了')) grade = '拉完了';
    else if (gradeRaw.includes('拉'))   grade = '拉';
    else if (gradeRaw.includes('夯'))   grade = '夯';
    else if (gradeRaw.includes('顶级')) grade = '顶级';
    else if (gradeRaw.toLowerCase().includes('npc')) grade = 'NPC';
    return grade ? { grade, comment: comment.trim() } : null;
  } catch { return null; }
}

/**
 * 粒子爆炸特效（仅在"夯"和"顶级"时触发）
 * 从印章位置向四周散射彩色粒子
 */
function burstParticles(grade) {
  const palettes = {
    '夯':   ['#fbbf24','#f59e0b','#10b981','#6ee7b7','#fff','#fde68a','#ef4444','#f97316'],
    '顶级': ['#6c8ef5','#a78bfa','#60a5fa','#fff','#c4b5fd','#2dd4bf','#e879f9'],
  };
  const palette = palettes[grade];
  if (!palette) return;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const c = canvas.getContext('2d');

  const badge = document.getElementById('summary-stamp');
  const rect  = badge?.getBoundingClientRect();
  const ox = rect ? rect.left + rect.width / 2 : window.innerWidth * 0.75;
  const oy = rect ? rect.top  + rect.height / 2 : 80;
  const count = grade === '夯' ? 100 : 60;

  const ps = Array.from({ length: count }, () => ({
    x: ox, y: oy,
    vx: (Math.random() - .5) * (grade === '夯' ? 22 : 15),
    vy: Math.random() * (-(grade === '夯' ? 18 : 12)) - 2,
    r: Math.random() * (grade === '夯' ? 7 : 5) + 2,
    color: palette[Math.floor(Math.random() * palette.length)],
    life: 1, decay: Math.random() * .013 + .007,
    shape: ['circle','rect','star'][Math.floor(Math.random() * 3)],
    rot: Math.random() * Math.PI * 2, rotV: (Math.random() - .5) * .28,
  }));

  function star(ctx, r) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI / 5) - Math.PI / 2;
      const b = a + 2 * Math.PI / 5;
      i === 0 ? ctx.moveTo(r * Math.cos(a), r * Math.sin(a)) : ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
      ctx.lineTo(r * .4 * Math.cos(b), r * .4 * Math.sin(b));
    }
    ctx.closePath(); ctx.fill();
  }

  (function draw() {
    c.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.vy += .42; p.vx *= .985;
      p.life -= p.decay; p.rot += p.rotV;
      if (p.life <= 0) continue;
      alive = true;
      c.save();
      c.globalAlpha = Math.min(p.life, 1); c.fillStyle = p.color;
      c.translate(p.x, p.y); c.rotate(p.rot);
      if (p.shape === 'rect')       c.fillRect(-p.r, -p.r * .55, p.r * 2, p.r * 1.1);
      else if (p.shape === 'star')  star(c, p.r);
      else { c.beginPath(); c.arc(0, 0, p.r, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    if (alive) requestAnimationFrame(draw); else canvas.remove();
  })();
}

/** 短暂全屏闪光（用于"夯"和"拉完了"的视觉冲击） */
function screenFlash(color, opacity, dur) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;inset:0;background:${color};pointer-events:none;z-index:9998;opacity:0;transition:opacity ${Math.round(dur/4)}ms ease`;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = String(opacity);
    setTimeout(() => {
      el.style.transition = `opacity ${Math.round(dur * 3/4)}ms ease`;
      el.style.opacity = '0';
      setTimeout(() => el.remove(), dur * 3/4 + 60);
    }, dur / 4);
  });
}

/**
 * 展示评分徽章（印章 + 评语 + 动画特效）
 */
function showRatingBadge(grade, comment) {
  const s = RATING_STYLES[grade];
  if (!s) return;

  /* 渲染评语（含随机配色和重点词高亮） */
  const commentEl = document.getElementById('summary-rating-badge');
  if (commentEl) {
    commentEl.style.cssText = 'display:flex;align-items:center;flex-shrink:0;animation:commentIn .5s ease .85s both';
    if (comment) {
      const palettes = [
        {base:'#0ea5e9',accent:'#f59e0b'},{base:'#8b5cf6',accent:'#34d399'},
        {base:'#f43f5e',accent:'#fbbf24'},{base:'#10b981',accent:'#f472b6'},
        {base:'#f97316',accent:'#60a5fa'},{base:'#e879f9',accent:'#4ade80'},
        {base:'#06b6d4',accent:'#fb7185'},{base:'#a78bfa',accent:'#fde68a'},
        {base:'#ec4899',accent:'#86efac'},{base:'#14b8a6',accent:'#fca5a5'},
      ];
      const p = palettes[Math.floor(Math.random() * palettes.length)];
      const html = escHtml(comment).replace(/\*\*(.+?)\*\*/g,
        `<span style="color:${p.accent};font-weight:800;text-decoration:underline;text-underline-offset:3px;text-shadow:0 0 6px ${p.accent}88">$1</span>`);
      commentEl.innerHTML = `<span style="font-size:13.5px;color:${p.base};font-style:italic;white-space:nowrap;font-weight:500;text-shadow:0 0 10px ${p.base}66">${html}</span>`;
    } else {
      commentEl.innerHTML = '';
    }
  }

  /* 渲染印章（fixed 定位，脱离文档流避免触发滚动） */
  const stamp = document.getElementById('summary-stamp');
  if (stamp) {
    const fontSize = grade === 'NPC' ? '48px' : grade === '拉完了' ? '28px' : '56px';
    const strokeW  = grade === 'NPC' ? '.5px' : grade === '拉完了' ? '1px' : '1.5px';
    stamp.innerHTML = `<span style="font-size:${fontSize};font-weight:900;letter-spacing:.05em;white-space:nowrap;-webkit-text-stroke:${strokeW} ${s.ink}55;text-shadow:${s.shadow};line-height:1">${grade}</span>`;

    const textarea = document.getElementById('summary-result-text');
    const rect = textarea ? textarea.getBoundingClientRect() : { top: 120, right: window.innerWidth - 40 };
    stamp.style.cssText = [
      'display:flex;align-items:center;justify-content:center',
      `position:fixed;top:${rect.top + 10}px;left:${rect.right - 120}px;width:110px;height:110px`,
      `color:${s.ink};background:none;border:none;z-index:9999`,
      `--si:${s.glowVar}`,
      'animation:stampDown .48s cubic-bezier(.2,.06,.12,1.1) forwards',
      'cursor:default;user-select:none;pointer-events:none',
    ].join(';');

    /* 落地后切换为呼吸 glow 动画 */
    setTimeout(() => {
      if (stamp.style.display !== 'none') {
        stamp.style.animation = `stampDown .48s cubic-bezier(.2,.06,.12,1.1) forwards, stampPulse ${grade==='NPC'?'4s':'2.2s'} ease-in-out .48s infinite`;
      }
    }, 500);
  }

  /* 等级特效 */
  if      (grade === '夯')      { screenFlash('#fbbf24', 0.18, 380); setTimeout(() => burstParticles('夯'), 420); }
  else if (grade === '顶级')    { setTimeout(() => burstParticles('顶级'), 420); }
  else if (grade === '拉完了')  { screenFlash('#ef4444', 0.14, 500); setTimeout(() => { if (stamp) stamp.style.animation = 'ratingShake .55s ease-in-out'; }, 630); }
  else if (grade === '拉')      { setTimeout(() => { if (stamp) stamp.style.animation = 'ratingShake .5s ease-in-out'; }, 600); }
}

/* ── 总结结果弹窗 ── */

/** 打开总结结果弹窗，清除上一次的评分状态 */
window.openSummaryResult = function (text) {
  const commentEl = document.getElementById('summary-rating-badge');
  if (commentEl) commentEl.style.display = 'none';
  const stamp = document.getElementById('summary-stamp');
  if (stamp) stamp.style.display = 'none';
  document.getElementById('summary-result-text').value = text;
  document.getElementById('summary-result-modal').classList.add('show');
};

/** 关闭总结结果弹窗，清除印章和评语 */
window.closeSummaryResult = function () {
  document.getElementById('summary-result-modal').classList.remove('show');
  const stamp = document.getElementById('summary-stamp');
  if (stamp) stamp.style.cssText = 'display:none';
  const badge = document.getElementById('summary-rating-badge');
  if (badge) badge.style.cssText = 'display:none';
};

/* 点击遮罩关闭 */
document.getElementById('summary-result-modal').onclick = function (e) {
  if (e.target === this) closeSummaryResult();
};

/** 一键复制总结内容到剪贴板 */
window.copySummaryResult = async function () {
  const text = document.getElementById('summary-result-text').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板', 'success');
  } catch {
    /* 降级方案：选中文字后执行 copy 命令 */
    document.getElementById('summary-result-text').select();
    document.execCommand('copy');
    toast('已复制到剪贴板', 'success');
  }
};
