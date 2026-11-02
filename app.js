/* DRAM — application
   Local-first: journal state in localStorage, catalog from data.json. */

'use strict';

const LS_KEY = 'dram.journal.v1';
const FLAVORS = [['sweet', 'Sweet'], ['smoke', 'Smoke'], ['fruit', 'Fruit'], ['spice', 'Spice'], ['wood', 'Wood'], ['body', 'Body']];
const FLAVOR_LABEL = Object.fromEntries(FLAVORS);

let DATA = null;          // catalog
let J = { entries: {}, prefs: { axes: ['sweet', 'smoke'] } };
let view = 'browse';
let filters = { q: '', country: '', region: '', style: '', status: '', distillery: '' };
let lastFocus = null;

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bandMark = b => b ? '<span class="band">' + '$'.repeat(b) + '</span>' : '';
const today = () => new Date().toISOString().slice(0, 10);
const entryOf = id => J.entries[id] || null;
const statusOf = id => (entryOf(id)?.s) || 'untried';
const rated = e => e && e.f && Object.values(e.f).some(v => v > 0);

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(J)); } catch (e) { /* private mode */ }
  refreshCounts();
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY));
    if (raw && typeof raw === 'object' && raw.entries) {
      J = { entries: raw.entries || {}, prefs: Object.assign({ axes: ['sweet', 'smoke'] }, raw.prefs) };
    }
  } catch (e) { /* fresh start */ }
}

function ensureEntry(id) {
  if (!J.entries[id]) J.entries[id] = { s: 'untried', r: 0, f: {}, notes: '', price: '', date: '' };
  return J.entries[id];
}

function pruneEntry(id) {
  const e = J.entries[id];
  if (!e) return;
  const idle = (!e.s || e.s === 'untried') && !e.r && !rated(e) && !e.notes && !e.price && !e.date;
  if (idle) delete J.entries[id];
}

/* ---------- boot ---------- */
async function boot() {
  load();
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
    DATA.bottleIndex = new Map(DATA.bottles.map(b => [b.id, b]));
  } catch (e) {
    $('#main').innerHTML = '<div class="fatal"><h2>The cellar is locked</h2><p>Could not load the catalog (' + esc(e.message) + '). Refresh to try again.</p></div>';
    return;
  }
  buildFilterOptions();
  wireShell();
  wireBrowse();
  wireDrawer();
  wireJournal();
  wireMap();
  renderAtlas();
  renderMarket();
  refreshCounts();
  renderJournal();
  renderMap();
  renderBrowse();
  if (location.hash === '#atlas' || location.hash === '#journal' || location.hash === '#map') switchView(location.hash.slice(1));
}

/* ---------- shell / nav ---------- */
function switchView(v) {
  view = v;
  $$('.view').forEach(s => { s.hidden = s.id !== 'view-' + v; });
  $$('[data-nav]').forEach(b => b.setAttribute('aria-current', String(b.dataset.nav === v)));
  history.replaceState(null, '', v === 'browse' ? location.pathname : '#' + v);
  if (v === 'map') renderMap();
  if (v === 'journal') renderJournal();
  window.scrollTo({ top: 0 });
}

function wireShell() {
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.nav)));
}

function refreshCounts() {
  let tried = 0, want = 0, ratedN = 0;
  for (const id in J.entries) {
    const e = J.entries[id];
    if (e.s === 'tried') tried++;
    else if (e.s === 'want') want++;
    if (rated(e)) ratedN++;
  }
  const html = '<b>' + tried + '</b> poured · <b>' + want + '</b> wanted';
  $('#railCounts').innerHTML = html;
  $('#mastCounts').innerHTML = tried + ' poured · ' + want + ' wanted';
  $('#railCounts').dataset.tried = tried;
  refreshRowRatings();
}

function refreshRowRatings() {
  // keep list rows in place; only status dots/ratings change on save
  $$('.bottle-row').forEach(row => {
    const id = row.dataset.id;
    const dot = $('.status-dot', row);
    const s = statusOf(id);
    dot.className = 'status-dot ' + (s === 'tried' ? 'tried' : s === 'want' ? 'want' : '');
    const e = entryOf(id);
    const rEl = $('.br-rating', row);
    if (rEl) rEl.innerHTML = e && e.s === 'tried' && e.r ? '◆'.repeat(e.r) : '';
  });
}

