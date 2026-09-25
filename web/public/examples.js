// Examples tab — list examples/*.ts, run one with live console output, show what it wrote to output/.
// Loaded after app.js and uses its helpers ($, fill, renderCard, openPlayer, refine, setRoute, route, …).
//
// Server API (web/routes.ts):
//   GET  /api/examples                 list + last run of each
//   GET  /api/examples/<id>            metadata, source, last run (with log), output entries
//   GET  /api/examples/<id>/events     SSE: state (run incl. log so far), log (chunk), end (run)
//   POST /api/examples/<id>/run        {arg?}  →  202 | 409 busy | 400 bad input
//   POST /api/examples/<id>/stop

const ex = {
  list: [],
  running: null,            // id of the example currently running (server-wide: one at a time)
  detail: null,             // GET /api/examples/<id> for the open page
  loadingId: null,
  selectedArg: {},          // id → chosen input, kept while navigating
  term: newTerm(),          // console of the open page
  termId: null,
  es: null,                 // EventSource of the open page
  error: null,
};

const tplExampleCard = $('#tpl-example-card');
const tplExamplePage = $('#tpl-example-page');

registerTab({
  id: 'examples',
  label: 'Examples',
  icon: ICONS.code,
  hint: 'Every script in examples/ — run it here, watch the console, open what it produced.',
  load: loadExamples,
  count: () => ex.list.length,
  stats: () => (route().example ? `examples/${route().example}.ts` : `${ex.list.length} examples${ex.running ? ` · ${ex.running} is running` : ''}`),
  render: (content) => (route().example ? renderExamplePage(content, route().example) : renderExampleList(content)),
  onRoute: (r) => {
    const id = r.tab === 'examples' ? r.example : null;
    if (id !== ex.es?.id) connect(id);
    if (r.tab === 'examples' && !id) loadExamples().then(() => state.tab === 'examples' && !route().example && render());
  },
});

async function loadExamples() {
  const data = await api('/api/examples');
  ex.list = data.examples;
  ex.running = data.running;
}

