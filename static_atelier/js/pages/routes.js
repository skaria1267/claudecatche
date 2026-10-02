// 路由页：Claude 渠道 / OpenAI / Codex / Claude Code 四个分区。
// 规则：列表与标题栏上的开关点击即生效；弹层和表单里的其他内容一律显式保存。
import {api, post, patch, del, esc, icon, fmt, date, parseModels, parseRules, on, $, $$, toast, busy, openSheet, closeSheet, sheetHead, confirmDialog} from '../core.js';
import {pill, field, card, empty, val, isChecked, toggleRow, switchControl, segmented, bindSegmented, segValue, secretInput, bindReveal, copyRow, bindCopy, modelEditor, bindModelEditor, getModels, rulesEditor, bindRulesEditor, getRules, proxyInput, bindProxyTest, quotaBars, quotaWindows, watchForm, endpointRows, accessGuides, guideCard, bindSnippets} from '../ui.js';

const TITLES = {
  channels: ['Claude 渠道', '接入第三方 Claude 兼容 API，每个渠道一个独立地址。'],
  openai: ['OpenAI', '转发到 OpenAI 官方 API，官方 Key 只保存在服务器。'],
  codex: ['Codex', 'ChatGPT 订阅账号转 API，多账号自动轮换。'],
  claudecode: ['Claude Code', 'Claude 订阅账号转 API，多账号自动轮换。'],
};
const USAGE_LINK = {channels: '/page/usage', openai: '/page/usage', codex: '/page/codex-logs?view=usage', claudecode: '/page/claudecode-logs?view=usage'};

// 标题栏：手机端顶部保留路由切换胶囊（桌面端由侧边栏负责），右侧放用量入口和总开关。
function head(ctx, kind, side = '') {
  const [title, desc] = TITLES[kind];
  return `<nav class="route-tabs route-switch" aria-label="选择路由">${ctx.routeTabs.map(([href, label]) => `<a href="${href}" class="${href === ctx.path ? 'active' : ''}">${label}</a>`).join('')}</nav>
    <header class="route-head"><div class="route-head-main"><div class="route-head-title"><h1>${title}</h1><span id="route-state"></span></div><p>${desc}</p></div>
    <div class="route-head-side"><a class="btn small ghost" href="${USAGE_LINK[kind]}">${icon('chart')}查看用量</a>${side}</div></header>`;
}
const headSwitch = (id, checked, label) => `<div class="head-switch"><span>${esc(label)}</span>${switchControl(id, checked, label)}</div>`;
const setState = (tone, text) => { const el = $('#route-state'); if (el) el.innerHTML = pill(tone, text); };

// 页内标签：写进 ?tab=，切换时由前端路由检查未保存修改。
function pageTabs(ctx, tabs, current) {
  return `<nav class="page-tabs" aria-label="页面分区">${tabs.map(([key, label, badge = '', tone = '']) => `<a href="${ctx.path}${key === tabs[0][0] ? '' : `?tab=${key}`}" class="${key === current ? 'active' : ''}" ${key === current ? 'aria-current="page"' : ''}>${esc(label)}${badge !== '' ? `<span class="tab-badge ${tone}">${esc(badge)}</span>` : ''}</a>`).join('')}</nav>`;
}

// 开关：点击即保存，失败时回滚。
function instantSwitch(id, save, labels = ['已启用', '已停用']) {
  const input = document.getElementById(id);
  if (!input) return;
  input.onchange = async () => {
    const value = input.checked ? 1 : 0;
    input.disabled = true;
    try { await save(value); toast(value ? labels[0] : labels[1]); }
    catch (e) { input.checked = !value; toast(e.message, true); }
    finally { input.disabled = false; }
  };
}

export async function routesPage(ctx, kind) {
  if (kind === 'channels') return channelsView(ctx);
  if (kind === 'openai') return openaiView(ctx);
  return subscriptionView(ctx, kind);
}

/* ---------------- Claude 渠道 ---------------- */

const CACHE_LABELS = {off: '关闭', auto: '自动', rules: '手动断点', explicit: '手动断点', implicit: '自动（OpenAI 隐式）', client: '跟随客户端'};
const cacheOptions = keys => keys.map(k => [k, CACHE_LABELS[k]]);

async function channelsView(ctx) {
  const list = await api('/api/channels');
  if (!ctx.alive()) return;
  const origin = location.origin;
  ctx.app.innerHTML = `<div class="page">${head(ctx, 'channels', `<button class="btn small primary" type="button" id="ch-add">${icon('plus')}新建渠道</button>`)}
    ${list.length ? `<div class="notice info">${icon('info')}<div><p>客户端地址是「${esc(origin)}/渠道名/v1」，每个渠道右侧的复制按钮可直接复制。Claude Code CLI 的 ANTHROPIC_BASE_URL 不带 /v1，打开渠道可复制两种写法。</p></div></div>
      <div class="toolbar"><label class="search">${icon('search')}<input id="ch-search" placeholder="搜索渠道名称或上游地址" type="search"></label></div>` : ''}
    <div class="item-list" id="ch-list"></div></div>`;
  const paintState = () => { const n = list.filter(c => on(c.is_active)).length; setState(!list.length ? 'idle' : n ? 'ok' : 'idle', !list.length ? '未配置' : n ? `运行中 · ${n}/${list.length} 启用` : '全部停用'); };
  const render = items => {
    const root = $('#ch-list');
    paintState();
    if (!list.length) { root.innerHTML = empty('layers', '还没有渠道', '渠道就是一个上游 Claude API。添加后，客户端用「地址/渠道名」访问它。', `<button class="btn primary" type="button" data-new>${icon('plus')}新建第一个渠道</button>`); $('[data-new]', root).onclick = () => channelSheet(ctx); return; }
    root.innerHTML = items.length ? items.map(c => `<article class="item" data-id="${c.id}" tabindex="0">
      <div class="item-main"><div class="item-title"><strong>${esc(c.name)}</strong>${on(c.is_active) ? pill('ok', '启用') : pill('idle', '停用')}</div>
        <p class="item-sub mono">${esc(c.base_url)}</p>
        <div class="meta-line"><span class="meta-item">${parseModels(c.models).length} 个模型</span><span class="meta-item">缓存 ${on(c.cache_enabled) ? CACHE_LABELS[c.cache_mode === 'rules' ? 'rules' : 'auto'] : '关闭'}</span><span class="meta-item">${c.proxy_url ? '走代理' : '直连'}</span>${on(c.thinking_alias) ? '<span class="meta-item">思考后缀</span>' : ''}${on(c.or_routing) ? '<span class="meta-item">供应商路由</span>' : ''}</div></div>
      <div class="item-side" data-stop><button class="icon-btn ghost" type="button" data-copy="${esc(`${origin}/${c.name}/v1`)}" aria-label="复制 ${esc(c.name)} 的客户端地址" title="复制客户端地址">${icon('copy')}</button>${switchControl(`ch-on-${c.id}`, on(c.is_active), `启用 ${c.name}`)}</div>
      <span class="item-chevron">${icon('chevron')}</span></article>`).join('') : empty('search', '没有匹配的渠道', '换一个关键词试试。');
    $$('.item', root).forEach(el => {
      const open = () => channelSheet(ctx, Number(el.dataset.id));
      el.onclick = e => { if (!e.target.closest('[data-stop]')) open(); };
      el.onkeydown = e => { if (e.key === 'Enter' && e.target === el) open(); };
    });
    bindCopy(root);
    items.forEach(c => instantSwitch(`ch-on-${c.id}`, async v => { await patch(`/api/channels/${c.id}`, {is_active: v}); c.is_active = v; render(filtered()); }, ['渠道已启用', '渠道已停用']));
  };
  const filtered = () => { const q = ($('#ch-search')?.value || '').toLowerCase(); return list.filter(c => `${c.name} ${c.base_url}`.toLowerCase().includes(q)); };
  render(list);
  if ($('#ch-search')) $('#ch-search').oninput = () => render(filtered());
  $('#ch-add').onclick = () => channelSheet(ctx);
  const hashId = Number(ctx.hash);
  if (hashId) { history.replaceState(null, '', ctx.path); channelSheet(ctx, hashId); }
}

