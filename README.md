# Wiki Duel

Deux jeux à faire entre amis, basés sur des pages Wikipedia très consultées
(**plus de 5 000 vues par mois** sur fr.wikipedia, via l'API Wikimedia).

On te demande un **pseudo** en arrivant sur le site.

## Les jeux

### Duel (en ligne, 2 à 8 joueurs)
- Un salon avec un code (ou un lien d'invitation à envoyer à tes amis).
- À chaque manche : **2 pages Wikipedia** et toujours la même question :
  **« Qu'est-ce qui marquera le plus le monde ? »**
- Chacun choisit en secret. Quand tout le monde a répondu, on **révèle** qui a
  choisi quoi, avec les vues mensuelles des deux pages. Pas de score.
- L'hôte règle **Monde** (personnalités et événements du monde entier) ou
  **France** (uniquement des personnalités et événements français) et le
  nombre de manches (5 / 10 / 15).
- Récap de fin de partie avec le pourcentage d'accord entre joueurs, et
  « Rejouer » dans le même salon.
- Un rechargement de la page ne te sort pas de la partie.

### Tier list (solo, sans limite de temps)
- Les **50 personnalités françaises les plus connues**, à ranger de S à F
  (touche une personnalité puis la ligne, ou glisse-la).
- Ton brouillon est gardé dans le navigateur ; quand tout est classé, tu
  enregistres.
- L'onglet **Historique** montre toutes les tier lists enregistrées (pseudo,
  date, classement).

## Lancer en local (Node 18+)

```bash
npm install
npm start
# http://localhost:3000
```

Sans Supabase, l'historique est stocké dans `data/tierlists.local.json`
(pratique pour tester, mais effacé à chaque redéploiement sur Render).

## Les listes de pages (`data/`)

Les pages sont dans `data/world.json`, `data/france.json` et
`data/tierlist.json`. Elles sont **construites à l'avance** pour que le jeu soit
rapide et ne dépende pas de Wikipedia en direct :

```bash
npm run build-data
```

Le script (`scripts/build-data.js`) :
1. récupère des candidats : événements (Wikidata), personnalités françaises
   (Wikidata), personnalités mondiales (articles « vitaux » de Wikipedia) ;
2. interroge l'API Wikimedia pour les **vues des 30 derniers jours** sur
   fr.wikipedia et ne garde que les pages à **5 000 vues/mois ou plus** ;
3. choisit pour la tier list les 50 personnalités françaises présentes dans le
   plus de langues Wikipedia (avec photo).

Il peut durer 20 à 30 minutes (l'API demande d'aller doucement). Un cache
(`scripts/.cache`) permet de reprendre après une coupure. Pour rafraîchir les
vues, relance la commande puis commite `data/`.
Pour changer la tier list à la main, modifie `data/tierlist.json`.

## Historique permanent avec Supabase

Render gratuit efface ses fichiers à chaque redéploiement : pour garder
l'historique, on le stocke dans une base **Supabase** (gratuit).

1. Crée un compte sur [supabase.com](https://supabase.com) puis **New project**
   (nom au choix, choisis un mot de passe, région « West EU / Paris » si dispo).
   Attends 1-2 minutes que le projet soit prêt.
2. Menu **SQL Editor → New query** : colle le contenu de
   [`supabase/schema.sql`](supabase/schema.sql) puis **Run**. Ça crée la table
   `tierlists`.
3. Menu **Project Settings → API** (ou « API Keys ») et note :
   - **Project URL** (ex. `https://abcd1234.supabase.co`)
   - la clé **`service_role`** (⚠ secrète : ne la mets jamais dans le code ni
     sur GitHub ; elle ne sert que côté serveur).
4. Sur **Render** → ton service → **Environment** → ajoute :
   - `SUPABASE_URL` = ton Project URL
   - `SUPABASE_SERVICE_KEY` = ta clé `service_role`

   Render redéploie tout seul. Au démarrage, les logs affichent
   `Historique : Supabase`.

Pour tester en local avec Supabase :
`SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm start`.

## Déployer sur Render

1. Pousse ce dépôt sur GitHub (c'est déjà le cas).
2. Sur [Render](https://render.com) : **New → Web Service**, connecte le dépôt.
   `render.yaml` est lu automatiquement (sinon : Build `npm install`, Start
   `npm start`).
3. Ajoute les variables Supabase (ci-dessus).
4. L'URL publique sert le site **et** les salons temps réel.

> Plan gratuit : le service s'endort après inactivité ; le premier chargement
> peut prendre ~30 s. Ouvre le site avant de jouer pour le réveiller.

## Structure

```
server.js              serveur Express + Socket.io (salons du Duel, API tier list)
lib/store.js           historique des tier lists (Supabase ou fichier local)
public/                site (HTML/CSS/JS, sans build)
  app.js               pseudo, onglets          duel.js        jeu Duel
  tierlist.js          tier list                history.js     historique
data/                  listes de pages Wikipedia (générées)
scripts/build-data.js  construit data/ depuis les API Wikimedia
supabase/schema.sql    table de l'historique
```
