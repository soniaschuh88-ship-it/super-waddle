/**
 * src/lib/codegen.ts
 *
 * Real code generation engine — no simulation.
 *
 * Reads the project's manifest.json and planning documents, then uses the
 * configured LLM to write actual source code for each file, streamed in real-time.
 */

import { generateStreaming } from '@/lib/llm-client';
import type { BackendConfig, GeneratedBundle, ManifestEntry, ProjectFile } from '@/types';

// ── Language detection ────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts:'typescript', tsx:'typescript', js:'javascript', jsx:'javascript',
  py:'python', go:'go', rs:'rust', java:'java', cs:'csharp', cpp:'cpp',
  c:'c', rb:'ruby', php:'php', swift:'swift', kt:'kotlin',
  json:'json', yaml:'yaml', yml:'yaml', toml:'toml', md:'markdown',
  html:'html', css:'css', scss:'scss', sass:'scss', sql:'sql',
  sh:'shell', bash:'shell', dockerfile:'dockerfile', env:'ini',
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (filePath.toLowerCase() === 'dockerfile') return 'dockerfile';
  return EXT_LANG[ext] ?? 'plaintext';
}

// ── Manifest parsing ──────────────────────────────────────────────────────────

export function parseManifestEntries(raw: string): ManifestEntry[] {
  const cleaned = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed as ManifestEntry[];
  } catch { /**/ }
  return [];
}

/** Sort entries: high priority first, then backend before frontend, then alphabetical. */
export function sortManifestEntries(entries: ManifestEntry[]): ManifestEntry[] {
  const priOrder:   Record<string,number> = { high:0, medium:1, low:2 };
  const layerOrder: Record<string,number> = { infra:0, shared:1, backend:2, frontend:3, test:4 };
  return [...entries].sort((a,b) => {
    const pd = (priOrder[a.priority] ?? 1) - (priOrder[b.priority] ?? 1);
    if (pd !== 0) return pd;
    const ld = (layerOrder[a.layer] ?? 2) - (layerOrder[b.layer] ?? 2);
    if (ld !== 0) return ld;
    return a.path.localeCompare(b.path);
  });
}

// ── Milestone boundaries ──────────────────────────────────────────────────────

export interface MilestonePoint {
  phase:    number;
  label:    string;
  /** File index (0-based) AFTER which to pause. */
  afterIdx: number;
}

/** Divide total file count into 3 phases with milestone checkpoints. */
export function computeMilestones(total: number): MilestonePoint[] {
  const p1 = Math.floor(total * 0.35);
  const p2 = Math.floor(total * 0.70);
  return [
    { phase:1, label:'Phase 1 — Foundation complete',     afterIdx: p1 - 1 },
    { phase:2, label:'Phase 2 — Core features complete',  afterIdx: p2 - 1 },
    { phase:3, label:'Phase 3 — Project complete',        afterIdx: total - 1 },
  ];
}

// ── Code generation prompts ───────────────────────────────────────────────────

/**
 * Build a prompt that asks the LLM to write a specific file.
 *
 * @param entry         – Manifest entry for the target file
 * @param bundle        – The full planning bundle (agent.md etc.)
 * @param allEntries    – Full file list (for cross-file context)
 * @param userNotes     – Optional additional instructions from the user
 */
export function buildFileGenPrompt(
  entry:      ManifestEntry,
  bundle:     GeneratedBundle,
  allEntries: ManifestEntry[],
  userNotes   = '',
): { system: string; user: string } {
  const fileList = allEntries.map(e => `  ${e.path} — ${e.role}`).join('\n');

  const system = `You are an expert software engineer implementing a real project from a detailed plan.
Your job: write production-quality, working code for a SINGLE file.

Rules:
- Output ONLY the raw file content — NO markdown fences, NO explanation, NO prose
- The code must be complete and functional, not a stub or placeholder
- Follow the architecture in the planning documents exactly
- Include all necessary imports
- Add brief inline comments for non-obvious logic
- The file should integrate cleanly with the rest of the project

Project architecture summary (first 2000 chars of architecture.md):
---
${bundle['architecture.md'].slice(0,2000)}
---

Full project context (agent.md overview):
---
${bundle['agent.md'].slice(0,1500)}
---

All files in this project (for import paths):
${fileList}
${userNotes ? `\nExtra instructions from user:\n${userNotes}` : ''}`;

  const user = `Write the complete content for this file:

Path: ${entry.path}
Role: ${entry.role}
Layer: ${entry.layer}

Output the raw file content now.`;

  return { system, user };
}

