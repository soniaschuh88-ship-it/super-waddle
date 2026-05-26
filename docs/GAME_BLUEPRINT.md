# Game Blueprint System

Complete reference for the bKG game blueprint schema and AI generation pipeline.

---

## Overview

A **game blueprint** is a JSON document that defines every system in a playable game:
world parameters, story arc, NPC roster, monster catalogue, quest system,
loot tables, player progression, zone layout, and a technical gameplan.

Blueprints are stored in `~/.bkg/blueprints/<id>.json`.

Two modes:
- **`singleplayer`** — created by users in the Game Studio
- **`mmo`** — created by admins, published for players to join

---

## Blueprint Document Schema

```json
{
  "id":                  "180004f283470d7b",
  "name":                "Shattered Kingdoms",
  "description":         "...",
  "mode":                "singleplayer | mmo",
  "genre":               "rpg | fps | survival | horror | sci-fi | fantasy | strategy | sandbox",
  "tone":                "dark | heroic | comedic | gritty | epic | mysterious | post-apocalyptic | anime",
  "engine":              { "id": "godot4", "label": "Godot 4", "lang": "GDScript", "free": true },
  "status":              "draft | complete | published | archived",
  "version":             1,
  "worldId":             "vldb-world-id | null",
  "createdAt":           1748290000000,
  "updatedAt":           1748290000000,
  "generatedSections":   ["world", "story", "npcs"],
  "checksum":            "abc123def456",

  "world":     { ... },
  "story":     { ... },
  "npcs":      [ ... ],
  "monsters":  [ ... ],
  "quests":    [ ... ],
  "loot":      { ... },
  "levels":    { ... },
  "combat":    { ... },
  "economy":   { ... },
  "zones":     [ ... ],

  "docs": {
    "world":    "# World...\n...",
    "story":    "# Story...\n...",
    "npcs":     "",
    "monsters": "",
    "quests":   "",
    "loot":     "",
    "levels":   "",
    "zones":    "",
    "gameplan": ""
  },

  "mmo": {
    "maxPlayers":    100,
    "pvpEnabled":    false,
    "respawnEnabled": true,
    "serverRegion":  "default",
    "openBeta":      true
  } | null
}
```

---

## Section: World

```json
{
  "name":        "Aethoria",
  "seed":        42,
  "size":        { "width": 1024, "height": 512, "depth": 1024 },
  "chunkSize":   32,
  "seaLevel":    64,
  "climate":     "temperate | arctic | tropical | arid | oceanic",
  "magicLevel":  "none | low | medium | high | extreme",
  "techLevel":   "stone | bronze | iron | medieval | renaissance | industrial",
  "biomes":      ["plains", "forest", "mountains", "desert", "ocean", "dungeon"],
  "description": "A crumbling empire...",
  "dungeons":    [],
  "cities":      [],
  "landmarks":   []
}
```

---

## Section: Story

```json
{
  "title":       "The Shattered Crown",
  "theme":       "Redemption and sacrifice",
  "tone":        "dark",
  "structure":   "3-act | 5-act | hero's journey | non-linear | episodic",
  "protagonist": { "class": "warrior", "backstory": "...", "motivation": "..." },
  "antagonist":  { "name": "Lord Malachar", "type": "villain", "motivation": "..." },
  "conflict":    "Restore the magical balance before the world ends",
  "acts":        [],
  "endings":     ["good", "bad", "secret"]
}
```

---

## Section: NPCs (array)

Each NPC:

```json
{
  "id":        "a1b2c3d4",
  "name":      "Aldric the Blacksmith",
  "type":      "merchant | villager | questgiver | guard | companion | innkeeper | wizard | priest | boss",
  "faction":   "Ironveil Guild",
  "level":     5,
  "location":  "Thornwall City",
  "schedule":  [{ "time": "08:00", "location": "smithy", "activity": "working" }],
  "dialogue": {
    "greeting": ["Aye, what can I forge for ya?"],
    "topics":   ["weapons", "rumors", "quests"],
    "farewell": ["Come back when you need steel!"]
  },
  "inventory": [],
  "quests":    ["quest_id_1"],
  "stats":     { "hp": 200, "damage": 20, "defense": 15 },
  "behavior":  "friendly | neutral | hostile",
  "backstory": "Former soldier turned smith after losing his hand in the war",
  "appearance":"Burly man with a mechanical prosthetic arm",
  "isImmortal": false
}
```

