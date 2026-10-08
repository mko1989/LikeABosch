// WO-107: specs shipped in the installers carry no text copied from Bosch's documents; data names are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { stripOperation, stripType, stripSwagger, stripApi, stripSpecs } from '../../scripts/dist/strip-specs.mjs';

test('operation: top-level prose goes, request/response fields named like prose stay', () => {
  const op = { operation: 'ActivateAdHocVoting', summary: 'Activates…', remarks: 'r', sourcePages: [1], extractionNotes: 'n', permissions: ['canControlVoting'],
    request: { subject: 'string', description: 'string' }, response: {}, seeAlso: [] };
  assert.deepEqual(stripOperation(op), { operation: 'ActivateAdHocVoting', permissions: ['canControlVoting'], request: { subject: 'string', description: 'string' }, response: {}, seeAlso: [] });
});

test('type: its prose and each member/field description go', () => {
  const t = stripType({ name: 'AgendaState', kind: 'enum', summary: 's', sourcePages: [4], extractionNotes: '', fields: [{ name: 'description', type: 'string', description: 'The description' }],
    members: [{ name: 'opened', value: 0, description: 'Opened state' }] });
  assert.deepEqual(t, { name: 'AgendaState', kind: 'enum', fields: [{ name: 'description', type: 'string' }], members: [{ name: 'opened', value: 0 }] });
});

test('swagger: texts go, a schema property called "description" stays, shared parameters too', () => {
  const doc = { swagger: '2.0', info: { title: 'T', version: '1.7', description: 'long text' }, tags: [{ name: 'Seats', description: 'x' }],
    parameters: { SeatID: { name: 'id', in: 'path', type: 'integer', description: 'The ID given…' } },
    paths: { '/voting': { put: { summary: 's', description: 'd', parameters: [{ name: 'body', in: 'body', description: 'p', schema: { $ref: '#/definitions/V' } }],
      responses: { 200: { description: 'OK text', headers: { Cookie: { type: 'string', description: 'Session ID' } } } } } } },
    definitions: { V: { type: 'object', description: 'Voting', properties: { description: { type: 'string', description: 'The description of the voting' }, mode: { type: 'integer', description: 'm' } } } } };
  const out = stripSwagger(doc);
  assert.deepEqual(out.info, { title: 'DICENTIS Wireless REST API (interface only)', version: '1.7' });
  assert.deepEqual(out.tags, [{ name: 'Seats' }]);
  assert.deepEqual(out.definitions.V, { type: 'object', properties: { description: { type: 'string' }, mode: { type: 'integer' } } });
  assert.deepEqual(out.paths['/voting'].put, { parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/V' } }], responses: { 200: { description: '', headers: { Cookie: { type: 'string' } } } } });
  assert.deepEqual(out.parameters.SeatID, { name: 'id', in: 'path', type: 'integer' });
  assert.equal(doc.info.description, 'long text', 'input untouched');
});

test('DCN-SW / DCNM api: prose goes, names and types stay, obsolete stays truthy', () => {
  const out = stripApi({ interfaces: { A: { summary: 's', methods: [{ name: 'M', summary: 's', remarks: 'r', example: ['code'], exceptions: ['E'], obsolete: 'Use N',
    params: [{ name: 'description', type: 'string', description: 'd' }], returns: { type: 'Task<bool>', description: 'd' } }] } } });
  assert.deepEqual(out, { interfaces: { A: { methods: [{ name: 'M', obsolete: 'obsolete', params: [{ name: 'description', type: 'string' }], returns: { type: 'Task<bool>' } }] } } });
});

test('the real specs: no sentence-like Bosch text left (guard), only runtime files shipped', { skip: !statSync('docs/protocol/conference', { throwIfNoEntry: false }) && 'spec files not present' }, () => {
  const out = mkdtempSync(join(tmpdir(), 'strip-'));
  try {
    stripSpecs('docs/protocol', out);
    const files = [];
    const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
    walk(out);
    assert.ok(files.every(f => f.endsWith('.json')), 'only JSON (no .md, no swagger.yaml)');
    // Our own texts may stay: the event map, undocumented.json, exclusion reasons / sources, C# declarations, titles.
    const OURS = new Set(['excluded', 'source', 'title', 'connectionString', 'dllSource', 'csharp', 'cs', 'notes', '_doc']);
    const prose = [];
    for (const f of files.filter(x => !/events\.json$|undocumented\.json$/.test(x))) {
      const scan = (v, k) => {
        if (typeof v === 'string') { if (!OURS.has(k) && v.trim().split(/\s+/).length >= 4) prose.push(`${relative(out, f)} ${k}: ${v.slice(0, 60)}`); }
        else if (Array.isArray(v)) v.forEach(x => scan(x, k));
        else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) scan(x, kk);
      };
      scan(JSON.parse(readFileSync(f, 'utf8')), '');
    }
    assert.deepEqual(prose.slice(0, 5), []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
