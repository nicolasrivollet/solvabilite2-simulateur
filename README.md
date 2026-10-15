# Simulateur Solvabilité II

Simulateur pédagogique d'un assureur mixte vie / non-vie en formule standard simplifiée (montants en M€) :
bilan économique, provisions (Chain Ladder, projection vie, marge de risque), SCR par module,
fonds propres éligibles par niveau, MCR, chocs instantanés et projection sur 5 ans.

## Utilisation

Ouvrir `index.html` dans un navigateur. Aucune dépendance, aucun build.

## Structure

- `model.js` : moteur actuariel, sans interface. `Model.compute(P)` renvoie bilan, SCR et ratios.
- `ui1.js`, `ui2.js` : interface (onglets, saisies, graphiques).
- `src-head.html` : styles et squelette de la page.
- `index.html` : page autonome assemblée à partir des fichiers ci-dessus.

Pour réassembler : `index.html` = doctype + `src-head.html` + `<script>` de `model.js`, `ui1.js`, `ui2.js`, puis `</body></html>`.

## Limites

Modèle pédagogique aux calibrages indicatifs. Sans look-through, ajustement pour volatilité, risque de change,
risque de concentration ni risque santé. Ne convient pas à un reporting réglementaire.