---

## Section: Monsters (array)

Each monster:

```json
{
  "id":         "m001",
  "name":       "Iron Golem",
  "type":       "beast | undead | demon | elemental | humanoid | dragon",
  "level":      25,
  "tier":       "common | elite | champion | boss | worldboss",
  "biomes":     ["dungeon", "mountains"],
  "spawnRate":  0.3,
  "spawnGroup": { "min": 1, "max": 1 },
  "dayOnly":    false,
  "nightOnly":  false,
  "dungeonOnly": true,
  "stats": {
    "hp":          2000,
    "damage":      120,
    "defense":     80,
    "speed":       4,
    "xpReward":    500,
    "goldReward":  { "min": 50, "max": 200 }
  },
  "abilities":   ["Stomp", "Iron Slam", "Unstoppable Charge"],
  "lootTable":   [
    { "itemId": "iron_core", "chance": 0.8, "minCount": 1, "maxCount": 2 },
    { "itemId": "steel_plate", "chance": 0.2, "minCount": 1, "maxCount": 1 }
  ],
  "aiPattern":  "guard | patrol | chase | flee | pack | ambush | boss",
  "aggroRange": 10,
  "leashRange": 40,
  "immuneTo":   ["poison", "bleed"],
  "weakTo":     ["lightning"],
  "resistTo":   ["physical"],
  "description":"Ancient construct built to guard the Vault of Kings"
}
```

### Tier reference

| Tier | HP Multiplier | XP Multiplier | Spawn Rate |
|------|--------------|--------------|------------|
| common | 1× | 1× | High |
| elite | 3× | 2× | Medium |
| champion | 8× | 5× | Low |
| boss | 20× | 20× | Zone unique |
| worldboss | 100× | 100× | World unique |

---

## Section: Quests (array)

Each quest:

```json
{
  "id":                    "q001",
  "title":                 "The Missing Merchant",
  "type":                  "main | side | daily | hidden | legendary",
  "giverNpcId":            "a1b2c3d4",
  "prerequisiteQuestIds":  [],
  "prerequisiteLevel":     5,
  "objectives": [
    { "id": "o1", "type": "talk", "target": "npc_guard", "count": 1, "description": "Speak with the city guard" },
    { "id": "o2", "type": "kill", "target": "bandit_leader", "count": 1, "description": "Defeat the bandit leader" },
    { "id": "o3", "type": "collect", "target": "stolen_goods", "count": 1, "description": "Retrieve the stolen goods" }
  ],
  "stages":    [],
  "rewards": {
    "xp":        500,
    "gold":      200,
    "items":     [{ "itemId": "merchants_ring", "count": 1 }],
    "reputation":{ "Merchants Guild": 50 },
    "unlocksQuestIds": ["q002"]
  },
  "failConditions": ["merchant_dies"],
  "timeLimit":  null,
  "repeatable": false,
  "location":   "Thornwall City",
  "summary":    "Find the missing merchant and recover the stolen goods",
  "description":"Aldric the Blacksmith asks you to...",
  "completionText": "You've recovered the goods and saved Aldric's livelihood.",
  "isHidden":   false
}
```

### Objective types

| Type | Description |
|------|-------------|
| `kill` | Kill N of target |
| `collect` | Collect N items |
| `escort` | Keep NPC alive to destination |
| `discover` | Reach a location |
| `talk` | Speak with an NPC |
| `craft` | Craft an item |
| `survive` | Survive for N seconds |

---

## Section: Loot

```json
{
  "currency": { "name": "Gold", "symbol": "⟁" },
  "itemTiers": [
    { "id": "common",    "name": "Common",    "color": "#aaaaaa", "dropMult": 1.0   },
    { "id": "uncommon",  "name": "Uncommon",  "color": "#1eff00", "dropMult": 0.4   },
    { "id": "rare",      "name": "Rare",      "color": "#0070dd", "dropMult": 0.15  },
    { "id": "epic",      "name": "Epic",      "color": "#a335ee", "dropMult": 0.04  },
    { "id": "legendary", "name": "Legendary", "color": "#ff8000", "dropMult": 0.01  },
    { "id": "artifact",  "name": "Artifact",  "color": "#e6cc80", "dropMult": 0.001 }
  ],
  "tables": [
    {
      "id":   "common_enemy",
      "name": "Common Enemy Drop",
      "rolls": 2,
      "entries": [
        { "itemId": "health_potion", "weight": 40 },
        { "itemId": "iron_ore",      "weight": 30 },
        { "itemId": "nothing",       "weight": 30 }
      ]
    }
  ],
  "items": [
    {
      "id":         "iron_sword",
      "name":       "Iron Sword",
      "type":       "weapon | armor | consumable | material | quest | currency",
      "subtype":    "sword",
      "tier":       "common",
      "level":      5,
      "stackable":  false,
      "maxStack":   1,
      "weight":     3.5,
      "value":      45,
      "slot":       "weapon",
      "stats":      { "damage": 25, "attackSpeed": 1.2 },
      "effects":    [],
      "craftRecipe":null,
      "description":"A sturdy iron blade",
      "lore":       ""
    }
  ]
}
```

