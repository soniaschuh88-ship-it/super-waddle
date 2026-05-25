/** src/lib/simulation.ts – Executor simulation timeline builder and playback. */
import type { GeneratedBundle, SimulationLogEntry, ManifestEntry } from '@/types';

let _seq = 0;
function uid(): string { return `sim-${Date.now()}-${_seq++}`; }

function parseManifest(raw: string): ManifestEntry[] {
  const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  try { const p = JSON.parse(cleaned); if (Array.isArray(p)) return p as ManifestEntry[]; } catch { /**/ }
  const seen = new Set<string>(); const entries: ManifestEntry[] = [];
  for (const m of raw.matchAll(/["']?([\w./\-]+\.(ts|tsx|js|jsx|py|go|json|yaml|md|css|html))["']?/g)) {
    if (!seen.has(m[1]) && m[1].length > 3) { seen.add(m[1]); entries.push({ path: m[1], role: 'Project file', layer: 'backend', priority: 'medium' }); }
  }
  return entries.slice(0, 20);
}

const DEFAULT_FILES: ManifestEntry[] = [
  { path:'package.json',            role:'Package manifest',         layer:'shared',   priority:'high' },
  { path:'.env.example',            role:'Env variable template',    layer:'infra',    priority:'high' },
  { path:'README.md',               role:'Project documentation',    layer:'shared',   priority:'high' },
  { path:'src/index.ts',            role:'Application entry point',  layer:'backend',  priority:'high' },
  { path:'src/config.ts',           role:'Configuration loader',     layer:'backend',  priority:'high' },
  { path:'src/db.ts',               role:'Database connection',      layer:'backend',  priority:'high' },
  { path:'src/routes/index.ts',     role:'Route aggregator',         layer:'backend',  priority:'high' },
  { path:'src/routes/auth.ts',      role:'Auth routes',              layer:'backend',  priority:'high' },
  { path:'src/controllers/auth.ts', role:'Auth controller',          layer:'backend',  priority:'medium' },
  { path:'src/models/user.ts',      role:'User model',               layer:'backend',  priority:'medium' },
  { path:'src/middleware/auth.ts',  role:'Auth middleware',          layer:'backend',  priority:'medium' },
  { path:'src/utils/logger.ts',     role:'Structured logger',        layer:'shared',   priority:'medium' },
  { path:'src/utils/errors.ts',     role:'Error helpers',            layer:'shared',   priority:'medium' },
  { path:'tests/auth.test.ts',      role:'Auth test suite',          layer:'test',     priority:'low' },
  { path:'docker-compose.yml',      role:'Local dev services',       layer:'infra',    priority:'low' },
];

export function buildSimulationTimeline(bundle: GeneratedBundle): SimulationLogEntry[] {
  const entries: SimulationLogEntry[] = []; let t = 0;
  function add(action: SimulationLogEntry['action'], message: string, filePath?: string) {
    entries.push({ id: uid(), timestamp: t, action, message, filePath });
    t += 80 + Math.floor(Math.random() * 120);
  }
  add('info', '▶  ICADP Executor Agent v3.0 starting'); t+=200;
  add('info', '📦  Receiving project_bundle.zip'); t+=300;
  add('info', '🔍  Unpacking project_bundle.zip…'); t+=300;
  add('create', '  ↳ Reading manifest.json', 'manifest.json'); t+=150;
  const manifest = parseManifest(bundle['manifest.json']);
  const files = manifest.length > 0 ? manifest : DEFAULT_FILES;
  const sorted = [...files].sort((a,b)=>({'high':0,'medium':1,'low':2}[a.priority]??1)-({'high':0,'medium':1,'low':2}[b.priority]??1)||a.path.length-b.path.length);
  add('info', `  ↳ Found ${sorted.length} file entries`); t+=200;
  add('info', '🚀  Bootstrapping development repository'); t+=400;
  add('info', '  ↳ Initialising git repository'); t+=200;
  add('info', '  ↳ Installing base dependencies'); t+=600;
  add('success', '  ✔ Repository initialised'); t+=300;
  add('info', '✍️   Writing project files…'); t+=300;
  for (const entry of sorted) add('write', `  ↳ writing ${entry.path}  (${entry.role.slice(0,45)})`, entry.path);
  t+=300;
  add('info', '🔧  Running post-scaffold hooks'); t+=400;
  const taskCount = (bundle['tasks.md'].match(/^- \[[ x]\]/gm)??[]).length;
  if (taskCount>0) add('info', `  ↳ Registering ${taskCount} tasks from tasks.md`);
  add('info', '  ↳ Formatting code (prettier)'); t+=500;
  add('success', '  ↳ Linting: 0 errors'); t+=300;
  add('success', '  ↳ Type-check: 0 errors'); t+=400; t+=500;
  add('success', ''); add('success', '✅  Scaffold complete!');
  add('info', `📁  Created ${sorted.length} files in project/`);
  add('info', '🎯  Next: review tasks.md and begin implementation');
  return entries;
}

export interface SimulationController { play:()=>void; pause:()=>void; reset:()=>void; readonly isPlaying:boolean; }

export function createSimulationController(
  entries: SimulationLogEntry[], onEntry: (e:SimulationLogEntry)=>void, onComplete:()=>void, speedMs=160
): SimulationController {
  let index=0, timerId: ReturnType<typeof setInterval>|null=null, playing=false;
  function play() {
    if (playing||index>=entries.length) return; playing=true;
    timerId = setInterval(()=>{ if(index>=entries.length){pause();onComplete();return;} onEntry(entries[index++]); }, speedMs);
  }
  function pause() { if(timerId!==null){clearInterval(timerId);timerId=null;} playing=false; }
  function reset() { pause(); index=0; }
  return { play, pause, reset, get isPlaying(){return playing;} };
}
