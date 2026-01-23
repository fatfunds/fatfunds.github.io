// =========================
// FILE: enemy.js
// UPDATED: old ENEMY_TEMPLATES -> new "character-like" format
// - adds STR/INT/DEX/CON/CHA, MP/SP + max*, status, moves (max 4),
//   affinity/resist, and ai memory.
// - keeps your old scaling + traits behavior.
// =========================

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

export const Element = Object.freeze({
  Physical: "Physical",
  Fire: "Fire",
  Ice: "Ice",
  Lightning: "Lightning",
  Holy: "Holy",
  Poison: "Poison",
});

// ---------------------------
// OLD TEMPLATES (you had)
//   { base_hp, base_ac, to_hit, damage: [lo, hi] }
// NEW FORMAT:
//   {
//     base_hp, base_ac, base_to_hit, damage,
//     stats: { STR, INT, CHA, CON, DEX },
//     pools: { MP, SP },
//     movePool: [moveId...],     // we pick up to 4
//     affinity,                 // default for matrix fallback
//     resist: { Element: mult } // optional
//   }
// ---------------------------
export const ENEMY_TEMPLATES = {
  Goblin: {
    base_hp: 14,
    base_ac: 12,
    base_to_hit: 3,
    damage: [1, 6],
    stats: { STR: 1, INT: 0, CHA: 0, CON: 1, DEX: 3 },
    pools: { MP: 0, SP: 4 },
    movePool: ["quick", "strike", "guard", "wound"],
    affinity: Element.Physical,
  },

  Bandit: {
    base_hp: 16,
    base_ac: 13,
    base_to_hit: 4,
    damage: [2, 6],
    stats: { STR: 3, INT: 0, CHA: 0, CON: 2, DEX: 1 },
    pools: { MP: 0, SP: 4 },
    movePool: ["heavy", "strike", "guard", "wound"],
    affinity: Element.Physical,
  },

  Skeleton: {
    base_hp: 18,
    base_ac: 13,
    base_to_hit: 4,
    damage: [1, 8],
    stats: { STR: 2, INT: 0, CHA: 0, CON: 3, DEX: 0 },
    pools: { MP: 0, SP: 3 },
    movePool: ["strike", "heavy", "guard", "wound"],
    affinity: Element.Poison,
    resist: {
      [Element.Poison]: 0.0,
      [Element.Holy]: 1.5,
    },
  },

  Bat: {
    base_hp: 12,
    base_ac: 12,
    base_to_hit: 3,
    damage: [1, 6],
    stats: { STR: 0, INT: 0, CHA: 0, CON: 1, DEX: 4 },
    pools: { MP: 0, SP: 4 },
    movePool: ["quick", "strike", "guard"], // fewer is ok; we pick up to 4
    affinity: Element.Physical,
  },

  "Cult Acolyte": {
    base_hp: 15,
    base_ac: 12,
    base_to_hit: 4,
    damage: [2, 8],
    stats: { STR: 1, INT: 2, CHA: 1, CON: 2, DEX: 0 },
    pools: { MP: 5, SP: 2 },
    movePool: ["heal", "firebolt", "fortify", "guard"], // caster kit
    affinity: Element.Fire,
    resist: {
      [Element.Fire]: 0.5,
    },
  },

  Viper: {
    base_hp: 13,
    base_ac: 13,
    base_to_hit: 4,
    damage: [1, 7],
    stats: { STR: 1, INT: 0, CHA: 0, CON: 1, DEX: 4 },
    pools: { MP: 0, SP: 4 },
    movePool: ["quick", "strike", "wound", "guard"],
    affinity: Element.Poison,
    resist: {
      [Element.Poison]: 0.5,
    },
  },

  Zombie: {
    base_hp: 20,
    base_ac: 11,
    base_to_hit: 3,
    damage: [2, 8],
    stats: { STR: 3, INT: 0, CHA: 0, CON: 4, DEX: -1 },
    pools: { MP: 0, SP: 3 },
    movePool: ["heavy", "strike", "guard", "wound"],
    affinity: Element.Poison,
    resist: {
      [Element.Poison]: 0.5,
      [Element.Holy]: 1.5,
    },
  },

  Wolf: {
    base_hp: 15,
    base_ac: 12,
    base_to_hit: 4,
    damage: [2, 7],
    stats: { STR: 2, INT: 0, CHA: 0, CON: 2, DEX: 3 },
    pools: { MP: 0, SP: 4 },
    movePool: ["quick", "strike", "guard", "wound"],
    affinity: Element.Physical,
  },
};

