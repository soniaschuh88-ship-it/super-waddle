/**
 * server/bkg-game.js — bKG Game Creation System
 *
 * AI-powered game design pipeline.
 * Supports full production-ready game development through structured
 * design documents that seed the coding agent.
 *
 * Pipeline:
 *   World → Story → NPCs → Quests → Technical Plan → GAMEPLAN.md → Agent Execution
 *
 * Each document type has:
 *   • A structured data schema (stored in Flow task metadata)
 *   • An AI prompt builder (generates the .md file via /providers/proxy)
 *   • A serializer (outputs agent-ready instructions)
 */

// ── Genres + Tones ────────────────────────────────────────────────────────────

export const GAME_GENRES = [
  { id:'rpg',        label:'RPG',             desc:'Role-playing with character progression' },
  { id:'action',     label:'Action',          desc:'Combat-focused, fast-paced gameplay' },
  { id:'adventure',  label:'Adventure',       desc:'Exploration, puzzles, narrative' },
  { id:'platformer', label:'Platformer',      desc:'Jump-and-run mechanics' },
  { id:'strategy',   label:'Strategy',        desc:'Resource management, planning' },
  { id:'horror',     label:'Horror',          desc:'Atmospheric dread and survival' },
  { id:'puzzle',     label:'Puzzle',          desc:'Logic and problem solving' },
  { id:'simulation', label:'Simulation',      desc:'Real-world system modeling' },
  { id:'roguelike',  label:'Roguelike',       desc:'Procedural, permadeath, runs' },
  { id:'visual-novel',label:'Visual Novel',   desc:'Story-driven, branching dialogue' },
];

export const GAME_TONES = [
  { id:'dark',     label:'Dark & Gritty',   color:'#4a1010' },
  { id:'heroic',   label:'Heroic & Epic',   color:'#c97800' },
  { id:'cozy',     label:'Cozy & Wholesome',color:'#3a7a3a' },
  { id:'sci-fi',   label:'Sci-Fi & Tech',   color:'#004a8a' },
  { id:'gothic',   label:'Gothic & Dark Fantasy', color:'#4a1060' },
  { id:'comedic',  label:'Comedic & Lighthearted', color:'#7a6a00' },
  { id:'mystery',  label:'Mystery & Noir',  color:'#1a2a3a' },
  { id:'mythic',   label:'Mythic & Ancient',color:'#6a3a00' },
];

export const GAME_ENGINES = [
  { id:'godot4',    label:'Godot 4',         lang:'GDScript / C#', free:true },
  { id:'phaser3',   label:'Phaser 3',        lang:'JavaScript / TypeScript', free:true },
  { id:'kaboom',    label:'Kaboom.js',       lang:'JavaScript', free:true },
  { id:'unity',     label:'Unity',           lang:'C#', free:false },
  { id:'pygame',    label:'Pygame / Python', lang:'Python', free:true },
  { id:'custom-ts', label:'Custom TypeScript Engine', lang:'TypeScript', free:true },
  { id:'custom-js', label:'Custom JavaScript Engine', lang:'JavaScript', free:true },
];

// ── Prompt builders ───────────────────────────────────────────────────────────

export function buildWorldPrompt(world) {
  return {
    system: `You are a world-builder and lore designer for video games.
Generate a detailed WORLD.md document based on the game concept provided.
Include: geography, factions, history, rules of the world (magic/tech systems),
culture, key locations, and atmosphere. Be specific and internally consistent.
Format as structured Markdown with clear sections. Be vivid but concise.`,
    user: `Create the world document for this game:

**Title**: ${world.title || 'Untitled Game'}
**Genre**: ${world.genre || 'RPG'}
**Tone**: ${world.tone || 'Dark Fantasy'}
**Engine**: ${world.engine || 'Godot 4'}

**World Concept**: ${world.concept || 'A world on the edge of destruction'}

**Factions/Groups**: ${world.factions || 'To be defined'}
**Geography**: ${world.geography || 'Continents, cities, wilderness'}
**Magic/Tech System**: ${world.magicSystem || 'None specified'}
**Key Locations**: ${world.locations || 'To be defined'}

Generate the complete WORLD.md document.`,
  };
}

export function buildStoryPrompt(story, world) {
  return {
    system: `You are a narrative designer for video games.
Generate a detailed STORY.md document with the full narrative arc.
Include: story structure, main beats, protagonist/antagonist, major plot points,
subplots, and chapter/act breakdown. Make it compelling and game-appropriate.`,
    user: `Create the story document for:

**Game**: ${world?.title || 'Untitled'}
**Genre**: ${world?.genre || 'RPG'}
**Tone**: ${world?.tone || 'Dark Fantasy'}

**Story Structure**: ${story.structure || '3-act'}
**Theme**: ${story.theme || 'Redemption'}
**Protagonist**: ${story.protagonist || 'Unknown hero'}
**Antagonist**: ${story.antagonist || 'Unknown villain'}
**Core Conflict**: ${story.conflict || 'Good vs Evil'}
**Opening Scene**: ${story.openingScene || 'Not specified'}
**Climax**: ${story.climax || 'Not specified'}
**Ending**: ${story.ending || 'Player choice'}

Generate the complete STORY.md document with act breakdown and key beats.`,
  };
}

