// 可复用的表单与展示组件。各页面只拼装这些组件，保证四类路由操作一致。
import {esc, icon, fmt, date, lines, $, $$, api, post, busy, toast, copyText, confirmDialog} from './core.js';

let uid = 0;
const nextId = prefix => `${prefix}-${++uid}`;

export const pill = (tone, text) => `<span class="pill ${tone}"><i></i>${esc(text)}</span>`;
export const field = (label, control, hint = '', cls = '') => `<label class="field ${cls}"><span class="label">${esc(label)}</span>${control}${hint ? `<small class="hint">${hint}</small>` : ''}</label>`;
export const switchControl = (id, checked, label = '') => `<label class="switch"${label ? ` aria-label="${esc(label)}"` : ''}><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}><span></span></label>`;
export const toggleRow = (id, title, desc, checked) => `<div class="toggle-row"><div><strong>${esc(title)}</strong>${desc ? `<p>${desc}</p>` : ''}</div>${switchControl(id, checked, title)}</div>`;
export const card = (title, body, {sub = '', actions = '', cls = '', iconName = ''} = {}) => `<section class="card ${cls}">${title ? `<header class="card-head"><div class="card-title">${iconName ? `<span class="card-ico">${icon(iconName)}</span>` : ''}<div><h3>${esc(title)}</h3>${sub ? `<p>${sub}</p>` : ''}</div></div>${actions ? `<div class="card-actions">${actions}</div>` : ''}</header>` : ''}<div class="card-body">${body}</div></section>`;
export const empty = (iconName, title, text = '', action = '') => `<div class="empty"><span class="empty-ico">${icon(iconName)}</span><strong>${esc(title)}</strong>${text ? `<p>${text}</p>` : ''}${action}</div>`;
export const metric = (label, value, note = '', raw = false) => `<div class="metric"><span>${esc(label)}</span><strong>${raw ? esc(value) : fmt(value)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
export const val = id => document.getElementById(id)?.value ?? '';
export const isChecked = id => document.getElementById(id)?.checked ? 1 : 0;

// 单选分段按钮：radiogroup 语义，Tab 只停在选中项，方向键 / Home / End 切换。
export function segmented(id, options, value, {small = false, label = ''} = {}) {
  const current = options.some(([v]) => v === value) ? value : options[0]?.[0];
  return `<div class="segmented ${small ? 'small' : ''}" id="${id}" role="radiogroup"${label ? ` aria-label="${esc(label)}"` : ''} data-value="${esc(value)}">${options.map(([v, text]) => `<button type="button" role="radio" data-value="${esc(v)}" class="${v === value ? 'active' : ''}" aria-checked="${v === value}" tabindex="${v === current ? 0 : -1}">${esc(text)}</button>`).join('')}</div>`;
}
export function bindSegmented(id, onChange) {
  const root = document.getElementById(id);
  const buttons = $$('button', root);
  buttons.forEach(btn => btn.onclick = () => {
    root.dataset.value = btn.dataset.value;
    buttons.forEach(b => { const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    onChange?.(btn.dataset.value);
  });
  root.onkeydown = e => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const next = {ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1}[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = buttons[(next + buttons.length) % buttons.length];
    target.focus(); target.click();
  };
}
// 可点击的整行（列表项、表格行）：Enter 和空格都能打开，焦点在行内按钮上时不触发。
export function onActivateKey(el, open) {
  el.onkeydown = e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } };
}
export const segValue = id => document.getElementById(id)?.dataset.value ?? '';

export function secretInput(id, value = '', placeholder = '', attrs = '') {
  return `<div class="input-group"><input id="${id}" type="password" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" ${attrs}><button class="icon-btn ghost" type="button" data-reveal="${id}" aria-label="显示或隐藏">${icon('eye')}</button></div>`;
}
export function bindReveal(root = document) {
  $$('[data-reveal]', root).forEach(btn => btn.onclick = () => {
    const input = document.getElementById(btn.dataset.reveal);
    const show = input.type === 'password'; input.type = show ? 'text' : 'password';
    btn.innerHTML = icon(show ? 'eyeOff' : 'eye');
  });
}

