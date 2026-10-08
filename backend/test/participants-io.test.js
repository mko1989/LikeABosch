// WO-085 / DEC-023: XLSX reader/writer, participant import planning and applying, export/import endpoints.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { readCsv, readTable, readXlsx, unzip, writeXlsx, zip } from '../src/lib/xlsx.js';
import { applyImport, exportSheets, planImport } from '../src/domain/participants-io.js';
import { createMockWirelessServer } from '../../mock/wireless/server.js';
import { createMockWiredServer } from '../../mock/wired/server.js';
import { startBackend, startConnectedBackend } from './helpers/start.js';

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

describe('xlsx', () => {
  test('round trip: strings (XML specials, unicode), numbers, booleans, empty cells', () => {
    const rows = [['Name', 'Seat', 'Note'], ['Zoë & <Co> "x"', 3, true], ['', 2.5, ''], ['  spaced  ', '', 'line\nbreak']];
    const buf = writeXlsx([{ name: 'Participants', rows }, { name: 'Bad/Name:[x]', rows: [['a']] }]);
    const sheets = readXlsx(buf);
    assert.deepEqual(sheets.map(s => s.name), ['Participants', 'Bad Name  x']);
    assert.deepEqual(sheets[0].rows, [['Name', 'Seat', 'Note'], ['Zoë & <Co> "x"', 3, true], ['', 2.5], ['  spaced  ', '', 'line\nbreak']]);
    assert.ok(unzip(buf).has('xl/styles.xml'));
  });

  test('reads a workbook written by openpyxl (inline strings, absolute part paths, t="n")', () => {
    const sheets = readXlsx(fixture('participants-openpyxl.xlsx'));
    assert.deepEqual(sheets.map(s => s.name), ['Info', 'Participants']);
    const rows = sheets[1].rows;
    assert.deepEqual(rows[0], ['Name', 'Seat', 'NFC tag', 'Notes']);
    assert.deepEqual(rows[1], ['Anna de Vries', 3, '', 'moved']);
    assert.equal(rows[2][0], 'Zoë Ünicode & <Co>');
    assert.equal(rows[4][3], true);
  });

  test('reads Excel-style shared strings, rich text runs, phonetic hints, sparse cells, stored entries', () => {
    const x = s => Buffer.from(s, 'utf8');
    const buf = zip([
      { name: '[Content_Types].xml', data: x('<Types/>') },
      { name: 'xl/workbook.xml', data: x('<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="r"><x:sheets><x:sheet name="Blad1" sheetId="1" r:id="rId7"/></x:sheets></x:workbook>') },
      { name: 'xl/_rels/workbook.xml.rels', data: x('<Relationships><Relationship Id="rId7" Target="worksheets/sheet1.xml" Type="w"/></Relationships>') },
      { name: 'xl/sharedStrings.xml', data: x('<sst count="3" uniqueCount="3"><si><t>Name</t></si><si><r><rPr><b/></rPr><t xml:space="preserve">Jan </t></r><r><t>Kowalski</t></r><rPh><t>ignored</t></rPh></si><si><t>Seat</t></si></sst>') },
      { name: 'xl/worksheets/sheet1.xml', data: x('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3"><v>7</v></c><c r="D3" t="str"><f>A3</f><v>Jan Kowalski</v></c><c r="E3" t="b"><v>0</v></c></row></sheetData></worksheet>') },
    ]);
    const [sheet] = readXlsx(buf);
    assert.equal(sheet.name, 'Blad1');
    assert.deepEqual(sheet.rows, [['Name', '', 'Seat'], [], ['Jan Kowalski', '', 7, 'Jan Kowalski', false]]);
  });

  test('CSV: separator guessed (; , tab), quotes, BOM; readTable picks the format; old .xls refused', () => {
    assert.deepEqual(readCsv('﻿Name;Seat\r\n"Smith; John";"3"\r\n"Say ""hi""";\n'), [['Name', 'Seat'], ['Smith; John', '3'], ['Say "hi"', '']]);
    assert.deepEqual(readCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(readCsv('a\tb\n1\t2\n'), [['a', 'b'], ['1', '2']]);
    assert.equal(readTable(Buffer.from('Name\nAnna\n'))[0].rows[1][0], 'Anna');
    assert.equal(readTable(writeXlsx([{ name: 'S', rows: [['x']] }]))[0].rows[0][0], 'x');
    assert.throws(() => readTable(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), /old \.xls/);
  });
});

// ---------------------------------------------------------------- planning

const SEATS = [1, 2, 3, 4, 5].map(n => ({ id: String(n), name: n === 1 ? 'Chairman' : `Seat ${n}` }));
const PEOPLE = [
  { id: '1', name: 'Anna de Vries', assignedSeatId: '1', nfc: '04:00:00:00:00:00:01' },
  { id: '2', name: 'Bart Jansen', assignedSeatId: '2', nfc: '' },
  { id: '3', name: 'Chloe Bakker', assignedSeatId: '3', nfc: '' },
];
const sheet = rows => [{ name: 'Participants', rows }];

describe('import planning', () => {
  test('export sheets: importable columns first, ID last, seats with plan positions', () => {
    const [p, s] = exportSheets({ participants: PEOPLE, seats: SEATS, placements: { 1: { x: 250, y: 100, rotation: 90 } }, nfc: true });
    assert.deepEqual(p.rows[0], ['Name', 'Seat', 'NFC tag', 'ID']);
    assert.deepEqual(p.rows[1], ['Anna de Vries', 'Chairman', '04:00:00:00:00:00:01', '1']);
    assert.deepEqual(s.rows[1], ['Chairman', '1', 'Anna de Vries', 'Yes', 2.5, 1, 90]);
    assert.deepEqual(s.rows[5], ['Seat 5', '5', '', 'No', '', '', '']);
  });

  test('export → import unchanged = no changes', () => {
    const sheets = readXlsx(writeXlsx(exportSheets({ participants: PEOPLE, seats: SEATS, nfc: true })));
    const plan = planImport(sheets, { participants: PEOPLE, seats: SEATS });
    assert.deepEqual([plan.errors, plan.creates, plan.updates, plan.deletes, plan.unassigns, plan.unchanged], [[], [], [], [], [], 3]);
  });

  test('creates, seat swap, match by name (case-insensitive) and by ID (rename), seats by name or id', () => {
    const plan = planImport(sheet([
      ['Name', 'Seat', 'ID'],
      ['anna de vries', 'Seat 2', ''], // name match, case differs → rename to this spelling + move
      ['Bart J.', 1, '2'],              // ID match → rename + seat by id
      ['New Person', 'seat 5', ''],
    ]), { participants: PEOPLE, seats: SEATS });
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.creates, [{ line: 4, name: 'New Person', seatId: '5', seatName: 'Seat 5', nfc: '' }]);
    assert.deepEqual(plan.updates.map(u => [u.id, u.to]), [['1', { name: 'anna de vries', seatId: '2' }], ['2', { name: 'Bart J.', seatId: '1' }]]);
    assert.deepEqual(plan.unassigns, []); // Chloe keeps seat 3: nobody else takes it
    assert.equal(plan.columns.nfc, false);
  });

  test('a kept participant loses a seat the file gives away; remove mode deletes the rest', () => {
    const rows = [['Participant', 'Seat number'], ['New Person', 'Seat 3']];
    const keep = planImport(sheet(rows), { participants: PEOPLE, seats: SEATS });
    assert.deepEqual(keep.unassigns, [{ id: '3', name: 'Chloe Bakker', seat: true, nfc: false, seatName: 'Seat 3' }]);
    assert.match(keep.warnings[0].message, /Chloe Bakker .* loses seat Seat 3/);
    const del = planImport(sheet(rows), { participants: PEOPLE, seats: SEATS, remove: true });
    assert.deepEqual(del.deletes.map(d => d.id), ['1', '2', '3']);
    assert.deepEqual(del.unassigns, []);
  });

  test('errors: unknown seat, seat twice, name twice, empty name, too long, NFC twice, no Name header', () => {
    const plan = planImport(sheet([
      ['', 'title row'],
      ['Name', 'Seat', 'NFC'],
      ['A', 'Seat 9', ''],
      ['B', 'Seat 4', 'aa'],
      ['C', 'Seat 4', ''],
      ['b', '', ''],
      ['', 'Seat 5', ''],
      ['X'.repeat(33), '', ''],
      ['D', '', 'AA'],
      [],
    ]), { participants: PEOPLE, seats: SEATS, maxName: 32 });
    assert.deepEqual(plan.errors.map(e => e.line), [3, 5, 6, 7, 8, 9]);
    assert.match(plan.errors[0].message, /unknown seat "Seat 9"/);
    assert.match(plan.errors[1].message, /seat Seat 4 is also given in row 4/);
    assert.match(plan.errors[2].message, /also in row 4/);
    assert.match(plan.errors[5].message, /NFC tag AA is also in row 4/);
    assert.match(planImport(sheet([['Who', 'Where']]), { participants: [], seats: SEATS }).errors[0].message, /no "Name" column/);
    assert.match(planImport([{ name: 'S', rows: [] }], { participants: [], seats: SEATS }).errors[0].message, /no data/);
  });

  test('apply: order never holds a seat or NFC tag twice (simulated WAP), stops at the first refusal', async () => {
    const db = new Map(PEOPLE.map(p => [p.id, { ...p, seatId: p.assignedSeatId }]));
    let next = 10;
    const check = (id, f) => {
      if (f.seatId && [...db.values()].some(p => p.id !== id && p.seatId === f.seatId)) throw new Error('Seat already assigned');
      if (f.nfc && [...db.values()].some(p => p.id !== id && p.nfc === f.nfc)) throw new Error('NFC already assigned');
    };
    const ops = {
      create: async p => { check(null, p); db.set(String(next), { id: String(next++), ...p }); },
      update: async (id, f) => { check(id, f); Object.assign(db.get(id), f); },
      remove: async id => { db.delete(id); },
    };
    // Anna ↔ Bart swap seats and Anna's NFC tag goes to Chloe; a new participant takes seat 3 from Chloe.
    const plan = planImport(sheet([
      ['Name', 'Seat', 'NFC tag'],
      ['Anna de Vries', 'Seat 2', ''],
      ['Bart Jansen', 'Chairman', ''],
      ['Chloe Bakker', '', '04:00:00:00:00:00:01'],
      ['Dirk Visser', 'Seat 3', ''],
    ]), { participants: PEOPLE, seats: SEATS });
    assert.deepEqual(plan.errors, []);
    const result = await applyImport(plan, ops);
    assert.equal(result.error, undefined, JSON.stringify(result));
    const by = name => [...db.values()].find(p => p.name === name);
    assert.deepEqual([by('Anna de Vries').seatId, by('Bart Jansen').seatId, by('Chloe Bakker').seatId, by('Dirk Visser').seatId], ['2', '1', null, '3']);
    assert.deepEqual([by('Anna de Vries').nfc, by('Chloe Bakker').nfc], ['', '04:00:00:00:00:00:01']);
    const failing = await applyImport(planImport(sheet([['Name'], ['Q'], ['R']]), { participants: [], seats: SEATS }), {
      ...ops, create: async p => { if (p.name === 'R') throw new Error('nope'); },
    });
    assert.deepEqual(failing, { done: 1, total: 2, error: { message: 'nope', step: 'create R' } });
  });
});

