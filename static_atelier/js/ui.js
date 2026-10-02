// 可复用的表单与展示组件。各页面只拼装这些组件，保证四类路由操作一致。
import {esc, icon, fmt, date, lines, $, $$, api, post, busy, toast, copyText} from './core.js';

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

export function segmented(id, options, value, {small = false} = {}) {
  return `<div class="segmented ${small ? 'small' : ''}" id="${id}" role="tablist" data-value="${esc(value)}">${options.map(([v, label]) => `<button type="button" role="tab" data-value="${esc(v)}" class="${v === value ? 'active' : ''}" aria-selected="${v === value}">${esc(label)}</button>`).join('')}</div>`;
}
export function bindSegmented(id, onChange) {
  const root = document.getElementById(id);
  $$('button', root).forEach(btn => btn.onclick = () => {
    root.dataset.value = btn.dataset.value;
    $$('button', root).forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
    onChange?.(btn.dataset.value);
  });
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
  $('[data-model-clear]', root).onclick = () => { modelState.set(id, []); bulk.value = ''; render(); root.dispatchEvent(new Event('change', {bubbles: true})); };
  const fetchBtn = $('[data-model-fetch]', root);
  if (fetchBtn && onFetch) fetchBtn.onclick = () => busy(fetchBtn, async () => {
    const list = await onFetch();
    modelState.set(id, list); bulk.value = list.join('\n'); render();
    root.dispatchEvent(new Event('change', {bubbles: true}));
    return `已拉取 ${list.length} 个模型`;
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
const usageLabels = {five_hour: '5 小时', five_hour_opus: '5 小时 Opus', seven_day: '每周', seven_day_opus: 'Opus 每周', seven_day_sonnet: 'Sonnet 每周', seven_day_total: '每周总计'};
export function quotaWindows(usage) {
  const windows = []; const rate = usage?.rate_limit || {};
  // Both upstream fields are percentages, including values between 0 and 1.
  const push = (name, w) => { const used = Number(w.used_percent ?? w.utilization ?? 0); windows.push({name, pct: Number.isFinite(used) ? used : 0, reset: w.reset_at ?? w.resets_at}); };
  if (rate.primary_window) push('5 小时', rate.primary_window);
  if (rate.secondary_window) push('每周', rate.secondary_window);
  (usage?.additional_rate_limits || []).forEach(x => { const name = x.limit_name || x.metered_feature || '独立窗口'; if (x.rate_limit?.primary_window) push(name, x.rate_limit.primary_window); if (x.rate_limit?.secondary_window) push(`${name} 每周`, x.rate_limit.secondary_window); });
  if (!windows.length && usage && typeof usage === 'object') for (const [key, value] of Object.entries(usage)) if (value && typeof value === 'object' && ('utilization' in value || 'used_percent' in value)) push(usageLabels[key] || key, value);
  return windows;
}
const resetText = reset => {
  if (!reset) return '';
  const ts = typeof reset === 'number' ? reset : Date.parse(reset) / 1000;
  if (!ts) return '';
  const left = ts - Date.now() / 1000;
  if (left <= 0) return '已重置';
  if (left < 3600) return `${Math.ceil(left / 60)} 分钟后重置`;
  if (left < 86400) return `${Math.round(left / 3600)} 小时后重置`;
  return `${Math.round(left / 86400)} 天后重置`;
};
export const quotaTone = pct => pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
export function quotaBars(usage, {compact = false} = {}) {
  const windows = quotaWindows(usage);
  const credits = usage?.credits;
  const extra = [];
  if (credits) extra.push(`<span class="meta-item">Credits ${credits.unlimited ? '无限' : esc(credits.balance ?? (credits.has_credits ? '可用' : '—'))}</span>`);
  if (usage?.rate_limit_reset_credits?.available_count != null) extra.push(`<span class="meta-item">窗口重置券 ${fmt(usage.rate_limit_reset_credits.available_count)}</span>`);
  if (!windows.length) return `<p class="hint">${compact ? '尚未获取额度' : '还没有额度数据，点击「刷新用量」获取。'}</p>${extra.length ? `<div class="meta-line">${extra.join('')}</div>` : ''}`;
  return `<div class="quota ${compact ? 'compact' : ''}">${windows.map(w => { const pct = Math.max(0, Math.min(100, w.pct)); return `<div class="quota-row"><div class="quota-label"><span>${esc(w.name)}</span><span class="quota-num ${quotaTone(pct)}">${pct.toFixed(compact ? 0 : 1)}%</span></div><div class="bar"><i class="${quotaTone(pct)}" style="width:${pct}%"></i></div>${compact ? '' : `<small class="hint">${esc(resetText(w.reset) || (w.reset ? '重置于 ' + date(w.reset) : ''))}</small>`}</div>`; }).join('')}</div>${extra.length ? `<div class="meta-line">${extra.join('')}</div>` : ''}`;
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

export {api, post, toast, busy, esc, icon};
