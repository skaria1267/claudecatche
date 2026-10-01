// 总览：让第一次打开的人看懂项目用途、各路由状态和下一步该点哪里。
import {api, esc, icon, fmt, parseModels, on} from '../core.js';
import {pill, copyRow, bindCopy, quotaWindows} from '../ui.js';

const settle = promises => Promise.allSettled(promises).then(rs => rs.map(r => r.status === 'fulfilled' ? r.value : null));

function accountIssues(kind, accounts, label) {
  const out = [];
  for (const a of accounts || []) {
    const name = `${label}「${a.name}」`;
    const href = `/page/${kind}#acc-${a.id}`;
    const ready = kind === 'codex' ? a.authenticated : a.credential_configured;
    if (!ready) out.push({tone: 'warn', text: `${name} ${kind === 'codex' ? '尚未授权登录' : '尚未录入 sessionKey'}`, href});
    else if (!on(a.is_active)) out.push({tone: 'warn', text: `${name} 已停用${a.disable_reason ? `：${a.disable_reason}` : ''}`, href});
    const top = quotaWindows(a.usage).sort((x, y) => y.pct - x.pct)[0];
    if (top && top.pct >= 80) out.push({tone: top.pct >= 95 ? 'danger' : 'warn', text: `${name} ${top.name}额度已用 ${top.pct.toFixed(0)}%`, href});
  }
  return out;
}

