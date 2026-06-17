# Sudoku Duel

Duel de grilles **en temps reel, de 2 a 5 joueurs**. Interface minimaliste,
100% responsive (desktop + mobile), pensee pour un deploiement en un clic sur
**Render** via GitHub.

## Les modes

### CLASSIQUE — Sudoku 9×9
- Choix de la **difficulte** (Facile / Moyen / Difficile / Expert) et du
  **format** (1 manche, ou premier a 2 manches gagnantes).
- Tous les joueurs recoivent **la meme grille**. Le **premier a terminer** la
  grille remporte la manche.
- Une erreur **bloque ton ecran pendant 10 s** (decompte affiche), puis tu reprends.

### JEUX RAPIDES
- A l'arrivee : choisis si le match se gagne en finissant **3 ou 5 grilles**, et
  **active/desactive les jeux** du tirage.
- Jeux disponibles : **Queens** (croix posees automatiquement autour des
  couronnes), **Tango**, **Zip**, **Sudoku 6×6**.
- A chaque manche, une grille est **tiree au sort** parmi les jeux choisis (sans
  repetition immediate). La sequence et les grilles sont **identiques pour tous**.
- Chacun **enchaine sa file de grilles a son rythme** ; le **premier au bout de
  toute la sequence gagne**.
- Erreur : **blocage de 5 s** sur Sudoku 6×6 et Queens. Pas de penalite sur Tango
  et Zip.
- Aucune difficulte a regler sur ces mini-jeux.

## Commun a tous les jeux
- **Saisie clavier** (desktop) : chiffres, fleches, Backspace pour effacer, `n`
  pour le mode notes.
- **Annotations** : bouton « Notes ». Quand un chiffre est place, les annotations
  de ce chiffre sur la meme ligne / colonne / boite disparaissent.
- **Decompte de 3 s** au lancement du match.
- **Barres de progression** : la tienne + celle du **meneur** adverse (ou du 2e
  si tu es en tete), avec son nom.
- **Thème clair / sombre** + petite icone pour changer la **couleur principale**.
- A la fin de la partie : bouton **Rejouer** qui ramene tout le monde dans le
  **meme salon**, sans recreer de code.

## Lancer en local (optionnel, necessite Node 18+)

```bash
npm install
npm start
# http://localhost:3000
```

## Deployer sur Render

1. Pousse ce dossier sur un depot **GitHub**.
2. Sur [Render](https://render.com) : **New → Web Service**, connecte le depot.
3. Render lit `render.yaml` automatiquement (sinon : Build `npm install`, Start `npm start`).
4. Une fois en ligne, l'URL publique sert le jeu **et** les salons temps reel.

> Plan gratuit Render : le service s'endort apres inactivite. Le premier
> chargement peut prendre ~30 s, le temps que le service se reveille.

## Pile technique

- **Node + Express** : sert le front statique.
- **Socket.io** : salons et synchro temps reel.
- Front **vanilla** (HTML/CSS/JS), aucun build.

## Structure

```
server.js          serveur + salons (2-5 joueurs) + modes classique / rapide
public/
  index.html       ecrans (accueil, config, salon, jeu)
  styles.css       themes clair/sombre, responsive, animations
  app.js           logique client + moteur de jeu (un controleur par jeu)
  games.js         generateurs : sudoku 9/6, Queens, Tango, Zip (cote serveur)
render.yaml        config de deploiement Render
```