const CHANNEL_DEFAULT = {name: '', base_url: '', api_key: '', auth_mode: 'both', models: '[]', cache_enabled: 1, cache_mode: 'auto', cache_ttl: '5m', cache_rules: '[]', or_routing: 0, or_providers: 'anthropic,google-vertex,amazon-bedrock', thinking_alias: 0, proxy_url: '', is_active: 1};

async function channelSheet(ctx, id = null) {
  const c = id ? await api(`/api/channels/${id}`) : {...CHANNEL_DEFAULT};
  const cacheMode = on(c.cache_enabled) ? (c.cache_mode === 'rules' ? 'rules' : 'auto') : 'off';
  const origin = location.origin;
  // 新建时「启用」随表单保存；编辑时与列表一致，开关立即生效。
  const activeRow = id
    ? `<div data-no-dirty>${toggleRow('c-active', '启用渠道', '开关立即生效。停用后，这个渠道不再接受请求。', on(c.is_active))}</div>`
    : toggleRow('c-active', '创建后立即启用', '关闭则创建为停用状态。', on(c.is_active));
  const sheet = openSheet(`${sheetHead(id ? '编辑渠道' : '新建渠道', id ? c.name : '新建渠道')}
    <div class="sheet-body" data-guard>
      ${id ? `<section class="form-section" data-no-dirty><h4>客户端地址</h4>${endpointRows(`${origin}/${c.name}`)}<p class="hint">修改渠道名称并保存后，地址会随之变化。</p></section>` : ''}
      <section class="form-section"><h4>基本信息</h4><div class="grid-2">
        ${field('渠道名称', `<input id="c-name" value="${esc(c.name)}" placeholder="例如 openrouter" autocomplete="off" spellcheck="false">`, '客户端地址会用到它：<code id="c-endpoint"></code>')}
        ${field('认证方式', segmented('c-auth', [['both', '双认证头'], ['x', 'x-api-key'], ['a', 'Bearer']], c.auth_mode || 'both'), '不确定时选「双认证头」。')}
        ${field('上游地址', `<input id="c-url" value="${esc(c.base_url)}" placeholder="https://example.com/v1" inputmode="url" autocomplete="off" spellcheck="false">`, '', 'span-2')}
        ${field('上游 API Key', secretInput('c-key', c.api_key, 'sk-...'), '', 'span-2')}
      </div>${activeRow}</section>
      <section class="form-section"><h4>模型</h4>${modelEditor('c-models', parseModels(c.models), {fetchLabel: '从上游拉取'})}</section>
      <section class="form-section"><h4>网络</h4>${proxyInput('c-proxy', c.proxy_url)}</section>
      <section class="form-section"><h4>提示词缓存</h4>
        ${field('缓存方式', segmented('c-cache', cacheOptions(['off', 'auto', 'rules']), cacheMode), '自动：由中转站在合适位置打缓存标记，适合大多数情况。')}
        <div id="c-cache-more" ${cacheMode === 'off' ? 'hidden' : ''}>${field('缓存时长', segmented('c-ttl', [['5m', '5 分钟'], ['1h', '1 小时']], c.cache_ttl || '5m', {small: true}))}
        <div id="c-rules-wrap" ${cacheMode === 'rules' ? '' : 'hidden'}>${rulesEditor('c-rules', parseRules(c.cache_rules), true)}</div></div>
      </section>
      <details class="form-section advanced" ${on(c.or_routing) || on(c.thinking_alias) ? 'open' : ''}><summary><h4>高级选项</h4>${icon('chevron')}</summary>
        ${toggleRow('c-thinking', '思考模型后缀', '识别模型名末尾的 -thinking 或 -thinking-high 等，自动开启思考并设置强度。', on(c.thinking_alias))}
        ${toggleRow('c-or', 'OpenRouter 供应商后缀', '为模型生成「模型@供应商」别名，用于指定 OpenRouter 的供应商。', on(c.or_routing))}
        ${field('供应商清单', `<input id="c-providers" value="${esc(c.or_providers || '')}" spellcheck="false">`, '逗号分隔。')}
      </details>
    </div>
    <footer class="sheet-foot">${id ? `<button class="btn danger" type="button" id="c-delete">${icon('trash')}删除</button>` : '<span></span>'}<div class="row-actions"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="button" id="c-save">${id ? '保存' : '创建渠道'}</button></div></footer>`, {guard: true});
  const endpoint = () => { $('#c-endpoint').textContent = `${origin}/${val('c-name').trim() || '渠道名'}/v1`; };
  $('#c-name').oninput = endpoint; endpoint();
  bindSegmented('c-auth'); bindSegmented('c-ttl'); bindReveal(sheet); bindCopy(sheet);
  bindSegmented('c-cache', v => { $('#c-cache-more').hidden = v === 'off'; $('#c-rules-wrap').hidden = v !== 'rules'; });
  bindRulesEditor('c-rules');
  bindModelEditor('c-models', {onFetch: async () => (await post('/api/channels/fetch-models', {base_url: val('c-url').trim(), api_key: val('c-key').trim(), auth_mode: segValue('c-auth'), proxy_url: val('c-proxy').trim()})).models});
  bindProxyTest('c-proxy', () => val('c-url').trim());
  if (id) instantSwitch('c-active', async v => { await patch(`/api/channels/${id}`, {is_active: v}); c.is_active = v; refreshChannels(ctx); }, ['渠道已启用', '渠道已停用']);
  $('#c-save').onclick = e => busy(e.currentTarget, async () => {
    const mode = segValue('c-cache');
    const payload = {name: val('c-name').trim(), base_url: val('c-url').trim(), api_key: val('c-key').trim(), auth_mode: segValue('c-auth'), models: JSON.stringify(getModels('c-models')), cache_enabled: mode === 'off' ? 0 : 1, cache_mode: mode === 'rules' ? 'rules' : 'auto', cache_ttl: segValue('c-ttl'), cache_rules: JSON.stringify(mode === 'rules' ? getRules('c-rules') : []), or_routing: isChecked('c-or'), or_providers: val('c-providers').trim(), thinking_alias: isChecked('c-thinking'), proxy_url: val('c-proxy').trim()};
    if (!payload.name || !payload.base_url || !payload.api_key) throw new Error('请填写渠道名称、上游地址和 API Key');
    if (id) await patch(`/api/channels/${id}`, payload);
    else {
      await post('/api/channels', payload);
      // 创建接口不接受 is_active，需要停用时按名称找到新渠道再更新。
      if (!isChecked('c-active')) { const made = (await api('/api/channels')).find(x => x.name === payload.name); if (made) await patch(`/api/channels/${made.id}`, {is_active: 0}); }
    }
    closeSheet(); toast(id ? '渠道已保存' : '渠道已创建'); channelsView(ctx);
  });
  if (id) $('#c-delete').onclick = async () => {
    if (!await confirmDialog({title: `删除渠道「${c.name}」？`, message: '删除后使用这个渠道地址的客户端将无法访问，此操作不能撤销。', confirmText: '删除', danger: true})) return;
    try { await del(`/api/channels/${id}`); closeSheet(); toast('渠道已删除'); channelsView(ctx); } catch (e) { toast(e.message, true); }
  };
}
// 弹层开着时只刷新背后的列表，不碰弹层。
const refreshChannels = ctx => { if ($('#ch-list') && ctx.alive()) channelsView(ctx).catch(() => {}); };

