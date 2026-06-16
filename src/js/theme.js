/* ── 全局主题系统 ────────────────────────────────────────────────
 * 定义 6 套主题色，通过设置 CSS 自定义属性实现无刷新切换。
 * 主题选择持久化到 localStorage。
 * 依赖：无（最早加载）
 * ──────────────────────────────────────────────────────────────── */

const THEMES = {
  white: {
    label: '磨砂白',
    preview: ['#f5f5f7', '#e5e5ea'],
    vars: {
      '--accent':      '#007aff',
      '--accent2':     '#34aadc',
      '--accent-dark': '#0062cc',
      '--accent-rgb':  '0,122,255',
      '--accent2-rgb': '52,170,220',
      '--accent-soft': 'rgba(0,122,255,0.08)',
      '--bg':          'rgba(248,248,250,0.90)',
      '--bg-gradient': [
        'radial-gradient(ellipse 70% 60% at 18% 14%, rgba(255,255,255,0.55) 0%, transparent 62%)',
        'radial-gradient(ellipse 60% 50% at 84% 10%, rgba(210,220,255,0.30) 0%, transparent 62%)',
        'radial-gradient(ellipse 65% 55% at 86% 86%, rgba(255,255,255,0.45) 0%, transparent 62%)',
        'radial-gradient(ellipse 55% 45% at 14% 82%, rgba(220,225,245,0.28) 0%, transparent 62%)',
        'radial-gradient(ellipse 45% 35% at 50% 50%, rgba(255,255,255,0.30) 0%, transparent 58%)',
      ].join(','),
    },
  },

  sky: {
    label: '天蓝',
    preview: ['#0ea5e9', '#38bdf8'],
    vars: {
      '--accent':      '#0ea5e9',
      '--accent2':     '#38bdf8',
      '--accent-dark': '#0284c7',
      '--accent-rgb':  '14,165,233',
      '--accent2-rgb': '56,189,248',
      '--accent-soft': 'rgba(14,165,233,0.10)',
      '--bg':          '#f0f9ff',
      '--bg-gradient': [
        'radial-gradient(ellipse 55% 45% at  8% 12%, rgba(14,165,233,0.40)  0%, transparent 70%)',
        'radial-gradient(ellipse 50% 38% at 88%  8%, rgba(99,102,241,0.25)  0%, transparent 70%)',
        'radial-gradient(ellipse 52% 40% at 85% 88%, rgba(56,189,248,0.28)  0%, transparent 70%)',
        'radial-gradient(ellipse 48% 36% at 12% 85%, rgba(167,139,250,0.22) 0%, transparent 70%)',
        'radial-gradient(ellipse 40% 30% at 50% 48%, rgba(14,165,233,0.16)  0%, transparent 65%)',
      ].join(','),
    },
  },

  teal: {
    label: '青绿',
    preview: ['#0d9488', '#2dd4bf'],
    vars: {
      '--accent':      '#0d9488',
      '--accent2':     '#2dd4bf',
      '--accent-dark': '#0f766e',
      '--accent-rgb':  '13,148,136',
      '--accent2-rgb': '45,212,191',
      '--accent-soft': 'rgba(13,148,136,0.10)',
      '--bg':          '#f0fdfa',
      '--bg-gradient': [
        'radial-gradient(ellipse 55% 45% at  8% 12%, rgba(20,184,166,0.38)  0%, transparent 70%)',
        'radial-gradient(ellipse 50% 38% at 88%  8%, rgba(6,182,212,0.28)   0%, transparent 70%)',
        'radial-gradient(ellipse 52% 40% at 85% 88%, rgba(52,211,153,0.30)  0%, transparent 70%)',
        'radial-gradient(ellipse 48% 36% at 12% 85%, rgba(96,165,250,0.22)  0%, transparent 70%)',
        'radial-gradient(ellipse 40% 30% at 50% 48%, rgba(13,148,136,0.16)  0%, transparent 65%)',
      ].join(','),
    },
  },

  violet: {
    label: '紫罗兰',
    preview: ['#7c3aed', '#a78bfa'],
    vars: {
      '--accent':      '#7c3aed',
      '--accent2':     '#a78bfa',
      '--accent-dark': '#6d28d9',
      '--accent-rgb':  '124,58,237',
      '--accent2-rgb': '167,139,250',
      '--accent-soft': 'rgba(124,58,237,0.10)',
      '--bg':          '#faf5ff',
      '--bg-gradient': [
        'radial-gradient(ellipse 55% 45% at  8% 12%, rgba(124,58,237,0.35)  0%, transparent 70%)',
        'radial-gradient(ellipse 50% 38% at 88%  8%, rgba(236,72,153,0.22)  0%, transparent 70%)',
        'radial-gradient(ellipse 52% 40% at 85% 88%, rgba(167,139,250,0.28) 0%, transparent 70%)',
        'radial-gradient(ellipse 48% 36% at 12% 85%, rgba(99,102,241,0.22)  0%, transparent 70%)',
        'radial-gradient(ellipse 40% 30% at 50% 48%, rgba(124,58,237,0.14)  0%, transparent 65%)',
      ].join(','),
    },
  },

  rose: {
    label: '玫瑰',
    preview: ['#f43f5e', '#fb7185'],
    vars: {
      '--accent':      '#f43f5e',
      '--accent2':     '#fb7185',
      '--accent-dark': '#e11d48',
      '--accent-rgb':  '244,63,94',
      '--accent2-rgb': '251,113,133',
      '--accent-soft': 'rgba(244,63,94,0.10)',
      '--bg':          '#fff1f2',
      '--bg-gradient': [
        'radial-gradient(ellipse 55% 45% at  8% 12%, rgba(244,63,94,0.32)   0%, transparent 70%)',
        'radial-gradient(ellipse 50% 38% at 88%  8%, rgba(251,146,60,0.22)  0%, transparent 70%)',
        'radial-gradient(ellipse 52% 40% at 85% 88%, rgba(251,113,133,0.26) 0%, transparent 70%)',
        'radial-gradient(ellipse 48% 36% at 12% 85%, rgba(236,72,153,0.20)  0%, transparent 70%)',
        'radial-gradient(ellipse 40% 30% at 50% 48%, rgba(244,63,94,0.14)   0%, transparent 65%)',
      ].join(','),
    },
  },

  amber: {
    label: '琥珀',
    preview: ['#f59e0b', '#fbbf24'],
    vars: {
      '--accent':      '#f59e0b',
      '--accent2':     '#fbbf24',
      '--accent-dark': '#d97706',
      '--accent-rgb':  '245,158,11',
      '--accent2-rgb': '251,191,36',
      '--accent-soft': 'rgba(245,158,11,0.10)',
      '--bg':          '#fffbeb',
      '--bg-gradient': [
        'radial-gradient(ellipse 55% 45% at  8% 12%, rgba(245,158,11,0.32)  0%, transparent 70%)',
        'radial-gradient(ellipse 50% 38% at 88%  8%, rgba(251,146,60,0.24)  0%, transparent 70%)',
        'radial-gradient(ellipse 52% 40% at 85% 88%, rgba(251,191,36,0.28)  0%, transparent 70%)',
        'radial-gradient(ellipse 48% 36% at 12% 85%, rgba(20,184,166,0.18)  0%, transparent 70%)',
        'radial-gradient(ellipse 40% 30% at 50% 48%, rgba(245,158,11,0.14)  0%, transparent 65%)',
      ].join(','),
    },
  },

  emerald: {
    label: '翡翠',
    preview: ['#10b981', '#34d399'],
    vars: {
      '--accent':      '#10b981',
      '--accent2':     '#34d399',
      '--accent-dark': '#059669',
      '--accent-rgb':  '16,185,129',
      '--accent2-rgb': '52,211,153',
      '--accent-soft': 'rgba(16,185,129,0.10)',
      '--bg':          '#f0fdf4',
      '--bg-gradient': [
        'radial-gradient(ellipse 55% 45% at  8% 12%, rgba(16,185,129,0.36)  0%, transparent 70%)',
        'radial-gradient(ellipse 50% 38% at 88%  8%, rgba(6,182,212,0.24)   0%, transparent 70%)',
        'radial-gradient(ellipse 52% 40% at 85% 88%, rgba(52,211,153,0.28)  0%, transparent 70%)',
        'radial-gradient(ellipse 48% 36% at 12% 85%, rgba(96,165,250,0.20)  0%, transparent 70%)',
        'radial-gradient(ellipse 40% 30% at 50% 48%, rgba(16,185,129,0.14)  0%, transparent 65%)',
      ].join(','),
    },
  },
};

