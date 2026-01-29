// =========================
// FILE: adventure-ui.js
// Hooks AdventureEngine -> HUD + Battle UI
// + Character Creation Wizard (stat points + pick 4 basic moves)
// =========================

import { AdventureEngine } from "./engine.js";
import { CombatController } from "./Combat.js";
import {
  DEFAULT_ATTACKS_BY_CLASS,
  DEFAULT_ABILITIES_BY_CLASS,
  getMoveById,
  getMovesByKind,
  getBasicMovePoolForClass,
  MoveKind
} from "./Moves.js";
import {
  CLASSES,
  makeCharacterDraft,
  allocateStatPoints,
  chooseBasicMoves,
} from "./Character.js";


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

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---------- Pool normalization (fixes SP 0/0 when engine drops fields) ----------
const CLASS_DEFAULTS_BY_NAME = (() => {
  const map = {};
  for (const cfg of Object.values(CLASSES)) {
    map[cfg.class_name] = cfg.combat;
  }
  return map;
})();

function normalizePools(p) {
  if (!p) return p;

  const combatDefaults = CLASS_DEFAULTS_BY_NAME[p.class] ?? null;

  const spMissing =
    (p.maxSP == null || !Number.isFinite(Number(p.maxSP))) &&
    (p.SP == null || !Number.isFinite(Number(p.SP)));

  const mpMissing =
    (p.maxMP == null || !Number.isFinite(Number(p.maxMP))) &&
    (p.MP == null || !Number.isFinite(Number(p.MP)));

  if (spMissing) {
    const d = combatDefaults?.SP ?? 0;
    p.maxSP = d;
    p.SP = d;
  }
  if (mpMissing) {
    const d = combatDefaults?.MP ?? 0;
    p.maxMP = d;
    p.MP = d;
  }

  p.maxSP = Math.max(0, toNum(p.maxSP, toNum(p.SP, 0)));
  p.maxMP = Math.max(0, toNum(p.maxMP, toNum(p.MP, 0)));

  p.SP = clamp(toNum(p.SP, p.maxSP), 0, p.maxSP);
  p.MP = clamp(toNum(p.MP, p.maxMP), 0, p.maxMP);

  return p;
}

// ---------- Character Creation Wizard ----------
const creation = {
  active: false,
  classChoice: 1,
  draft: null,
  picked: new Set(),
};

function startCreationFlow(classChoice, nameInput = "") {
  creation.active = true;
  creation.classChoice = classChoice;
  creation.draft = makeCharacterDraft(nameInput, classChoice);
  creation.picked = new Set();

  clearLog();
  addLog("=== CHARACTER CREATION ===", true);
  addLog(`Class: ${creation.draft.class}`, true);
  addLog(`Unspent stat points: ${creation.draft.unspentStatPoints}`, true);
  addLog("Commands:", true);
  addLog("  name <your name>", true);
  addLog("  add <str|dex|con|int|cha> [n]", true);
  addLog("  pool  (shows move pool)", true);
  addLog("  pick <moveId>  (toggle pick; need 4)", true);
  addLog("  picks (shows current picks)", true);
  addLog("  auto  (auto-spend points + pick 4)", true);
  addLog("  done  (start run once points=0 and picks=4)", true);
  addLog("  cancel", true);

  renderPlayer(creation.draft);
}

function listPoolForDraft() {
  const d = creation.draft;
  if (!d) return;

  const ids = getBasicMovePoolForClass(d.class);
  addLog(`=== ${d.class} BASIC MOVE POOL ===`, true);
  for (const id of ids) {
    const m = getMoveById(id);
    if (!m) {
      addLog(`- ${id} (missing in MOVES)`, true);
      continue;
    }
    const cost = m.cost ? `${m.cost.pool} ${m.cost.amount}` : "—";
    addLog(`- ${m.id}: ${m.name} [${m.kind}] (cost ${cost}) — ${m.description}`, true);
  }
}

function showPicks() {
  const d = creation.draft;
  if (!d) return;

  const arr = [...creation.picked];
  addLog(`Picked (${arr.length}/4): ${arr.length ? arr.join(", ") : "—"}`, true);
  for (const id of arr) {
    const m = getMoveById(id);
    if (m) addLog(`  • ${m.name}: ${m.description}`, true);
  }
}

function togglePick(moveIdRaw) {
  const d = creation.draft;
  if (!d) return;

  const moveId = String(moveIdRaw ?? "").trim();
  if (!moveId) return;

  const pool = new Set(getBasicMovePoolForClass(d.class));
  if (!pool.has(moveId)) {
    addLog(`That move isn't in your class pool: ${moveId}`, true);
    return;
  }

  const m = getMoveById(moveId);
  if (!m) {
    addLog(`Unknown move id: ${moveId}`, true);
    return;
  }

  if (creation.picked.has(moveId)) {
    creation.picked.delete(moveId);
    addLog(`Unpicked: ${m.name}`, true);
    return;
  }

  if (creation.picked.size >= 4) {
    addLog("You already picked 4. Unpick one first.", true);
    return;
  }

  creation.picked.add(moveId);
  addLog(`Picked: ${m.name}`, true);
}

function autoBuildCharacter() {
  const d = creation.draft;
  if (!d) return;

  // simple auto-spend: prioritize class flavor
  const cls = d.class;

  const spendAll = () => {
    let tries = 50;
    while ((d.unspentStatPoints ?? 0) > 0 && tries-- > 0) {
      if (cls === "Warrior") allocateStatPoints(d, { STR: 1 });
      else if (cls === "Wizard") allocateStatPoints(d, { INT: 1 });
      else if (cls === "Cleric") allocateStatPoints(d, { CON: 1 });
      else allocateStatPoints(d, { DEX: 1 });

      // sprinkle some CON so people don't explode
      if ((d.unspentStatPoints ?? 0) > 0) allocateStatPoints(d, { CON: 1 });
    }
  };

  spendAll();

  // auto-pick 4: prefer attacks first, then 1 defensive/support
  creation.picked.clear();
  const pool = getBasicMovePoolForClass(d.class)
    .filter((id) => !!getMoveById(id));

  const attacks = pool.filter((id) => getMoveById(id)?.kind === MoveKind.Attack);
  const buffs = pool.filter((id) => getMoveById(id)?.kind === MoveKind.Buff);
  const heals = pool.filter((id) => getMoveById(id)?.kind === MoveKind.Heal);
  const debuffs = pool.filter((id) => getMoveById(id)?.kind === MoveKind.Debuff);

  const pickOrder = [
    ...attacks,
    ...debuffs,
    ...buffs,
    ...heals,
    ...pool,
  ];

  for (const id of pickOrder) {
    if (creation.picked.size >= 4) break;
    creation.picked.add(id);
  }

  addLog("Auto-build complete.", true);
  addLog(`Unspent stat points: ${d.unspentStatPoints}`, true);
  showPicks();
  renderPlayer(d);
}