---

## Section: Levels

```json
{
  "maxLevel":    50,
  "xpFormula":  "level^2 * 100",
  "statGrowth": { "hp": 10, "mp": 5, "strength": 2, "defense": 2, "speed": 1 },
  "baseStats":  { "hp": 100, "mp": 50, "strength": 10, "defense": 8, "speed": 10 },
  "equipSlots": ["head", "chest", "legs", "feet", "hands", "weapon", "offhand", "ring", "amulet"],
  "classes": [
    {
      "id":           "warrior",
      "name":         "Warrior",
      "description":  "Master of close-range combat",
      "startingStats":{ "hp": 150, "strength": 15, "defense": 12 },
      "skillTree": [
        { "id": "shield_bash",     "name": "Shield Bash",     "level": 1,  "cost": 1 },
        { "id": "power_strike",    "name": "Power Strike",    "level": 5,  "cost": 2 },
        { "id": "berserker_rage",  "name": "Berserker Rage",  "level": 20, "cost": 5 }
      ]
    }
  ]
}
```

---

## Section: Zones (array)

Each zone:

```json
{
  "id":           "zone_001",
  "name":         "Thornwall City",
  "type":         "overworld | dungeon | city | cave | sky | underwater",
  "biome":        "plains",
  "levelRange":   { "min": 1, "max": 10 },
  "size":         { "width": 256, "height": 128, "depth": 256 },
  "chunkCoords":  { "cx": 0, "cy": 0, "cz": 0 },
  "monsters":     ["goblin", "bandit"],
  "npcs":         ["aldric", "mayor"],
  "quests":       ["q001", "q003"],
  "weather":      "clear | rain | storm | snow | fog",
  "isDungeon":    false,
  "dungeonFloors":0,
  "boss":         null,
  "entrances":    [{ "toZoneId": "zone_dungeon_01", "position": { "x": 100, "y": 0, "z": 50 } }],
  "description":  "A walled city at the crossroads of three trade routes"
}
```

---

## AI Generation

Each section is generated individually via:

```
POST /game/blueprint/:id/generate/:section
```

The server:
1. Resolves API key (user profile → global admin → env var)
2. Builds section-specific system + user prompt
3. Calls NVIDIA NIM (primary) or OpenRouter (fallback)
4. Streams tokens via SSE
5. Parses JSON from the streamed text for structured sections
6. Saves full text to `docs[section]` and parsed data to the section field

### Prompt philosophy

- **System prompt**: persona + output format instruction (JSON array/object)
- **User prompt**: game name + relevant context from other sections
- **Temperature**: 0.85 (creative but coherent)
- **Max tokens**: 3000 for most sections, 4096 for gameplan

---

## API Quick Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/game/blueprint/list?mode=` | List blueprints |
| `POST` | `/game/blueprint/create` | Create blueprint |
| `GET` | `/game/blueprint/:id` | Get full blueprint |
| `GET` | `/game/blueprint/:id/stats` | Completion stats |
| `PUT` | `/game/blueprint/:id` | Update blueprint |
| `PATCH` | `/game/blueprint/:id/section/:section` | Update one section |
| `DELETE` | `/game/blueprint/:id` | Delete blueprint |
| `POST` | `/game/blueprint/:id/generate/:section` | AI generate section (SSE) |
| `GET` | `/game/blueprint/templates` | Default templates |
| `GET` | `/game/mmo/worlds` | Published MMO worlds |
| `POST` | `/game/mmo/publish/:id` | Publish (admin) |
| `POST` | `/game/mmo/unpublish/:id` | Unpublish (admin) |
