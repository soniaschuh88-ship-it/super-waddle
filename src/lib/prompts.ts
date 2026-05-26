/**
 * src/lib/prompts.ts – All prompt templates for bKG.
 */
import type { FeatureProposal } from '@/types';

// ── Idea enhancement ─────────────────────────────────────────────────────────

export const ENHANCE_IDEA_SYSTEM = `You are a senior product manager and software architect.
Your task: take a rough product idea and rewrite it as a clear, detailed product brief.

Rules:
- Keep the original intent exactly — do NOT change what the product is
- Add: target users, core use-cases, key constraints, tech context if implied
- Output ONLY the improved idea text (plain text, no headings, no bullet lists)
- Length: 150–300 words
- Tone: direct, technical, no marketing fluff`;

export function buildEnhanceIdeaUserPrompt(idea: string): string {
  return `Enhance this product idea into a clear brief:\n"""\n${idea}\n"""`;
}

// ── Feature proposals ─────────────────────────────────────────────────────────

export const FEATURE_SYSTEM_PROMPT = `You are a senior software architect. Analyse a product idea and propose MVP features.
Respond ONLY with valid JSON array (no markdown fences, no prose):
[{
  "id":         "<kebab-case-id>",
  "title":      "<Feature Name>",
  "rationale":  "<1-2 sentence value explanation>",
  "accepted":   true,
  "priority":   "high"|"medium"|"low",
  "complexity": "XS"|"S"|"M"|"L"|"XL",
  "techHint":   "<optional tech/library suggestion>"
}]
Propose 6–12 features. Prefer simplicity. High priority = MVP-critical. No gold-plating.`;

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