function finalizeAndStartRun() {
  const d = creation.draft;
  if (!d) return;

  const points = Number(d.unspentStatPoints ?? 0);
  if (points !== 0) {
    addLog(`Spend all stat points first. Remaining: ${points}`, true);
    return;
  }

  if (creation.picked.size !== 4) {
    addLog(`Pick exactly 4 moves. Currently: ${creation.picked.size}/4`, true);
    return;
  }

  const pickedIds = [...creation.picked];
  const ok = chooseBasicMoves(d, pickedIds);
  if (!ok) {
    addLog("Move selection failed validation. Check pool + move ids.", true);
    return;
  }

  const classChoice = creation.classChoice;
  const nameInput = d.name;

  addLog("Starting run with your custom character…", true);

  try {
    let payload = game.startRun({ nameInput, classChoice, areaKey: "roads" });

    if (!payload || !payload.player) {
      throw new Error("startRun returned no payload/player");
    }


    if (!game.player) throw new Error("game.player missing after startRun()");
    Object.assign(game.player, d);

    game.player.attacks = pickedIds.slice();
    game.player.abilities = (d.abilities ?? []).slice();
    game.player.status = game.player.status ?? {};
    normalizePools(game.player);

    payload = game.getState();
    payload.type = "encounter";
    payload.encounterNumber = game.getState().world.encounters;
    payload.area = game.getState().current.area;
    payload.encounter = game.getState().current.encounter;
    payload.choices = game.getState().current.choices;

    console.log("PICKS:", pickedIds);
    console.log("game.player.attacks:", game.player.attacks);
    console.log("state.player.attacks:", game.getState()?.player?.attacks);

    creation.active = false;
    creation.draft = null;
    creation.picked.clear();

    const next = game.getState().current.pending === "awaiting_choice"
      ? {
          type: "encounter",
          encounterNumber: game.getState().world.encounters,
          area: game.getState().current.area,
          player: game.getState().player,
          encounter: game.getState().current.encounter,
          choices: game.getState().current.choices
        }
      : game.nextEncounter();

    renderEncounterPayload(next);
  } catch (err) {
    console.error("DONE -> startRun failed:", err);
    addLog(`ERROR starting run: ${err?.message ?? err}`, true);
    creation.active = true;
  }
}


// Map your status keys -> sprite sheet (col,row)
const STATUS_ICONS = {
  defending: [2, 0],
  slowed: [4, 6],
  regen: [7, 3],
  weakened: [1, 0],
  acUp: [3, 0],
  acDown: [1, 0],
  burning: [6, 5],
  poison: [2, 6],
  wounded: [1, 4],
  bleeding: [2,7]
};

const TILE = 32;
const SHEET_COLS = 8;
const SHEET_ROWS = 8;
const DEFAULT_STATUS_ICON = [1, 0];

// ---------- HUD render ----------
function renderPlayer(p) {
  if (!p) {
    setText("s-name", "—");
    setText("s-class", "—");

    setText("s-hp", "—");
    setText("s-mp", "—");
    setText("s-sp", "—");

    setText("s-ac", "—");
    setText("s-tohit", "—");
    setText("s-dmg", "—");

    setText("s-cha", "—");
    setText("s-con", "—");
    setText("s-dex", "—");
    setText("s-str", "—");
    setText("s-int", "—");

    // optional fields (safe if missing in HTML)
    setText("s-level", "—");
    setText("s-xp", "—");
    setText("s-points", "—");

    setText("s-status", "—");
    return;
  }

  normalizePools(p);

  setText("s-name", p.name);
  setText("s-class", p.class);

  // Optional progression fields
  if ($("s-level")) setText("s-level", String(p.level ?? 1));
  if ($("s-xp")) {
    const xp = Number(p.xp ?? 0);
    const toNext = Number(p.xpToNext ?? 0);
    setText("s-xp", toNext > 0 ? `${xp} / ${toNext}` : String(xp));
  }
  if ($("s-points")) setText("s-points", String(p.unspentStatPoints ?? 0));

  // HP
  const hpCur = Number(p.HP ?? 0);
  const hpMax = Number(p.maxHP ?? hpCur);
  setText("s-hp", `${hpCur} / ${hpMax}`);

  // MP
  const mpCur = Number(p.MP ?? 0);
  const mpMax = Number(p.maxMP ?? mpCur);
  setText("s-mp", `${mpCur} / ${mpMax}`);

  // SP
  const spCur = Number(p.SP ?? 0);
  const spMax = Number(p.maxSP ?? spCur);
  setText("s-sp", `${spCur} / ${spMax}`);


  setSPBar(spCur, spMax);
  setMPBar(mpCur, mpMax);
  setXPBar(Number(p.xp ?? 0), Number(p.xpToNext ?? 0));

  // Combat stats
  setText("s-ac", String(p.AC ?? "—"));
  setText("s-tohit", typeof p.to_hit === "number" ? `+${p.to_hit}` : "—");
  setText("s-dmg", Array.isArray(p.damage) ? `${p.damage[0]}-${p.damage[1]}` : "—");

  // Attributes
  setText("s-cha", String(p.CHA ?? 0));
  setText("s-con", String(p.CON ?? 0));
  setText("s-dex", String(p.DEX ?? 0));
  setText("s-str", String(p.STR ?? 0));
  setText("s-int", String(p.INT ?? 0));

  // Status text
  const statusKeys = Object.keys(p.status ?? {});
  setText(
    "s-status",
    statusKeys.length
      ? statusKeys
          .map((k) => {
            const v = p.status[k];
            if (v && typeof v === "object") {
              const t = typeof v.turns === "number" ? v.turns : "?";
              return `${k}(${t})`;
            }
            return `${k}(${v})`;
          })
          .join(", ")
      : "—"
  );
}

