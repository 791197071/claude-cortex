/* ── MCP 服务器管理页模块（只读 + 连接探测）──────────────────────
 * 列出 ~/.claude.json 里配置的所有 MCP 服务器（全局 + 项目级），
 * 按作用域分区展示；渲染后主动对每个服务器做一次 MCP 握手探测，
 * 实时显示「正常运行 / 未连接 / 异常」连接状态。
 * 纯读取，不修改 ~/.claude.json。
 * 依赖：utils.js（invoke, escHtml）、toast.js
 * ──────────────────────────────────────────────────────────────── */

/** 传输类型说明（鼠标悬停在徽章上显示） */
const MCP_TRANSPORT_DESC = {
  stdio: '本地子进程，通过标准输入/输出管道通信',
  sse:   '通过 HTTP 长连接（Server-Sent Events）连接远程',
  http:  '通过 HTTP 连接远程',
};

/** 连接状态的展示映射：颜色 + 文案 */
const MCP_STATUS_VIEW = {
  checking:  { color: '#8e8e93', text: '检测中…' },
  ok:        { color: 'var(--green)', text: '正常运行' },
  not_found: { color: '#8e8e93', text: '未连接' },
  error:     { color: '#ff3b30', text: '异常' },
};

/**
 * 由服务器唯一标识生成 DOM 行 id（作用域 + 名称，去掉特殊字符）
 * @param {Object} s - McpServer
 * @returns {string}
 */