async function api(url, body) {
  const res = await fetch(url, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

// ---------------------------------------------------------------- list

const commandOf = (e) => (e.script ? `npm run ${e.script}` : `npx tsx examples/${e.id}.ts`);

function statusBadges(run) {
  if (!run) return [];
  const took = run.durationMs != null ? ` · ${(run.durationMs / 1000).toFixed(1)} s` : '';
  return [{
    running: { text: 'Running', tone: 'info' },
    ok: { text: `OK${took}`, tone: 'ok' },
    failed: { text: `Failed${took}`, tone: 'error' },
    stopped: { text: 'Stopped', tone: 'warn' },
  }[run.status]].filter(Boolean).map((b) => ({ ...b, title: `last run ${new Date(run.startedAt).toLocaleString()}` }));
}

function renderExampleList(content) {
  const q = state.q.trim().toLowerCase();
  const items = ex.list.filter((e) => !q || `${e.id} ${e.title} ${e.summary}`.toLowerCase().includes(q));
  if (!items.length) {
    content.innerHTML = `<p class="empty">${q ? 'Nothing matches your search.' : 'No examples found in examples/.'}</p>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'ex-grid';
  grid.append(...items.map(renderExampleCard));
  content.replaceChildren(grid);
}

function renderExampleCard(e) {
  const node = tplExampleCard.content.firstElementChild.cloneNode(true);
  const run = ex.running === e.id ? { ...e.lastRun, status: 'running' } : e.lastRun;
  fill(node, { num: e.num, title: e.title, summary: e.summary, command: commandOf(e), badges: statusBadges(run) });
  const open = () => setRoute({ tab: 'examples', example: e.id });
  node.addEventListener('click', open);
  node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
  return node;
}

// ---------------------------------------------------------------- page

async function fetchDetail(id) {
  ex.loadingId = id;
  let detail = null, error = null;
  try {
    detail = await api(`/api/examples/${encodeURIComponent(id)}`);
  } catch (e) {
    error = e.message;
  }
  if (ex.loadingId !== id) return;   // the user already navigated to another example
  ex.loadingId = null;
  ex.detail = detail;
  ex.error = error;
  if (state.tab === 'examples' && route().example === id) render();
}

function renderExamplePage(content, id) {
  const d = ex.detail;
  if (!d || d.example.id !== id) {
    if (ex.error && !ex.loadingId) {
      content.replaceChildren(note(`Could not load example "${id}": ${ex.error}`, 'error'));
      ex.error = null;
      return;
    }
    content.innerHTML = '<p class="empty">Loading example…</p>';
    if (ex.loadingId !== id) fetchDetail(id);
    return;
  }

  const e = d.example;
  const run = d.run;
  const isRunning = ex.running === id;
  const node = tplExamplePage.content.firstElementChild.cloneNode(true);
  fill(node, {
    num: e.num, title: e.title, summary: e.summary, command: commandOf(e),
    inputLabel: e.input === 'dir' ? 'Input folder' : 'Input file',
    fileName: `examples/${e.id}.ts`,
  });
  const q = (role) => node.querySelector(`[data-role="${role}"]`);

  // input picker — only examples that read process.argv[2]
  const select = q('input');
  if (!e.input) q('input-field').remove();
  else {
    select.append(inputOptions(e.input));
    select.value = ex.selectedArg[id] ?? run?.arg ?? '';
    if (select.selectedIndex < 0) select.value = '';
    select.addEventListener('change', () => { ex.selectedArg[id] = select.value; });
  }

  // run / stop
  const runBtn = q('run');
  const stopBtn = q('stop');
  const noTools = state.tools && !state.tools.ok;
  runBtn.disabled = Boolean(ex.running) || noTools;
  runBtn.title = noTools ? `ffmpeg / ffprobe not found — install it first: ${state.tools.hint}`
    : ex.running && !isRunning ? `${ex.running} is running — one example at a time` : '';
  stopBtn.hidden = !isRunning;
  runBtn.addEventListener('click', () => startRun(id, e.input ? select.value : ''));
  stopBtn.addEventListener('click', () => api(`/api/examples/${encodeURIComponent(id)}/stop`, {}).catch((err) => alertNote(err.message)));

  // status + console
  const status = q('status');
  const shown = isRunning ? { ...run, status: 'running' } : run;
  status.className = `run-status ${shown?.status ?? ''}`;
  status.textContent = !shown ? 'Never run'
    : shown.status === 'running' ? `Running${shown.arg ? ` on ${shown.arg}` : ''}…`
    : `${{ ok: 'Finished', failed: `Failed (exit ${shown.exitCode ?? '—'})`, stopped: 'Stopped' }[shown.status]} · ${(shown.durationMs / 1000).toFixed(1)} s · ${new Date(shown.finishedAt).toLocaleString()}`;
  if (ex.termId !== id) { ex.term = termFrom(run?.log ?? ''); ex.termId = id; }
  const consoleEl = q('console');
  consoleEl.textContent = termText(ex.term);
  ex.consoleEl = consoleEl;

  // results
  const results = q('results');
  const outputs = (d.outputs ?? []).map((f) => ({ ...f, effective: refine(f) }));
  q('results-meta').textContent = outputs.length ? `${outputs.length} file${outputs.length > 1 ? 's' : ''} in output/` : '';
  if (isRunning) results.innerHTML = '<p class="empty">Results appear here when the run finishes.</p>';
  else if (!run) results.innerHTML = '<p class="empty">Run the example to see what it produces.</p>';
  else if (!outputs.length) results.innerHTML = '<p class="empty">The last run did not write any media to output/ — see the console above.</p>';
  else {
    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.append(...outputs.map((f) => renderCard(f, () => openPlayer(f))));
    results.replaceChildren(grid);
  }

  // source with line numbers
  q('source').replaceChildren(...d.source.replace(/\n$/, '').split('\n').map((l) => Object.assign(document.createElement('span'), { textContent: l || ' ' })));

  content.replaceChildren(node);
  requestAnimationFrame(() => { consoleEl.scrollTop = consoleEl.scrollHeight; });
}

function inputOptions(kind) {
  const frag = document.createDocumentFragment();
  frag.append(new Option('Default sample', ''));
  const paths = kind === 'dir'
    ? [...new Set(state.files.flatMap((f) => f.path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))].sort()
    : state.files.filter((f) => f.kind === 'video' || f.kind === 'audio').map((f) => f.path).sort();
  const groups = new Map();
  for (const p of paths) {
    const g = kind === 'dir' ? 'folders' : dirname(p);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  for (const [g, list] of groups) {
    const og = document.createElement('optgroup');
    og.label = g;
    og.append(...list.map((p) => new Option(kind === 'dir' ? p : basename(p), p)));
    frag.append(og);
  }
  return frag;
}

async function startRun(id, arg) {
  try {
    const { run } = await api(`/api/examples/${encodeURIComponent(id)}/run`, arg ? { arg } : {});
    ex.running = id;
    ex.term = newTerm();
    ex.termId = id;
    if (ex.detail?.example.id === id) ex.detail = { ...ex.detail, run: { ...run, log: '' }, outputs: [] };
    render();
  } catch (e) {
    alertNote(e.message);
  }
}

function alertNote(text) {
  const page = $('.ex-page');
  if (!page) return;
  page.querySelector('.ex-hero').after(note(text, 'error'));
}

// ---------------------------------------------------------------- live events

function connect(id) {
  ex.es?.close();
  ex.es = null;
  if (!id) return;
  const es = new EventSource(`/api/examples/${encodeURIComponent(id)}/events`);
  es.id = id;
  ex.es = es;

  es.addEventListener('state', (m) => {
    const run = JSON.parse(m.data);
    ex.term = termFrom(run?.log ?? '');
    ex.termId = id;
    if (run?.status === 'running') ex.running = id;
    if (ex.consoleEl?.isConnected) ex.consoleEl.textContent = termText(ex.term);
  });
  es.addEventListener('log', (m) => {
    termWrite(ex.term, JSON.parse(m.data));
    const c = ex.consoleEl;
    if (!c?.isConnected) return;
    const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
    c.textContent = termText(ex.term);
    if (atBottom) c.scrollTop = c.scrollHeight;
  });
  es.addEventListener('end', async () => {
    ex.running = null;
    await Promise.all([fetchDetailQuiet(id), loadExamples()]);
    if (state.tab === 'examples') render();
  });
}

async function fetchDetailQuiet(id) {
  try { ex.detail = await api(`/api/examples/${encodeURIComponent(id)}`); } catch { /* keep the old one */ }
}

// ---------------------------------------------------------------- tiny terminal: \r rewrites the line (progress bars)

function newTerm() {
  return { lines: [''], cr: false };
}
function termFrom(text) {
  const t = newTerm();
  termWrite(t, text);
  return t;
}
function termWrite(t, chunk) {
  for (const part of chunk.split(/(\r\n|\n|\r)/)) {
    if (part === '\n' || part === '\r\n') { t.lines.push(''); t.cr = false; }
    else if (part === '\r') t.cr = true;
    else if (part) {
      if (t.cr) { t.lines[t.lines.length - 1] = ''; t.cr = false; }
      t.lines[t.lines.length - 1] += part;
    }
  }
  if (t.lines.length > 5000) t.lines.splice(0, t.lines.length - 5000);
}
function termText(t) {
  return t.lines.join('\n').replace(/\n$/, '');
}
