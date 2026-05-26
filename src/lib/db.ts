/**
 * src/lib/db.ts – SQLite persistence via sql.js + localStorage serialisation.
 */
import initSqlJs, { type Database } from 'sql.js';
import type { Project, FeatureProposal, GeneratedBundle, ValidationResult } from '@/types';

const STORAGE_KEY = 'bkg_db';
let _db: Database | null = null;

export async function openDb(): Promise<Database> {
  if (_db) return _db;
  const SQL = await initSqlJs({ locateFile: (f: string) => `/${f}` });
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      _db = new SQL.Database(Uint8Array.from(atob(saved), c => c.charCodeAt(0)));
    } catch { _db = new SQL.Database(); }
  } else {
    _db = new SQL.Database();
  }
  _runMigrations(_db);
  return _db;
}

export function persistDb(): void {
  if (!_db) return;
  const b64 = btoa(String.fromCharCode(..._db.export()));
  localStorage.setItem(STORAGE_KEY, b64);
}

function _runMigrations(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, idea_text TEXT NOT NULL,
    proposed_features TEXT NOT NULL DEFAULT '[]',
    generated_bundle TEXT, validation_results TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  // Stats table for admin dashboard
  db.run(`CREATE TABLE IF NOT EXISTS generation_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    backend_type TEXT NOT NULL,
    model_id TEXT NOT NULL,
    doc_count INTEGER NOT NULL DEFAULT 5
  )`);
}

function _rowToProject(row: Record<string, string | null>): Project {
  return {
    id: row['id'] as string,
    idea_text: row['idea_text'] as string,
    proposed_features: JSON.parse(row['proposed_features'] ?? '[]') as FeatureProposal[],
    generated_bundle: row['generated_bundle'] ? JSON.parse(row['generated_bundle']) as GeneratedBundle : null,
    validation_results: row['validation_results'] ? JSON.parse(row['validation_results']) as ValidationResult : null,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  };
}

export async function createProject(project: Project): Promise<void> {
  const db = await openDb();
  db.run(`INSERT INTO projects (id,idea_text,proposed_features,generated_bundle,validation_results,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
    [project.id, project.idea_text, JSON.stringify(project.proposed_features),
     project.generated_bundle ? JSON.stringify(project.generated_bundle) : null,
     project.validation_results ? JSON.stringify(project.validation_results) : null,
     project.created_at, project.updated_at]);
  persistDb();
}

export async function updateProject(project: Project): Promise<void> {
  const db = await openDb();
  db.run(`UPDATE projects SET idea_text=?,proposed_features=?,generated_bundle=?,validation_results=?,updated_at=? WHERE id=?`,
    [project.idea_text, JSON.stringify(project.proposed_features),
     project.generated_bundle ? JSON.stringify(project.generated_bundle) : null,
     project.validation_results ? JSON.stringify(project.validation_results) : null,
     new Date().toISOString(), project.id]);
  persistDb();
}

export async function listProjects(): Promise<Project[]> {
  const db = await openDb();
  const res = db.exec('SELECT * FROM projects ORDER BY created_at DESC');
  if (!res.length) return [];
  const { columns, values } = res[0];
  return values.map(row => {
    const r: Record<string, string | null> = {};
    columns.forEach((c, i) => { r[c] = row[i] as string | null; });
    return _rowToProject(r);
  });
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await openDb();
  const res = db.exec('SELECT * FROM projects WHERE id=?', [id]);
  if (!res.length || !res[0].values.length) return null;
  const { columns, values } = res[0];
  const r: Record<string, string | null> = {};
  columns.forEach((c, i) => { r[c] = values[0][i] as string | null; });
  return _rowToProject(r);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  db.run('DELETE FROM projects WHERE id=?', [id]);
  persistDb();
}

export async function recordGeneration(backendType: string, modelId: string): Promise<void> {
  const db = await openDb();
  db.run(`INSERT INTO generation_stats (created_at,backend_type,model_id,doc_count) VALUES (?,?,?,5)`,
    [new Date().toISOString(), backendType, modelId]);
  persistDb();
}

export async function getStats(): Promise<{ totalGenerations: number; today: number; byBackend: Record<string, number> }> {
  const db = await openDb();
  const total = db.exec('SELECT COUNT(*) as n FROM generation_stats');
  const totalGenerations = (total[0]?.values[0]?.[0] as number) ?? 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayRes = db.exec(`SELECT COUNT(*) as n FROM generation_stats WHERE created_at LIKE '${todayStr}%'`);
  const today = (todayRes[0]?.values[0]?.[0] as number) ?? 0;
  const byBackendRes = db.exec('SELECT backend_type, COUNT(*) as n FROM generation_stats GROUP BY backend_type');
  const byBackend: Record<string, number> = {};
  if (byBackendRes.length) {
    byBackendRes[0].values.forEach(row => { byBackend[row[0] as string] = row[1] as number; });
  }
  return { totalGenerations, today, byBackend };
}

export function generateId(): string { return crypto.randomUUID(); }