/* ---------------- OpenAI ---------------- */

async function openaiView(ctx) {
  const c = await api('/api/openai/config');
  if (!ctx.alive()) return;
  const mode = c.cache_mode || 'off';
  ctx.app.innerHTML = `<div class="page">${head(ctx, 'openai', headSwitch('o-active', on(c.is_active), '启用转发'))}
    <section class="card status-card"><p class="status-line">${c.api_key_configured ? `${icon('check')}官方 Key 已保存（${esc(c.api_key_mask)}）` : `${icon('alert')}还没有填写官方 API Key，填写并保存后才能转发`}</p>${copyRow('客户端地址（OpenAI 兼容）', `${location.origin}/gpt/v1`)}</section>
    <div class="form-page" id="o-form"><div class="col">
      ${card('连接', `${field('Base URL', `<input id="o-url" value="${esc(c.base_url || 'https://api.openai.com/v1')}" inputmode="url" spellcheck="false">`)}
        ${field('官方 API Key', secretInput('o-key', '', c.api_key_configured ? `已保存 ${c.api_key_mask}，留空则不修改` : 'sk-...'), c.api_key_configured ? '<button class="link-btn danger" type="button" id="o-clear-key">清除已保存的 Key</button>' : '')}
        ${proxyInput('o-proxy', c.proxy_url)}
        <div class="row-actions"><button class="btn small" type="button" id="o-test">${icon('bolt')}测试连接</button><span class="hint" id="o-status"></span></div>`, {iconName: 'globe'})}
      ${card('模型', modelEditor('o-models', parseModels(c.models), {fetchLabel: '从官方拉取'}), {iconName: 'layers', sub: '客户端可使用的模型列表'})}
    </div><div class="col">
      ${card('提示词缓存', `${field('缓存方式', segmented('o-cache', cacheOptions(['off', 'implicit', 'explicit']), mode), '自动：依赖 OpenAI 自身的隐式缓存；手动断点：按规则在指定消息上打标记。')}
        ${field('缓存分组键', `<input id="o-cache-key" value="${esc(c.cache_key || '')}" placeholder="可留空" spellcheck="false">`, '对应 prompt_cache_key，相同键的请求更容易命中缓存。')}
        <div id="o-rules-wrap" ${mode === 'explicit' ? '' : 'hidden'}>${rulesEditor('o-rules', parseRules(c.cache_rules), false)}</div>`, {iconName: 'history'})}
      ${card('高级', toggleRow('o-thinking', '思考强度后缀', '从客户端模型名的后缀解析 reasoning effort，例如 -thinking-high。', on(c.thinking_alias)), {iconName: 'settings'})}
    </div></div></div>`;
  const paintState = () => setState(!c.api_key_configured ? 'idle' : on(c.is_active) ? 'ok' : 'idle', !c.api_key_configured ? '未配置' : on(c.is_active) ? '运行中' : '未启用');
  paintState();
  bindCopy(ctx.app); bindReveal(ctx.app);
  instantSwitch('o-active', async v => { await patch('/api/openai/config', {is_active: v}); c.is_active = v; paintState(); }, ['OpenAI 转发已启用', 'OpenAI 转发已停用']);
  bindSegmented('o-cache', v => { $('#o-rules-wrap').hidden = v !== 'explicit'; });
  bindRulesEditor('o-rules');
  const conn = () => ({base_url: val('o-url').trim(), api_key: val('o-key').trim(), proxy_url: val('o-proxy').trim()});
  bindModelEditor('o-models', {onFetch: async () => (await post('/api/openai/fetch-models', conn())).models});
  bindProxyTest('o-proxy', () => val('o-url').trim() || 'https://api.openai.com/v1');
  $('#o-test').onclick = e => busy(e.currentTarget, async () => { const d = await post('/api/openai/test', conn()); if (!d.ok) throw new Error(d.error || `HTTP ${d.status}`); return `连接正常，延迟 ${d.latency_ms}ms`; }, $('#o-status'));
  if ($('#o-clear-key')) $('#o-clear-key').onclick = async () => {
    if (!await confirmDialog({title: '清除已保存的官方 Key？', message: '清除后 OpenAI 转发将无法使用，直到重新填写 Key。', confirmText: '清除', danger: true})) return;
    try { await patch('/api/openai/config', {clear_api_key: true}); toast('官方 Key 已清除'); openaiView(ctx); } catch (e) { toast(e.message, true); }
  };
  const state = () => ({base_url: val('o-url').trim(), api_key: val('o-key').trim(), models: JSON.stringify(getModels('o-models')), proxy_url: val('o-proxy').trim(), thinking_alias: isChecked('o-thinking'), cache_mode: segValue('o-cache'), cache_key: val('o-cache-key').trim(), cache_rules: JSON.stringify(segValue('o-cache') === 'explicit' ? getRules('o-rules') : [])});
  watchForm($('#o-form'), state, async () => {
    const hadKey = !!val('o-key').trim();
    await patch('/api/openai/config', state()); $('#o-key').value = '';
    if (hadKey && !c.api_key_configured) openaiView(ctx);
  });
}

/* ---------------- 订阅账号（Codex / Claude Code） ---------------- */

const SUB = {
  codex: {title: 'Codex', url: '/codex/v1', cacheModes: cacheOptions(['off', 'auto', 'explicit']), rulesMode: 'explicit', proxyTarget: 'https://chatgpt.com/'},
  claudecode: {title: 'Claude Code', url: '/claudecode/v1', cacheModes: cacheOptions(['off', 'auto', 'rules', 'client']), rulesMode: 'rules', proxyTarget: 'https://api.anthropic.com/'},
};
const SUB_TABS = ['accounts', 'settings', 'version', 'access'];
const accountReady = (kind, a) => kind === 'codex' ? a.authenticated : a.credential_configured;
function paintSubState(kind, accounts) {
  const ready = accounts.filter(a => accountReady(kind, a) && on(a.is_active)).length;
  const enabled = $('#sub-enabled')?.checked;
  if (!accounts.length) setState('idle', '未配置');
  else if (!enabled) setState('idle', '未启用');
  else if (ready) setState('ok', `运行中 · 可用 ${ready}/${accounts.length}`);
  else setState('warn', '无可用账号');
}