export const TRAITS = [
  ["cowardly",  { hp: -2, ac:  0, to_hit: -1 }],
  ["fanatical", { hp:  2, ac:  0, to_hit:  1 }],
  ["cunning",   { hp:  0, ac:  1, to_hit:  0 }],
  ["wounded",   { hp: -4, ac:  0, to_hit:  0 }],
  ["brutal",    { hp:  0, ac:  0, to_hit:  0 }], // dmg bump below
];

function cloneObj(obj) {
  return obj ? JSON.parse(JSON.stringify(obj)) : {};
}

function pickMoves(movePool, maxMoves = 4) {
  const pool = Array.isArray(movePool) ? movePool.slice() : [];
  const picked = [];
  while (pool.length && picked.length < maxMoves) {
    const i = randInt(0, pool.length - 1);
    picked.push(pool[i]);
    pool.splice(i, 1);
  }
  return picked;
}

/**
 * generateEnemy(player, difficulty=0, enemyType=null, opts?)
 * opts:
 *   - moves: [moveId...]     // hard override (max 4 enforced)
 *   - affinity: string
 *   - resist: object
 *   - stats: {STR,INT,CHA,CON,DEX} // override base stats
 *   - pools: {MP,SP}         // override base pools
 */
export function generateEnemy(player, difficulty = 0, enemyType = null, opts = {}) {
  const keys = Object.keys(ENEMY_TEMPLATES);
  const type = enemyType ?? choice(keys);
  const base = ENEMY_TEMPLATES[type] ?? ENEMY_TEMPLATES.Goblin;

  const [trait, mod] = choice(TRAITS);

  // --- scale core combat like your old version ---
  let hp = base.base_hp + difficulty * 3 + mod.hp;
  let ac = base.base_ac + Math.floor(difficulty / 2) + mod.ac;
  let toHit = base.base_to_hit + Math.floor(difficulty / 2) + mod.to_hit;

  let [dmgLo, dmgHi] = base.damage;
  if (trait === "brutal") dmgHi += 2;

  hp = Math.max(6, hp);
  ac = Math.max(10, ac);

  // --- stats: base + small scaling ---
  const s = { ...(base.stats ?? { STR: 1, INT: 0, CHA: 0, CON: 1, DEX: 1 }), ...(opts.stats ?? {}) };

  // small scaling: every 3 difficulty give +1 to STR/INT/DEX, every 4 difficulty give +1 CON
  const statBoost = Math.floor(difficulty / 3);
  const conBoost = Math.floor(difficulty / 4);

  const STR = Number(s.STR ?? 0) + statBoost;
  const INT = Number(s.INT ?? 0) + statBoost;
  const DEX = Number(s.DEX ?? 0) + statBoost;
  const CON = Number(s.CON ?? 0) + conBoost;
  const CHA = Number(s.CHA ?? 0);

  // --- pools: base + slight scaling ---
  const p = { ...(base.pools ?? { MP: 0, SP: 0 }), ...(opts.pools ?? {}) };
  const maxMP = Math.max(0, Number(p.MP ?? 0) + Math.floor(difficulty / 2));
  const maxSP = Math.max(0, Number(p.SP ?? 0) + Math.floor(difficulty / 2));

  // --- moves: pick up to 4 ---
  const moves = Array.isArray(opts.moves)
    ? opts.moves.slice(0, 4)
    : pickMoves(base.movePool ?? [], 4);

  // --- element identity ---
  const affinity =
    (typeof opts.affinity === "string" && opts.affinity.length)
      ? opts.affinity
      : (base.affinity ?? Element.Physical);

  const resist = {
    ...cloneObj(base.resist),
    ...(opts.resist && typeof opts.resist === "object" ? opts.resist : {}),
  };

  return {
    name: `${type} (${trait}, Lv ${difficulty + 1})`,
    type,
    trait,

    // character-like stats
    STR, INT, CHA, CON, DEX,

    // combat core
    HP: hp,
    maxHP: hp,
    AC: ac,
    to_hit: toHit,
    damage: [dmgLo, dmgHi],

    // resources like player
    maxMP,
    MP: maxMP,
    maxSP,
    SP: maxSP,

    // modular move loadout (max 4)
    moves,

    // element system
    affinity,
    resist,

    status: {},
    ai: { turns: 0, lastBuffTurn: -999 },
  };
}
