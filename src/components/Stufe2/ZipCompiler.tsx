/** src/components/Stufe2/ZipCompiler.tsx */
import { useState } from 'react';
import { Download, Package, CheckCircle, Loader2 } from 'lucide-react';
import { downloadBundleZip, estimateBundleSize } from '@/lib/zip';
import { useAppState } from '@/context/AppContext';

export function ZipCompiler() {
  const { state } = useAppState();
  const { editableBundle, modifiedFiles } = state;
  const [status, setStatus] = useState<'idle'|'building'|'done'|'error'>('idle');
  const [size, setSize] = useState('');
  const [err, setErr] = useState('');

  if (!editableBundle) return null;
  const est = estimateBundleSize(editableBundle);

  const handle = async () => {
    if (status==='building') return;
    setStatus('building'); setErr('');
    try {
      const r = await downloadBundleZip(editableBundle);
      setSize(r.displaySize); setStatus('done');
      setTimeout(()=>setStatus('idle'), 5000);
    } catch(e) { setErr(e instanceof Error?e.message:'ZIP failed'); setStatus('error'); }
  };

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-t border-border bg-panel">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <Package size={14} className="text-accent/60"/>
        <span>5 files · ~{est} uncompressed</span>
        {modifiedFiles.size>0&&<span className="text-warning">· {modifiedFiles.size} modified</span>}
      </div>
      <div className="flex-1"/>
      {status==='error'&&<span className="text-[11px] text-error">{err}</span>}
      {status==='done'&&<span className="flex items-center gap-1 text-[11px] text-success"><CheckCircle size={12}/>Downloaded ({size})</span>}
      <button onClick={handle} disabled={status==='building'}
        className={['flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-xs tracking-wide transition-all',
          status==='building'?'bg-surface border border-border text-muted cursor-not-allowed':status==='done'?'bg-success/15 border border-success/30 text-green-400 hover:bg-success/20 cursor-pointer':'bg-accent text-base hover:bg-accent-dim btn-glow cursor-pointer'].join(' ')}>
        {status==='building'?<><Loader2 size={13} className="animate-spin"/>Packaging…</>:status==='done'?<><Download size={13}/>Download again</>:<><Download size={13}/>Package Bundle</>}
      </button>
    </div>
  );
}