/* ---------- browse ---------- */
function buildFilterOptions() {
  const countries = [...new Set(DATA.bottles.map(b => b.country))].sort();
  const regions = [...new Set(DATA.bottles.map(b => b.region).filter(Boolean))].sort();
  const styles = [...new Set(DATA.bottles.map(b => b.style))].sort();
  fill($('#fCountry'), countries, 'All countries');
  fill($('#fRegion'), regions, 'All regions');
  fill($('#fStyle'), styles, 'All styles');
  function fill(sel, list, label) {
    sel.innerHTML = '<option value="">' + label + '</option>' + list.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
  }
}

function match(b) {
  const f = filters;
  if (f.distillery && b.slug !== f.distillery) return false;
  if (f.country && b.country !== f.country) return false;
  if (f.region && b.region !== f.region) return false;
  if (f.style && b.style !== f.style) return false;
  if (f.status && statusOf(b.id) !== f.status) return false;
  if (f.q) {
    const hay = (b.name + ' ' + b.distillery + ' ' + (b.region || '') + ' ' + b.country + ' ' + b.style).toLowerCase();
    if (!f.q.split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function renderBrowse() {
  const list = DATA.bottles.filter(match);
  $('#bottleList').innerHTML = list.length ? list.map(b => {
    const s = statusOf(b.id), e = entryOf(b.id);
    const dotCls = s === 'tried' ? 'tried' : s === 'want' ? 'want' : '';
    const rating = e && e.s === 'tried' && e.r ? '◆'.repeat(e.r) : '';
    const meta = [b.region, b.country].filter(Boolean).join(' · ') + (b.age ? ' · ' + b.age + 'y' : '');
    const stats = (b.abv ? b.abv + '%' : '') + (b.abv && b.band ? ' ' : '') + (b.band ? '$'.repeat(b.band) : '');
    return '<button class="bottle-row" role="listitem" data-id="' + esc(b.id) + '">' +
      '<span class="status-dot ' + dotCls + '"></span>' +
      '<span class="br-name"><span class="n">' + esc(b.name) + '</span><span class="d">' + esc(b.distillery) + '</span></span>' +
      '<span class="br-meta">' + esc(meta) + '</span>' +
      '<span class="br-stats">' + esc(stats) + '</span>' +
      '<span class="br-rating">' + rating + '</span>' +
      '</button>';
  }).join('') : '<div class="list-empty">Nothing matches. Loosen a filter, or pour something random instead.</div>';

  const triedCount = list.filter(b => statusOf(b.id) === 'tried').length;
  $('#browseCount').innerHTML = '<b>' + list.length + '</b> bottle' + (list.length === 1 ? '' : 's') + (triedCount ? ' · <b>' + triedCount + '</b> poured here' : '') +
    (filters.distillery ? ' · from <b>' + esc(distilleryName(filters.distillery)) + '</b>' : '');
  const any = filters.q || filters.country || filters.region || filters.style || filters.status || filters.distillery;
  $('#clearFilters').hidden = !any;
}

function distilleryName(slug) {
  const d = DATA.distilleries.find(x => x.slug === slug);
  return d ? d.name : slug;
}

function wireBrowse() {
  $('#q').addEventListener('input', e => { filters.q = e.target.value.trim().toLowerCase(); renderBrowse(); });
  [['#fCountry', 'country'], ['#fRegion', 'region'], ['#fStyle', 'style'], ['#fStatus', 'status']].forEach(([sel, key]) => {
    $(sel).addEventListener('change', e => { filters[key] = e.target.value; renderBrowse(); });
  });
  $('#clearFilters').addEventListener('click', () => {
    filters = { q: '', country: '', region: '', style: '', status: '', distillery: '' };
    $('#q').value = ''; ['#fCountry', '#fRegion', '#fStyle', '#fStatus'].forEach(s => { $(s).value = ''; });
    renderBrowse();
  });
  $('#bottleList').addEventListener('click', e => {
    const row = e.target.closest('.bottle-row');
    if (row) openDrawer(row.dataset.id, row);
  });
  $('#pourBtn').addEventListener('click', () => {
    const pool = DATA.bottles.filter(b => statusOf(b.id) !== 'tried');
    const src = pool.length ? pool : DATA.bottles;
    const pick = src[Math.floor(Math.random() * src.length)];
    openDrawer(pick.id, $('#pourBtn'));
  });
}

/* ---------- atlas ---------- */
function renderAtlas() {
  const byCountry = new Map();
  for (const d of DATA.distilleries) {
    if (!byCountry.has(d.country)) byCountry.set(d.country, []);
    byCountry.get(d.country).push(d);
  }
  const order = ['Scotland', 'Ireland', 'United States', 'Japan', 'Taiwan', 'India', 'United Kingdom', 'Sweden'];
  const countries = [...byCountry.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const SCOT_REGIONS = ['Speyside', 'Highland', 'Islay', 'Islands', 'Lowland', 'Campbeltown'];

  let html = '';
  for (const c of countries) {
    const dists = byCountry.get(c);
    const bottleCount = DATA.bottles.filter(b => b.country === c).length;
    html += '<div class="country-block"><div class="country-head"><h3>' + esc(c) + '</h3><span class="count">' + dists.length + ' distilleries · ' + bottleCount + ' bottles in catalog</span></div>';
    html += '<p class="country-blurb">' + esc(DATA.blurbs.countries[c] || '') + '</p>';
    const byRegion = new Map();
    for (const d of dists) {
      const r = d.region || '—';
      if (!byRegion.has(r)) byRegion.set(r, []);
      byRegion.get(r).push(d);
    }
    const regions = [...byRegion.keys()].sort((a, b) => {
      if (c === 'Scotland') return (SCOT_REGIONS.indexOf(a) + 99 * (SCOT_REGIONS.indexOf(a) < 0)) - (SCOT_REGIONS.indexOf(b) + 99 * (SCOT_REGIONS.indexOf(b) < 0)) || a.localeCompare(b);
      return a.localeCompare(b);
    });
    for (const r of regions) {
      const rDists = byRegion.get(r).sort((a, b) => a.name.localeCompare(b.name));
      html += '<div class="region-block"><div class="region-head"><h4>' + esc(r === '—' ? 'Uncharted' : r) + '</h4><span class="r-count">' + rDists.length + '</span></div>';
      if (DATA.blurbs.regions[r]) html += '<p class="region-blurb">' + esc(DATA.blurbs.regions[r]) + '</p>';
      html += '<div class="dist-grid">';
      for (const d of rDists) {
        const nB = d.bottles.length;
        const triedB = d.bottles.filter(id => statusOf(id) === 'tried').length;
        const pct = nB ? Math.round(triedB / nB * 100) : 0;
        html += '<button class="dist-card' + (d.closed ? ' closed' : '') + (nB ? ' has-bottles' : '') + '" data-slug="' + esc(d.slug) + '" ' + (nB ? '' : 'tabindex="-1"') + '>' +
          '<span class="dn">' + esc(d.name) + '</span>' +
          '<span class="dm">' + (d.closed ? '<span class="cob">silent since</span>' : '') + (nB ? '<span>' + nB + ' bottle' + (nB > 1 ? 's' : '') + '</span>' : '') + '</span>' +
          (d.note ? '<span class="dnote">' + esc(d.note) + '</span>' : '') +
          '<span class="cover"><i style="width:' + pct + '%"></i></span>' +
          '</button>';
      }
      html += '</div></div>';
    }
    html += '</div>';
  }
  $('#atlasBody').innerHTML = html;
  $('#atlasBody').addEventListener('click', e => {
    const card = e.target.closest('.dist-card.has-bottles');
    if (!card) return;
    filters = { q: '', country: '', region: '', style: '', status: '', distillery: card.dataset.slug };
    $('#q').value = ''; ['#fCountry', '#fRegion', '#fStyle', '#fStatus'].forEach(s => { $(s).value = ''; });
    switchView('browse');
    renderBrowse();
  });
}

function renderMarket() {
  const canvas = $('#marketChart');
  if (!canvas || !DATA.market.length) return;
  const draw = () => {
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const m = DATA.market;
    const pad = { l: 4, r: 4, t: 8, b: 18 };
    const vols = m.map(p => p[1]);
    const maxV = Math.max(...vols);
    const bw = (W - pad.l - pad.r) / m.length;
    // volume bars (sqrt scale keeps early years visible)
    for (let i = 0; i < m.length; i++) {
      const h = Math.sqrt(m[i][1] / maxV) * (H - pad.t - pad.b);
      ctx.fillStyle = 'rgba(217,164,65,0.16)';
      ctx.fillRect(pad.l + i * bw, H - pad.b - h, Math.max(1, bw - 1.5), h);
    }
    // avg bid line
    const avgs = m.map(p => p[2] || 0);
    const maxA = Math.max(...avgs);
    ctx.beginPath();
    for (let i = 0; i < m.length; i++) {
      const x = pad.l + i * bw + bw / 2;
      const y = H - pad.b - (avgs[i] / maxA) * (H - pad.t - pad.b) * 0.92;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = '#e8b95c';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // year labels
    ctx.fillStyle = 'rgba(176,164,147,0.7)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textBaseline = 'top';
    let lastYear = '';
    for (let i = 0; i < m.length; i++) {
      const year = m[i][0].slice(0, 4);
      if (year !== lastYear && (i === 0 || Number(year) % 5 === 0)) {
        ctx.fillText(year, pad.l + i * bw, H - pad.b + 4);
        lastYear = year;
      }
    }
  };
  draw();
  const last = DATA.market[DATA.market.length - 1];
  const first = DATA.market.find(p => p[2]);
  $('#marketLegend').innerHTML =
    '<span><span class="sw" style="background:rgba(217,164,65,0.35)"></span>Trading volume · £' + (last[1] / 1e6).toFixed(1) + 'M in ' + esc(last[0]) + ' (was £' + Math.round(first[1] / 1000) + 'k in ' + esc(first[0]) + ')</span>' +
    '<span><span class="sw" style="background:#e8b95c"></span>Average winning bid · £' + Math.round(last[2]) + ' per lot</span>';
}

/* ---------- journal ---------- */
function renderJournal() {
  const entries = Object.entries(J.entries).filter(([, e]) => e.s === 'tried' || e.s === 'want');
  const tried = entries.filter(([, e]) => e.s === 'tried');
  const body = $('#journalBody');
  if (!entries.length) {
    body.innerHTML =
      '<div class="empty-state"><h3>The journal is still blank</h3>' +
      '<p>Mark a bottle as poured and it lands here. Ratings, notes, flavours — the record builds itself as you drink.</p></div>' +
      actionsHtml();
    wireJournalActions();
    return;
  }
  const ratedVals = tried.filter(([, e]) => e.r > 0);
  const avg = ratedVals.length ? (ratedVals.reduce((s, [, e]) => s + e.r, 0) / ratedVals.length) : 0;
  const countries = new Set(tried.map(([id]) => bottleById(id)?.country).filter(Boolean));
  const totalCountries = new Set(DATA.bottles.map(b => b.country)).size;
  const regionCount = {};
  tried.forEach(([id]) => { const b = bottleById(id); if (b?.region) regionCount[b.region] = (regionCount[b.region] || 0) + 1; });
  const topRegion = Object.entries(regionCount).sort((a, b) => b[1] - a[1])[0];
  const favorites = tried.filter(([, e]) => e.r >= 4).length;

  let html = '<div class="jstats">' +
    stat(tried.length, 'poured', ' of ' + DATA.bottles.length) +
    stat(avg ? avg.toFixed(1) : '—', 'avg rating', avg ? ' from ' + ratedVals.length + ' rated' : '') +
    stat(favorites, 'favourites', favorites ? ' rated 4+' : '') +
    stat(countries.size + '<small>/' + totalCountries + '</small>', 'countries', topRegion ? 'top: ' + topRegion[0] : '') +
    '</div>';

  const triedSorted = tried.slice().sort((a, b) => (b[1].r - a[1].r) || a[0].localeCompare(b[0]));
  const wantedSorted = entries.filter(([, e]) => e.s === 'want').map(([id]) => [id, entryOf(id)]);
  html += '<div class="journal-list">';
  for (const [id, e] of triedSorted) {
    const b = bottleById(id);
    if (!b) continue;
    html += '<button class="jrow" data-id="' + esc(id) + '">' +
      '<span class="jn">' + esc(b.name) + '</span>' +
      '<span class="jr">' + (e.r ? '◆'.repeat(e.r) : '·') + '</span>' +
      '<span class="jx">' + esc(e.notes || '') + '</span>' +
      '<span class="jd">' + esc(e.date || '') + '</span>' +
      '</button>';
  }
  html += '</div>';
  if (wantedSorted.length) {
    html += '<div class="d-section"><h5>Wanted · ' + wantedSorted.length + '</h5><div class="journal-list">';
    for (const [id] of wantedSorted) {
      const b = bottleById(id);
      if (!b) continue;
      html += '<button class="jrow" data-id="' + esc(id) + '">' +
        '<span class="jn">' + esc(b.name) + '</span>' +
        '<span class="jr" style="color:var(--copper)">want</span>' +
        '<span class="jx">' + esc(b.distillery) + '</span>' +
        '<span class="jd"></span>' +
        '</button>';
    }
    html += '</div></div>';
  }
  html += actionsHtml();
  body.innerHTML = html;
  body.onclick = e => {
    const row = e.target.closest('.jrow');
    if (row) openDrawer(row.dataset.id, row);
  };
  wireJournalActions();

  function stat(v, k, sub) {
    return '<div class="jstat"><div class="v">' + v + '</div><div class="k">' + k + (sub ? ' · ' + esc(sub) : '') + '</div></div>';
  }
}

function actionsHtml() {
  return '<div class="journal-actions" id="jActions">' +
    '<button class="btn-ghost" id="exportBtn" type="button">Export journal</button>' +
    '<button class="btn-ghost" id="importBtn" type="button">Import journal</button>' +
    '<input type="file" id="importFile" accept="application/json,.json" hidden>' +
    '<button class="btn-ghost danger" id="resetBtn" type="button">Reset everything</button>' +
    '<span class="sr-only" id="jStatus" role="status"></span>' +
    '</div>';
}

function wireJournal() {}
function wireJournalActions() {
  const status = $('#jStatus');
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(J, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dram-journal-' + today() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    if (status) status.textContent = 'Journal exported.';
  };
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        if (!raw || typeof raw !== 'object' || typeof raw.entries !== 'object') throw new Error('not a DRAM journal');
        const n = Object.keys(raw.entries).length;
        if (!confirm('Import ' + n + ' entries? This replaces your current journal.')) return;
        J = { entries: raw.entries, prefs: Object.assign({ axes: ['sweet', 'smoke'] }, raw.prefs) };
        save(); renderJournal(); renderAtlas(); renderMap(); renderBrowse();
        if (status) status.textContent = 'Imported ' + n + ' entries.';
      } catch (err) {
        if (status) status.textContent = 'Import failed: ' + err.message;
      }
    };
    reader.readAsText(file);
  };
  $('#resetBtn').onclick = () => {
    if (!confirm('Erase every entry? This cannot be undone.')) return;
    J = { entries: {}, prefs: J.prefs };
    save(); renderJournal(); renderAtlas(); renderMap(); renderBrowse();
  };
}

function bottleById(id) { return DATA.bottleIndex.get(id); }

/* ---------- flavour map ---------- */
function wireMap() {
  $('#axisX').value = J.prefs.axes[0]; $('#axisY').value = J.prefs.axes[1];
  $('#axisX').addEventListener('change', e => { J.prefs.axes[0] = e.target.value; save(); renderMap(); });
  $('#axisY').addEventListener('change', e => { J.prefs.axes[1] = e.target.value; save(); renderMap(); });
}

function renderMap() {
  const canvas = $('#flavorMap');
  if (!canvas) return;
  const [ax, ay] = J.prefs.axes;
  const pts = [];
  for (const id in J.entries) {
    const e = J.entries[id];
    if (!rated(e)) continue;
    const b = bottleById(id);
    if (!b) continue;
    pts.push({ b, e, x: (e.f[ax] || 0) / 5, y: (e.f[ay] || 0) / 5 });
  }
  const draw = () => {
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const pad = 44;
    // frame + midlines
    ctx.strokeStyle = 'rgba(239,231,218,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, W - 2 * pad, H - 2 * pad);
    ctx.beginPath();
    ctx.moveTo(W / 2, pad); ctx.lineTo(W / 2, H - pad);
    ctx.moveTo(pad, H / 2); ctx.lineTo(W - pad, H / 2);
    ctx.stroke();
    // axis labels
    ctx.fillStyle = 'rgba(176,164,147,0.9)';
    ctx.font = '11px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillText(FLAVOR_LABEL[ax].toLowerCase() + ' →', pad, 24);
    ctx.textAlign = 'center'; ctx.fillText(FLAVOR_LABEL[ax].toLowerCase(), W - pad - 30, H - 22);
    ctx.save(); ctx.translate(22, H - pad); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(FLAVOR_LABEL[ay].toLowerCase() + ' →', 0, 0); ctx.restore();
    // points
    for (const p of pts) {
      const x = pad + p.x * (W - 2 * pad);
      const y = H - pad - p.y * (H - 2 * pad);
      p.px = x; p.py = y;
      const isTop = p.e.r >= 4;
      ctx.beginPath();
      ctx.arc(x, y, isTop ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = isTop ? 'rgba(240,192,100,0.95)' : 'rgba(217,164,65,0.65)';
      ctx.fill();
      if (isTop) { ctx.strokeStyle = 'rgba(240,192,100,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke(); }
    }
    canvas._pts = pts;
  };
  draw();
  $('#mapLegend').innerHTML = pts.length
    ? 'Each dot is a bottle you rated, plotted by its flavour scores. Click a dot to open it. Bigger amber dots are your 4+ ratings.'
    : 'Rate the flavour axes on a few bottles and your constellation will appear here.';
  const tip = $('#mapTip');
  canvas.onmousemove = e => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 14;
    for (const p of (canvas._pts || [])) {
      const d = Math.hypot(p.px - mx, p.py - my);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      tip.innerHTML = '<b>' + esc(best.b.name) + '</b><br>' + esc(best.b.distillery) + '<br>' + FLAVOR_LABEL[ax] + ' ' + (best.e.f[ax] || 0) + '/5 · ' + FLAVOR_LABEL[ay] + ' ' + (best.e.f[ay] || 0) + '/5';
      tip.style.left = best.px + 'px';
      tip.style.top = best.py + 'px';
      tip.style.opacity = 1;
      canvas.style.cursor = 'pointer';
    } else {
      tip.style.opacity = 0;
      canvas.style.cursor = 'crosshair';
    }
  };
  canvas.onmouseleave = () => { tip.style.opacity = 0; };
  canvas.onclick = e => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 14;
    for (const p of (canvas._pts || [])) {
      const d = Math.hypot(p.px - mx, p.py - my);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) openDrawer(best.b.id, null);
  };
}

/* ---------- drawer ---------- */
function wireDrawer() {
  $('#drawerScrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawerWrap').hidden) closeDrawer(); });
  window.addEventListener('resize', () => { renderMarket(); if (view === 'map') renderMap(); });
}

