/** src/lib/zip.ts – Bundle ZIP packaging via jszip. */
import JSZip from 'jszip';
import type { GeneratedBundle } from '@/types';

export function estimateBundleSize(bundle: GeneratedBundle): string {
  const enc = new TextEncoder();
  let total = 0;
  for (const v of Object.values(bundle)) total += enc.encode(v).length;
  if (total < 1024) return `${total} B`;
  if (total < 1048576) return `${(total/1024).toFixed(1)} KB`;
  return `${(total/1048576).toFixed(2)} MB`;
}

export async function downloadBundleZip(bundle: GeneratedBundle, filename = 'project_bundle.zip'): Promise<{ displaySize: string }> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(bundle)) zip.file(name, content);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  const size = blob.size < 1024 ? `${blob.size} B` : blob.size < 1048576 ? `${(blob.size/1024).toFixed(1)} KB` : `${(blob.size/1048576).toFixed(2)} MB`;
  return { displaySize: size };
}
