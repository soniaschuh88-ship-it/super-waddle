/**
 * src/lib/prompts.ts – All prompt templates for ICADP 3.0.
 */
import type { FeatureProposal } from '@/types';

export const FEATURE_SYSTEM_PROMPT = `You are a senior software architect. Analyse a raw product idea and propose the best MVP features.
Respond ONLY with valid JSON (no markdown fences):
[{"id":"<kebab-id>","title":"<Feature>","rationale":"<1-2 sentences>","accepted":true,"techHint":"<optional>"}]
Propose 5-10 features. Prefer simplicity. No gold-plating.`;

export function buildFeatureUserPrompt(idea: string): string {
  return `Product idea:\n"""\n${idea}\n"""\n\nPropose the best MVP features as JSON.`;
}

const PERSONA = `You are a senior software architect producing thorough, production-quality documentation.
Use clear Markdown (##, ###). Be specific: name technologies, patterns, file paths. No filler phrases.`;

export const AGENT_MD_SYSTEM = `${PERSONA}\n\nGenerate \`agent.md\` for an autonomous development agent. Include:
## Project Overview  ## Architecture Overview  ## Technology Stack (table)
## Implementation Guide (numbered steps)  ## Key Patterns & Best Practices  ## Acceptance Criteria
Output ONLY Markdown, no code fences around the whole document.`;

export function buildAgentMdUserPrompt(idea: string, features: FeatureProposal[]): string {
  const fl = features.filter(f=>f.accepted).map(f=>`- **${f.title}**: ${f.rationale}${f.techHint?` *(${f.techHint})*`:''}`).join('\n');
  return `Product:\n"""\n${idea}\n"""\n\nFeatures:\n${fl}\n\nGenerate agent.md.`;
}

export const ARCHITECTURE_MD_SYSTEM = `${PERSONA}\n\nGenerate \`architecture.md\`. Include:
## System Context  ## Component Diagram (ASCII/Mermaid)  ## Data Model
## API Design  ## Infrastructure & Deployment  ## Security Considerations
Output ONLY Markdown.`;

export function buildArchitectureMdUserPrompt(idea: string, features: FeatureProposal[]): string {
  const fl = features.filter(f=>f.accepted).map(f=>`${f.title}${f.techHint?` (${f.techHint})`:''}`).join(', ');
  return `Product: ${idea.slice(0,300)}\nFeatures: ${fl}\n\nGenerate architecture.md.`;
}

export const ROADMAP_MD_SYSTEM = `${PERSONA}\n\nGenerate \`roadmap.md\` with phased delivery:
## Phase 0 – Foundation  ## Phase 1 – MVP Core  ## Phase 2 – Feature Completeness
## Phase 3 – Hardening  ## Future Considerations
Each phase: duration estimate, deliverables, success criteria. Output ONLY Markdown.`;

export function buildRoadmapMdUserPrompt(idea: string, features: FeatureProposal[]): string {
  const fl = features.filter(f=>f.accepted).map(f=>`- ${f.title}`).join('\n');
  return `Product: ${idea.slice(0,300)}\nFeatures:\n${fl}\n\nGenerate roadmap.md.`;
}

export const TASKS_MD_SYSTEM = `${PERSONA}\n\nGenerate \`tasks.md\` with actionable tasks.
Format: - [ ] TASK-XXX: <verb> <noun>
After each task include: **Depends on**, **Acceptance criteria**, **Estimated complexity** (XS/S/M/L/XL)
15-30 tasks total, grouped by feature (## headings). Output ONLY Markdown.`;

export function buildTasksMdUserPrompt(idea: string, features: FeatureProposal[]): string {
  const fl = features.filter(f=>f.accepted).map(f=>`- **${f.title}**: ${f.rationale}`).join('\n');
  return `Product: ${idea.slice(0,200)}\nFeatures:\n${fl}\n\nGenerate tasks.md.`;
}

export const MANIFEST_SYSTEM = `You are a software architect generating a machine-readable project manifest.
Respond ONLY with a valid JSON array (no fences):
[{"path":"relative/path.ext","role":"one-line description","layer":"backend|frontend|infra|shared|test","priority":"high|medium|low"}]
10-25 files. Realistic paths. High = MVP must-have.`;

export function buildManifestUserPrompt(idea: string, features: FeatureProposal[]): string {
  const fl = features.filter(f=>f.accepted).map(f=>f.title).join(', ');
  return `Product: ${idea.slice(0,200)}\nFeatures: ${fl}\n\nGenerate manifest JSON array.`;
}

export interface PresetIdea { title: string; description: string; text: string; }

export const PRESET_IDEAS: PresetIdea[] = [
  { title: 'Microservices Notification Engine', description: 'Multi-channel alerting backbone',
    text: `Build a notification engine routing alerts across email, SMS, push, and Slack. Support per-user preferences, message templating, delivery retries with exponential back-off, delivery receipts, and an admin dashboard to monitor throughput and failures. Designed as independently deployable microservices over a message queue.` },
  { title: 'Culinary Meal Matcher', description: 'AI-powered recipe discovery from pantry items',
    text: `A web app where users photograph or type ingredients they have at home and get personalised recipe suggestions. Features: dietary restriction filtering, shopping list for missing ingredients, step-by-step cooking mode, favourites, meal planning calendar, nutritional breakdown.` },
  { title: 'Offline Markdown Collaborative Editor', description: 'Real-time sync with offline-first resilience',
    text: `Markdown editor that works offline-first and syncs edits in real-time for multiple users. Features: rich Markdown preview, document folders, full-text search, CRDT-based conflict resolution, version history with diff view, export to PDF/HTML. Target: web and Electron desktop.` },
];
