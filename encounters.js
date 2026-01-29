// =========================
// FILE: encounters.js
// Beat-based encounter generator (arc-aware)
// Evolving storyline beats: continuity via arc.flags + better pacing.
// =========================

import { weightedPick } from "./location.js";

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function chance(p) {
  return Math.random() < clamp01(p);
}

export const HOOKS = [
  "You hear",
  "You notice",
  "You stumble upon",
  "A traveler warns you about",
  "A sudden shout draws you toward",
];

// Story beat types (non-reward)
const BEAT_TYPES = ["clue", "npc", "hazard", "ambush"];

// --- Small utility: continuity lines based on flags ---
function continuityLine(area, arc) {
  const f = arc.flags ?? {};
  const lines = [];

  if (f.warnedByHero && arc.hero?.name) lines.push(`You remember ${arc.hero.name}’s warning.`);
  if (f.freedNPC) lines.push("Someone you helped is still out there—alive because of you.");
  if (f.hasClue && !f.foundTrail) lines.push("You’ve got a clue, but not the route.");
  if (f.foundTrail && !f.lairLocated) lines.push("The trail is warm now—recent.");
  if (f.lairLocated) lines.push("You’re close. Uncomfortably close.");

  // area flavor
  if (area.key === "marsh" && (f.hasClue || f.foundTrail)) lines.push("The reeds feel like they’re listening.");

  return lines.length ? " " + choice(lines) : "";
}

// --- Better lieutenant naming so they feel like "characters" ---
const LIEUTENANT_TITLES = [
  "Ritual-Keeper",
  "Reed-Stalker",
  "Bone-Counter",
  "Chain-Bearer",
  "Fog-Caller",
  "Blood-Messenger",
];

function ensureLieutenantNames(arc) {
  if (!Array.isArray(arc.lieutenants)) return;
  for (const lt of arc.lieutenants) {
    if (!lt.name || lt.name.includes("Lieutenant")) {
      const title = choice(LIEUTENANT_TITLES);
      lt.title = lt.title ?? title;
      lt.name = `${title} (${lt.type})`;
    }
  }
}

// ramp logic for combat beats
function pickBeatType(area, arc) {
  const steps = Math.max(0, Number(arc.stepsRemaining ?? 0));
  const t = clamp01(1 - steps / 6);
  const combatBias = Number(area.combat_bias ?? 0.5);

  // close to boss and not located? push clue
  if (steps <= 2 && !arc.flags.lairLocated) return "clue";

  // ambush grows as you get closer + area bias
  const ambushChance = clamp01(0.12 + t * 0.40 + (combatBias - 0.5) * 0.25);
  if (chance(ambushChance)) return "ambush";

  return choice(BEAT_TYPES);
}

function shouldSpawnSubBoss(arc) {
  if (!arc.lieutenants || arc.lieutenants.length <= 0) return false;
  const late = (arc.stepsRemaining ?? 0) <= 3;
  return chance(late ? 0.40 : 0.18);
}

// a simple progression: clue -> trail -> lair (+ optional ritual sighting)
function applyFlagProgression(arc) {
  const f = arc.flags ?? {};
  if (!f.hasClue) return { hasClue: true };
  if (!f.foundTrail) return { foundTrail: true };
  if (!f.sawRitual) return { sawRitual: true };
  if (!f.lairLocated) return { lairLocated: true };
  return {};
}

// pacing: not every beat should "consume" a step
function shouldConsumeStep(kind) {
  if (kind === "clue") return true;
  if (kind === "ambush") return true;
  if (kind === "subboss") return true;
  if (kind === "boss") return false;

  // npc/hazard: sometimes yes, sometimes it’s “texture”
  return chance(0.55);
}