// 只读值 + 复制按钮；secret 为真时默认打码。
export function copyRow(label, value, {secret = false, mono = true} = {}) {
  const id = nextId('copy');
  const shown = secret ? '•'.repeat(Math.min(Math.max(String(value).length, 8), 18)) : value;
  return `<div class="copy-row"><div class="copy-text"><span class="label">${esc(label)}</span><code class="${mono ? '' : 'plain'}" id="${id}" data-secret="${secret ? '1' : ''}">${esc(shown)}</code></div><div class="copy-actions">${secret ? `<button class="icon-btn ghost" type="button" data-unmask="${id}" aria-label="显示">${icon('eye')}</button>` : ''}<button class="icon-btn" type="button" data-copy="${esc(value)}" aria-label="复制${esc(label)}">${icon('copy')}</button></div></div>`;
}
export function bindCopy(root = document) {
  $$('[data-copy]', root).forEach(btn => btn.onclick = e => { e.stopPropagation(); copyText(btn.dataset.copy); btn.innerHTML = icon('check'); setTimeout(() => btn.innerHTML = icon('copy'), 1400); });
  $$('[data-unmask]', root).forEach(btn => btn.onclick = () => {
    const code = document.getElementById(btn.dataset.unmask);
    const value = btn.nextElementSibling.dataset.copy;
    const masked = code.textContent !== value;
    code.textContent = masked ? value : '•'.repeat(Math.min(Math.max(value.length, 8), 18));
    btn.innerHTML = icon(masked ? 'eyeOff' : 'eye');
  });
}

