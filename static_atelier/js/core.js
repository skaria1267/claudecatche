// 公共基础：请求、格式化、图标、弹层、确认框、主题。
export const token = localStorage.getItem('token');

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmt = value => {
  const n = Number(value || 0);
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
};
export const date = value => value ? new Date(Number(value) * 1000).toLocaleString('zh-CN', {hour12: false}) : '—';
export const shortDate = value => {
  if (!value) return '—';
  const d = new Date(Number(value) * 1000), now = new Date();
  const time = d.toLocaleTimeString('zh-CN', {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'});
  return d.toDateString() === now.toDateString() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
};
export const parseModels = raw => {
  if (Array.isArray(raw)) return raw;
  try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value : []; }
  catch (_) { return String(raw || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean); }
};
export const parseRules = raw => { try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
export const lines = value => [...new Set(String(value || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean))];
export const on = value => Number(value) === 1 || value === true || value === '1';
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function logout() { localStorage.removeItem('token'); location.href = '/'; }

export async function api(url, options = {}) {
  const response = await fetch(url, {...options, headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {})}});
  if (response.status === 401) { logout(); throw new Error('登录已失效'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${response.status}`);
  return data;
}
export const post = (url, body) => api(url, {method: 'POST', body: body === undefined ? undefined : JSON.stringify(body)});
export const patch = (url, body) => api(url, {method: 'PATCH', body: JSON.stringify(body)});
export const del = url => api(url, {method: 'DELETE'});

// 线条图标，统一 24 视框、currentColor 描边。
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  route: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3.5 3.5 0 0 1 0 7H9a3.5 3.5 0 0 0 0 7h6.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.3L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4.3L21 15"/><path d="M21 20v-5h-5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5M15 12H3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  filter: '<path d="M4 5h16l-6 8v5l-4 2v-7L4 5z"/>',
  wand: '<path d="M15 4V2M15 10V8M12 5h-2M20 5h-2M18 7.5 19.5 9M18 2.5 19.5 1M3 21l11-11"/>',
};
export const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
export const brandMark = (size = 32) => `<svg class="brand-svg" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="var(--accent)"/><path d="M26.5 13.2A9 9 0 1 0 26.5 26.8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="27.5" cy="20" r="2.6" fill="#fff"/></svg>`;

export function toast(message, error = false) {
  const el = document.getElementById('toast');
  el.innerHTML = `${icon(error ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(el._timer); el._timer = setTimeout(() => el.className = 'toast', error ? 3600 : 2200);
}

export async function copyText(text, label = '已复制') {
  try { await navigator.clipboard.writeText(text); }
  catch (_) {
    const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
  }
  toast(label);
}

// 底部弹层（手机）/ 右侧抽屉（桌面）。关闭时执行 onClose 以停止轮询等后台任务。
const sheetState = {onClose: null};
export function openSheet(html, {wide = false, onClose = null} = {}) {
  const sheet = document.getElementById('sheet');
  sheetState.onClose?.();
  sheetState.onClose = onClose;
  sheet.innerHTML = `<div class="sheet-grip" aria-hidden="true"></div>${html}`;
  sheet.classList.toggle('wide', wide);
  sheet.classList.add('open'); document.getElementById('sheet-backdrop').classList.add('open');
  sheet.setAttribute('aria-hidden', 'false'); document.body.classList.add('locked');
  $$('[data-close]', sheet).forEach(x => x.onclick = closeSheet);
  sheet.scrollTop = 0;
  return sheet;
}
export function closeSheet() {
  const sheet = document.getElementById('sheet');
  sheetState.onClose?.(); sheetState.onClose = null;
  sheet.classList.remove('open'); document.getElementById('sheet-backdrop').classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true'); document.body.classList.remove('locked');
}
export const sheetOpen = () => document.getElementById('sheet').classList.contains('open');
export function sheetHead(eyebrow, title, extra = '') {
  return `<header class="sheet-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2>${extra}</div><button class="icon-btn" type="button" data-close aria-label="关闭">${icon('close')}</button></header>`;
}

// 自绘确认框，替代浏览器 confirm()。
export function confirmDialog({title, message = '', confirmText = '确定', danger = false}) {
  return new Promise(resolve => {
    const root = document.getElementById('dialog');
    root.innerHTML = `<div class="dialog-card" role="alertdialog" aria-modal="true"><div class="dialog-icon ${danger ? 'danger' : ''}">${icon(danger ? 'alert' : 'info')}</div><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}<div class="dialog-actions"><button class="btn" type="button" data-answer="0">取消</button><button class="btn ${danger ? 'danger-solid' : 'primary'}" type="button" data-answer="1">${esc(confirmText)}</button></div></div>`;
    root.classList.add('open');
    const finish = value => { root.classList.remove('open'); root.innerHTML = ''; document.removeEventListener('keydown', key); resolve(value); };
    const key = e => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('keydown', key);
    $$('[data-answer]', root).forEach(b => b.onclick = () => finish(b.dataset.answer === '1'));
    root.onclick = e => { if (e.target === root) finish(false); };
    $('[data-answer="1"]', root).focus();
  });
}

// 按钮执行异步任务时显示忙碌状态，结果写入状态元素或 toast。
export async function busy(button, task, statusEl = null) {
  if (button?.dataset.busy) return;
  if (button) { button.dataset.busy = '1'; button.classList.add('loading'); button.disabled = true; }
  if (statusEl) { statusEl.className = 'hint'; statusEl.textContent = '处理中…'; }
  try {
    const message = await task();
    if (statusEl && message) { statusEl.className = 'hint ok'; statusEl.textContent = message; }
    else if (message) toast(message);
    return true;
  } catch (e) {
    if (statusEl) { statusEl.className = 'hint err'; statusEl.textContent = e.message; } else toast(e.message, true);
    return false;
  } finally {
    if (button) { delete button.dataset.busy; button.classList.remove('loading'); button.disabled = false; }
  }
}

// 主题：localStorage 记录 light / dark，未设置时跟随系统。
export function getThemePref() { try { return localStorage.getItem('theme') || 'system'; } catch (_) { return 'system'; } }
export function setThemePref(value) {
  try { value === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', value); } catch (_) {}
  applyTheme();
}
export function effectiveTheme() {
  const pref = getThemePref();
  return pref === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref;
}
export function applyTheme() {
  const pref = getThemePref();
  if (pref === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', pref);
  const color = effectiveTheme() === 'dark' ? '#0b1220' : '#f4f7fc';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  $$('[data-theme-toggle]').forEach(b => { b.innerHTML = icon(effectiveTheme() === 'dark' ? 'sun' : 'moon'); b.setAttribute('aria-label', effectiveTheme() === 'dark' ? '切换到浅色' : '切换到深色'); });
  document.dispatchEvent(new CustomEvent('themechange'));
}