async function subscriptionView(ctx, kind) {
  const meta = SUB[kind];
  const accountHash = /^acc-\d+$/.test(ctx.hash);
  const tab = !accountHash && SUB_TABS.includes(ctx.params.get('tab')) ? ctx.params.get('tab') : 'accounts';
  const [c, accounts, version] = await Promise.all([api(`/api/${kind}/config`), api(`/api/${kind}/accounts`), api(`/api/${kind}/client-version`).catch(() => null)]);
  if (!ctx.alive()) return;
  const release = version?.release || {};
  const newer = release.version && !release.error && release.version !== version.profile.version;
  ctx.app.innerHTML = `<div class="page">${head(ctx, kind, headSwitch('sub-enabled', on(c.enabled), '启用转发'))}
    ${!c.secret_store_configured ? `<div class="notice danger">${icon('alert')}<div><strong>服务端未配置 CATCH_MASTER_KEY</strong><p>订阅账号凭据需要加密保存。请在服务器环境变量中设置 32 字节 base64 密钥后重启。</p></div></div>` : ''}
    ${pageTabs(ctx, [['accounts', '账号', String(accounts.length)], ['settings', '转发设置'], ['version', '客户端版本', newer ? '有新版' : '', 'warn'], ['access', '接入方式']], tab)}
    <div id="tab-body"></div></div>`;
  paintSubState(kind, accounts);
  instantSwitch('sub-enabled', async v => { await patch(`/api/${kind}/config`, {enabled: v}); paintSubState(kind, accounts); }, [`${meta.title} 转发已启用`, `${meta.title} 转发已停用`]);
  const root = $('#tab-body');
  // Claude Code 距上次检查超过一天时后台检查一次（只检查，不应用），有新版就在标签上标出。
  if (kind === 'claudecode' && tab !== 'version' && version && Date.now() / 1000 - (release.checked_at || 0) >= 86400) {
    const active = accounts.find(a => on(a.is_active)) || accounts[0];
    post('/api/claudecode/client-version/check', {force: false, account_id: active?.id ?? null}).then(r => {
      const link = $('.page-tabs a[href$="tab=version"]');
      if (ctx.alive() && link && r.version && !r.error && r.version !== version.profile.version && !$('.tab-badge', link)) link.insertAdjacentHTML('beforeend', '<span class="tab-badge warn">有新版</span>');
    }).catch(() => {});
  }
  if (tab === 'settings') return subSettingsTab(ctx, kind, c, root);
  if (tab === 'version') {
    if (!version) { root.innerHTML = `<div class="notice">${icon('alert')}<div>客户端版本读取失败，请刷新页面重试。</div></div>`; return; }
    return kind === 'claudecode' ? ccVersionPanel(root, accounts, parseModels(c.models), version) : codexVersionPanel(root, accounts, version);
  }
  if (tab === 'access') return subAccessTab(ctx, kind, root);
  root.innerHTML = `<div class="toolbar"><p class="hint">请求会在可用账号之间轮换。点击账号查看额度、修改设置或重新授权。</p><button class="btn small primary" type="button" id="sub-add">${icon('plus')}添加账号</button></div><div class="item-list" id="sub-accounts"></div>`;
  renderAccounts(ctx, kind, accounts);
  $('#sub-add').onclick = () => accountSheet(ctx, kind, null);
  const hash = ctx.hash.match(/^acc-(\d+)$/);
  if (hash) { history.replaceState(null, '', ctx.path); const a = accounts.find(x => x.id === Number(hash[1])); if (a) accountSheet(ctx, kind, a); }
}

function subSettingsTab(ctx, kind, c, root) {
  const meta = SUB[kind]; const isCC = kind === 'claudecode';
  const mode = isCC && on(c.client_cache) ? 'client' : (c.cache_mode || 'off');
  root.innerHTML = `<p class="hint tab-lead">以下设置对所有账号生效。修改后点底部的「保存」。</p>
    <div class="form-page" id="sub-form"><div class="col">
      ${card('模型', modelEditor('sub-models', parseModels(c.models)) + (kind === 'codex' ? toggleRow('sub-unlisted', '允许列表外的模型', '关闭后，客户端只能使用上面列出的模型。', (c.allow_unlisted_models ?? '1') !== '0') : ''), {iconName: 'layers', sub: kind === 'codex' ? '可在账号详情里拉取账号可用模型作参考' : '客户端可使用的模型列表'})}
      ${card('请求', toggleRow('sub-thinking', '思考后缀', '识别模型名末尾的 -thinking、-thinking-low / medium / high / xhigh。', on(c.thinking_alias)) + (isCC ? field('单账号每分钟请求上限', `<input id="sub-rpm" type="number" min="0" inputmode="numeric" value="${esc(c.rpm_limit || 0)}">`, '0 表示不限制。超过上限会切换到其他账号。') : ''), {iconName: 'bolt'})}
    </div><div class="col">
      ${card('提示词缓存', `${field('缓存方式', segmented('sub-cache', meta.cacheModes, mode), isCC ? '跟随客户端：保留 Claude Code 自带的缓存断点；客户端没有断点时自动使用 5 分钟缓存。' : '')}
        ${isCC ? `<div id="sub-ttl-wrap" ${mode === 'auto' || mode === 'rules' ? '' : 'hidden'}>${field('缓存时长', segmented('sub-ttl', [['5m', '5 分钟'], ['1h', '1 小时']], c.cache_ttl || '5m', {small: true}))}</div>` : field('缓存分组键', `<input id="sub-cache-key" value="${esc(c.cache_key || '')}" placeholder="可留空" spellcheck="false">`, '对应 prompt_cache_key，相同键的请求更容易命中缓存。')}
        <div id="sub-rules-wrap" ${mode === meta.rulesMode ? '' : 'hidden'}>${rulesEditor('sub-rules', parseRules(c.cache_rules), isCC)}</div>`, {iconName: 'history'})}
    </div></div>`;
  bindModelEditor('sub-models');
  bindRulesEditor('sub-rules');
  if (isCC) bindSegmented('sub-ttl');
  bindSegmented('sub-cache', v => { $('#sub-rules-wrap').hidden = v !== meta.rulesMode; if (isCC) $('#sub-ttl-wrap').hidden = !(v === 'auto' || v === 'rules'); });
  const state = () => {
    const m = segValue('sub-cache');
    const s = {models: JSON.stringify(getModels('sub-models')), thinking_alias: isChecked('sub-thinking'), cache_rules: JSON.stringify(getRules('sub-rules'))};
    if (isCC) { s.client_cache = m === 'client' ? 1 : 0; s.cache_mode = m === 'client' ? (c.cache_mode || 'off') : m; s.cache_ttl = segValue('sub-ttl'); s.rpm_limit = Math.max(0, Number(val('sub-rpm') || 0)); }
    else { s.cache_mode = m; s.cache_key = val('sub-cache-key').trim(); s.allow_unlisted_models = isChecked('sub-unlisted'); }
    return s;
  };
  watchForm($('#sub-form'), state, () => patch(`/api/${kind}/config`, state()));
}

async function subAccessTab(ctx, kind, root) {
  const origin = location.origin;
  const access = await api('/api/settings/access_key').catch(() => ({}));
  if (!ctx.alive()) return;
  const key = access.value || '';
  const guide = accessGuides(origin)[kind];
  const address = kind === 'claudecode' ? endpointRows(`${origin}/claudecode`) : copyRow('接入地址（/chat/completions 与 /responses 共用）', `${origin}/codex/v1`);
  root.innerHTML = `<div class="form-page"><div class="col">${guideCard(guide, key, {address})}</div><div class="col">
    ${card('访问密钥', `<p class="hint">所有路由共用这一把密钥，填在客户端的 API Key 位置。</p>${key ? copyRow('访问密钥', key, {secret: true}) : '<p class="hint">尚未设置访问密钥。</p>'}<a class="btn small" href="/page/settings">${icon('settings')}到设置里更换</a>`, {iconName: 'key'})}
  </div></div>`;
  bindCopy(root); bindSnippets(root, () => key);
}

