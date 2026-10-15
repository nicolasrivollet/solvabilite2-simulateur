/* ============================================================================
   MOTEUR ACTUARIEL SIMPLIFIÉ, SOLVABILITÉ II (FORMULE STANDARD)
   Montants en M€. Ce fichier ne touche pas à l'interface : on peut l'utiliser seul.

   Point d'entrée : Model.compute(P) pour le bilan et le ratio de base,
                    Model.compute(P, S) pour le même calcul après un choc S,
                    Model.project(P, 5) pour la projection sur 5 ans.
     P = objet d'hypothèses (voir DEFAULTS plus bas)
     S = choc, ex. { shiftBp: 100, eq: -0.30 } (voir SCENARIOS en fin de fichier)

   Ordre des calculs dans core() :
     1. Provisions non-vie (Chain Ladder)      5. SCR souscription vie
     2. Provisions vie (projection sur 40 ans)  6. SCR défaut de contrepartie
     3. Actifs                                  7. Agrégation du SCR, marge de risque
     4. SCR marché et SCR souscription non-vie  8. Bilan, fonds propres éligibles, MCR
   ============================================================================ */
(function (root) {
'use strict';

/* ----------------------------------------------------------------------------
   PARAMÈTRES RÉGLEMENTAIRES (indicatifs)
   ---------------------------------------------------------------------------- */

/* Chocs relatifs de la courbe des taux selon la maturité (en années).
   Chaque couple est [maturité, choc]. Le choc s'applique au taux : +70 % à 1 an
   pour la hausse (SH_UP), -75 % pour la baisse (SH_DN). Valeurs de type EIOPA. */
const SH_UP = [[1,.70],[2,.70],[3,.64],[4,.59],[5,.55],[6,.52],[7,.49],[8,.47],[9,.44],[10,.42],[11,.39],[12,.37],[13,.35],[14,.34],[15,.33],[16,.31],[17,.30],[18,.29],[19,.27],[20,.26],[90,.20]];
const SH_DN = [[1,-.75],[2,-.65],[3,-.56],[4,-.50],[5,-.46],[6,-.42],[7,-.39],[8,-.36],[9,-.33],[10,-.31],[11,-.30],[12,-.29],[13,-.28],[14,-.28],[15,-.27],[16,-.28],[17,-.28],[18,-.28],[19,-.29],[20,-.29],[90,-.20]];

/* Probabilité de défaut annuelle par notation de crédit (risque de contrepartie). */
const PD_BY_RATING = { 'AAA': 0.00002, 'AA': 0.0001, 'A': 0.0005, 'BBB': 0.0024, 'BB': 0.012, 'B': 0.042 };

/* Facteur de choc de spread par tranche de notation, à multiplier par la duration. */
const SPREAD_F = { aa: 0.009, a: 0.011, bbb: 0.014, bb: 0.025, b: 0.045 };

/* ----------------------------------------------------------------------------
   OUTILS GÉNÉRAUX
   ---------------------------------------------------------------------------- */

/* Interpolation linéaire dans une table [[x, y], ...]. Hors bornes : valeur du bord. */
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

/* Triangle de paiements cumulés de démonstration : 8 années de survenance (lignes),
   8 années de développement (colonnes). La ligne i a (8 - i) cellules observées,
   car les années récentes sont moins développées.
   Construction : coût ultime de l'année i = 215 M€ × 1,04^i (inflation de 4 % par an),
   avec une petite oscillation ; chaque cellule = ultime × part déjà réglée à l'âge k
   (pat : 40 % au bout d'un an, jusqu'à 100 % au bout de huit ans).
   ATTENTION : ce triangle est fabriqué à part. Il ne dépend ni des primes
   (nl.prem) ni du ratio sinistres / primes (nl.lr) saisis. */
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

/* ----------------------------------------------------------------------------
   HYPOTHÈSES PAR DÉFAUT (objet P)
   Tout ce que l'utilisateur peut modifier dans l'onglet « Hypothèses ».
   ---------------------------------------------------------------------------- */
const DEFAULTS = {
  /* Courbe des taux : taux court, taux ultime (UFR), vitesse de convergence θ (ans),
     coût du capital de la marge de risque. */
  rateShort: 0.024, rateUlt: 0.033, theta: 8, coc: 0.06,

  /* Allocation d'actifs en % : obligations d'État, obligations privées, actions type 1,
     actions type 2, immobilier, trésorerie. Normalisée à 100 dans weights(). */
  alloc: { gov: 40, corp: 34, eq1: 6, eq2: 2, prop: 6, cash: 12 },

  /* Maturités moyennes (ans) des obligations d'État et privées, spread moyen des privées. */
  mGov: 6, mCorp: 4, spreadCorp: 0.011,

  /* Notation des obligations privées, en % (aa = AAA/AA, b = B et moins). */
  rating: { aa: 20, a: 40, bbb: 35, bb: 5, b: 0 },

  /* Rendement attendu des actions et de l'immobilier ; ajustement symétrique actions. */
  yEq: 0.065, yProp: 0.045, eqSA: 0,

  /* Autres actifs, impôts différés actifs nets (fonds propres de niveau 3), autres passifs. */
  otherAssets: 18, dta: 8, otherLiab: 22,

  /* Fonds propres :
     excess   = excédent d'actifs sur passifs (SAISIE qui détermine la taille des actifs)
     t1r, t2  = dettes subordonnées (niveau 1 restreint, niveau 2)
     dividend = dividende prévisible déduit des fonds propres
     dtlCap   = plafond d'absorption par les impôts différés
     amcr     = plancher absolu du MCR
     debtRate = coût de la dette subordonnée ; payout = taux de distribution (projection) */
  cap: { excess: 205, t1r: 20, t2: 50, dividend: 10, dtlCap: 45, taxRate: 0.25, amcr: 8, debtRate: 0.045, payout: 0.4 },

  /* Non-vie :
     prem = primes ; g = croissance ; lr = ratio sinistres/primes ; er = ratio de frais
     upr = provision pour primes non acquises (part des primes) ; riShare = part cédée
     tail, tailYears = facteur et durée de la queue du Chain Ladder
     catPct = charge catastrophe naturelle (part des primes dommages)
     lob = branches : pPrem / pRes = poids dans les primes / réserves,
           sp / sr = écart-type des primes / des réserves
     tri = triangle de paiements cumulés */
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

  /* Vie :
     pm = provisions mathématiques ; lapse = rachats ; qDeath = décès (épargne)
     fee = marge de gestion prélevée sur le rendement ; expense = frais de gestion
     tmg = taux minimum garanti ; infl = inflation des frais
     car = capitaux sous risque ; qCar = mortalité sur ces capitaux ; carTerm = durée (ans)
     rentes = provisions de rentes ; kLong = sensibilité longévité
     fdb = participation aux bénéfices future (absorbe une partie du choc de marché)
     prem = primes ; g = croissance des provisions */
  vie: { pm: 1200, lapse: 0.04, qDeath: 0.004, fee: 0.009, expense: 0.0035, tmg: 0.01, infl: 0.018, car: 5000, qCar: 0.0012, carTerm: 8, rentes: 90, kLong: 0.22, fdb: 60, prem: 140, g: 0.02 },

  /* Contreparties : notation des deux réassureurs et part du premier, notation de la
     banque, créances sur assurés de plus de 3 mois. */
  cpty: { ri1: 'AA', ri2: 'A', split1: 0.6, bank: 'A', receivables: 6 },

  /* Matrices de corrélation (symétriques, éditables dans l'onglet SCR).
     mktUp / mktDn : marché, ordre [taux, actions, immobilier, spread], selon le sens du choc de taux
     life : vie, ordre [mortalité, longévité, rachats, frais, catastrophe]
     top : agrégation finale, ordre [marché, contrepartie, vie, non-vie]
     lob : branches non-vie, même ordre que nl.lob
     nl : non-vie, ordre [primes et réserves, catastrophe] */
  corr: {
    mktUp: [[1,0,0,0],[0,1,.75,.75],[0,.75,1,.5],[0,.75,.5,1]],
    mktDn: [[1,.5,.5,.5],[.5,1,.75,.75],[.5,.75,1,.5],[.5,.75,.5,1]],
    life: [[1,-.25,0,.25,.25],[-.25,1,.25,.25,0],[0,.25,1,.5,.25],[.25,.25,.5,1,.25],[.25,0,.25,.25,1]],
    top: [[1,.25,.25,.25],[.25,1,.25,.5],[.25,.25,1,0],[.25,.5,0,1]],
    lob: [[1,.5,.25,.5],[.5,1,.25,.25],[.25,.25,1,.25],[.5,.25,.25,1]],
    nl: [[1,.25],[.25,1]]
  }
};

/* Copie profonde d'un objet (pour ne pas modifier les hypothèses d'origine). */
const clone = o => JSON.parse(JSON.stringify(o));

/* ----------------------------------------------------------------------------
   COURBE DES TAUX SANS RISQUE
   Renvoie une fonction t -> taux spot à la maturité t (en années).
   Formule de base : r(t) = UFR - (UFR - taux court) × e^(-t/θ).
   Le taux part du taux court à t = 0 et converge vers l'UFR.
   Options o :
     shift : décalage parallèle en points de base
     type  : 'up' ou 'dn' applique le choc réglementaire de taux (tables SH_UP / SH_DN)
   ---------------------------------------------------------------------------- */
function mkCurve(P, o) {
  o = o || {};
  return t => {
    const tt = Math.max(t, 0);
    let r = P.rateUlt - (P.rateUlt - P.rateShort) * Math.exp(-tt / P.theta) + (o.shift || 0) / 1e4;
    if (o.type === 'up') r += Math.max(r * interp(SH_UP, Math.max(tt, 1)), 0.01); /* hausse d'au moins 1 point */
    else if (o.type === 'dn') r *= 1 + interp(SH_DN, Math.max(tt, 1));
    return r;
  };
}

/* Facteur d'actualisation à la maturité t : (1 + r(t))^(-t). */
const DF = (rf, t) => Math.pow(1 + rf(t), -t);

/* Agrégation par matrice de corrélation : racine de la somme des corr(i,j) × v(i) × v(j).
   C'est la formule racine carrée de la formule standard (diversification entre risques). */
function agg(v, c) {
  let s = 0;
  for (let i = 0; i < v.length; i++) for (let j = 0; j < v.length; j++) s += c[i][j] * v[i] * v[j];
  return Math.sqrt(Math.max(s, 0));
}

/* ----------------------------------------------------------------------------
   CHAIN LADDER (provisions de sinistres non-vie)
   Entrée : triangle de paiements cumulés (tri), facteur de queue, durée de la queue.
   Étapes :
     1. Facteurs de développement f[k] : somme des paiements à l'âge k+1 divisée par
        la somme des paiements à l'âge k, sur les années où les deux sont observés.
     2. Chaque année est projetée jusqu'à la fin du triangle en multipliant par f[k].
     3. Les paiements incrémentaux futurs sont placés dans cf[h] (h = années à venir).
     4. La queue (ultime × facteur de queue - dernier cumul projeté) est étalée
        uniformément sur tailYears années.
   Sorties : f (facteurs), cf (flux futurs par année), ult (coût ultime par année),
             latest (dernier cumul observé), reserve (ultime - observé), total, proj (triangle complété).
   ---------------------------------------------------------------------------- */
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
    const last = tri[i].length - 1;          /* indice de la dernière cellule observée */
    let c = tri[i][last];
    latest.push(c);
    const prow = tri[i].slice();
    for (let k = last; k < n - 1; k++) {
      const nc = c * f[k];                   /* cumul projeté à l'âge suivant */
      cf[k + 1 - last] += nc - c;            /* paiement de l'année à venir (nc - c) */
      c = nc;
      prow.push(c);
    }
    const u = c * tail;                      /* coût ultime = dernier cumul × queue */
    const tailAmt = u - c;
    const startH = n - 1 - last;             /* nombre d'années avant la fin du triangle */
    for (let j = 1; j <= tailYears; j++) cf[startH + j] += tailAmt / tailYears;
    ult.push(u); reserve.push(u - latest[i]); proj.push(prow);
  }
  const total = reserve.reduce((a, b) => a + b, 0);
  return { f, cf, ult, latest, reserve, total, proj };
}

