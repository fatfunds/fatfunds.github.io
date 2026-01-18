// =========================
// FILE: location.js
// (port of Location.py)
// =========================

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * weightedPick([["Bandit", 5], ["Goblin", 3]])
 */
export function weightedPick(weighted) {
  const total = weighted.reduce((acc, [, w]) => acc + w, 0);
  let r = randInt(1, total);
  for (const [item, w] of weighted) {
    r -= w;
    if (r <= 0) return item;
  }
  return weighted[weighted.length - 1][0];
}

export const AREAS = {
  roads: {
    key: "roads",
    name: "Kingroad Crossings",
    description: "Trade routes, caravans, and trouble that follows money.",
    factions: ["Merchants Guild", "Road Wardens", "Bandit Clans"],

    // Roads = classic threats + a little spice
    enemies: [
      ["Bandit", 5],
      ["Goblin", 3],
      ["Wolf", 2],
      ["Viper", 1],
    ],

    hooks: [
      "a caravan went missing last night",
      "someone is faking roadwarden badges",
      "a toll booth appeared overnight",
      "a merchant swears they saw lights in the ditch",
    ],
    landmarks: ["a broken milestone", "a burnt wagon", "a lonely shrine", "a muddy crossroads"],
    heroes: ["Captain Elira Voss"],
    villains: ["Rook the Red"],
    combat_bias: 0.55,
    loot_bias: { coin: 3, potion: 1, map: 1 },
  },

  chapel: {
    key: "chapel",
    name: "Chapel of the Sealed Tongue",
    description: "Dusty prayers, old stone, and things that should stay buried.",
    factions: ["Clerics of Dawn", "Gravekeepers", "Cult of Ash"],

    // Chapel = undead + cult + occasional scavenger goblin
    enemies: [
      ["Skeleton", 5],
      ["Cult Acolyte", 4],
      ["Zombie", 3],
      ["Goblin", 1],
    ],

    hooks: [
      "the bells ring by themselves",
      "a sealed door is leaking black smoke",
      "a novice vanished in the catacombs",
      "fresh wax drips from candles no one lit",
    ],
    landmarks: ["a cracked altar", "a sun-faded mosaic", "a sealed iron door", "a collapsed crypt stair"],
    heroes: ["Sister Maren"],
    villains: ["The Ash Reader"],
    combat_bias: 0.65,
    loot_bias: { rune: 2, potion: 2, coin: 1 },
  },

  marsh: {
    key: "marsh",
    name: "Fen of Whispering Reeds",
    description: "Wet ground, bad visibility, and things that don’t want you here.",
    factions: ["Reedfolk", "Swamp Wardens", "Bog Cult"],

    // Marsh = viper/zombie heavy
    enemies: [
      ["Viper", 5],
      ["Zombie", 4],
      ["Cult Acolyte", 3],
      ["Goblin", 2],
      ["Skeleton", 2],
      ["Wolf", 1],
    ],

    hooks: [
      "voices carry across the water with no speaker",
      "a lantern bobbles deep in the fog",
      "something drags corpses beneath the reeds",
      "a bridge creaks with fresh rope bindings",
    ],
    landmarks: ["a foggy riverside", "a sinking footpath", "a rope bridge", "a ring of standing stones"],
    heroes: ["Warden Bramm"],
    villains: ["The Bog Prophet"],
    combat_bias: 0.60,
    loot_bias: { potion: 2, coin: 1, map: 2 },
  },
};

export function listAreas() {
  return Object.values(AREAS);
}

export function getArea(key) {
  return AREAS[key];
}