function makeStatusIcon(statusKey, turns = null) {
  const [col, row] = STATUS_ICONS[statusKey] ?? DEFAULT_STATUS_ICON;

  const el = document.createElement("div");
  el.className = "status-icon";
  el.title = turns != null ? `${statusKey} (${turns})` : statusKey;

  el.style.backgroundImage = `url("Assets/Icons/effects.png")`;
  el.style.backgroundRepeat = "no-repeat";
  el.style.backgroundSize = `${SHEET_COLS * TILE}px ${SHEET_ROWS * TILE}px`;
  el.style.backgroundPosition = `${-col * TILE}px ${-row * TILE}px`;

  if (turns != null) el.dataset.turns = String(turns);
  return el;
}

function renderStatusRow(containerId, statusObj) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  wrap.innerHTML = "";

  if (!statusObj || typeof statusObj !== "object") return;

  const entries = Object.entries(statusObj);

  for (const [k, v] of entries) {
    if (v == null || v === false) continue;

    let turns = null;

    if (typeof v === "number") turns = v;
    else if (typeof v === "object") {
      turns =
        (typeof v.turns === "number" ? v.turns : null) ??
        (typeof v.duration === "number" ? v.duration : null) ??
        (typeof v.value === "number" ? v.value : null);
    } else if (v === true) {
      turns = null;
    }

    if (turns === 0) continue;

    wrap.appendChild(makeStatusIcon(k, turns));
  }
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

  if (b1) b1.dataset.choice = "1";
  if (b2) b2.dataset.choice = "2";
}

function renderEncounterPayload(payload) {
  setText("hud-encounters", String(payload.encounterNumber));
  renderLocation(payload.area);

  normalizePools(payload.player);
  renderPlayer(payload.player);

  addLog(`Encounter #${payload.encounterNumber} — ${payload.area.name}`, true);
  addLog(payload.encounter.text);

  renderChoices(payload.choices);
}

function renderResolutionPayload(payload) {
  const r = payload.roll;
  addLog(`You chose: ${payload.choice.text}`, true);
  addLog(
    `${payload.choice.stat} check: d20=${r.d20} + ${r.mod} = ${r.total} vs DC ${payload.choice.dc} → ${
      r.success ? "SUCCESS" : "FAIL"
    }`
  );
  addLog(payload.message);

  if (payload.repChange) {
    addLog(
      `Reputation: ${payload.repChange.faction} ${payload.repChange.delta > 0 ? "+" : ""}${payload.repChange.delta}`,
      true
    );
  }
  if (payload.statusApplied) {
    addLog(`Status: ${payload.statusApplied.key} now ${payload.statusApplied.newValue}`, true);
  }

  const state = game.getState();
  normalizePools(state.player);
  renderPlayer(state.player);

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

  if ($("hud-input")) $("hud-input").disabled = show;
  if ($("hud-send")) $("hud-send").disabled = show;
}

function setHPBar(fillId, current, max) {
  const el = $(fillId);
  if (!el) return;

  const pct = max <= 0 ? 0 : clamp01(current / max);
  el.style.width = `${Math.round(pct * 100)}%`;
  el.classList.remove("hp-good", "hp-warn", "hp-bad");
  if (pct >= 0.6) el.classList.add("hp-good");
  else if (pct >= 0.3) el.classList.add("hp-warn");
  else el.classList.add("hp-bad");
}

function setBar(fillId, current, max) {
  const el = $(fillId);
  if (!el) return;

  const cur = Number(current ?? 0);
  const m = Number(max ?? 0);
  const pct = m <= 0 ? 0 : clamp01(cur / m);

  el.style.width = `${Math.round(pct * 100)}%`;
}

function setPlateBar(fillId, textId, current, max) {
  const fill = $(fillId);
  const txt = $(textId);

  const cur = Number(current ?? 0);
  const m = Number(max ?? 0);

  const pct = m <= 0 ? 0 : clamp01(cur / m);
  if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
  if (txt) txt.textContent = m > 0 ? `${cur} / ${m}` : `${cur}`;
}


function setXPBar(current, max) {
  setBar("xp-fill", current, max);

  // optional label if you add it in HTML
  if ($("xp-text")) {
    const cur = Number(current ?? 0);
    const m = Number(max ?? 0);
    $("xp-text").textContent = m > 0 ? `${cur} / ${m}` : `${cur}`;
  }
}

function setMPBar(current, max) {
  setBar("mp-fill", current, max);

  if ($("mp-text")) {
    const cur = Number(current ?? 0);
    const m = Number(max ?? 0);
    $("mp-text").textContent = m > 0 ? `${cur} / ${m}` : `${cur}`;
  }
}

function setSPBar(current, max) {
  setBar("sp-fill", current, max);

  if ($("sp-text")) {
    const cur = Number(current ?? 0);
    const m = Number(max ?? 0);
    $("sp-text").textContent = m > 0 ? `${cur} / ${m}` : `${cur}`;
  }
}



function setBattleText(text) {
  setText("battle-text", text);
}

function anyAnimBusy() {
  return spriteBusy.player || spriteBusy.enemy;
}

// ---------- Floating combat text ----------
function showFloatingText(who, text, cls = "") {
  const wrap = who === "player" ? $("player-wrap") : $("enemy-wrap");
  if (!wrap) return;

  const el = document.createElement("div");
  el.className = `floating-text ${cls}`.trim();
  el.textContent = text;

  wrap.appendChild(el);
  window.setTimeout(() => el.remove(), 900);
}

// ---------- Battle Menu State (ROOT vs SUBMENU) ----------
let battleMenu = "root"; // "root" | "attack" | "buff" | "debuff" | "heal" | "abilities"

function showRootMenu() {
  battleMenu = "root";

  $("battle-cmd-root")?.classList.remove("hidden");
  $("battle-cmd-sub")?.classList.add("hidden");

  for (let i = 1; i <= 4; i++) {
    const b = $(`sub-${i}`);
    if (!b) continue;
    b.dataset.key = "";
    b.textContent = "—";
    b.disabled = true;
  }
}

function openSubMenu(kind) {
  battleMenu = kind;

  $("battle-cmd-root")?.classList.add("hidden");
  $("battle-cmd-sub")?.classList.remove("hidden");

  fillSubMenu(kind);
}