const THEME_LS_KEY = 'cortex_theme_v1';

/** 将主题变量写入 :root */
function applyTheme(name) {
  const theme = THEMES[name] || THEMES.white;
  const root  = document.documentElement;
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  localStorage.setItem(THEME_LS_KEY, name);

  // 同步设置页 UI（如果已渲染）
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === name);
  });
}

/** 从 localStorage 恢复主题，启动时调用 */
function initTheme() {
  const saved = localStorage.getItem(THEME_LS_KEY) || 'white';
  applyTheme(saved);
}

/** 渲染主题色选择器到指定容器 */
function renderThemePicker(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Object.entries(THEMES).map(([key, t]) => `
    <button class="theme-swatch${localStorage.getItem(THEME_LS_KEY) === key || (!localStorage.getItem(THEME_LS_KEY) && key === 'white') ? ' active' : ''}"
            data-theme="${key}"
            title="${t.label}"
            onclick="applyTheme('${key}')">
      <span class="theme-swatch-dot" style="background:linear-gradient(135deg,${t.preview[0]},${t.preview[1]})"></span>
      <span class="theme-swatch-label">${t.label}</span>
    </button>
  `).join('');
}

// 暴露给全局
window.applyTheme      = applyTheme;
window.initTheme       = initTheme;
window.renderThemePicker = renderThemePicker;

// 立即执行（CSS 加载后同步应用，避免闪烁）
initTheme();
