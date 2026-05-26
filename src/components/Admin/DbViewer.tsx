/**
 * src/components/Admin/DbViewer.tsx
 *
 * SQLite Database Viewer for bKG Admin
 * - Lists all known databases (Flow, Users)
 * - Per-table row counts + column info
 * - Paginated row browser with search
 * - Read-only SQL query console
 */

import { useState, useEffect, useRef } from 'react';
import {
  Database, Table2, Search, ChevronLeft, ChevronRight,
  RefreshCw, Play, AlertCircle, Loader2,
} from 'lucide-react';

const getToken = (): string => localStorage.getItem('bkg_admin_token') ?? '';
const H = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

interface DBInfo  { id: string; label: string; path: string; exists: boolean; size: number }
interface Table   { name: string; rows: number; columns: string[] }
interface RowData { table: string; columns: string[]; rows: Record<string,unknown>[]; total: number; limit: number; offset: number }

export function DbViewer() {
  const [dbs,         setDbs]         = useState<DBInfo[]>([]);
  const [selectedDb,  setSelectedDb]  = useState('flow');
  const [tables,      setTables]      = useState<Table[]>([]);
  const [selectedTbl, setSelectedTbl] = useState('');
  const [data,        setData]        = useState<RowData | null>(null);
  const [search,      setSearch]      = useState('');
  const [offset,      setOffset]      = useState(0);
  const [limit]                       = useState(50);
  const [loading,     setLoading]     = useState(false);
  const [err,         setErr]         = useState('');

  // SQL console
  const [sql,         setSql]         = useState('SELECT * FROM tasks LIMIT 20');
  const [queryResult, setQueryResult] = useState<Record<string,unknown>[] | null>(null);
  const [queryErr,    setQueryErr]    = useState('');
  const [querying,    setQuerying]    = useState(false);
  const [showConsole, setShowConsole] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  // Load databases
  useEffect(() => {
    fetch('/admin/db/databases', { headers: H() })
      .then(r => r.ok ? r.json() : null)
      .then((d: { databases: DBInfo[] } | null) => {
        if (d) setDbs(d.databases);
      }).catch(() => {});
  }, []);

  // Load tables when DB changes
  useEffect(() => {
    setTables([]); setSelectedTbl(''); setData(null); setErr('');
    setLoading(true);
    fetch(`/admin/db/${selectedDb}/tables`, { headers: H() })
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error)))
      .then((d: { tables: Table[] }) => setTables(d.tables))
      .catch(e => setErr(typeof e === 'string' ? e : 'Failed to load tables'))
      .finally(() => setLoading(false));
  }, [selectedDb]);

  // Load rows when table/search/offset changes
  useEffect(() => {
    if (!selectedTbl) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setLoading(true); setErr('');
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search) q.set('search', search);
      fetch(`/admin/db/${selectedDb}/table/${selectedTbl}?${q}`, { headers: H() })
        .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error)))
        .then((d: RowData) => setData(d))
        .catch(e => setErr(typeof e === 'string' ? e : 'Failed to load rows'))
        .finally(() => setLoading(false));
    }, search ? 300 : 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTbl, selectedDb, search, offset, limit]);

  const runQuery = async () => {
    if (!sql.trim()) return;
    setQuerying(true); setQueryErr(''); setQueryResult(null);
    const r = await fetch(`/admin/db/${selectedDb}/query`, {
      method: 'POST', headers: H(), body: JSON.stringify({ sql }),
    });
    const d = await r.json() as { rows?: Record<string,unknown>[]; error?: string };
    if (r.ok) setQueryResult(d.rows ?? []);
    else setQueryErr(d.error ?? 'Query failed');
    setQuerying(false);
  };

  const selectTable = (name: string) => {
    setSelectedTbl(name); setOffset(0); setSearch(''); setData(null);
    setSql(`SELECT * FROM ${name} LIMIT 20`);
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const curPage    = data ? Math.floor(data.offset / limit) + 1 : 1;

  const formatVal = (v: unknown): string => {
    if (v === null || v === undefined) return '·';
    if (typeof v === 'string' && v.length > 80) return v.slice(0, 80) + '…';
    return String(v);
  };

  return (
    <div className="flex h-full min-h-0 gap-0 overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-52 flex-shrink-0 border-r border-border/50 flex flex-col overflow-hidden bg-panel/30">
        {/* DB selector */}
        <div className="px-3 py-3 border-b border-border/40">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted/50 mb-2">Database</p>
          <div className="flex flex-col gap-1">
            {dbs.map(db => (
              <button key={db.id} onClick={() => setSelectedDb(db.id)}
                disabled={!db.exists}
                className={[
                  'flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[11px] transition-all',
                  selectedDb === db.id ? 'bg-accent/10 text-accent border border-accent/25' : 'text-muted hover:bg-white/4 border border-transparent',
                  !db.exists ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                ].join(' ')}>
                <Database size={11} className="flex-shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{db.label}</p>
                  <p className="text-[9px] opacity-60">{db.exists ? `${(db.size/1024).toFixed(0)} KB` : 'not found'}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Tables */}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted/50 mb-2">Tables</p>
          {loading && !tables.length && (
            <div className="flex items-center gap-2 text-muted/40 text-[11px] py-2">
              <Loader2 size={11} className="animate-spin"/> Loading…
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {tables.map(t => (
              <button key={t.name} onClick={() => selectTable(t.name)}
                className={[
                  'flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[11px] transition-all',
                  selectedTbl === t.name ? 'bg-accent/8 text-accent' : 'text-muted/70 hover:text-text-primary hover:bg-white/4',
                ].join(' ')}>
                <Table2 size={9} className="flex-shrink-0 opacity-60"/>
                <span className="flex-1 truncate font-mono">{t.name}</span>
                <span className="text-[9px] tabular-nums opacity-50">{t.rows.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>

        {/* SQL console toggle */}
        <div className="px-3 pb-3 border-t border-border/40 pt-2">
          <button onClick={() => setShowConsole(p => !p)}
            className={[
              'w-full flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all',
              showConsole ? 'bg-mystic/10 text-mystic border border-mystic/25' : 'text-muted border border-border/40 hover:text-text-primary hover:border-accent/30',
            ].join(' ')}>
            <Play size={10}/> SQL Console
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* SQL console */}
        {showConsole && (
          <div className="flex-shrink-0 border-b border-border/50 bg-base/80 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-mystic/70 uppercase tracking-wider">SQL</span>
              <span className="text-[9px] text-muted/40">SELECT, WITH, PRAGMA only</span>
            </div>
            <div className="flex gap-2">
              <textarea
                value={sql}
                onChange={e => setSql(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void runQuery(); }}
                rows={2}
                className="flex-1 bg-base border border-border font-mono text-[11px] text-text-primary rounded-lg px-3 py-2 focus:outline-none focus:border-mystic/40 resize-none"
                placeholder="SELECT * FROM tasks WHERE status='in-progress'"
              />
              <button onClick={runQuery} disabled={querying}
                className="px-3 py-2 rounded-lg bg-mystic/15 border border-mystic/30 text-mystic text-[11px] font-bold hover:brightness-110 transition-all disabled:opacity-50 flex items-center gap-1.5">
                {querying ? <Loader2 size={12} className="animate-spin"/> : <Play size={12}/>}Run
              </button>
            </div>
            {queryErr && (
              <div className="flex items-center gap-2 text-[11px] text-error/80 font-mono px-2">
                <AlertCircle size={10}/>{queryErr}
              </div>
            )}
            {queryResult && (
              <div className="text-[10px] text-muted/50 px-1">{queryResult.length} rows</div>
            )}
          </div>
        )}

        {/* Table toolbar */}
        {selectedTbl && !showConsole && (
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-panel/20">
            <Table2 size={13} className="text-accent/60 flex-shrink-0"/>
            <span className="text-sm font-mono font-bold text-text-primary">{selectedTbl}</span>
            {data && <span className="text-[11px] text-muted/50">{data.total.toLocaleString()} rows</span>}

            <div className="flex items-center gap-1.5 ml-auto">
              <div className="flex items-center gap-1.5 bg-base/80 border border-border/60 rounded-lg px-2.5 py-1">
                <Search size={10} className="text-muted/40"/>
                <input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setOffset(0); }}
                  placeholder="Search…"
                  className="bg-transparent text-[11px] text-text-primary focus:outline-none w-28 placeholder:text-muted/30"
                />
              </div>
              <button onClick={() => { setData(null); setLoading(true); }}
                className="text-muted/40 hover:text-accent transition-colors p-1.5">
                <RefreshCw size={12}/>
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {err && (
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-error/10 border-b border-error/20 text-error/80 text-[11px]">
            <AlertCircle size={12}/>{err}
          </div>
        )}

        {/* Table data */}
        <div className="flex-1 overflow-auto min-h-0">
          {!selectedTbl && !showConsole && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <Database size={32} strokeWidth={1} className="text-muted/20"/>
              <p className="text-sm text-muted/40">Select a table to browse data</p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center h-full gap-2 text-muted/40">
              <Loader2 size={16} className="animate-spin"/> Loading…
            </div>
          )}

          {/* Row table */}
          {!loading && (data || queryResult) && (
            <div className="overflow-auto h-full">
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0 bg-panel/95 backdrop-blur-sm z-10">
                  <tr className="border-b border-border/60">
                    {(showConsole && queryResult?.length ? Object.keys(queryResult[0]) : data?.columns ?? []).map(col => (
                      <th key={col} className="px-3 py-2 text-left font-mono text-muted/60 text-[10px] whitespace-nowrap border-r border-border/30 last:border-r-0">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(showConsole ? queryResult ?? [] : data?.rows ?? []).map((row, i) => (
                    <tr key={i} className={`border-b border-border/20 hover:bg-white/3 ${i%2===0?'bg-base/20':''}`}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-3 py-1.5 font-mono text-text-primary/80 border-r border-border/20 last:border-r-0 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis"
                            title={String(v ?? '')}>
                          {v === null ? <span className="text-muted/30 italic">null</span> : formatVal(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {data && data.total > limit && !showConsole && (
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-t border-border/40 bg-panel/20 text-[11px]">
            <span className="text-muted/50">
              Showing {offset+1}–{Math.min(offset+limit, data.total)} of {data.total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setOffset(o => Math.max(0, o-limit))}
                disabled={offset === 0}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border/40 text-muted disabled:opacity-30 hover:border-accent/30 hover:text-accent transition-all">
                <ChevronLeft size={11}/>Prev
              </button>
              <span className="text-muted/50 px-1">{curPage}/{totalPages}</span>
              <button onClick={() => setOffset(o => Math.min((totalPages-1)*limit, o+limit))}
                disabled={offset + limit >= data.total}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border/40 text-muted disabled:opacity-30 hover:border-accent/30 hover:text-accent transition-all">
                Next<ChevronRight size={11}/>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