// 模型编辑：标签式列表，可逐个添加/删除，也可切换为批量文本编辑。
const modelState = new Map();
export function modelEditor(id, list, {fetchLabel = '', placeholder = '输入模型名，回车添加'} = {}) {
  modelState.set(id, [...list]);
  return `<div class="model-editor" id="${id}"><div class="chips" data-chips></div>
    <div class="model-add"><input data-model-input placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"><button class="btn small" type="button" data-model-add>${icon('plus')}添加</button></div>
    <textarea data-model-bulk hidden rows="6" spellcheck="false" placeholder="每行一个模型"></textarea>
    <div class="row-actions"><button class="btn small ghost" type="button" data-model-mode>批量编辑</button><button class="btn small ghost" type="button" data-model-clear>清空</button>${fetchLabel ? `<button class="btn small" type="button" data-model-fetch>${icon('download')}${esc(fetchLabel)}</button>` : ''}<span class="hint" data-model-status></span></div></div>`;
}
export function bindModelEditor(id, {onFetch = null} = {}) {
  const root = document.getElementById(id);
  const chips = $('[data-chips]', root), input = $('[data-model-input]', root), bulk = $('[data-model-bulk]', root);
  const render = () => {
    const list = modelState.get(id);
    chips.innerHTML = list.length ? list.map((m, i) => `<span class="chip">${esc(m)}<button type="button" data-remove="${i}" aria-label="移除 ${esc(m)}">${icon('close')}</button></span>`).join('') : '<span class="hint">还没有模型。可手动添加，或从上游拉取。</span>';
    $$('[data-remove]', chips).forEach(b => b.onclick = () => { modelState.get(id).splice(Number(b.dataset.remove), 1); render(); root.dispatchEvent(new Event('change', {bubbles: true})); });
  };
  const add = () => {
    const items = lines(input.value); if (!items.length) return;
    modelState.set(id, [...new Set([...modelState.get(id), ...items])]); input.value = ''; render();
    root.dispatchEvent(new Event('change', {bubbles: true}));
  };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  $('[data-model-add]', root).onclick = add;
  $('[data-model-mode]', root).onclick = e => {
    const toBulk = bulk.hidden;
    if (toBulk) bulk.value = modelState.get(id).join('\n'); else modelState.set(id, lines(bulk.value));
    bulk.hidden = !toBulk; chips.hidden = toBulk; $('.model-add', root).hidden = toBulk;
    e.currentTarget.textContent = toBulk ? '完成批量编辑' : '批量编辑';
    render();
  };
  bulk.oninput = () => modelState.set(id, lines(bulk.value));
  const setList = list => { modelState.set(id, list); bulk.value = list.join('\n'); render(); root.dispatchEvent(new Event('change', {bubbles: true})); };
  $('[data-model-clear]', root).onclick = async () => {
    const current = getModels(id);
    if (!current.length) return;
    if (!await confirmDialog({title: `清空全部 ${current.length} 个模型？`, message: '清空后需要保存才会生效；保存前可点「放弃」恢复。', confirmText: '清空', danger: true})) return;
    setList([]);
  };
  const fetchBtn = $('[data-model-fetch]', root);
  if (fetchBtn && onFetch) fetchBtn.onclick = () => busy(fetchBtn, async () => {
    const list = await onFetch();
    const current = getModels(id);
    const added = list.filter(m => !current.includes(m));
    const missing = current.filter(m => !list.includes(m));
    if (!current.length || !missing.length) {
      setList([...new Set([...current, ...list])]);
      return `已拉取 ${list.length} 个模型，新增 ${added.length} 个`;
    }
    // 当前列表里有上游没返回的模型时，让用户决定保留还是替换。
    const choice = await confirmDialog({title: `上游返回 ${list.length} 个模型`, message: `新增 ${added.length} 个；当前列表里有 ${missing.length} 个不在上游结果中（如手动添加的别名）。合并会保留它们，替换会删除它们。`, confirmText: '替换', altText: '合并'});
    if (!choice) return '已取消，模型列表未改动';
    setList(choice === 'alt' ? [...new Set([...current, ...list])] : list);
    return choice === 'alt' ? `已合并，新增 ${added.length} 个` : `已替换为上游的 ${list.length} 个模型`;
  }, $('[data-model-status]', root));
  render();
}
export const getModels = id => {
  const root = document.getElementById(id);
  const bulk = root && $('[data-model-bulk]', root);
  return bulk && !bulk.hidden ? lines(bulk.value) : [...(modelState.get(id) || [])];
};

// 缓存断点规则：withTarget 时可选 system / messages。
const ruleState = new Map();
export function rulesEditor(id, rules, withTarget) {
  ruleState.set(id, rules.map(r => ({...r})));
  return `<div class="rules" id="${id}" data-target="${withTarget ? 1 : 0}"><div data-rule-list></div><button class="btn small" type="button" data-rule-add>${icon('plus')}添加断点</button><p class="hint">${withTarget ? '每条断点选择 system 或 messages，再选正数或倒数第几条。' : '断点落在所选消息的最后一个内容块上。'}最多 4 条。</p></div>`;
}
export function bindRulesEditor(id) {
  const root = document.getElementById(id); const withTarget = root.dataset.target === '1';
  const listEl = $('[data-rule-list]', root), addBtn = $('[data-rule-add]', root);
  const changed = () => root.dispatchEvent(new Event('change', {bubbles: true}));
  const render = () => {
    const rules = ruleState.get(id);
    addBtn.hidden = rules.length >= 4;
    listEl.innerHTML = rules.length ? rules.map((r, i) => `<div class="rule" data-i="${i}"><span class="rule-no">${i + 1}</span>
      ${withTarget ? `<select data-f="target" aria-label="位置"><option value="system" ${r.target === 'system' ? 'selected' : ''}>system</option><option value="messages" ${r.target !== 'system' ? 'selected' : ''}>messages</option></select>` : ''}
      <select data-f="direction" aria-label="方向"><option value="forward" ${r.direction === 'forward' ? 'selected' : ''}>正数第</option><option value="backward" ${r.direction !== 'forward' ? 'selected' : ''}>倒数第</option></select>
      <input data-f="index" type="number" min="1" max="999" inputmode="numeric" value="${Math.max(1, Number(r.index) || 1)}" aria-label="序号"><span class="hint">${withTarget ? '条' : '条消息'}</span>
      <button class="icon-btn ghost" type="button" data-del aria-label="删除断点">${icon('trash')}</button></div>`).join('') : '<p class="hint">还没有断点。</p>';
    $$('.rule', listEl).forEach(row => {
      const rule = rules[Number(row.dataset.i)];
      $$('[data-f]', row).forEach(c => c.onchange = () => { rule[c.dataset.f] = c.dataset.f === 'index' ? Math.max(1, Number(c.value) || 1) : c.value; });
      $('[data-del]', row).onclick = () => { rules.splice(Number(row.dataset.i), 1); render(); changed(); };
    });
  };
  addBtn.onclick = () => { const rules = ruleState.get(id); if (rules.length < 4) { rules.push(withTarget ? {target: 'messages', direction: 'backward', index: 2} : {direction: 'backward', index: 2}); render(); changed(); } };
  render();
}
export const getRules = id => (ruleState.get(id) || []).map(r => ({...r}));

