/**
 * server/bkg-game-blueprint.js — Full Game Blueprint System
 *
 * Schema + CRUD for complete game blueprints:
 *   World · Story · NPCs · Monsters · Quests · Loot · Levels · Zones
 *
 * Blueprints are stored in ~/.bkg/blueprints/*.json
 * Used by GameWizard (single-player) and MMOCreator (admin MMO worlds).
 */
import { join }        from 'path';
import { homedir }     from 'os';
import {
  mkdirSync, existsSync, readFileSync,
  writeFileSync, readdirSync, unlinkSync,
} from 'fs';
import { randomBytes, createHash } from 'crypto';

const BKG_DIR        = process.env.BKG_DIR ?? join(homedir(), '.bkg');
const BLUEPRINTS_DIR = join(BKG_DIR, 'blueprints');
mkdirSync(BLUEPRINTS_DIR, { recursive: true });

// ── Defaults ──────────────────────────────────────────────────────────────────

export const BLUEPRINT_DEFAULTS = {
  world: {
    seed: 0, size: { width:1024, height:512, depth:1024 }, chunkSize:32,
    seaLevel:64, climate:'temperate', magicLevel:'medium', techLevel:'medieval',
    biomes:['plains','forest','mountains','desert','ocean','dungeon'],
    description:'', dungeons:[], cities:[], landmarks:[],
  },
  story: {
    title:'', theme:'', tone:'dark', structure:'3-act',
    protagonist:{ class:'warrior', backstory:'', motivation:'' },
    antagonist: { name:'', type:'villain', motivation:'' },
    conflict:'', acts:[], endings:['good','bad','secret'],
  },
  loot: {
    currency:{ name:'Gold', symbol:'⟁' },
    itemTiers:[
      { id:'common',    name:'Common',    color:'#aaaaaa', dropMult:1.0  },
      { id:'uncommon',  name:'Uncommon',  color:'#1eff00', dropMult:0.4  },
      { id:'rare',      name:'Rare',      color:'#0070dd', dropMult:0.15 },
      { id:'epic',      name:'Epic',      color:'#a335ee', dropMult:0.04 },
      { id:'legendary', name:'Legendary', color:'#ff8000', dropMult:0.01 },
      { id:'artifact',  name:'Artifact',  color:'#e6cc80', dropMult:0.001},
    ],
    tables:[], items:[],
  },
  levels: {
    maxLevel:50, xpFormula:'level^2 * 100',
    statGrowth:{ hp:10, mp:5, strength:2, defense:2, speed:1 },
    baseStats: { hp:100, mp:50, strength:10, defense:8, speed:10 },
    equipSlots:['head','chest','legs','feet','hands','weapon','offhand','ring','amulet'],
    skillTrees:[], classes:[],
  },
  combat: {
    turnBased:false,
    hitFormula:'attacker.strength * 1.5 - defender.defense * 0.8 + random(-10,10)',
    critChance:0.05, critMultiplier:2.0,
    statusEffects:['burn','freeze','poison','stun','slow','blind'],
    aiPatterns:['patrol','guard','chase','flee','boss'],
  },
  economy: {
    inflation:1.0, shopTypes:['general','blacksmith','alchemist','magic','stable'],
    craftable:true, tradeable:true, auctionHouse:false,
  },
};

// ── Templates ─────────────────────────────────────────────────────────────────