// ---------------------------------------------------------------- endpoints

const upload = (backend, query, buf) => fetch(`${backend.url}/api/domain/participants/import${query}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf })
  .then(async r => ({ status: r.status, body: await r.json() }));

describe('import / export endpoints on the wireless mock', () => {
  let mock;
  let backend;
  before(async () => {
    mock = await createMockWirelessServer({ longPollMs: 500 });
    backend = await startBackend({
      DICENTIS_SYSTEM: 'wireless', DICENTIS_HOST: '127.0.0.1', DICENTIS_PORT: String(mock.port), DICENTIS_USER: 'admin', DICENTIS_PASSWORD: 'admin', DICENTIS_AUTOCONNECT: 'true',
    });
    if (backend.services.manager.client?.state !== 'loggedIn') await once(backend.services.manager.client, 'loggedIn');
    await backend.services.poller.idle();
  });
  after(async () => { await backend.close(); await mock.close(); });

  test('export → edit (swap two seats, add one, rename by ID) → preview → apply', async () => {
    const res = await fetch(`${backend.url}/api/domain/participants/export.xlsx`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="participants-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const sheets = readXlsx(Buffer.from(await res.arrayBuffer()));
    assert.deepEqual(sheets.map(s => s.name), ['Participants', 'Seats']);
    const [head, ...rows] = sheets[0].rows;
    assert.deepEqual(head, ['Name', 'Seat', 'NFC tag', 'ID']);
    const before = mock.state.participants.map(p => ({ ...p }));
    assert.equal(rows.length, before.length);
    // edit: the first two swap seats, the third is renamed (ID kept), plus a new one on a free seat
    const seatName = id => mock.state.seats.find(s => s.id === id).name;
    const [a, b, c] = before;
    const edited = rows.map(r => {
      if (r[0] === a.name) return [r[0], seatName(b.seatId), r[2], r[3]];
      if (r[0] === b.name) return [r[0], seatName(a.seatId), r[2], r[3]];
      if (r[0] === c.name) return [`${c.name} Jr`, r[1], r[2], r[3]];
      return r;
    });
    const free = mock.state.seats.find(s => !before.some(p => p.seatId === s.id));
    edited.push(['Brand New', free.name, '', '']);
    const file = writeXlsx([{ name: 'Participants', rows: [head, ...edited] }]);

    const preview = await upload(backend, '', file);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const plan = preview.body.data.plan;
    assert.deepEqual([plan.errors.length, plan.creates.length, plan.updates.length, plan.deletes.length], [0, 1, 3, 0]);
    assert.deepEqual(mock.state.participants, before, 'preview changes nothing');

    const applied = await upload(backend, '?apply=1', file);
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.data.result.error, undefined);
    const now = name => mock.state.participants.find(p => p.name === name);
    assert.equal(now(a.name).seatId, b.seatId);
    assert.equal(now(b.name).seatId, a.seatId);
    assert.equal(now(`${c.name} Jr`).id, c.id);
    assert.equal(now('Brand New').seatId, free.id);

    // errors block apply
    const bad = writeXlsx([{ name: 'Participants', rows: [['Name', 'Seat'], ['X', 'No such seat']] }]);
    const refused = await upload(backend, '?apply=1', bad);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.details[0], /row 2: "X": unknown seat/);
    assert.equal((await upload(backend, '', Buffer.from('garbage-without-zip\u0000'))).status, 200, 'non-ZIP is read as CSV');
    assert.match((await upload(backend, '', Buffer.from('PK\u0003\u0004 broken'))).body.error.message, /Cannot read the file/);
  });
});

describe('import / export endpoints on the wired mock', () => {
  test('export works (read-only data); apply is not supported', async () => {
    const mock = await createMockWiredServer();
    const backend = await startConnectedBackend(mock);
    try {
      const res = await fetch(`${backend.url}/api/domain/participants/export.xlsx`);
      assert.equal(res.status, 200);
      const [p] = readXlsx(Buffer.from(await res.arrayBuffer()));
      assert.equal(p.rows[0][0], 'Name');
      assert.ok(p.rows.length > 1);
      const file = writeXlsx([{ name: 'Participants', rows: [['Name'], ['Someone New']] }]);
      assert.equal((await upload(backend, '', file)).status, 200, 'preview works');
      assert.equal((await upload(backend, '?apply=1', file)).body.error.code, 'NOT_SUPPORTED');
    } finally {
      await backend.close();
      await mock.close();
    }
  });
});