function renderAccounts(ctx, kind, accounts) {
  const root = $('#sub-accounts');
  if (!root) return;
  paintSubState(kind, accounts);
  if (!accounts.length) {
    root.innerHTML = empty('user', '还没有账号', kind === 'codex' ? '添加账号后，用 OpenAI 账号登录授权即可开始转发。' : '添加账号时需要填写 Claude 网页版的 sessionKey。', `<button class="btn primary" type="button" data-new>${icon('plus')}添加第一个账号</button>`);
    $('[data-new]', root).onclick = () => accountSheet(ctx, kind, null);
    return;
  }
  root.innerHTML = accounts.map(a => {
    const ready = accountReady(kind, a);
    const state = !ready ? pill('warn', kind === 'codex' ? '未授权' : '未录入凭据') : on(a.is_active) ? pill('ok', '可用') : pill('idle', '停用');
    return `<article class="item account" data-id="${a.id}" tabindex="0">
      <div class="item-main"><div class="item-title"><strong>${esc(a.name)}</strong>${state}</div>
        <p class="item-sub">${[a.email, a.subscription_type || (ready ? '套餐待识别' : ''), a.proxy_url ? '独立代理' : '直连'].filter(Boolean).map(esc).join(' · ')}</p>
        ${a.disable_reason ? `<p class="item-warn">${icon('alert')}${esc(a.disable_reason)}</p>` : ''}
        ${quotaWindows(a.usage).length ? quotaBars(a.usage, {compact: true}) : ''}
        ${!ready ? `<button class="btn small primary" type="button" data-stop data-auth="${a.id}">${kind === 'codex' ? '去授权' : '填写 sessionKey'}${icon('arrow')}</button>` : ''}</div>
      <div class="item-side" data-stop><button class="icon-btn ghost" type="button" data-refresh="${a.id}" aria-label="刷新用量" title="刷新用量" ${ready ? '' : 'disabled'}>${icon('refresh')}</button>${switchControl(`acc-on-${a.id}`, on(a.is_active), `启用 ${a.name}`)}</div>
      <span class="item-chevron">${icon('chevron')}</span></article>`;
  }).join('');
  $$('.item', root).forEach(el => {
    const a = accounts.find(x => x.id === Number(el.dataset.id));
    el.onclick = e => { if (!e.target.closest('[data-stop]')) accountSheet(ctx, kind, a); };
    el.onkeydown = e => { if (e.key === 'Enter' && e.target === el) accountSheet(ctx, kind, a); };
  });
  $$('[data-auth]', root).forEach(b => b.onclick = () => accountSheet(ctx, kind, accounts.find(x => x.id === Number(b.dataset.auth)), {focusAuth: true}));
  $$('[data-refresh]', root).forEach(b => b.onclick = () => busy(b, async () => {
    const id = Number(b.dataset.refresh);
    const usage = await post(`/api/${kind}/accounts/${id}/usage`);
    const a = accounts.find(x => x.id === id); a.usage = usage;
    if (usage?.plan_type) a.subscription_type = usage.plan_type;
    renderAccounts(ctx, kind, accounts);
    return '用量已刷新';
  }));
  accounts.forEach(a => instantSwitch(`acc-on-${a.id}`, async v => {
    await patch(`/api/${kind}/accounts/${a.id}`, v ? {is_active: 1, disable_reason: ''} : {is_active: 0});
    a.is_active = v; if (v) a.disable_reason = '';
    renderAccounts(ctx, kind, accounts);
  }, ['账号已启用', '账号已停用']));
}

const refreshList = kind => api(`/api/${kind}/accounts`);

