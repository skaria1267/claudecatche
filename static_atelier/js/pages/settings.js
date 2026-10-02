// 设置：访问密钥、管理员密码、外观和接入指引。
import {api, post, esc, icon, $, $$, toast, busy, confirmDialog, getThemePref, setThemePref, logout, copyText} from '../core.js';
import {card, field, secretInput, bindReveal, copyRow, bindCopy, segmented, bindSegmented, val, accessGuides, guideCard, bindSnippets} from '../ui.js';

const randomKey = () => 'cc-' + [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 32);

export async function settingsPage(ctx) {
  const access = await api('/api/settings/access_key');
  if (!ctx.alive()) return;
  const key = access.value || '';
  const guides = accessGuides(location.origin);
  // 查看与更换分开：平时只显示打码的当前密钥，点「更换」才出现编辑框。
  const keyView = key ? copyRow('当前访问密钥', key, {secret: true}) : '<div class="notice">' + icon('alert') + '<div><strong>尚未设置访问密钥</strong><p>未设置时任何人都能使用这些路由，建议立即设置。</p></div></div>';
  ctx.app.innerHTML = `<div class="page"><header class="page-head"><div><h1>设置</h1><p>管理客户端访问密钥、登录密码、外观和接入方式。</p></div></header>
    <div class="form-page"><div class="col">
      ${card('访问密钥', `<p class="hint">所有路由（Claude 渠道、OpenAI、Codex、Claude Code）的客户端都使用这一把密钥，填在客户端的 API Key 位置。</p>
        ${keyView}
        <div class="row-actions" id="s-access-actions"><button class="btn small" type="button" id="s-access-edit">${icon('key')}${key ? '更换访问密钥' : '设置访问密钥'}</button></div>
        <div class="key-editor" id="s-access-editor" hidden>
          ${field('新的访问密钥', secretInput('s-access', '', '输入或随机生成'))}
          <div class="row-actions wrap"><button class="btn small ghost" type="button" id="s-gen">${icon('wand')}随机生成</button><button class="btn small ghost" type="button" id="s-access-cancel">取消</button><button class="btn small primary" type="button" id="s-access-save">保存新密钥</button></div>
          <p class="hint">保存后旧密钥立即失效，已在使用的客户端需要同步更新。</p>
        </div>`, {iconName: 'key'})}
      ${card('管理员密码', `${field('新密码', secretInput('s-pass', '', '输入新密码', 'autocomplete="new-password"'))}${field('确认新密码', secretInput('s-pass2', '', '再输入一次', 'autocomplete="new-password"'))}
        <div class="row-actions"><button class="btn small primary" type="button" id="s-pass-save">更新密码</button></div><p class="hint">修改后在下次登录时生效。</p>`, {iconName: 'shield'})}
      ${card('外观', field('主题', segmented('s-theme', [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], getThemePref())), {iconName: 'sun'})}
      ${card('', `<div class="row-between"><div><strong>退出登录</strong><p class="hint">退出后需要重新输入管理员密码。</p></div><button class="btn danger" type="button" id="s-logout">${icon('logout')}退出</button></div>`)}
    </div><div class="col" id="guide">
      <div class="section-head"><h2>接入指引</h2><p>复制片段时会自动填入当前访问密钥。</p></div>
      ${['claudecode', 'channels', 'openai', 'codex'].map(k => guideCard(guides[k], key)).join('')}
    </div></div></div>`;
  bindReveal(ctx.app); bindCopy(ctx.app);
  bindSnippets(ctx.app, () => key);
  bindSegmented('s-theme', v => setThemePref(v));
  const editor = $('#s-access-editor'), actions = $('#s-access-actions');
  const toggleEditor = show => { editor.hidden = !show; actions.hidden = show; if (show) $('#s-access').focus(); else $('#s-access').value = ''; };
  $('#s-access-edit').onclick = () => toggleEditor(true);
  $('#s-access-cancel').onclick = () => toggleEditor(false);
  $('#s-gen').onclick = () => { const input = $('#s-access'); input.value = randomKey(); input.type = 'text'; toast('已生成，确认后点「保存新密钥」'); };
  $('#s-access-save').onclick = async e => {
    const value = val('s-access').trim();
    if (!value) { toast('访问密钥不能为空', true); return; }
    if (value === key) { toast('和当前密钥相同，无需保存'); return; }
    if (!await confirmDialog({title: '更换访问密钥？', message: '保存后旧密钥立即失效，所有客户端需要改用新密钥。', confirmText: '保存'})) return;
    busy(e.currentTarget, async () => { await post('/api/settings/access_key', {value}); await copyText(value, '新密钥已保存并复制'); settingsPage(ctx); return ''; });
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
