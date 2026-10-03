// 日志：按来源（Claude 渠道与 OpenAI / Codex / Claude Code）查看请求、失败记录和用量。
import {api, del, esc, icon, fmt, date, shortDate, $, $$, toast, busy, openSheet, sheetHead, confirmDialog, copyText} from '../core.js';
import {pill, empty, metric, segmented, bindSegmented, segValue, card} from '../ui.js';

const SOURCES = [['main', 'Claude 渠道 / OpenAI', '/page/logs'], ['codex', 'Codex', '/page/codex-logs'], ['claudecode', 'Claude Code', '/page/claudecode-logs']];
const VIEWS = [['requests', '请求记录'], ['failures', '错误捕获'], ['usage', '用量']];
const PAGE = 50;

// 统一两种日志结构，页面只处理一种字段名。
const normalize = (source, r) => source === 'main' ? {
  time: r.request_at, who: r.channel_name || '—', model: r.model || '—', effort: '', input: r.input_tokens, output: r.output_tokens,
  cacheWrite: r.cache_creation_tokens, cacheRead: r.cache_read_tokens, reasoning: r.source === 'openai' ? r.reasoning_tokens : null, duration: r.duration_ms, status: r.status, raw: r,
} : {
  time: r.request_at, who: r.account_name || '—', model: r.requested_model || r.model || '—', upstreamModel: r.model, effort: r.thinking_effort || '', input: r.prompt_tokens ?? r.input_tokens, output: r.completion_tokens ?? r.output_tokens,
  cacheWrite: r.cache_write_tokens ?? r.cache_creation_tokens, cacheRead: r.cached_tokens ?? r.cache_read_tokens, reasoning: source === 'codex' ? r.reasoning_tokens : null, duration: r.duration_ms, status: r.status, raw: r,
};
const ok = status => Number(status) > 0 && Number(status) < 400;
const statusPill = status => pill(ok(status) ? 'ok' : 'danger', String(status ?? '—'));

export async function logsPage(ctx, source, defaultView) {
  const view = ctx.params.get('view') || defaultView;
  const sourcePath = s => SOURCES.find(x => x[0] === s)[2];
  const filters = source === 'main'
    ? [['', '全部渠道'], ['openai', 'OpenAI'], ...(await api('/api/channels')).map(c => [String(c.id), c.name])]
    : [['', '全部账号'], ...(await api(`/api/${source}/accounts`)).map(a => [String(a.id), a.name])];
  if (!ctx.alive()) return;
  // 一行视图切换 + 一行筛选：来源也是筛选条件之一，不再单独占一排标签。
  ctx.app.innerHTML = `<div class="page">
    <header class="page-head"><div><h1>日志</h1><p>查看每条转发请求、上游错误详情和 Token 用量。</p></div></header>
    ${segmented('log-view', VIEWS, view)}
    <div class="toolbar filter-bar"><div class="toolbar-left"><select class="select-sm" id="log-source" aria-label="来源">${SOURCES.map(([key, label]) => `<option value="${key}" ${key === source ? 'selected' : ''}>${label}</option>`).join('')}</select><span id="log-filters" class="toolbar-left"></span></div><div class="toolbar-right" id="log-tools"></div></div>
    <div id="log-content"></div></div>`;
  const viewQuery = v => {
    if (v === 'requests') return '';
    const query = new URLSearchParams({view: v});
    if (v === 'usage') for (const key of ['range', 'start_at', 'end_at']) {
      if (ctx.params.has(key)) query.set(key, ctx.params.get(key));
    }
    return `?${query}`;
  };
  bindSegmented('log-view', v => ctx.navigate(`${sourcePath(source)}${viewQuery(v)}`, {replace: true}));
  $('#log-source').onchange = e => ctx.navigate(`${sourcePath(e.target.value)}${viewQuery(view)}`, {replace: true});
  if (view === 'failures') return failuresView(ctx, source, filters);
  if (view === 'usage') return usageView(ctx, source, filters);
  return requestsView(ctx, source, filters);
}