export function generateBeat(area, world, arc) {
  arc.beatIndex = (arc.beatIndex ?? 0) + 1;
  arc.flags = arc.flags ?? {};
  ensureLieutenantNames(arc);

  const steps = Math.max(0, Number(arc.stepsRemaining ?? 0));

  // Boss time
  if (steps <= 0 || (arc.flags.lairLocated && steps <= 1)) {
    const bossIntro = [
      `The signs finally converge near ${choice(area.landmarks)}.`,
      `The air changes near ${choice(area.landmarks)}—like the world is holding its breath.`,
      `You find the place everyone avoided: ${choice(area.landmarks)}.`,
    ];

    const payoff =
      arc.flags.sawRitual
        ? "You’ve seen enough to know what’s coming. Now you stop it."
        : arc.flags.foundTrail
          ? "The trail led here, exactly like it wanted."
          : "You don’t know how you got here—only that it feels wrong.";

    return {
      kind: "boss",
      area_key: area.key,
      enemy_type: arc.antagonist.type,
      text:
        `${choice(bossIntro)}${continuityLine(area, arc)} ` +
        `${payoff} ` +
        `You’ve walked into the heart of it: ${arc.antagonist.name}.`,
      arc_updates: { stepsDelta: 0, setFlags: {} },
    };
  }

  // Subboss beat
  if (shouldSpawnSubBoss(arc)) {
    const lt = arc.lieutenants.shift();
    arc.flags.foundTrail = true;

    // subboss always consumes a step
    arc.stepsRemaining = Math.max(0, steps - 1);

    const subLines = [
      "This one moves with purpose—trained, sent, and expecting you.",
      "They weren’t scavenging. They were waiting.",
      "This isn’t a random patrol. This is a message.",
    ];

    return {
      kind: "subboss",
      area_key: area.key,
      enemy_type: lt.type,
      text:
        `${choice(HOOKS)} something organized near ${choice(area.landmarks)}.${continuityLine(area, arc)} ` +
        `A lieutenant steps out: ${lt.name}. ` +
        `${choice(subLines)} ` +
        `Behind it all, you feel ${arc.antagonist.name}’s hand.`,
      arc_updates: { stepsDelta: -1, setFlags: { foundTrail: true } },
      meta: { lieutenant: lt },
    };
  }

  // Normal beat
  const kind = pickBeatType(area, arc);

  const consumes = shouldConsumeStep(kind);
  if (consumes) arc.stepsRemaining = Math.max(0, steps - 1);

  if (kind === "clue") {
    const setFlags = applyFlagProgression(arc);
    Object.assign(arc.flags, setFlags);

    const clueLines = [
      `A detail from the rumor clicks into place: ${choice(area.hooks)}.`,
      `You find evidence this is being directed, not improvised.`,
      `The trail bends toward ${choice(area.landmarks)}—fresh, deliberate.`,
      `Someone has been here recently…and wanted you to notice.`,
      `You catch a pattern—too consistent to be natural.`,
    ];

    const stinger =
      setFlags.lairLocated
        ? "You’re sure you could find the lair now."
        : setFlags.sawRitual
          ? "For a moment, you see a ritual in progress…then it’s gone."
          : "";

    return {
      kind: "clue",
      area_key: area.key,
      enemy_type: null,
      text:
        `${choice(HOOKS)} something subtle near ${choice(area.landmarks)}.${continuityLine(area, arc)} ` +
        `${choice(clueLines)} ${stinger}`.trim(),
      arc_updates: { stepsDelta: consumes ? -1 : 0, setFlags },
    };
  }

  if (kind === "npc") {
    const heroBeat = arc.hero && !arc.flags.warnedByHero && chance(0.55);

    if (heroBeat) {
      arc.flags.warnedByHero = true;

      return {
        kind: "npc",
        area_key: area.key,
        enemy_type: null,
        text:
          `Near ${choice(area.landmarks)}, you run into ${arc.hero.name}.${continuityLine(area, arc)} ` +
          `"This place is turning," they say. "If you keep going, you’ll meet ${arc.antagonist.name}."`,
        arc_updates: { stepsDelta: consumes ? -1 : 0, setFlags: { warnedByHero: true } },
      };
    }

    const npcLines = [
      "A shaking witness points you toward deeper trouble.",
      "A drenched courier gasps out a name, then collapses.",
      "A trapped traveler begs to be freed before the water rises.",
      "A local refuses to speak…until you mention the villain’s name.",
    ];

    if (!arc.flags.freedNPC && chance(0.45)) arc.flags.freedNPC = true;

    return {
      kind: "npc",
      area_key: area.key,
      enemy_type: null,
      text:
        `${choice(HOOKS)} a human problem near ${choice(area.landmarks)}.${continuityLine(area, arc)} ` +
        `${choice(npcLines)}`,
      arc_updates: { stepsDelta: consumes ? -1 : 0, setFlags: {} },
    };
  }

  if (kind === "hazard") {
    const hazards = [
      "The ground shifts and tries to swallow your footing.",
      "A thick fog rolls in, erasing direction and sound.",
      "Something splashes nearby—too heavy to be a fish.",
      "A rotten bridge creaks with fresh rope bindings.",
      "A cold wind cuts through the reeds like a whisper.",
    ];

    return {
      kind: "hazard",
      area_key: area.key,
      enemy_type: null,
      text:
        `${choice(HOOKS)} danger with no face near ${choice(area.landmarks)}.${continuityLine(area, arc)} ` +
        `${choice(hazards)}`,
      arc_updates: { stepsDelta: consumes ? -1 : 0, setFlags: {} },
    };
  }

  // ambush
  const enemyType = weightedPick(area.enemies);
  return {
    kind: "ambush",
    area_key: area.key,
    enemy_type: enemyType,
    text:
      `${choice(HOOKS)} movement near ${choice(area.landmarks)}.${continuityLine(area, arc)} ` +
      `It’s ${enemyType.toLowerCase()} activity—fast, messy, and meant to slow you down.`,
    arc_updates: { stepsDelta: consumes ? -1 : 0, setFlags: {} },
  };
}

