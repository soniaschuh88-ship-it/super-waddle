/**
 * src/components/Admin/PluginManager.tsx
 * Install, manage, and browse pi-compatible packages.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Download, Trash2, RefreshCw, Search,
  Loader2, AlertCircle, Package, Code2, BookOpen, Palette,
} from 'lucide-react';
import {
  pluginsList, pluginsInstall, pluginsRemove,
  pluginsSetEnabled, pluginsSearch,
} from '@/lib/llm-client';
import type { Plugin, PluginSearchResult } from '@/types';

// ── Installed plugin card ─────────────────────────────────────────────────────

function PluginCard({ plugin, onRemove, onToggle }: {
  plugin: Plugin;
  onRemove: () => void;
  onToggle: (e: boolean) => void;
}) {
  const [removing, setRemoving] = useState(false);

  const res = plugin.resources;
  const tags: string[] = [];
  if (res.extensions?.length) tags.push(`${res.extensions.length} ext`);
  if (res.skills?.length)     tags.push(`${res.skills.length} skills`);
  if (res.prompts?.length)    tags.push(`${res.prompts.length} prompts`);
  if (res.themes?.length)     tags.push(`${res.themes.length} themes`);

  return (
    <div className={['rounded-xl border p-4 transition-all',
      plugin.enabled ? 'border-border bg-panel' : 'border-border/50 bg-panel opacity-60'].join(' ')}>
      <div className="flex items-start gap-3">
        <Package size={16} className={plugin.enabled ? 'text-accent mt-0.5' : 'text-muted mt-0.5'}/>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary font-mono truncate">{plugin.name}</p>
          <p className="text-[11px] text-muted/60 font-mono truncate">{plugin.source}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {tags.map(t => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-border/60 text-muted font-mono">{t}</span>
            ))}
            <span className="text-[10px] text-muted/40">
              {new Date(plugin.installedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Enable/disable toggle */}
          <button onClick={() => onToggle(!plugin.enabled)}
            className={['text-[11px] px-2 py-0.5 rounded-full border font-medium transition-colors',
              plugin.enabled
                ? 'bg-success/10 border-success/30 text-green-400 hover:bg-success/20'
                : 'bg-border/50 border-border text-muted hover:border-accent/30'].join(' ')}>
            {plugin.enabled ? 'Enabled' : 'Disabled'}
          </button>
          {/* Remove */}
          <button onClick={async () => { setRemoving(true); onRemove(); }}
            disabled={removing}
            className="text-muted hover:text-error transition-colors">
            {removing ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Search result card ────────────────────────────────────────────────────────

function SearchCard({ result, onInstall, installing }: {
  result: PluginSearchResult;
  onInstall: () => void;
  installing: boolean;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-border bg-panel">
      <Package size={15} className="text-muted/60 flex-shrink-0 mt-0.5"/>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary font-mono">{result.name}</p>
        <p className="text-xs text-muted mt-0.5 leading-relaxed line-clamp-2">{result.description}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[10px] text-muted/50 font-mono">v{result.version}</span>
          {result.keywords.slice(0,3).map(k => (
            <span key={k} className="text-[10px] px-1 py-0 rounded bg-border/60 text-muted/70">{k}</span>
          ))}
        </div>
      </div>
      <button onClick={onInstall} disabled={installing}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded-lg transition-colors disabled:opacity-50">
        {installing ? <Loader2 size={12} className="animate-spin"/> : <Download size={12}/>}
        Install
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PluginManager() {
  const [plugins,     setPlugins]     = useState<Plugin[]>([]);
  const [searchRes,   setSearchRes]   = useState<PluginSearchResult[]>([]);
  const [query,       setQuery]       = useState('');
  const [loading,     setLoading]     = useState(false);
  const [searching,   setSearching]   = useState(false);
  const [installing,  setInstalling]  = useState<Record<string, boolean>>({});
  const [installLog,  setInstallLog]  = useState<Record<string, string[]>>({});
  const [customSrc,   setCustomSrc]   = useState('');
  const [err,         setErr]         = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setPlugins(await pluginsList());
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchRes(await pluginsSearch(query));
    setSearching(false);
  }, [query]);

  const doInstall = useCallback(async (source: string) => {
    setErr('');
    setInstalling(p => ({ ...p, [source]: true }));
    setInstallLog(p => ({ ...p, [source]: [] }));
    try {
      await pluginsInstall(source, (line) => {
        setInstallLog(p => ({ ...p, [source]: [...(p[source] ?? []), line] }));
      });
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Install failed');
    }
    setInstalling(p => ({ ...p, [source]: false }));
  }, [reload]);

  const doRemove = useCallback(async (source: string) => {
    try {
      await pluginsRemove(source);
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed');
    }
  }, [reload]);

  const doToggle = useCallback(async (source: string, enabled: boolean) => {
    await pluginsSetEnabled(source, enabled);
    await reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header info */}
      <div className="rounded-xl border border-border bg-panel p-4 text-xs text-muted/80 leading-relaxed">
        <p className="font-semibold text-text-primary mb-1">Pi-Compatible Packages</p>
        <p>
          Install extensions, skills, prompt templates, and themes from the pi ecosystem.
          Extensions run with full system access — review source code before installing third-party packages.
        </p>
        <p className="mt-1.5">
          Sources: <code className="font-mono bg-border/60 px-1 rounded">npm:@scope/package</code>{' '}
          <code className="font-mono bg-border/60 px-1 rounded">git:github.com/user/repo</code>{' '}
          <code className="font-mono bg-border/60 px-1 rounded">https://github.com/user/repo</code>
        </p>
      </div>

      {/* Resource type legend */}
      <div className="flex gap-3 flex-wrap">
        {[
          { icon: Code2,     label: 'Extensions',  desc: 'Register tools, commands, event hooks' },
          { icon: BookOpen,  label: 'Skills',       desc: 'Markdown instruction files' },
          { icon: BookOpen,  label: 'Prompts',      desc: 'Reusable prompt templates' },
          { icon: Palette,   label: 'Themes',       desc: 'Visual themes' },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex items-center gap-1.5 text-[11px] text-muted">
            <Icon size={11} className="text-accent/60"/><span className="font-medium">{label}</span><span className="text-muted/50">— {desc}</span>
          </div>
        ))}
      </div>

      {err && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-error/30 bg-error/10 text-sm text-red-400">
          <AlertCircle size={14}/>{err}
        </div>
      )}

      {/* Installed plugins */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">
            Installed Plugins ({plugins.length})
          </h3>
          <button onClick={reload} disabled={loading} className="text-[11px] text-muted hover:text-accent transition-colors flex items-center gap-1">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''}/>Refresh
          </button>
        </div>

        {plugins.length === 0 && !loading && (
          <p className="text-sm text-muted/50 italic">No plugins installed yet.</p>
        )}

        <div className="flex flex-col gap-2">
          {plugins.map(p => (
            <PluginCard key={p.source} plugin={p}
              onRemove={() => void doRemove(p.source)}
              onToggle={e => void doToggle(p.source, e)}
            />
          ))}
        </div>
      </div>

      {/* Custom install */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-2">Install Package</h3>
        <div className="flex gap-2">
          <input type="text" value={customSrc} onChange={e => setCustomSrc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void doInstall(customSrc)}
            placeholder="npm:@scope/pi-tools  or  git:github.com/user/pi-tools"
            className="flex-1 bg-base border border-border text-text-primary text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"/>
          <button onClick={() => void doInstall(customSrc)} disabled={!customSrc.trim() || !!installing[customSrc]}
            className="flex items-center gap-1.5 px-4 py-2 text-xs bg-accent text-base hover:bg-accent-dim rounded-lg transition-colors disabled:bg-surface disabled:text-muted disabled:cursor-not-allowed">
            {installing[customSrc] ? <Loader2 size={12} className="animate-spin"/> : <Download size={12}/>}
            Install
          </button>
        </div>
        {customSrc && installLog[customSrc]?.length > 0 && (
          <div className="mt-2 bg-[#0d0d16] rounded-lg p-2 max-h-32 overflow-y-auto font-mono text-[11px] text-accent/80">
            {installLog[customSrc].map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>

      {/* npm search */}
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-2">Search npm</h3>
        <div className="flex gap-2 mb-3">
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void doSearch()}
            placeholder="pi-package  (keyword search)"
            className="flex-1 bg-base border border-border text-text-primary text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent/60 placeholder:text-muted/30"/>
          <button onClick={doSearch} disabled={searching || !query.trim()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs border border-border text-muted hover:text-accent hover:border-accent/40 rounded-lg transition-colors disabled:opacity-50">
            {searching ? <Loader2 size={12} className="animate-spin"/> : <Search size={12}/>}
            Search
          </button>
        </div>

        {searchRes.length > 0 && (
          <div className="flex flex-col gap-2">
            {searchRes.map(r => (
              <SearchCard key={r.source} result={r}
                installing={!!installing[r.source]}
                onInstall={() => void doInstall(r.source)}
              />
            ))}
          </div>
        )}

        {/* Featured packages hint */}
        {!searchRes.length && !searching && (
          <div className="flex flex-wrap gap-1.5">
            {['pi-package', 'pi-tools', 'pi-extension', 'pi-skill'].map(kw => (
              <button key={kw} onClick={() => { setQuery(kw); void doSearch(); }}
                className="text-[11px] px-2 py-0.5 rounded-full border border-border text-muted hover:border-accent/30 hover:text-accent transition-colors">
                {kw}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* How to create a plugin */}
      <div className="rounded-xl border border-border bg-panel p-4">
        <p className="text-[11px] font-semibold text-text-primary mb-2">Creating a pi-compatible plugin</p>
        <pre className="text-[11px] font-mono text-muted/80 whitespace-pre-wrap leading-relaxed">{`// package.json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills":     ["./skills"],
    "prompts":    ["./prompts"]
  }
}

// extensions/my-tool.ts
export default function(pi) {
  pi.registerTool({
    name: "my_tool",
    description: "Does something useful",
    parameters: { ... },
    execute: async (id, params, signal) => ({ content: [...], details: {} })
  });
}`}
        </pre>
      </div>
    </div>
  );
}