// 账号弹层：新建时只有账号信息；已有账号分「额度 / 账号设置 / 授权」三个分区，保存按钮只在账号设置里出现。
async function accountSheet(ctx, kind, account, {focusAuth = false, justCreated = false} = {}) {
  const meta = SUB[kind]; const id = account?.id; const isCC = kind === 'claudecode';
  const ready = id && accountReady(kind, account);
  let stopPoll = null;
  const steps = !id || justCreated ? `<ol class="stepper"><li class="${id ? 'done' : 'active'}">${id ? icon('check') : '<b>1</b>'}<span>账号信息</span></li><li class="${id ? 'active' : ''}"><b>2</b><span>${isCC ? '验证登录' : '授权登录'}</span></li></ol>` : '';
  // Claude Code 未就绪说明缺 sessionKey，应去账号设置填写；其余未就绪或刚创建时先看授权。
  const firstPane = !id ? 'settings' : isCC ? (justCreated ? 'auth' : !ready ? 'settings' : 'usage') : (justCreated || focusAuth || !ready ? 'auth' : 'usage');
  const authLabel = isCC ? '验证登录' : ready ? '重新授权' : '授权登录';
  const authBlock = !id ? '' : isCC
    ? `<section class="form-section auth-section"><p class="hint">用已保存的 sessionKey 登录 Claude，读取账号信息和额度。更换 sessionKey 请到「账号设置」。</p><div class="row-actions"><button class="btn primary" type="button" id="sa-auth">${icon('shield')}验证并登录</button></div><div class="hint" id="sa-auth-state"></div></section>`
    : `<section class="form-section auth-section" id="sa-auth-section">
        ${field('授权方式', segmented('sa-auth-mode', [['callback', '浏览器登录'], ['device', '设备代码']], 'callback', {small: true}))}
        <div id="sa-callback"><ol class="mini-steps"><li>点击下方按钮，在新窗口登录 OpenAI。</li><li>登录后页面会打不开，这是正常的。复制浏览器地址栏里的完整地址。</li><li>粘贴到下面的输入框，点「完成授权」。</li></ol>
          <button class="btn primary" type="button" id="sa-auth-browser">${icon('globe')}打开 OpenAI 登录</button>
          <div id="sa-callback-fields" hidden>${field('回调地址', '<textarea id="sa-callback-url" rows="3" spellcheck="false" placeholder="http://localhost:1455/auth/callback?code=...&state=..."></textarea>')}<button class="btn primary" type="button" id="sa-auth-complete">${icon('check')}完成授权</button></div></div>
        <div id="sa-device" hidden><p class="hint">适合无法粘贴回调地址的情况：打开验证页面，输入显示的代码即可，这里会自动完成。</p><button class="btn primary" type="button" id="sa-auth-device">${icon('key')}获取设备代码</button></div>
        <div class="auth-state" id="sa-auth-state"></div></section>`;
  const usagePane = !id ? '' : `<section class="form-section"><div class="account-meta">${ready ? pill('ok', kind === 'codex' ? '已授权' : '凭据已录入') : pill('warn', kind === 'codex' ? '未授权' : '未录入凭据')}${account.subscription_type ? `<span class="meta-item">${esc(account.subscription_type)}</span>` : ''}${account.email ? `<span class="meta-item">${esc(account.email)}</span>` : ''}</div>
        <div id="sa-usage">${quotaBars(account.usage)}</div>${account.usage_refreshed_at ? `<p class="hint">更新于 ${date(account.usage_refreshed_at)}</p>` : ''}
        <div class="row-actions"><button class="btn small" type="button" id="sa-refresh" ${ready ? '' : 'disabled'}>${icon('refresh')}刷新用量</button>${kind === 'codex' ? `<button class="btn small" type="button" id="sa-models" ${ready ? '' : 'disabled'}>${icon('download')}拉取可用模型</button>` : ''}<span class="hint" id="sa-usage-state"></span></div>
        ${kind === 'codex' ? `<div id="sa-model-list">${modelChips(account.models)}</div>` : ''}</section>
      ${kind === 'codex' ? `<section class="form-section"><h4>重置卡</h4><div id="sa-reset-credits"><p class="hint">${ready ? '尚未查询' : '授权后可查询'}</p></div>
        <div class="row-actions"><button class="btn small" type="button" id="sa-reset-refresh" ${ready ? '' : 'disabled'}>${icon('refresh')}查看重置卡</button><span class="hint" id="sa-reset-state"></span></div></section>` : ''}`;
  const settingsPane = `<section class="form-section">
        ${id ? `<div data-no-dirty>${toggleRow('sa-active', '启用账号', '开关立即生效。停用后不再把请求分配给这个账号。', on(account.is_active))}</div>` : ''}
        ${id && account.disable_reason ? `<div class="notice">${icon('alert')}<div><strong>停用原因</strong><p>${esc(account.disable_reason)}。重新启用会清除该原因。</p></div></div>` : ''}
        ${field('名称', `<input id="sa-name" value="${esc(account?.name || meta.title)}" autocomplete="off">`, '仅用于在面板里区分账号。')}
        ${proxyInput('sa-proxy', account?.proxy_url, {hint: '这个代理只用于当前账号。支持 http / socks5 链接或 host:port:user:password，留空为直连。'})}
        ${isCC ? field('Claude sessionKey', secretInput('sa-credential', '', id ? '留空则保持当前 sessionKey' : 'sk-ant-sid...'), '在浏览器登录 claude.ai 后，从 Cookie 中复制 sessionKey。') : ''}
      </section>`;
  const tabs = id ? `<div class="sheet-tabs">${segmented('sa-pane', [['usage', '额度'], ['settings', '账号设置'], ['auth', authLabel]], firstPane)}</div>` : '';
  const sheet = openSheet(`${sheetHead(id ? `${meta.title} 账号` : `添加 ${meta.title} 账号`, id ? account.name : '新账号', steps + tabs)}
    <div class="sheet-body">
      ${id ? `<div data-pane="usage">${usagePane}</div>` : ''}
      <div data-pane="settings" data-guard>${settingsPane}</div>
      ${id ? `<div data-pane="auth">${authBlock}</div>` : ''}
    </div>
    <footer class="sheet-foot">${id ? `<button class="btn danger" type="button" id="sa-delete">${icon('trash')}删除</button>` : '<span></span>'}<div class="row-actions"><button class="btn" type="button" data-close>${justCreated ? '稍后再说' : id ? '关闭' : '取消'}</button><button class="btn primary" type="button" id="sa-save">${id ? '保存设置' : (isCC ? '创建账号' : '下一步')}</button></div></footer>`,
    {onClose: () => stopPoll?.(), guard: true});
  const showPane = pane => {
    $$('[data-pane]', sheet).forEach(el => el.hidden = el.dataset.pane !== pane);
    $('#sa-save', sheet).hidden = pane !== 'settings';
    $('.sheet-body', sheet).scrollTop = 0;
  };
  if (id) bindSegmented('sa-pane', showPane);
  showPane(firstPane);
  bindReveal(sheet);
  bindProxyTest('sa-proxy', meta.proxyTarget);
  // 只刷新账号列表，避免丢掉其他标签里未保存的修改。
  const reloadView = async () => { const list = await refreshList(kind); if ($('#sub-accounts')) renderAccounts(ctx, kind, list); return list; };

  $('#sa-save').onclick = e => busy(e.currentTarget, async () => {
    const name = val('sa-name').trim(); const proxy = val('sa-proxy').trim();
    if (!id) {
      const payload = {name, proxy_url: proxy};
      if (isCC) { payload.credential = val('sa-credential').trim(); if (!payload.credential) throw new Error('请填写 Claude sessionKey'); }
      const created = await post(`/api/${kind}/accounts`, payload);
      const list = await reloadView();
      const fresh = list.find(x => x.id === created.id);
      if (fresh) accountSheet(ctx, kind, fresh, {justCreated: true}); else closeSheet();
      return '账号已创建';
    }
    const payload = {name, proxy_url: proxy};
    if (isCC && val('sa-credential').trim()) payload.credential = val('sa-credential').trim();
    await patch(`/api/${kind}/accounts/${id}`, payload);
    closeSheet(); await reloadView(); return '账号已保存';
  });
  if (!id) return;

  instantSwitch('sa-active', async v => {
    await patch(`/api/${kind}/accounts/${id}`, v ? {is_active: 1, disable_reason: ''} : {is_active: 0});
    account.is_active = v; if (v) account.disable_reason = '';
    reloadView().catch(() => {});
  }, ['账号已启用', '账号已停用']);
  $('#sa-delete').onclick = async () => {
    if (!await confirmDialog({title: `删除账号「${account.name}」？`, message: '账号凭据会一并删除，此操作不能撤销。', confirmText: '删除', danger: true})) return;
    try { await del(`/api/${kind}/accounts/${id}`); closeSheet(); toast('账号已删除'); reloadView(); } catch (e) { toast(e.message, true); }
  };
  $('#sa-refresh').onclick = e => busy(e.currentTarget, async () => {
    const usage = await post(`/api/${kind}/accounts/${id}/usage`);
    account.usage = usage; $('#sa-usage').innerHTML = quotaBars(usage);
    reloadView().catch(() => {});
    return `用量已刷新${usage?.plan_type ? `，套餐 ${usage.plan_type}` : ''}`;
  }, $('#sa-usage-state'));
  if (kind === 'codex') $('#sa-models').onclick = e => busy(e.currentTarget, async () => {
    const d = await post(`/api/codex/accounts/${id}/models`);
    $('#sa-model-list').innerHTML = modelChips(d.models);
    return `已拉取并保存 ${d.models.length} 个模型`;
  }, $('#sa-usage-state'));
  if (kind === 'codex') {
    const resetRoot = $('#sa-reset-credits');
    const resetState = $('#sa-reset-state');
    const loadResetCredits = async () => {
      const data = await api(`/api/codex/accounts/${id}/reset-credits`);
      const expiryTime = value => {
        const time = Date.parse(value || '');
        return Number.isFinite(time) ? time : Infinity;
      };
      const available = (data.credits || []).filter(c => c.reset_type === 'codex_rate_limits' && c.status === 'available' && c.id)
        .sort((a, b) => expiryTime(a.expires_at) - expiryTime(b.expires_at));
      resetRoot.innerHTML = available.length ? `<div class="reset-credit-list">${available.map(c =>
        `<div class="reset-credit-row"><div><strong>${esc(c.title || '完整重置')}</strong><p class="hint">${expiryTime(c.expires_at) !== Infinity ? `有效期至 ${esc(new Date(c.expires_at).toLocaleString('zh-CN', {hour12: false}))}` : '未注明到期时间'}</p></div>
          <button class="btn small" type="button" data-credit="${esc(c.id)}">使用</button></div>`).join('')}</div>` : '<p class="hint">暂无可用重置卡</p>';
      $$('[data-credit]', resetRoot).forEach(button => button.onclick = async () => {
        const credit = available.find(c => c.id === button.dataset.credit);
        if (!credit) return;
        const expiry = expiryTime(credit.expires_at) !== Infinity
          ? new Date(credit.expires_at).toLocaleString('zh-CN', {hour12: false}) : '未注明';
        const confirmed = await confirmDialog({title: `使用「${credit.title || '完整重置'}」？`,
          message: `这张卡的到期时间：${expiry}。将重置「${account.name}」的 Codex 用量窗口，并可能改变每周重置日期。此操作不能撤销。`,
          confirmText: '确认使用', danger: true});
        if (!confirmed) return;
        await busy(button, async () => {
          await post(`/api/codex/accounts/${id}/reset-credits/consume`, {credit_id: credit.id});
          resetRoot.innerHTML = '<p class="hint">正在更新重置卡和用量…</p>';
          let refreshed = true;
          try {
            const usage = await post(`/api/codex/accounts/${id}/usage`);
            account.usage = usage;
            $('#sa-usage').innerHTML = quotaBars(usage);
          } catch (_) { refreshed = false; }
          try { await loadResetCredits(); } catch (_) { refreshed = false; }
          reloadView().catch(() => {});
          return refreshed ? '重置卡已使用，用量已刷新' : '重置卡已使用；部分状态刷新失败，请稍后手动刷新';
        }, resetState);
      });
      return data;
    };
    $('#sa-reset-refresh').onclick = e => busy(e.currentTarget, async () => {
      const data = await loadResetCredits();
      return `可用重置卡 ${data.available_count} 张`;
    }, resetState);
  }

  const authDone = async (message, fresh) => {
    stopPoll?.();
    toast(message);
    const list = await reloadView();
    const latest = fresh || list.find(x => x.id === id);
    if (latest) { accountSheet(ctx, kind, latest); $('#sa-usage-state').className = 'hint ok'; $('#sa-usage-state').textContent = message; }
  };

  if (isCC) {
    $('#sa-auth').onclick = e => busy(e.currentTarget, async () => {
      await post(`/api/claudecode/accounts/${id}/authenticate`);
      await authDone('验证成功，账号信息与额度已更新');
      return '';
    }, $('#sa-auth-state'));
    if (focusAuth && !ready) $('#sa-credential').focus();
    return;
  }

  // Codex 授权：浏览器回调或设备代码。
  const status = $('#sa-auth-state');
  const setStatus = (html, tone = '') => { status.className = `auth-state ${tone}`; status.innerHTML = html; };
  bindSegmented('sa-auth-mode', m => { $('#sa-callback').hidden = m !== 'callback'; $('#sa-device').hidden = m !== 'device'; setStatus(''); stopPoll?.(); });
  let session = null;
  $('#sa-auth-browser').onclick = async () => {
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    setStatus('正在创建登录会话…');
    try {
      session = await post(`/api/codex/accounts/${id}/authcode/start`);
      $('#sa-callback-fields').hidden = false;
      setStatus(`登录窗口已打开，${Math.round(Number(session.expires_in || 600) / 60)} 分钟内有效。没有弹出窗口？<a href="${esc(session.authorize_url)}" target="_blank" rel="noopener">点这里打开</a>`);
      if (popup) popup.location.replace(session.authorize_url);
      $('#sa-callback-url').focus();
    } catch (e) { popup?.close(); setStatus(esc(e.message), 'err'); }
  };
  $('#sa-auth-complete').onclick = e => {
    if (!session) { setStatus('请先点击「打开 OpenAI 登录」', 'err'); return; }
    const callbackUrl = val('sa-callback-url').trim();
    if (!callbackUrl) { setStatus('请粘贴浏览器地址栏中的完整回调地址', 'err'); return; }
    busy(e.currentTarget, async () => {
      const result = await post(`/api/codex/accounts/${id}/authcode/complete`, {login_session_id: session.login_session_id, callback_url: callbackUrl});
      session = null;
      await authDone('授权成功，账号凭据已保存', result.account);
    }).then(ok => { if (!ok) setStatus('授权失败，请重新打开登录窗口再试', 'err'); });
  };
  $('#sa-auth-device').onclick = e => busy(e.currentTarget, async () => {
    stopPoll?.();
    const d = await post(`/api/codex/accounts/${id}/device/start`);
    setStatus(`<ol class="mini-steps"><li>打开 <a href="${esc(d.verification_url)}" target="_blank" rel="noopener">${esc(d.verification_url)}</a></li><li>输入代码 <button class="code-chip" type="button" data-copy="${esc(d.user_code)}">${esc(d.user_code)}${icon('copy')}</button></li><li>完成后这里会自动更新，请不要关闭本页。</li></ol><p class="hint"><span class="spinner"></span>等待授权中…</p>`);
    $$('[data-copy]', status).forEach(b => b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('代码已复制')));
    let alive = true; let timer = null;
    stopPoll = () => { alive = false; clearTimeout(timer); };
    const interval = Math.max(1000, Number(d.interval || 5) * 1000);
    const poll = async () => {
      if (!alive) return;
      try {
        const r = await post(`/api/codex/accounts/${id}/device/poll`, {device_auth_id: d.device_auth_id, user_code: d.user_code});
        if (!alive) return;
        if (r.status === 'ready') { alive = false; await authDone('设备代码授权成功，账号凭据已保存', r.account); return; }
      } catch (err) { if (!alive) return; setStatus(esc(err.message), 'err'); return; }
      timer = setTimeout(poll, interval);
    };
    timer = setTimeout(poll, interval);
    return '';
  });
}

