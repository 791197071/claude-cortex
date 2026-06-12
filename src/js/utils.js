/* ── 工具函数模块 ──────────────────────────────────────────────
 * 提供全局共享的工具函数和 Tauri invoke API。
 * 此文件必须最先加载，其他所有模块都依赖这里的 invoke。
 * ──────────────────────────────────────────────────────────────── */

/* 解构 Tauri v2 的 invoke 函数，用于调用 Rust 后端命令 */
const { invoke } = window.__TAURI__.core;

/**
 * 格式化 Token 数量为人类可读字符串
 * 例：1500000 → "1.5M"，12345 → "12.3K"
 */
function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/**
 * 格式化字节数为人类可读字符串
 * 例：1536 → "1 KB"，2097152 → "2.0 MB"
 */
function fmtSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024)             return bytes + ' B';
  if (bytes < 1024 * 1024)      return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * HTML 转义，防止 XSS。
 * 在动态拼接 innerHTML 时，所有来自后端/用户的字符串都必须经过此函数。
 */
function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 模型定价表（USD / 1M tokens）
 * 按关键词匹配模型名，未匹配回退到 sonnet 定价
 */
const MODEL_PRICING = [
  { pattern: /opus/i,   input: 15,  output: 75  },
  { pattern: /sonnet/i, input: 3,   output: 15  },
  { pattern: /haiku/i,  input: 0.8, output: 4   },
];

function getModelPricing(model) {
  for (const { pattern, input, output } of MODEL_PRICING) {
    if (pattern.test(model)) return { input, output };
  }
  return { input: 3, output: 15 };
}

/** 格式化美元金额，< $0.01 显示 "< $0.01" */
function fmtCost(usd) {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '< $0.01';
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * 根据记忆类型返回对应的徽章 HTML
 * 支持：feedback / user / project / reference / memory
 */
function memTypeBadge(type) {
  const map = {
    feedback:  ['badge-feedback', 'feedback'],
    user:      ['badge-memory',   'user'],
    project:   ['badge-memory',   'project'],
    reference: ['badge-memory',   'reference'],
    memory:    ['badge-memory',   'memory'],
  };
  const [cls, label] = map[type] || map.memory;
  return `<div class="badge ${cls}"><span class="dot"></span>${label}</div>`;
}