// 出站代理输入 + 连通性测试。
export function proxyInput(id, value, {hint = '支持 http / https / socks5 链接，或 host:port:user:password。留空为直连。'} = {}) {
  return field('出站代理', `<div class="input-group"><input id="${id}" value="${esc(value || '')}" placeholder="留空为直连" autocomplete="off" spellcheck="false"><button class="btn small" type="button" data-proxy-test="${id}">测试</button></div>`, `<span data-proxy-status="${id}">${hint}</span>`);
}
export function bindProxyTest(id, targetUrl) {
  const btn = $(`[data-proxy-test="${id}"]`); const status = $(`[data-proxy-status="${id}"]`);
  btn.onclick = () => busy(btn, async () => {
    const d = await post('/api/proxy-test', {proxy_url: val(id).trim(), target_url: typeof targetUrl === 'function' ? targetUrl() : targetUrl});
    if (!d.ok) throw new Error(d.error || '连接失败');
    return `连通，延迟 ${d.latency_ms}ms${d.exit_ip ? `，出口 IP ${d.exit_ip}` : ''}`;
  }, status);
}

// 订阅额度：把 Codex 与 Claude Code 两种用量结构统一为窗口列表。
const usageLabels = {five_hour: '5 小时', five_hour_opus: '5 小时 Opus', seven_day: '每周', seven_day_opus: 'Opus 每周', seven_day_sonnet: 'Sonnet 每周', seven_day_fable: 'Fable 每周', seven_day_fableonly: 'Fable Only 每周', seven_day_total: '每周总计', seven_day_overage_included: '每周附加额度'};
const usageNumber = value => (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null;
const usageKey = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export function quotaWindows(usage) {
  const windows = []; const rate = usage?.rate_limit || {};
  // Both upstream fields are percentages, including values between 0 and 1.
  const push = (name, w) => {
    if (!w || typeof w !== 'object') return;
    windows.push({name, pct: usageNumber(w.used_percent ?? w.utilization ?? w.percent ?? w.used_percentage), reset: w.reset_at ?? w.resets_at});
  };
  if (rate.primary_window) push('5 小时', rate.primary_window);
  if (rate.secondary_window) push('每周', rate.secondary_window);
  (Array.isArray(usage?.additional_rate_limits) ? usage.additional_rate_limits : []).forEach(x => { const name = x.limit_name || x.metered_feature || '独立窗口'; if (x.rate_limit?.primary_window) push(name, x.rate_limit.primary_window); if (x.rate_limit?.secondary_window) push(`${name} 每周`, x.rate_limit.secondary_window); });
  if (windows.length || !usage || typeof usage !== 'object') return windows;
  const seen = new Set();
  // New Claude responses enumerate scoped limits here; keep unknown kinds too.
  for (const limit of Array.isArray(usage.limits) ? usage.limits : []) {
    if (!limit || typeof limit !== 'object') continue;
    const kind = String(limit.kind || '');
    const scope = limit.scope || {};
    const model = typeof scope.model === 'string' ? scope.model : scope.model?.display_name || scope.model?.id || '';
    const surface = typeof scope.surface === 'string' ? scope.surface : scope.surface?.display_name || scope.surface?.id || '';
    const scopeName = [model, surface].filter(Boolean).join(' · ');
    const aliases = [];
    let name = limit.display_name || limit.label || limit.name || kind || `窗口 ${windows.length + 1}`;
    if (kind === 'session') {
      name = scopeName ? `${scopeName} 会话窗口` : '5 小时';
      if (!scopeName) aliases.push('five_hour');
    } else if (kind === 'weekly_all') { name = '每周'; aliases.push('seven_day'); }
    else if (kind === 'weekly_scoped' && scopeName) {
      name = `${scopeName} 每周`;
      aliases.push(`seven_day_${usageKey(scopeName)}`);
      if (model && !surface && scope.model?.id) aliases.push(`seven_day_${usageKey(scope.model.id)}`);
    } else if (scopeName) name = `${scopeName} · ${name}`;
    push(String(name), limit);
    aliases.forEach(key => seen.add(key));
  }
  for (const [key, value] of Object.entries(usage)) {
    if (seen.has(usageKey(key)) || key === 'extra_usage' || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (['utilization', 'used_percent', 'percent', 'used_percentage'].some(field => field in value)) push(usageLabels[key] || key, value);
  }
  const extra = usage.extra_usage;
  if (extra && extra.is_enabled === true && usageNumber(extra.utilization) !== null) push('额外用量', extra);
  return windows;
}
const resetStamp = reset => {
  if (!reset) return 0;
  const numeric = usageNumber(reset);
  const ts = numeric !== null ? (numeric > 1e12 ? numeric / 1000 : numeric) : Date.parse(reset) / 1000;
  return Number.isFinite(ts) ? ts : 0;
};
const resetText = reset => {
  const ts = resetStamp(reset);
  if (!ts) return '';
  const left = ts - Date.now() / 1000;
  if (left <= 0) return '已重置';
  if (left < 3600) return `${Math.ceil(left / 60)} 分钟后重置`;
  if (left < 86400) return `${Math.round(left / 3600)} 小时后重置`;
  return `${Math.round(left / 86400)} 天后重置`;
};
export const agoText = ts => {
  const passed = Date.now() / 1000 - Number(ts || 0);
  if (!ts || passed < 0) return '';
  if (passed < 60) return '刚刚';
  if (passed < 3600) return `${Math.floor(passed / 60)} 分钟前`;
  if (passed < 86400) return `${Math.floor(passed / 3600)} 小时前`;
  return `${Math.floor(passed / 86400)} 天前`;
};
// 相对时间元素：渲染时写一次，之后每分钟刷新，页面放久了也不会过时。
export const resetLabel = reset => { const ts = resetStamp(reset); return ts ? `<span data-reset-at="${ts}">${esc(resetText(ts))}</span>` : ''; };
export const agoLabel = ts => ts ? `<span data-ago="${Number(ts)}">${esc(agoText(ts))}</span>` : '';
setInterval(() => {
  $$('[data-reset-at]').forEach(el => { el.textContent = resetText(Number(el.dataset.resetAt)); });
  $$('[data-ago]').forEach(el => { el.textContent = agoText(Number(el.dataset.ago)); });
}, 60000);
export const quotaTone = pct => pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
export function quotaBars(usage, {compact = false} = {}) {
  const windows = quotaWindows(usage);
  const credits = usage?.credits;
  const extra = [];
  if (credits) extra.push(`<span class="meta-item">Credits ${credits.unlimited ? '无限' : esc(credits.balance ?? (credits.has_credits ? '可用' : '—'))}</span>`);
  if (usage?.rate_limit_reset_credits?.available_count != null) extra.push(`<span class="meta-item">窗口重置券 ${fmt(usage.rate_limit_reset_credits.available_count)}</span>`);
  if (usage?.extra_usage) {
    const e = usage.extra_usage;
    extra.push(`<span class="meta-item">额外用量：${e.is_enabled === true ? '已启用' : e.is_enabled === false ? '未启用' : '状态未返回'}</span>`);
    if (e.is_enabled === true) {
      const currency = e.currency || 'USD';
      const money = n => `${(n / 100).toFixed(2)} ${currency}`;
      if (usageNumber(e.used_credits) !== null) extra.push(`<span class="meta-item">已用 ${esc(money(Number(e.used_credits)))}</span>`);
      if (usageNumber(e.monthly_limit) !== null) extra.push(`<span class="meta-item">月上限 ${esc(money(Number(e.monthly_limit)))}</span>`);
    }
  }
  const raw = !compact && usage && Object.keys(usage).length ? `<details class="usage-raw"><summary>上游用量原始数据</summary><pre>${esc(JSON.stringify(usage, null, 2))}</pre></details>` : '';
  if (!windows.length) return `<p class="hint">${compact ? '尚未获取额度' : '暂未返回可显示的额度窗口。'}</p>${extra.length ? `<div class="meta-line">${extra.join('')}</div>` : ''}${raw}`;
  // 精简模式把重置时间放在窗口名后面，账号列表里也能看到什么时候恢复。
  return `<div class="quota ${compact ? 'compact' : ''}">${windows.map(w => {
    const known = w.pct !== null; const pct = known ? Math.max(0, Math.min(100, w.pct)) : 0;
    const reset = resetLabel(w.reset); const stamp = resetStamp(w.reset);
    return `<div class="quota-row"><div class="quota-label"><span>${esc(w.name)}${compact && reset ? `<small class="quota-reset"> · ${reset}</small>` : ''}</span><span class="quota-num ${quotaTone(pct)}">${known ? `${w.pct.toFixed(compact && Number.isInteger(w.pct) ? 0 : 1)}%` : '未返回'}</span></div>
      <div class="bar ${known ? '' : 'unknown'}" role="progressbar" aria-label="${esc(w.name)} 已用比例" aria-valuemin="0" aria-valuemax="100" ${known ? `aria-valuenow="${pct}"` : 'aria-valuetext="上游未返回百分比"'}><i class="${quotaTone(pct)}" style="width:${pct}%"></i></div>
      ${compact ? '' : `<small class="hint">${stamp ? `${esc(date(stamp))} · ${reset}` : '上游未注明重置时间'}</small>`}</div>`;
  }).join('')}</div>${extra.length ? `<div class="meta-line">${extra.join('')}</div>` : ''}${raw}`;
}

// 未保存修改提示栏：对比表单快照，有差异时出现在底部。
let activeForm = null;
export function watchForm(root, getState, save) {
  const bar = document.getElementById('savebar');
  let baseline = JSON.stringify(getState());
  const check = () => {
    if (!root.isConnected) { if (activeForm?.root === root) clearForm(); return; }
    const dirty = JSON.stringify(getState()) !== baseline;
    bar.classList.toggle('show', dirty); document.body.classList.toggle('has-savebar', dirty);
  };
  const schedule = () => setTimeout(check, 0);
  root.addEventListener('input', schedule); root.addEventListener('change', schedule); root.addEventListener('click', schedule);
  bar.innerHTML = `<div class="savebar-inner"><span>${icon('info')}有未保存的修改</span><div class="row-actions"><button class="btn small ghost" type="button" data-discard>放弃</button><button class="btn small primary" type="button" data-save>保存</button></div></div>`;
  activeForm = {root, dirty: () => root.isConnected && JSON.stringify(getState()) !== baseline};
  $('[data-save]', bar).onclick = e => busy(e.currentTarget, async () => { await save(); baseline = JSON.stringify(getState()); check(); return '已保存'; });
  $('[data-discard]', bar).onclick = () => { activeForm = null; bar.classList.remove('show'); document.body.classList.remove('has-savebar'); document.dispatchEvent(new CustomEvent('reload-page')); };
  check();
}
export function clearForm() { activeForm = null; const bar = document.getElementById('savebar'); bar.classList.remove('show'); document.body.classList.remove('has-savebar'); }
export const hasUnsaved = () => !!activeForm?.dirty();

// Claude 格式入口的两种写法：Claude Code CLI 填到路由名为止，其他客户端 / SDK 带 /v1。
export function endpointRows(base) {
  return `<div class="endpoint-rows">${copyRow('Claude Code CLI（ANTHROPIC_BASE_URL）', base)}${copyRow('酒馆反代 / SDK / 其他客户端', `${base}/v1`)}</div>`;
}

// 接入指引：设置页展示全部，各路由「接入方式」标签只展示自己的那一条。片段里 {KEY} 在复制时换成访问密钥。
export function accessGuides(origin) {
  return {
    claudecode: {title: 'Claude Code（订阅账号）', iconName: 'bolt', desc: '在终端设置环境变量后启动 claude。', url: `${origin}/claudecode`,
      snippet: `export ANTHROPIC_BASE_URL="${origin}/claudecode"\nexport ANTHROPIC_AUTH_TOKEN="{KEY}"`},
    channels: {title: 'Claude 渠道', iconName: 'layers', desc: '把 &lt;渠道名&gt; 换成「路由 → Claude 渠道」里的名称。Claude Code 也用这种写法。', url: `${origin}/<渠道名>/v1`,
      snippet: `export ANTHROPIC_BASE_URL="${origin}/<渠道名>"\nexport ANTHROPIC_AUTH_TOKEN="{KEY}"`},
    openai: {title: 'OpenAI 兼容客户端', iconName: 'sparkle', desc: 'Cherry Studio、Chatbox 等选择 OpenAI 类型，填写下面的地址和密钥。', url: `${origin}/gpt/v1`,
      snippet: `Base URL: ${origin}/gpt/v1\nAPI Key: {KEY}`},
    codex: {title: 'Codex（订阅账号）', iconName: 'terminal', desc: '支持 /chat/completions 和 /responses。Codex CLI 可在 ~/.codex/config.toml 中添加：', url: `${origin}/codex/v1`,
      snippet: `[model_providers.catche]\nname = "Claude Catche"\nbase_url = "${origin}/codex/v1"\nenv_key = "CATCHE_KEY"\nwire_api = "responses"\n\n# 终端中：export CATCHE_KEY="{KEY}"`},
  };
}
export function guideCard(guide, key, {address = ''} = {}) {
  return card(guide.title, `<p class="hint">${guide.desc}</p>${address || copyRow('接入地址', guide.url)}<div class="snippet"><pre>${esc(guide.snippet.replace('{KEY}', '<访问密钥>'))}</pre><button class="icon-btn" type="button" data-snippet="${esc(guide.snippet)}" aria-label="复制配置片段">${icon('copy')}</button></div>`, {iconName: guide.iconName});
}
// getKey 返回当前访问密钥；复制时才替换，页面上始终显示占位符。
export function bindSnippets(root, getKey) {
  $$('[data-snippet]', root).forEach(b => b.onclick = () => copyText(b.dataset.snippet.replace('{KEY}', getKey() || '<访问密钥>'), '配置片段已复制'));
}

export {api, post, toast, busy, esc, icon};
