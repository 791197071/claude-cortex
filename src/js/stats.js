/* ── 使用统计页模块 ──────────────────────────────────────────────
 * 加载并展示 Claude Code 历史使用统计：
 * - 顶部总览卡片（总会话数、总 Token、平均每次、活跃项目数、估算费用）
 * - 近 14 天 Token 趋势条形图（按模型分色堆叠）
 * - 项目用量表 / 模型用量表（Tab 切换）
 *
 * 后端 get_stats 返回结构：
 * {
 *   daily: [{date, input_tokens, output_tokens, models: {model: tokens}}],
 *   projects: [{project, input_tokens, output_tokens, session_count}],
 *   total_input, total_output, session_count,
 *   model_totals: {model: tokens}
 * }
 *
 * 依赖：utils.js（invoke, escHtml, fmtTokens）
 * ──────────────────────────────────────────────────────────────── */

/**
 * 用每个模型真实的 input/output tokens 计算总费用（USD）
 */
function calcTotalCost(modelInputTotals, modelOutputTotals) {
  let total = 0;
  const models = new Set([...Object.keys(modelInputTotals), ...Object.keys(modelOutputTotals)]);
  for (const model of models) {
    const { input, output } = getModelPricing(model);
    total += ((modelInputTotals[model] || 0) * input + (modelOutputTotals[model] || 0) * output) / 1_000_000;
  }
  return total;
}

/**
 * 条形图颜色池，按模型在列表中的出现顺序循环使用
 */
const MODEL_COLORS = [
  '#6c8ef5', '#a78bfa', '#2dd4bf', '#52c79b', '#f9a825',
  '#f87171', '#60a5fa', '#fb923c', '#e879f9', '#34d399',
];

/**
 * 根据模型名在全部模型列表中的索引取色
 */
function modelColor(model, allModels) {
  const idx = allModels.indexOf(model);
  return MODEL_COLORS[idx % MODEL_COLORS.length];
}

/**
 * 缩短模型名：去掉 'claude-' 前缀和日期后缀
 */
function shortModelName(model) {
  return model
    .replace('claude-', '')
    .replace(/-\d{8,}$/, '')
    .replace('20251001', '');
}

/**
 * 主入口：从后端获取统计数据并完整渲染统计页
 */
async function loadStats() {
  const stats = await invoke('get_stats').catch(() => ({
    daily: [], projects: [], total_input: 0, total_output: 0,
    session_count: 0, model_totals: {},
  }));

  const totalTokens = stats.total_input + stats.total_output;
  const avg = stats.session_count > 0 ? Math.round(totalTokens / stats.session_count) : 0;

  const totalCost = calcTotalCost(stats.model_input_totals || {}, stats.model_output_totals || {});

  /* 缓存命中率 */
  const cacheRead  = stats.total_cache_read  || 0;
  const cacheWrite = stats.total_cache_write || 0;
  const cacheTotal = cacheRead + cacheWrite;
  const hitRate    = cacheTotal > 0 ? Math.round(cacheRead / cacheTotal * 100) : null;

  /* 更新顶部统计卡片 */
  const elMap = {
    'stat-total-sessions': stats.session_count,
    'stat-total-tokens':   fmtTokens(totalTokens),
    'stat-avg-tokens':     fmtTokens(avg),
    'stat-proj-count':     stats.projects.length,
    'stat-total-cost':     fmtCost(totalCost),
    'stat-cache-hit':      hitRate != null ? hitRate + '%' : '-',
  };
  Object.entries(elMap).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });

  renderCacheEff(cacheRead, cacheWrite, stats.model_input_totals || {});

  /* 模型列表：按 Token 用量降序 */
  const allModels = Object.entries(stats.model_totals || {})
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m);

  renderBarChart(stats.daily, allModels);
  renderModelLegend(allModels, stats.model_totals || {});
  renderProjTable(stats.projects, totalTokens, totalCost);
  renderModelTable(stats.model_totals || {}, allModels, stats.model_input_totals || {}, stats.model_output_totals || {});
}

/**
 * 渲染近 14 天每日 Token 趋势条形图
 * 每根柱子按模型比例堆叠着色，鼠标悬停显示 Token 数量
 */
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
    /* 按模型比例生成堆叠色块 */
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

/**
 * 渲染模型图例（条形图下方）
 */
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

/**
 * 切换项目/模型 Tab
 * @param {'proj'|'model'} tab
 */
