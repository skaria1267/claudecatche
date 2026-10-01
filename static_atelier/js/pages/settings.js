// 设置：访问密钥、管理员密码、外观和接入指引。
import {api, post, esc, icon, $, $$, toast, busy, confirmDialog, getThemePref, setThemePref, logout, copyText} from '../core.js';
import {card, field, secretInput, bindReveal, copyRow, bindCopy, segmented, bindSegmented, val} from '../ui.js';

const randomKey = () => 'cc-' + [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 32);

export async function settingsPage(ctx) {
  const access = await api('/api/settings/access_key');
  if (!ctx.alive()) return;
  const origin = location.origin;
  const key = access.value || '';
  // 片段中显示占位符，复制时自动换成真实访问密钥。
  const guides = [
    {title: 'Claude Code（订阅账号）', iconName: 'bolt', desc: '在终端设置环境变量后启动 claude。', url: `${origin}/claudecode`,
      snippet: `export ANTHROPIC_BASE_URL="${origin}/claudecode"\nexport ANTHROPIC_AUTH_TOKEN="{KEY}"`},
    {title: 'Claude 渠道', iconName: 'layers', desc: '把 &lt;渠道名&gt; 换成「路由 → Claude 渠道」里的名称。Claude Code 也用这种写法。', url: `${origin}/<渠道名>/v1`,
      snippet: `export ANTHROPIC_BASE_URL="${origin}/<渠道名>"\nexport ANTHROPIC_AUTH_TOKEN="{KEY}"`},
    {title: 'OpenAI 兼容客户端', iconName: 'sparkle', desc: 'Cherry Studio、Chatbox 等选择 OpenAI 类型，填写下面的地址和密钥。', url: `${origin}/gpt/v1`,
      snippet: `Base URL: ${origin}/gpt/v1\nAPI Key: {KEY}`},
    {title: 'Codex（订阅账号）', iconName: 'terminal', desc: '支持 /chat/completions 和 /responses。Codex CLI 可在 ~/.codex/config.toml 中添加：', url: `${origin}/codex/v1`,
      snippet: `[model_providers.catche]\nname = "Claude Catche"\nbase_url = "${origin}/codex/v1"\nenv_key = "CATCHE_KEY"\nwire_api = "responses"\n\n# 终端中：export CATCHE_KEY="{KEY}"`},
  ];
  ctx.app.innerHTML = `<div class="page"><header class="page-head"><div><h1>设置</h1><p>管理客户端访问密钥、登录密码、外观和接入方式。</p></div></header>
    <div class="form-page"><div class="col">
      ${card('访问密钥', `<p class="hint">所有路由（Claude 渠道、OpenAI、Codex、Claude Code）的客户端都使用这一把密钥，填在客户端的 API Key 位置。</p>
        ${field('新的访问密钥', secretInput('s-access', key, '输入访问密钥'))}
        <div class="row-actions wrap"><button class="btn small ghost" type="button" id="s-gen">${icon('wand')}随机生成</button><button class="btn small" type="button" id="s-copy">${icon('copy')}复制</button><button class="btn small primary" type="button" id="s-access-save">保存访问密钥</button></div>
        <p class="hint">修改后，已在使用旧密钥的客户端需要同步更新。</p>`, {iconName: 'key'})}
      ${card('管理员密码', `${field('新密码', secretInput('s-pass', '', '输入新密码', 'autocomplete="new-password"'))}${field('确认新密码', secretInput('s-pass2', '', '再输入一次', 'autocomplete="new-password"'))}
        <div class="row-actions"><button class="btn small primary" type="button" id="s-pass-save">更新密码</button></div><p class="hint">修改后在下次登录时生效。</p>`, {iconName: 'shield'})}
      ${card('外观', field('主题', segmented('s-theme', [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], getThemePref())), {iconName: 'sun'})}
      ${card('', `<div class="row-between"><div><strong>退出登录</strong><p class="hint">退出后需要重新输入管理员密码。</p></div><button class="btn danger" type="button" id="s-logout">${icon('logout')}退出</button></div>`)}
    </div><div class="col" id="guide">
      <div class="section-head"><h2>接入指引</h2><p>复制片段时会自动填入当前访问密钥。</p></div>
      ${guides.map((g, i) => card(g.title, `<p class="hint">${g.desc}</p>${copyRow('接入地址', g.url)}<div class="snippet"><pre>${esc(g.snippet.replace('{KEY}', '<访问密钥>'))}</pre><button class="icon-btn" type="button" data-snippet="${i}" aria-label="复制配置片段">${icon('copy')}</button></div>`, {iconName: g.iconName})).join('')}
    </div></div></div>`;
  bindReveal(ctx.app); bindCopy(ctx.app);
  bindSegmented('s-theme', v => setThemePref(v));
  $$('[data-snippet]').forEach(b => b.onclick = () => copyText(guides[Number(b.dataset.snippet)].snippet.replace('{KEY}', val('s-access').trim() || key), '配置片段已复制'));
  $('#s-gen').onclick = () => { const input = $('#s-access'); input.value = randomKey(); input.type = 'text'; toast('已生成，记得点保存'); };
  $('#s-copy').onclick = () => copyText(val('s-access'), '访问密钥已复制');
  $('#s-access-save').onclick = async e => {
    const value = val('s-access').trim();
    if (!value) { toast('访问密钥不能为空', true); return; }
    if (value === key) { toast('访问密钥没有变化'); return; }
    if (!await confirmDialog({title: '更换访问密钥？', message: '保存后旧密钥立即失效，所有客户端需要改用新密钥。', confirmText: '保存'})) return;
    busy(e.currentTarget, async () => { await post('/api/settings/access_key', {value}); settingsPage(ctx); return '访问密钥已保存'; });
  };
  $('#s-pass-save').onclick = e => busy(e.currentTarget, async () => {
    const value = val('s-pass');
    if (!value) throw new Error('请输入新密码');
    if (value !== val('s-pass2')) throw new Error('两次输入的密码不一致');
    await post('/api/settings/admin_password', {value});
    $('#s-pass').value = ''; $('#s-pass2').value = '';
    return '管理员密码已更新';
  });
  $('#s-logout').onclick = async () => { if (await confirmDialog({title: '退出登录？', confirmText: '退出'})) logout(); };
  if (ctx.hash === 'guide') $('#guide').scrollIntoView({block: 'start'});
}