const modelChips = raw => {
  const list = parseModels(raw);
  return list.length ? `<p class="hint">账号可用模型</p><div class="chips readonly">${list.map(m => `<span class="chip">${esc(m)}</span>`).join('')}</div>` : '<p class="hint">点「拉取可用模型」查看这个账号能用哪些模型。</p>';
};

/* ---------------- Codex 客户端版本（「客户端版本」标签） ---------------- */

function codexVersionPanel(root, accounts, data) {
  let {profile, release} = data;
  const active = accounts.find(a => on(a.is_active)) || accounts[0];
  root.innerHTML = `<div class="form-page"><div class="col">
    ${card('当前状态', `<p class="hint">转发请求时使用这个版本号作为 User-Agent 和模型目录的 client_version。不是安装本机 CLI。</p>
      <div class="kv"><div><span>当前生效</span><strong id="cv-current"></strong></div><div><span>官方稳定版</span><strong id="cv-latest"></strong></div><div><span>上次获取</span><strong id="cv-checked"></strong></div></div>`, {iconName: 'terminal'})}
    ${card('获取官方版本', `${field('获取更新使用的连接', `<select id="cv-account"><option value="">服务器直连</option>${accounts.map(a => `<option value="${a.id}">${esc(a.name)}${a.proxy_url ? '（独立代理）' : '（直连）'}</option>`).join('')}</select>`)}
      <div class="row-actions"><button class="btn small" type="button" id="cv-check">${icon('refresh')}获取最新版</button><button class="btn small" type="button" id="cv-fill">填入下方</button></div>`, {iconName: 'download'})}
  </div><div class="col">
    ${card('应用版本', `${field('版本号', '<input id="cv-input" maxlength="16" inputmode="decimal" spellcheck="false">', '保存后下一次请求立即生效，影响所有 Codex 账号。')}
      <div class="row-actions"><button class="btn primary" type="button" id="cv-save">${icon('check')}保存并应用</button><button class="btn" type="button" id="cv-restore">${icon('history')}<span>恢复上一版本</span></button></div>
      <div class="hint" id="cv-status" role="status"></div>`, {iconName: 'shield'})}
  </div></div>`;
  const input = $('#cv-input', root);
  input.value = profile.version;
  $('#cv-account', root).value = active ? String(active.id) : '';
  const state = () => {
    if (!root.contains(input)) return;
    $('#cv-current', root).textContent = profile.version;
    $('#cv-latest', root).textContent = release.error || release.version || '未获取';
    $('#cv-checked', root).textContent = release.checked_at ? date(release.checked_at) : '未获取';
    $('#cv-fill', root).disabled = !release.version || !!release.error;
    $('#cv-restore', root).disabled = !profile.previous;
    $('#cv-restore span', root).textContent = profile.previous ? `恢复到 ${profile.previous}` : '恢复上一版本';
  };
  const apply = async (version, restore = false) => {
    profile = await post(`/api/codex/client-version/${restore ? 'restore' : 'apply'}`, {version, expected_version: profile.version});
    input.value = profile.version;
    return `版本 ${profile.version} 已应用，下一次请求生效`;
  };
  const run = (button, task) => busy(button, async () => { try { return await task(); } finally { state(); } }, $('#cv-status', root));
  $('#cv-check', root).onclick = e => run(e.currentTarget, async () => {
    release = await post('/api/codex/client-version/check', {force: true, account_id: Number($('#cv-account', root).value) || null});
    if (release.error) throw new Error(release.error);
    return `已获取官方稳定版 ${release.version}`;
  });
  $('#cv-fill', root).onclick = () => { input.value = release.version; };
  $('#cv-save', root).onclick = async e => {
    const version = input.value.trim();
    if (!version) { toast('请填写版本号', true); return; }
    if (version === profile.version) { toast('与当前生效版本相同'); return; }
    if (!await confirmDialog({title: `应用版本 ${version}？`, message: `将从 ${profile.version} 切换到 ${version}，下一次请求起对所有 Codex 账号生效。之后可一键恢复。`, confirmText: '应用'})) return;
    run(e.currentTarget, () => apply(version));
  };
  $('#cv-restore', root).onclick = async e => {
    if (!profile.previous) return;
    if (!await confirmDialog({title: `恢复到 ${profile.previous}？`, confirmText: '恢复'})) return;
    run(e.currentTarget, () => apply(profile.previous, true));
  };
  state();
}

