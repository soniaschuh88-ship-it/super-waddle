# Game Systems Reference

Complete documentation for all game subsystems in bKG.

---

## Combat System

```json
{
  "turnBased":     false,
  "hitFormula":    "attacker.strength * 1.5 - defender.defense * 0.8 + random(-10,10)",
  "critChance":    0.05,
  "critMultiplier":2.0,
  "statusEffects": ["burn","freeze","poison","stun","slow","blind"],
  "aiPatterns":    ["patrol","guard","chase","flee","boss"]
}
```

### Damage calculation

```
baseDamage = attacker.stats.damage * (1 + attacker.strengthBonus)
mitigated  = baseDamage * (1 - defender.defenseRatio)
final      = mitigated + random(-10, 10)
crit       = random() < critChance → final * critMultiplier
```

### Status effects

| Effect | Duration | Tick | Notes |
|--------|----------|------|-------|
| `burn` | 5s | 1s | 5% max HP / tick |
| `freeze` | 3s | — | No movement |
| `poison` | 10s | 2s | 2% max HP / tick |
| `stun` | 2s | — | No actions |
| `slow` | 6s | — | -50% speed |
| `blind` | 4s | — | -75% accuracy |

### AI Patterns

| Pattern | Behaviour |
|---------|-----------|
| `patrol` | Follow waypoints, aggro on sight |
| `guard` | Hold position, aggro on proximity |
| `chase` | Pursue target until leash range |
| `flee` | Run from target below 30% HP |
| `pack` | Alert nearby same-type on aggro |
| `ambush` | Dormant until player is adjacent |
| `boss` | Phase transitions at 75%/50%/25% HP |

---

## Economy System

```json
{
  "inflation":    1.0,
  "shopTypes":   ["general","blacksmith","alchemist","magic","stable"],
  "craftable":   true,
  "tradeable":   true,
  "auctionHouse":false
}
```

### Shop types

| Shop | Sells | Buys |
|------|-------|------|
| `general` | Food, tools, misc | Anything |
| `blacksmith` | Weapons, armor | Metal items |
| `alchemist` | Potions, reagents | Herbs, ingredients |
| `magic` | Spells, staves, scrolls | Magic items |
| `stable` | Mounts, feed | — |

### Crafting

Items with `craftRecipe` set can be crafted at the appropriate workshop:
```json
{
  "craftRecipe": {
    "workshop":    "smithy",
    "skillLevel":  10,
    "ingredients": [
      { "itemId": "iron_ore",  "count": 3 },
      { "itemId": "wood_plank","count": 1 }
    ],
    "time":        30
  }
}
```

---

## Player Progression

### XP Formula

Default: `level^2 * 100`
- Level 1 → 2: 100 XP
- Level 10 → 11: 10,000 XP
- Level 49 → 50: 240,100 XP

### Stat growth (per level up)

Each level grants `statGrowth` bonuses plus class bonuses:
```
newHP      = baseStats.hp      + (level-1) * statGrowth.hp      + class.hpBonus
newStrength= baseStats.strength+ (level-1) * statGrowth.strength + class.strengthBonus
```

### Skill trees

Each class has a skill tree of 10-20 skills:
```json
{
  "id":          "power_strike",
  "name":        "Power Strike",
  "description": "A powerful melee attack dealing 200% weapon damage",
  "level":       5,
  "cost":        2,
  "cooldown":    8,
  "manaCost":    20,
  "effect": {
    "type":       "damage",
    "multiplier": 2.0,
    "range":      "melee"
  },
  "requires":    ["basic_strike"]
}
```

---

## Loot Tables

### Table rolls

```json
{
  "id":     "boss_table",
  "name":   "Boss Drop",
  "rolls":  3,
  "entries":[
    { "itemId": "boss_weapon",   "weight": 5  },
    { "itemId": "epic_armor",    "weight": 15 },
    { "itemId": "gold_bag_large","weight": 40 },
    { "itemId": "nothing",       "weight": 40 }
  ]
}
```

Roll algorithm:
1. Roll N times (where N = `rolls`)
2. Each roll: pick entry by weighted random selection
3. `nothing` entries produce no drop

### Drop chance by tier

