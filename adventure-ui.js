// =========================
// FILE: combat-controller.js
// Step-based "FF-lite" turn combat
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
    // We mutate playerRef HP directly (so engine/player stays in sync)
    this.player = playerRef;
    this.enemy = enemy;

    this.turn = "player"; // "player" | "enemy"
    this.ended = false;
    this.winner = null; // "player" | "enemy" | "fled"

    // very small resources / statuses
    this.player.status = this.player.status ?? {};
    this.player.MP = this.player.MP ?? 3;            // starter MP
    this.player.inventory = this.player.inventory ?? ["potion"]; // starter item

    this.enemy.status = this.enemy.status ?? {};

    this.log = []; // events since last action
  }

  getPublicState() {
    return {
      active: !this.ended,
      turn: this.turn,
      player: {
        name: this.player.name,
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
      actions: this.turn === "player"
        ? ["attack", "defend", "spell", "item", "flee"]
        : [],
    };
  }

  // --- main entry ---
  act(actionKey, arg = "") {
    this.log = [];

    if (this.ended) {
      return this._result({ ok: false, error: "Combat already ended." });
    }
    if (this.turn !== "player") {
      return this._result({ ok: false, error: "Not your turn." });
    }

    const a = (actionKey || "").toLowerCase().trim();
    const b = (arg || "").toLowerCase().trim();

    // Player turn
    if (a === "attack") this._playerAttack();
    else if (a === "defend") this._playerDefend();
    else if (a === "spell") this._playerSpell(b || "fire");
    else if (a === "item") this._playerItem(b || "potion");
    else if (a === "flee") this._playerFlee();
    else return this._result({ ok: false, error: `Unknown combat action: ${actionKey}` });

    // If player ended it, stop
    if (this.ended) return this._result({ ok: true });

    // Enemy turn
    this.turn = "enemy";
    this._enemyTurn();

    // End checks
    if (!this.ended) this.turn = "player";

    // Small regen spice: +1 MP every 3 rounds? (optional later)
    return this._result({ ok: true });
  }

  // --- actions ---
  _playerAttack() {
    const roll = d20();
    const total = roll + (this.player.to_hit ?? 0);
    const crit = roll === 20;
    const fumble = roll === 1;

    let hit = !fumble && (crit || total >= this.enemy.AC);
    let dmg = 0;

    if (hit) {
      dmg = rollDamage(this.player.damage);
      if (crit) dmg += rollDamage(this.player.damage); // simple crit = double roll
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
    this.player.status.defending = 1; // reduces next enemy hit
    this.log.push({ type: "player_defend", text: "You brace for impact (Defend)." });
  }

  _playerSpell(spellName) {
    const mp = this.player.MP ?? 0;
    if (mp <= 0) {
      this.log.push({ type: "player_spell_fail", text: "No MP left!" });
      return;
    }

    this.player.MP = mp - 1;

    // Simple spells (easy to expand)
    if (spellName === "fire") {
      // high damage, standard hit check using INT as bonus
      const roll = d20();
      const total = roll + (this.player.INT ?? 0) + 2;
      const hit = roll !== 1 && (roll === 20 || total >= this.enemy.AC);
      let dmg = 0;

      if (hit) {
        dmg = randInt(5, 12) + Math.floor((this.player.INT ?? 0) / 2);
        this.enemy.HP -= dmg;
      }

      this.log.push({ type: "player_spell", spell: "Fire", roll, total, hit, dmg, enemyHP: this.enemy.HP, mpLeft: this.player.MP });

      if (this.enemy.HP <= 0) this._end("player");
      return;
    }

    if (spellName === "ice") {
      // lower dmg but can "slow" (enemy -2 to_hit for 2 turns)
      const roll = d20();
      const total = roll + (this.player.INT ?? 0);
      const hit = roll !== 1 && (roll === 20 || total >= this.enemy.AC);
      let dmg = 0;

      if (hit) {
        dmg = randInt(3, 8);
        this.enemy.HP -= dmg;
        this.enemy.status.slowed = 2;
      }

      this.log.push({ type: "player_spell", spell: "Ice", roll, total, hit, dmg, enemyHP: this.enemy.HP, mpLeft: this.player.MP });

      if (this.enemy.HP <= 0) this._end("player");
      return;
    }

    // Unknown spell: refund MP
    this.player.MP += 1;
    this.log.push({ type: "player_spell_fail", text: `Unknown spell: ${spellName}. Try: fire, ice` });
  }

  _playerItem(itemName) {
    const inv = this.player.inventory ?? [];
    const idx = inv.findIndex(x => x.toLowerCase() === itemName.toLowerCase());
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
    // CHA check vs DC based on enemy "power"
    const dc = 12 + Math.floor((this.enemy.AC ?? 10) / 5);
    const roll = d20();
    const total = roll + (this.player.CHA ?? 0);
    const success = total >= dc;

    this.log.push({ type: "player_flee", roll, total, dc, success });

    if (success) this._end("fled");
  }

  _enemyTurn() {
    if (this.ended) return;

    // If slowed, reduce to_hit
    const slow = this.enemy.status.slowed ?? 0;
    if (slow > 0) this.enemy.status.slowed = slow - 1;

    // Basic enemy behavior: 80% attack, 20% "snarl" (no dmg)
    if (Math.random() < 0.2) {
      this.log.push({ type: "enemy_taunt", text: `${this.enemy.name} snarls and circles…` });
      return;
    }

    const roll = d20();
    let toHit = (this.enemy.to_hit ?? 0);
    if ((this.enemy.status.slowed ?? 0) > 0) toHit -= 2;

    const total = roll + toHit;
    const crit = roll === 20;
    const fumble = roll === 1;

    const hit = !fumble && (crit || total >= this.player.AC);
    let dmg = 0;

    if (hit) {
      dmg = rollDamage(this.enemy.damage);
      if (crit) dmg += rollDamage(this.enemy.damage);

      // Defend halves dmg once
      if ((this.player.status.defending ?? 0) > 0) {
        dmg = Math.max(0, Math.floor(dmg / 2));
        delete this.player.status.defending;
      }

      this.player.HP -= dmg;
    } else {
      // Defend still wears off after an enemy swing? optional:
      // if ((this.player.status.defending ?? 0) > 0) delete this.player.status.defending;
    }

    function showBattleUI(show) {
  const panel = document.getElementById("battle-panel");
  if (!panel) return;

  panel.classList.toggle("hidden", !show);
  panel.setAttribute("aria-hidden", show ? "false" : "true");

  const adventure = document.getElementById("adventure");
  if (adventure) adventure.classList.toggle("battle-active", show);
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