/* Valeur actuelle de flux futurs cf[h], versés en milieu d'année h (actualisation à h - 0,5). */
function pvCF(cf, rf) {
  let s = 0;
  for (let h = 1; h < cf.length; h++) s += cf[h] * DF(rf, h - 0.5);
  return s;
}

/* ----------------------------------------------------------------------------
   MEILLEURE ESTIMATION VIE (épargne en euros)
   Projection annuelle des provisions mathématiques R sur 40 ans, puis actualisation.
   Chaque année t :
     - taux servi c = max(TMG ; taux forward de l'année - marge de gestion)
     - provisions revalorisées : gr = R × (1 + c)
     - sorties de l'année (rachats + décès) : out = gr × min(1 ; rachat + décès)
     - frais : expense × R, indexés de l'inflation
     - meilleure estimation += (sorties + frais) × facteur d'actualisation de fin d'année
   En fin de projection, le solde R restant est versé à l'horizon de 40 ans.
   Multiplicateurs optionnels m, utilisés pour les chocs du SCR vie :
     lapseMult (rachats), qMult (décès), expMult (frais), inflAdd (inflation), scale (volume).
   Renvoie be (meilleure estimation) et prof (solde R à chaque date, utilisé pour la marge de risque).
   ---------------------------------------------------------------------------- */