| Tier | dropMult | Effective rate vs common |
|------|----------|-------------------------|
| common | 1.0 | baseline |
| uncommon | 0.4 | 40% of common rate |
| rare | 0.15 | 15% |
| epic | 0.04 | 4% |
| legendary | 0.01 | 1% |
| artifact | 0.001 | 0.1% |

---

## Zone & World Generation

### VLDB-backed worlds

When a blueprint is linked to a VLDB world via `worldId`, the world contains:

1. **Terrain layer** — biome-appropriate terrain seeded from `world.seed`
2. **Zone borders** — chunk regions assigned to each zone in `blueprint.zones`
3. **Dungeon structures** — generated for zones where `isDungeon: true`
4. **NPC spawn points** — placed in zone cities/settlements
5. **Monster territories** — biome regions for each monster's `biomes` array

### Chunk coordinate system

```
World size 1024×512×1024 = 32×16×32 chunks (chunkSize=32)
Zone at chunkCoords {cx:4, cy:0, cz:8} spans voxels (128,0,256)→(384,512,512)
```

### Biome terrain rules

| Biome | Height | Terrain | Features |
|-------|--------|---------|---------|
| plains | flat ~70 | grass/dirt | villages, farms |
| forest | rolling ~80 | grass + leaves | trees, mushrooms |
| mountains | high ~120 | stone/snow | caves, peaks |
| desert | flat ~65 | sand | dunes, oases |
| ocean | below ~64 | water | reefs, shipwrecks |
| dungeon | underground | stone/obsidian | corridors, chambers |

---

## MMO Multiplayer Mode

### Blueprint → MMO world

1. Admin creates blueprint with `mode: 'mmo'`
2. AI generates all 8 sections (world, npcs, monsters, quests, loot, levels, zones)
3. Admin publishes: `POST /game/mmo/publish/:id`
4. World appears in Game Client (`GET /game/mmo/worlds`)
5. Users join → navigated to MMO Engine

### MMO-specific blueprint fields

```json
{
  "mmo": {
    "maxPlayers":     100,
    "pvpEnabled":     false,
    "respawnEnabled": true,
    "serverRegion":   "default",
    "openBeta":       true
  }
}
```

### Multiplayer game loop

```
User joins → /mmo/join → assigned zone → WebSocket /mmo/ws
  ↕ continuous
Movement events → /mmo/event → VSL reducer → broadcast to zone peers
  ↕ periodic
Zone tick → tick-sync module → deterministic state update
  ↕ on conflict
State CRC mismatch → healer module → checkpoint + verify + correct
```

---

## NPC Dialogue System

```json
{
  "dialogue": {
    "greeting":  ["Welcome, traveler!", "What brings you here?"],
    "topics": [
      {
        "id":       "rumors",
        "trigger":  "Tell me about the area.",
        "response": "Beware the eastern forest — wolves have been restless lately.",
        "unlocksTopics": ["wolves_quest"]
      },
      {
        "id":       "wolves_quest",
        "trigger":  "What's wrong with the wolves?",
        "response": "They say something dark stirs in the old ruins. A quest for you, perhaps.",
        "givesQuest":"q007"
      }
    ],
    "farewell":  ["Safe travels.", "Come back soon."]
  }
}
```

### NPC schedule

NPCs follow daily schedules:
```json
"schedule": [
  { "time": "06:00", "location": "home",   "activity": "sleeping" },
  { "time": "08:00", "location": "smithy", "activity": "working"  },
  { "time": "12:00", "location": "tavern", "activity": "eating"   },
  { "time": "18:00", "location": "smithy", "activity": "working"  },
  { "time": "22:00", "location": "home",   "activity": "sleeping" }
]
```

---

## Quest Reward System

### XP rewards by quest type

| Type | Base XP | Notes |
|------|---------|-------|
| main | 1000–5000 | Scales with story act |
| side | 200–800 | Scales with quest level |
| daily | 50–200 | Resets every 24h |
| hidden | 500–2000 | Bonus for discovery |
| legendary | 5000–20000 | One per playthrough |

### Reputation system

Factions track reputation independently:
```
-1000 to +1000 scale
< -500: Hostile (attacks on sight)
-500 to -100: Unfriendly (no services)
-100 to +100: Neutral
+100 to +500: Friendly (discounts)
> +500: Exalted (unique services, quests)
```
