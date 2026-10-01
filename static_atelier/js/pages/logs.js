// 日志：按来源（Claude 渠道与 OpenAI / Codex / Claude Code）查看请求、失败记录和用量。
import {api, del, esc, icon, fmt, date, shortDate, $, $$, toast, busy, openSheet, sheetHead, confirmDialog, copyText} from '../core.js';
import {pill, empty, metric, segmented, bindSegmented, segValue, card} from '../ui.js';

const SOURCES = [['main', 'Claude 渠道与 OpenAI', '/page/logs'], ['codex', 'Codex', '/page/codex-logs'], ['claudecode', 'Claude Code', '/page/claudecode-logs']];
const VIEWS = [['requests', '请求'], ['failures', '失败'], ['usage', '用量']];
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
  ctx.app.innerHTML = `<div class="page">
    <header class="page-head"><div><h1>日志</h1><p>查看每条转发请求、失败原因和 Token 用量。</p></div></header>
    <div class="route-tabs">${SOURCES.map(([key, label, href]) => `<a href="${href}${view !== 'requests' ? `?view=${view}` : ''}" class="${key === source ? 'active' : ''}">${label}</a>`).join('')}</div>
    <div class="toolbar">${segmented('log-view', VIEWS, view)}<div class="toolbar-right" id="log-tools"></div></div>
    <div id="log-content"></div></div>`;
  bindSegmented('log-view', v => ctx.navigate(`${sourcePath(source)}${v === 'requests' ? '' : `?view=${v}`}`, {replace: true}));
  if (view === 'failures') return failuresView(ctx, source);
  if (view === 'usage') return usageView(ctx, source, filters);
  return requestsView(ctx, source, filters);
}

/* ---------- 请求 ---------- */
async function requestsView(ctx, source, filters) {
  $('#log-tools').innerHTML = `<select class="select-sm" id="log-filter" aria-label="筛选">${filters.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>${segmented('log-status', [['all', '全部'], ['ok', '成功'], ['bad', '失败']], 'all', {small: true})}<button class="icon-btn" type="button" id="log-refresh" aria-label="刷新">${icon('refresh')}</button>`;
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
    content.innerHTML = list.length ? `<div class="card table-card"><div class="table-scroll"><table class="log-table"><thead><tr><th>时间</th><th>${whoLabel}</th><th>模型</th><th class="num">输入</th><th class="num">输出</th><th class="num">缓存</th><th class="num">耗时</th><th>状态</th></tr></thead><tbody>
      ${list.map((r, i) => `<tr data-i="${rows.indexOf(r)}" tabindex="0"><td data-label="时间">${shortDate(r.time)}</td><td data-label="${whoLabel}">${esc(r.who)}</td><td data-label="模型" class="mono">${esc(r.model)}${r.effort ? `<span class="tag">${esc(r.effort)}</span>` : ''}</td><td data-label="输入" class="num">${fmt(r.input)}</td><td data-label="输出" class="num">${fmt(r.output)}</td><td data-label="缓存" class="num">${fmt(r.cacheWrite)}（写入） / ${fmt(r.cacheRead)}（读取）</td><td data-label="耗时" class="num">${((r.duration || 0) / 1000).toFixed(1)}s</td><td data-label="状态">${statusPill(r.status)}</td></tr>`).join('')}
      </tbody></table></div></div>${done ? '<p class="hint center">没有更多记录了</p>' : `<div class="center"><button class="btn" type="button" id="log-more">加载更多</button></div>`}`
      : empty('list', rows.length ? '没有符合条件的请求' : '暂无请求记录', rows.length ? '换个筛选条件试试。' : '客户端发起请求后会显示在这里。');
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
    ['缓存写入', Number(r.cacheWrite || 0).toLocaleString()], ['缓存读取', Number(r.cacheRead || 0).toLocaleString()],
    ['推理 Token', r.reasoning == null ? '计入输出' : Number(r.reasoning || 0).toLocaleString()],
    ['耗时', `${r.duration || 0} ms`], ['HTTP 状态', String(r.status ?? '—')],
  ];
  openSheet(`${sheetHead('请求详情', r.model)}<div class="sheet-body"><dl class="detail">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`);
}

/* ---------- 失败 ---------- */
async function failuresView(ctx, source) {
  const endpoint = source === 'main' ? '/api/failures' : `/api/${source}/failures`;
  $('#log-tools').innerHTML = `<button class="icon-btn" type="button" id="fail-refresh" aria-label="刷新">${icon('refresh')}</button><button class="btn small danger" type="button" id="fail-clear">${icon('trash')}清空</button>`;
  const content = $('#log-content');
  const load = async () => {
    const list = await api(endpoint);
    if (!ctx.alive()) return;
    content.innerHTML = `<p class="hint">失败记录只保存在内存中，服务重启后会清空。</p>` + (list.length ? `<div class="item-list">${list.map((f, i) => `<article class="item fail" data-i="${i}" tabindex="0"><div class="item-main"><div class="item-title"><strong>${esc(failTitle(source, f))}</strong>${pill('danger', f.upstream_status ? `HTTP ${f.upstream_status}` : '连接失败')}</div><p class="item-sub">${date(f.ts)} · ${f.streaming ? '流式' : '非流式'}${f.body?.model ? ` · ${esc(f.body.model)}` : ''}</p><p class="item-snippet">${esc(String(f.upstream_body || f.error_repr || '').slice(0, 220))}</p></div><span class="item-chevron">${icon('chevron')}</span></article>`).join('')}</div>` : empty('check', '没有失败记录', '当前没有捕获到上游错误。'));
    $$('.item', content).forEach(el => { const open = () => failDetail(source, list[Number(el.dataset.i)]); el.onclick = open; el.onkeydown = e => { if (e.key === 'Enter') open(); }; });
    $('#fail-clear').disabled = !list.length;
  };
  $('#fail-refresh').onclick = e => busy(e.currentTarget, async () => { await load(); return '已刷新'; });
  $('#fail-clear').onclick = async () => {
    if (!await confirmDialog({title: '清空失败记录？', message: '只清空当前来源的失败记录，请求日志不受影响。', confirmText: '清空', danger: true})) return;
    try { await del(endpoint); toast('失败记录已清空'); load(); } catch (e) { toast(e.message, true); }
  };
  await load();
}
const failTitle = (source, f) => source === 'main' ? `${f.channel || '未知渠道'}${f.error_type ? ` · ${f.error_type}` : ''}` : `账号 #${f.account_id}${f.error_type ? ` · ${f.error_type}` : ''}`;

