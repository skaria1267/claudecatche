(() => {
  const token = localStorage.getItem('token');
  if (!token) { location.href = '/'; return; }

  const nav = [
    ['01', '总览', '/dashboard'], ['02', '渠道', '/page/channels'],
    ['03', 'OpenAI', '/page/openai'], ['04', '用量', '/page/usage'],
    ['05', '日志', '/page/logs']
  ];
  const path = location.pathname;
  const app = document.getElementById('app');
  const drawer = document.getElementById('drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const headers = {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'};

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => {
    const n = Number(value || 0);
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
  };
  const date = value => value ? new Date(Number(value) * 1000).toLocaleString('zh-CN', {hour12:false}) : '—';
  const models = raw => {
    try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value : []; }
    catch (_) { return String(raw || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean); }
  };
  const lines = value => [...new Set(String(value || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean))];

  async function api(url, options = {}) {
    const response = await fetch(url, {...options, headers: {...headers, ...(options.headers || {})}});
    if (response.status === 401) { localStorage.removeItem('token'); location.href = '/'; throw new Error('登录已失效'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
    return data;
  }
  function toast(message, error = false) {
    const el = document.getElementById('toast'); el.textContent = message; el.className = `toast show${error ? ' error' : ''}`;
    clearTimeout(el._timer); el._timer = setTimeout(() => el.className = 'toast', 2200);
  }
  function pageHead(kicker, title, subtitle, actions = '') {
    return `<header class="page-head"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div><div class="head-actions">${actions}</div></header>`;
  }
  function metric(label, value, note = '') { return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${fmt(value)}</div><div class="metric-note">${note}</div></div>`; }
  function openDrawer(html) { drawer.innerHTML = html; drawer.classList.add('open'); backdrop.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
  function closeDrawer() { drawer.classList.remove('open'); backdrop.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
  function formValue(id) { return document.getElementById(id)?.value ?? ''; }
  function checked(id) { return document.getElementById(id)?.checked ? 1 : 0; }

  document.getElementById('side-nav').innerHTML = `<p class="side-group-label">WORKSPACE</p>` + nav.map(([i,n,p]) => `<a class="side-link ${path===p?'active':''}" data-path="${p}" href="${p}"><span class="nav-index">${i}</span><span>${n}</span></a>`).join('');
  document.querySelector(`[data-path="/page/settings"]`)?.classList.toggle('active', path === '/page/settings');
  document.querySelector('[data-action="logout"]').onclick = () => { localStorage.removeItem('token'); location.href = '/'; };
  const sidebar = document.querySelector('.sidebar');
  const menuToggle = document.getElementById('mobile-menu-toggle');
  const menuBackdrop = document.getElementById('mobile-menu-backdrop');
  function setMobileMenu(open) {
    sidebar.classList.toggle('mobile-open', open);
    menuToggle.classList.toggle('open', open);
    menuBackdrop.classList.toggle('open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? '关闭目录' : '打开目录');
  }
  menuToggle.onclick = () => setMobileMenu(!sidebar.classList.contains('mobile-open'));
  menuBackdrop.onclick = () => setMobileMenu(false);
  sidebar.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setMobileMenu(false)));
  backdrop.onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

  async function dashboardPage() {
    const [channels, usage, oai, oaiUsage] = await Promise.all([api('/api/channels'), api('/api/usage'), api('/api/openai/config'), api('/api/openai/usage')]);
    const active = channels.filter(c => c.is_active).length;
    app.innerHTML = `<div class="page">${pageHead('OVERVIEW','路由工作台','集中查看渠道状态、请求用量与 OpenAI 转发。','<a class="btn primary" href="/page/channels">＋ 添加渠道</a>')}
      <section class="overview-line">${metric('活跃渠道',active,`共 ${channels.length} 个`)}${metric('累计请求',usage.total_requests,'Claude 路由')}${metric('输入 Token',(usage.total_input||0)+(usage.total_cache_creation||0)+(usage.total_cache_read||0),'含缓存')}${metric('OpenAI 请求',oaiUsage.total_requests,oai.is_active?'转发已启用':'转发未启用')}</section>
      <div class="work-grid"><section class="panel"><div class="panel-head"><h3>渠道状态</h3><a href="/page/channels">查看全部 →</a></div><div class="quiet-list">${channels.length ? channels.slice(0,6).map(c => `<div class="quiet-row" data-channel="${c.id}"><div><div class="row-title">${esc(c.name)}</div><div class="row-sub">${esc(c.base_url)}</div></div><div class="row-meta">${models(c.models).length} 个模型</div><span class="status ${c.is_active?'on':''}">${c.is_active?'运行中':'已停用'}</span><span class="row-arrow">›</span></div>`).join('') : '<div class="empty"><strong>还没有渠道</strong>添加第一个上游连接。</div>'}</div></section>
      <aside class="panel"><div class="panel-head"><h3>OpenAI 路由</h3><span class="status ${oai.is_active?'on':'warn'}">${oai.is_active?'已启用':'未启用'}</span></div><div class="panel-body stack"><div class="mini-stat"><span>模型数量</span><strong>${models(oai.models).length}</strong></div><div class="mini-stat"><span>推理 Token</span><strong>${fmt(oaiUsage.reasoning_tokens)}</strong></div><div class="mini-stat"><span>缓存命中</span><strong>${fmt(oaiUsage.cached_tokens)}</strong></div><a class="btn" href="/page/openai">管理 OpenAI →</a></div></aside></div></div>`;
    app.querySelectorAll('[data-channel]').forEach(el => el.onclick = () => location.href = `/page/channels#${el.dataset.channel}`);
  }

  let channelList = [];
  async function channelsPage() {
    channelList = await api('/api/channels');
    app.innerHTML = `<div class="page">${pageHead('ROUTING','渠道','每个渠道独立管理模型、缓存、思考别名与出站代理。','<button class="btn primary" id="add-channel">＋ 新建渠道</button>')}
      <div class="toolbar"><div class="toolbar-left"><label class="search"><input id="channel-search" placeholder="搜索渠道或上游"></label></div><div class="toolbar-right"><span class="status on">${channelList.filter(x=>x.is_active).length} 个运行中</span></div></div>
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>渠道</th><th>上游</th><th>模型</th><th>缓存</th><th>代理</th><th>状态</th><th></th></tr></thead><tbody id="channel-body"></tbody></table></div><div id="channel-empty"></div></section></div>`;
    renderChannels(channelList);
    document.getElementById('add-channel').onclick = () => channelDrawer();
    document.getElementById('channel-search').oninput = e => { const q=e.target.value.toLowerCase(); renderChannels(channelList.filter(c => `${c.name} ${c.base_url}`.toLowerCase().includes(q))); };
    const hashId = Number(location.hash.slice(1)); if (hashId) { history.replaceState(null,'',path); channelDrawer(hashId); }
  }
  function renderChannels(list) {
    const body = document.getElementById('channel-body'); const empty = document.getElementById('channel-empty');
    body.innerHTML = list.map(c => `<tr data-id="${c.id}"><td><div class="row-title">${esc(c.name)}</div><div class="row-sub code">${esc(c.api_key_mask)}</div></td><td class="code">${esc(c.base_url)}</td><td>${models(c.models).length}</td><td>${c.cache_enabled ? esc(c.cache_mode) : '关闭'}</td><td>${c.proxy_url ? '<span class="status on">已配置</span>' : '<span class="row-meta">直连</span>'}</td><td><span class="status ${c.is_active?'on':''}">${c.is_active?'启用':'停用'}</span></td><td class="row-arrow">›</td></tr>`).join('');
    empty.innerHTML = list.length ? '' : '<div class="empty"><strong>没有匹配的渠道</strong>换一个关键词，或新建渠道。</div>';
    body.querySelectorAll('tr').forEach(row => row.onclick = () => channelDrawer(Number(row.dataset.id)));
  }
  function activateSegments(groupId, inputId, value, panelId = null, panelValue = null) {
    const input = document.getElementById(inputId);
    input.value = value;
    document.querySelectorAll(`#${groupId} .segment`).forEach(button => {
      button.classList.toggle('active', button.dataset.value === value);
      button.onclick = () => activateSegments(groupId, inputId, button.dataset.value, panelId, panelValue);
    });
    if (panelId) document.getElementById(panelId).classList.toggle('active', value === panelValue);
  }
  function renderRuleBuilder(rootId, rules, withTarget) {
    const root = document.getElementById(rootId);
    const addButton = root.parentElement.querySelector('[data-add-rule]');
    if (addButton) addButton.style.display = rules.length >= 4 ? 'none' : 'inline-flex';
    if (!rules.length) {
      root.innerHTML = '<div class="rule-empty">还没有自定义断点。</div>';
      return;
    }
    root.innerHTML = rules.map((rule, index) => `<div class="rule-row ${withTarget?'':'oai-rule'}" data-rule="${index}">
      ${withTarget ? `<select data-field="target"><option value="system" ${rule.target==='system'?'selected':''}>system</option><option value="messages" ${rule.target!=='system'?'selected':''}>messages</option></select>` : ''}
      <select data-field="direction"><option value="forward" ${rule.direction==='forward'?'selected':''}>正数第</option><option value="backward" ${rule.direction!=='forward'?'selected':''}>倒数第</option></select>
      <input data-field="index" type="number" min="1" max="999" value="${Math.max(1,Number(rule.index)||1)}"><span class="rule-unit">${withTarget?'条':'条消息'}</span><button class="rule-delete" type="button" title="删除断点">×</button></div>`).join('');
    root.querySelectorAll('[data-rule]').forEach(row => {
      const index = Number(row.dataset.rule);
      row.querySelectorAll('[data-field]').forEach(control => control.onchange = () => {
        rules[index][control.dataset.field] = control.dataset.field === 'index' ? Math.max(1, Number(control.value)||1) : control.value;
      });
      row.querySelector('.rule-delete').onclick = () => { rules.splice(index, 1); renderRuleBuilder(rootId, rules, withTarget); };
    });
  }
  async function channelDrawer(id = null) {
    const c = id ? await api(`/api/channels/${id}`) : {name:'',base_url:'',api_key:'',auth_mode:'both',models:'[]',cache_enabled:1,cache_mode:'auto',cache_ttl:'5m',cache_rules:'[]',or_routing:0,or_providers:'anthropic,google-vertex,amazon-bedrock',thinking_alias:0,proxy_url:'',is_active:1};
    let rules; try { rules=JSON.parse(c.cache_rules||'[]'); } catch (_) { rules=[]; }
    openDrawer(`<div class="drawer-top"><div><p class="eyebrow">${id?'EDIT CHANNEL':'NEW CHANNEL'}</p><h2>${id?esc(c.name):'新建渠道'}</h2></div><button class="icon-btn" data-close title="关闭">×</button></div>
      <div class="drawer-body"><div class="form-grid">
      <label class="field"><span>渠道名称</span><input id="c-name" value="${esc(c.name)}" placeholder="openrouter"></label><label class="field"><span>认证模式</span><select id="c-auth"><option value="both">双认证头</option><option value="x">x-api-key</option><option value="a">Bearer</option></select></label>
      <label class="field full"><span>上游 URL</span><input id="c-url" value="${esc(c.base_url)}" placeholder="https://example.com/v1"></label><label class="field full"><span>上游 API Key</span><input id="c-key" value="${esc(c.api_key)}" autocomplete="off" placeholder="sk-..."></label>
      <label class="field full"><span>模型列表（每行一个）</span><textarea id="c-models" placeholder="claude-sonnet-4-6">${esc(models(c.models).join('\n'))}</textarea><div class="inline-actions"><button class="btn" id="c-fetch" type="button">拉取模型</button><small id="c-fetch-status"></small></div></label>
      <label class="field full"><span>出站代理</span><input id="c-proxy" value="${esc(c.proxy_url)}" placeholder="http://user:pass@host:port"><div class="inline-actions"><button class="btn" id="c-test" type="button">测试连通性</button><small id="c-test-status">留空为直连</small></div></label></div>
      <div class="toggle-row"><div class="toggle-copy"><strong>启用渠道</strong><p>停用后不再接受此渠道的请求。</p></div><label class="switch"><input id="c-active" type="checkbox" ${c.is_active?'checked':''}><span></span></label></div>
      <section class="setting-section"><div class="setting-section-title"><h3>缓存断点</h3><span>最多 4 条</span></div><div class="toggle-row"><div class="toggle-copy"><strong>启用缓存注入</strong><p>向 Claude 请求添加缓存控制。</p></div><label class="switch"><input id="c-cache" type="checkbox" ${c.cache_enabled?'checked':''}><span></span></label></div><div class="form-grid"><label class="field"><span>打标模式</span><input id="c-cache-mode" type="hidden"><div class="segmented" id="c-cache-segments"><button class="segment" data-value="auto" type="button">自动模式</button><button class="segment" data-value="rules" type="button">自定义断点</button></div></label><label class="field"><span>缓存 TTL</span><select id="c-ttl"><option value="5m">5 分钟</option><option value="1h">1 小时</option></select></label></div><div class="rules-builder" id="c-rules-panel"><div id="c-rules"></div><button class="btn" id="c-add-rule" data-add-rule type="button">＋ 添加规则</button><p class="row-meta">每条规则选择 system 或 messages、正数或倒数位置。</p></div></section>
      <section class="setting-section"><div class="setting-section-title"><h3>OpenRouter 供应商</h3><span>@provider</span></div><div class="toggle-row"><div class="toggle-copy"><strong>供应商后缀路由</strong><p>生成并识别 @provider 模型别名。</p></div><label class="switch"><input id="c-or" type="checkbox" ${c.or_routing?'checked':''}><span></span></label></div><label class="field"><span>供应商清单（逗号分隔）</span><input id="c-providers" value="${esc(c.or_providers)}"></label></section>
      <section class="setting-section"><div class="setting-section-title"><h3>思考模型别名</h3><span>thinking effort</span></div><div class="toggle-row"><div class="toggle-copy"><strong>启用思考后缀</strong><p>识别模型名的 -thinking[-挡位] 后缀。</p></div><label class="switch"><input id="c-thinking" type="checkbox" ${c.thinking_alias?'checked':''}><span></span></label></div></section>
      <div class="drawer-actions">${id?'<button class="btn danger" id="c-delete">删除渠道</button>':'<span></span>'}<div class="inline-actions"><button class="btn" data-close>取消</button><button class="btn primary" id="c-save">保存</button></div></div></div>`);
    document.getElementById('c-auth').value=c.auth_mode||'both'; document.getElementById('c-ttl').value=c.cache_ttl||'5m';
    activateSegments('c-cache-segments','c-cache-mode',c.cache_mode||'auto','c-rules-panel','rules');
    renderRuleBuilder('c-rules', rules, true);
    document.getElementById('c-add-rule').onclick = () => { if(rules.length<4){rules.push({target:'messages',direction:'backward',index:2});renderRuleBuilder('c-rules',rules,true);} };
    drawer.querySelectorAll('[data-close]').forEach(x=>x.onclick=closeDrawer);
    document.getElementById('c-fetch').onclick = async () => actionStatus('c-fetch-status', async () => { const d=await api('/api/channels/fetch-models',{method:'POST',body:JSON.stringify({base_url:formValue('c-url'),api_key:formValue('c-key'),auth_mode:formValue('c-auth'),proxy_url:formValue('c-proxy')})}); document.getElementById('c-models').value=d.models.join('\n'); return `已拉取 ${d.models.length} 个模型`; });
    document.getElementById('c-test').onclick = async () => actionStatus('c-test-status', async () => { const d=await api('/api/proxy-test',{method:'POST',body:JSON.stringify({proxy_url:formValue('c-proxy'),target_url:formValue('c-url')})}); if(!d.ok) throw new Error(d.error||'连接失败'); return `连通 · ${d.latency_ms}ms${d.exit_ip?' · '+d.exit_ip:''}`; });
    document.getElementById('c-save').onclick = async () => {
      const payload={name:formValue('c-name').trim(),base_url:formValue('c-url').trim(),api_key:formValue('c-key').trim(),auth_mode:formValue('c-auth'),models:JSON.stringify(lines(formValue('c-models'))),cache_enabled:checked('c-cache'),cache_mode:formValue('c-cache-mode'),cache_ttl:formValue('c-ttl'),cache_rules:JSON.stringify(formValue('c-cache-mode')==='rules'?rules:[]),or_routing:checked('c-or'),or_providers:formValue('c-providers').trim(),thinking_alias:checked('c-thinking'),proxy_url:formValue('c-proxy').trim(),is_active:checked('c-active')};
      if(!payload.name||!payload.base_url||!payload.api_key){toast('请填写名称、上游 URL 和 API Key',true);return;}
      try { await api(id?`/api/channels/${id}`:'/api/channels',{method:id?'PATCH':'POST',body:JSON.stringify(payload)}); closeDrawer(); toast('渠道已保存'); await channelsPage(); } catch(e){toast(e.message,true);}
    };
    if(id) document.getElementById('c-delete').onclick=async()=>{if(!confirm(`确定删除渠道 ${c.name}？`))return;try{await api(`/api/channels/${id}`,{method:'DELETE'});closeDrawer();toast('渠道已删除');await channelsPage();}catch(e){toast(e.message,true);}};
  }
  async function actionStatus(id, task) { const el=document.getElementById(id);el.textContent='处理中…';try{el.textContent=await task();}catch(e){el.textContent=e.message;el.style.color='var(--danger)';} }

  async function openaiPage() {
    const [c,u]=await Promise.all([api('/api/openai/config'),api('/api/openai/usage')]); let rules;try{rules=JSON.parse(c.cache_rules||'[]')}catch(_){rules=[]}
    app.innerHTML=`<div class="page">${pageHead('OPENAI ROUTE','OpenAI 转发','独立于 Claude 渠道的官方 API 转发配置。','<button class="btn primary" id="o-save">保存配置</button>')}
      <section class="overview-line">${metric('请求',u.total_requests,'累计')}${metric('输入',u.prompt_tokens,'Prompt')}${metric('输出',u.completion_tokens,'Completion')}${metric('推理',u.reasoning_tokens,'Reasoning')}</section>
      <div class="work-grid"><section class="panel"><div class="panel-head"><h3>连接与模型</h3><span class="status ${c.is_active?'on':'warn'}">${c.is_active?'已启用':'未启用'}</span></div><div class="panel-body stack"><div class="form-grid">
      <label class="field full"><span>Base URL</span><input id="o-url" value="${esc(c.base_url||'https://api.openai.com/v1')}"></label><label class="field full"><span>官方 API Key</span><input id="o-key" type="password" autocomplete="off" placeholder="${esc(c.api_key_configured?'已保存 '+c.api_key_mask:'sk-...')}"><small>留空保留已保存的 Key。</small></label>
      <label class="field full"><span>出站代理</span><input id="o-proxy" value="${esc(c.proxy_url||'')}" placeholder="留空直连"></label><label class="field full"><span>模型列表（每行一个）</span><textarea id="o-models">${esc(models(c.models).join('\n'))}</textarea></label></div>
      <div class="inline-actions"><button class="btn" id="o-test">测试连接</button><button class="btn" id="o-fetch">拉取模型</button><span class="row-meta" id="o-status"></span></div>
      <div class="toggle-row"><div class="toggle-copy"><strong>启用 OpenAI 转发</strong><p>客户端使用 /gpt/v1 和访问密钥连接。</p></div><label class="switch"><input id="o-active" type="checkbox" ${c.is_active?'checked':''}><span></span></label></div><div class="toggle-row"><div class="toggle-copy"><strong>思考预算后缀</strong><p>从客户端模型名解析 reasoning effort。</p></div><label class="switch"><input id="o-thinking" type="checkbox" ${c.thinking_alias?'checked':''}><span></span></label></div></div></section>
      <aside class="stack"><section class="panel"><div class="panel-head"><h3>客户端连接</h3></div><div class="panel-body stack"><label class="field"><span>OAI 兼容地址</span><input readonly value="${esc(location.origin+'/gpt/v1')}"></label><p class="notice">密码填写账户设置中的访问密钥，实际官方 Key 不会下发到客户端。</p></div></section><section class="panel"><div class="panel-head"><h3>Prompt Cache</h3></div><div class="panel-body stack"><label class="field"><span>缓存模式</span><input id="o-cache" type="hidden"><div class="segmented" id="o-cache-segments"><button class="segment" data-value="off" type="button">关闭</button><button class="segment" data-value="implicit" type="button">隐式</button><button class="segment" data-value="explicit" type="button">显式断点</button></div></label><label class="field"><span>Prompt cache key</span><input id="o-cache-key" value="${esc(c.cache_key||'')}" placeholder="可留空"></label><div class="rules-builder" id="o-rules-panel"><div id="o-rules"></div><button class="btn" id="o-add-rule" data-add-rule type="button">＋ 添加断点</button><p class="row-meta">断点落在所选消息的最后一个内容块上，最多 4 条。</p></div></div></section></aside></div></div>`;
    activateSegments('o-cache-segments','o-cache',c.cache_mode||'off','o-rules-panel','explicit');
    renderRuleBuilder('o-rules',rules,false);
    document.getElementById('o-add-rule').onclick=()=>{if(rules.length<4){rules.push({direction:'backward',index:2});renderRuleBuilder('o-rules',rules,false);}};
    document.getElementById('o-test').onclick=()=>actionStatus('o-status',async()=>{const d=await api('/api/openai/test',{method:'POST',body:JSON.stringify(oaiConnection())});if(!d.ok)throw new Error(d.error||`HTTP ${d.status}`);return `连接正常 · ${d.latency_ms}ms`;});
    document.getElementById('o-fetch').onclick=()=>actionStatus('o-status',async()=>{const d=await api('/api/openai/fetch-models',{method:'POST',body:JSON.stringify(oaiConnection())});document.getElementById('o-models').value=d.models.join('\n');return `已拉取 ${d.models.length} 个模型`;});
    document.getElementById('o-save').onclick=async()=>{const payload={base_url:formValue('o-url').trim(),api_key:formValue('o-key').trim(),models:JSON.stringify(lines(formValue('o-models'))),is_active:checked('o-active'),proxy_url:formValue('o-proxy').trim(),thinking_alias:checked('o-thinking'),cache_mode:formValue('o-cache'),cache_key:formValue('o-cache-key').trim(),cache_rules:JSON.stringify(formValue('o-cache')==='explicit'?rules:[])};try{await api('/api/openai/config',{method:'PATCH',body:JSON.stringify(payload)});toast('OpenAI 配置已保存');await openaiPage()}catch(e){toast(e.message,true)}};
  }
  function oaiConnection(){return {base_url:formValue('o-url').trim(),api_key:formValue('o-key').trim(),proxy_url:formValue('o-proxy').trim()}}

  async function usagePage() {
    const channels=await api('/api/channels');
    app.innerHTML=`<div class="page">${pageHead('ANALYTICS','用量','按渠道查看 Token、缓存和请求统计。')}<div class="toolbar"><select class="compact-select" id="usage-channel"><option value="">全部渠道</option>${channels.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div id="usage-content"></div></div>`;
    const load=async()=>{const id=formValue('usage-channel');const u=await api(`/api/usage${id?'?channel_id='+id:''}`);const input=(u.total_input||0)+(u.total_cache_creation||0)+(u.total_cache_read||0);const hit=input?Math.round((u.total_cache_read||0)/input*100):0;document.getElementById('usage-content').innerHTML=`<section class="overview-line">${metric('总输入',input,'含缓存读写')}${metric('总输出',u.total_output,'生成 Token')}${metric('请求数',u.total_requests,'累计')}${metric('缓存命中率',hit,'%')}</section><section class="panel"><div class="panel-head"><h3>统计明细</h3><span>${date(u.first_request)} 至 ${date(u.last_request)}</span></div><div class="panel-body stack"><div class="mini-stat"><span>原始输入</span><strong>${fmt(u.total_input)}</strong></div><div class="mini-stat"><span>缓存创建</span><strong>${fmt(u.total_cache_creation)}</strong></div><div class="mini-stat"><span>缓存读取</span><strong>${fmt(u.total_cache_read)}</strong></div><div class="mini-stat"><span>输出</span><strong>${fmt(u.total_output)}</strong></div></div></section>`};document.getElementById('usage-channel').onchange=load;await load();
  }

  async function logsPage() {
    const channels=await api('/api/channels');app.innerHTML=`<div class="page">${pageHead('REQUESTS','请求日志','最近的 Claude 与 OpenAI 路由请求及失败记录。','<button class="btn danger" id="clear-fail">清空失败记录</button>')}<div class="toolbar"><select class="compact-select" id="log-channel"><option value="">全部渠道</option><option value="openai">OpenAI</option>${channels.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button class="btn" id="refresh-logs">刷新</button></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>时间</th><th>渠道</th><th>模型</th><th>输入</th><th>输出</th><th>缓存 写 / 读</th><th>推理</th><th>耗时</th><th>状态</th></tr></thead><tbody id="log-body"></tbody></table></div><div id="log-empty"></div></section><div class="section-title"><h2>失败记录</h2><span>服务重启后清空</span></div><section class="panel"><div class="panel-body stack" id="failures"></div></section></div>`;
    const load=async()=>{const id=formValue('log-channel');const query=id==='openai'?'&source=openai':(id?'&channel_id='+id:'');const [logs,failures]=await Promise.all([api(`/api/logs?limit=100${query}`),api('/api/failures')]);document.getElementById('log-body').innerHTML=logs.map(r=>`<tr><td>${date(r.request_at)}</td><td>${esc(r.channel_name||'—')}</td><td class="code">${esc(r.model||'—')}</td><td>${fmt(r.input_tokens)}</td><td>${fmt(r.output_tokens)}</td><td>${fmt(r.cache_creation_tokens)} / ${fmt(r.cache_read_tokens)}</td><td>${r.source==='openai'?fmt(r.reasoning_tokens):'计入输出'}</td><td>${r.duration_ms||0}ms</td><td><span class="status ${Number(r.status)<400?'on':'warn'}">${r.status}</span></td></tr>`).join('');document.getElementById('log-empty').innerHTML=logs.length?'':'<div class="empty"><strong>暂无请求</strong>新的转发记录会显示在这里。</div>';document.getElementById('failures').innerHTML=failures.length?failures.map(f=>`<div class="failure-item"><div class="row-title">${esc(f.channel||'未知渠道')} · ${esc(f.error_type||(f.upstream_status?'HTTP '+f.upstream_status:'请求失败'))}</div><div class="row-sub">${date(f.ts)} · ${f.streaming?'流式':'非流式'} · ${esc(f.upstream_body||f.error_repr||'')}</div><pre class="failure-request">${esc(JSON.stringify(f.body||{},null,2))}</pre></div>`).join(''):'<div class="empty"><strong>没有失败记录</strong>当前没有捕获到上游错误。</div>'};document.getElementById('log-channel').onchange=load;document.getElementById('refresh-logs').onclick=load;document.getElementById('clear-fail').onclick=async()=>{await api('/api/failures',{method:'DELETE'});toast('失败记录已清空');load()};await load();
  }

  async function settingsPage() {
    const [access,password]=await Promise.all([api('/api/settings/access_key'),api('/api/settings/admin_password')]);
    app.innerHTML=`<div class="page">${pageHead('PREFERENCES','设置','管理客户端访问、安全和当前浏览器的界面风格。')}<div class="work-grid"><section class="panel"><div class="panel-head"><h3>连接与安全</h3></div><div class="panel-body stack"><label class="field"><span>客户端访问密钥</span><input id="s-access" value="${esc(access.value||'')}"><small>Claude 路由与 /gpt/v1 均使用此密钥。</small></label><button class="btn primary" data-save="access_key">保存访问密钥</button><label class="field"><span>管理员密码</span><input id="s-password" type="password" placeholder="输入新密码"><small>修改后在下次登录时生效。</small></label><button class="btn" data-save="admin_password">更新管理员密码</button></div></section><aside class="panel"><div class="panel-head"><h3>界面风格</h3><span>当前浏览器</span></div><div class="panel-body stack"><p class="notice">Atelier 为当前新版。切换只改变管理界面，不影响 API、渠道或数据库。</p><a class="btn dark" href="/ui/atelier">使用 Atelier</a><a class="btn" href="/ui/classic">切换经典版</a><div class="field"><span>客户端地址</span><input readonly value="${esc(location.origin)}"></div><div class="field"><span>OpenAI 地址</span><input readonly value="${esc(location.origin+'/gpt/v1')}"></div></div></aside></div></div>`;
    app.querySelectorAll('[data-save]').forEach(btn=>btn.onclick=async()=>{const key=btn.dataset.save;const value=formValue(key==='access_key'?'s-access':'s-password');if(key==='admin_password'&&!value){toast('请输入新密码',true);return}try{await api(`/api/settings/${key}`,{method:'POST',body:JSON.stringify({value})});toast('设置已保存');if(key==='admin_password')document.getElementById('s-password').value=''}catch(e){toast(e.message,true)}});
  }

  const routes={'/dashboard':dashboardPage,'/page/channels':channelsPage,'/page/openai':openaiPage,'/page/usage':usagePage,'/page/logs':logsPage,'/page/settings':settingsPage};
  (routes[path]||dashboardPage)().catch(e=>{app.innerHTML=`<div class="page"><div class="empty"><strong>页面加载失败</strong>${esc(e.message)}</div></div>`;toast(e.message,true)});
})();
