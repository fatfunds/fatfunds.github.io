// =========================
// FILE: Combat.js
// Step-based "FF-lite" turn combat (ENGINE ONLY)
// No DOM / no UI here.
// =========================

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function d20() {
  return randInt(1, 20);
}

function rollDamage([min, max]) {
  return randInt(min, max);
}

export class CombatController {
  constructor(playerRef, enemy) {
    this.player = playerRef; // mutated directly
    this.enemy = enemy;

    this.turn = "player"; // "player" | "enemy"
    this.ended = false;
    this.winner = null; // "player" | "enemy" | "fled"

    this.player.status = this.player.status ?? {};
    this.player.MP = this.player.MP ?? 3;
    this.player.inventory = this.player.inventory ?? ["potion"];
    this.enemy.status = this.enemy.status ?? {};

    this.log = [];
  }

  getPublicState() {
    return {
      active: !this.ended,
      turn: this.turn,
      player: {
        name: this.player.name,
        class: this.player.class,
        HP: this.player.HP,
        AC: this.player.AC,
        to_hit: this.player.to_hit,
        damage: this.player.damage,
        STR: this.player.STR,
        INT: this.player.INT,
        CHA: this.player.CHA,
        MP: this.player.MP ?? 0,
        status: { ...(this.player.status ?? {}) },
        inventory: [...(this.player.inventory ?? [])],
      },
      enemy: {
        name: this.enemy.name,
        HP: this.enemy.HP,
        AC: this.enemy.AC,
        to_hit: this.enemy.to_hit,
        damage: this.enemy.damage,
        status: { ...(this.enemy.status ?? {}) },
      },
      actions: this.turn === "player" ? ["attack", "defend", "spell", "item", "flee"] : [],
    };
  }

  act(actionKey, arg = "") {
    this.log = [];

    if (this.ended) return this._result({ ok: false, error: "Combat already ended." });
    if (this.turn !== "player") return this._result({ ok: false, error: "Not your turn." });

    const a = (actionKey || "").toLowerCase().trim();
    const b = (arg || "").toLowerCase().trim();

    if (a === "attack") this._playerAttack();
    else if (a === "defend") this._playerDefend();
    else if (a === "spell") this._playerSpell(b || "fire");
    else if (a === "item") this._playerItem(b || "potion");
    else if (a === "flee") this._playerFlee();
    else return this._result({ ok: false, error: `Unknown combat action: ${actionKey}` });

    if (this.ended) return this._result({ ok: true });

    // enemy responds (single step)
    this.turn = "enemy";
    this._enemyTurn();
    if (!this.ended) this.turn = "player";

    return this._result({ ok: true });
  }

  _playerAttack() {
    const roll = d20();
    const total = roll + (this.player.to_hit ?? 0);
    const crit = roll === 20;
    const fumble = roll === 1;
    const hit = !fumble && (crit || total >= this.enemy.AC);
    let dmg = 0;

    if (hit) {
      dmg = rollDamage(this.player.damage);
      if (crit) dmg += rollDamage(this.player.damage);
      this.enemy.HP -= dmg;
    }

    this.log.push({
      type: "player_attack",
      roll,
      total,
      hit,
      crit,
      fumble,
      dmg,
      enemyHP: this.enemy.HP,
    });

    if (this.enemy.HP <= 0) this._end("player");
  }

  _playerDefend() {
    this.player.status.defending = 1;
    this.log.push({ type: "player_defend", text: "You brace for impact (Defend)." });
  }