/** Prompt asking the agent to suggest new features at a milestone. */
export function buildMilestoneSuggestionPrompt(
  phase: number,
  bundle: GeneratedBundle,
  filesWritten: ManifestEntry[],
): { system: string; user: string } {
  return {
    system: `You are a senior software architect reviewing a project at a milestone.
Respond ONLY with a JSON object (no fences):
{"suggestions": ["<feature idea 1>", "<feature idea 2>", "<feature idea 3>"]}
Keep suggestions specific, implementable, and relevant to what was already built.`,
    user: `Project: ${bundle['agent.md'].slice(0,500)}

Phase ${phase} just completed. Files written: ${filesWritten.map(f=>f.path).join(', ')}

Suggest 3 concrete next features or improvements the user might want to add.`,
  };
}

// ── Main code generation runner ───────────────────────────────────────────────

export interface CodegenCallbacks {
  onFileStart:   (entry: ManifestEntry, fileIdx: number, total: number) => void;
  onFileChunk:   (path: string, chunk: string) => void;
  onFileComplete:(file: ProjectFile) => void;
  onMilestone:   (phase: number, label: string, filesWritten: ManifestEntry[], suggestions: string[]) => void;
  onComplete:    (allFiles: ProjectFile[]) => void;
  onError:       (error: string) => void;
}

/** Running codegen instance — call .abort() to stop. */
export interface CodegenHandle {
  abort(): void;
  /** Resume after a milestone pause. Optionally pass new user instructions. */
  resume(userNotes?: string): void;
}

/**
 * Generate all project files from a planning bundle.
 *
 * Streams each file to the UI via callbacks. Pauses at milestone checkpoints
 * waiting for the caller to call `handle.resume()`.
 */
export function startCodegen(
  bundle:    GeneratedBundle,
  config:    BackendConfig,
  callbacks: CodegenCallbacks,
): CodegenHandle {
  const entries = sortManifestEntries(parseManifestEntries(bundle['manifest.json']));
  const milestones = computeMilestones(entries.length);
  const allFiles: ProjectFile[] = [];
  let aborted = false;

  // Resume mechanism: a promise resolver per milestone pause
  let resumeResolve: ((notes: string) => void) | null = null;

  async function run() {
    let userNotes = '';

    for (let i = 0; i < entries.length; i++) {
      if (aborted) break;
      const entry = entries[i];

      // Notify UI that this file is starting
      callbacks.onFileStart(entry, i, entries.length);

      // Create the file record with empty content and isStreaming=true
      const file: ProjectFile = {
        path:        entry.path,
        content:     '',
        language:    detectLanguage(entry.path),
        role:        entry.role,
        isStreaming: true,
        versionIdx:  milestones.findIndex(m => m.afterIdx >= i),
      };
      allFiles.push(file);
      callbacks.onFileComplete({ ...file }); // signal file created (empty, streaming)

      // Generate content via LLM
      const { system, user } = buildFileGenPrompt(entry, bundle, entries, userNotes);
      let content = '';

      try {
        content = await generateStreaming(
          system, user,
          (chunk) => {
            file.content += chunk;
            callbacks.onFileChunk(entry.path, chunk);
          },
          6000,
          config,
        );
      } catch (err) {
        callbacks.onError(`Failed to generate ${entry.path}: ${err instanceof Error ? err.message : 'unknown error'}`);
        if (aborted) break;
        continue;
      }

      file.content     = content;
      file.isStreaming = false;
      callbacks.onFileComplete({ ...file });

      // ── Milestone check ───────────────────────────────────────────────────
      const milestone = milestones.find(m => m.afterIdx === i);
      if (milestone && i < entries.length - 1 && !aborted) {
        // Get AI suggestions for next features
        let suggestions: string[] = [];
        try {
          const { system: ms, user: mu } = buildMilestoneSuggestionPrompt(
            milestone.phase, bundle, entries.slice(0, i+1),
          );
          const result = await generateStreaming(ms, mu, ()=>{}, 500, config);
          const clean = result.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/i,'').trim();
          const parsed = JSON.parse(clean) as { suggestions: string[] };
          suggestions = parsed.suggestions ?? [];
        } catch { /* ignore suggestion errors */ }

        callbacks.onMilestone(milestone.phase, milestone.label, entries.slice(0,i+1), suggestions);

        // Wait for user to call resume()
        userNotes = await new Promise<string>(resolve => { resumeResolve = resolve; });
        resumeResolve = null;
        if (aborted) break;
      }
    }

    if (!aborted) callbacks.onComplete(allFiles);
  }

  // Start async — don't await here so we return the handle immediately
  run().catch(err => callbacks.onError(String(err)));

  return {
    abort: () => { aborted = true; resumeResolve?.(''); },
    resume: (notes = '') => { resumeResolve?.(notes); },
  };
}