function mcpRowId(s) {
  return 'mcp-' + s.scope + '-' + String(s.name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * 加载并渲染 MCP 服务器列表，随后触发连接探测
 */
async function loadMcp() {
  const servers = await invoke('list_mcp_servers').catch(() => []);

  /* 顶部统计 + 侧栏徽章 */
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('stat-mcp-total', servers.length);
  setText('stat-mcp-global', servers.filter(s => s.scope === 'global').length);
  setText('nav-badge-mcp', servers.length);

  renderMcpList(servers);
  /* 渲染完成后逐个探测连接状态（并发，不阻塞首屏） */
  checkAllMcp(servers);
}

/**
 * 按作用域（全局 / 各项目）分区渲染服务器卡片
 * @param {Array} servers - 后端返回的 McpServer 列表
 */
function renderMcpList(servers) {
  const container = document.getElementById('mcp-list');
  if (!container) return;

  if (servers.length === 0) {
    container.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text3)">~/.claude.json 中未配置任何 MCP 服务器</div>';
    return;
  }

  /* 按作用域分组：全局一组，每个项目各一组 */
  const groups = new Map();
  for (const s of servers) {
    const key = s.scope === 'global' ? '__global__' : (s.project_path || s.project || '未知项目');
    if (!groups.has(key)) {
      groups.set(key, { label: s.scope === 'global' ? '全局' : (s.project || key), scope: s.scope, items: [] });
    }
    groups.get(key).items.push(s);
  }

  let html = '';
  for (const g of groups.values()) {
    const pill = g.scope === 'global' ? '~/.claude.json → mcpServers' : escHtml(g.label);
    html += `
    <div class="section" style="margin-top:4px">
      <div class="section-header">
        <span class="section-label">${g.scope === 'global' ? '全局服务器' : '项目：' + escHtml(g.label)}</span>
        <span class="pill">${pill}</span>
      </div>
      <div class="list">${g.items.map(mcpRowHtml).join('')}</div>
    </div>`;
  }
  container.innerHTML = html;
}

/**
 * 生成单个 MCP 服务器卡片的 HTML（含状态点、状态文案、传输徽章、查看配置、重测）
 * @param {Object} s - 单个 McpServer
 * @returns {string} 卡片 HTML
 */
function mcpRowHtml(s) {
  /* 传输类型徽章配色：stdio 绿 / sse 蓝 / http 紫 */
  const tColor = s.transport === 'stdio' ? 'var(--green)' : s.transport === 'http' ? 'var(--accent)' : '#38bdf8';
  const tDesc  = MCP_TRANSPORT_DESC[s.transport] || s.transport;
  /* 主信息行：stdio 显示命令+参数，sse/http 显示 URL */
  const detail = s.transport === 'stdio'
    ? `${escHtml(s.command || '')} ${s.args.map(escHtml).join(' ')}`.trim()
    : escHtml(s.url || '');
  const envNote = s.env_keys.length
    ? `<div class="row-skills-note">环境变量：${s.env_keys.map(escHtml).join(' · ')}</div>`
    : '';
  const rowId = mcpRowId(s);
  const chk   = MCP_STATUS_VIEW.checking;

  return `
  <div class="row" id="${rowId}">
    <span class="mcp-dot" id="${rowId}-dot" title="连接状态"
          style="width:9px;height:9px;border-radius:50%;background:${chk.color};flex-shrink:0;margin-top:6px;transition:background .3s"></span>
    <div style="flex:1;min-width:0">
      <div class="row-name">${escHtml(s.name)}
        <span class="mcp-status" id="${rowId}-status" style="font-size:11px;font-weight:500;color:${chk.color};margin-left:8px">${chk.text}</span>
      </div>
      <div class="row-desc" style="font-family:var(--mono,monospace);font-size:11px">${detail || '<span style="color:var(--text3)">（无命令/地址）</span>'}</div>
      ${envNote}
      <pre class="mcp-raw" id="${rowId}-raw" style="display:none;margin-top:8px;padding:10px;background:var(--bg2,rgba(0,0,0,0.04));border-radius:8px;font-size:11px;line-height:1.5;overflow:auto;white-space:pre-wrap;word-break:break-all">${escHtml(s.raw)}</pre>
    </div>
    <span class="row-tag" title="${escHtml(tDesc)}" style="color:${tColor};border-color:${tColor}">${escHtml(s.transport)}</span>
    <div class="row-actions">
      <button class="btn btn-ghost" onclick="toggleMcpRaw('${rowId}',this)">查看配置</button>
      <button class="btn btn-ghost" onclick="recheckMcp(this,'${rowId}','${escHtml(s.name)}','${s.scope}','${escHtml(s.project_path || '')}')">重测</button>
    </div>
  </div>`;
}

/**
 * 更新某个服务器卡片的连接状态显示
 * @param {string} rowId  - 卡片 id
 * @param {string} status - ok / not_found / error / checking
 * @param {string} detail - 详细说明（作为 tooltip + 异常时附在文案后）
 */
function setMcpStatus(rowId, status, detail) {
  const view = MCP_STATUS_VIEW[status] || MCP_STATUS_VIEW.error;
  const dot = document.getElementById(rowId + '-dot');
  const txt = document.getElementById(rowId + '-status');
  if (dot) { dot.style.background = view.color; dot.title = detail || view.text; }
  if (txt) {
    /* 异常时把原因接在「异常」后面，让用户一眼看到为什么 */
    txt.textContent = status === 'error' && detail ? `${view.text}：${detail}` : view.text;
    txt.style.color = view.color;
    txt.title = detail || '';
  }
}

/**
 * 探测单个服务器并更新其状态
 * @param {Object} s - McpServer
 */
async function probeOne(s) {
  const rowId = mcpRowId(s);
  setMcpStatus(rowId, 'checking', '');
  try {
    const r = await invoke('check_mcp_server', { name: s.name, scope: s.scope, projectPath: s.project_path || null });
    setMcpStatus(rowId, r.status, r.detail);
  } catch (e) {
    setMcpStatus(rowId, 'error', String(e));
  }
}

/**
 * 并发探测所有服务器的连接状态
 * @param {Array} servers
 */
async function checkAllMcp(servers) {
  await Promise.allSettled(servers.map(probeOne));
}

/**
 * 展开 / 收起某个服务器的完整配置
 */
window.toggleMcpRaw = function (rowId, btn) {
  const pre = document.getElementById(rowId + '-raw');
  if (!pre) return;
  const show = pre.style.display === 'none';
  pre.style.display = show ? 'block' : 'none';
  btn.textContent = show ? '收起配置' : '查看配置';
};

/**
 * 单个服务器「重测」：重新探测连接状态
 * 加载效果落在按钮上（禁用 + 文案「测试中…」），不阻塞页面其它操作
 * @param {HTMLElement} btn - 被点击的重测按钮
 */
window.recheckMcp = function (btn, rowId, name, scope, projectPath) {
  /* 按钮进入加载态 */
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '测试中…';
  setMcpStatus(rowId, 'checking', '');

  invoke('check_mcp_server', { name, scope, projectPath: projectPath || null })
    .then(r => setMcpStatus(rowId, r.status, r.detail))
    .catch(e => setMcpStatus(rowId, 'error', String(e)))
    .finally(() => {
      /* 恢复按钮 */
      btn.disabled = false;
      btn.textContent = old;
    });
};
