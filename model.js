/* Moteur actuariel simplifié, Solvabilité II (formule standard). Montants en M€. */
(function (root) {
'use strict';

const SH_UP = [[1,.70],[2,.70],[3,.64],[4,.59],[5,.55],[6,.52],[7,.49],[8,.47],[9,.44],[10,.42],[11,.39],[12,.37],[13,.35],[14,.34],[15,.33],[16,.31],[17,.30],[18,.29],[19,.27],[20,.26],[90,.20]];
const SH_DN = [[1,-.75],[2,-.65],[3,-.56],[4,-.50],[5,-.46],[6,-.42],[7,-.39],[8,-.36],[9,-.33],[10,-.31],[11,-.30],[12,-.29],[13,-.28],[14,-.28],[15,-.27],[16,-.28],[17,-.28],[18,-.28],[19,-.29],[20,-.29],[90,-.20]];
const PD_BY_RATING = { 'AAA': 0.00002, 'AA': 0.0001, 'A': 0.0005, 'BBB': 0.0024, 'BB': 0.012, 'B': 0.042 };
const SPREAD_F = { aa: 0.009, a: 0.011, bbb: 0.014, bb: 0.025, b: 0.045 };

function interp(tab, t) {
  if (t <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (t <= tab[i][0]) {
      const [t0, v0] = tab[i - 1], [t1, v1] = tab[i];
      return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
    }
  }
  return tab[tab.length - 1][1];
}

function defaultTriangle() {
  const pat = [.40, .67, .82, .90, .945, .972, .988, 1.0];
  const tri = [];
  for (let i = 0; i < 8; i++) {
    const ult = 215 * Math.pow(1.04, i) * (1 + 0.012 * Math.sin(i * 2.3));
    const row = [];
    for (let k = 0; k <= 7 - i; k++) row.push(Math.round(ult * pat[k] * (1 + 0.004 * Math.sin(i * 7 + k * 3)) * 10) / 10);
    tri.push(row);
  }
  return tri;
}

const DEFAULTS = {
  rateShort: 0.024, rateUlt: 0.033, theta: 8, coc: 0.06,
  alloc: { gov: 40, corp: 34, eq1: 6, eq2: 2, prop: 6, cash: 12 },
  mGov: 6, mCorp: 4, spreadCorp: 0.011,
  rating: { aa: 20, a: 40, bbb: 35, bb: 5, b: 0 },
  yEq: 0.065, yProp: 0.045, eqSA: 0,
  otherAssets: 18, dta: 8, otherLiab: 22,
  cap: { excess: 205, t1r: 20, t2: 50, dividend: 10, dtlCap: 45, taxRate: 0.25, amcr: 8, debtRate: 0.045, payout: 0.4 },
  nl: {
    prem: 380, g: 0.03, lr: 0.66, er: 0.28, upr: 0.45, riShare: 0.08, tail: 1.01, tailYears: 3, catPct: 0.14,
    lob: [
      { n: 'Auto RC', pPrem: 0.30, pRes: 0.38, sp: 0.10, sr: 0.09 },
      { n: 'Auto dommages', pPrem: 0.22, pRes: 0.12, sp: 0.08, sr: 0.08 },
      { n: 'Dommages aux biens', pPrem: 0.28, pRes: 0.18, sp: 0.08, sr: 0.10 },
      { n: 'RC générale', pPrem: 0.20, pRes: 0.32, sp: 0.14, sr: 0.11 }
    ],
    tri: defaultTriangle()
  },
  vie: { pm: 1200, lapse: 0.04, qDeath: 0.004, fee: 0.009, expense: 0.0035, tmg: 0.01, infl: 0.018, car: 5000, qCar: 0.0012, carTerm: 8, rentes: 90, kLong: 0.22, fdb: 60, prem: 140, g: 0.02 },
  cpty: { ri1: 'AA', ri2: 'A', split1: 0.6, bank: 'A', receivables: 6 },
  corr: {
    mktUp: [[1,0,0,0],[0,1,.75,.75],[0,.75,1,.5],[0,.75,.5,1]],
    mktDn: [[1,.5,.5,.5],[.5,1,.75,.75],[.5,.75,1,.5],[.5,.75,.5,1]],
    life: [[1,-.25,0,.25,.25],[-.25,1,.25,.25,0],[0,.25,1,.5,.25],[.25,.25,.5,1,.25],[.25,0,.25,.25,1]],
    top: [[1,.25,.25,.25],[.25,1,.25,.5],[.25,.25,1,0],[.25,.5,0,1]],
    lob: [[1,.5,.25,.5],[.5,1,.25,.25],[.25,.25,1,.25],[.5,.25,.25,1]],
    nl: [[1,.25],[.25,1]]
  }
};

const clone = o => JSON.parse(JSON.stringify(o));

function mkCurve(P, o) {
  o = o || {};
  return t => {
    const tt = Math.max(t, 0);
    let r = P.rateUlt - (P.rateUlt - P.rateShort) * Math.exp(-tt / P.theta) + (o.shift || 0) / 1e4;
    if (o.type === 'up') r += Math.max(r * interp(SH_UP, Math.max(tt, 1)), 0.01);
    else if (o.type === 'dn') r *= 1 + interp(SH_DN, Math.max(tt, 1));
    return r;
  };
}
const DF = (rf, t) => Math.pow(1 + rf(t), -t);

function agg(v, c) {
  let s = 0;
  for (let i = 0; i < v.length; i++) for (let j = 0; j < v.length; j++) s += c[i][j] * v[i] * v[j];
  return Math.sqrt(Math.max(s, 0));
}

function chainLadder(tri, tail, tailYears) {
  const n = tri.length, f = [];
  for (let k = 0; k < n - 1; k++) {
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) if (tri[i].length > k + 1) { num += tri[i][k + 1]; den += tri[i][k]; }
    f.push(den > 0 ? num / den : 1);
  }
  const cf = new Array(n + tailYears + 2).fill(0);
  const ult = [], latest = [], reserve = [], proj = [];
  for (let i = 0; i < n; i++) {
    const last = tri[i].length - 1;
    let c = tri[i][last];
    latest.push(c);
    const prow = tri[i].slice();
    for (let k = last; k < n - 1; k++) {
      const nc = c * f[k];
      cf[k + 1 - last] += nc - c;
      c = nc;
      prow.push(c);
    }
    const u = c * tail;
    const tailAmt = u - c;
    const startH = n - 1 - last;
    for (let j = 1; j <= tailYears; j++) cf[startH + j] += tailAmt / tailYears;
    ult.push(u); reserve.push(u - latest[i]); proj.push(prow);
  }
  const total = reserve.reduce((a, b) => a + b, 0);
  return { f, cf, ult, latest, reserve, total, proj };
}

function pvCF(cf, rf) {
  let s = 0;
  for (let h = 1; h < cf.length; h++) s += cf[h] * DF(rf, h - 0.5);
  return s;
}

function vieBE(P, rf, m) {
  m = m || {};
  const V = P.vie, T = 40;
  const lapse = V.lapse * (m.lapseMult || 1), qd = V.qDeath * (m.qMult || 1);
  const e = V.expense * (m.expMult || 1), infl = V.infl + (m.inflAdd || 0);
  let R = V.pm * (m.scale || 1), be = 0;
  const prof = [R];
  for (let t = 0; t < T; t++) {
    const d0 = DF(rf, t), d1 = DF(rf, t + 1);
    const fwd = d0 / d1 - 1;
    const c = Math.max(V.tmg, fwd - V.fee);
    const gr = R * (1 + c), out = gr * Math.min(1, lapse + qd);
    be += (out + e * R * Math.pow(1 + infl, t)) * d1;
    R = gr - out;
    prof.push(R);
  }
  be += R * DF(rf, T);
  return { be, prof };
}

function weights(P) {
  const a = P.alloc, s = a.gov + a.corp + a.eq1 + a.eq2 + a.prop + a.cash || 1;
  const w = {};
  Object.keys(a).forEach(k => w[k] = a[k] / s);
  return w;
}

function bondDelta(mv, M, sp, r0, r1) {
  return mv * (Math.pow((1 + r0(M) + sp) / (1 + r1(M) + sp), M) - 1);
}

function core(P, S, B, rmGuess) {
  S = S || {};
  const rf0 = mkCurve(P, {});
  const rf = mkCurve(P, { shift: S.shiftBp || 0 });
  const N = P.nl, V = P.vie, C = P.cap;

  /* Provisions non-vie */
  const cl = chainLadder(N.tri, N.tail, N.tailYears);
  const pvBase = pvCF(cl.cf, rf);
  const strain = S.reserveStrain || 0;
  const beClaims = pvBase * (1 + strain) + (S.catNet || 0);
  const cr = N.lr + (S.lrAdd || 0) + N.er;
  const pp = N.upr * N.prem * (cr - 1);
  const riRec = N.riShare * pvBase;

  /* Provisions vie */
  const v = vieBE(P, rf, { lapseMult: S.lapseMult });
  const beVie = v.be;

  /* Actifs */
  const w = weights(P);
  let assets;
  const liabNoRM = beClaims + pp + beVie + P.otherLiab + C.t1r + C.t2;
  if (B) {
    const gov = B.assets.gov + bondDelta(B.assets.gov, P.mGov, 0, rf0, rf);
    const corpR = B.assets.corp + bondDelta(B.assets.corp, P.mCorp, P.spreadCorp, rf0, rf);
    assets = {
      gov, corp: corpR * (1 - (S.spreadBp || 0) / 1e4 * P.mCorp),
      eq1: B.assets.eq1 * (1 + (S.eq || 0)), eq2: B.assets.eq2 * (1 + (S.eq || 0)),
      prop: B.assets.prop * (1 + (S.prop || 0)), cash: B.assets.cash
    };
  } else {
    const inv = liabNoRM + rmGuess + C.excess - riRec - P.otherAssets;
    assets = {};
    Object.keys(w).forEach(k => assets[k] = inv * w[k]);
  }

  /* SCR marché */
  const durG = P.mGov, durC = P.mCorp;
  function irLoss(type) {
    const rs = mkCurve(P, { type, shift: S.shiftBp || 0 });
    const dA = bondDelta(assets.gov, P.mGov, 0, rf, rs) + bondDelta(assets.corp, P.mCorp, P.spreadCorp, rf, rs);
    const pvS = pvCF(cl.cf, rs);
    const dRR = N.riShare * (pvS - pvBase);
    const dL = (pvS - pvBase) * (1 + strain) + (vieBE(P, rs, { lapseMult: S.lapseMult }).be - beVie);
    return -(dA + dRR - dL);
  }
  const irUp = irLoss('up'), irDn = irLoss('dn');
  const sa = P.eqSA;
  const eq1 = (0.39 + sa) * assets.eq1, eq2 = (0.49 + sa) * assets.eq2;
  const eqSCR = Math.sqrt(eq1 * eq1 + eq2 * eq2 + 2 * 0.75 * eq1 * eq2);
  const propSCR = 0.25 * assets.prop;
  const rt = P.rating;
  const rs_ = rt.aa + rt.a + rt.bbb + rt.bb + rt.b || 1;
  const sprF = (rt.aa * SPREAD_F.aa + rt.a * SPREAD_F.a + rt.bbb * SPREAD_F.bbb + rt.bb * SPREAD_F.bb + rt.b * SPREAD_F.b) / rs_;
  const sprSCR = Math.min(1, sprF * durC) * assets.corp;
  const mUp = agg([Math.max(0, irUp), eqSCR, propSCR, sprSCR], P.corr.mktUp);
  const mDn = agg([Math.max(0, irDn), eqSCR, propSCR, sprSCR], P.corr.mktDn);
  const mkt = Math.max(mUp, mDn);
  const irSCR = Math.max(0, irUp, irDn);

  /* SCR souscription non-vie */
  const lobRows = N.lob.map(l => {
    const Vp = N.prem * (1 + N.g) * l.pPrem, Vr = beClaims * l.pRes;
    const sig = Math.sqrt(l.sp * l.sp * Vp * Vp + l.sr * l.sr * Vr * Vr + 2 * 0.5 * l.sp * l.sr * Vp * Vr) / Math.max(Vp + Vr, 1e-9);
    return { n: l.n, Vp, Vr, sig, scr: 3 * sig * (Vp + Vr) };
  });
  const prSCR = agg(lobRows.map(r => r.scr), P.corr.lob);
  const catBase = N.prem * (N.lob[1].pPrem + N.lob[2].pPrem);
  const catSCR = N.catPct * catBase;
  const nl = agg([prSCR, catSCR], P.corr.nl);

  /* SCR souscription vie */
  let ann = 0;
  for (let t = 1; t <= V.carTerm; t++) ann += DF(rf, t);
  const mort = 0.15 * V.qCar * V.car * ann;
  const long = 0.20 * V.kLong * V.rentes;
  const lapDn = vieBE(P, rf, { lapseMult: 0.5 * (S.lapseMult || 1) }).be - beVie;
  const lapUp = vieBE(P, rf, { lapseMult: 1.5 * (S.lapseMult || 1) }).be - beVie;
  const lapMass = 0.4 * (V.pm - beVie);
  const lap = Math.max(0, lapDn, lapUp, lapMass);
  const exp = Math.max(0, vieBE(P, rf, { expMult: 1.1, inflAdd: 0.01, lapseMult: S.lapseMult }).be - beVie);
  const catV = 0.0015 * V.car;
  const lifeParts = [mort, long, lap, exp, catV];
  const life = agg(lifeParts, P.corr.life);

  /* Défaut de contrepartie */
  const pdOf = r => PD_BY_RATING[r] || 0.0005;
  function sigma(E, pd) {
    const lgd = 0.5 * E;
    return lgd * Math.sqrt(1.5 * pd * (1 - pd) / (1 - 2.5 * pd));
  }
  const cp = P.cpty;
  const exposures = [
    { n: 'Réassureur 1 (' + cp.ri1 + ')', E: riRec * cp.split1, pd: pdOf(cp.ri1) },
    { n: 'Réassureur 2 (' + cp.ri2 + ')', E: riRec * (1 - cp.split1), pd: pdOf(cp.ri2) },
    { n: 'Banque (' + cp.bank + ')', E: assets.cash, pd: pdOf(cp.bank) }
  ];
  const t1 = Math.min(3 * Math.sqrt(exposures.reduce((s, x) => s + Math.pow(sigma(x.E, x.pd), 2), 0)), 0.5 * exposures.reduce((s, x) => s + x.E, 0));
  const t2 = 0.15 * cp.receivables;
  const def = Math.sqrt(t1 * t1 + t2 * t2 + 2 * 0.75 * t1 * t2);

  /* Agrégation */
  const bscr = agg([mkt, def, life, nl], P.corr.top);
  const earnedLife = V.prem, earnedNL = N.prem;
  const opPrem = 0.04 * earnedLife + 0.03 * earnedNL;
  const opProv = 0.0045 * beVie + 0.03 * Math.max(beClaims + pp, 0);
  const op = Math.min(0.3 * bscr, Math.max(opPrem, opProv));
  const lacFDB = Math.min(V.fdb, mkt);
  const lacDT = Math.min(C.taxRate * Math.max(0, bscr + op - lacFDB), C.dtlCap);
  const scr = bscr + op - lacFDB - lacDT;

  /* Marge de risque */
  const bscrRU = agg([def, life, nl], [[1,.25,.5],[.25,1,0],[.5,0,1]]);
  const opRU = Math.min(0.3 * bscrRU, Math.max(opPrem, opProv));
  const scrRU = bscrRU + opRU;
  const remNL0 = cl.cf.reduce((a, b) => a + b, 0);
  let sNL = 0, sV = 0;
  const rmProfile = [];
  for (let t = 0; t < v.prof.length - 1; t++) {
    let remNL = 0;
    for (let h = t + 1; h < cl.cf.length; h++) remNL += cl.cf[h];
    const rN = remNL0 > 0 ? remNL / remNL0 : 0, rV = v.prof[t] / v.prof[0];
    rmProfile.push({ nl: rN, vie: rV });
    sNL += rN * DF(rf, t + 1);
    sV += rV * DF(rf, t + 1);
  }
  const shNL = nl + life > 0 ? nl / (nl + life) : 0.5;
  const rmCalc = P.coc * scrRU * (shNL * sNL + (1 - shNL) * sV);
  const rm = B ? rmCalc : rmGuess;

  /* Bilan */
  const liabTotal = liabNoRM + rm;
  const assetInv = Object.values(assets).reduce((a, b) => a + b, 0);
  const assetTotal = assetInv + riRec + P.otherAssets;
  const excess = assetTotal - liabTotal;

  /* Fonds propres et éligibilité */
  const divd = S.dividend != null ? S.dividend : C.dividend;
  const ofTotal = excess + C.t1r + C.t2 - divd;
  const t3 = P.dta;
  const t1u = Math.max(0, ofTotal - C.t1r - C.t2 - t3);
  const t1rEl = Math.min(C.t1r, 0.25 * t1u);
  const t3El = Math.min(t3, 0.15 * Math.max(scr, 0));
  const t2El = Math.max(0, Math.min(C.t2, 0.5 * scr - t3El));
  const elig = Math.max(0, t1u + t1rEl + t2El + t3El);
  const mcrLin = 0.08 * Math.max(0, beClaims) + 0.07 * N.prem + 0.037 * beVie + 0.0007 * V.car;
  const mcr = Math.max(Math.min(Math.max(mcrLin, 0.25 * scr), 0.45 * scr), C.amcr);
  const t2Mcr = Math.min(C.t2, 0.2 * mcr, t2El);
  const eligMcr = Math.max(0, t1u + t1rEl + t2Mcr);

  const pYield = w.gov * rf0(P.mGov) + w.corp * (rf0(P.mCorp) + P.spreadCorp) + (w.eq1 + w.eq2) * P.yEq + w.prop * P.yProp + w.cash * rf0(1);

  return {
    rf0, cl, w, pYield,
    prov: { beClaims, pp, riRec, beVie, rm, rmCalc, scrRU, nlTotal: beClaims + pp, total: beClaims + pp + beVie + rm, vieProfile: v.prof, rmProfile, rmShare: shNL },
    assets: Object.assign({}, assets, { ri: riRec, other: P.otherAssets }), assetTotal,
    liab: { nl: beClaims + pp, vie: beVie, rm, other: P.otherLiab, sub: C.t1r + C.t2, total: liabTotal },
    excess,
    scr: {
      mkt, def, life, nl, bscr, op, lacFDB, lacDT, total: scr,
      mktParts: { Taux: irSCR, Actions: eqSCR, Immobilier: propSCR, Spread: sprSCR },
      irUp, irDn,
      nlParts: { 'Primes et réserves': prSCR, 'Catastrophe': catSCR },
      lob: lobRows,
      lifeParts: { Mortalité: mort, Longévité: long, Rachats: lap, Frais: exp, Catastrophe: catV },
      lapseDetail: { lapDn, lapUp, lapMass },
      defParts: { exposures, t1, t2 }
    },
    of: { total: ofTotal, t1u, t1r: C.t1r, t1rEl, t2: C.t2, t2El, t3, t3El, elig, divd, eligMcr },
    mcr: { lin: mcrLin, total: mcr },
    ratio: scr > 0 ? elig / scr : Infinity,
    ratioMcr: mcr > 0 ? eligMcr / mcr : Infinity
  };
}

function compute(P, S) {
  const hasS = S && Object.keys(S).length > 0;
  if (hasS) return core(P, S, compute(P, null), 0);
  let rm = 0, r;
  for (let i = 0; i < 4; i++) { r = core(P, null, null, rm); rm = r.prov.rmCalc; }
  return r;
}

function project(P, years) {
  years = years || 5;
  const C = P.cap, rows = [];
  let Pt = clone(P), res = compute(Pt), excess = Pt.cap.excess, prevDiv = Pt.cap.dividend;
  rows.push({ y: 0, scr: res.scr.total, elig: res.of.elig, ratio: res.ratio, net: null, div: prevDiv, excess });
  for (let y = 1; y <= years; y++) {
    const gN = Pt.nl.g, gV = Pt.vie.g;
    Pt.nl.prem *= 1 + gN;
    Pt.nl.tri = Pt.nl.tri.map(r => r.map(x => x * (1 + gN)));
    Pt.vie.pm *= 1 + gV; Pt.vie.car *= 1 + gV; Pt.vie.rentes *= 1 + gV; Pt.vie.prem *= 1 + gV;
    const uw = Pt.nl.prem * (1 - Pt.nl.lr - Pt.nl.er);
    const fin = (excess + res.prov.nlTotal) * res.pYield - res.prov.nlTotal * res.rf0(3);
    const vm = res.prov.vieProfile[0] * (Pt.vie.fee - Pt.vie.expense);
    const pre = uw + fin + vm - (C.t1r + C.t2) * C.debtRate;
    const net = pre - C.taxRate * Math.max(0, pre);
    const div = C.payout * Math.max(0, net);
    excess = excess + net - prevDiv;
    prevDiv = div;
    Pt.cap.excess = excess; Pt.cap.dividend = div;
    res = compute(Pt);
    rows.push({ y, scr: res.scr.total, elig: res.of.elig, ratio: res.ratio, net, div, excess, uw, fin, vm });
  }
  return rows;
}

const SCENARIOS = [
  { id: 'rUp', n: 'Taux +100 pb', s: { shiftBp: 100 } },
  { id: 'rDn', n: 'Taux −100 pb', s: { shiftBp: -100 } },
  { id: 'eq', n: 'Actions −30 %', s: { eq: -0.30 } },
  { id: 'prop', n: 'Immobilier −20 %', s: { prop: -0.20 } },
  { id: 'spr', n: 'Spreads +100 pb', s: { spreadBp: 100 } },
  { id: 'res', n: 'Sous-provisionnement +10 %', s: { reserveStrain: 0.10 } },
  { id: 'lr', n: 'Sinistralité +5 pts', s: { lrAdd: 0.05 } },
  { id: 'cat', n: 'Tempête 60 M€ nets', s: { catNet: 60 } },
  { id: 'lap', n: 'Rachats ×2', s: { lapseMult: 2 } },
  { id: 'comb', n: 'Combiné sévère', s: { shiftBp: -50, eq: -0.25, prop: -0.15, spreadBp: 80, reserveStrain: 0.05, catNet: 40, lapseMult: 1.5 } }
];

const Model = { DEFAULTS, SCENARIOS, compute, project, clone, mkCurve, chainLadder, defaultTriangle, SH_UP, SH_DN, PD_BY_RATING };
if (typeof module !== 'undefined' && module.exports) module.exports = Model;
else root.Model = Model;
})(typeof window !== 'undefined' ? window : globalThis);