let openId = null;
function openDrawer(id, trigger) {
  const b = bottleById(id);
  if (!b) return;
  openId = id;
  lastFocus = trigger || document.activeElement;
  $('#drawerWrap').hidden = false;
  $('#drawer').innerHTML = drawerHtml(b);
  wireDrawerControls(b);
  $('#drawer').scrollTop = 0;
  $('.drawer-close').focus();
}
function closeDrawer() {
  $('#drawerWrap').hidden = true;
  openId = null;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  renderBrowse(); renderAtlas(); renderJournal(); if (view === 'map') renderMap();
}

function drawerHtml(b) {
  const e = entryOf(b.id) || { s: 'untried', r: 0, f: {}, notes: '', price: '', date: '' };
  const meta = [];
  if (b.age) meta.push(b.age + ' years');
  if (b.abv) meta.push(b.abv + '% abv');
  if (b.band) meta.push('$'.repeat(b.band));
  meta.push(b.style);
  if (b.region) meta.push(b.region);
  meta.push(b.country);
  const distEntry = b.slug ? DATA.distilleries.find(d => d.slug === b.slug) : null;
  const closedNote = distEntry && distEntry.closed ? '<p class="d-note faint">' + esc(distEntry.name) + ' is silent — ' + esc(distEntry.note || 'closed long ago; its remaining bottlings are what history kept.') + '</p>' : '';
  return '<button class="drawer-close" aria-label="Close">✕</button>' +
    '<div class="d-kicker">' + esc(b.style) + ' · ' + esc(b.country) + (b.region ? ' · ' + esc(b.region) : '') + '</div>' +
    '<h3 class="d-name">' + esc(b.name) + '</h3>' +
    '<div class="d-by">' + (b.house ? 'A ' + esc(b.house) + ' bottling' : 'From ' + esc(b.distillery)) + '</div>' +
    '<div class="d-meta">' + meta.map(m => '<span class="m">' + esc(m) + '</span>').join('') + '</div>' +
    (b.note ? '<p class="d-note">' + esc(b.note) + '</p>' : '') + closedNote +
    '<div class="d-section"><h5>Your log</h5>' +
    '<div class="seg3" role="group" aria-label="Status">' +
    seg('untried', 'Not yet', e.s === 'untried') + seg('want', 'Want', e.s === 'want') + seg('tried', 'Poured', e.s === 'tried') +
    '</div>' +
    '<div class="rate-row"><div class="rate-drams" role="group" aria-label="Rating">' +
    [1, 2, 3, 4, 5].map(n => '<button type="button" data-r="' + n + '" class="' + (e.r >= n ? 'on' : '') + '" aria-label="Rate ' + n + '">◆</button>').join('') +
    '</div>' + (e.r ? '<button class="rate-clear" type="button" data-r="0">clear rating</button>' : '') + '</div>' +
    '<div class="field-grid">' +
    '<div class="field"><label for="dDate">Date poured</label><input id="dDate" type="date" value="' + esc(e.date || '') + '"></div>' +
    '<div class="field"><label for="dPrice">Price paid</label><input id="dPrice" type="text" placeholder="e.g. $65" value="' + esc(e.price || '') + '"></div>' +
    '</div></div>' +
    '<div class="d-section"><h5>Flavour axes · from your glass</h5><div class="flavors">' +
    FLAVORS.map(([k, label]) => 
      '<div class="flavor"><label for="f-' + k + '">' + label + '</label>' +
      '<input class="flav" id="f-' + k + '" type="range" min="0" max="5" step="1" value="' + (e.f[k] || 0) + '" data-k="' + k + '" style="--pct:' + ((e.f[k] || 0) / 5 * 100) + '%">' +
      '<span class="fv" id="fv-' + k + '">' + (e.f[k] || 0) + '</span></div>').join('') +
    '</div></div>' +
    '<div class="d-section"><h5>Notes</h5><div class="field"><textarea id="dNotes" placeholder="Nose, palate, finish — or just how the night went.">' + esc(e.notes || '') + '</textarea></div></div>';

  function seg(s, label, on) {
    return '<button type="button" data-s="' + s + '" aria-pressed="' + on + '">' + label + '</button>';
  }
}