function ensureLoadouts(player) {
  const cls = player.class || "Warrior";

  const normList = (arr) =>
    Array.isArray(arr)
      ? arr.map((x) => (typeof x === "string" ? x : x?.id)).filter(Boolean)
      : null;

  const attacks = normList(player.attacks);
  const abilities = normList(player.abilities);

  if (attacks) {
    player.attacks = attacks;
  } else {
    player.attacks = (DEFAULT_ATTACKS_BY_CLASS[cls] ?? []).slice(0, 4);
  }

  if (abilities) {
    player.abilities = abilities;
  } else {
    player.abilities = (DEFAULT_ABILITIES_BY_CLASS[cls] ?? []).slice();
  }
}




function fillSubMenu(kind) {
  const player = combat?.player || game.getState()?.player;
  if (!player) return;

  ensureLoadouts(player);

  let ids = [];
  if (kind === "attack") {
    ids = (player.attacks ?? []).slice(0, 4);
  } else if (kind === "abilities") {
    ids = (player.abilities ?? []).slice(0, 4);
  } else if (kind === "buff") {
    ids = [
      ...getMovesByKind(player, MoveKind.Buff, "attacks"),
      ...getMovesByKind(player, MoveKind.Buff, "abilities"),
    ].slice(0, 4);
  } else if (kind === "debuff") {
    ids = [
      ...getMovesByKind(player, MoveKind.Debuff, "attacks"),
      ...getMovesByKind(player, MoveKind.Debuff, "abilities"),
    ].slice(0, 4);
  } else if (kind === "heal") {
    ids = [
      ...getMovesByKind(player, MoveKind.Heal, "attacks"),
      ...getMovesByKind(player, MoveKind.Heal, "abilities"),
    ].slice(0, 4);
  }
  ids = (ids ?? []).slice(0, 4);

  for (let i = 1; i <= 4; i++) {
    const btn = $(`sub-${i}`);
    if (!btn) continue;

    const moveId = ids[i - 1] || "";
    btn.dataset.key = moveId;

    if (!moveId) {
      btn.textContent = "—";
      btn.disabled = true;
      continue;
    }

    const move = getMoveById(moveId);
    btn.textContent = move ? move.name : moveId;
    btn.disabled = false;
  }
}

function applyStatusFromState(state) {
  renderStatusRow("player-status-row", state.player.status);
  renderStatusRow("enemy-status-row", state.enemy.status);
}

function setCombatButtonsEnabled(enabled) {
  if ($("cmd-attack")) $("cmd-attack").disabled = !enabled;
  if ($("cmd-abilities")) $("cmd-abilities").disabled = !enabled;
  if ($("cmd-item")) $("cmd-item").disabled = !enabled;
  if ($("cmd-run")) $("cmd-run").disabled = !enabled;

  for (let i = 1; i <= 4; i++) {
    const b = $(`sub-${i}`);
    if (b) b.disabled = !enabled || !b.dataset.key;
  }
  if ($("sub-back")) $("sub-back").disabled = !enabled;
}

// ---------- Sprite config ----------
const SPRITES = {
  player: {
    Warrior: {
      idle: { img: "Assets/warrior-idle.png", w: 144, h: 96, frames: 16, speed: "1s" },
      attack: { img: "Assets/warrior-single swing 1.png", w: 144, h: 96, frames: 11, speed: "1s" },
      hurt: { img: "Assets/warrior-hurt.png", w: 144, h: 96, frames: 8, speed: "1s" },
      death: { img: "Assets/warrior-death.png", w: 144, h: 96, frames: 19, speed: "1s" },
    },
    Cleric: {
      idle: { img: "Assets/cleric-idle.png", w: 160, h: 160, frames: 13, speed: "1s" },
      attack: { img: "Assets/cleric-atk.png", w: 160, h: 160, frames: 36, speed: "1s" },
      hurt: { img: "Assets/cleric-hurt.png", w: 160, h: 160, frames: 9, speed: "1s" },
      death: { img: "Assets/cleric-death.png", w: 160, h: 160, frames: 19, speed: "1s" },
    },
    Wizard: {
      idle: { img: "Assets/old_wizard-idle.png", w: 160, h: 160, frames: 10, speed: "1s" },
      attack: { img: "Assets/old_wizard-atk.png", w: 160, h: 160, frames: 21, speed: "1s" },
      hurt: { img: "Assets/old_wizard-hurt.png", w: 160, h: 160, frames: 9, speed: "1s" },
      death: { img: "Assets/old_wizard-death.png", w: 160, h: 160, frames: 12, speed: "1s" },
    },
    "Shambling Fool": {
      idle: { img: "Assets/fool_idle.png", w: 64, h: 64, frames: 6, speed: ".7s" },
      attack: { img: "Assets/fool_attack.png", w: 64, h: 64, frames: 6, speed: ".6s" },
      hurt: { img: "Assets/fool_hurt.png", w: 64, h: 64, frames: 4, speed: ".3s" },
      death: { img: "Assets/fool_death.png", w: 64, h: 64, frames: 6, speed: ".9s" },
    },
  },

  enemy: {
    Goblin: {
      idle: { img: "Assets/goblin-idle.png", w: 160, h: 128, frames: 6, speed: "1s" },
      attack: { img: "Assets/goblin-atk.png", w: 160, h: 128, frames: 11, speed: "1s" },
      hurt: { img: "Assets/goblin-hurt.png", w: 160, h: 128, frames: 8, speed: "1s" },
      death: { img: "Assets/goblin-death.png", w: 160, h: 128, frames: 10, speed: "1s" },
    },
    "Cult Acolyte": {
      idle: { img: "Assets/cultist-idle.png", w: 220, h: 220, frames: 8, speed: "1s" },
      attack: { img: "Assets/cultist-atk.png", w: 220, h: 220, frames: 16, speed: "1s" },
      hurt: { img: "Assets/cultist-hurt.png", w: 220, h: 220, frames: 8, speed: "1s" },
      death: { img: "Assets/cultist-death.png", w: 220, h: 220, frames: 13, speed: "1s" },
    },
    Skeleton: {
      idle: { img: "Assets/skeleton-variation1-idle.png", w: 128, h: 128, frames: 7, speed: "1s" },
      attack: { img: "Assets/skeleton-variation1-attack.png", w: 128, h: 128, frames: 17, speed: "1s" },
      hurt: { img: "Assets/skeleton-variation1-hurt.png", w: 128, h: 128, frames: 11, speed: "1s" },
      death: { img: "Assets/skeleton-variation1-death.png", w: 128, h: 128, frames: 13, speed: "1s" },
    },
    Viper: {
      idle: { img: "Assets/viper-idle.png", w: 96, h: 96, frames: 8, speed: "1s" },
      attack: { img: "Assets/viper-attack.png", w: 96, h: 96, frames: 9, speed: "1s" },
      hurt: { img: "Assets/viper-hurt.png", w: 96, h: 96, frames: 6, speed: "1s" },
      death: { img: "Assets/viper-death.png", w: 96, h: 96, frames: 9, speed: "1s" },
    },
    Bandit: {
      idle: { img: "Assets/bandit-idle.png", w: 128, h: 96, frames: 8, speed: "1s" },
      attack: { img: "Assets/bandit-atk.png", w: 128, h: 96, frames: 21, speed: "1s" },
      hurt: { img: "Assets/bandit-hurt.png", w: 128, h: 96, frames: 11, speed: "1s" },
      death: { img: "Assets/bandit-death.png", w: 128, h: 96, frames: 16, speed: "1s" },
    },
    Zombie: {
      idle: { img: "Assets/zombie-idle.png", w: 96, h: 96, frames: 8, speed: "1s" },
      attack: { img: "Assets/zombie-atk.png", w: 96, h: 96, frames: 18, speed: "1s" },
      hurt: { img: "Assets/zombie-hurt.png", w: 96, h: 96, frames: 9, speed: "1s" },
      death: { img: "Assets/zombie-death.png", w: 96, h: 96, frames: 12, speed: "1s" },
    },
  },
};

