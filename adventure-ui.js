// =========================
// FILE: adventure-ui.js
// Hooks AdventureEngine -> HUD + Battle UI
// =========================

import { AdventureEngine } from "./engine.js";
import { CombatController } from "./Combat.js";

const game = new AdventureEngine();
let combat = null; // CombatController when in battle

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function addLog(text, dim = false) {
  const log = $("hud-log");
  if (!log) return;

  const line = document.createElement("div");
  line.className = "log-line" + (dim ? " dim" : "");
  line.textContent = text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  const log = $("hud-log");
  if (log) log.innerHTML = "";
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// ---------- HUD render ----------
function renderPlayer(p) {
  if (!p) {
    setText("s-name", "—");
    setText("s-class", "—");
    setText("s-hp", "—");
    setText("s-ac", "—");
    setText("s-tohit", "—");
    setText("s-dmg", "—");
    setText("s-str", "—");
    setText("s-int", "—");
    setText("s-cha", "—");
    setText("s-status", "—");
    return;
  }

  setText("s-name", p.name);
  setText("s-class", p.class);
  setText("s-hp", String(p.HP));
  setText("s-ac", String(p.AC));
  setText("s-tohit", `+${p.to_hit}`);
  setText("s-dmg", `${p.damage[0]}-${p.damage[1]}`);
  setText("s-str", String(p.STR));
  setText("s-int", String(p.INT));
  setText("s-cha", String(p.CHA));

  const statusKeys = Object.keys(p.status ?? {});
  setText("s-status", statusKeys.length ? statusKeys.map(k => `${k}(${p.status[k]})`).join(", ") : "—");
}

function renderLocation(area) {
  if (!area) {
    setText("hud-area", " —");
    setText("loc-name", "—");
    setText("loc-desc", "—");
    return;
  }

  setText("hud-area", ` ${area.name}`);
  setText("loc-name", area.name);
  setText("loc-desc", area.description);
}

function setChoicesVisible(visible) {
  const wrap = $("hud-choices");
  if (!wrap) return;
  wrap.hidden = !visible;
}

function renderChoices(choices) {
  if (!choices || choices.length < 2) {
    setChoicesVisible(false);
    return;
  }

  setChoicesVisible(true);

  const c1 = choices[0];
  const c2 = choices[1];

  const b1 = $("choice-1");
  const b2 = $("choice-2");

  if (b1) b1.textContent = `1) ${c1.text}  [${c1.stat} DC ${c1.dc}]`;
  if (b2) b2.textContent = `2) ${c2.text}  [${c2.stat} DC ${c2.dc}]`;

  b1.dataset.choice = "1";
  b2.dataset.choice = "2";
}

function renderEncounterPayload(payload) {
  setText("hud-encounters", String(payload.encounterNumber));
  renderLocation(payload.area);
  renderPlayer(payload.player);

  addLog(`Encounter #${payload.encounterNumber} — ${payload.area.name}`, true);
  addLog(payload.encounter.text);

  renderChoices(payload.choices);
}

function renderResolutionPayload(payload) {
  const r = payload.roll;
  addLog(`You chose: ${payload.choice.text}`, true);
  addLog(`${payload.choice.stat} check: d20=${r.d20} + ${r.mod} = ${r.total} vs DC ${payload.choice.dc} → ${r.success ? "SUCCESS" : "FAIL"}`);
  addLog(payload.message);

  if (payload.repChange) addLog(`Reputation: ${payload.repChange.faction} ${payload.repChange.delta > 0 ? "+" : ""}${payload.repChange.delta}`, true);
  if (payload.statusApplied) addLog(`Status: ${payload.statusApplied.key} now ${payload.statusApplied.newValue}`, true);

  // Update stats after resolution
  const state = game.getState();
  renderPlayer(state.player);

  // If combat gets triggered, we DO NOT auto-next encounter.
  // We open battle overlay and let the player fight first.
  if (payload.triggerCombat && payload.combat) {
    beginCombatFromResolution(payload.combat.enemy);
    return;
  }

  if (payload.runEnded) {
    addLog("Run ended. Click Start Run to play again.", true);
    setChoicesVisible(false);
    return;
  }

  addLog("—", true);
  const next = game.nextEncounter();
  renderEncounterPayload(next);
}

// ---------- Battle UI helpers ----------
function showBattleUI(show) {
  const panel = $("battle-panel");
  if (!panel) return;

  panel.classList.toggle("hidden", !show);
  panel.setAttribute("aria-hidden", show ? "false" : "true");

  // Optional: dim/lock the HUD input during combat
  $("hud-input") && ($("hud-input").disabled = show);
  $("hud-send") && ($("hud-send").disabled = show);
}

function setHPBar(fillId, current, max) {
  const el = $(fillId);
  if (!el) return;
  const pct = max <= 0 ? 0 : clamp01(current / max);
  el.style.width = `${Math.round(pct * 100)}%`;
}

function setBattleText(text) {
  setText("battle-text", text);
}


const SPRITES = {
  player: {
    Warrior: {
      idle:   { img: "assets/sprites/player/warrior_idle.png",  w: 64, h: 64, frames: 6, speed: ".7s" },
      attack: { img: "assets/sprites/player/warrior_attack.png",w: 64, h: 64, frames: 6, speed: ".6s" },
      hurt:   { img: "assets/sprites/player/warrior_hurt.png",  w: 64, h: 64, frames: 4, speed: ".3s" },
      death:  { img: "assets/sprites/player/warrior_death.png", w: 64, h: 64, frames: 6, speed: ".9s" },
    },
    Cleric: {
      idle:   { img: "assets/sprites/player/cleric_idle.png",   w: 64, h: 64, frames: 6, speed: ".7s" },
      attack: { img: "assets/sprites/player/cleric_attack.png", w: 64, h: 64, frames: 6, speed: ".6s" },
      hurt:   { img: "assets/sprites/player/cleric_hurt.png",   w: 64, h: 64, frames: 4, speed: ".3s" },
      death:  { img: "assets/sprites/player/cleric_death.png",  w: 64, h: 64, frames: 6, speed: ".9s" },
    },
    Wizard: {
      idle:   { img: "assets/sprites/player/wizard_idle.png",   w: 64, h: 64, frames: 6, speed: ".7s" },
      attack: { img: "assets/sprites/player/wizard_attack.png", w: 64, h: 64, frames: 6, speed: ".6s" },
      hurt:   { img: "assets/sprites/player/wizard_hurt.png",   w: 64, h: 64, frames: 4, speed: ".3s" },
      death:  { img: "assets/sprites/player/wizard_death.png",  w: 64, h: 64, frames: 6, speed: ".9s" },
    },
    "Shambling Fool": {
      idle:   { img: "assets/sprites/player/fool_idle.png",     w: 64, h: 64, frames: 6, speed: ".7s" },
      attack: { img: "assets/sprites/player/fool_attack.png",   w: 64, h: 64, frames: 6, speed: ".6s" },
      hurt:   { img: "assets/sprites/player/fool_hurt.png",     w: 64, h: 64, frames: 4, speed: ".3s" },
      death:  { img: "assets/sprites/player/fool_death.png",    w: 64, h: 64, frames: 6, speed: ".9s" },
    },
  },

  enemy: {
    Goblin: {
      idle:   { img: "Assets/goblin-idle.png",  w: 160, h: 128, frames: 6,  speed: "1s" },
      attack: { img: "Assets/goblin-atk1.png",  w: 160, h: 128, frames: 11, speed: "1s" },
      hurt:   { img: "Assets/goblin-hurt.png",  w: 160, h: 128, frames: 8,  speed: "1s" },
      death:  { img: "Assets/goblin-death.png", w: 160, h: 128, frames: 10, speed: "1s" },
    },

    "Cult Acolyte": {
      idle:   { img: "Assets/cultist-idle.png",  w: 220, h: 220, frames: 8, speed: "1s" },
      attack: { img: "Assets/cultist-atk.png",   w: 220, h: 220, frames: 16, speed: "1s" },
      hurt:   { img: "Assets/cultist-hurt.png",  w: 220, h: 220, frames: 8, speed: "1s" },
      death:  { img: "Assets/cultist-death.png", w: 220, h: 220, frames: 13, speed: "1s" },
    },

    Skeleton: {
      idle:   { img: "Assets/skeleton-variation1-idle.png",   w: 128, h: 128, frames: 7, speed: "1s" },
      attack: { img: "Assets/skeleton-variation1-attack.png", w: 128, h: 128, frames: 17, speed: "1s" },
      hurt:   { img: "Assets/skeleton-variation1-hurt.png",   w: 128, h: 128, frames: 11, speed: "1s" },
      death:  { img: "Assets/skeleton-variation1-death.png",  w: 128, h: 128, frames: 13, speed: "1s" },
    },


    Viper: {
      idle:   { img: "Assets/viper-idle.png",   w: 96, h: 96, frames: 8, speed: "1s" },
      attack: { img: "Assets/viper-attack.png", w: 96, h: 96, frames: 9, speed: "1s" },
      hurt:   { img: "Assets/viper-hurt.png",   w: 96, h: 96, frames: 6, speed: "1s" },
      death:  { img: "Assets/viper-death.png",  w: 96, h: 96, frames: 9, speed: "1s" },
    },


    Zombie: {
      idle:   { img: "Assets/zombie-idle.png",  w: 96, h: 96, frames: 8, speed: "1s" },
      attack: { img: "Assets/zombie-atk.png",   w: 96, h: 96, frames: 18, speed: "1s" },
      hurt:   { img: "Assets/zombie-hurt.png",  w: 96, h: 96, frames: 9, speed: "1s" },
      death:  { img: "Assets/zombie-death.png", w: 96, h: 96, frames: 12, speed: "1s" },
    },
  }
};

function applySheet(el, anim) {
  if (!el || !anim) return;
  el.style.backgroundImage = `url("${anim.img}")`;
  el.style.setProperty("--w", `${anim.w}px`);
  el.style.setProperty("--h", `${anim.h}px`);
  el.style.setProperty("--frames", String(anim.frames));
  el.style.setProperty("--speed", anim.speed);
}

function getAnim(who, playerClass, enemyType, animName) {
  if (who === "player") {
    const set = SPRITES.player[playerClass] ?? SPRITES.player.Warrior;
    return set[animName] ?? set.idle;
  } else {
    const set = SPRITES.enemy[enemyType] ?? SPRITES.enemy.Goblin;
    return set[animName] ?? set.idle;
  }
}

// Track timeouts so animations don’t fight each other
const spriteTimers = { player: null, enemy: null };
// Lock state (prevents returning to idle, used for death)
const spriteLocked = { player: false, enemy: false };

function setSpriteIdle(playerClass, enemyType) {
  spriteLocked.player = false;
  spriteLocked.enemy = false;

  applySheet($("player-sprite"), getAnim("player", playerClass, enemyType, "idle"));
  applySheet($("enemy-sprite"),  getAnim("enemy",  playerClass, enemyType, "idle"));
}

function playSpriteAnim(who, animName, playerClass, enemyType, holdMs = 350, opts = {}) {
  const { returnToIdle = true, lock = false } = opts;

  const el = who === "player" ? $("player-sprite") : $("enemy-sprite");
  if (!el) return;

  // if locked (dead), don't override
  if (spriteLocked[who]) return;

  // cancel previous timer
  if (spriteTimers[who]) window.clearTimeout(spriteTimers[who]);

  applySheet(el, getAnim(who, playerClass, enemyType, animName));

  if (lock) {
    spriteLocked[who] = true;
    spriteTimers[who] = null;
    return;
  }

  if (!returnToIdle) return;

  spriteTimers[who] = window.setTimeout(() => {
    if (spriteLocked[who]) return;

    applySheet(el, getAnim(who, playerClass, enemyType, "idle"));
    spriteTimers[who] = null;
  }, holdMs);
}

// ---------- Combat flow ----------
let combatMax = { playerHP: 1, enemyHP: 1 };
let combatEnemyType = "Goblin";
let combatPlayerClass = "Warrior";

function beginCombatFromResolution(enemyObj) {
  const state = game.getState();
  if (!state.player) return;

  combat = new CombatController(game.player ?? state.player, enemyObj); // playerRef (same object)
  const pub = combat.getPublicState();

  combatMax.playerHP = pub.player.HP;
  combatMax.enemyHP = pub.enemy.HP;

  combatEnemyType = enemyObj.type ?? "Goblin";
  combatPlayerClass = pub.player?.class ?? "Warrior";

  setText("player-name", pub.player.name);
  setText("enemy-name", pub.enemy.name);

  setHPBar("player-hp", pub.player.HP, combatMax.playerHP);
  setHPBar("enemy-hp", pub.enemy.HP, combatMax.enemyHP);

  setSpriteIdle(combatPlayerClass, combatEnemyType);

  setBattleText(`A wild ${enemyObj.type ?? "enemy"} appears!`);
  showBattleUI(true);

  addLog(`⚔ Combat begins: ${pub.enemy.name}`, true);
}

function endCombatAndReturnToStory(result) {
  // result is CombatController._result() payload from Combat.js :contentReference[oaicite:1]{index=1}

  // Update side panel stats after combat
  const s = game.getState();
  renderPlayer(s.player);

  // Flee
  if (result.winner === "fled") {
    showBattleUI(false);
    addLog("You escaped!", true);
    const next = game.nextEncounter();
    renderEncounterPayload(next);
    combat = null;
    return;
  }

  // Player victory → play enemy death, then close
  if (result.winner === "player") {
    playSpriteAnim("enemy", "death", combatPlayerClass, combatEnemyType, 0, { lock: true, returnToIdle: false });
    setBattleText(`${combat.enemy.name} falls!`);

    window.setTimeout(() => {
      showBattleUI(false);
      addLog("You won the fight!", true);
      const next = game.nextEncounter();
      renderEncounterPayload(next);
      combat = null;
    }, 900);

    return;
  }

  // Enemy victory → play player death, then close
  playSpriteAnim("player", "death", combatPlayerClass, combatEnemyType, 0, { lock: true, returnToIdle: false });
  setBattleText("You collapse...");

  window.setTimeout(() => {
    showBattleUI(false);
    addLog("You were defeated. Type 'start' to try again.", true);
    setChoicesVisible(false);
    combat = null;
  }, 900);
}

// Convert combat log into text + trigger hurt anims
function printCombatLog(entries) {
  for (const e of entries) {
    if (e.type === "player_attack") {
      setBattleText(`You attack! ${e.hit ? `Hit for ${e.dmg}.` : "Miss!"}`);
      addLog(`You attack: d20=${e.roll} total=${e.total} ${e.hit ? `HIT (${e.dmg})` : "MISS"}`, true);

      // Enemy hurt on hit
      if (e.hit) playSpriteAnim("enemy", "hurt", combatPlayerClass, combatEnemyType, 260);

    } else if (e.type === "enemy_attack") {
      setBattleText(`${combat.enemy.name} attacks! ${e.hit ? `Hit for ${e.dmg}.` : "Miss!"}`);
      addLog(`Enemy attack: d20=${e.roll} total=${e.total} ${e.hit ? `HIT (${e.dmg})` : "MISS"}`, true);

      // Player hurt on hit
      if (e.hit) playSpriteAnim("player", "hurt", combatPlayerClass, combatEnemyType, 260);

    } else if (e.type === "player_defend") {
      setBattleText("You defend!");
      addLog(e.text, true);

    } else if (e.type === "player_spell") {
      setBattleText(`${e.spell}! ${e.hit ? `Deals ${e.dmg}.` : "Fails!"}`);
      addLog(`Spell ${e.spell}: ${e.hit ? `HIT (${e.dmg})` : "MISS"} (MP ${e.mpLeft})`, true);

      // Enemy hurt on hit
      if (e.hit) playSpriteAnim("enemy", "hurt", combatPlayerClass, combatEnemyType, 260);

    } else if (e.type === "player_item") {
      setBattleText(`You use a Potion (+${e.heal} HP).`);
      addLog(`Potion heals ${e.heal}.`, true);

    } else if (e.type === "player_flee") {
      setBattleText(e.success ? "You got away!" : "Can't escape!");
      addLog(`Flee: ${e.total} vs DC ${e.dc} → ${e.success ? "SUCCESS" : "FAIL"}`, true);

    } else if (e.type === "enemy_taunt") {
      setBattleText(e.text);
      addLog(e.text, true);

    } else if (e.type === "combat_end") {
      // handled elsewhere
    }
  }
}

function runCombatAction(actionKey, arg = "") {
  if (!combat) return;

  // feel: play player attack/spell immediately (before results)
  if (actionKey === "attack") playSpriteAnim("player", "attack", combatPlayerClass, combatEnemyType, 350);
  if (actionKey === "spell") playSpriteAnim("player", "attack", combatPlayerClass, combatEnemyType, 350);

  const result = combat.act(actionKey, arg);
  const after = result.state;

  // update bars
  setHPBar("player-hp", after.player.HP, combatMax.playerHP);
  setHPBar("enemy-hp", after.enemy.HP, combatMax.enemyHP);

  printCombatLog(result.log);

  // if enemy attacked in this step, play enemy attack anim
  if (result.log.some(x => x.type === "enemy_attack")) {
    playSpriteAnim("enemy", "attack", combatPlayerClass, combatEnemyType, 350);
  }

  if (result.ended) {
    endCombatAndReturnToStory(result);
  }
}

// ---------- Command handling ----------
function handleCommand(raw) {
  const cmd = raw.trim();
  if (!cmd) return;

  addLog(`> ${cmd}`, true);
  const lower = cmd.toLowerCase();

  // If in combat, route combat commands
  if (combat && combat.getPublicState().active) {
    if (lower === "attack") return runCombatAction("attack");
    if (lower === "defend") return runCombatAction("defend");
    if (lower === "run" || lower === "flee") return runCombatAction("flee");

    if (lower.startsWith("spell")) {
      const parts = lower.split(/\s+/);
      return runCombatAction("spell", parts[1] || "fire");
    }
    if (lower.startsWith("item")) {
      const parts = lower.split(/\s+/);
      return runCombatAction("item", parts[1] || "potion");
    }

    addLog("Combat commands: attack, defend, spell fire|ice, item potion, run", true);
    return;
  }

  // Story commands
  if (lower === "help") {
    addLog("Commands: start [1-4], stats, areas, travel <roads|chapel|marsh>, reset");
    addLog("During combat: attack, defend, spell fire|ice, item potion, run");
    return;
  }

  if (lower.startsWith("start")) {
    clearLog();

    const parts = lower.split(/\s+/);
    let classChoice = parts[1] ? Number(parts[1]) : NaN;
    if (!Number.isFinite(classChoice) || classChoice < 1 || classChoice > 4) {
      classChoice = Math.floor(Math.random() * 4) + 1;
    }

    addLog(`Starting new run… (Class ${classChoice})`, true);

    const payload = game.startRun({ nameInput: "", classChoice, areaKey: "roads" });
    renderEncounterPayload(payload);
    return;
  }

  if (lower === "stats") {
    const s = game.getState();
    addLog(`Stats: HP ${s.player?.HP ?? "—"} | AC ${s.player?.AC ?? "—"} | STR ${s.player?.STR ?? "—"} | INT ${s.player?.INT ?? "—"} | CHA ${s.player?.CHA ?? "—"}`, true);
    return;
  }

  if (lower === "areas") {
    const areas = game.listAreas();
    addLog("Areas: " + areas.map(a => a.key).join(", "));
    return;
  }

  if (lower.startsWith("travel ")) {
    const key = lower.split(/\s+/)[1];
    try {
      const payload = game.travelTo(key);
      renderEncounterPayload(payload);
    } catch {
      addLog(`Unknown area: ${key}. Try: roads, chapel, marsh`);
    }
    return;
  }

  if (lower === "reset") {
    game.reset();
    combat = null;
    clearLog();
    renderPlayer(null);
    renderLocation(null);
    setText("hud-encounters", "0");
    setChoicesVisible(false);
    showBattleUI(false);
    addLog("Reset complete. Type “start” to begin.", true);
    return;
  }

  addLog("Unknown command. Type 'help'.", true);
}

// ---------- Wire up events ----------
document.addEventListener("DOMContentLoaded", () => {
  // Buttons
  $("btn-start")?.addEventListener("click", () => handleCommand("start"));
  $("btn-reset")?.addEventListener("click", () => handleCommand("reset"));

  $("hud-send")?.addEventListener("click", () => handleCommand($("hud-input")?.value ?? ""));
  $("hud-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCommand($("hud-input")?.value ?? "");
  });

  // Choice buttons (story)
  $("choice-1")?.addEventListener("click", () => {
    try {
      const payload = game.pickChoice(1);
      renderResolutionPayload(payload);
    } catch {
      addLog("No active encounter. Type 'start'.", true);
    }
  });

  $("choice-2")?.addEventListener("click", () => {
    try {
      const payload = game.pickChoice(2);
      renderResolutionPayload(payload);
    } catch {
      addLog("No active encounter. Type 'start'.", true);
    }
  });

  // Battle command buttons
  $("cmd-attack")?.addEventListener("click", () => runCombatAction("attack"));
  $("cmd-skill")?.addEventListener("click", () => runCombatAction("spell", "fire"));
  $("cmd-item")?.addEventListener("click", () => runCombatAction("item", "potion"));
  $("cmd-run")?.addEventListener("click", () => runCombatAction("flee"));

  // Initial UI defaults
  renderPlayer(null);
  renderLocation(null);
  setChoicesVisible(false);
  showBattleUI(false);
});