// Choices still stat-check, but now they can also influence pacing/flags.
// Combat beats force combat.
export function generateChoices(area, beat, arc) {
  if (beat.kind === "boss" || beat.kind === "subboss" || beat.kind === "ambush") {
    return [
      {
        text: "Brace yourself and fight.",
        stat: "STR",
        dc: 10,
        success: {},
        fail: {},
        success_msg: "You commit to the clash.",
        fail_msg: "You commit to the clash.",
        force_combat: true,
      },
      {
        text: "Try to reposition and take the first move.",
        stat: "INT",
        dc: 11,
        success: {},
        fail: {},
        success_msg: "You gain a small edge before it explodes into violence.",
        fail_msg: "You misread it—violence comes anyway.",
        force_combat: true,
      },
    ];
  }

  // Non-combat beats
  const options = [
    {
      text: "Follow the most recent signs.",
      stat: "INT",
      dc: 11,
      success: {},
      fail: {},
      success_msg: "You keep the trail warm.",
      fail_msg: "The trail slips; you lose time.",
      on_success: () => {
        if (!arc?.flags) return;
        if (!arc.flags.foundTrail) arc.flags.foundTrail = true;
      },
      on_fail: () => {
        // failure can “waste time” by effectively adding a step back
        if (!arc) return;
        arc.stepsRemaining = Math.min((arc.stepsRemaining ?? 0) + 1, 8);
      },
    },
    {
      text: "Press forward aggressively.",
      stat: "STR",
      dc: 11,
      success: {},
      fail: {},
      success_msg: "You force progress through the worst of it.",
      fail_msg: "You overextend and stumble into a worse position.",
      on_success: () => {
        // success can shave a step (you pushed through)
        if (!arc) return;
        arc.stepsRemaining = Math.max(0, (arc.stepsRemaining ?? 0) - 1);
      },
    },
    {
      text: "Keep it quiet and avoid attention.",
      stat: "CHA",
      dc: 12,
      success: {},
      fail: {},
      success_msg: "You slip through without drawing eyes.",
      fail_msg: "Someone notices—and it spreads.",
      on_fail: () => {
        // on fail, more likely ambush next time (soft effect: mark clue as shaky)
        if (!arc?.flags) return;
        arc.flags.hasClue = arc.flags.hasClue || chance(0.35);
      },
    },
  ];

  // pick 2 distinct
  const i = randInt(0, options.length - 1);
  let j = randInt(0, options.length - 1);
  while (j === i) j = randInt(0, options.length - 1);

  return [options[i], options[j]];
}