function getAnim(who, playerClass, enemyType, animName) {
  if (who === "player") {
    const set = SPRITES.player[playerClass] ?? SPRITES.player.Warrior;
    return set[animName] ?? set.idle;
  } else {
    const set = SPRITES.enemy[enemyType] ?? SPRITES.enemy.Goblin;
    return set[animName] ?? set.idle;
  }
}

const spriteTimers = { player: null, enemy: null };
const spriteLocked = { player: false, enemy: false };
const spriteBusy = { player: false, enemy: false };

function restartAnim(el) {
  el.style.animationName = "none";
  void el.offsetHeight;
}

function parseSpeedToMs(speed) {
  const s = typeof speed === "string" ? speed.trim() : "1s";
  const num = parseFloat(s);
  if (!Number.isFinite(num)) return 350;
  if (s.endsWith("ms")) return Math.max(1, Math.round(num));
  return Math.max(1, Math.round(num * 1000));
}

function applySheet(el, anim, opts = {}) {
  if (!el || !anim) return;

  const { loop = true, holdLast = false } = opts;

  el.style.backgroundPosition = "0px 0px";
  el.style.backgroundImage = `url("${anim.img}")`;
  el.style.setProperty("--w", `${anim.w}px`);
  el.style.setProperty("--h", `${anim.h}px`);

  const wrap = el.closest("#player-wrap, #enemy-wrap");
  if (wrap) {
    wrap.style.setProperty("--w", `${anim.w}px`);
    wrap.style.setProperty("--h", `${anim.h}px`);
  }

  el.style.setProperty("--frames", String(anim.frames));
  el.style.setProperty("--speed", anim.speed);

  const frames = Math.max(1, Number(anim.frames) || 1);
  el.style.backgroundSize = `${anim.w * frames}px ${anim.h}px`;

  restartAnim(el);
  el.style.animationName = "sheetAnim";
  el.style.animationDuration = anim.speed;
  el.style.animationTimingFunction = `steps(${frames})`;
  el.style.animationIterationCount = loop ? "infinite" : "1";
  el.style.animationFillMode = "none";
  el.style.animationPlayState = "running";

  if (!loop && holdLast) {
    const ms = parseSpeedToMs(anim.speed);
    window.setTimeout(() => {
      el.style.animationName = "none";
      el.style.backgroundPosition = `${-anim.w * (frames - 1)}px 0px`;
    }, ms);
  }
}

function animMs(who, playerClass, enemyType, animName) {
  const anim = getAnim(who, playerClass, enemyType, animName);
  return parseSpeedToMs(anim?.speed ?? "0.35s");
}

function setSpriteIdle(playerClass, enemyType) {
  spriteLocked.player = false;
  spriteLocked.enemy = false;

  applySheet($("player-sprite"), getAnim("player", playerClass, enemyType, "idle"), { loop: true });
  applySheet($("enemy-sprite"), getAnim("enemy", playerClass, enemyType, "idle"), { loop: true });
}

function playSpriteAnim(who, animName, playerClass, enemyType, _holdMsIgnored = 0, opts = {}) {
  const { returnToIdle = true, lock = false, force = false } = opts;

  const el = who === "player" ? $("player-sprite") : $("enemy-sprite");
  if (!el) return;

  if (spriteLocked[who] && !force) return;
  if (spriteBusy[who] && !force) return;

  if (spriteTimers[who]) window.clearTimeout(spriteTimers[who]);

  const isIdle = animName === "idle";
  const isDeath = animName === "death";

  applySheet(el, getAnim(who, playerClass, enemyType, animName), {
    loop: isIdle,
    holdLast: isDeath || lock,
  });

  if (lock) {
    spriteLocked[who] = true;
    spriteBusy[who] = true;
    spriteTimers[who] = null;
    return;
  }

  spriteBusy[who] = true;
  const durationMs = animMs(who, playerClass, enemyType, animName);

  spriteTimers[who] = window.setTimeout(() => {
    spriteBusy[who] = false;
    spriteTimers[who] = null;

    if (!returnToIdle) return;
    if (spriteLocked[who]) return;

    applySheet(el, getAnim(who, playerClass, enemyType, "idle"), { loop: true });
  }, durationMs);
}

// ---------- Combat flow ----------
let combatMax = { playerHP: 1, enemyHP: 1 };
let combatEnemyType = "Goblin";
let combatPlayerClass = "Warrior";
let combatInputLocked = false;

const HIT_FRACTION = 0.55;
const TURN_BEAT_MS = 300;
const POST_ENEMY_BEAT_MS = 250;