/* ---------------- Claude Code 客户端版本（「客户端版本」标签） ---------------- */

async function ccVersionPanel(root, accounts, modelList, data) {
  let {profile, release} = data;
  root.innerHTML = `<div class="form-page"><div class="col">
    ${card('当前状态', `<p class="hint">转发请求时会模拟这个版本的 Claude Code 客户端（影响 User-Agent 和请求标识）。官方发布新版后建议先测试再应用。检查更新不会自动应用。</p>
      <div class="kv"><div><span>当前生效</span><strong id="v-current"></strong></div><div><span>官方最新</span><strong id="v-latest"></strong></div><div><span>测试记录</span><strong id="v-tested"></strong></div></div>
      <div class="row-actions"><button class="btn small" type="button" id="v-check">${icon('refresh')}检查最新版</button><button class="btn small" type="button" id="v-fill" disabled>填入右侧</button></div>`, {iconName: 'terminal'})}
  </div><div class="col">
    ${card('测试并应用', `${field('候选版本', '<input id="v-input" maxlength="16" inputmode="decimal" spellcheck="false">', 'User-Agent：<code id="v-ua"></code>')}
      <div class="grid-2">${field('测试账号', `<select id="v-account"><option value="">请选择账号</option>${accounts.map(a => `<option value="${a.id}">${esc(a.name)}${on(a.is_active) ? '' : '（停用）'}</option>`).join('')}</select>`)}
      ${field('测试模型', `<input id="v-model" list="v-model-list" placeholder="填写实际使用的模型名" spellcheck="false"><datalist id="v-model-list">${modelList.map(m => `<option value="${esc(m)}"></option>`).join('')}</datalist>`)}</div>
      <p class="hint">测试会用所选账号发送一条很短的请求，会消耗少量额度。</p>
      <div class="row-actions wrap"><button class="btn primary" type="button" id="v-test">${icon('shield')}测试并应用</button><button class="btn" type="button" id="v-save">直接保存</button><button class="btn ghost" type="button" id="v-restore">${icon('history')}<span>恢复上一版本</span></button></div>
      <div class="hint" id="v-status" role="status"></div>`, {iconName: 'shield'})}
  </div></div>`;
  const input = $('#v-input', root);
  input.value = profile.version;
  const syncUA = () => { $('#v-ua', root).textContent = `claude-code/${input.value.trim()}`; };
  input.oninput = syncUA;
  const active = accounts.find(a => on(a.is_active)) || accounts[0];
  if (active) $('#v-account', root).value = String(active.id);
  $('#v-model', root).value = modelList[0] || '';
  const state = () => {
    if (!root.contains(input)) return;
    $('#v-current', root).textContent = profile.version;
    $('#v-latest', root).textContent = release.version ? `${release.version}${release.checked_at ? `（${date(release.checked_at)} 检查）` : ''}` : (release.error || '未获取');
    $('#v-tested', root).textContent = profile.tested_at ? `${profile.tested_model} · ${date(profile.tested_at)}` : '暂无';
    $('#v-fill', root).disabled = !release.version;
    $('#v-restore', root).disabled = !profile.previous;
    $('#v-restore span', root).textContent = profile.previous ? `恢复到 ${profile.previous.version}` : '恢复上一版本';
    syncUA();
  };
  const status = $('#v-status', root);
  const run = (btn, task) => busy(btn, async () => { const m = await task(); state(); return m; }, status);
  $('#v-check', root).onclick = e => run(e.currentTarget, async () => { release = await post('/api/claudecode/client-version/check', {force: true, account_id: Number($('#v-account', root).value) || null}); return release.error || '检查完成'; });
  $('#v-fill', root).onclick = () => { input.value = release.version; syncUA(); };
  const apply = action => {
    const payload = {version: action === 'restore' ? profile.previous.version : input.value.trim(), expected_version: profile.version};
    if (action === 'test') { payload.account_id = Number($('#v-account', root).value); payload.model = $('#v-model', root).value.trim(); if (!payload.account_id || !payload.model) throw new Error('请选择测试账号并填写模型'); }
    return post(`/api/claudecode/client-version/${action}`, payload);
  };
  $('#v-test', root).onclick = e => run(e.currentTarget, async () => { profile = await apply('test'); input.value = profile.version; return '测试通过，版本已应用'; });
  $('#v-save', root).onclick = async e => {
    const version = input.value.trim();
    if (version && version !== profile.version && !await confirmDialog({title: `不测试直接应用 ${version}？`, message: '跳过测试，下一次请求起对所有 Claude Code 账号生效。之后可一键恢复。', confirmText: '直接应用'})) return;
    run(e.currentTarget, async () => { profile = await apply('apply'); input.value = profile.version; return '版本已保存，下一次请求生效'; });
  };
  $('#v-restore', root).onclick = async e => {
    if (!profile.previous) return;
    if (!await confirmDialog({title: `恢复到 ${profile.previous.version}？`, confirmText: '恢复'})) return;
    run(e.currentTarget, async () => { profile = await apply('restore'); input.value = profile.version; return '已恢复上一版本'; });
  };
  state();
  // 与旧版行为一致：距上次检查超过一天时自动检查一次（只检查，不应用）。
  if (Date.now() / 1000 - (release.checked_at || 0) >= 86400) {
    try { release = await post('/api/claudecode/client-version/check', {force: false, account_id: active?.id ?? null}); state(); } catch (_) {}
  }
}
