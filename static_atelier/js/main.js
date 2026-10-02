// 页面壳与前端路由。所有 /dashboard、/page/* 地址都由后端返回同一个 app.html。
import {token, icon, brandMark, esc, $, $$, toast, closeSheet, requestCloseSheet, sheetOpen, sheetDirty, confirmDialog, applyTheme, effectiveTheme, setThemePref, logout} from './core.js';
import {hasUnsaved, clearForm} from './ui.js';
import {overviewPage} from './pages/overview.js';
import {routesPage} from './pages/routes.js';
import {logsPage} from './pages/logs.js';
import {settingsPage} from './pages/settings.js';

if (!token) location.href = '/';
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

const ROUTE_TABS = [
  ['/page/channels', 'Claude 渠道'], ['/page/openai', 'OpenAI'],
  ['/page/codex', 'Codex'], ['/page/claudecode', 'Claude Code'],
];
const SECTIONS = [
  {key: 'overview', label: '总览', icon: 'home', href: '/dashboard'},
  {key: 'routes', label: '路由', icon: 'route', href: '/page/channels'},
  {key: 'logs', label: '日志', icon: 'list', href: '/page/logs'},
  {key: 'settings', label: '设置', icon: 'settings', href: '/page/settings'},
];
const PAGES = {
  '/dashboard': {section: 'overview', render: overviewPage},
  '/page/channels': {section: 'routes', render: ctx => routesPage(ctx, 'channels')},
  '/page/openai': {section: 'routes', render: ctx => routesPage(ctx, 'openai')},
  '/page/codex': {section: 'routes', render: ctx => routesPage(ctx, 'codex')},
  '/page/claudecode': {section: 'routes', render: ctx => routesPage(ctx, 'claudecode')},
  '/page/logs': {section: 'logs', render: ctx => logsPage(ctx, 'main', 'requests')},
  '/page/codex-logs': {section: 'logs', render: ctx => logsPage(ctx, 'codex', 'requests')},
  '/page/claudecode-logs': {section: 'logs', render: ctx => logsPage(ctx, 'claudecode', 'requests')},
  '/page/usage': {section: 'logs', render: ctx => logsPage(ctx, 'main', 'usage')},
  '/page/settings': {section: 'settings', render: settingsPage},
};

function shell() {
  const navLink = s => `<a class="nav-link" data-section="${s.key}" href="${s.href}">${icon(s.icon)}<span>${s.label}</span></a>`;
  $('#sidebar').innerHTML = `<a class="brand" href="/dashboard">${brandMark(34)}<span><b>Claude Catche</b><small>AI 接口中转站</small></span></a>
    <nav class="side-nav" aria-label="主导航">${SECTIONS.map(s => navLink(s) + (s.key === 'routes' ? `<div class="sub-nav">${ROUTE_TABS.map(([href, label]) => `<a class="sub-link" data-path="${href}" href="${href}">${label}</a>`).join('')}</div>` : '')).join('')}</nav>
    <div class="side-foot"><button class="nav-link" type="button" data-theme-toggle-full>${icon('moon')}<span>切换主题</span></button><button class="nav-link" type="button" data-logout>${icon('logout')}<span>退出登录</span></button></div>`;
  $('#topbar').innerHTML = `<a class="brand" href="/dashboard">${brandMark(30)}<span><b>Claude Catche</b></span></a><div class="topbar-actions"><button class="icon-btn" type="button" data-theme-toggle aria-label="切换主题"></button></div>`;
  $('#tabbar').innerHTML = SECTIONS.map(s => `<a class="tab" data-section="${s.key}" href="${s.href}">${icon(s.icon)}<span>${s.label}</span></a>`).join('');
  const toggle = () => setThemePref(effectiveTheme() === 'dark' ? 'light' : 'dark');
  $$('[data-theme-toggle], [data-theme-toggle-full]').forEach(b => b.onclick = toggle);
  document.addEventListener('themechange', () => { const b = $('[data-theme-toggle-full]'); if (b) b.innerHTML = `${icon(effectiveTheme() === 'dark' ? 'sun' : 'moon')}<span>${effectiveTheme() === 'dark' ? '浅色模式' : '深色模式'}</span>`; });
  $('[data-logout]').onclick = async () => { if (await confirmDialog({title: '退出登录？', confirmText: '退出'})) logout(); };
  $('#sheet-backdrop').onclick = requestCloseSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen() && !$('#dialog').classList.contains('open')) requestCloseSheet(); });
  applyTheme();
}

// 拦截站内链接，用 pushState 切换页面，避免整页刷新。
document.addEventListener('click', async e => {
  const link = e.target.closest('a[href]');
  if (!link || link.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || !PAGES[url.pathname]) return;
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});
window.addEventListener('popstate', () => render());
window.addEventListener('beforeunload', e => { if (hasUnsaved() || sheetDirty()) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('reload-page', () => render());

export async function navigate(url, {replace = false} = {}) {
  if ((hasUnsaved() || sheetDirty()) && !await confirmDialog({title: '放弃未保存的修改？', message: '离开后，尚未保存的配置会丢失。', confirmText: '放弃并离开', danger: true})) return;
  clearForm();
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  render();
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const path = location.pathname;
  const page = PAGES[path] || PAGES['/dashboard'];
  closeSheet(); clearForm();
  $$('[data-section]').forEach(a => a.classList.toggle('active', a.dataset.section === page.section));
  $$('.sub-link').forEach(a => a.classList.toggle('active', a.dataset.path === path));
  const app = $('#app');
  app.innerHTML = '<div class="page"><div class="skeleton"><i></i><i></i><i></i></div></div>';
  window.scrollTo(0, 0);
  const ctx = {app, path, params: new URLSearchParams(location.search), hash: location.hash.slice(1), navigate, routeTabs: ROUTE_TABS, alive: () => seq === renderSeq};
  try { await page.render(ctx); }
  catch (e) {
    if (seq !== renderSeq) return;
    app.innerHTML = `<div class="page"><div class="empty"><span class="empty-ico">${icon('alert')}</span><strong>页面加载失败</strong><p>${esc(e.message)}</p><button class="btn" type="button" id="retry">${icon('refresh')}重试</button></div></div>`;
    $('#retry').onclick = () => render();
    toast(e.message, true);
  }
}

shell();
render();
