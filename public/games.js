/* ============================================================================
 *  games.js — Generateurs de grilles (Node + navigateur)
 *
 *  Expose un objet `Games` partage entre le serveur (require) et le client
 *  (window.Games). Chaque generateur renvoie un objet "grid" auto-suffisant
 *  contenant tout ce dont le client a besoin pour afficher + valider la grille.
 *
 *  Jeux disponibles :
 *    - sudoku9 : sudoku classique 9x9 (avec difficulte)   -> penalite 10s
 *    - sudoku6 : sudoku 6x6 (boites 2x3)                  -> penalite 5s
 *    - queens  : N-reines coloriees, une par region        -> penalite 5s
 *    - tango   : grille 6x6 soleil/lune avec contraintes    -> pas de penalite
 *    - zip     : chemin hamiltonien passant les nombres     -> pas de penalite
 * ========================================================================== */
(function (root) {
  'use strict';

  // -------------------------------------------------------------------------
  //  Utilitaires
  // -------------------------------------------------------------------------
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function randInt(n) { return Math.floor(Math.random() * n); }
  function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

  // =========================================================================
  //  SUDOKU (taille N, boites brXbc)
  // =========================================================================
  var SUDOKU_GIVENS = { facile: 46, moyen: 36, difficile: 30, expert: 24 };

  function sudokuDims(size) {
    return size === 6 ? { br: 2, bc: 3 } : { br: 3, bc: 3 };
  }

  function sudokuSafe(grid, size, br, bc, row, col, num) {
    for (var x = 0; x < size; x++) {
      if (grid[row][x] === num) return false;
      if (grid[x][col] === num) return false;
    }
    var r0 = row - (row % br);
    var c0 = col - (col % bc);
    for (var r = 0; r < br; r++) {
      for (var c = 0; c < bc; c++) {
        if (grid[r0 + r][c0 + c] === num) return false;
      }
    }
    return true;
  }

  function sudokuFill(grid, size, br, bc) {
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        if (grid[row][col] === 0) {
          var nums = shuffle(range(size).map(function (n) { return n + 1; }));
          for (var k = 0; k < nums.length; k++) {
            if (sudokuSafe(grid, size, br, bc, row, col, nums[k])) {
              grid[row][col] = nums[k];
              if (sudokuFill(grid, size, br, bc)) return true;
              grid[row][col] = 0;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  function emptyMatrix(size, val) {
    var g = [];
    for (var i = 0; i < size; i++) {
      var row = [];
      for (var j = 0; j < size; j++) row.push(val);
      g.push(row);
    }
    return g;
  }
  function cloneMatrix(m) { return m.map(function (r) { return r.slice(); }); }

  function genSudoku(size, difficulty) {
    var d = sudokuDims(size);
    var solution = emptyMatrix(size, 0);
    sudokuFill(solution, size, d.br, d.bc);

    var givens;
    if (size === 6) {
      givens = 16; // ~44% remplies, rapide
    } else {
      givens = SUDOKU_GIVENS[difficulty] || SUDOKU_GIVENS.moyen;
    }

    var puzzle = cloneMatrix(solution);
    var cells = range(size * size);
    shuffle(cells);
    var toRemove = size * size - givens;
    var removed = 0;
    for (var i = 0; i < cells.length && removed < toRemove; i++) {
      var r = Math.floor(cells[i] / size), c = cells[i] % size;
      if (puzzle[r][c] !== 0) { puzzle[r][c] = 0; removed++; }
    }

    return {
      type: size === 6 ? 'sudoku6' : 'sudoku9',
      size: size,
      box: d,
      puzzle: puzzle,
      solution: solution
    };
  }

  function countEmpty(puzzle) {
    var n = 0;
    for (var r = 0; r < puzzle.length; r++)
      for (var c = 0; c < puzzle[r].length; c++)
        if (puzzle[r][c] === 0) n++;
    return n;
  }

  // =========================================================================
  //  QUEENS — une couronne par ligne, colonne et region, sans contact.
  // =========================================================================
  function queensPlacement(n) {
    // Renvoie un tableau col[row] = colonne de la reine de la ligne row.
    var cols = new Array(n).fill(-1);
    var used = new Array(n).fill(false);
    function bt(row) {
      if (row === n) return true;
      var order = shuffle(range(n));
      for (var i = 0; i < order.length; i++) {
        var c = order[i];
        if (used[c]) continue;
        if (row > 0 && Math.abs(c - cols[row - 1]) < 2) continue; // contact diag/vert
        cols[row] = c; used[c] = true;
        if (bt(row + 1)) return true;
        used[c] = false; cols[row] = -1;
      }
      return false;
    }
    return bt(0) ? cols : null;
  }

  // Compte les solutions valides (jusqu'a 2) pour un coloriage donne.
  function queensSolveCount(regions, n, limit) {
    var count = 0;
    var usedCol = new Array(n).fill(false);
    var usedReg = new Array(n).fill(false);
    var placed = new Array(n).fill(-1);
    function bt(row) {
      if (count >= limit) return;
      if (row === n) { count++; return; }
      for (var c = 0; c < n; c++) {
        if (usedCol[c]) continue;
        var reg = regions[row][c];
        if (usedReg[reg]) continue;
        if (row > 0 && Math.abs(c - placed[row - 1]) < 2) continue;
        usedCol[c] = true; usedReg[reg] = true; placed[row] = c;
        bt(row + 1);
        usedCol[c] = false; usedReg[reg] = false; placed[row] = -1;
        if (count >= limit) return;
      }
    }
    bt(0);
    return count;
  }

  function growRegions(seeds, n) {
    // Flood-fill multi-source aleatoire : chaque graine = une region.
    var regions = emptyMatrix(n, -1);
    var frontiers = [];
    for (var i = 0; i < seeds.length; i++) {
      regions[seeds[i][0]][seeds[i][1]] = i;
      frontiers.push([seeds[i].slice()]);
    }
    var remaining = n * n - seeds.length;
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var guard = 0;
    while (remaining > 0 && guard < n * n * 50) {
      guard++;
      var ri = randInt(frontiers.length);
      var fr = frontiers[ri];
      if (!fr.length) continue;
      var ci = randInt(fr.length);
      var cell = fr[ci];
      var opts = [];
      for (var d = 0; d < 4; d++) {
        var nr = cell[0] + dirs[d][0], nc = cell[1] + dirs[d][1];
        if (nr >= 0 && nr < n && nc >= 0 && nc < n && regions[nr][nc] === -1) {
          opts.push([nr, nc]);
        }
      }
      if (!opts.length) { fr.splice(ci, 1); continue; }
      var pick = opts[randInt(opts.length)];
      regions[pick[0]][pick[1]] = ri;
      fr.push(pick);
      remaining--;
    }
    if (remaining > 0) return null; // echec rare
    return regions;
  }

  function genQueens() {
    var n = 6 + randInt(3); // 6..8
    for (var attempt = 0; attempt < 400; attempt++) {
      var cols = queensPlacement(n);
      if (!cols) continue;
      var seeds = cols.map(function (c, r) { return [r, c]; });
      var regions = growRegions(seeds, n);
      if (!regions) continue;
      if (queensSolveCount(regions, n, 2) === 1) {
        var solution = emptyMatrix(n, 0); // 1 = reine
        for (var r = 0; r < n; r++) solution[r][cols[r]] = 1;
        return { type: 'queens', size: n, regions: regions, solution: solution };
      }
    }
    return null;
  }

  // =========================================================================
  //  TANGO — grille 6x6 de 0 (lune) / 1 (soleil).
  //  Regles : 3 de chaque par ligne/colonne, jamais 3 identiques d'affilee,
  //  contraintes '=' / 'x' entre cases adjacentes.
  // =========================================================================
  var TANGO_N = 6;

  function tangoNoTriple(grid, n, row, col, val) {
    // Verifie qu'en posant val on ne forme pas 3 a la suite (gauche/haut).
    if (col >= 2 && grid[row][col - 1] === val && grid[row][col - 2] === val) return false;
    if (row >= 2 && grid[row - 1][col] === val && grid[row - 2][col] === val) return false;
    return true;
  }
  function tangoCountsOk(grid, n, row, col, val) {
    var rc = 0, cc = 0, half = n / 2;
    for (var x = 0; x < n; x++) { if (grid[row][x] === val) rc++; if (grid[x][col] === val) cc++; }
    return rc < half && cc < half;
  }

  function tangoFill(grid, n) {
    for (var row = 0; row < n; row++) {
      for (var col = 0; col < n; col++) {
        if (grid[row][col] === -1) {
          var opts = shuffle([0, 1]);
          for (var k = 0; k < 2; k++) {
            var v = opts[k];
            if (tangoNoTriple(grid, n, row, col, v) && tangoCountsOk(grid, n, row, col, v)) {
              grid[row][col] = v;
              if (tangoFill(grid, n)) return true;
              grid[row][col] = -1;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  // Solveur Tango : compte les solutions (jusqu'a limit) compatibles avec
  // les indices (givens) et les contraintes.
  function tangoSolveCount(givens, constraints, n, limit) {
    var grid = cloneMatrix(givens);
    var count = 0;
    // index des contraintes par cellule pour verification incrementale
    function checkConstraints(r, c) {
      for (var i = 0; i < constraints.length; i++) {
        var k = constraints[i];
        var aFilled, bFilled, av, bv;
        if (k.a[0] === r && k.a[1] === c) { av = grid[r][c]; bv = grid[k.b[0]][k.b[1]]; }
        else if (k.b[0] === r && k.b[1] === c) { av = grid[k.a[0]][k.a[1]]; bv = grid[r][c]; }
        else continue;
        if (av === -1 || bv === -1) continue;
        if (k.type === '=' && av !== bv) return false;
        if (k.type === 'x' && av === bv) return false;
      }
      return true;
    }
    var cells = [];
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (grid[r][c] === -1) cells.push([r, c]);

    function bt(idx) {
      if (count >= limit) return;
      if (idx === cells.length) { count++; return; }
      var r = cells[idx][0], c = cells[idx][1];
      for (var v = 0; v <= 1; v++) {
        grid[r][c] = v;
        if (tangoNoTriple(grid, n, r, c, v) && tangoCountsOk(grid, n, r, c, v) && checkConstraints(r, c)) {
          bt(idx + 1);
        }
        grid[r][c] = -1;
        if (count >= limit) return;
      }
    }
    bt(0);
    return count;
  }

  function genTango() {
    var n = TANGO_N;
    var solution;
    for (var a = 0; a < 200; a++) {
      solution = emptyMatrix(n, -1);
      if (tangoFill(solution, n)) break;
      solution = null;
    }
    if (!solution) return null;

    // Toutes les paires adjacentes possibles.
    var pairs = [];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (c + 1 < n) pairs.push([[r, c], [r, c + 1]]);
        if (r + 1 < n) pairs.push([[r, c], [r + 1, c]]);
      }
    }
    shuffle(pairs);

    var givens = emptyMatrix(n, -1);
    var constraints = [];
    // On ajoute des contraintes jusqu'a unicite.
    for (var i = 0; i < pairs.length; i++) {
      if (tangoSolveCount(givens, constraints, n, 2) === 1) break;
      var p = pairs[i];
      var av = solution[p[0][0]][p[0][1]];
      var bv = solution[p[1][0]][p[1][1]];
      constraints.push({ a: p[0], b: p[1], type: av === bv ? '=' : 'x' });
    }
    // Filet de securite : si toujours pas unique, on revele quelques cases.
    var cells = range(n * n); shuffle(cells);
    for (var j = 0; j < cells.length; j++) {
      if (tangoSolveCount(givens, constraints, n, 2) === 1) break;
      var rr = Math.floor(cells[j] / n), cc = cells[j] % n;
      givens[rr][cc] = solution[rr][cc];
    }

    return {
      type: 'tango', size: n,
      puzzle: givens, constraints: constraints, solution: solution
    };
  }

  // =========================================================================
  //  ZIP — relier 1->2->...->k en passant par toutes les cases une fois.
  // =========================================================================
  function genZip() {
    var n = 5 + randInt(2); // 5..6
    var path = hamiltonianPath(n);
    if (!path) return null;

    // Place des points numerotes le long du chemin (debut, fin + intermediaires).
    var k = Math.min(path.length, Math.max(5, Math.round(n * 1.2)));
    var numbers = emptyMatrix(n, 0);
    for (var i = 0; i < k; i++) {
      var pos = Math.round(i * (path.length - 1) / (k - 1));
      var cell = path[pos];
      numbers[cell[0]][cell[1]] = i + 1;
    }
    return { type: 'zip', size: n, numbers: numbers, count: k, solutionPath: path };
  }

  function hamiltonianPath(n) {
    var total = n * n;
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var attempt = 0; attempt < 60; attempt++) {
      var visited = emptyMatrix(n, false);
      var path = [];
      var start = [randInt(n), randInt(n)];
      visited[start[0]][start[1]] = true;
      path.push(start);
      if (dfsHam(path, visited, n, dirs, total)) return path;
    }
    return null;
  }

  function dfsHam(path, visited, n, dirs, total) {
    if (path.length === total) return true;
    var cur = path[path.length - 1];
    var order = shuffle(dirs.slice());
    for (var i = 0; i < order.length; i++) {
      var nr = cur[0] + order[i][0], nc = cur[1] + order[i][1];
      if (nr < 0 || nr >= n || nc < 0 || nc >= n || visited[nr][nc]) continue;
      visited[nr][nc] = true; path.push([nr, nc]);
      if (dfsHam(path, visited, n, dirs, total)) return true;
      visited[nr][nc] = false; path.pop();
    }
    return false;
  }

  // =========================================================================
  //  Catalogue + dispatch
  // =========================================================================
  var CATALOG = {
    sudoku9: { id: 'sudoku9', label: 'Sudoku', category: 'classique', penalty: 10 },
    sudoku6: { id: 'sudoku6', label: 'Sudoku 6x6', category: 'rapide', penalty: 5 },
    queens: { id: 'queens', label: 'Queens', category: 'rapide', penalty: 5 },
    tango: { id: 'tango', label: 'Tango', category: 'rapide', penalty: 0 },
    zip: { id: 'zip', label: 'Zip', category: 'rapide', penalty: 0 }
  };
  // Jeux proposes dans la categorie "Jeux rapides".
  var RAPID_GAMES = ['queens', 'tango', 'zip', 'sudoku6'];

  function generate(gameId, opts) {
    opts = opts || {};
    var grid = null, tries = 0;
    do {
      switch (gameId) {
        case 'sudoku9': grid = genSudoku(9, opts.difficulty || 'moyen'); break;
        case 'sudoku6': grid = genSudoku(6); break;
        case 'queens': grid = genQueens(); break;
        case 'tango': grid = genTango(); break;
        case 'zip': grid = genZip(); break;
        default: grid = genSudoku(9, 'moyen');
      }
      tries++;
    } while (!grid && tries < 20);
    if (grid) grid.penalty = CATALOG[gameId] ? CATALOG[gameId].penalty : 0;
    return grid;
  }

  var api = {
    CATALOG: CATALOG,
    RAPID_GAMES: RAPID_GAMES,
    SUDOKU_GIVENS: SUDOKU_GIVENS,
    generate: generate,
    countEmpty: countEmpty,
    sudokuDims: sudokuDims
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Games = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
