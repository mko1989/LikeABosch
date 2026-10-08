// Participants + seating as a workbook (WO-085, DEC-023): export sheets, plan an import, apply a plan.
// Pure apart from the `ops` passed to applyImport(). Works on domain shapes (DEC-010): string ids, domain seats.

/**
 * @typedef {{ id: string, name: string, group?: string | null, seat?: string | null, assignedSeatId: string | null,
 *   seatedSeatId?: string | null, userName?: string | null, present?: boolean | null, canVote?: boolean | null, nfc?: string | null }} Participant
 * @typedef {{ id: string, name: string, connected?: boolean }} Seat
 * @typedef {{ x: number, y: number, rotation?: number }} Placement
 */

const yesNo = v => (v === null || v === undefined ? '' : v ? 'Yes' : 'No');

/**
 * Sheets for the export: "Participants" (importable: Name, Seat, NFC tag; the rest is information) and "Seats".
 * @param {{ participants: Participant[], seats: Seat[], placements?: Record<string, Placement>, nfc?: boolean }} data
 *   `nfc`: the system has NFC tags (wireless), so the column is exported even when empty.
 */
export function exportSheets({ participants, seats, placements = {}, nfc = false }) {
  const seatName = id => seats.find(s => s.id === id)?.name ?? id ?? '';
  const has = key => participants.some(p => p[key] !== null && p[key] !== undefined && p[key] !== '');
  const cols = [
    ['Name', p => p.name],
    ['Seat', p => (p.assignedSeatId ? seatName(p.assignedSeatId) : '')],
    nfc || has('nfc') ? ['NFC tag', p => p.nfc ?? ''] : null,
    has('group') ? ['Group', p => p.group ?? ''] : null,
    has('userName') ? ['User name', p => p.userName ?? ''] : null,
    has('seatedSeatId') ? ['Seated now', p => (p.seatedSeatId ? seatName(p.seatedSeatId) : '')] : null,
    has('present') ? ['Present', p => yesNo(p.present)] : null,
    has('canVote') ? ['Can vote', p => yesNo(p.canVote)] : null,
    ['ID', p => p.id],
  ].filter(Boolean);
  const people = [...participants].sort((a, b) => a.name.localeCompare(b.name));
  const holder = id => participants.find(p => p.assignedSeatId === id);
  const m = v => (typeof v === 'number' ? Math.round(v) / 100 : ''); // plan units are cm
  return [
    { name: 'Participants', rows: [cols.map(c => c[0]), ...people.map(p => cols.map(c => c[1](p)))] },
    {
      name: 'Seats',
      rows: [['Seat', 'Seat ID', 'Participant', 'On plan', 'X (m)', 'Y (m)', 'Rotation (°)'],
        ...seats.map(s => {
          const pos = placements[s.id];
          return [s.name, s.id, holder(s.id)?.name ?? '', pos ? 'Yes' : 'No', m(pos?.x), m(pos?.y), pos ? pos.rotation ?? 0 : ''];
        })],
    },
  ];
}

// ---------------------------------------------------------------- import

const HEADERS = {
  name: ['name', 'participant', 'participantname', 'fullname', 'delegate'],
  seat: ['seat', 'seatname', 'seatid', 'seatnumber'],
  nfc: ['nfc', 'nfctag', 'nfcid', 'badge', 'card'],
  id: ['id', 'participantid'],
};
const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');
const cellText = v => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v)).trim();

/**
 * Turn an uploaded workbook into a change plan against the current participants. Nothing is changed here.
 * @param {{ name: string, rows: any[][] }[]} sheets
 * @param {{ participants: Participant[], seats: Seat[], remove?: boolean, maxName?: number }} current
 */
