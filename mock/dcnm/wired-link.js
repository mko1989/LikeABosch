// Linked simulation (WO-101, DEC-029 §4): a mock dicentis-bridge whose DCNM state is built from, and kept in step with,
// a running Conference Protocol mock, as on a real system where both APIs see one DICENTIS database:
// same seats and interpreter desks, the wired active meeting, the wired interpretation languages (same ids) as the
// meeting languages; DCNM changes to meeting languages / desk outputs / presentation are written into the wired mock's
// state and announced with its events; presentation switched through the Conference Protocol is seen by DCNM too.
import { createMockDcnmBridge } from './server.js';
import { createDcnmWorld, onChange, EMPTY_GUID } from './behaviours.js';
import { ensure as ensureInterpretation } from '../wired/behaviours/interpretation.js';

/** System languages of the simulation; the wired mock's languages keep their ids (matched by abbreviation). */
const LANGUAGES = [
  ['EN', 'en', 'English', 'English'], ['FR', 'fr', 'French', 'Français'], ['DE', 'de', 'German', 'Deutsch'],
  ['ES', 'es', 'Spanish', 'Español'], ['IT', 'it', 'Italian', 'Italiano'], ['NL', 'nl', 'Dutch', 'Nederlands'],
  ['PT', 'pt', 'Portuguese', 'Português'], ['PL', 'pl', 'Polish', 'Polski'], ['RU', 'ru', 'Russian', 'Русский'],
  ['AR', 'ar', 'Arabic', 'العربية'], ['ZH', 'zh', 'Chinese', '中文'], ['JA', 'ja', 'Japanese', '日本語'],
];
const FLOOR = 'lang-floor';
const real = id => id && id !== EMPTY_GUID;

/**
 * Start a mock dicentis-bridge linked to a wired mock.
 * @param {{ state: any, fire: (...events: string[]) => void }} wired the object createMockWiredServer() returned
 * @param {Parameters<typeof createMockDcnmBridge>[0]} [options]
 */
export async function createLinkedDcnmBridge(wired, options = {}) {
  const ws = wired.state;
  ensureInterpretation(ws); // the wired mock creates it on first use
  const interp = ws.interpretation;
  const wiredLangs = interp.languages.filter(l => l.languageId !== FLOOR).sort((a, b) => a.index - b.index);
  let n = 0;
  const languages = LANGUAGES.map(([abbr, short, en, org]) => ({
    LanguageId: wiredLangs.find(l => l.abbreviation.toUpperCase() === abbr)?.languageId ?? `lang-sim-${short}-${++n}`,
    Abbreviation: abbr, ShortAbbreviation: short, EnLabel: en, OrgLabel: org,
  }));
  for (const l of wiredLangs) {
    if (!languages.some(x => x.LanguageId === l.languageId)) {
      languages.push({ LanguageId: l.languageId, Abbreviation: l.abbreviation, ShortAbbreviation: l.abbreviation.toLowerCase(), EnLabel: l.label, OrgLabel: l.label });
    }
  }
  const boothNumber = id => interp.booths.find(b => b.boothId === id)?.boothNumber ?? '?';
  const world = createDcnmWorld({
    seats: ws.seats.map(s => ({ id: s.seatId, name: s.seatName })),
    interpreterSeats: interp.seats.map(d => ({ id: d.seatId, name: `Booth ${boothNumber(d.boothId)} Desk ${d.deskNumber}` })),
    meetingId: ws.activeMeetingId ?? 'meeting-1',
    meetingTitle: ws.meetings?.find(m => m.meetingId === ws.activeMeetingId)?.meetingTitle ?? 'Meeting',
    languages,
    meetingLanguageIds: wiredLangs.map(l => l.languageId),
    presentation: Boolean(ws.isPresentationEnabled),
  });
  // Desk outputs as the wired mock has them.
  for (const desk of world.desks) {
    const d = interp.seats.find(x => x.seatId === desk.SeatId);
    if (!d) continue;
    Object.assign(desk, {
      LanguageIdOfOutputA: d.aLanguageId || EMPTY_GUID, OutBLanguageId: d.bLanguageId || EMPTY_GUID, OutCLanguageId: d.cLanguageId || EMPTY_GUID,
      OutputLanguageSetB: [...(d.bLanguageList ?? [])], OutputLanguageSetC: [...(d.cLanguageList ?? [])],
    });
  }

  const mock = await createMockDcnmBridge({ ...options, world });

  // DCNM → Conference Protocol
  const writeLanguages = () => {
    const floor = interp.languages.find(l => l.languageId === FLOOR) ?? { languageId: FLOOR, label: 'Floor', abbreviation: 'FLR', index: 0 };
    const meeting = [...world.meetingLanguages].sort((a, b) => a.OrderNumber - b.OrderNumber);
    interp.languages.splice(0, interp.languages.length, floor, ...meeting.map((m, i) => {
      const l = world.languages.find(x => x.LanguageId === m.LanguageId);
      return { languageId: m.LanguageId, label: l?.EnLabel ?? m.LanguageId, abbreviation: l?.Abbreviation ?? '?', index: i + 1 };
    }));
    wired.fire('interpretationLanguagesChanged');
  };
  const writeDesks = () => {
    for (const desk of world.desks) {
      const d = interp.seats.find(x => x.seatId === desk.SeatId);
      if (!d) continue;
      d.aLanguageId = real(desk.LanguageIdOfOutputA) ? desk.LanguageIdOfOutputA : '';
      d.bLanguageId = real(desk.OutBLanguageId) ? desk.OutBLanguageId : '';
      d.cLanguageId = real(desk.OutCLanguageId) ? desk.OutCLanguageId : '';
      d.bLanguageList = [...(desk.OutputLanguageSetB ?? [])];
      d.cLanguageList = [...(desk.OutputLanguageSetC ?? [])];
    }
    wired.fire('interpreterSeatsChanged');
  };
  let fromWired = false;
  onChange(world, kind => {
    if (kind === 'meetingLanguages') { writeLanguages(); writeDesks(); }   // deleting a language also clears desks
    if (kind === 'languages') writeLanguages();                             // labels of meeting languages
    if (kind === 'desks') writeDesks();
    if (kind === 'presentation' && !fromWired) {
      presentation = world.presentation;
      wired.fire('presentationStateChanged');
    }
  });

  // Conference Protocol → DCNM: presentation (the wired behaviours assign state.isPresentationEnabled).
  let presentation = Boolean(ws.isPresentationEnabled);
  Object.defineProperty(ws, 'isPresentationEnabled', {
    configurable: true, enumerable: true,
    get: () => presentation,
    set: v => {
      presentation = Boolean(v);
      if (world.presentation === presentation) return;
      world.presentation = presentation;
      fromWired = true;
      try { mock.emit('ControlPresentationApi', 'PresentationStateChanged', presentation); } finally { fromWired = false; }
      mock.setPresentationProperty?.(presentation);
    },
  });
  return mock;
}
