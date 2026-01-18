// =========================
// FILE: enemy.js
// (port of Enemy.py)
// =========================

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

export const ENEMY_TEMPLATES = {

  "Goblin":       { base_hp: 14, base_ac: 12, to_hit: 3, damage: [1, 6] },
  "Bandit":       { base_hp: 16, base_ac: 13, to_hit: 4, damage: [2, 6] },
  "Skeleton":     { base_hp: 18, base_ac: 13, to_hit: 4, damage: [1, 8] },
  "Bat":         { base_hp: 12, base_ac: 12, to_hit: 3, damage: [1, 6] },
  "Cult Acolyte": { base_hp: 15, base_ac: 12, to_hit: 4, damage: [2, 8] },
  "Viper":        { base_hp: 13, base_ac: 13, to_hit: 4, damage: [1, 7] },
  "Zombie":       { base_hp: 20, base_ac: 11, to_hit: 3, damage: [2, 8] },
};

export const TRAITS = [
  ["cowardly",  { hp: -2, ac:  0, to_hit: -1 }],
  ["fanatical", { hp:  2, ac:  0, to_hit:  1 }],
  ["cunning",   { hp:  0, ac:  1, to_hit:  0 }],
  ["wounded",   { hp: -4, ac:  0, to_hit:  0 }],
  ["brutal",    { hp:  0, ac:  0, to_hit:  0 }], // dmg bump below
];

/**
 * generateEnemy(player, difficulty=0, enemyType=null)
 * Mirrors your Python scaling.
 */
export function generateEnemy(player, difficulty = 0, enemyType = null) {
  const keys = Object.keys(ENEMY_TEMPLATES);
  const type = enemyType ?? choice(keys);
  const base = ENEMY_TEMPLATES[type] ?? ENEMY_TEMPLATES["Goblin"];

  const [trait, mod] = choice(TRAITS);

  let hp = base.base_hp + difficulty * 3 + mod.hp;
  let ac = base.base_ac + Math.floor(difficulty / 2) + mod.ac;
  let toHit = base.to_hit + Math.floor(difficulty / 2) + mod.to_hit;

  let [dmgLo, dmgHi] = base.damage;
  if (trait === "brutal") dmgHi += 2;

  hp = Math.max(6, hp);
  ac = Math.max(10, ac);

  return {
    name: `${type} (${trait}, Lv ${difficulty + 1})`,
    type,
    trait,
    HP: hp,
    AC: ac,
    to_hit: toHit,
    damage: [dmgLo, dmgHi],
  };
}