export function planImport(sheets, { participants, seats, remove = false, maxName = Infinity }) {
  const errors = [];
  const warnings = [];
  const sheet = sheets.find(s => norm(s.name) === 'participants') ?? sheets.find(s => s.rows.some(r => r.some(c => cellText(c)))) ?? null;
  const plan = { sheet: sheet?.name ?? null, columns: {}, creates: [], updates: [], deletes: [], unassigns: [], unchanged: 0, errors, warnings };
  if (!sheet) { errors.push({ line: null, message: 'The file has no data' }); return plan; }

  // Header row: the first of the top 10 rows with a name column.
  let headerAt = -1;
  let col = {};
  for (let r = 0; r < Math.min(10, sheet.rows.length) && headerAt < 0; r++) {
    const found = {};
    (sheet.rows[r] ?? []).forEach((c, i) => {
      for (const [key, names] of Object.entries(HEADERS)) if (found[key] === undefined && names.includes(norm(c))) found[key] = i;
    });
    if (found.name !== undefined) { headerAt = r; col = found; }
  }
  if (headerAt < 0) { errors.push({ line: null, message: `Sheet "${sheet.name}" has no "Name" column header` }); return plan; }
  plan.columns = { name: true, seat: col.seat !== undefined, nfc: col.nfc !== undefined, id: col.id !== undefined };

  const seatByKey = new Map();
  for (const s of seats) { seatByKey.set(s.id.toLowerCase(), s); seatByKey.set(s.name.trim().toLowerCase(), s); }
  const byId = new Map(participants.map(p => [p.id, p]));
  const matched = new Set();
  const names = new Map(); // lower name → line
  const seatLines = new Map(); // seat id → line
  const nfcLines = new Map();
  const rows = [];

  sheet.rows.slice(headerAt + 1).forEach((row, i) => {
    const line = headerAt + i + 2; // spreadsheet row number
    const get = key => (col[key] === undefined ? undefined : cellText(row?.[col[key]]));
    const name = get('name');
    if (!(row ?? []).some(c => cellText(c))) return; // empty row
    if (!name) return errors.push({ line, message: 'Name is empty' });
    if ([...name].length > maxName) return errors.push({ line, message: `"${name}": name longer than ${maxName} characters` });
    const lower = name.toLowerCase();
    if (names.has(lower)) return errors.push({ line, message: `"${name}" is also in row ${names.get(lower)}` });
    names.set(lower, line);

    let seatId; // undefined = column absent (keep), null = no seat
    const seatText = get('seat');
    if (seatText !== undefined) {
      if (!seatText) seatId = null;
      else {
        const seat = seatByKey.get(seatText.toLowerCase());
        if (!seat) return errors.push({ line, message: `"${name}": unknown seat "${seatText}"` });
        if (seatLines.has(seat.id)) return errors.push({ line, message: `"${name}": seat ${seat.name} is also given in row ${seatLines.get(seat.id)}` });
        seatLines.set(seat.id, line);
        seatId = seat.id;
      }
    }
    const nfc = get('nfc');
    if (nfc) {
      const key = nfc.toLowerCase();
      if (nfcLines.has(key)) return errors.push({ line, message: `"${name}": NFC tag ${nfc} is also in row ${nfcLines.get(key)}` });
      nfcLines.set(key, line);
    }

    // Match: ID column first, then name (case-insensitive).
    const idText = get('id');
    let p = idText ? byId.get(idText) : undefined;
    if (idText && !p) warnings.push({ line, message: `"${name}": ID ${idText} does not exist, matched by name instead` });
    if (p && matched.has(p.id)) return errors.push({ line, message: `"${name}": ID ${idText} is used twice` });
    if (!p) p = participants.find(x => !matched.has(x.id) && x.name.trim().toLowerCase() === lower);
    if (p) matched.add(p.id);
    rows.push({ line, p, name, seatId, nfc });
  });

  const seatName = id => seats.find(s => s.id === id)?.name ?? id;
  for (const { line, p, name, seatId, nfc } of rows) {
    if (!p) { plan.creates.push({ line, name, seatId: seatId ?? null, seatName: seatId ? seatName(seatId) : null, nfc: nfc ?? '' }); continue; }
    const to = {};
    if (p.name !== name) to.name = name;
    if (seatId !== undefined && (p.assignedSeatId ?? null) !== seatId) to.seatId = seatId;
    if (nfc !== undefined && (p.nfc ?? '') !== nfc) to.nfc = nfc;
    if (!Object.keys(to).length) { plan.unchanged++; continue; }
    plan.updates.push({ line, id: p.id, name: p.name, to, from: { seatId: p.assignedSeatId ?? null, seatName: p.assignedSeatId ? seatName(p.assignedSeatId) : null, nfc: p.nfc ?? '' },
      seatName: to.seatId ? seatName(to.seatId) : null });
  }
  for (const p of participants.filter(x => !matched.has(x.id))) {
    if (remove) { plan.deletes.push({ id: p.id, name: p.name }); continue; }
    // Kept, but its seat / NFC tag goes to someone in the file.
    const loseSeat = p.assignedSeatId && seatLines.has(p.assignedSeatId);
    const loseNfc = p.nfc && nfcLines.has(p.nfc.toLowerCase());
    if (loseSeat || loseNfc) {
      plan.unassigns.push({ id: p.id, name: p.name, seat: Boolean(loseSeat), nfc: Boolean(loseNfc), seatName: loseSeat ? seatName(p.assignedSeatId) : null });
      warnings.push({ line: null, message: `${p.name} is not in the file and loses ${[loseSeat && `seat ${seatName(p.assignedSeatId)}`, loseNfc && 'the NFC tag'].filter(Boolean).join(' and ')}` });
    }
  }
  if (!rows.length && !errors.length) errors.push({ line: null, message: `Sheet "${sheet.name}" has no participant rows` });
  return plan;
}