export function buildNPCsPrompt(npcs, world, story) {
  const npcList = Array.isArray(npcs.characters) && npcs.characters.length > 0
    ? npcs.characters.map((n, i) => `${i+1}. ${n.name} (${n.role}): ${n.description || ''}`).join('\n')
    : 'Generate 6-8 essential NPCs for the story.';

  return {
    system: `You are a character designer for video games.
Generate a detailed NPCS.md document with full NPC profiles.
For each NPC include: name, role, faction, personality traits, backstory summary,
appearance, behavioral flags (hostile/friendly/neutral/merchant/questgiver),
dialogue style, and mechanical purpose in gameplay.
Also output a structured JSON array at the end of the document.`,
    user: `Create NPC profiles for:

**Game**: ${world?.title || 'Untitled'}
**Setting**: ${world?.concept || 'Fantasy world'}

**Characters to develop**:
${npcList}

Generate NPCS.md with full profiles and a \`\`\`json\`\`\` NPC data block at the end.`,
  };
}

export function buildQuestsPrompt(quests, world, story) {
  const questList = Array.isArray(quests.quests) && quests.quests.length > 0
    ? quests.quests.map((q, i) => `${i+1}. ${q.title} (${q.type}): ${q.description || ''}`).join('\n')
    : 'Generate a main quest line and 4-6 side quests.';

  return {
    system: `You are a quest designer for video games.
Generate a detailed QUESTS.md document with full quest specifications.
For each quest include: title, type (main/side/hidden), objectives list,
prerequisites, rewards (XP/items/story), failure conditions, related NPCs,
and narrative context. Also output a structured JSON quest data block.`,
    user: `Create quest designs for:

**Game**: ${world?.title || 'Untitled'}
**Genre**: ${world?.genre || 'RPG'}
**Story Theme**: ${story?.theme || 'Adventure'}

**Quests to design**:
${questList}

Generate QUESTS.md with full specifications and a \`\`\`json\`\`\` quest data block.`,
  };
}

export function buildGamePlanPrompt(gameData) {
  const { world, story, engine, projectTitle } = gameData;

  return {
    system: `You are a senior game developer and technical architect.
Generate a comprehensive GAMEPLAN.md + PROMPT.md for a coding agent to implement this game.

The document must be detailed enough that an AI coding agent can implement the entire game
from scratch. Include:

1. **Technical Architecture**: Engine setup, project structure, core systems
2. **Entity Component Design**: Player, enemies, NPCs, items, environment
3. **Game Loop**: Update cycle, state machine, scene management
4. **Core Systems**: Physics/collision, combat, inventory, dialogue, quest tracking
5. **Asset Pipeline**: Sprites, sounds, tilemaps — use procedural/geometric placeholders
6. **Save/Load System**: Data serialization, persistence
7. **UI/UX**: HUD, menus, dialogue boxes, quest log
8. **Implementation Order**: Step-by-step coding sequence for the agent

Format as GAMEPLAN.md with a final PROMPT.md section that the coding agent reads first.`,
    user: `Create the complete technical game plan for:

**Title**: ${projectTitle || 'Untitled Game'}
**Engine**: ${engine?.label || 'Godot 4'} (${engine?.lang || 'GDScript'})
**Genre**: ${world?.genre || 'RPG'}
**Tone**: ${world?.tone || 'Dark Fantasy'}

**World Summary**: ${world?.concept || 'A rich fantasy world'}
**Story**: ${story?.conflict || 'Hero vs antagonist'} — ${story?.theme || 'redemption'}
**Protagonist**: ${story?.protagonist || 'Unknown hero'}

**Special Requirements**:
- All assets should be procedurally generated or use simple geometric shapes
- Game must be fully playable from start to finish
- Include win/lose conditions
- Must run at 60fps on mid-range hardware

Generate the complete GAMEPLAN.md and then the PROMPT.md agent instruction.`,
  };
}

// ── Game task metadata schema ─────────────────────────────────────────────────

/**
 * Returns the default empty game design document structure.
 * Stored as JSON in task.metadata.gameDesign
 */
export function emptyGameDesign() {
  return {
    mode:    'game',
    world:   { title:'', genre:'rpg', tone:'heroic', concept:'', factions:'', geography:'', magicSystem:'', locations:'' },
    story:   { structure:'3-act', theme:'', protagonist:'', antagonist:'', conflict:'', openingScene:'', climax:'', ending:'' },
    npcs:    { characters: [] },
    quests:  { quests: [] },
    engine:  GAME_ENGINES[0],
    docs:    { world:'', story:'', npcs:'', quests:'', gameplan:'' },
  };
}

/**
 * Assemble the final agent PROMPT.md from all game documents.
 * This is what gets saved to flow task.prompt_md.
 */
export function assembleGamePromptMd(design) {
  const { world, story, docs, engine } = design;
  return `# GAME PROJECT: ${world.title || 'Untitled Game'}

> **Engine**: ${engine?.label || 'Godot 4'} · **Genre**: ${world.genre} · **Tone**: ${world.tone}
> This document contains all game design specifications. Implement each section in order.

---

${docs.world  ? `## 🌍 World Document\n\n${docs.world}\n\n---\n` : ''}
${docs.story  ? `## 📖 Story Document\n\n${docs.story}\n\n---\n` : ''}
${docs.npcs   ? `## 👥 NPC Profiles\n\n${docs.npcs}\n\n---\n` : ''}
${docs.quests ? `## ⚔️ Quest Designs\n\n${docs.quests}\n\n---\n` : ''}

## 🛠️ Technical Game Plan

${docs.gameplan || `Implement a ${world.genre} game using ${engine?.label || 'Godot 4'}.
Story: ${story.conflict || 'Hero defeats antagonist'}.
Theme: ${story.theme || 'Adventure and discovery'}.`}

---

## Agent Instructions

1. Read ALL design documents above before writing any code
2. Set up the ${engine?.label || 'Godot 4'} project structure first
3. Implement core systems before content (player → world → NPCs → quests)
4. Use procedural/geometric placeholders for all assets
5. Test each system before moving to the next
6. The game must be fully playable with win/lose conditions
`.trim();
}