export const npcTemplate  = (o={}) => ({ id:randomBytes(4).toString('hex'), name:'', type:'villager', faction:'neutral', level:1, location:'', schedule:[], dialogue:{ greeting:[], topics:[], farewell:[] }, inventory:[], quests:[], stats:{ hp:100,damage:10,defense:5 }, behavior:'friendly', backstory:'', appearance:'', isImmortal:false, ...o });
export const monsterTemplate = (o={}) => ({ id:randomBytes(4).toString('hex'), name:'', type:'beast', level:1, tier:'common', biomes:['plains'], spawnRate:0.5, spawnGroup:{ min:1,max:3 }, stats:{ hp:100,damage:15,defense:8,speed:8,xpReward:50,goldReward:{min:1,max:10} }, abilities:[], lootTable:[], aiPattern:'patrol', aggroRange:8, leashRange:32, immuneTo:[], weakTo:[], resistTo:[], description:'', ...o });
export const questTemplate   = (o={}) => ({ id:randomBytes(4).toString('hex'), title:'', type:'side', giverNpcId:null, prerequisiteQuestIds:[], prerequisiteLevel:1, objectives:[], stages:[], rewards:{ xp:100,gold:50,items:[],reputation:{},unlocksQuestIds:[] }, failConditions:[], timeLimit:null, repeatable:false, location:'', summary:'', description:'', isHidden:false, ...o });
export const itemTemplate    = (o={}) => ({ id:randomBytes(4).toString('hex'), name:'', type:'weapon', subtype:'sword', tier:'common', level:1, stackable:false, maxStack:1, weight:1.0, value:10, slot:null, stats:{}, effects:[], craftRecipe:null, description:'', lore:'', ...o });
export const zoneTemplate    = (o={}) => ({ id:randomBytes(4).toString('hex'), name:'', type:'overworld', biome:'forest', levelRange:{min:1,max:10}, size:{width:256,height:128,depth:256}, chunkCoords:{cx:0,cy:0,cz:0}, monsters:[], npcs:[], quests:[], weather:'clear', isDungeon:false, dungeonFloors:0, boss:null, entrances:[], description:'', ...o });

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function createBlueprint(opts={}) {
  const id  = randomBytes(8).toString('hex');
  const now = Date.now();
  const engine = opts.engine ?? { id:'godot4', label:'Godot 4', lang:'GDScript', free:true };
  const bp = {
    id, name: opts.name ?? 'New Game', description: opts.description ?? '',
    mode:  opts.mode  ?? 'singleplayer', genre: opts.genre ?? 'rpg',
    tone:  opts.tone  ?? 'dark', engine,
    status:'draft', version:1, worldId:null,
    createdAt:now, updatedAt:now, generatedSections:[],
    world:    { ...BLUEPRINT_DEFAULTS.world,   ...(opts.world   ?? {}) },
    story:    { ...BLUEPRINT_DEFAULTS.story,   ...(opts.story   ?? {}) },
    npcs:     opts.npcs     ?? [],
    monsters: opts.monsters ?? [],
    quests:   opts.quests   ?? [],
    loot:     { ...BLUEPRINT_DEFAULTS.loot,    ...(opts.loot    ?? {}) },
    levels:   { ...BLUEPRINT_DEFAULTS.levels,  ...(opts.levels  ?? {}) },
    combat:   { ...BLUEPRINT_DEFAULTS.combat,  ...(opts.combat  ?? {}) },
    economy:  { ...BLUEPRINT_DEFAULTS.economy, ...(opts.economy ?? {}) },
    zones:    opts.zones    ?? [],
    docs:     { world:'', story:'', npcs:'', monsters:'', quests:'', loot:'', levels:'', zones:'', gameplan:'' },
    mmo: opts.mode === 'mmo' ? {
      maxPlayers: opts.maxPlayers ?? 100, pvpEnabled: opts.pvpEnabled ?? false,
      respawnEnabled:true, serverRegion:'default', openBeta:true,
    } : null,
  };
  return saveBlueprint(bp);
}

export function saveBlueprint(bp) {
  bp.updatedAt = Date.now();
  bp.checksum  = createHash('sha256').update(JSON.stringify({...bp,checksum:''})).digest('hex').slice(0,16);
  writeFileSync(join(BLUEPRINTS_DIR, `${bp.id}.json`), JSON.stringify(bp, null, 2));
  return bp;
}