/* ---------- 请求 ---------- */
async function requestsView(ctx, source, filters) {
  $('#log-filters').innerHTML = `<select class="select-sm" id="log-filter" aria-label="筛选">${filters.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>${segmented('log-status', [['all', '全部状态'], ['ok', '成功'], ['bad', '出错']], 'all', {small: true})}`;
  $('#log-tools').innerHTML = `<button class="icon-btn" type="button" id="log-refresh" aria-label="刷新" title="刷新">${icon('refresh')}</button>`;
  const content = $('#log-content');
  let rows = []; let offset = 0; let done = false;
  const url = () => {
    const f = $('#log-filter').value;
    if (source === 'main') return `/api/logs?limit=${PAGE}&offset=${offset}${f === 'openai' ? '&source=openai' : f ? `&channel_id=${f}` : ''}`;
    return `/api/${source}/logs?limit=${PAGE}&offset=${offset}${f ? `&account_id=${f}` : ''}`;
  };
  const paint = () => {
    const status = segValue('log-status');
    const list = rows.filter(r => status === 'all' || (status === 'ok') === ok(r.status));
    const whoLabel = source === 'main' ? '渠道' : '账号';
    // 状态筛选只作用于已加载的记录，结果为空时也保留「加载更多」，并说明范围。
    const more = done ? '<p class="hint center">没有更多记录了</p>' : `<div class="center"><button class="btn" type="button" id="log-more">加载更多</button></div>`;
    const scope = status !== 'all' ? `<p class="hint">在已加载的 ${rows.length} 条记录中筛选${done ? '' : '，加载更多可扩大范围'}。</p>` : '';
    content.innerHTML = list.length ? `${scope}<div class="card table-card"><div class="table-scroll"><table class="log-table"><thead><tr><th>时间</th><th>${whoLabel}</th><th>模型</th><th class="num">输入</th><th class="num">输出</th><th class="num">缓存（写入/读取）</th><th class="num">耗时</th><th>状态</th></tr></thead><tbody>
      ${list.map(r => `<tr data-i="${rows.indexOf(r)}" tabindex="0"><td data-label="时间">${shortDate(r.time)}</td><td data-label="${whoLabel}">${esc(r.who)}</td><td data-label="模型" class="mono">${esc(r.model)}${r.effort ? `<span class="tag">${esc(r.effort)}</span>` : ''}</td><td data-label="输入" class="num">${fmt(r.input)}</td><td data-label="输出" class="num">${fmt(r.output)}</td><td data-label="缓存（写入/读取）" class="num">${fmt(r.cacheWrite)} / ${fmt(r.cacheRead)}</td><td data-label="耗时" class="num">${((r.duration || 0) / 1000).toFixed(1)}s</td><td data-label="状态">${statusPill(r.status)}</td></tr>`).join('')}
      </tbody></table></div></div>${more}`
      : rows.length ? `${empty('list', '已加载的记录里没有符合条件的请求', done ? '换个筛选条件试试。' : `目前只加载了 ${rows.length} 条，可以继续加载更早的记录。`)}${more}`
      : empty('list', '暂无请求记录', '客户端发起请求后会显示在这里。');
    $$('tbody tr', content).forEach(tr => { const open = () => requestDetail(source, rows[Number(tr.dataset.i)]); tr.onclick = open; tr.onkeydown = e => { if (e.key === 'Enter') open(); }; });
    if ($('#log-more')) $('#log-more').onclick = e => busy(e.currentTarget, async () => { await load(true); return ''; });
  };
  const load = async (more = false) => {
    if (!more) { offset = 0; rows = []; done = false; }
    const batch = (await api(url())).map(r => normalize(source, r));
    if (!ctx.alive()) return;
    rows = rows.concat(batch); offset += batch.length; done = batch.length < PAGE;
    paint();
  };
  $('#log-filter').onchange = () => load();
  bindSegmented('log-status', paint);
  $('#log-refresh').onclick = e => busy(e.currentTarget, async () => { await load(); return '已刷新'; });
  await load();
}

