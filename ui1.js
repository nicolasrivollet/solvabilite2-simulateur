(function () {
'use strict';
const M = window.Model;
const A = window.App = { M, P: M.clone(M.DEFAULTS), res: null, tabs: {}, active: 'syn' };

A.get = (o, p) => p.split('.').reduce((a, k) => a[k], o);
A.set = (o, p, v) => { const ks = p.split('.'), l = ks.pop(); ks.reduce((a, k) => a[k], o)[l] = v; };
A.fmt = (x, d) => isFinite(x) ? x.toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : '∞';
A.pc = (x, d) => isFinite(x) ? (x * 100).toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) + ' %' : '∞';
A.state = r => r < 1 ? 'crit' : r < 1.5 ? 'warn' : 'ok';
A.stateLabel = r => r < 1 ? 'Sous le SCR' : r < 1.5 ? 'Sous 150 %' : 'Confortable';
const { fmt, pc } = A;

/* Champ de saisie : s = facteur d'affichage (100 pour les pourcentages) */
A.fld = (label, path, o) => {
  o = o || {};
  const s = o.s || 1, v = Math.round(A.get(A.P, path) * s * 1e6) / 1e6;
  return `<label class="f"><span>${label}</span><span class="in"><input type="number" inputmode="decimal" data-p="${path}" data-s="${s}" step="${o.step || 'any'}" value="${v}"><em>${o.u || ''}</em></span></label>`;
};
A.sel = (label, path, opts) => {
  const cur = A.get(A.P, path);
  return `<label class="f"><span>${label}</span><select data-p="${path}">${opts.map(x => `<option${x === cur ? ' selected' : ''}>${x}</option>`).join('')}</select></label>`;
};

A.bars = (rows, o) => {
  o = o || {};
  const mx = Math.max(o.max || 0, ...rows.map(r => Math.abs(r.v)), 1e-9);
  return '<div class="rows">' + rows.map(r =>
    `<div class="row"><span>${r.l}</span><span class="t"><i class="${r.v < 0 ? 'neg' : ''}" style="width:${Math.min(100, Math.abs(r.v) / mx * 100)}%;${r.c ? 'background:' + r.c : ''}"></i></span><span class="v">${fmt(r.v, o.d || 0)}</span></div>`).join('') + '</div>';
};

/* Graphique en courbes : series [{pts:[[x,y]], c, dash}], lignes de repère [{y, l}] */
A.line = (series, o) => {
  const W = 640, H = 230, L = 44, R = 12, T = 12, B = 26;
  const xs = series.flatMap(s => s.pts.map(p => p[0])), ys = series.flatMap(s => s.pts.map(p => p[1])).concat((o.refs || []).map(r => r.y));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = o.y0 != null ? o.y0 : Math.min(...ys), y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.08 || 1; y1 += pad; if (o.y0 == null) y0 -= pad;
  const X = x => L + (x - x0) / ((x1 - x0) || 1) * (W - L - R), Y = y => H - B - (y - y0) / ((y1 - y0) || 1) * (H - B - T);
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = y0 + (y1 - y0) * i / 4; g += `<line class="ax" x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}"/><text x="${L - 6}" y="${Y(y) + 3}" text-anchor="end">${o.yf ? o.yf(y) : fmt(y)}</text>`; }
  const step = Math.max(1, Math.ceil((x1 - x0) / 8));
  for (let x = x0; x <= x1; x += step) g += `<text x="${X(x)}" y="${H - 8}" text-anchor="middle">${o.xf ? o.xf(x) : x}</text>`;
  (o.refs || []).forEach(r => { g += `<line x1="${L}" x2="${W - R}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="${r.c || 'var(--ink2)'}" stroke-dasharray="4 4"/><text x="${W - R}" y="${Y(r.y) - 4}" text-anchor="end">${r.l}</text>`; });
  series.forEach(s => {
    g += `<polyline class="ln" stroke="${s.c}" points="${s.pts.map(p => X(p[0]) + ',' + Y(p[1])).join(' ')}"/>`;
    if (s.dots) s.pts.forEach(p => { g += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3.5" fill="${s.c}"/>`; });
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${o.label || 'graphique'}" style="max-width:100%;height:auto">${g}</svg>`;
};

A.matrix = (key, names) => {
  const m = A.P.corr[key];
  return `<div class="scroll"><table class="mx"><tr><th></th>${names.map(n => `<th>${n}</th>`).join('')}</tr>` +
    m.map((row, i) => `<tr><th>${names[i]}</th>${row.map((v, j) => i === j ? '<td class="mut">1</td>' : `<td><input type="number" step="0.05" min="-1" max="1" data-corr="${key},${i},${j}" value="${v}"></td>`).join('')}</tr>`).join('') + '</table></div>';
};

/* ---------- En-tête ---------- */
A.renderLive = r => {
  const st = A.state(r.ratio);
  $('#live').innerHTML = `<div><div class="k">Ratio SCR</div><div class="v">${pc(r.ratio)}</div></div><div><div class="k">Ratio MCR</div><div class="v">${pc(r.ratioMcr)}</div></div><span class="pill ${st}">${A.stateLabel(r.ratio)}</span>`;
};
function $(s) { return document.querySelector(s); }
A.$ = $;

/* ---------- Synthèse ---------- */
A.tabs.syn = {
  label: 'Synthèse',
  build() {
    $('#tab-syn').innerHTML = `
      <div class="kpis" id="syn-kpi"></div>
      <div class="grid">
        <div class="card"><h2>Couverture du SCR</h2><div id="syn-gauge"></div><div id="syn-cov"></div></div>
        <div class="card"><h2>Du SCR de base au SCR final</h2><div id="syn-scr"></div></div>
      </div>
      <div class="card"><h2>Bilan économique</h2><div class="bs" id="syn-bs"></div><p class="note">Hauteur proportionnelle à la valeur de marché. Le passif inclut la marge de risque et les dettes subordonnées ; le solde est l'excédent d'actifs sur passifs.</p></div>`;
  },
  update(r) {
    const st = A.state(r.ratio);
    $('#syn-kpi').innerHTML = [
      ['Ratio de solvabilité', pc(r.ratio), `<span class="pill ${st}">${A.stateLabel(r.ratio)}</span>`],
      ['Ratio MCR', pc(r.ratioMcr), 'seuil réglementaire 100 %'],
      ['Fonds propres éligibles', fmt(r.of.elig, 1), 'couverture du SCR'],
      ['SCR', fmt(r.scr.total, 1), 'MCR ' + fmt(r.mcr.total, 1)]
    ].map(k => `<div class="kpi"><div class="k">${k[0]}</div><div class="v">${k[1]}</div><div class="s">${k[2]}</div></div>`).join('');
    const sc = 3, w = Math.min(100, r.ratio / sc * 100);
    $('#syn-gauge').innerHTML = `<div class="gauge"><i style="width:${w}%;background:var(--${st})"></i><b style="left:${100 / sc}%"><span>100 %</span></b><b style="left:${150 / sc}%"><span>150 %</span></b></div>`;
    $('#syn-cov').innerHTML = A.bars([{ l: 'Fonds propres éligibles', v: r.of.elig, c: 'var(--c2)' }, { l: 'SCR', v: r.scr.total, c: 'var(--c1)' }, { l: 'MCR', v: r.mcr.total, c: 'var(--c3)' }], { d: 1 });
    const s = r.scr;
    $('#syn-scr').innerHTML = A.bars([
      { l: 'Marché', v: s.mkt }, { l: 'Contrepartie', v: s.def }, { l: 'Souscription vie', v: s.life }, { l: 'Souscription non-vie', v: s.nl },
      { l: 'BSCR (diversifié)', v: s.bscr, c: 'var(--c1)' }, { l: 'Opérationnel', v: s.op }, { l: 'Absorption PB futures', v: -s.lacFDB }, { l: 'Absorption imp. différés', v: -s.lacDT }, { l: 'SCR', v: s.total, c: 'var(--c1)' }
    ], { d: 1 });
    const a = r.assets, l = r.liab;
    const colA = [["Obligations d'État", a.gov], ['Obligations privées', a.corp], ['Actions', a.eq1 + a.eq2], ['Immobilier', a.prop], ['Trésorerie', a.cash], ['Part des réassureurs', a.ri], ['Autres actifs', a.other]];
    const colP = [['Excédent (FP de base)', r.excess], ['Dettes subordonnées', l.sub], ['Autres passifs', l.other], ['Marge de risque', l.rm], ['Meilleure estimation vie', l.vie], ['Meilleure estimation non-vie', l.nl]];
    const seg = (rows, cols) => rows.map((x, i) => `<div style="flex:${Math.max(x[1], 0.001)} 1 0;background:var(--c${cols[i]})"><span>${x[0]}</span><em>${fmt(x[1])}</em></div>`).join('');
    $('#syn-bs').innerHTML = `<div><div class="lh">Actif · ${fmt(r.assetTotal)}</div><div class="col">${seg(colA, [1, 2, 3, 4, 5, 6, 7])}</div></div><div><div class="lh">Passif · ${fmt(l.total + r.excess)}</div><div class="col">${seg(colP, [2, 6, 7, 5, 1, 3])}</div></div>`;
  }
};

/* ---------- Hypothèses ---------- */
A.tabs.hyp = {
  label: 'Hypothèses',
  build() {
    const F = A.fld, P = A.P;
    const lob = P.nl.lob.map((l, i) => `<tr><td>${l.n}</td>${['pPrem', 'pRes', 'sp', 'sr'].map(k => `<td><input type="number" step="any" data-p="nl.lob.${i}.${k}" data-s="100" value="${Math.round(l[k] * 1e4) / 100}"></td>`).join('')}</tr>`).join('');
    $('#tab-hyp').innerHTML = `
      <div class="bar"><p class="note" style="margin:0">Toutes les saisies recalculent le modèle immédiatement.</p><button class="btn" id="reset">Valeurs par défaut</button></div>
      <div class="grid">
        <div class="card"><h2>Courbe des taux sans risque</h2>
          ${F('Taux court (spot 0)', 'rateShort', { s: 100, step: 0.05, u: '%' })}${F('Taux ultime (UFR)', 'rateUlt', { s: 100, step: 0.05, u: '%' })}${F('Vitesse de convergence', 'theta', { u: 'ans' })}${F('Coût du capital (marge de risque)', 'coc', { s: 100, step: 0.5, u: '%' })}
          <p class="note">Spot : r(t) = UFR − (UFR − court) · e<sup>−t/θ</sup>. Chocs de taux EIOPA appliqués par maturité.</p></div>
        <div class="card"><h2>Allocation d'actifs (normalisée à 100)</h2>
          ${F("Obligations d'État", 'alloc.gov', { u: '%' })}${F('Obligations privées', 'alloc.corp', { u: '%' })}${F('Actions type 1', 'alloc.eq1', { u: '%' })}${F('Actions type 2', 'alloc.eq2', { u: '%' })}${F('Immobilier', 'alloc.prop', { u: '%' })}${F('Trésorerie', 'alloc.cash', { u: '%' })}
          <p class="note" id="alloc-sum"></p></div>
        <div class="card"><h2>Portefeuille obligataire</h2>
          ${F('Maturité moyenne, États', 'mGov', { u: 'ans' })}${F('Maturité moyenne, privées', 'mCorp', { u: 'ans' })}${F('Spread moyen, privées', 'spreadCorp', { s: 100, step: 0.05, u: '%' })}
          <h3>Notation des obligations privées (%)</h3>
          ${F('AAA / AA', 'rating.aa', { u: '%' })}${F('A', 'rating.a', { u: '%' })}${F('BBB', 'rating.bbb', { u: '%' })}${F('BB', 'rating.bb', { u: '%' })}${F('B et moins', 'rating.b', { u: '%' })}
          <h3>Actions et immobilier</h3>
          ${F('Rendement attendu actions', 'yEq', { s: 100, step: 0.1, u: '%' })}${F('Rendement immobilier', 'yProp', { s: 100, step: 0.1, u: '%' })}${F('Ajustement symétrique actions', 'eqSA', { s: 100, step: 0.5, u: 'pts' })}</div>
        <div class="card"><h2>Non-vie</h2>
          ${F('Primes émises', 'nl.prem', { u: 'M€' })}${F('Croissance annuelle', 'nl.g', { s: 100, step: 0.5, u: '%' })}${F('Ratio sinistres / primes', 'nl.lr', { s: 100, step: 0.5, u: '%' })}${F('Ratio de frais', 'nl.er', { s: 100, step: 0.5, u: '%' })}${F('Provision pour primes non acquises', 'nl.upr', { s: 100, step: 1, u: '% prim.' })}${F('Part des réassureurs', 'nl.riShare', { s: 100, step: 0.5, u: '%' })}${F('Facteur de queue', 'nl.tail', { step: 0.005, u: '×' })}${F('Durée de la queue', 'nl.tailYears', { u: 'ans' })}${F('Charge catastrophe naturelle', 'nl.catPct', { s: 100, step: 0.5, u: '% prim.' })}</div>
        <div class="card"><h2>Vie (épargne en euros et prévoyance)</h2>
          ${F('Provisions mathématiques', 'vie.pm', { u: 'M€' })}${F('Taux de rachat annuel', 'vie.lapse', { s: 100, step: 0.25, u: '%' })}${F('Mortalité épargne', 'vie.qDeath', { s: 100, step: 0.05, u: '%' })}${F('Marge de gestion', 'vie.fee', { s: 100, step: 0.05, u: '%' })}${F('Frais de gestion', 'vie.expense', { s: 100, step: 0.05, u: '%' })}${F('Taux minimum garanti', 'vie.tmg', { s: 100, step: 0.1, u: '%' })}${F('Inflation des frais', 'vie.infl', { s: 100, step: 0.1, u: '%' })}${F('Capitaux sous risque', 'vie.car', { u: 'M€' })}${F('Mortalité sur capitaux', 'vie.qCar', { s: 100, step: 0.01, u: '%' })}${F('Durée moyenne des garanties décès', 'vie.carTerm', { u: 'ans' })}${F('Provisions de rentes', 'vie.rentes', { u: 'M€' })}${F('Sensibilité longévité', 'vie.kLong', { step: 0.01, u: '×' })}${F('PB futures discrétionnaires', 'vie.fdb', { u: 'M€' })}${F('Primes vie', 'vie.prem', { u: 'M€' })}${F('Croissance des provisions', 'vie.g', { s: 100, step: 0.5, u: '%' })}</div>
        <div class="card"><h2>Fonds propres et fiscalité</h2>
          ${F("Excédent d'actifs sur passifs", 'cap.excess', { u: 'M€' })}${F('Dette subordonnée perpétuelle (T1 restreint)', 'cap.t1r', { u: 'M€' })}${F('Dette subordonnée datée (T2)', 'cap.t2', { u: 'M€' })}${F('Impôts différés actifs nets (T3)', 'dta', { u: 'M€' })}${F('Dividende prévisible', 'cap.dividend', { u: 'M€' })}${F('Taux d\'impôt', 'cap.taxRate', { s: 100, step: 0.5, u: '%' })}${F('Plafond absorption imp. différés', 'cap.dtlCap', { u: 'M€' })}${F('Plancher absolu du MCR', 'cap.amcr', { u: 'M€' })}${F('Coût de la dette subordonnée', 'cap.debtRate', { s: 100, step: 0.1, u: '%' })}${F('Taux de distribution', 'cap.payout', { s: 100, step: 5, u: '%' })}${F('Autres actifs', 'otherAssets', { u: 'M€' })}${F('Autres passifs', 'otherLiab', { u: 'M€' })}</div>
        <div class="card"><h2>Réassurance et contreparties</h2>
          ${A.sel('Réassureur 1', 'cpty.ri1', ['AAA', 'AA', 'A', 'BBB', 'BB', 'B'])}${A.sel('Réassureur 2', 'cpty.ri2', ['AAA', 'AA', 'A', 'BBB', 'BB', 'B'])}${F('Part du réassureur 1', 'cpty.split1', { s: 100, step: 5, u: '%' })}${A.sel('Banque (trésorerie)', 'cpty.bank', ['AAA', 'AA', 'A', 'BBB', 'BB', 'B'])}${F('Créances sur assurés > 3 mois', 'cpty.receivables', { u: 'M€' })}</div>
        <div class="card"><h2>Branches non-vie (SCR primes et réserves)</h2><div class="scroll"><table><tr><th>Branche</th><th class="n">Part primes %</th><th class="n">Part réserves %</th><th class="n">σ primes %</th><th class="n">σ réserves %</th></tr>${lob}</table></div><p class="note">Les parts de primes et de réserves doivent chacune totaliser 100 %. σ : écarts-types indicatifs.</p></div>
      </div>`;
    $('#reset').onclick = () => { A.P = M.clone(M.DEFAULTS); A.buildAll(); A.refresh(); };
  },
  update() {
    const a = A.P.alloc, s = a.gov + a.corp + a.eq1 + a.eq2 + a.prop + a.cash;
    const el = $('#alloc-sum'); if (el) el.textContent = 'Total saisi : ' + fmt(s) + ' %' + (Math.abs(s - 100) > 0.01 ? ' (ramené à 100 dans le calcul)' : '');
  }
};
})();
