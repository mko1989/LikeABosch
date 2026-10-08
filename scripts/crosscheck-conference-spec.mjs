#!/usr/bin/env node
// Cross-checks operations/*.json against the raw PDF text (docs/source/conference-protocol.txt) and, when unpacked,
// the DICENTIS 7.0 CHM method pages (docs/source/chm/ConferenceProtocol, WO-044 / DEC-013):
//  1. every `"field":` key on the operation's PDF pages appears in request/response; every key of the spec appears in
//     the PDF or the CHM page; every key of the CHM page appears in the spec
//  2. every enum value appears verbatim in the PDF pages or the CHM page (whitespace-insensitive)
// Usage: node scripts/crosscheck-conference-spec.mjs
// Known, reviewed differences are listed in KNOWN below; anything else exits with code 1.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(root, 'docs/protocol/conference');
const index = JSON.parse(readFileSync(join(base, 'source-index.json'), 'utf8'));
const text = readFileSync(join(root, 'docs/source/conference-protocol.txt'), 'utf8');

// Reviewed in WO-003: values split by page footers / "Copy" artifacts, deliberate fixes.
const KNOWN = new Set([
  'GetSeats enum hasVolumeControl',
  'RegisterEvents enum masterVolumeRangeChanged',
  'UnregisterEvents enum quorumResultChanged',
  // Added from the real DICENTIS 6.50 server (WO-016, 2026-10-03), not in the PDF:
  'GetInterpreterSeats extra-key headphone',
  'GetInterpreterSeats extra-key headphoneDescription',
  'GetInterpreterSeats extra-key id',
  'GetInterpreterSeats extra-key automaticMicrophoneSelection',
  'GetSeats extra-key hideSeat',
  'GetSeats extra-key supportsSpeaking',
  'GetPlugin extra-key description',
  'GetPlugin extra-key requestSchema',
  'GetPlugin extra-key responseSchema',
  'GetPlugin extra-key eventSchema',
  'GetPluginEventData extra-key event',
  'GetPluginEventData extra-key parameters',
  'GetPluginEventData extra-key pluginName',
  'GetPluginCommands extra-key correlationId',
  'GetPluginCommands extra-key pluginCommand',
  'GetPluginCommands extra-key command',
  'GetPluginCommands extra-key parameters',
  'GetPluginCommands extra-key pluginName',
  'GetPluginCommands extra-key pluginCommands',
]);

const pages = new Map();
const parts = text.split(/\n=== PAGE (\d+) ===\n/);
for (let i = 1; i < parts.length; i += 2) pages.set(Number(parts[i]), parts[i + 1]);
const pageText = ([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => pages.get(from + i) ?? '').join('\n');

// CHM method pages (optional: only if the CHM has been unpacked, see scripts/chm/README.md).
const chmDir = join(root, 'docs/source/chm/ConferenceProtocol');
const chmPages = new Map(); // operation (lower case) → plain text of its method page
if (existsSync(join(chmDir, 'ConferenceProtocol.hhc'))) {
  const toc = readFileSync(join(chmDir, 'ConferenceProtocol.hhc'), 'latin1');
  for (const m of toc.matchAll(/<param name="Name" value="(\w+) Method\s*">\s*<param name="Local" value="([^"]+)"/g)) {
    const html = readFileSync(join(chmDir, m[2]), 'utf8');
    chmPages.set(m[1].toLowerCase(), html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&'));
  }
} else console.log('note   CHM not unpacked: checking against the PDF only');
const keysIn = t => new Set([...t.matchAll(/"([A-Za-z_]\w*)"\s*:/g)].map(m => m[1]));

function walk(v, keys, enums) {
  if (typeof v === 'string') { if (v.startsWith('enum:')) enums.push(...v.slice(5).split('|')); }
  else if (Array.isArray(v)) v.forEach(x => walk(x, keys, enums));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x, keys, enums); }
}

// Operations outside the PDF (`source`, WO-031/044) are not in source-index.json: they are checked against the CHM only.
const problems = [];
let checkedOps = 0, checkedEnums = 0;
const ranges = new Map(index.operations.map(o => [o.name, o.pages]));
const opNames = [...new Set([...ranges.keys(), ...readdirSync(join(base, 'operations')).map(f => f.replace(/\.json$/, ''))])];
for (const name of opNames) {
  const op = JSON.parse(readFileSync(join(base, 'operations', `${name}.json`), 'utf8'));
  if (op.excluded) continue;
  const raw = ranges.has(name) ? pageText(ranges.get(name)) : '';
  const chm = chmPages.get(name.toLowerCase()) ?? '';
  if (!raw && !chm) continue;
  checkedOps++;
  const pdfKeys = keysIn(raw), chmKeys = keysIn(chm);
  const keys = new Set(); const enums = [];
  walk([op.request, op.response], keys, enums);
  for (const k of pdfKeys) if (!keys.has(k)) problems.push(`${name} missing-key ${k}`);
  for (const k of chmKeys) if (!keys.has(k)) problems.push(`${name} chm-missing-key ${k}`);
  // A key is only "extra" if some reference shows this operation's JSON at all (several CHM pages are empty).
  if (raw || chmKeys.size) for (const k of keys) if (!pdfKeys.has(k) && !chmKeys.has(k)) problems.push(`${name} extra-key ${k}`);
  const flat = (raw + chm).replace(/\s+/g, '');
  if (raw || chmKeys.size) for (const e of enums) { checkedEnums++; if (!flat.includes(`"${e}"`)) problems.push(`${name} enum ${e}`); }
}

const unexpected = problems.filter(p => !KNOWN.has(p));
problems.filter(p => KNOWN.has(p)).forEach(p => console.log('known  ', p));
unexpected.forEach(p => console.log('PROBLEM', p));
console.log(`\n${checkedOps} operations, ${checkedEnums} enum values checked; ${unexpected.length} unexpected difference(s)`);
process.exit(unexpected.length ? 1 : 0);