function failDetail(source, f) {
  const body = JSON.stringify(f.body || {}, null, 2);
  const sheet = openSheet(`${sheetHead('失败请求', failTitle(source, f))}<div class="sheet-body">
    <dl class="detail"><div><dt>时间</dt><dd>${date(f.ts)}</dd></div><div><dt>上游状态</dt><dd>${esc(f.upstream_status || '连接失败')}</dd></div><div><dt>模式</dt><dd>${f.streaming ? '流式' : '非流式'}</dd></div>${f.error_type ? `<div><dt>错误类型</dt><dd>${esc(f.error_type)}</dd></div>` : ''}</dl>
    <section class="form-section"><div class="row-between"><h4>上游返回</h4></div><pre class="code-block">${esc(f.upstream_body || f.error_repr || '（无）')}</pre></section>
    <section class="form-section"><div class="row-between"><h4>请求体</h4><button class="btn small ghost" type="button" id="copy-body">${icon('copy')}复制</button></div><pre class="code-block">${esc(body)}</pre></section></div>`, {wide: true});
  $('#copy-body', sheet).onclick = () => copyText(body, '请求体已复制');
}

/* ---------- 用量 ---------- */
async function usageView(ctx, source, filters) {
  const content = $('#log-content');
  if (source === 'codex') {
    $('#log-tools').innerHTML = '';
    const rows = (await api('/api/codex/logs?limit=500')).map(r => normalize('codex', r));
    if (!ctx.alive()) return;
    const sum = k => rows.reduce((n, r) => n + Number(r[k] || 0), 0);
    const byAccount = {};
    rows.forEach(r => { const a = byAccount[r.who] ||= {n: 0, input: 0, output: 0}; a.n++; a.input += Number(r.input || 0); a.output += Number(r.output || 0); });
    content.innerHTML = `<p class="hint">Codex 按最近 ${rows.length} 条请求统计。</p><div class="metrics">${metric('请求', rows.length)}${metric('输入', sum('input'))}${metric('输出', sum('output'))}${metric('推理', sum('reasoning'))}${metric('缓存读取', sum('cacheRead'))}</div>
      ${Object.keys(byAccount).length ? card('按账号', `<div class="bars">${barList(Object.entries(byAccount).map(([k, v]) => [k, v.input + v.output, `${v.n} 次`]))}</div>`) : ''}`;
    return;
  }
  const accountFilter = source === 'claudecode';
  $('#log-tools').innerHTML = `<select class="select-sm" id="usage-filter" aria-label="筛选">${filters.filter(([v]) => v !== 'openai').map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`;
  const load = async () => {
    const f = $('#usage-filter').value;
    const [u, oai] = await Promise.all([
      api(accountFilter ? `/api/claudecode/usage-summary${f ? `?account_id=${f}` : ''}` : `/api/usage${f ? `?channel_id=${f}` : ''}`),
      source === 'main' && !f ? api('/api/openai/usage').catch(() => null) : null,
    ]);
    if (!ctx.alive()) return;
    const input = (u.total_input || 0) + (u.total_cache_creation || 0) + (u.total_cache_read || 0);
    const hit = input ? Math.round((u.total_cache_read || 0) / input * 100) : 0;
    content.innerHTML = `<div class="metrics">${metric('请求', u.total_requests)}${metric('总输入', input, '含缓存读写')}${metric('输出', u.total_output)}${metric('缓存命中率', `${hit}%`, '缓存读取 / 总输入', true)}</div>
      ${card(source === 'main' ? 'Claude 渠道明细' : 'Claude Code 明细', `<div class="bars">${barList([['原始输入', u.total_input], ['缓存写入', u.total_cache_creation], ['缓存读取', u.total_cache_read], ['输出', u.total_output]])}</div><p class="hint">统计区间：${date(u.first_request)} 至 ${date(u.last_request)}</p>`)}
      ${oai ? card('OpenAI', `<div class="metrics inner">${metric('请求', oai.total_requests)}${metric('输入', oai.prompt_tokens)}${metric('输出', oai.completion_tokens)}${metric('推理', oai.reasoning_tokens)}${metric('缓存命中', oai.cached_tokens)}</div>`) : ''}`;
  };
  $('#usage-filter').onchange = load;
  await load();
}
function barList(items) {
  const max = Math.max(1, ...items.map(([, v]) => Number(v || 0)));
  return items.map(([label, v, note]) => `<div class="bar-row"><div class="bar-label"><span>${esc(label)}</span><strong>${fmt(v)}${note ? ` <small>${esc(note)}</small>` : ''}</strong></div><div class="bar"><i class="ok" style="width:${Number(v || 0) / max * 100}%"></i></div></div>`).join('');
}
