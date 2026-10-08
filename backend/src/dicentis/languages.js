// Languages over the DCNM API (WO-102, DEC-029): system language list, the active meeting's languages, interpreter desk
// output languages. DCNM payloads → plain topics, request bodies → DCNM data classes. Pure functions.
import { AppError } from '../lib/errors.js';

export const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
const real = id => typeof id === 'string' && id !== '' && id !== EMPTY_GUID;
const bad = msg => new AppError('VALIDATION', msg);

/** DcnmLanguageInfo[] → topic `dicentis.languages`. */
export function languagesFromDcnm(list) {
  return (list ?? []).map(l => ({
    id: l.LanguageId, abbreviation: l.Abbreviation, short: l.ShortAbbreviation ?? '', label: l.EnLabel, native: l.OrgLabel ?? '',
    userDefined: Boolean(l.UserDefined), order: l.OrderId ?? 0,
  })).sort((a, b) => a.label.localeCompare(b.label));
}

/** DcnmMeetingLanguageInfo[] → the `languages` of topic `dicentis.meetingLanguages`. */
export function meetingLanguagesFromDcnm(list) {
  return (list ?? []).map(m => ({
    id: m.LanguageId, order: m.OrderNumber, source: m.LanguageSourceType ?? 'Dicentis', danteOut: Boolean(m.OutputToDante),
    stream2: { enabled: Boolean(m.Stream2Enable), headroom: m.Stream2Headroom ?? 0, min: m.MinimumStream2Headroom ?? -20, max: m.MaximumStream2Headroom ?? 0,
      danteOut: Boolean(m.Stream2OutputToDante), floorFill: Boolean(m.Stream2FloorFill) },
  })).sort((a, b) => a.order - b.order);
}

/** DcnmMeetingDeskInfo[] (+ seat names) → topic `dicentis.desks`. */
export function desksFromDcnm(list, names = new Map()) {
  const id = v => (real(v) ? v : null);
  return (list ?? []).map(d => ({
    seatId: d.SeatId, name: names.get(d.SeatId) ?? d.SeatId,
    outA: id(d.LanguageIdOfOutputA), outB: id(d.OutBLanguageId), outC: id(d.OutCLanguageId),
    setB: [...(d.OutputLanguageSetB ?? [])], setC: [...(d.OutputLanguageSetC ?? [])],
  })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

const text = (v, what, max = 60) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`${what} is required (at most ${max} characters)`);
  return v.trim();
};

/** Body { abbreviation, short?, label, native? } (+ existing for update) → DcnmLanguageInfo. */
export function languageInfo(body, existing = null) {
  const abbreviation = body?.abbreviation === undefined && existing ? existing.Abbreviation : text(body?.abbreviation, 'abbreviation', 8);
  const label = body?.label === undefined && existing ? existing.EnLabel : text(body?.label, 'label');
  const short = body?.short === undefined ? existing?.ShortAbbreviation ?? abbreviation.toLowerCase().slice(0, 3) : String(body.short).trim().slice(0, 8);
  const native = body?.native === undefined ? existing?.OrgLabel ?? label : String(body.native).trim().slice(0, 60) || label;
  return { ...(existing ?? { UserDefined: true, OrderId: 0 }), Abbreviation: abbreviation, ShortAbbreviation: short, EnLabel: label, OrgLabel: native };
}

/** Body { languageId, danteOut?, stream2?: { enabled?, headroom?, danteOut?, floorFill? } } + the raw meeting language → update. */
export function meetingLanguageUpdate(body, raw) {
  if (!raw) throw bad(`Language '${body?.languageId}' is not a language of the meeting`);
  const s2 = body.stream2 ?? {};
  const out = { ...raw };
  if (body.danteOut !== undefined) out.OutputToDante = Boolean(body.danteOut);
  if (s2.enabled !== undefined) out.Stream2Enable = Boolean(s2.enabled);
  if (s2.danteOut !== undefined) out.Stream2OutputToDante = Boolean(s2.danteOut);
  if (s2.floorFill !== undefined) out.Stream2FloorFill = Boolean(s2.floorFill);
  if (s2.headroom !== undefined) {
    const lo = raw.MinimumStream2Headroom ?? -20, hi = raw.MaximumStream2Headroom ?? 0;
    if (typeof s2.headroom !== 'number' || s2.headroom < lo || s2.headroom > hi) throw bad(`stream2.headroom must be within ${lo} … ${hi} dB`);
    out.Stream2Headroom = s2.headroom;
  }
  return out;
}

/**
 * New order: language ids in the wanted order → the meeting's current order numbers in that order (what
 * ChangeMeetingLanguagesOrderAsync takes).
 */
export function orderNumbers(languageIds, raw) {
  if (!Array.isArray(languageIds) || languageIds.length !== raw.length || new Set(languageIds).size !== raw.length) throw bad('languageIds must list every meeting language once');
  return languageIds.map(id => {
    const m = raw.find(x => x.LanguageId === id);
    if (!m) throw bad(`Language '${id}' is not a language of the meeting`);
    return m.OrderNumber;
  });
}

/** Body { seatId, outA?, outB?, outC?, setB?, setC? } (null = none) + raw desk + meeting language ids → DcnmMeetingDeskInfo. */
export function deskUpdate(body, raw, meetingIds) {
  if (!raw) throw bad(`Unknown interpreter desk '${body?.seatId}'`);
  const check = (v, what) => {
    if (v === null || v === '') return EMPTY_GUID;
    if (!meetingIds.includes(v)) throw bad(`${what}: '${v}' is not a language of the meeting`);
    return v;
  };
  const list = (v, what) => {
    if (!Array.isArray(v)) throw bad(`${what} must be a list of language ids`);
    return [...new Set(v.map(x => check(x, what)))].filter(real);
  };
  const out = { ...raw };
  if (body.outA !== undefined) out.LanguageIdOfOutputA = check(body.outA, 'outA');
  if (body.setB !== undefined) out.OutputLanguageSetB = list(body.setB, 'setB');
  if (body.setC !== undefined) out.OutputLanguageSetC = list(body.setC, 'setC');
  if (body.outB !== undefined) out.OutBLanguageId = check(body.outB, 'outB');
  if (body.outC !== undefined) out.OutCLanguageId = check(body.outC, 'outC');
  // B and C can only output a language of their selectable set.
  if (real(out.OutBLanguageId) && !out.OutputLanguageSetB.includes(out.OutBLanguageId)) out.OutputLanguageSetB = [...out.OutputLanguageSetB, out.OutBLanguageId];
  if (real(out.OutCLanguageId) && !out.OutputLanguageSetC.includes(out.OutCLanguageId)) out.OutputLanguageSetC = [...out.OutputLanguageSetC, out.OutCLanguageId];
  return out;
}
