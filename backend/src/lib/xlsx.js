// Minimal XLSX writer + reader and a CSV reader (WO-085, DEC-023). No dependency: ZIP through node:zlib.
// Writes plain cell values (strings, numbers, booleans) with a bold, frozen header row and column widths.
// Reads what Excel, LibreOffice and Numbers write: shared strings, inline strings, formula strings, numbers, booleans.
// Not supported: ZIP64, encrypted workbooks, dates as dates (they come back as Excel serial numbers).
import { deflateRawSync, inflateRawSync } from 'node:zlib';

/** @typedef {string | number | boolean | null | undefined} Cell */
/** @typedef {{ name: string, rows: Cell[][] }} Sheet */

// ---------------------------------------------------------------- ZIP

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {{ name: string, data: Buffer }[]} files
 * @returns {Buffer}
 */
export function zip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);          // version needed
    head.writeUInt16LE(0x0800, 6);      // UTF-8 names
    head.writeUInt16LE(8, 8);           // deflate
    head.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(f.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0x00210000, 12);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(f.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, name, packed);
    central.push(dir, name);
    offset += head.length + name.length + packed.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/**
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>} file name → contents
 */
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('ZIP64 files are not supported');
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken ZIP central directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(at) !== 0x04034b50) throw new Error(`broken ZIP entry ${name}`);
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`unsupported ZIP compression ${method} (${name})`);
  }
  return out;
}

// ---------------------------------------------------------------- XML (well-formed OOXML only)

const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); // not allowed in XML 1.0
const unesc = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k] ?? m;
});

/**
 * @typedef {{ name: string, attrs: Record<string, string>, children: XNode[], text: string }} XNode
 * Element names without namespace prefix; `text` = direct text content, untrimmed.
 */
function parse(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += unesc(m[6]);
    else if (m[3] !== undefined) {
      const name = m[3].replace(/^.*:/, '');
      if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].replace(/^.*:/, '')] = unesc(a[2] ?? a[3]);
      const node = { name, attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    }
  }
  return root;
}
const kids = (n, name) => n?.children.filter(c => c.name === name) ?? [];
const kid = (n, name) => n?.children.find(c => c.name === name);
const find = (n, name) => (n.name === name ? n : n.children.map(c => find(c, name)).find(Boolean));
/** All text of an element's <t> descendants (rich text runs), skipping phonetic hints (<rPh>). */
const allText = n => (n.name === 't' ? n.text : n.name === 'rPh' ? '' : n.children.map(allText).join(''));

// ---------------------------------------------------------------- XLSX writer

const colName = i => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const colIndex = ref => [...ref.replace(/\d+$/, '').toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function sheetXml(rows) {
  const widths = [];
  for (const row of rows) row.forEach((v, i) => { widths[i] = Math.max(widths[i] ?? 8, Math.min(60, String(v ?? '').length + 2)); });
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
    const ref = `${colName(c)}${r + 1}`;
    const style = r === 0 ? ' s="1"' : '';
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const freeze = rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Build an .xlsx workbook. Sheet names: max 31 characters, no []:*?/\ (cleaned here).
 * @param {Sheet[]} sheets
 * @returns {Buffer}
 */
export function writeXlsx(sheets) {
  const names = sheets.map((s, i) => (String(s.name).replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`));
  const x = s => Buffer.from(s, 'utf8');
  const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zip([
    { name: '[Content_Types].xml', data: x(`${decl}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: x(`${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: x(`${decl}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: x(`${decl}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: x(`${decl}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x(sheetXml(s.rows)) })),
  ]);
}

// ---------------------------------------------------------------- XLSX reader

/**
 * Read every sheet of an .xlsx workbook as rows of cell values (strings, numbers, booleans; empty cells = '').
 * @param {Buffer} buf
 * @returns {Sheet[]}
 */
export function readXlsx(buf) {
  const files = unzip(buf);
  const text = name => files.get(name)?.toString('utf8');
  const wbXml = text('xl/workbook.xml');
  if (!wbXml) throw new Error('not an Excel workbook (xl/workbook.xml missing)');
  const rels = new Map(kids(find(parse(text('xl/_rels/workbook.xml.rels') ?? '<Relationships/>'), 'Relationships'), 'Relationship').map(r => [r.attrs.Id, r.attrs.Target]));
  const sst = text('xl/sharedStrings.xml');
  const shared = sst ? kids(find(parse(sst), 'sst'), 'si').map(allText) : [];
  const sheets = kids(find(parse(wbXml), 'sheets'), 'sheet');
  return sheets.map(sh => {
    const target = rels.get(sh.attrs.id) ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = text(path);
    if (!xml) return { name: sh.attrs.name, rows: [] };
    const data = find(parse(xml), 'sheetData');
    const rows = [];
    let nextRow = 0;
    for (const row of kids(data, 'row')) {
      const r = row.attrs.r ? Number(row.attrs.r) - 1 : nextRow;
      nextRow = r + 1;
      const cells = [];
      let nextCol = 0;
      for (const c of kids(row, 'c')) {
        const col = c.attrs.r ? colIndex(c.attrs.r) : nextCol;
        nextCol = col + 1;
        const v = kid(c, 'v')?.text;
        let value;
        switch (c.attrs.t) {
          case 's': value = shared[Number(v)] ?? ''; break;
          case 'inlineStr': value = allText(kid(c, 'is') ?? { name: '', children: [], text: '' }); break;
          case 'str': case 'e': value = v ?? ''; break;
          case 'b': value = v === '1'; break;
          default: value = v === undefined || v === '' ? '' : Number(v);
        }
        cells[col] = value;
      }
      rows[r] = Array.from(cells, x => x ?? '');
    }
    return { name: sh.attrs.name, rows: Array.from(rows, x => x ?? []) };
  });
}

// ---------------------------------------------------------------- CSV reader

/**
 * Parse CSV (RFC 4180 quoting). The separator is guessed from the first line: ';' (Excel in many locales), tab or ','.
 * @param {string} text
 * @returns {string[][]}
 */
export function readCsv(text) {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0];
  const sep = [';', '\t', ','].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Read an uploaded table: .xlsx (ZIP signature) or CSV text.
 * @param {Buffer} buf
 * @returns {Sheet[]}
 */
export function readTable(buf) {
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf);
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0) throw new Error('old .xls files are not supported: save as .xlsx (Excel Workbook) or CSV');
  return [{ name: 'CSV', rows: readCsv(buf.toString('utf8')) }];
}
