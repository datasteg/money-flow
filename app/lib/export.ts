'use client';
// Figure export: the chart as SVG or PNG (2x), with its title, periods, source line, figure note,
// citation and permalink printed on it, and the wordmark. The PNG also carries the citation in an iTXt chunk, so a
// figure pasted into a paper keeps its reference. Colours are the page's current tokens, resolved at export time.

export interface FigureMeta { title: string; subtitle: string; source: string; note: string; citation: string; filename: string; credit?: string }

function resolveVars(svg: string): string {
  const css = getComputedStyle(document.documentElement);
  return svg.replace(/var\(--([a-z0-9-]+)\)/g, (_, n: string) => css.getPropertyValue(`--${n}`).trim() || '#888');
}

function wrapText(s: string, max: number): string[] {
  const words = s.split(' '), out: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function figureSvg(chart: SVGSVGElement, m: FigureMeta): string {
  const css = getComputedStyle(document.documentElement);
  const surface = css.getPropertyValue('--surface').trim(), ink = css.getPropertyValue('--ink').trim(), muted = css.getPropertyValue('--ink-muted').trim();
  const inner = chart.cloneNode(true) as SVGSVGElement;
  inner.querySelectorAll('[tabindex]').forEach((n) => n.removeAttribute('tabindex'));
  // the labels are styled by the page's stylesheet, which a standalone file does not have: write their computed style in
  const src = chart.querySelectorAll('text, tspan'), dst = inner.querySelectorAll('text, tspan');
  src.forEach((n, i) => {
    const c = getComputedStyle(n), d = dst[i] as SVGElement | undefined;
    if (!d) return;
    for (const k of ['font-size', 'font-weight', 'font-family', 'fill', 'stroke', 'stroke-width', 'paint-order', 'letter-spacing']) d.style.setProperty(k, c.getPropertyValue(k));
  });
  const body = new XMLSerializer().serializeToString(inner);
  const vb = chart.viewBox.baseVal;
  const cw = vb?.width || 1000, chh = vb?.height || 580;
  const W = 1000, CH = Math.round((chh * W) / cw), top = 96;
  const foot = [...wrapText(m.source, 150), ...(m.credit ? [m.credit] : []), m.note, ...wrapText(m.citation, 150)];
  const H = top + CH + 24 + foot.length * 16 + 40;
  const font = "Archivo, 'Archivo Variable', 'Pretendard Variable', Pretendard, system-ui, sans-serif";
  const lines = foot.map((l, i) => `<text x="24" y="${top + CH + 24 + i * 16}" font-size="11" fill="${muted}" font-family="${font}">${esc(l)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 48}" height="${H}" viewBox="0 0 ${W + 48} ${H}">
<rect width="100%" height="100%" fill="${surface}"/>
<text x="24" y="40" font-size="22" font-weight="700" fill="${ink}" font-family="${font}">${esc(m.title)}</text>
<text x="24" y="66" font-size="13" fill="${muted}" font-family="${font}">${esc(m.subtitle)}</text>
<g transform="translate(24 ${top})">${body.replace(/^<svg[^>]*>/, `<svg width="${W}" height="${CH}" viewBox="0 0 ${cw} ${chh}">`)}</g>
${lines}
<text x="${W + 24}" y="${H - 16}" text-anchor="end" font-size="14" font-weight="800" fill="${ink}" font-family="${font}" font-stretch="112%">money-flow · datasteg</text>
</svg>`;
  return resolveVars(svg);
}

function crc32(buf: Uint8Array): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Insert an iTXt chunk (UTF-8 text) after the PNG header chunk. */
function withText(png: Uint8Array, key: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const data = new Uint8Array([...enc.encode(key), 0, 0, 0, 0, 0, ...enc.encode(text)]);
  const type = enc.encode('iTXt');
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(new Uint8Array([...type, ...data])));
  const ihdrEnd = 8 + 25;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadSvg(chart: SVGSVGElement, m: FigureMeta) {
  save(new Blob([figureSvg(chart, m)], { type: 'image/svg+xml;charset=utf-8' }), `${m.filename}.svg`);
}

export async function downloadPng(chart: SVGSVGElement, m: FigureMeta) {
  const svg = figureSvg(chart, m);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('svg')); img.src = url; });
  const c = document.createElement('canvas');
  c.width = img.width * 2; c.height = img.height * 2;
  const g = c.getContext('2d')!;
  g.scale(2, 2);
  g.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const blob: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'));
  const bytes = withText(new Uint8Array(await blob.arrayBuffer()), 'Citation', m.citation);
  save(new Blob([bytes as BlobPart], { type: 'image/png' }), `${m.filename}.png`);
}

export function downloadCsv(rows: Record<string, unknown>[], header: string[], keys: string[], filename: string) {
  const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '﻿' + [header.map(q).join(','), ...rows.map((r) => keys.map((k) => q(r[k])).join(','))].join('\n') + '\n';
  save(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}
