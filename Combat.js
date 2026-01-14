// =========================
// FILE: Combat.js
// (port of Combat.py)
// =========================

function randInt(min, max) {
  // inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function rollD20() {
  return randInt(1, 20);
}

export function rollDamage(dmgRange) {
  const [lo, hi] = dmgRange;
  return randInt(lo, hi);
}

/**
 * Returns: { hit, d20, total, dmg, crit, fumble }
 * Mutates defender.HP when hit/crit.
 */
export function attack(attacker, defender) {
  const d20 = rollD20();
  const total = d20 + (attacker.to_hit ?? 0);

  // Nat 1: automatic miss
  if (d20 === 1) {
    return { hit: false, d20, total, dmg: 0, crit: false, fumble: true };
  }

  // Nat 20: crit = roll damage twice
  if (d20 === 20) {
    const dmg =
      rollDamage(attacker.damage ?? [1, 4]) +
      rollDamage(attacker.damage ?? [1, 4]);
    defender.HP -= dmg;
    return { hit: true, d20, total, dmg, crit: true, fumble: false };
  }

  const hit = total >= (defender.AC ?? 10);
  if (hit) {
    const dmg = rollDamage(attacker.damage ?? [1, 4]);
    defender.HP -= dmg;
    return { hit: true, d20, total, dmg, crit: false, fumble: false };
  }

  return { hit: false, d20, total, dmg: 0, crit: false, fumble: false };
}

export function maybeFlee(enemy) {
  // cowardly might flee when low
  if (enemy.trait === "cowardly" && enemy.HP <= 4) {
    return Math.random() < 0.5;
  }
  return false;
}

/**
 * A PURE-ish combat runner:
 * - Does NOT print
 * - Returns a result object you can render later in the UI
 *
 * Returns:
 * {
 *   winnerName,
 *   turns: [ { actor: "player"|"enemy", ...attackResult, playerHP, enemyHP } ],
 *   fled: boolean
 * }
 */
export function runCombat(player, enemy) {
  const turns = [];
  let isPlayerTurn = true;
  let fled = false;

  while (player.HP > 0 && enemy.HP > 0) {
    if (!isPlayerTurn) {
      if (maybeFlee(enemy)) {
        fled = true;
        break;
      }
    }

    if (isPlayerTurn) {
      const r = attack(player, enemy);
      turns.push({
        actor: "player",
        ...r,
        playerHP: Math.max(player.HP, 0),
        enemyHP: Math.max(enemy.HP, 0),
      });
    } else {
      const r = attack(enemy, player);
      turns.push({
        actor: "enemy",
        ...r,
        playerHP: Math.max(player.HP, 0),
        enemyHP: Math.max(enemy.HP, 0),
      });
    }

    isPlayerTurn = !isPlayerTurn;
  }

  const winnerName =
    fled ? player.name : (player.HP > 0 ? player.name : enemy.name);

  return { winnerName, turns, fled };
}
