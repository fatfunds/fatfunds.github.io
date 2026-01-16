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
    setText("hud-area", "📍 —");
    setText("loc-name", "—");
    setText("loc-desc", "—");
    return;
  }

  setText("hud-area", `📍 ${area.name}`);
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
    addLog("☠ Run ended. Click Start Run to play again.", true);
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

// ---------- Sprite sheet config ----------
// Put your images in your repo, for example:
// assets/sprites/player/warrior_idle.png
// assets/sprites/player/warrior_attack.png
// assets/sprites/enemies/goblin_idle.png
// assets/sprites/enemies/goblin_attack.png

const SPRITES = {
  player: {
    Warrior: { idle: "assets/sprites/player/warrior_idle.png", attack: "assets/sprites/player/warrior_attack.png", w: 64, h: 64, frames: 6, speed: ".7s" },
    Cleric:  { idle: "assets/sprites/player/cleric_idle.png",  attack: "assets/sprites/player/cleric_attack.png",  w: 64, h: 64, frames: 6, speed: ".7s" },
    Wizard:  { idle: "assets/sprites/player/wizard_idle.png",  attack: "assets/sprites/player/wizard_attack.png",  w: 64, h: 64, frames: 6, speed: ".7s" },
    "Shambling Fool": { idle: "assets/sprites/player/fool_idle.png", attack: "assets/sprites/player/fool_attack.png", w: 64, h: 64, frames: 6, speed: ".7s" },
  },
  enemy: {
    Goblin:   { idle: "assets/sprites/enemies/goblin_idle.png",   attack: "assets/sprites/enemies/goblin_attack.png",   w: 64, h: 64, frames: 6, speed: ".7s" },
    Bandit:   { idle: "assets/sprites/enemies/bandit_idle.png",   attack: "assets/sprites/enemies/bandit_attack.png",   w: 64, h: 64, frames: 6, speed: ".7s" },
    Skeleton: { idle: "assets/sprites/enemies/skeleton_idle.png", attack: "assets/sprites/enemies/skeleton_attack.png", w: 64, h: 64, frames: 6, speed: ".7s" },
    Wolf:     { idle: "assets/sprites/enemies/wolf_idle.png",     attack: "assets/sprites/enemies/wolf_attack.png",     w: 64, h: 64, frames: 6, speed: ".7s" },
    "Cult Acolyte": { idle: "assets/sprites/enemies/cult_idle.png", attack: "assets/sprites/enemies/cult_attack.png", w: 64, h: 64, frames: 6, speed: ".7s" },
  }
};

function applySheet(el, img, meta) {
  if (!el) return;
  el.style.backgroundImage = `url("${img}")`;
  el.style.setProperty("--w", `${meta.w}px`);
  el.style.setProperty("--h", `${meta.h}px`);
  el.style.setProperty("--frames", String(meta.frames));
  el.style.setProperty("--speed", meta.speed);
}

function setSpriteIdle(playerClass, enemyType) {
  const pEl = $("player-sprite");
  const eEl = $("enemy-sprite");

  const pMeta = SPRITES.player[playerClass] ?? SPRITES.player.Warrior;
  const eMeta = SPRITES.enemy[enemyType] ?? SPRITES.enemy.Goblin;

  applySheet(pEl, pMeta.idle, pMeta);
  applySheet(eEl, eMeta.idle, eMeta);
}

function playSpriteAttack(who, playerClass, enemyType) {
  const el = who === "player" ? $("player-sprite") : $("enemy-sprite");
  if (!el) return;

  const meta = who === "player"
    ? (SPRITES.player[playerClass] ?? SPRITES.player.Warrior)
    : (SPRITES.enemy[enemyType] ?? SPRITES.enemy.Goblin);

  const img = who === "player" ? meta.attack : meta.attack;

  applySheet(el, img, meta);

  // Return to idle after a short delay
  window.setTimeout(() => {
    setSpriteIdle(playerClass, enemyType);
  }, 450);
}

// ---------- Combat flow ----------
let combatMax = { playerHP: 1, enemyHP: 1 };
let combatEnemyType = "Goblin";
let combatPlayerClass = "Warrior";

function beginCombatFromResolution(enemyObj) {
  // enemyObj is your generated enemy payload (HP/AC/to_hit/etc)
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
  showBattleUI(false);

  // Update side panel stats after combat
  const s = game.getState();
  renderPlayer(s.player);

  if (result.winner === "fled") {
    addLog("You escaped!", true);
    // After fleeing, just go next encounter
    const next = game.nextEncounter();
    renderEncounterPayload(next);
    combat = null;
    return;
  }

  if (result.winner === "player") {
    addLog("You won the fight!", true);
    const next = game.nextEncounter();
    renderEncounterPayload(next);
    combat = null;
    return;
  }

  // enemy wins
  addLog("☠ You were defeated. Type 'start' to try again.", true);
  setChoicesVisible(false);
  combat = null;
}

// Convert combat log into text
function printCombatLog(entries) {
  for (const e of entries) {
    if (e.type === "player_attack") {
      setBattleText(`You attack! ${e.hit ? `Hit for ${e.dmg}.` : "Miss!"}`);
      addLog(`You attack: d20=${e.roll} total=${e.total} ${e.hit ? `HIT (${e.dmg})` : "MISS"}`, true);
    } else if (e.type === "enemy_attack") {
      setBattleText(`${combat.enemy.name} attacks! ${e.hit ? `Hit for ${e.dmg}.` : "Miss!"}`);
      addLog(`Enemy attack: d20=${e.roll} total=${e.total} ${e.hit ? `HIT (${e.dmg})` : "MISS"}`, true);
    } else if (e.type === "player_defend") {
      setBattleText("You defend!");
      addLog(e.text, true);
    } else if (e.type === "player_spell") {
      setBattleText(`${e.spell}! ${e.hit ? `Deals ${e.dmg}.` : "Fails!"}`);
      addLog(`Spell ${e.spell}: ${e.hit ? `HIT (${e.dmg})` : "MISS"} (MP ${e.mpLeft})`, true);
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

  const before = combat.getPublicState();

  // play attack animation immediately for feel
  if (actionKey === "attack") playSpriteAttack("player", combatPlayerClass, combatEnemyType);
  if (actionKey === "spell") playSpriteAttack("player", combatPlayerClass, combatEnemyType);

  const result = combat.act(actionKey, arg);

  const after = result.state;

  // update bars
  setHPBar("player-hp", after.player.HP, combatMax.playerHP);
  setHPBar("enemy-hp", after.enemy.HP, combatMax.enemyHP);

  printCombatLog(result.log);

  // enemy attacked? play enemy attack anim if their turn produced an attack
  if (result.log.some(x => x.type === "enemy_attack")) {
    playSpriteAttack("enemy", combatPlayerClass, combatEnemyType);
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
    // allow: attack, defend, run, flee, item potion, spell fire
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