/** Number of writes a plan needs (for progress / reporting). */
export const planSize = plan => plan.creates.length + plan.updates.length + plan.deletes.length + plan.unassigns.length;

/**
 * Execute a plan: deletes → free seats / NFC tags that move → updates → creates (so the system never sees a seat or
 * tag held twice). Stops at the first refused write.
 * @param {ReturnType<typeof planImport>} plan
 * @param {{ create: (p: { name: string, seatId: string | null, nfc: string }) => Promise<unknown>,
 *   update: (id: string, fields: { name?: string, seatId?: string | null, nfc?: string }) => Promise<unknown>,
 *   remove: (id: string) => Promise<unknown> }} ops
 * @returns {Promise<{ done: number, total: number, error?: { message: string, step: string } }>}
 */
export async function applyImport(plan, ops) {
  if (plan.errors.length) throw new Error('The plan has errors');
  const steps = [];
  for (const d of plan.deletes) steps.push([`delete ${d.name}`, () => ops.remove(d.id)]);
  for (const u of plan.unassigns) steps.push([`free ${u.name}`, () => ops.update(u.id, { ...(u.seat ? { seatId: null } : {}), ...(u.nfc ? { nfc: '' } : {}) })]);
  for (const u of plan.updates) {
    const release = { ...('seatId' in u.to && u.from.seatId ? { seatId: null } : {}), ...('nfc' in u.to && u.from.nfc ? { nfc: '' } : {}) };
    if (Object.keys(release).length) steps.push([`free ${u.name}`, () => ops.update(u.id, release)]);
  }
  for (const u of plan.updates) {
    const fields = { ...u.to };
    if (fields.seatId === null && u.from.seatId) delete fields.seatId; // already freed
    if (fields.nfc === '' && u.from.nfc) delete fields.nfc;
    if (Object.keys(fields).length) steps.push([`update ${u.name}`, () => ops.update(u.id, fields)]);
  }
  for (const c of plan.creates) steps.push([`create ${c.name}`, () => ops.create({ name: c.name, seatId: c.seatId, nfc: c.nfc })]);
  let done = 0;
  for (const [step, run] of steps) {
    try { await run(); } catch (err) { return { done, total: steps.length, error: { message: err.message, step } }; }
    done++;
  }
  return { done, total: steps.length };
}