function beginCombatFromResolution(enemyObj) {
  const state = game.getState();
  if (!state.player) return;

  normalizePools(state.player);

  setChoicesVisible(false);

  combat = new CombatController(state.player, enemyObj);
  const pub = combat.getPublicState();

  combatMax.playerHP = pub.player.HP;
  combatMax.enemyHP = pub.enemy.HP;

  combatEnemyType = enemyObj.type ?? "Goblin";
  combatPlayerClass = pub.player?.class ?? "Warrior";

  setText("player-name", pub.player.name);
  setText("enemy-name", pub.enemy.name);

  setHPBar("player-hp", pub.player.HP, combatMax.playerHP);
  setHPBar("enemy-hp", pub.enemy.HP, combatMax.enemyHP);
  applyBarsFromState(pub);



  setSpriteIdle(combatPlayerClass, combatEnemyType);

  setBattleText(`A wild ${enemyObj.type ?? "enemy"} appears!`);
  showBattleUI(true);

  combatInputLocked = false;
  setCombatButtonsEnabled(pub.turn === "player");

  showRootMenu();
  addLog(`Combat begins: ${pub.enemy.name}`, true);
}

function endCombatAndReturnToStory(result) {
  setCombatButtonsEnabled(false);
  combatInputLocked = false;

  const s = game.getState();
  normalizePools(s.player);
  renderPlayer(s.player);

  if (result.winner === "fled") {
    showBattleUI(false);
    addLog("You escaped!", true);
    const next = game.nextEncounter();
    renderEncounterPayload(next);
    combat = null;
    return;
  }

  if (result.winner === "player") {
    game.onCombatWin();
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

  playSpriteAnim("player", "death", combatPlayerClass, combatEnemyType, 0, { lock: true, returnToIdle: false });
  setBattleText("You collapse...");

  window.setTimeout(() => {
    showBattleUI(false);
    addLog("You were defeated. Type 'start' to try again.", true);
    setChoicesVisible(false);
    combat = null;
  }, 900);
}

function applyBarsFromState(state) {
  setHPBar("player-hp", state.player.HP, combatMax.playerHP);
  setHPBar("enemy-hp", state.enemy.HP, combatMax.enemyHP);
  applyBattlePlateBars(state);
  applyStatusFromState(state);

  normalizePools(state.player);
  renderPlayer(state.player);
}

function applyBattlePlateBars(state) {
  // Player plate (uses player's max pools)
  normalizePools(state.player);
  setPlateBar("player-sp-fill", "player-sp-text", state.player.SP, state.player.maxSP);
  setPlateBar("player-mp-fill", "player-mp-text", state.player.MP, state.player.maxMP);

  // XP is optional in your engine; these ids exist in HTML
  setPlateBar(
    "player-xp-fill",
    "player-xp-text",
    Number(state.player.xp ?? 0),
    Number(state.player.xpToNext ?? 0)
  );

  // Enemy plate (only if you added the enemy plate-res HTML)
  // If enemy doesn't have pools, this will just show 0 / 0.
  setPlateBar("enemy-sp-fill", "enemy-sp-text", state.enemy.SP, state.enemy.maxSP);
  setPlateBar("enemy-mp-fill", "enemy-mp-text", state.enemy.MP, state.enemy.maxMP);
  setPlateBar("enemy-xp-fill", "enemy-xp-text", Number(state.enemy.xp ?? 0), Number(state.enemy.xpToNext ?? 0));
}


// --------- LOG PRINTING (UPDATED FOR move_effect) ---------
function printCombatLog(entries) {
  for (const e of entries) {
    if (e.type === "player_attack") {
      setBattleText(`You attack! ${e.hit ? `Hit for ${e.dmg}.` : "Miss!"}`);
      addLog(`You attack: d20=${e.roll} total=${e.total} ${e.hit ? `HIT (${e.dmg})` : "MISS"}`, true);
      continue;
    }

    if (e.type === "enemy_attack") {
      setBattleText(`${combat.enemy.name} attacks! ${e.hit ? `Hit for ${e.dmg}.` : "Miss!"}`);
      addLog(`Enemy attack: d20=${e.roll} total=${e.total} ${e.hit ? `HIT (${e.dmg})` : "MISS"}`, true);
      continue;
    }

    if (e.type === "player_move") {
      if (e.roll == null) {
        setBattleText(`${e.name}!`);
        addLog(`${e.name} (MP ${e.mpLeft} | SP ${e.spLeft})`, true);
      } else {
        setBattleText(`${e.name}! ${e.hit ? "Hit!" : "Miss!"}`);
        addLog(
          `${e.name}: d20=${e.roll} total=${e.total} ${e.hit ? "HIT" : "MISS"} (MP ${e.mpLeft} | SP ${e.spLeft})`,
          true
        );
      }
      continue;
    }

    if (e.type === "enemy_move") {
      if (e.roll == null) {
        setBattleText(`${combat.enemy.name} uses ${e.name}!`);
        addLog(`Enemy uses ${e.name}.`, true);
      } else {
        setBattleText(`${combat.enemy.name} uses ${e.name}! ${e.hit ? "Hit!" : "Miss!"}`);
        addLog(`Enemy ${e.name}: d20=${e.roll} total=${e.total} ${e.hit ? "HIT" : "MISS"}`, true);
      }
      continue;
    }

    if (e.type === "player_move_fail") {
      setBattleText(e.text);
      addLog(e.text, true);
      continue;
    }

    if (e.type === "player_defend") {
      setBattleText("You defend!");
      addLog(e.text, true);
      continue;
    }

    if (e.type === "player_item") {
      setBattleText(`You use a Potion (+${e.heal} HP).`);
      addLog(`Potion heals ${e.heal}.`, true);
      continue;
    }

    if (e.type === "player_item_fail") {
      setBattleText(e.text);
      addLog(e.text, true);
      continue;
    }

    if (e.type === "player_flee") {
      setBattleText(e.success ? "You got away!" : "Can't escape!");
      addLog(`Flee: ${e.total} vs DC ${e.dc} → ${e.success ? "SUCCESS" : "FAIL"}`, true);
      continue;
    }

    if (e.type === "enemy_taunt") {
      setBattleText(e.text);
      addLog(e.text, true);
      continue;
    }

    if (e.type === "move_effect") {
      const who = e.by === "enemy" ? combat.enemy.name : "You";
      const tgt =
        e.target === "self"
          ? (e.by === "enemy" ? combat.enemy.name : "yourself")
          : (e.by === "enemy" ? "you" : combat.enemy.name);

      if (e.effect === "damage") {
        setBattleText(`${who} uses ${e.name}!`);
        addLog(`${who} hits ${tgt} for ${e.amount}.`, true);
      } else if (e.effect === "heal") {
        setBattleText(`${who} casts ${e.name}!`);
        addLog(`${who} heals ${tgt} for ${e.amount}.`, true);
      } else if (e.effect === "status") {
        setBattleText(`${who} uses ${e.name}.`);
        addLog(`${who} applies ${e.key} to ${tgt} (${e.turns}t).`, true);
      } else {
        addLog(`[effect] ${JSON.stringify(e)}`, true);
      }
      continue;
    }

    if (e.type === "status_tick") {
      const who = e.who === "enemy" ? combat.enemy.name : "You";
      if (e.kind === "heal") addLog(`${who} gains ${e.amount} HP from ${e.key}.`, true);
      else addLog(`${who} takes ${e.amount} damage from ${e.key}.`, true);
      continue;
    }

    if (e.type === "status_end") {
      const who = e.who === "enemy" ? combat.enemy.name : "You";
      addLog(`${who}'s ${e.key} wore off.`, true);
      continue;
    }

    if (e.type === "combat_end") {
      addLog(`Combat ended: ${e.winner}`, true);
      continue;
    }

    addLog(`[unhandled log] ${JSON.stringify(e)}`, true);
  }
}

function schedulePlayerImpact(entries, impactMs, impactState) {
  window.setTimeout(() => {
    if (!combat) return;

    applyBarsFromState(impactState);

    const attempted =
      entries.find((x) => x.type === "player_attack") ||
      entries.find((x) => x.type === "player_move" && x.roll != null);

    const dealtDamage = entries.some(
      (x) => x.type === "move_effect" && x.by === "player" && x.effect === "damage" && x.amount > 0
    );

    const basicHit = entries.some((x) => x.type === "player_attack" && x.hit);
    const moveHit = entries.some((x) => x.type === "player_move" && x.roll != null && x.hit);

    if (basicHit || moveHit || dealtDamage) {
      playSpriteAnim("enemy", "hurt", combatPlayerClass, combatEnemyType, 0);
    } else if (attempted) {
      showFloatingText("enemy", "MISS", "miss");
    }
  }, impactMs);
}

function scheduleEnemyImpact(entries, impactMs, impactState) {
  window.setTimeout(() => {
    if (!combat) return;

    applyBarsFromState(impactState);

    const attempted =
      entries.find((x) => x.type === "enemy_attack") ||
      entries.find((x) => x.type === "enemy_move" && x.roll != null);

    const dealtDamage = entries.some(
      (x) => x.type === "move_effect" && x.by === "enemy" && x.effect === "damage" && x.amount > 0
    );

    const basicHit = entries.some((x) => x.type === "enemy_attack" && x.hit);
    const moveHit = entries.some((x) => x.type === "enemy_move" && x.roll != null && x.hit);

    if (basicHit || moveHit || dealtDamage) {
      playSpriteAnim("player", "hurt", combatPlayerClass, combatEnemyType, 0);
    } else if (attempted) {
      showFloatingText("player", "MISS", "miss");
    }
  }, impactMs);
}

function runCombatAction(actionKey, arg = "") {
  if (!combat) return;
  if (combatInputLocked) return;
  if (anyAnimBusy()) return;

  const pub = combat.getPublicState();
  if (!pub.active) return;
  if (pub.turn !== "player") return;

  combatInputLocked = true;
  setCombatButtonsEnabled(false);

  const playerAnimName =
    actionKey === "attack" || actionKey === "move" ? "attack" :
    actionKey === "defend" || actionKey === "item" || actionKey === "flee" ? "attack" :
    "idle";

  const playerAnimDuration =
    playerAnimName !== "idle"
      ? animMs("player", combatPlayerClass, combatEnemyType, playerAnimName)
      : 250;

  if (playerAnimName !== "idle") {
    playSpriteAnim("player", playerAnimName, combatPlayerClass, combatEnemyType, 0);
  }

  const playerResult = combat.actPlayer(actionKey, arg);
  const playerEntries = playerResult.log;

  printCombatLog(playerEntries);

  const playerImpactMs = Math.floor(playerAnimDuration * HIT_FRACTION);
  schedulePlayerImpact(playerEntries, playerImpactMs, playerResult.state);

  if (playerResult.ended) {
    window.setTimeout(() => endCombatAndReturnToStory(playerResult), Math.max(150, playerAnimDuration));
    return;
  }

  window.setTimeout(() => {
    if (!combat) return;

    const enemyResult = combat.actEnemy();
    const enemyEntries = enemyResult.log;

    const didEnemyBasicAttack = enemyEntries.some((x) => x.type === "enemy_attack");
    const didEnemyRolledMove = enemyEntries.some((x) => x.type === "enemy_move" && x.roll != null);
    const didEnemyDamageEffect = enemyEntries.some(
      (x) => x.type === "move_effect" && x.by === "enemy" && x.effect === "damage"
    );
    const didEnemyTaunt = enemyEntries.some((x) => x.type === "enemy_taunt");

    if (didEnemyBasicAttack || didEnemyRolledMove || didEnemyDamageEffect) {
      playSpriteAnim("enemy", "attack", combatPlayerClass, combatEnemyType, 0);
    } else if (didEnemyTaunt) {
      playSpriteAnim("enemy", "hurt", combatPlayerClass, combatEnemyType, 0, { returnToIdle: true });
    } else {
      playSpriteAnim("enemy", "idle", combatPlayerClass, combatEnemyType, 0, { force: true });
    }

    printCombatLog(enemyEntries);

    const enemyAnimDuration =
      (didEnemyBasicAttack || didEnemyRolledMove || didEnemyDamageEffect)
        ? animMs("enemy", combatPlayerClass, combatEnemyType, "attack")
        : 450;

    const enemyImpactMs = Math.floor(enemyAnimDuration * HIT_FRACTION);
    scheduleEnemyImpact(enemyEntries, enemyImpactMs, enemyResult.state);

    if (enemyResult.ended) {
      window.setTimeout(() => endCombatAndReturnToStory(enemyResult), Math.max(150, enemyAnimDuration));
      return;
    }

    window.setTimeout(() => {
      combatInputLocked = false;
      const s = combat?.getPublicState();
      if (combat && s?.active && s.turn === "player") setCombatButtonsEnabled(true);
    }, enemyAnimDuration + POST_ENEMY_BEAT_MS);
  }, playerAnimDuration + TURN_BEAT_MS);
}

setCombatButtonsEnabled(false);

// ---------- Command handling ----------
function handleCommand(raw) {
  const cmd = raw.trim();
  if (!cmd) return;

  addLog(`> ${cmd}`, true);
  const lower = cmd.toLowerCase();

  // Creation mode commands take priority
  if (creation.active) {
    if (lower === "cancel") {
      creation.active = false;
      creation.draft = null;
      creation.picked.clear();
      addLog("Character creation canceled. Type 'start [1-4]' to begin again.", true);
      return;
    }

    if (lower.startsWith("name ")) {
      const name = cmd.slice(5).trim();
      if (creation.draft) {
        creation.draft.name = name || creation.draft.name;
        addLog(`Name set: ${creation.draft.name}`, true);
        renderPlayer(creation.draft);
      }
      return;
    }

    if (lower === "pool") {
      listPoolForDraft();
      return;
    }

    if (lower === "picks") {
      showPicks();
      return;
    }

    if (lower.startsWith("pick ")) {
      const id = cmd.split(/\s+/)[1];
      togglePick(id);
      showPicks();
      return;
    }

    if (lower === "auto") {
      autoBuildCharacter();
      return;
    }

    if (lower === "done") {
      finalizeAndStartRun();
      return;
    }

    // add <stat> [n]
    if (lower.startsWith("add ")) {
      const parts = lower.split(/\s+/);
      const stat = (parts[1] ?? "").toUpperCase();
      const n = Math.max(1, Math.floor(Number(parts[2] ?? 1)));
      const map = { STR: "STR", DEX: "DEX", CON: "CON", INT: "INT", CHA: "CHA" };

      const s = map[stat] ?? null;
      if (!s) {
        addLog("Use: add <str|dex|con|int|cha> [n]", true);
        return;
      }

      if (!creation.draft) return;
      for (let i = 0; i < n; i++) {
        if ((creation.draft.unspentStatPoints ?? 0) <= 0) break;
        allocateStatPoints(creation.draft, { [s]: 1 });
      }
      addLog(`Unspent stat points: ${creation.draft.unspentStatPoints}`, true);
      renderPlayer(creation.draft);
      return;
    }

    addLog("Creation cmds: name <x>, add <stat> [n], pool, pick <id>, picks, auto, done, cancel", true);
    return;
  }

  if (lower === "reset") {
    game.reset();
    combat = null;
    combatInputLocked = false;

    clearLog();
    renderPlayer(null);
    renderLocation(null);
    setText("hud-encounters", "0");
    setChoicesVisible(false);
    showBattleUI(false);
    setCombatButtonsEnabled(false);

    addLog("Reset complete. Type “start” to begin.", true);
    return;
  }

  // Start now opens character creation instead of instantly running
  if (lower.startsWith("start")) {
    combat = null;
    combatInputLocked = false;
    showBattleUI(false);
    setCombatButtonsEnabled(false);
    setChoicesVisible(false);

    const parts = lower.split(/\s+/);
    let classChoice = parts[1] ? Number(parts[1]) : NaN;
    if (!Number.isFinite(classChoice) || classChoice < 1 || classChoice > 4) {
      classChoice = Math.floor(Math.random() * 4) + 1;
    }

    startCreationFlow(classChoice, "");
    return;
  }

  if (combat && combat.getPublicState().active) {
    if (lower === "attack") return runCombatAction("attack");
    if (lower === "defend") return runCombatAction("defend");
    if (lower === "run" || lower === "flee") return runCombatAction("flee");

    if (lower.startsWith("move ")) {
      const parts = lower.split(/\s+/);
      return runCombatAction("move", parts[1] || "");
    }

    if (lower.startsWith("item")) {
      const parts = lower.split(/\s+/);
      return runCombatAction("item", parts[1] || "potion");
    }

    addLog("Combat commands: move <id>, defend, item potion, run", true);
    return;
  }

  if (lower === "help") {
    addLog("Commands: start [1-4], stats, areas, travel <roads|chapel|marsh>, reset");
    addLog("During combat: move <id>, item potion, run");
    return;
  }

  if (lower === "stats") {
    const s = game.getState();
    addLog(
      `Stats: HP ${s.player?.HP ?? "—"} | AC ${s.player?.AC ?? "—"} | STR ${s.player?.STR ?? "—"} | INT ${
        s.player?.INT ?? "—"
      } | CHA ${s.player?.CHA ?? "—"}`,
      true
    );
    return;
  }

  if (lower === "areas") {
    const areas = game.listAreas();
    addLog("Areas: " + areas.map((a) => a.key).join(", "));
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

  addLog("Unknown command. Type 'help'.", true);
}

// ---------- Wire up events ----------
document.addEventListener("DOMContentLoaded", () => {
  $("btn-start")?.addEventListener("click", () => handleCommand("start"));
  $("btn-reset")?.addEventListener("click", () => handleCommand("reset"));

  $("hud-send")?.addEventListener("click", () => handleCommand($("hud-input")?.value ?? ""));
  $("hud-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCommand($("hud-input")?.value ?? "");
  });

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

  // ROOT combat menu buttons (OPEN menus)
  $("cmd-attack")?.addEventListener("click", () => openSubMenu("attack"));
  $("cmd-abilities")?.addEventListener("click", () => openSubMenu("abilities"));

  $("cmd-item")?.addEventListener("click", () => {
    addLog("Inventory HUD coming soon.", true);
  });

  $("cmd-run")?.addEventListener("click", () => {
    showRootMenu();
    runCombatAction("flee");
  });

  // SUBMENU move buttons
  for (let i = 1; i <= 4; i++) {
    $(`sub-${i}`)?.addEventListener("click", () => {
      const btn = $(`sub-${i}`);
      const moveId = btn?.dataset.key || "";
      if (!moveId) return;

      showRootMenu();
      runCombatAction("move", moveId);
    });
  }

  $("sub-back")?.addEventListener("click", () => showRootMenu());

  // Initial UI defaults
  renderPlayer(null);
  renderLocation(null);
  setChoicesVisible(false);
  showBattleUI(false);
  showRootMenu();
  setCombatButtonsEnabled(false);
});