function vieBE(P, rf, m) {
  m = m || {};
  const V = P.vie, T = 40;
  const lapse = V.lapse * (m.lapseMult || 1), qd = V.qDeath * (m.qMult || 1);
  const e = V.expense * (m.expMult || 1), infl = V.infl + (m.inflAdd || 0);
  let R = V.pm * (m.scale || 1), be = 0;
  const prof = [R];
  for (let t = 0; t < T; t++) {
    const d0 = DF(rf, t), d1 = DF(rf, t + 1);
    const fwd = d0 / d1 - 1;                          /* taux forward de l'année t */
    const c = Math.max(V.tmg, fwd - V.fee);
    const gr = R * (1 + c), out = gr * Math.min(1, lapse + qd);
    be += (out + e * R * Math.pow(1 + infl, t)) * d1;
    R = gr - out;
    prof.push(R);
  }
  be += R * DF(rf, T);
  return { be, prof };
}

/* Poids de l'allocation d'actifs, ramenés à 100 % (même si la somme saisie n'est pas 100). */
function weights(P) {
  const a = P.alloc, s = a.gov + a.corp + a.eq1 + a.eq2 + a.prop + a.cash || 1;
  const w = {};
  Object.keys(a).forEach(k => w[k] = a[k] / s);
  return w;
}