export function getBlueprint(id) {
  const p = join(BLUEPRINTS_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

export function listBlueprints(mode=null) {
  if (!existsSync(BLUEPRINTS_DIR)) return [];
  return readdirSync(BLUEPRINTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { const bp = JSON.parse(readFileSync(join(BLUEPRINTS_DIR,f),'utf-8')); return { id:bp.id, name:bp.name, mode:bp.mode, genre:bp.genre, tone:bp.tone, status:bp.status, worldId:bp.worldId, createdAt:bp.createdAt, updatedAt:bp.updatedAt, sections:bp.generatedSections??[], npcCount:bp.npcs?.length??0, monsterCount:bp.monsters?.length??0, questCount:bp.quests?.length??0, zoneCount:bp.zones?.length??0, engine:bp.engine }; } catch { return null; } })
    .filter(Boolean).filter(b => !mode || b.mode === mode)
    .sort((a,b) => b.updatedAt - a.updatedAt);
}

export function updateBlueprintSection(id, section, data) {
  const bp = getBlueprint(id);
  if (!bp) throw new Error(`Blueprint ${id} not found`);
  bp[section] = data;
  if (!bp.generatedSections.includes(section)) bp.generatedSections.push(section);
  return saveBlueprint(bp);
}

export function deleteBlueprint(id) {
  const p = join(BLUEPRINTS_DIR, `${id}.json`);
  if (existsSync(p)) unlinkSync(p);
  return { ok:true };
}

export function blueprintStats(bp) {
  const sections = ['world','story','npcs','monsters','quests','loot','levels','zones'];
  const gen = bp.generatedSections ?? [];
  return {
    id:bp.id, name:bp.name, completion:Math.round(gen.length/sections.length*100),
    sections: sections.map(s => ({ name:s, generated:gen.includes(s), count:Array.isArray(bp[s])?bp[s].length:(bp[s]?1:0) })),
    totals:{ npcs:bp.npcs?.length??0, monsters:bp.monsters?.length??0, quests:bp.quests?.length??0, items:bp.loot?.items?.length??0, zones:bp.zones?.length??0 },
  };
}

// ── AI prompts ────────────────────────────────────────────────────────────────

export function buildSectionPrompt(section, bp) {
  const { world, story, genre='rpg', tone='dark' } = bp;
  const P = {
    world: {
      system:`You are a game world designer. Write a detailed WORLD.md for a ${genre} game (${tone} tone). Include: geography, biomes, history, factions, magic/tech system, key locations. Output ONLY the document, no preamble.`,
      user:`Game: "${bp.name}"\nGenre: ${genre} | Tone: ${tone} | Magic: ${world.magicLevel} | Tech: ${world.techLevel}\nConcept: ${world.description||'Epic fantasy world'}`,
    },
    story: {
      system:`You are a narrative designer. Write a complete STORY.md with 3 acts, plot beats, protagonist arc, and antagonist motivation for a ${genre} game. Output structured Markdown only.`,
      user:`Game: "${bp.name}"\nProtagonist: ${story.protagonist?.class||'hero'}\nAntagonist: ${story.antagonist?.name||'unknown'}\nConflict: ${story.conflict||'good vs evil'}\nStructure: ${story.structure}`,
    },
    npcs: {
      system:`You are an NPC designer. Generate 8-12 NPCs as a JSON array. Each needs: name, type (villager/merchant/questgiver/guard/companion), faction, level, location, backstory (1 sentence), dialogue topics (3 items). Output ONLY valid JSON array.`,
      user:`Game: "${bp.name}" | World: ${world.description||'fantasy'} | Tone: ${tone}\nRequired: 2+ questgivers, 2+ merchants, 1+ companion`,
    },
    monsters: {
      system:`You are a monster designer. Generate 12-18 monsters as a JSON array. Each needs: name, type (beast/undead/demon/elemental/humanoid/dragon), level (1-${bp.levels?.maxLevel||50}), tier (common/elite/champion/boss), biomes (array), stats.hp, stats.damage, stats.defense, stats.xpReward, stats.goldReward, abilities (array of strings), description. Include 1 worldboss. Output ONLY valid JSON array.`,
      user:`Game: "${bp.name}" | Biomes: ${(world.biomes||[]).join(', ')} | Tone: ${tone}`,
    },
    quests: {
      system:`You are a quest designer. Generate a quest list as a JSON array with: 1 main quest chain (5 quests), 8 side quests, 3 hidden quests. Each: title, type (main/side/hidden), summary (1 sentence), objectives (array of strings), rewards.xp, rewards.gold. Output ONLY valid JSON array.`,
      user:`Game: "${bp.name}" | Conflict: ${story.conflict||'defeat evil'} | World: ${world.description||'fantasy'}`,
    },
    loot: {
      system:`You are a loot designer. Return a JSON object with two keys: "items" (array of 25-40 items) and "tables" (array of 5 loot tables). Each item: name, type (weapon/armor/consumable/material), subtype, tier (common/uncommon/rare/epic/legendary), level, value, description, lore (for rare+). Output ONLY valid JSON object.`,
      user:`Game: "${bp.name}" | Genre: ${genre} | Magic: ${world.magicLevel} | Tech: ${world.techLevel}`,
    },
    levels: {
      system:`You are a progression designer. Return a JSON object with: "classes" (array of 4-5 player classes, each with name, description, startingStats object, skillTree array of 10 skills). Output ONLY valid JSON object.`,
      user:`Game: "${bp.name}" | Max level: ${bp.levels?.maxLevel||50} | Genre: ${genre} | Combat: ${bp.combat?.turnBased?'turn-based':'real-time'}`,
    },
    zones: {
      system:`You are a level designer. Generate 8-12 zones as a JSON array. Each: name, type (overworld/dungeon/city/cave), biome, levelRange.min, levelRange.max, isDungeon (bool), boss (string or null), description. Include 3+ dungeons, 2+ cities. Output ONLY valid JSON array.`,
      user:`Game: "${bp.name}" | Biomes: ${(world.biomes||[]).join(', ')} | World: ${world.description||'fantasy'}`,
    },
    gameplan: {
      system:`You are a senior game developer. Write a GAMEPLAN.md that an AI coding agent will follow to build this game from scratch. Include: architecture, implementation order, core systems (world gen, combat, inventory, dialogue, quest tracker, save/load, HUD). Be specific and actionable.`,
      user:`Game: "${bp.name}" | Engine: ${bp.engine?.label||'Godot 4'} (${bp.engine?.lang||'GDScript'}) | Genre: ${genre} | Mode: ${bp.mode}`,
    },
  };
  return P[section] ?? { system:'Generate game content.', user:JSON.stringify(bp).slice(0,500) };
}
