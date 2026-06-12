/* ── Toast 通知 & 音效模块 ────────────────────────────────────
 * 提供轻量级消息提示（Toast）和操作音效（Web Audio API）。
 * 依赖：无（独立模块）
 * ──────────────────────────────────────────────────────────────── */

/* 用于清除上一条 Toast 的定时器 */
let toastTimer;

/**
 * 显示一条 Toast 提示消息，2.4 秒后自动消失。
 * @param {string} msg   - 消息内容
 * @param {string} type  - '' | 'success' | 'danger'
 */
function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + (type || '');
  clearTimeout(toastTimer);
  requestAnimationFrame(() => t.classList.add('show'));
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);

  /* 根据类型播放对应音效 */
  if (type === 'success') playSfx('success');
  else if (type === 'danger') playSfx('danger');
}

/**
 * 使用 Web Audio API 合成操作音效，无需加载音频文件。
 * success：三音节上扬提示音
 * danger：两音节下降提示音
 */
function playSfx(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    if (type === 'success') {
      /* 三个递增频率的短音，组成"成功"音效 */
      [[880, 0, 0.06], [1320, 0.07, 0.06], [1760, 0.13, 0.1]].forEach(([freq, when, dur]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.18, ctx.currentTime + when);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + when);
        o.stop(ctx.currentTime + when + dur + 0.01);
      });
    } else {
      /* 两个递减频率的短音，组成"警告"音效 */
      [[440, 0, 0.06], [330, 0.08, 0.12]].forEach(([freq, when, dur]) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.15, ctx.currentTime + when);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + when);
        o.stop(ctx.currentTime + when + dur + 0.01);
      });
    }

    /* 音效完成后释放 AudioContext 避免资源泄漏 */
    setTimeout(() => ctx.close(), 600);
  } catch (e) {
    /* 静默忽略：部分浏览器策略禁止 AudioContext，不应影响主功能 */
  }
}