function wireDrawerControls(b) {
  const root = $('#drawer');
  const mutate = fn => { fn(); save(); renderAtlas(); renderJournal(); if (view === 'map') renderMap(); };

  $$('.seg3 button', root).forEach(btn => btn.addEventListener('click', () => mutate(() => {
    const e = ensureEntry(b.id);
    e.s = btn.dataset.s;
    if (e.s === 'tried' && !e.date) e.date = today();
    if (e.s === 'untried') { e.r = 0; }
    pruneEntry(b.id);
    $$('.seg3 button', root).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.s === (entryOf(b.id)?.s || 'untried'))));
    const dateEl = $('#dDate', root);
    if (dateEl) dateEl.value = entryOf(b.id)?.date || '';
  })));

  $$('.rate-drams button', root).forEach(btn => btn.addEventListener('click', () => mutate(() => {
    const e = ensureEntry(b.id);
    e.r = Number(btn.dataset.r);
    if (e.r > 0 && e.s !== 'tried') { e.s = 'tried'; if (!e.date) e.date = today(); }
    $$('.rate-drams button', root).forEach(x => x.classList.toggle('on', e.r >= Number(x.dataset.r)));
  })));
  const clear = $('.rate-clear', root);
  if (clear) clear.addEventListener('click', () => mutate(() => { ensureEntry(b.id).r = 0; openDrawer(b.id, lastFocus); }));

  $$('input.flav', root).forEach(inp => inp.addEventListener('input', () => {
    const e = ensureEntry(b.id);
    e.f[inp.dataset.k] = Number(inp.value);
    inp.style.setProperty('--pct', (Number(inp.value) / 5 * 100) + '%');
    $('#fv-' + inp.dataset.k, root).textContent = inp.value;
    save();
    if (view === 'map') renderMap();
  }));

  $('#dDate', root).addEventListener('change', ev => mutate(() => { ensureEntry(b.id).date = ev.target.value; }));
  $('#dPrice', root).addEventListener('change', ev => mutate(() => { ensureEntry(b.id).price = ev.target.value; }));
  $('#dNotes', root).addEventListener('change', ev => mutate(() => { ensureEntry(b.id).notes = ev.target.value; }));
}

/* ---------- go ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
boot();
