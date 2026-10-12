// Linked simulation (WO-101, DEC-029 §4): a mock dicentis-bridge whose DCNM state is built from, and kept in step with,
// a running Conference Protocol mock, as on a real system where both APIs see one DICENTIS database:
// same seats and interpreter desks, the wired active meeting, the wired interpretation languages (same ids) as the
// meeting languages, the wired participants as persons + participants of the active meeting (WO-106); DCNM changes to
// meeting languages / desk outputs / presentation / participants are written into the wired mock's state and announced
// with its events; presentation switched through the Conference Protocol is seen by DCNM too.
import { createMockDcnmBridge, PARTICIPANT_GROUP_ID } from './server.js';
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
  // Participants (WO-106): wired participantId = DCNM participant Id, personId = the person's UserId.
  const meetingId = ws.activeMeetingId ?? 'meeting-1';
  const persons = ws.participants.map(p => ({
    UserId: p.personId, UserName: p.userName || p.personId, Password: '', PinCode: '',
    User: { UserId: p.personId, FirstName: p.firstName ?? '', MiddleName: p.middleName ?? '', LastName: p.lastName ?? '', Title: p.title ?? '',
      Group: p.group ?? '', Country: p.country ?? '', Region: p.region ?? '', Email: p.email ?? '', NFCId: '', UiLanguage: '', UserGroupId: PARTICIPANT_GROUP_ID },
  }));
  const participants = ws.participants.map(p => ({
    Id: p.participantId, MeetingId: meetingId, UserId: p.personId, UserName: p.userName || p.personId, ScreenLine: p.screenLine ?? '',
    AssignedAt: ws.seats.find(x => x.assignedParticipantId === p.participantId)?.seatId ?? EMPTY_GUID,
    CanDiscuss: true, CanVote: Boolean(p.canVote), CanUsePriority: Boolean(p.canPrio), CanManageMeeting: false, HasSpecialPermission: false,
    VipType: 'None', VoteWeight: p.voteWeight ?? 1,
  }));
  const world = createDcnmWorld({
    seats: ws.seats.map(s => ({ id: s.seatId, name: s.seatName })),
    interpreterSeats: interp.seats.map(d => ({ id: d.seatId, name: `Booth ${boothNumber(d.boothId)} Desk ${d.deskNumber}` })),
    meetingId,
    meetingTitle: ws.meetings?.find(m => m.meetingId === ws.activeMeetingId)?.meetingTitle ?? 'Meeting',
    languages,
    meetingLanguageIds: wiredLangs.map(l => l.languageId),
    presentation: Boolean(ws.isPresentationEnabled),
    persons,
    participants,
    participantGroupId: PARTICIPANT_GROUP_ID,
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
  const writeParticipants = () => {
    const old = new Map(ws.participants.map(p => [p.participantId, p]));
    ws.participants = world.participants.filter(p => p.MeetingId === world.meetingId).map(p => {
      const u = world.persons.find(x => x.UserId === p.UserId)?.User ?? {};
      return {
        canPrio: p.CanUsePriority, canVote: p.CanVote, country: u.Country ?? '', email: u.Email ?? '', firstName: u.FirstName ?? '', group: u.Group ?? '',
        isAuthenticated: old.get(p.Id)?.isAuthenticated ?? false, lastName: u.LastName ?? '', middleName: u.MiddleName ?? '', participantId: p.Id,
        participantType: 'local', personId: p.UserId, pictureUpdatedNumber: 0, region: u.Region ?? '',
        screenLine: [u.Title, u.FirstName, u.MiddleName, u.LastName].filter(Boolean).join(' ') || p.ScreenLine, title: u.Title ?? '',
        userName: p.UserName, visType: 'none', voteWeight: p.VoteWeight,
      };
    });
    const ids = new Set(ws.participants.map(p => p.participantId));
    for (const seat of ws.seats) {
      const holder = world.participants.find(p => p.AssignedAt === seat.seatId);
      seat.assignedParticipantId = holder?.Id ?? '';
      if (seat.seatedParticipantId && !ids.has(seat.seatedParticipantId)) seat.seatedParticipantId = '';
      const shown = ws.participants.find(p => p.participantId === (seat.seatedParticipantId || seat.assignedParticipantId));
      seat.screenLine = shown?.screenLine ?? seat.seatName;
    }
    wired.fire('participantsChanged', 'participantSeatsChanged', 'seatsChanged');
  };
  let fromWired = false;
  onChange(world, kind => {
    if (kind === 'meetingLanguages') { writeLanguages(); writeDesks(); }   // deleting a language also clears desks
    if (kind === 'languages') writeLanguages();                             // labels of meeting languages
    if (kind === 'desks') writeDesks();
    if (kind === 'persons' || kind === 'participants') writeParticipants();
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