window.switchStatsTab = function (tab) {
  document.getElementById('stats-panel-proj').style.display  = tab === 'proj'  ? '' : 'none';
  document.getElementById('stats-panel-model').style.display = tab === 'model' ? '' : 'none';
  document.getElementById('stats-tab-proj').classList.toggle('active',  tab === 'proj');
  document.getElementById('stats-tab-model').classList.toggle('active', tab === 'model');
};

/**
 * 渲染模型用量表（Token 占比进度条 + 估算费用）
 */
function renderModelTable(modelTotals, allModels, modelInputTotals, modelOutputTotals) {
  const tbody = document.getElementById('stats-model-tbody');
  if (!tbody) return;
  const total = Object.values(modelTotals).reduce((a, b) => a + b, 0);
  if (allModels.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:20px">暂无数据</td></tr>';
    return;
  }
  tbody.innerHTML = allModels.map(m => {
    const tokens = modelTotals[m] || 0;
    const pct    = total > 0 ? Math.round((tokens / total) * 100) : 0;
    const color  = modelColor(m, allModels);
    const { input: ip, output: op } = getModelPricing(m);
    const cost = ((modelInputTotals[m] || 0) * ip + (modelOutputTotals[m] || 0) * op) / 1_000_000;
    return `
    <tr>
      <td style="display:flex;align-items:center;gap:8px">
        <span style="width:8px;height:8px;border-radius:2px;background:${color};flex-shrink:0;display:inline-block"></span>
        ${escHtml(shortModelName(m))}
      </td>
      <td>${fmtTokens(tokens)}</td>
      <td>
        <div class="progress-wrap">
          <div class="progress-bg"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="progress-pct">${pct}%</span>
        </div>
      </td>
      <td style="color:var(--green);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right">≈ ${fmtCost(cost)}</td>
    </tr>`;
  }).join('');
}

/**
 * 渲染项目用量表（Token 占比进度条 + 估算费用）
 * 项目无模型明细，用全局平均单价（totalCost / totalTokens）估算
 */
function renderProjTable(projects, totalTokens, totalCost) {
  const tbody = document.getElementById('stats-proj-tbody');
  if (!tbody) return;
  if (projects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:20px">暂无数据</td></tr>';
    return;
  }
  const avgCostPerToken = totalTokens > 0 ? totalCost / totalTokens : 0;
  const colors = ['var(--accent)', 'var(--purple)', 'var(--teal)', 'var(--green)', 'var(--amber)'];
  tbody.innerHTML = projects.map((p, i) => {
    const total = p.input_tokens + p.output_tokens;
    const pct   = totalTokens > 0 ? Math.round((total / totalTokens) * 100) : 0;
    const cost  = total * avgCostPerToken;
    return `
    <tr>
      <td>${escHtml(p.project) || '全局'}</td>
      <td>${fmtTokens(total)}</td>
      <td>${p.session_count}</td>
      <td>
        <div class="progress-wrap">
          <div class="progress-bg"><div class="progress-fill" style="width:${pct}%;background:${colors[i % colors.length]}"></div></div>
          <span class="progress-pct">${pct}%</span>
        </div>
      </td>
      <td style="color:var(--green);font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right">≈ ${fmtCost(cost)}</td>
    </tr>`;
  }).join('');
}

/**
 * 渲染缓存效率细节行（在条形图和项目表格之间）
 * 命中率 = cache_read / (cache_read + cache_write)
 * 节省估算 = cache_read * 0.9 * 平均输入单价 / 1M
 */
function renderCacheEff(cacheRead, cacheWrite, modelInputTotals) {
  const wrap = document.getElementById('cache-eff-wrap');
  if (!wrap) return;

  const total = cacheRead + cacheWrite;
  if (total === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const hitPct  = Math.round(cacheRead  / total * 100);
  const missPct = 100 - hitPct;

  document.getElementById('cache-read-val').textContent  = fmtTokens(cacheRead);
  document.getElementById('cache-write-val').textContent = fmtTokens(cacheWrite);
  document.getElementById('cache-hit-pct').textContent   = hitPct + '%';
  document.getElementById('cache-miss-pct').textContent  = missPct + '%';

  const readBar  = document.getElementById('cache-read-bar');
  const writeBar = document.getElementById('cache-write-bar');
  if (readBar)  readBar.style.width  = hitPct + '%';
  if (writeBar) writeBar.style.width = missPct + '%';
}