function requestDetail(source, r) {
  const rows = [
    ['时间', date(r.time)], [source === 'main' ? '渠道' : '账号', r.who], ['请求模型', r.model],
    ...(r.upstreamModel && r.upstreamModel !== r.model ? [['上游模型', r.upstreamModel]] : []),
    ...(r.effort ? [['思考强度', r.effort]] : []),
    ['输入 Token', Number(r.input || 0).toLocaleString()], ['输出 Token', Number(r.output || 0).toLocaleString()],
    ['缓存（写入/读取）', `${Number(r.cacheWrite || 0).toLocaleString()} / ${Number(r.cacheRead || 0).toLocaleString()}`],
    ['推理 Token', r.reasoning == null ? '计入输出' : Number(r.reasoning || 0).toLocaleString()],
    ['耗时', `${r.duration || 0} ms`], ['HTTP 状态', String(r.status ?? '—')],
  ];
  openSheet(`${sheetHead('请求详情', r.model)}<div class="sheet-body"><dl class="detail">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`);
}

/* ---------- 失败 ---------- */
async function failuresView(ctx, source, filters) {
  const endpoint = source === 'main' ? '/api/failures' : `/api/${source}/failures`;
  const names = Object.fromEntries(filters.filter(([v]) => v).map(([v, l]) => [v, l]));
  const title = f => failTitle(source, f, names);
  $('#log-tools').innerHTML = `<button class="icon-btn" type="button" id="fail-refresh" aria-label="刷新" title="刷新">${icon('refresh')}</button><button class="btn small danger" type="button" id="fail-clear">${icon('trash')}清空</button>`;
  const content = $('#log-content');
  const load = async () => {
    const list = await api(endpoint);
    if (!ctx.alive()) return;
    content.innerHTML = `<div class="notice info">${icon('info')}<div><p>这里保存上游出错时的完整请求体和返回内容，便于排查。只保存在内存中，服务重启后清空；请求记录里状态为「出错」的条目不受影响。</p></div></div>` + (list.length ? `<div class="item-list">${list.map((f, i) => `<article class="item fail" data-i="${i}" tabindex="0"><div class="item-main"><div class="item-title"><strong>${esc(title(f))}</strong>${pill('danger', f.upstream_status ? `HTTP ${f.upstream_status}` : '连接失败')}</div><p class="item-sub">${date(f.ts)} · ${f.streaming ? '流式' : '非流式'}${f.body?.model ? ` · ${esc(f.body.model)}` : ''}</p><p class="item-snippet">${esc(String(f.upstream_body || f.error_repr || '').slice(0, 220))}</p></div><span class="item-chevron">${icon('chevron')}</span></article>`).join('')}</div>` : empty('check', '没有捕获到错误', '当前没有上游错误记录。'));
    $$('.item', content).forEach(el => { const open = () => failDetail(title(list[Number(el.dataset.i)]), list[Number(el.dataset.i)]); el.onclick = open; el.onkeydown = e => { if (e.key === 'Enter') open(); }; });
    $('#fail-clear').disabled = !list.length;
  };
  $('#fail-refresh').onclick = e => busy(e.currentTarget, async () => { await load(); return '已刷新'; });
  $('#fail-clear').onclick = async () => {
    if (!await confirmDialog({title: '清空错误捕获？', message: '只清空当前来源的错误捕获，请求记录不受影响。', confirmText: '清空', danger: true})) return;
    try { await del(endpoint); toast('错误捕获已清空'); load(); } catch (e) { toast(e.message, true); }
  };
  await load();
}
const failTitle = (source, f, names) => source === 'main'
  ? `${f.channel || '未知渠道'}${f.error_type ? ` · ${f.error_type}` : ''}`
  : `${names[String(f.account_id)] || `账号 #${f.account_id}`}${f.error_type ? ` · ${f.error_type}` : ''}`;

