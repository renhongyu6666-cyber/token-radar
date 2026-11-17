/* Token Radar dashboard: renders window.RADAR (written by main.ts as data.js).
   No fetch, no network, no framework. State lives in the URL hash, so the
   board, a detail view and a filtered view are each a real address:
   #board&q=…&cat=…&chain=…&watch=1&sort=tvl and #board&detail=<slug>. */
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.getElementById('meta').textContent = 'No data: data.js did not load.'; return; }

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n == null) return '<span class="flat">—</span>';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function age(n) {
    if (n == null) return '—';
    if (n >= 365) return (n / 365).toFixed(1) + 'y';
    return n + 'd';
  }

  /* ---- header and filter options ---- */
  var cats = {}, chains = {};
  D.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    $('cat').appendChild(new Option(c, c));
  });
  Object.keys(chains).sort().forEach(function (c) {
    $('chain').appendChild(new Option(c, c));
  });
  var wl = D.rows.filter(function (r) { return r.watchlist; }).length;
  $('meta').innerHTML = 'Snapshot <b>' + esc(D.as_of) + '</b> · <b>' + D.board_size + '</b> pre-token protocols ranked · ' +
    '<b>' + wl + '</b> of ' + D.watchlist_size + ' on the house watchlist · <b>' + D.live_size + '</b> live-token comparables';
  $('model-version').textContent = D.model_version;
  $('as-of').textContent = D.as_of;
  $('model-note').textContent = 'Model ' + D.model_version + ': global median mcap/TVL across tokened protocols is ' +
    D.global_multiple.toFixed(3) + '. Multiples are clamped to ' + D.model.multiple_floor + '–' + D.model.multiple_ceiling +
    '; growth weight ' + D.model.growth_weight + '; longevity bonus ' + D.model.age_bonus_per_year + ' per year, capped at ' +
    D.model.age_bonus_cap_years + ' years.';

  /* ---- hash state ---- */
  function readHash() {
    var p = { view: 'board', q: '', cat: '', chain: '', watch: '', sort: 'rank', detail: '' };
    var h = location.hash.slice(1);
    if (!h) return p;
    h.split('&').forEach(function (part) {
      var i = part.indexOf('=');
      if (i < 0) { if (part === 'board' || part === 'live' || part === 'model') p.view = part; return; }
      var k = decodeURIComponent(part.slice(0, i));
      if (k in p) p[k] = decodeURIComponent(part.slice(i + 1));
    });
    return p;
  }
  function writeHash(p) {
    var parts = [p.view];
    ['q', 'cat', 'chain', 'watch', 'sort', 'detail'].forEach(function (k) {
      if (p[k]) parts.push(k + '=' + encodeURIComponent(p[k]));
    });
    history.replaceState(null, '', '#' + parts.join('&'));
  }
  var state = readHash();

  /* ---- views ---- */
  function showView(v) {
    ['board', 'live', 'model'].forEach(function (name) {
      $('view-' + name).hidden = name !== v;
      $('tab-' + name).classList.toggle('active', name === v);
    });
    if (v === 'live') renderLive();
    if (v === 'model') renderMultiples();
  }
  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.view = btn.getAttribute('data-view');
      state.detail = '';
      writeHash(state);
      render();
    });
  });

  /* ---- board ---- */
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      value: function (a, b) { return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
      growth: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d) || a.rank - b.rank; },
      age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days) || a.rank - b.rank; },
    };
    return rows.sort(by[state.sort] || by.rank);
  }
  function renderBoard() {
    var rows = filteredRows();
    $('count').innerHTML = '<b>' + rows.length + '</b> of ' + D.board_size + ' protocols shown' +
      (state.watch ? ' · watchlist only' : '') + (state.cat ? ' · ' + esc(state.cat) : '') +
      (state.chain ? ' · ' + esc(state.chain) : '') + (state.q ? ' · matching “' + esc(state.q) + '”' : '');
    $('rows').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num rank">#' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' +
        (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ') || '—') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    document.querySelectorAll('#rows tr').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.detail = tr.getAttribute('data-slug');
        writeHash(state);
        renderDetail();
        $('detail').scrollIntoView({ block: 'nearest' });
      });
    });
    renderDetail();
  }
  function renderDetail() {
    var box = $('detail');
    var r = D.rows.find(function (x) { return x.slug === state.detail; });
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var growthPct = r.change_7d == null ? 0 : Math.min(D.model.growth_cap_pct, Math.max(D.model.growth_floor_pct, r.change_7d));
    box.innerHTML =
      '<button type="button" class="close" id="detail-close">Close ×</button>' +
      '<h2>#' + r.rank + ' · ' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.chains.join(', ') || 'no chain listed') +
      ' · tracked since ' + esc(r.listed_at || 'unknown') + ' · records no token yet in the snapshot.</p>' +
      '<h3>Why it is worth ' + money(r.implied_value_usd) + '</h3>' +
      '<div class="breakdown">' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div></div>' +
      '<div class="stat"><div class="k">Category multiple</div><div class="v">×' + r.category_multiple.toFixed(3) +
        ' <small>' + (r.category_peers > 0 ? 'median of ' + r.category_peers + ' tokened peers' : 'global median fallback') + '</small></div></div>' +
      '<div class="stat"><div class="k">Base value</div><div class="v">' + money(r.base_value_usd) + '</div></div>' +
      '<div class="stat"><div class="k">7-day growth</div><div class="v">' + growthPct.toFixed(1) + '% <small>→ ×' + r.growth_multiplier.toFixed(3) + '</small></div></div>' +
      '<div class="stat"><div class="k">Longevity</div><div class="v">×' + r.age_multiplier.toFixed(3) + ' <small>' + age(r.age_days) + ' tracked</small></div></div>' +
      '<div class="stat"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div></div>' +
      '</div>' +
      '<p class="note">TVL × category multiple × growth × longevity = ' + money(r.base_value_usd) + ' × ' +
      r.growth_multiplier.toFixed(3) + ' × ' + r.age_multiplier.toFixed(3) + ' ≈ ' + money(r.implied_value_usd) + '.</p>' +
      '<h3>How to farm it</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    box.hidden = false;
    $('detail-close').addEventListener('click', function () {
      state.detail = '';
      writeHash(state);
      renderBoard();
    });
  }

  /* ---- live comparables ---- */
  var liveDone = false;
  function renderLive() {
    if (liveDone) return;
    liveDone = true;
    $('live-rows').innerHTML = D.live.map(function (r) {
      return '<tr><td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.mcap_tvl_multiple == null ? '—' : '×' + r.mcap_tvl_multiple.toFixed(3)) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  /* ---- category multiples ---- */
  var multDone = false;
  function renderMultiples() {
    if (multDone) return;
    multDone = true;
    var seen = {};
    D.rows.forEach(function (r) {
      var key = r.category || '(no category)';
      if (!seen[key]) seen[key] = r;
    });
    $('mult-rows').innerHTML = Object.keys(seen).sort().map(function (key) {
      var r = seen[key];
      return '<tr><td>' + esc(key) + '</td><td class="num">' + (r.category_peers > 0 ? r.category_peers : '— (global fallback)') +
        '</td><td class="num">×' + r.category_multiple.toFixed(3) + '</td></tr>';
    }).join('');
  }

  /* ---- controls ---- */
  function bind(id, key, event) {
    $(id).addEventListener(event || 'input', function () {
      state[key] = $(id).type === 'checkbox' ? ($(id).checked ? '1' : '') : $(id).value;
      writeHash(state);
      renderBoard();
    });
  }
  bind('q', 'q');
  bind('cat', 'cat', 'change');
  bind('chain', 'chain', 'change');
  bind('watch', 'watch', 'change');
  bind('sort', 'sort', 'change');

  function render() {
    $('q').value = state.q;
    $('cat').value = state.cat;
    $('chain').value = state.chain;
    $('watch').checked = !!state.watch;
    $('sort').value = state.sort;
    showView(state.view);
    renderBoard();
  }
  window.addEventListener('hashchange', function () {
    state = readHash();
    render();
  });
  render();
})();