/* Variation de valeur d'un portefeuille obligataire de valeur mv, maturité M,
   spread sp, quand la courbe passe de r0 à r1 (approximation « zéro-coupon »). */
function bondDelta(mv, M, sp, r0, r1) {
  return mv * (Math.pow((1 + r0(M) + sp) / (1 + r1(M) + sp), M) - 1);
}

/* ============================================================================
   CŒUR DU CALCUL
   P = hypothèses
   S = choc éventuel (vide pour le cas de base)
   B = résultat du cas de base : si fourni, on est en mode « choc » et les actifs sont
       ceux du cas de base revalorisés. Sinon (mode base), les actifs sont déduits du
       bilan (voir plus bas).
   rmGuess = marge de risque supposée (utilisée seulement en mode base)
   ============================================================================ */
function core(P, S, B, rmGuess) {
  S = S || {};
  const rf0 = mkCurve(P, {});                              /* courbe de base */
  const rf = mkCurve(P, { shift: S.shiftBp || 0 });        /* courbe après choc éventuel */
  const N = P.nl, V = P.vie, C = P.cap;

  /* ---- 1. Provisions non-vie ----
     beClaims : meilleure estimation des sinistres = valeur actuelle des flux Chain Ladder,
                augmentée du renforcement éventuel (reserveStrain) et d'une catastrophe (catNet)
     pp       : provision de primes = UPR × primes × (ratio combiné - 100 %).
                Négative si l'activité est rentable (ratio combiné < 100 %).
     riRec    : part des réassureurs dans les provisions de sinistres */
  const cl = chainLadder(N.tri, N.tail, N.tailYears);
  const pvBase = pvCF(cl.cf, rf);
  const strain = S.reserveStrain || 0;
  const beClaims = pvBase * (1 + strain) + (S.catNet || 0);
  const cr = N.lr + (S.lrAdd || 0) + N.er;
  const pp = N.upr * N.prem * (cr - 1);
  const riRec = N.riShare * pvBase;

  /* ---- 2. Provisions vie ---- */
  const v = vieBE(P, rf, { lapseMult: S.lapseMult });
  const beVie = v.be;

  /* ---- 3. Actifs ----
     Cas de base : les actifs ne sont PAS saisis. On les déduit du bilan :
       actifs investis = passifs (hors marge de risque) + marge de risque + excédent saisi
                         - part des réassureurs - autres actifs
     puis on les répartit selon les poids d'allocation.
     Cas de choc : on part des actifs du cas de base (B) et on les revalorise
     (obligations : effet taux et spread ; actions et immobilier : variation en %). */
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

  /* ---- 4a. SCR de marché ---- */
  const durG = P.mGov, durC = P.mCorp;   /* durG n'est pas utilisé */

  /* Risque de taux : perte de fonds propres après un choc réglementaire à la hausse ('up')
     ou à la baisse ('dn'). On revalorise les obligations (dA), la part des réassureurs (dRR)
     et les provisions non-vie et vie (dL). La perte = -(variation d'actif + réassurance - passif). */
  function irLoss(type) {
    const rs = mkCurve(P, { type, shift: S.shiftBp || 0 });
    const dA = bondDelta(assets.gov, P.mGov, 0, rf, rs) + bondDelta(assets.corp, P.mCorp, P.spreadCorp, rf, rs);
    const pvS = pvCF(cl.cf, rs);
    const dRR = N.riShare * (pvS - pvBase);
    const dL = (pvS - pvBase) * (1 + strain) + (vieBE(P, rs, { lapseMult: S.lapseMult }).be - beVie);
    return -(dA + dRR - dL);
  }
  const irUp = irLoss('up'), irDn = irLoss('dn');

  /* Risque actions : 39 % (type 1) et 49 % (type 2) + ajustement symétrique, corrélation 0,75. */
  const sa = P.eqSA;
  const eq1 = (0.39 + sa) * assets.eq1, eq2 = (0.49 + sa) * assets.eq2;
  const eqSCR = Math.sqrt(eq1 * eq1 + eq2 * eq2 + 2 * 0.75 * eq1 * eq2);

  /* Risque immobilier : 25 % de la valeur. */
  const propSCR = 0.25 * assets.prop;

  /* Risque de spread : facteur moyen pondéré par la notation × duration (plafonné à 100 %),
     appliqué aux obligations privées. */
  const rt = P.rating;
  const rs_ = rt.aa + rt.a + rt.bbb + rt.bb + rt.b || 1;
  const sprF = (rt.aa * SPREAD_F.aa + rt.a * SPREAD_F.a + rt.bbb * SPREAD_F.bbb + rt.bb * SPREAD_F.bb + rt.b * SPREAD_F.b) / rs_;
  const sprSCR = Math.min(1, sprF * durC) * assets.corp;

  /* Agrégation du marché, deux fois (taux en hausse, taux en baisse), on garde le pire.
     Un gain de taux (valeur négative) est ramené à 0 dans l'agrégation. */
  const mUp = agg([Math.max(0, irUp), eqSCR, propSCR, sprSCR], P.corr.mktUp);
  const mDn = agg([Math.max(0, irDn), eqSCR, propSCR, sprSCR], P.corr.mktDn);
  const mkt = Math.max(mUp, mDn);
  const irSCR = Math.max(0, irUp, irDn);   /* pour l'affichage uniquement */

  /* ---- 4b. SCR souscription non-vie ----
     Par branche : volume de primes Vp (primes de l'an prochain × poids de la branche),
     volume de réserves Vr, écart-type combiné sig (corrélation primes/réserves 0,5),
     SCR de branche = 3 × sig × (Vp + Vr). Puis agrégation entre branches. */
  const lobRows = N.lob.map(l => {
    const Vp = N.prem * (1 + N.g) * l.pPrem, Vr = beClaims * l.pRes;
    const sig = Math.sqrt(l.sp * l.sp * Vp * Vp + l.sr * l.sr * Vr * Vr + 2 * 0.5 * l.sp * l.sr * Vp * Vr) / Math.max(Vp + Vr, 1e-9);
    return { n: l.n, Vp, Vr, sig, scr: 3 * sig * (Vp + Vr) };
  });
  const prSCR = agg(lobRows.map(r => r.scr), P.corr.lob);
  /* Catastrophe naturelle : catPct × primes des branches 2 et 3 (auto dommages, biens). */
  const catBase = N.prem * (N.lob[1].pPrem + N.lob[2].pPrem);
  const catSCR = N.catPct * catBase;
  const nl = agg([prSCR, catSCR], P.corr.nl);

  /* ---- 5. SCR souscription vie ---- */
  /* Mortalité : 15 % de la mortalité sur les capitaux sous risque, sommée sur la durée. */
  let ann = 0;
  for (let t = 1; t <= V.carTerm; t++) ann += DF(rf, t);
  const mort = 0.15 * V.qCar * V.car * ann;
  /* Longévité : 20 % × sensibilité × provisions de rentes. */
  const long = 0.20 * V.kLong * V.rentes;
  /* Rachats : le pire de trois chocs (rachats ÷ 2, rachats × 1,5, rachat massif de 40 %). */
  const lapDn = vieBE(P, rf, { lapseMult: 0.5 * (S.lapseMult || 1) }).be - beVie;
  const lapUp = vieBE(P, rf, { lapseMult: 1.5 * (S.lapseMult || 1) }).be - beVie;
  const lapMass = 0.4 * (V.pm - beVie);
  const lap = Math.max(0, lapDn, lapUp, lapMass);
  /* Frais : frais +10 % et inflation +1 point. */
  const exp = Math.max(0, vieBE(P, rf, { expMult: 1.1, inflAdd: 0.01, lapseMult: S.lapseMult }).be - beVie);
  /* Catastrophe : 0,15 % des capitaux sous risque. */
  const catV = 0.0015 * V.car;
  const lifeParts = [mort, long, lap, exp, catV];
  const life = agg(lifeParts, P.corr.life);

  /* ---- 6. Défaut de contrepartie ----
     Type 1 : réassureurs et banque. Perte en cas de défaut = 50 % de l'exposition.
     Écart-type par contrepartie selon sa probabilité de défaut, agrégé en racine de la somme
     des carrés, × 3 et plafonné à 50 % de l'exposition totale.
     Type 2 : 15 % des créances sur assurés de plus de 3 mois. */
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

  /* ---- 7a. Agrégation du SCR ----
     BSCR : agrégation des quatre modules (marché, contrepartie, vie, non-vie).
     Risque opérationnel : max(charge sur primes ; charge sur provisions), plafonné à 30 % du BSCR.
     Absorption par la participation aux bénéfices future : min(PB disponibles ; SCR marché).
     Absorption par les impôts différés : taux d'impôt × (BSCR + opérationnel - PB), plafonnée.
     SCR = BSCR + opérationnel - absorption PB - absorption impôts différés. */
  const bscr = agg([mkt, def, life, nl], P.corr.top);
  const earnedLife = V.prem, earnedNL = N.prem;
  const opPrem = 0.04 * earnedLife + 0.03 * earnedNL;
  const opProv = 0.0045 * beVie + 0.03 * Math.max(beClaims + pp, 0);
  const op = Math.min(0.3 * bscr, Math.max(opPrem, opProv));
  const lacFDB = Math.min(V.fdb, mkt);
  const lacDT = Math.min(C.taxRate * Math.max(0, bscr + op - lacFDB), C.dtlCap);
  const scr = bscr + op - lacFDB - lacDT;

  /* ---- 7b. Marge de risque ----
     SCR « de référence » : sans le risque de marché (couvrable). On agrège contrepartie, vie
     et non-vie, puis on ajoute le risque opérationnel.
     Ce SCR est ensuite écoulé dans le temps selon le profil de run-off :
       - non-vie : part des flux futurs encore à payer à chaque date (remNL / remNL0)
       - vie : provisions restantes / provisions initiales (v.prof[t] / v.prof[0])
     Les deux profils sont actualisés, puis pondérés par le poids relatif du SCR non-vie
     et du SCR vie (shNL). Marge de risque = coût du capital × SCR × profil actualisé. */
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
  const rm = B ? rmCalc : rmGuess;   /* en mode base on utilise la valeur supposée (voir compute) */

  /* ---- 8a. Bilan économique ---- */
  const liabTotal = liabNoRM + rm;
  const assetInv = Object.values(assets).reduce((a, b) => a + b, 0);
  const assetTotal = assetInv + riRec + P.otherAssets;
  const excess = assetTotal - liabTotal;   /* excédent d'actifs sur passifs */

  /* ---- 8b. Fonds propres éligibles (couverture du SCR) ----
     Fonds propres de base = excédent + dettes subordonnées - dividende.
     Classement : niveau 1 non restreint = le reste après dettes et impôts différés actifs.
     Plafonds d'éligibilité :
       niveau 1 restreint ≤ 25 % du niveau 1 non restreint (soit 20 % du niveau 1)
       niveau 3 ≤ 15 % du SCR
       niveaux 2 + 3 ≤ 50 % du SCR */
  const divd = S.dividend != null ? S.dividend : C.dividend;
  const ofTotal = excess + C.t1r + C.t2 - divd;
  const t3 = P.dta;
  const t1u = Math.max(0, ofTotal - C.t1r - C.t2 - t3);
  const t1rEl = Math.min(C.t1r, 0.25 * t1u);
  const t3El = Math.min(t3, 0.15 * Math.max(scr, 0));
  const t2El = Math.max(0, Math.min(C.t2, 0.5 * scr - t3El));
  const elig = Math.max(0, t1u + t1rEl + t2El + t3El);

  /* ---- 8c. MCR (minimum de capital requis) ----
     MCR linéaire simplifié, encadré entre 25 % et 45 % du SCR, avec un plancher absolu.
     Fonds propres éligibles au MCR : niveau 3 exclu, niveau 2 ≤ 20 % du MCR. */
  const mcrLin = 0.08 * Math.max(0, beClaims) + 0.07 * N.prem + 0.037 * beVie + 0.0007 * V.car;
  const mcr = Math.max(Math.min(Math.max(mcrLin, 0.25 * scr), 0.45 * scr), C.amcr);
  const t2Mcr = Math.min(C.t2, 0.2 * mcr, t2El);
  const eligMcr = Math.max(0, t1u + t1rEl + t2Mcr);

  /* Rendement moyen du portefeuille (pondéré par l'allocation). Sert à la projection. */
  const pYield = w.gov * rf0(P.mGov) + w.corp * (rf0(P.mCorp) + P.spreadCorp) + (w.eq1 + w.eq2) * P.yEq + w.prop * P.yProp + w.cash * rf0(1);

  /* Résultat : tout ce que l'interface affiche. */
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
    ratio: scr > 0 ? elig / scr : Infinity,         /* ratio de solvabilité = fonds propres éligibles / SCR */
    ratioMcr: mcr > 0 ? eligMcr / mcr : Infinity    /* ratio MCR */
  };
}