function failDetail(titleText, f) {
  const body = JSON.stringify(f.body || {}, null, 2);
  const sheet = openSheet(`${sheetHead('错误详情', titleText)}<div class="sheet-body">
    <dl class="detail"><div><dt>时间</dt><dd>${date(f.ts)}</dd></div><div><dt>上游状态</dt><dd>${esc(f.upstream_status || '连接失败')}</dd></div><div><dt>模式</dt><dd>${f.streaming ? '流式' : '非流式'}</dd></div>${f.error_type ? `<div><dt>错误类型</dt><dd>${esc(f.error_type)}</dd></div>` : ''}</dl>
    <section class="form-section"><div class="row-between"><h4>完整上游请求体</h4><button class="btn small ghost" type="button" id="copy-body">${icon('copy')}复制</button></div><pre class="code-block failure-request">${esc(body)}</pre></section>
    <section class="form-section"><div class="row-between"><h4>上游返回</h4></div><pre class="code-block">${esc(f.upstream_body || f.error_repr || '（无）')}</pre></section></div>`, {wide: true});
  $('#copy-body', sheet).onclick = () => copyText(body, '请求体已复制');
}

/* ---------- 用量 ---------- */
async function usageView(ctx, source, filters) {
  const content = $('#log-content');
  const ranges = [['all', '全部时间'], ['today', '今天'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['custom', '自定义']];
  const savedRange = ctx.params.get('range') || (ctx.params.has('start_at') || ctx.params.has('end_at') ? 'custom' : 'all');
  const initialRange = ranges.some(([v]) => v === savedRange) ? savedRange : 'all';
  const filter = ctx.params.get('filter') || '';
  $('#log-filters').innerHTML = `<select class="select-sm" id="usage-filter" aria-label="筛选">${filters.map(([v, l]) => `<option value="${esc(v)}" ${v === filter ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  $('#log-tools').innerHTML = `<button class="icon-btn" type="button" id="usage-refresh" aria-label="刷新" title="刷新">${icon('refresh')}</button>`;
  content.insertAdjacentHTML('beforebegin', `<form class="usage-period" id="usage-period">
    <label class="field"><span class="label">时间范围</span><select id="usage-range">${ranges.map(([v, l]) => `<option value="${v}" ${v === initialRange ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="usage-dates" id="usage-dates"><label class="field"><span class="label">起始时间</span><input type="datetime-local" step="1" id="usage-start"></label><label class="field"><span class="label">结束时间</span><input type="datetime-local" step="1" id="usage-end"></label></div>
    <button class="btn" type="submit" id="usage-apply">${icon('filter')}应用</button></form>`);
  const form = $('#usage-period'), range = $('#usage-range'), start = $('#usage-start'), end = $('#usage-end');
  const preset = () => {
    const now = new Date(), first = new Date(now);
    first.setHours(0, 0, 0, 0);
    if (range.value === '7d') first.setDate(first.getDate() - 6);
    if (range.value === '30d') first.setDate(first.getDate() - 29);
    start.value = localDateTime(first); end.value = localDateTime(now);
  };
  const showDates = () => {
    $('#usage-dates').hidden = range.value === 'all';
    start.required = end.required = range.value !== 'all';
  };
  preset();
  if (initialRange === 'custom') {
    for (const [key, input] of [['start_at', start], ['end_at', end]]) {
      if (!ctx.params.has(key)) continue;
      const stamp = Number(ctx.params.get(key)), value = new Date(stamp * 1000);
      if (Number.isFinite(stamp) && stamp >= 0 && !Number.isNaN(value.getTime())) input.value = localDateTime(value);
    }
  }
  showDates();
  let sequence = 0;
  const load = async () => {
    const mode = range.value;
    if (mode !== 'all' && mode !== 'custom') preset();
    if (!form.reportValidity()) return '';
    const query = new URLSearchParams();
    let from = null, until = null;
    if (mode !== 'all') {
      from = Math.floor(new Date(start.value).getTime() / 1000);
      until = Math.floor(new Date(end.value).getTime() / 1000);
      if (!Number.isFinite(from) || !Number.isFinite(until) || from < 0 || until < 0 || from > until) throw new Error('请选择有效的起止时间，起始时间不能晚于结束时间');
      query.set('start_at', from); query.set('end_at', until);
    }
    const f = $('#usage-filter').value;
    const request = (path, key = '') => {
      const params = new URLSearchParams(query);
      if (key && f) params.set(key, f);
      return api(`${path}${params.size ? `?${params}` : ''}`);
    };
    const current = ++sequence;
    const [u, oai] = await Promise.all([
      source === 'codex' ? request('/api/codex/usage-summary', 'account_id')
        : source === 'claudecode' ? request('/api/claudecode/usage-summary', 'account_id')
        : f === 'openai' ? request('/api/openai/usage') : request('/api/usage', 'channel_id'),
      source === 'main' && !f ? request('/api/openai/usage') : null,
    ]);
    if (!ctx.alive() || current !== sequence) return '';
    ctx.params.set('view', 'usage'); ctx.params.set('range', mode);
    for (const key of ['start_at', 'end_at']) {
      if (query.has(key)) ctx.params.set(key, query.get(key)); else ctx.params.delete(key);
    }
    if (f) ctx.params.set('filter', f); else ctx.params.delete('filter');
    history.replaceState(null, '', `${ctx.path}?${ctx.params}`);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const scope = `<p class="hint">${from === null ? '全部时间' : `${date(from)} 至 ${date(until)}`} · ${esc(zone)}</p>`;
    if (source === 'main' && f === 'openai') {
      content.innerHTML = scope + openaiUsage(u);
      return '';
    }
    if (source === 'codex') {
      content.innerHTML = `${scope}<div class="metrics">${metric('请求', u.total_requests)}${metric('输入', u.total_input)}${metric('输出', u.total_output)}${metric('推理', u.total_reasoning)}${metric('缓存写入', u.total_cache_creation)}${metric('缓存读取', u.total_cache_read)}</div>
        ${u.by_account.length ? card('按账号', `<div class="bars">${barList(u.by_account.map(a => [a.account_name || `账号 #${a.account_id}`, a.total_input + a.total_output, `${a.total_requests} 次`]))}</div>`) : ''}<p class="hint">${usageSpan(u)}</p>`;
      return '';
    }
    const input = (u.total_input || 0) + (u.total_cache_creation || 0) + (u.total_cache_read || 0);
    const hit = input ? Math.round((u.total_cache_read || 0) / input * 100) : 0;
    content.innerHTML = `${scope}<div class="metrics">${metric('请求', u.total_requests)}${metric('总输入', input, '含缓存读写')}${metric('输出', u.total_output)}${metric('缓存命中率', `${hit}%`, '缓存读取 / 总输入', true)}</div>
      ${card(source === 'main' ? 'Claude 渠道明细' : 'Claude Code 明细', `<div class="bars">${barList([['原始输入', u.total_input], ['缓存写入', u.total_cache_creation], ['缓存读取', u.total_cache_read], ['输出', u.total_output]])}</div><p class="hint">${usageSpan(u)}</p>`)}
      ${oai ? card('OpenAI', openaiUsage(oai)) : ''}`;
    return '';
  };
  const refresh = () => load().catch(e => { if (ctx.alive()) toast(e.message, true); });
  range.onchange = () => {
    showDates();
    if (range.value === 'custom') return;
    refresh();
  };
  start.oninput = end.oninput = () => { range.value = 'custom'; };
  form.onsubmit = e => { e.preventDefault(); busy($('#usage-apply'), load); };
  $('#usage-filter').onchange = refresh;
  $('#usage-refresh').onclick = e => busy(e.currentTarget, load);
  await load();
}
function localDateTime(value) {
  const pad = n => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}
const usageSpan = u => u.total_requests ? `有记录的时间：${date(u.first_request)} 至 ${date(u.last_request)}` : '该时间范围内暂无请求记录';
const openaiUsage = u => `<div class="metrics">${metric('请求', u.total_requests)}${metric('输入', u.prompt_tokens)}${metric('输出', u.completion_tokens)}${metric('推理', u.reasoning_tokens)}${metric('缓存写入', u.cache_write_tokens)}${metric('缓存读取', u.cached_tokens)}</div><p class="hint">${usageSpan(u)}</p>`;
function barList(items) {
  const max = Math.max(1, ...items.map(([, v]) => Number(v || 0)));
  return items.map(([label, v, note]) => `<div class="bar-row"><div class="bar-label"><span>${esc(label)}</span><strong>${fmt(v)}${note ? ` <small>${esc(note)}</small>` : ''}</strong></div><div class="bar"><i class="ok" style="width:${Number(v || 0) / max * 100}%"></i></div></div>`).join('');
}
