/** src/lib/validation.ts – Automated QA checks for the generated bundle. */
import type { GeneratedBundle, ValidationCheckId, ValidationResult, ValidationStep } from '@/types';

const META: Record<ValidationCheckId, { title: string; description: string }> = {
  redundancy:         { title: 'Redundancy Audit',        description: 'Scans for duplicate/overlapping role definitions.' },
  overkill:           { title: 'Overkill Gatekeeper',     description: 'Detects over-engineering relative to scope.' },
  'task-operability': { title: 'Task Operability Check',  description: 'Verifies tasks have criteria, deps, and are actionable.' },
  dependency:         { title: 'Dependency Validation',   description: 'Cross-references technologies across documents.' },
  'mvp-scope':        { title: 'MVP Scope-Bound Check',   description: 'Ensures MVP focus and flags gold-plating.' },
};

function checkRedundancy(b: GeneratedBundle): string[] {
  const f: string[] = [];
  const heads = (md: string) => Array.from(md.matchAll(/^#{2,3}\s+(.+)$/gm)).map(m=>m[1].toLowerCase().trim());
  const ah = heads(b['agent.md']); const th = heads(b['tasks.md']);
  const ov = ah.filter(h=>th.some(t=>t===h||t.includes(h)||h.includes(t)));
  if (ov.length) f.push(`${ov.length} heading(s) overlap between agent.md and tasks.md: ${ov.slice(0,3).map(h=>`"${h}"`).join(', ')}.`);
  const ids = Array.from(b['tasks.md'].matchAll(/TASK-(\d+)/g)).map(m=>m[1]);
  const seen = new Set<string>(); const dups: string[] = [];
  for (const id of ids) { if (seen.has(id)) dups.push(`TASK-${id}`); else seen.add(id); }
  if (dups.length) f.push(`Duplicate task IDs: ${[...new Set(dups)].join(', ')}.`);
  return f;
}

function checkOverkill(b: GeneratedBundle): string[] {
  const f: string[] = []; const c = (b['architecture.md']+' '+b['agent.md']).toLowerCase();
  const isMicro = /microservice|micro-service/.test(c);
  for (const [pat, label] of [
    [/kubernetes|k8s/g,'Kubernetes'], [/service\s+mesh|istio/g,'Service mesh'],
    [/event\s+sourcing/g,'Event Sourcing'], [/cqrs/g,'CQRS'], [/graphql\s+federation/g,'GraphQL Federation'],
  ] as [RegExp, string][]) {
    if (!isMicro && pat.test(c)) f.push(`"${label}" detected — verify this complexity is warranted.`);
  }
  const phases = (b['roadmap.md'].match(/^## Phase/gm) ?? []).length;
  if (phases > 5) f.push(`Roadmap has ${phases} phases — consider consolidating.`);
  return f;
}

function checkTaskOperability(b: GeneratedBundle): string[] {
  const f: string[] = []; const tasks = b['tasks.md'];
  const tl = Array.from(tasks.matchAll(/^- \[[ x]\] (TASK-\w+):.*$/gm));
  if (!tl.length) { f.push('No tasks matching "- [ ] TASK-XXX:" format found.'); return f; }
  let mc=0,md=0;
  for (const m of tl) {
    const chunk = tasks.slice(tasks.indexOf(m[0]), tasks.indexOf(m[0])+400);
    if (!/acceptance criteria/i.test(chunk)) mc++;
    if (!/depends on/i.test(chunk)) md++;
  }
  if (mc) f.push(`${mc}/${tl.length} tasks missing acceptance criteria.`);
  if (md) f.push(`${md}/${tl.length} tasks missing "Depends on".`);
  if (tl.length < 10) f.push(`Only ${tl.length} tasks — more granular breakdown recommended.`);
  return f;
}

function checkDependency(b: GeneratedBundle): string[] {
  const f: string[] = [];
  const techs = Array.from(b['architecture.md'].matchAll(/`([a-zA-Z][a-zA-Z0-9\-_.]+)`/g)).map(m=>m[1].toLowerCase());
  const combined = (b['tasks.md']+b['roadmap.md']).toLowerCase();
  const stop = new Set(['the','and','or','in','at','by','for']);
  const orphaned = [...new Set(techs)].filter(t=>t.length>2&&!stop.has(t)&&!combined.includes(t));
  if (orphaned.length) f.push(`${orphaned.length} tech(s) in architecture.md not referenced elsewhere: ${orphaned.slice(0,5).join(', ')}.`);
  return f;
}

function checkMvpScope(b: GeneratedBundle): string[] {
  const f: string[] = [];
  const n = (b['tasks.md'].match(/^- \[[ x]\]/gm)??[]).length;
  if (n>30) f.push(`${n} tasks — aim for ≤25 for MVP.`);
  const combined = b['agent.md'].toLowerCase()+b['architecture.md'].toLowerCase();
  for (const kw of ['machine learning','blockchain','web3','multi-tenancy','i18n','white-label']) {
    if (combined.includes(kw)) f.push(`"${kw}" detected — confirm this is MVP-essential.`);
  }
  if (!/future|post-mvp|phase 3/i.test(b['roadmap.md'])) f.push('roadmap.md lacks a "Future Considerations" section.');
  return f;
}

const CHECKS = [
  { id:'redundancy' as ValidationCheckId, run:checkRedundancy },
  { id:'overkill' as ValidationCheckId, run:checkOverkill },
  { id:'task-operability' as ValidationCheckId, run:checkTaskOperability },
  { id:'dependency' as ValidationCheckId, run:checkDependency },
  { id:'mvp-scope' as ValidationCheckId, run:checkMvpScope },
];

export function buildInitialValidationResult(): ValidationResult {
  return { steps: CHECKS.map(({id})=>({id,...META[id],status:'pending',findings:[]})), passed:false };
}

export function runValidationStep(id: ValidationCheckId, bundle: GeneratedBundle): ValidationStep {
  const check = CHECKS.find(c=>c.id===id)!;
  const findings = check.run(bundle);
  const isFail = id==='task-operability'&&findings.some(f=>f.includes('No tasks'));
  return { id, ...META[id], status: findings.length ? (isFail?'fail':'warn') : 'pass', findings };
}

export function runAllValidation(bundle: GeneratedBundle): ValidationResult {
  const steps = CHECKS.map(({id})=>runValidationStep(id, bundle));
  return { steps, passed: steps.every(s=>s.status!=='fail'), completedAt: new Date().toISOString() };
}