/* ----------------------------------------------------------------------------
   compute(P, S) : fonction publique.
   - Sans choc : on calcule le cas de base. La marge de risque entre dans les passifs, donc
     dans le montant d'actifs déduit du bilan, et elle dépend elle-même du SCR : on itère
     4 fois en réinjectant la marge de risque calculée au tour précédent.
   - Avec choc : on calcule d'abord le cas de base, puis on le rejoue avec le choc en
     revalorisant ses actifs (le mode « B » de core).
   ---------------------------------------------------------------------------- */
function compute(P, S) {
  const hasS = S && Object.keys(S).length > 0;
  if (hasS) return core(P, S, compute(P, null), 0);
  let rm = 0, r;
  for (let i = 0; i < 4; i++) { r = core(P, null, null, rm); rm = r.prov.rmCalc; }
  return r;
}

/* ----------------------------------------------------------------------------
   PROJECTION SUR 5 ANS
   Chaque année :
     1. Primes, triangle et provisions vie croissent de leur taux de croissance.
     2. Résultat technique non-vie (uw) = primes × (1 - sinistres/primes - frais).
     3. Produits financiers (fin) = (excédent + provisions non-vie) × rendement du portefeuille,
        moins le coût du passif non-vie (provisions × taux à 3 ans).
     4. Marge vie (vm) = provisions vie × (marge de gestion - frais).
     5. Résultat avant impôt = uw + fin + vm - intérêts de la dette subordonnée,
        puis impôt sur les bénéfices. Dividende = taux de distribution × résultat net.
     6. L'excédent est mis à jour (résultat - dividende de l'an précédent), puis tout le
        modèle est recalculé : le SCR est refait entièrement chaque année.
   ---------------------------------------------------------------------------- */
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

/* ----------------------------------------------------------------------------
   SCÉNARIOS DE CHOC (onglet « Chocs »)
   Clés de S : shiftBp (décalage de courbe en pb), eq / prop (variation en %),
   spreadBp (écartement des spreads en pb), reserveStrain (renforcement des provisions),
   lrAdd (dérive du ratio sinistres/primes), lapseMult (multiple des rachats),
   catNet (sinistre catastrophe net de réassurance, en M€).
   ---------------------------------------------------------------------------- */
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

/* Export : module Node (tests, notebooks) ou variable globale Model dans le navigateur. */
const Model = { DEFAULTS, SCENARIOS, compute, project, clone, mkCurve, chainLadder, defaultTriangle, SH_UP, SH_DN, PD_BY_RATING };
if (typeof module !== 'undefined' && module.exports) module.exports = Model;
else root.Model = Model;
})(typeof window !== 'undefined' ? window : globalThis);