export async function overviewPage(ctx) {
  const [channels, usage, oai, oaiUsage, cx, cxAccounts, cc, ccAccounts, ccUsage, access, fails, cxFails, ccFails] = await settle([
    api('/api/channels'), api('/api/usage'), api('/api/openai/config'), api('/api/openai/usage'),
    api('/api/codex/config'), api('/api/codex/accounts'), api('/api/claudecode/config'), api('/api/claudecode/accounts'),
    api('/api/claudecode/usage-summary'), api('/api/settings/access_key'), api('/api/failures'), api('/api/codex/failures'), api('/api/claudecode/failures'),
  ]);
  if (!ctx.alive()) return;
  if (!channels) throw new Error('无法读取路由数据');

  const activeChannels = channels.filter(c => on(c.is_active)).length;
  const cxReady = (cxAccounts || []).filter(a => a.authenticated && on(a.is_active)).length;
  const ccReady = (ccAccounts || []).filter(a => a.credential_configured && on(a.is_active)).length;
  const subState = (cfg, accounts, ready) => !accounts?.length ? ['idle', '未配置'] : !on(cfg?.enabled) ? ['idle', '未启用'] : ready ? ['ok', '运行中'] : ['warn', '无可用账号'];

  const routes = [
    {
      href: '/page/channels', icon: 'layers', name: 'Claude 渠道',
      desc: '接入第三方 Claude 兼容 API（如 OpenRouter、各类中转），每个渠道有独立地址。',
      state: !channels.length ? ['idle', '未配置'] : activeChannels ? ['ok', '运行中'] : ['idle', '全部停用'],
      stats: [['渠道', `${activeChannels} / ${channels.length}`], ['累计请求', fmt(usage?.total_requests)]],
      first: '第一步：新建一个渠道，填上游地址和 Key',
      empty: !channels.length,
    },
    {
      href: '/page/openai', icon: 'sparkle', name: 'OpenAI',
      desc: '转发到 OpenAI 官方 API。客户端用中转站的密钥，真实 Key 不外露。',
      state: !oai?.api_key_configured ? ['idle', '未配置'] : on(oai.is_active) ? ['ok', '运行中'] : ['idle', '未启用'],
      stats: [['模型', String(parseModels(oai?.models).length)], ['累计请求', fmt(oaiUsage?.total_requests)]],
      first: '第一步：填入官方 API Key 并启用',
      empty: !oai?.api_key_configured,
    },
    {
      href: '/page/codex', icon: 'terminal', name: 'Codex',
      desc: '把 ChatGPT 订阅账号变成 API，支持多账号轮换与每账号代理。',
      state: subState(cx, cxAccounts, cxReady),
      stats: [['可用账号', `${cxReady} / ${(cxAccounts || []).length}`], ['模型', String(parseModels(cx?.models).length)]],
      first: '第一步：添加账号并用 OpenAI 登录授权',
      empty: !(cxAccounts || []).length,
    },
    {
      href: '/page/claudecode', icon: 'bolt', name: 'Claude Code',
      desc: '把 Claude 订阅账号变成 API，支持多账号、限速和客户端版本管理。',
      state: subState(cc, ccAccounts, ccReady),
      stats: [['可用账号', `${ccReady} / ${(ccAccounts || []).length}`], ['累计请求', fmt(ccUsage?.total_requests)]],
      first: '第一步：添加账号并录入 sessionKey',
      empty: !(ccAccounts || []).length,
    },
  ];

  const issues = [
    ...(cx && !cx.secret_store_configured ? [{tone: 'danger', text: '服务端未配置 CATCH_MASTER_KEY，订阅账号功能不可用', href: '/page/codex'}] : []),
    ...accountIssues('codex', cxAccounts, 'Codex'),
    ...accountIssues('claudecode', ccAccounts, 'Claude Code'),
  ];
  if (on(cx?.enabled) && !cxReady && (cxAccounts || []).length) issues.push({tone: 'danger', text: 'Codex 已启用，但没有可用账号', href: '/page/codex'});
  if (on(cc?.enabled) && !ccReady && (ccAccounts || []).length) issues.push({tone: 'danger', text: 'Claude Code 已启用，但没有可用账号', href: '/page/claudecode'});
  const failTotal = (fails?.length || 0) + (cxFails?.length || 0) + (ccFails?.length || 0);
  if (failTotal) issues.push({tone: 'warn', text: `最近有 ${failTotal} 条失败请求`, href: '/page/logs?view=failures'});

  const origin = location.origin;

  ctx.app.innerHTML = `<div class="page">
    <div class="route-grid overview-routes">${routes.map(r => `<a class="route-card" href="${r.href}">
      <div class="route-top"><span class="route-ico">${icon(r.icon)}</span>${pill(r.state[0], r.state[1])}</div>
      <h3>${r.name}</h3><p>${r.desc}</p>
      ${r.empty ? `<div class="route-first">${icon('info')}<span>${r.first}</span></div>` : `<dl class="route-stats">${r.stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`}
      <span class="route-cta">${r.empty ? '开始配置' : '管理'}${icon('arrow')}</span></a>`).join('')}</div>

    ${issues.length ? `<section class="card attention"><header class="card-head"><div class="card-title"><span class="card-ico warn">${icon('alert')}</span><div><h3>需要注意</h3><p>${issues.length} 项待处理，点击直接前往</p></div></div></header><div class="issue-list">${issues.map(i => `<a class="issue ${i.tone}" href="${i.href}"><i></i><span>${esc(i.text)}</span>${icon('chevron')}</a>`).join('')}</div></section>` : `<section class="card all-good"><span class="card-ico ok">${icon('check')}</span><div><strong>一切正常</strong><p>没有需要处理的账号或失败请求。</p></div></section>`}

    <div class="section-head"><h2>三步开始使用</h2><p>配置好上游后，把下面的信息填进客户端即可。</p></div>
    <ol class="steps">
      <li><span class="step-no">1</span><div><strong>配置上游</strong><p>在「路由」里添加渠道、填写 OpenAI Key，或添加订阅账号并完成登录。</p><a class="btn small" href="/page/channels">前往路由${icon('arrow')}</a></div></li>
      <li><span class="step-no">2</span><div><strong>复制访问密钥</strong><p>所有路由共用这一把密钥，客户端里填在 API Key 的位置。</p>${access?.value ? copyRow('访问密钥', access.value, {secret: true}) : '<p class="hint">尚未设置访问密钥，请到「设置」中设置。</p>'}</div></li>
      <li><span class="step-no">3</span><div><strong>填入客户端</strong><p>按路由选择接入地址，例如 Claude Code 订阅填 <code>${esc(origin)}/claudecode</code>。</p><a class="btn small" href="/page/settings#guide">查看接入指引${icon('arrow')}</a></div></li>
    </ol>
  </div>`;
  bindCopy(ctx.app);
}
