/** Browser-compatible deterministic helpers; no Node, file, clock, random, or network APIs. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function base64(bytes: Uint8Array): string {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 16384) raw += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(raw);
}

export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashBase64(hex: string): string {
  return base64(Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16)));
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Strict sfnt TrueType cmap formats 4/12. No caller-supplied coverage claims are trusted. */
export function fontHasGlyphs(bytes: Uint8Array, text: string): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const within = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > bytes.length) throw new Error('Truncated TrueType table');
  };
  within(0, 12);
  if (view.getUint32(0) !== 0x00010000) throw new Error('Only sfnt TrueType fonts are supported');
  const tableCount = view.getUint16(4);
  within(12, tableCount * 16);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < tableCount; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    within(offset, length);
    tables.set(tag, { offset, length });
  }
  if (tables.has('fvar')) throw new Error('v1 requires a static font, not a variable font');
  const cmap = tables.get('cmap');
  const maxp = tables.get('maxp');
  if (!cmap || cmap.length < 4 || !maxp || maxp.length < 6) throw new Error('Missing cmap or maxp');
  const glyphCount = view.getUint16(maxp.offset + 4);
  const encodings = view.getUint16(cmap.offset + 2);
  if (4 + encodings * 8 > cmap.length) throw new Error('Invalid cmap encoding records');
  const maps: Array<{ max: number; lookup: (cp: number) => number }> = [];
  for (let i = 0; i < encodings; i++) {
    const record = cmap.offset + 4 + i * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const start = cmap.offset + view.getUint32(record + 4);
    within(start, 2);
    const format = view.getUint16(start);
    if (format !== 4 && format !== 12) continue;
    within(start, format === 12 ? 16 : 14);
    const length = format === 12 ? view.getUint32(start + 4) : view.getUint16(start + 2);
    if (start < cmap.offset || start + length > cmap.offset + cmap.length) throw new Error('Invalid cmap subtable length');
    if (format === 12) {
      const count = view.getUint32(start + 12);
      if (16 + count * 12 > length) throw new Error('Invalid cmap groups');
      maps.push({ max: 0x10ffff, lookup: (cp) => {
        for (let g = 0; g < count; g++) {
          const at = start + 16 + g * 12;
          const first = view.getUint32(at);
          const last = view.getUint32(at + 4);
          if (cp >= first && cp <= last) return view.getUint32(at + 8) + cp - first;
        }
        return 0;
      } });
    } else {
      const count = view.getUint16(start + 6) / 2;
      if (!Number.isInteger(count) || count === 0 || 16 + count * 8 > length) throw new Error('Invalid cmap segments');
      maps.push({ max: 0xffff, lookup: (cp) => {
        if (cp > 0xffff) return 0;
        for (let s = 0; s < count; s++) {
          const end = view.getUint16(start + 14 + s * 2);
          const first = view.getUint16(start + 16 + count * 2 + s * 2);
          if (cp < first || cp > end) continue;
          const delta = view.getInt16(start + 16 + count * 4 + s * 2);
          const rangeAt = start + 16 + count * 6 + s * 2;
          const range = view.getUint16(rangeAt);
          if (range === 0) return (cp + delta) & 0xffff;
          const at = rangeAt + range + (cp - first) * 2;
          if (at + 2 > start + length) throw new Error('Invalid glyph index array');
          const glyph = view.getUint16(at);
          return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
        }
        return 0;
      } });
    }
  }
  if (maps.length === 0) throw new Error('No supported Unicode cmap');
  return [...new Set([...text])].filter((char) => {
    if (char === '\n' || char === '\r' || char === '\t') return false;
    const cp = char.codePointAt(0)!;
    const relevant = maps.filter((map) => cp <= map.max);
    // Reject conflicting coverage too: the browser may choose a different Unicode cmap.
    return relevant.length === 0 || relevant.some((map) => { const glyph = map.lookup(cp); return glyph === 0 || glyph >= glyphCount; });
  });
}