  _playerSpell(spellName) {
    const mp = this.player.MP ?? 0;
    if (mp <= 0) {
      // NOTE: your UI currently doesn't print this type, but it's fine to keep.
      this.log.push({ type: "player_spell_fail", text: "No MP left!" });
      return;
    }

    this.player.MP = mp - 1;

    const roll = d20();
    let total = 0;
    let crit = false;
    let fumble = false;
    let hit = false;
    let dmg = 0;

    if (spellName === "fire") {
      total = roll + (this.player.INT ?? 0) + 2;
    } else if (spellName === "ice") {
      total = roll + (this.player.INT ?? 0);
    } else {
      this.player.MP += 1;
      this.log.push({ type: "player_spell_fail", text: `Unknown spell: ${spellName}. Try: fire, ice` });
      return;
    }

    crit = roll === 20;
    fumble = roll === 1;
    hit = !fumble && (crit || total >= this.enemy.AC);

    if (hit) {
      dmg =
        spellName === "fire"
          ? randInt(5, 12) + Math.floor((this.player.INT ?? 0) / 2)
          : randInt(3, 8);

      if (crit) dmg += randInt(spellName === "fire" ? 3 : 2, spellName === "fire" ? 8 : 6);

      this.enemy.HP -= dmg;

      if (spellName === "ice") this.enemy.status.slowed = 2;
    }

    this.log.push({
      type: "player_spell",
      spell: spellName.charAt(0).toUpperCase() + spellName.slice(1),
      roll,
      total,
      hit,
      crit,
      fumble,
      dmg,
      enemyHP: this.enemy.HP,
      mpLeft: this.player.MP,
    });

    if (this.enemy.HP <= 0) this._end("player");
  }

  _playerItem(itemName) {
    const inv = this.player.inventory ?? [];
    const idx = inv.findIndex((x) => x.toLowerCase() === itemName.toLowerCase());
    if (idx === -1) {
      this.log.push({ type: "player_item_fail", text: `No item: ${itemName}` });
      return;
    }

    if (itemName.toLowerCase() === "potion") {
      inv.splice(idx, 1);
      const heal = randInt(8, 12);
      this.player.HP += heal;
      this.log.push({ type: "player_item", item: "Potion", heal, playerHP: this.player.HP });
      return;
    }

    this.log.push({ type: "player_item_fail", text: `Item not usable yet: ${itemName}` });
  }

  _playerFlee() {
    const dc = 12 + Math.floor((this.enemy.AC ?? 10) / 5);
    const roll = d20();
    const total = roll + (this.player.CHA ?? 0);
    const success = total >= dc;

    this.log.push({ type: "player_flee", roll, total, dc, success });

    if (success) this._end("fled");
  }

  _enemyTurn() {
    if (this.ended) return;

    const slowed = this.enemy.status.slowed ?? 0;
    const toHit = (this.enemy.to_hit ?? 0) + (slowed > 0 ? -2 : 0);

    // 20% chance to taunt instead of attacking
    if (Math.random() < 0.2) {
      this.log.push({ type: "enemy_taunt", text: `${this.enemy.name} snarls and circles…` });
      if (slowed > 0) this.enemy.status.slowed = slowed - 1;
      return;
    }

    const roll = d20();
    const total = roll + toHit;
    const crit = roll === 20;
    const fumble = roll === 1;
    const hit = !fumble && (crit || total >= this.player.AC);
    let dmg = 0;

    if (hit) {
      dmg = rollDamage(this.enemy.damage);
      if (crit) dmg += rollDamage(this.enemy.damage);

      if ((this.player.status.defending ?? 0) > 0) {
        dmg = Math.floor(dmg / 2);
        delete this.player.status.defending;
      }

      this.player.HP -= dmg;
    }

    this.log.push({
      type: "enemy_attack",
      roll,
      total,
      hit,
      crit,
      fumble,
      dmg,
      playerHP: this.player.HP,
    });

    if (slowed > 0) this.enemy.status.slowed = slowed - 1;
    if (this.player.HP <= 0) this._end("enemy");
  }

  _end(winner) {
    this.ended = true;
    this.winner = winner;
    this.log.push({ type: "combat_end", winner });
  }

  _result(extra = {}) {
    return {
      ...extra,
      log: [...this.log],
      state: this.getPublicState(),
      ended: this.ended,
      winner: this.winner,
    };
  }
}

// Optional helper (not used by engine.js anymore, but you can keep it)
export function runCombat(player, enemy) {
  const combat = new CombatController(player, enemy);

  while (!combat.ended) {
    combat.act("attack");
    // enemy turn is invoked inside act() automatically
  }

  return {
    winnerName: combat.winner === "player" ? player.name : enemy.name,
    fled: combat.winner === "fled",
    turns: combat.log,
  };
}
