(function () {
'use strict';
const A = window.App, M = A.M, $ = A.$, fmt = A.fmt, pc = A.pc;

/* ---------- Provisions ---------- */
A.tabs.prov = {
  label: 'Provisions',
  build() {
    const tri = A.P.nl.tri, n = tri.length;
    let h = '<tr><th>Année de survenance</th>' + tri[0].map((_, k) => `<th class="n">An ${k}</th>`).join('') + '<th class="n">Ultime</th><th class="n">Réserve</th></tr>';
    tri.forEach((row, i) => {
      h += `<tr><td>${n - 1 - i === 0 ? 'N' : 'N−' + (n - 1 - i)}</td>`;
      for (let k = 0; k < n; k++) h += k < row.length ? `<td class="n"><input type="number" step="any" data-tri="${i},${k}" value="${row[k]}"></td>` : `<td class="n mut" id="pc-${i}-${k}"></td>`;
      h += `<td class="n" id="ul-${i}"></td><td class="n" id="rs-${i}"></td></tr>`;
    });
    h += '<tr class="tot"><td>Facteur de développement</td>' + tri[0].map((_, k) => `<td class="n" id="cf-${k}">${k < n - 1 ? '' : ''}</td>`).join('') + '<td></td><td class="n" id="rs-tot"></td></tr>';
    $('#tab-prov').innerHTML = `
      <div class="card"><h2>Triangle des paiements cumulés et Chain Ladder</h2><div class="scroll"><table>${h}</table></div>
        <p class="note">Saisissez les paiements cumulés observés (M€). Les cellules grisées sont projetées par Chain Ladder (facteurs pondérés par les volumes), puis une queue est ajoutée.</p></div>
      <div id="prov-out" class="grid"></div>`;
  },
  update(r) {
    const tri = A.P.nl.tri, n = tri.length;
    tri.forEach((row, i) => {
      for (let k = row.length; k < n; k++) { const e = $(`#pc-${i}-${k}`); if (e) e.textContent = fmt(r.cl.proj[i][k], 1); }
      $(`#ul-${i}`).textContent = fmt(r.cl.ult[i], 1); $(`#rs-${i}`).textContent = fmt(r.cl.reserve[i], 1);
    });
    for (let k = 0; k < n; k++) { const e = $(`#cf-${k}`); if (e) e.textContent = k < n - 1 ? r.cl.f[k].toFixed(3).replace('.', ',') : A.P.nl.tail.toFixed(3).replace('.', ','); }
    $('#rs-tot').textContent = fmt(r.cl.total, 1);
    const p = r.prov;
    const cf = r.cl.cf.map((v, h) => ({ l: h === 0 ? null : 'Année +' + h, v })).filter(x => x.l && x.v > 0.05);
    const prof = p.vieProfile.map((v, t) => [t, v]);
    $('#prov-out').innerHTML = `
      <div class="card"><h2>Provisions techniques (meilleure estimation)</h2><div class="scroll"><table>
        <tr><td>Sinistres non-vie actualisés</td><td class="n">${fmt(p.beClaims, 1)}</td></tr>
        <tr><td>Primes non-vie</td><td class="n">${fmt(p.pp, 1)}</td></tr>
        <tr><td>Épargne et prévoyance vie</td><td class="n">${fmt(p.beVie, 1)}</td></tr>
        <tr><td>Marge de risque (${pc(A.P.coc, 1)} coût du capital)</td><td class="n">${fmt(p.rm, 1)}</td></tr>
        <tr class="tot"><td>Provisions techniques brutes</td><td class="n">${fmt(p.total, 1)}</td></tr>
        <tr><td class="mut">Dont part des réassureurs (actif)</td><td class="n mut">${fmt(p.riRec, 1)}</td></tr></table></div>
        <p class="note">Primes : provision pour primes non acquises × (ratio combiné − 100 %), négative si l'activité est rentable. La marge de risque se calcule sur le SCR hors marché, écoulé selon le profil de run-off.</p></div>
      <div class="card"><h2>Flux de règlements non-vie</h2>${A.bars(cf, { d: 1 })}<p class="note">Cash-flows nominaux projetés, actualisés à mi-année sur la courbe sans risque.</p></div>
      <div class="card" style="grid-column:1/-1"><h2>Vie : écoulement des provisions mathématiques</h2>${A.line([{ pts: prof, c: 'var(--c2)' }], { y0: 0, xf: x => x, label: 'Écoulement des provisions vie' })}
        <p class="note">Taux servi = max(TMG ; taux forward − marge de gestion), rachats et décès en fin d'année, frais indexés. Le TMG n'est valorisé qu'en valeur intrinsèque, sans option temps.</p></div>`;
  }
};

/* ---------- SCR ---------- */
A.tabs.scr = {
  label: 'SCR',
  build() {
    const lobN = A.P.nl.lob.map(l => l.n);
    $('#tab-scr').innerHTML = `<div id="scr-out" class="grid"></div>
      <div class="card"><h2>Matrices de corrélation</h2>
        <details><summary>Agrégation des modules</summary>${A.matrix('top', ['Marché', 'Contrepartie', 'Vie', 'Non-vie'])}</details>
        <details><summary>Marché, choc de taux à la hausse</summary>${A.matrix('mktUp', ['Taux', 'Actions', 'Immo.', 'Spread'])}</details>
        <details><summary>Marché, choc de taux à la baisse</summary>${A.matrix('mktDn', ['Taux', 'Actions', 'Immo.', 'Spread'])}</details>
        <details><summary>Souscription vie</summary>${A.matrix('life', ['Mortal.', 'Longév.', 'Rachats', 'Frais', 'Cat.'])}</details>
        <details><summary>Non-vie, branches</summary>${A.matrix('lob', lobN)}</details>
        <details><summary>Non-vie, primes et réserves / catastrophe</summary>${A.matrix('nl', ['Prim.&rés.', 'Cat.'])}</details></div>`;
  },
  update(r) {
    const s = r.scr;
    const obj = o => Object.keys(o).map(k => ({ l: k, v: o[k] }));
    const lob = s.lob.map(l => `<tr><td>${l.n}</td><td class="n">${fmt(l.Vp, 1)}</td><td class="n">${fmt(l.Vr, 1)}</td><td class="n">${pc(l.sig, 1)}</td><td class="n">${fmt(l.scr, 1)}</td></tr>`).join('');
    const ex = s.defParts.exposures.map(x => `<tr><td>${x.n}</td><td class="n">${fmt(x.E, 1)}</td><td class="n">${pc(x.pd, 3)}</td></tr>`).join('');
    $('#scr-out').innerHTML = `
      <div class="card"><h2>Marché · ${fmt(s.mkt, 1)}</h2>${A.bars(obj(s.mktParts), { d: 1 })}
        <p class="note">Taux : perte de fonds propres après recalcul des actifs obligataires, des provisions non-vie et de la projection vie. Hausse ${fmt(s.irUp, 1)} · baisse ${fmt(s.irDn, 1)} (valeur négative : gain).</p></div>
      <div class="card"><h2>Souscription vie · ${fmt(s.life, 1)}</h2>${A.bars(obj(s.lifeParts), { d: 1 })}
        <p class="note">Rachats : baisse ${fmt(s.lapseDetail.lapDn, 1)} · hausse ${fmt(s.lapseDetail.lapUp, 1)} · rachat massif de 40 % ${fmt(s.lapseDetail.lapMass, 1)}. Le pire des trois est retenu.</p></div>
      <div class="card"><h2>Souscription non-vie · ${fmt(s.nl, 1)}</h2>${A.bars(obj(s.nlParts), { d: 1 })}
        <div class="scroll"><table style="margin-top:10px"><tr><th>Branche</th><th class="n">Vol. primes</th><th class="n">Vol. réserves</th><th class="n">σ combiné</th><th class="n">SCR</th></tr>${lob}</table></div>
        <p class="note">SCR de branche = 3 × σ × volume, avec σ combiné primes et réserves (corrélation 0,5).</p></div>
      <div class="card"><h2>Contrepartie · ${fmt(s.def, 1)}</h2><div class="scroll"><table><tr><th>Contrepartie</th><th class="n">Exposition</th><th class="n">PD</th></tr>${ex}</table></div>
        <p class="note">Type 1 : ${fmt(s.defParts.t1, 2)} · Type 2 : ${fmt(s.defParts.t2, 2)} (15 % des créances de plus de 3 mois). Perte en cas de défaut : 50 %.</p></div>
      <div class="card"><h2>Agrégation finale</h2><div class="scroll"><table>
        <tr><td>BSCR après diversification</td><td class="n">${fmt(s.bscr, 1)}</td></tr><tr><td>Risque opérationnel</td><td class="n">${fmt(s.op, 1)}</td></tr>
        <tr><td>Absorption par les PB futures</td><td class="n">−${fmt(s.lacFDB, 1)}</td></tr><tr><td>Absorption par les impôts différés</td><td class="n">−${fmt(s.lacDT, 1)}</td></tr>
        <tr class="tot"><td>SCR</td><td class="n">${fmt(s.total, 1)}</td></tr></table></div>
        <p class="note">Absorption PB : min(PB futures disponibles ; SCR marché). Impôts différés : taux d'impôt × (BSCR + opérationnel − absorption PB), plafonné.</p></div>`;
  }
};

/* ---------- Fonds propres ---------- */
A.tabs.fp = {
  label: 'Fonds propres',
  build() { $('#tab-fp').innerHTML = '<div id="fp-out" class="grid"></div>'; },
  update(r) {
    const o = r.of, s = r.scr.total, C = A.P.cap;
    const t1 = o.t1u + o.t1rEl;
    const chk = (ok, txt) => `<span class="pill ${ok ? 'ok' : 'crit'}">${txt}</span>`;
    $('#fp-out').innerHTML = `
      <div class="card"><h2>Des actifs aux fonds propres de base</h2><div class="scroll"><table>
        <tr><td>Excédent d'actifs sur passifs</td><td class="n">${fmt(r.excess, 1)}</td></tr>
        <tr><td>+ Dette subordonnée perpétuelle</td><td class="n">${fmt(C.t1r, 1)}</td></tr>
        <tr><td>+ Dette subordonnée datée</td><td class="n">${fmt(C.t2, 1)}</td></tr>
        <tr><td>− Dividende prévisible</td><td class="n">−${fmt(o.divd, 1)}</td></tr>
        <tr class="tot"><td>Fonds propres de base</td><td class="n">${fmt(o.total, 1)}</td></tr></table></div></div>
      <div class="card"><h2>Classement et éligibilité (SCR)</h2><div class="scroll"><table>
        <tr><th>Niveau</th><th class="n">Montant</th><th class="n">Éligible</th></tr>
        <tr><td>Niveau 1 non restreint</td><td class="n">${fmt(o.t1u, 1)}</td><td class="n">${fmt(o.t1u, 1)}</td></tr>
        <tr><td>Niveau 1 restreint</td><td class="n">${fmt(o.t1r, 1)}</td><td class="n">${fmt(o.t1rEl, 1)}</td></tr>
        <tr><td>Niveau 2</td><td class="n">${fmt(o.t2, 1)}</td><td class="n">${fmt(o.t2El, 1)}</td></tr>
        <tr><td>Niveau 3 (impôts différés actifs)</td><td class="n">${fmt(o.t3, 1)}</td><td class="n">${fmt(o.t3El, 1)}</td></tr>
        <tr class="tot"><td>Total</td><td class="n">${fmt(o.t1u + o.t1r + o.t2 + o.t3, 1)}</td><td class="n">${fmt(o.elig, 1)}</td></tr></table></div>
        <p class="note">Éligibles : niveau 1 restreint ≤ 20 % du niveau 1, niveau 3 ≤ 15 % du SCR, niveaux 2 et 3 ≤ 50 % du SCR.</p></div>
      <div class="card"><h2>Contrôles de couverture du SCR</h2><div class="scroll"><table>
        <tr><td>Niveau 1 ≥ 50 % du SCR</td><td class="n">${pc(s > 0 ? t1 / s : 0, 0)}</td><td>${chk(t1 >= 0.5 * s, t1 >= 0.5 * s ? 'Respecté' : 'Dépassé')}</td></tr>
        <tr><td>Niveau 3 ≤ 15 % du SCR</td><td class="n">${pc(s > 0 ? o.t3 / s : 0, 0)}</td><td>${chk(o.t3 <= 0.15 * s, o.t3 <= 0.15 * s ? 'Respecté' : 'Plafonné')}</td></tr>
        <tr><td>Niveaux 2 + 3 ≤ 50 % du SCR</td><td class="n">${pc(s > 0 ? (o.t2 + o.t3) / s : 0, 0)}</td><td>${chk(o.t2 + o.t3 <= 0.5 * s, o.t2 + o.t3 <= 0.5 * s ? 'Respecté' : 'Plafonné')}</td></tr>
        <tr class="tot"><td>Ratio SCR</td><td class="n">${pc(r.ratio, 1)}</td><td>${chk(r.ratio >= 1, r.ratio >= 1 ? 'Couvert' : 'Non couvert')}</td></tr></table></div></div>
      <div class="card"><h2>Minimum de capital requis</h2><div class="scroll"><table>
        <tr><td>MCR linéaire</td><td class="n">${fmt(r.mcr.lin, 1)}</td></tr>
        <tr><td>Corridor 25 % à 45 % du SCR</td><td class="n">${fmt(0.25 * s, 1)} – ${fmt(0.45 * s, 1)}</td></tr>
        <tr><td>Plancher absolu</td><td class="n">${fmt(C.amcr, 1)}</td></tr>
        <tr class="tot"><td>MCR</td><td class="n">${fmt(r.mcr.total, 1)}</td></tr>
        <tr><td>Fonds propres éligibles au MCR</td><td class="n">${fmt(o.eligMcr, 1)}</td></tr>
        <tr class="tot"><td>Ratio MCR</td><td class="n">${pc(r.ratioMcr, 1)}</td></tr></table></div>
        <p class="note">MCR linéaire simplifié : 8 % des provisions non-vie + 7 % des primes + 3,7 % des provisions vie + 0,07 % des capitaux sous risque. Niveau 3 exclu, niveau 2 ≤ 20 % du MCR.</p></div>`;
  }
};

/* ---------- Chocs ---------- */
A.SC = { shiftBp: 0, eq: 0, prop: 0, spreadBp: 0, reserveStrain: 0, lrAdd: 0, lapseMult: 1, catNet: 0 };
const SC_FIELDS = [['shiftBp', 'Décalage de la courbe', 'pb', 10], ['eq', 'Variation des actions', '%', 1], ['prop', 'Variation de l\'immobilier', '%', 1], ['spreadBp', 'Écartement des spreads', 'pb', 10], ['reserveStrain', 'Renforcement des provisions non-vie', '%', 1], ['lrAdd', 'Dérive du ratio sinistres / primes', 'pts', 0.5], ['lapseMult', 'Multiple du taux de rachat', '×', 0.1], ['catNet', 'Sinistre catastrophe net de réassurance', 'M€', 5]];
function scenFromUi() {
  const c = A.SC;
  return { shiftBp: c.shiftBp, eq: c.eq / 100, prop: c.prop / 100, spreadBp: c.spreadBp, reserveStrain: c.reserveStrain / 100, lrAdd: c.lrAdd / 100, lapseMult: c.lapseMult, catNet: c.catNet };
}
A.tabs.chocs = {
  label: 'Chocs',
  build() {
    $('#tab-chocs').innerHTML = `
      <div class="card"><h2>Scénarios instantanés sur le bilan de départ</h2><div id="ch-list"></div>
        <p class="note">Chaque ligne revalorise les actifs, recalcule les provisions et le SCR, puis compare au ratio de base.</p></div>
      <div class="card"><h2>Scénario libre</h2>
        ${SC_FIELDS.map(f => `<label class="f"><span>${f[1]}</span><span class="in"><input type="number" inputmode="decimal" data-scen="${f[0]}" step="${f[3]}" value="${A.SC[f[0]]}"><em>${f[2]}</em></span></label>`).join('')}
        <div id="ch-custom" style="margin-top:12px"></div></div>`;
  },
  update(r) {
    const base = r.ratio * 100;
    const rows = M.SCENARIOS.map(s => ({ n: s.n, q: M.compute(A.P, s.s) }));
    const mx = Math.max(...rows.map(x => Math.abs(x.q.ratio * 100 - base)), 1);
    const line = (n, q) => {
      const d = q.ratio * 100 - base, w = Math.abs(d) / mx * 50;
      return `<div class="scn"><span>${n}</span><span class="t"><u></u><i style="${d < 0 ? 'right' : 'left'}:50%;width:${w}%;background:var(--${d < 0 ? 'crit' : 'ok'})"></i></span><span class="num">${pc(q.ratio)}</span><span class="num" style="color:var(--ink2)">${(d >= 0 ? '+' : '−') + fmt(Math.abs(d))} pts</span></div>`;
    };
    $('#ch-list').innerHTML = `<div class="scn" style="font-size:11px;color:var(--ink2);font-weight:700"><span>SCÉNARIO</span><span class="t" style="background:none"></span><span class="num">RATIO</span><span class="num">ÉCART</span></div>` + rows.map(x => line(x.n, x.q)).join('');
    const q = M.compute(A.P, scenFromUi());
    $('#ch-custom').innerHTML = `<div class="scroll"><table>
      <tr><th></th><th class="n">Base</th><th class="n">Choc</th></tr>
      <tr><td>Fonds propres éligibles</td><td class="n">${fmt(r.of.elig, 1)}</td><td class="n">${fmt(q.of.elig, 1)}</td></tr>
      <tr><td>SCR</td><td class="n">${fmt(r.scr.total, 1)}</td><td class="n">${fmt(q.scr.total, 1)}</td></tr>
      <tr class="tot"><td>Ratio de solvabilité</td><td class="n">${pc(r.ratio)}</td><td class="n">${pc(q.ratio)}</td></tr></table></div>`;
  }
};

/* ---------- Projection ---------- */
A.tabs.proj = {
  label: 'Projection 5 ans',
  build() {
    const F = A.fld;
    $('#tab-proj').innerHTML = `
      <div class="grid">
        <div class="card"><h2>Hypothèses de trajectoire</h2>${F('Croissance des primes non-vie', 'nl.g', { s: 100, step: 0.5, u: '%' })}${F('Croissance des provisions vie', 'vie.g', { s: 100, step: 0.5, u: '%' })}${F('Ratio sinistres / primes', 'nl.lr', { s: 100, step: 0.5, u: '%' })}${F('Ratio de frais', 'nl.er', { s: 100, step: 0.5, u: '%' })}${F('Taux de distribution', 'cap.payout', { s: 100, step: 5, u: '%' })}${F('Marge de gestion vie', 'vie.fee', { s: 100, step: 0.05, u: '%' })}
          <p class="note">Le bilan est reconstruit chaque année : provisions recalculées, actifs ajustés pour absorber le résultat, SCR recalculé en entier.</p></div>
        <div class="card"><h2>Trajectoire du ratio</h2><div id="pj-chart"></div></div>
      </div>
      <div class="card"><h2>Compte de résultat simplifié et solvabilité</h2><div class="scroll" id="pj-table"></div></div>
      <div class="card"><h2>Fonds propres éligibles et SCR</h2><div id="pj-chart2"></div></div>`;
  },
  update() {
    const rows = M.project(A.P, 5);
    const lbl = y => y === 0 ? 'N' : 'N+' + y;
    $('#pj-chart').innerHTML = A.line([{ pts: rows.map(r => [r.y, r.ratio * 100]), c: 'var(--c2)', dots: true }], { refs: [{ y: 100, l: '100 %', c: 'var(--crit)' }, { y: 150, l: '150 %', c: 'var(--warn)' }], yf: v => fmt(v) + ' %', xf: lbl, label: 'Ratio de solvabilité projeté' });
    $('#pj-chart2').innerHTML = A.line([{ pts: rows.map(r => [r.y, r.elig]), c: 'var(--c2)' }, { pts: rows.map(r => [r.y, r.scr]), c: 'var(--c1)' }], { y0: 0, xf: lbl, label: 'Fonds propres et SCR projetés' }) + '<p class="note"><span style="color:var(--c2)">━</span> Fonds propres éligibles &nbsp; <span style="color:var(--c1)">━</span> SCR</p>';
    $('#pj-table').innerHTML = `<table><tr><th>Année</th><th class="n">Résultat technique NV</th><th class="n">Produits financiers</th><th class="n">Marge vie</th><th class="n">Résultat net</th><th class="n">Dividende</th><th class="n">FP éligibles</th><th class="n">SCR</th><th class="n">Ratio</th></tr>` +
      rows.map(r => `<tr><td>${lbl(r.y)}</td>${r.y === 0 ? '<td class="n mut" colspan="5">situation de départ</td>' : `<td class="n">${fmt(r.uw, 1)}</td><td class="n">${fmt(r.fin, 1)}</td><td class="n">${fmt(r.vm, 1)}</td><td class="n">${fmt(r.net, 1)}</td><td class="n">${fmt(r.div, 1)}</td>`}<td class="n">${fmt(r.elig, 1)}</td><td class="n">${fmt(r.scr, 1)}</td><td class="n">${pc(r.ratio)}</td></tr>`).join('') + '</table>';
  }
};

/* ---------- Pilotage ---------- */
const ORDER = ['syn', 'hyp', 'prov', 'scr', 'fp', 'chocs', 'proj'];
const KEY = 's2-sim-v1';
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify({ P: A.P, tab: A.active, SC: A.SC })); } catch (e) {} }, 400);
}
function load() {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return;
    const s = JSON.parse(raw);
    if (s && s.P && s.P.nl && s.P.vie && s.P.corr && s.P.cap && s.P.alloc) { A.P = s.P; if (s.SC) A.SC = s.SC; if (ORDER.includes(s.tab)) A.active = s.tab; }
  } catch (e) {}
}
A.refresh = () => {
  let r;
  try { r = M.compute(A.P); } catch (e) { console.error(e); return; }
  A.res = r;
  A.renderLive(r);
  const t = A.tabs[A.active]; if (t && t.update) t.update(r);
  save();
};
A.buildAll = () => { ORDER.forEach(id => A.tabs[id].build()); show(A.active); };
function show(id) {
  A.active = id;
  ORDER.forEach(k => { $('#tab-' + k).hidden = k !== id; });
  document.querySelectorAll('#nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.id === id ? 'true' : 'false'));
}

document.addEventListener('input', e => {
  const el = e.target;
  if (el.tagName !== 'INPUT') return;
  const v = parseFloat(el.value);
  if (isNaN(v)) return;
  const d = el.dataset;
  if (d.p) A.set(A.P, d.p, v / (parseFloat(d.s) || 1));
  else if (d.tri) { const [i, k] = d.tri.split(',').map(Number); A.P.nl.tri[i][k] = v; }
  else if (d.corr) { const [key, i, j] = d.corr.split(','); const m = A.P.corr[key]; m[+i][+j] = m[+j][+i] = Math.max(-1, Math.min(1, v)); const mirror = document.querySelector(`[data-corr="${key},${j},${i}"]`); if (mirror && mirror !== el) mirror.value = v; }
  else if (d.scen) A.SC[d.scen] = v;
  else return;
  A.refresh();
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.tagName === 'SELECT' && el.dataset.p) { A.set(A.P, el.dataset.p, el.value); A.refresh(); }
});

function init() {
  load();
  $('#nav').innerHTML = ORDER.map(id => `<button role="tab" data-id="${id}" aria-selected="false">${A.tabs[id].label}</button>`).join('');
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    show(b.dataset.id); A.refresh();
    window.scrollTo(0, 0);
  });
  A.buildAll();
  A.refresh();
}
init();
})();
