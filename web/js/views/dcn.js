// Settings → DCN (WO-063, DEC-017): operating a DCN NG system through the DCN-SW API and the dcn-bridge.
// Meeting/session start-stop, master volume + mute, voting script + ad-hoc voting, discussion settings, bridge status.
// Shared views (discussion, room, voting results, participants) already work through the domain layer (WO-062).
import { h, replace, humanize, actionButton, toastError } from '../dom.js';

const ANSWER_SETS = [
  ['ParliamentaryYesNo', 'Yes / No'], ['ParliamentaryYesNoAbstain', 'Yes / No / Abstain'],
  ['ParliamentaryYesNoAbstainDnpv', 'Yes / No / Abstain / Did not participate'], ['AudienceResponse', 'Audience response (-- … ++)'],
  ['OpinionPoll', 'Opinion poll (1 … 5)'],
];
const MAX_VOLUME = 30; // the CHM documents no range; ASSUMPTION shared with the mock (mock/dcn/README.md)

export default {
  id: 'dcn',
  feature: 'dcnControl',
  title: 'DCN',
  topics: ['dcnBridge'],
  mount(el, { store, api }) {
    const statusBox = h('div');
    const meetingBox = h('div');
    const audioBox = h('div');
    const votingBox = h('div');
    const adhocBox = h('div');
    const settingsBox = h('div');
    let draggingVolume = false;

    const t = name => store.topic(name);
    const allowed = flag => store.can(flag);
    const dcn = (key, args = {}) => {
      const i = key.lastIndexOf('.');
      return api.dcn(key.slice(0, i), key.slice(i + 1), args);
    };
    const unavailable = (topic, fallback = 'Not available') => h('p', { class: 'muted' }, store.unavailable(topic) ?? fallback);

    // ---------------------------------------------------------------- bridge / API status
    function renderStatus() {
      const b = t('dcnBridge');
      if (!b) return replace(statusBox, unavailable('dcnBridge', 'Not connected'));
      const root = (name, s) => h('div', { class: 'kv' }, h('span', { class: 'k' }, name),
        h('span', { class: 'v' }, !s?.initialized ? 'not initialized' : s.available ? 'available' : 'DCN-SW server not reachable'));
      const flags = Object.entries({ ...b.status?.control?.allowed, ...b.status?.config?.allowed });
      replace(statusBox,
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Bridge'), h('span', { class: 'v' }, `${b.bridge?.name ?? '?'} ${b.bridge?.version ?? ''}${b.bridge?.fake ? ' (fake API)' : ''}`)),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'DCN-SW API'), h('span', { class: 'v' }, b.bridge?.apiVersion || '—')),
        root('Control API', b.status?.control),
        root('Configuration API', b.status?.config),
        flags.length ? h('details', null, h('summary', null, `Rights (${flags.filter(([, v]) => v).length} of ${flags.length})`),
          h('ul', { class: 'chips' }, flags.map(([k, v]) => h('li', { class: v ? null : 'muted', title: v ? 'allowed' : 'not allowed' }, `${v ? '✓' : '✗'} ${k}`)))) : null);
    }

    // ---------------------------------------------------------------- meeting and session
    function renderMeeting() {
      const meetings = t('dcnMeetings');
      if (!meetings) return replace(meetingBox, unavailable('dcnMeetings'));
      const activeId = t('dcnActiveMeeting')?.meetingId ?? null;
      const sessionId = t('dcnActiveSession')?.sessionId ?? null;
      const sessions = t('dcnSessions') ?? [];
      const meetingControl = allowed('MeetingApi.IsMeetingControlAllowed');
      const sessionControl = allowed('MeetingApi.IsSessionControlAllowed');
      const active = meetings.find(m => m.id === activeId);
      replace(meetingBox,
        h('p', { class: 'headline' }, active ? active.Title || `Meeting ${active.id}` : 'No meeting running'),
        active ? h('p', { class: 'muted' }, sessionId ? `Session: ${sessions.find(s => s.id === sessionId)?.Subject || sessionId}` : 'No session running') : null,
        h('div', { class: 'list' }, meetings.map(m => h('div', { class: ['row-item', m.id === activeId && 'current'] },
          h('span', { class: ['state-dot', m.id === activeId ? 'opened' : 'deactivated'] }),
          h('span', { class: 'name' }, m.Title || `Meeting ${m.id}`, m.Description ? h('small', { class: 'sub' }, m.Description) : null),
          h('span'),
          h('span', { class: 'row-actions' },
            !meetingControl ? null
              : m.id === activeId
                ? actionButton('Stop', () => dcn('control.MeetingApi.StopMeetingById', { meetingId: m.id }), { cls: 'small danger-outline', danger: true, confirm: `Stop "${m.Title}"? All microphones and requests are cleared.` })
                : activeId === null ? actionButton('Start', () => dcn('control.MeetingApi.StartMeetingById', { meetingId: m.id }), { cls: 'small primary' }) : null)))),
        active && sessions.length ? h('h3', null, 'Sessions') : null,
        active ? h('div', { class: 'list' }, sessions.map(s => h('div', { class: ['row-item', s.id === sessionId && 'current'] },
          h('span', { class: ['state-dot', s.id === sessionId ? 'opened' : 'deactivated'] }),
          h('span', { class: 'name' }, s.Subject || `Session ${s.id}`, s.Description ? h('small', { class: 'sub' }, s.Description) : null),
          h('span'),
          h('span', { class: 'row-actions' },
            !sessionControl ? null
              : s.id === sessionId
                ? actionButton('Stop', () => dcn('control.MeetingApi.StopSessionById', { sessionId: s.id }), { cls: 'small' })
                : sessionId === null ? actionButton('Start', () => dcn('control.MeetingApi.StartSessionById', { sessionId: s.id }), { cls: 'small primary' }) : null)))) : null,
        !meetingControl ? h('p', { class: 'muted hint' }, 'This DCN-SW user may not start or stop meetings.') : null);
    }

    // ---------------------------------------------------------------- master volume + mute
    function renderAudio() {
      if (draggingVolume) return;
      const volume = t('dcnMasterVolume')?.volume;
      const mute = t('dcnMasterMute')?.mute;
      if (volume === undefined) return replace(audioBox, unavailable('dcnMasterVolume'));
      const may = allowed('DcnSystemApi.IsSensitivityAndVolumeLevelsChangeAllowed');
      const output = h('output', { class: 'volume-value' }, String(volume));
      const slider = h('input', { type: 'range', min: 0, max: Math.max(MAX_VOLUME, volume), step: 1, value: String(volume), 'aria-label': 'DCN master volume', disabled: !may });
      slider.addEventListener('input', () => { draggingVolume = true; output.textContent = slider.value; });
      slider.addEventListener('change', async () => {
        try { await dcn('control.DcnSystemApi.SetMasterVolume', { masterVolume: Number(slider.value) }); } catch (err) { toastError(err, 'Volume change failed: '); }
        finally { draggingVolume = false; renderAudio(); }
      });
      replace(audioBox,
        h('div', { class: 'volume' }, h('span', { class: 'muted' }, '0'), slider, h('span', { class: 'muted' }, String(Math.max(MAX_VOLUME, volume))), output),
        mute === undefined ? null : h('div', { class: 'actions' },
          h('span', { class: ['pill', mute ? 'error' : 'loggedIn'] }, mute ? 'Muted' : 'Not muted'),
          may ? actionButton(mute ? 'Unmute' : 'Mute all', () => dcn('control.DcnSystemApi.SetMasterMute', { masterMute: !mute }), { cls: mute ? 'primary' : 'secondary' }) : null),
        !may ? h('p', { class: 'muted hint' }, 'This DCN-SW user may not change volume levels.') : null);
    }

    // ---------------------------------------------------------------- voting script + ad-hoc
    const canVote = () => allowed('VoteApi.IsParliamentaryVotingControlAllowed') || allowed('VoteApi.IsMultiVotingControlAllowed');
    function renderVoting() {
      const script = t('dcnVotingScript');
      const sessionId = t('dcnActiveSession')?.sessionId ?? null;
      if (!sessionId) return replace(votingBox, h('p', { class: 'muted' }, 'Start a session to use its voting script.'));
      if (!script) return replace(votingBox, unavailable('dcnVotingScript'));
      const v = t('dcnVoting') ?? { state: 'closed' };
      const busy = v.state === 'opened' || v.state === 'onHold';
      const control = canVote();
      replace(votingBox,
        h('p', { class: 'headline' }, `Voting: ${humanize(v.state === 'done' && v.outcome ? v.outcome : v.state)}`),
        !script.length ? h('p', { class: 'muted' }, 'The voting script of this session is empty.') : null,
        h('div', { class: 'list' }, script.map(x => h('div', { class: ['row-item', v.votingId === x.id && 'current'] },
          h('span', { class: 'tag' }, x.VotingNumber || '·'),
          h('span', { class: 'name' }, x.Subject || x.VotingName || `Voting ${x.id}`, x.VotingName && x.Subject ? h('small', { class: 'sub' }, x.VotingName) : null),
          h('span'),
          h('span', { class: 'row-actions' },
            control && !busy && v.votingId !== x.id ? actionButton('Select', () => dcn('control.VoteApi.SelectVotingById', { votingId: x.id }), { cls: 'small', title: 'Show number and subject on the chairman unit' }) : null,
            control && !busy ? actionButton('Start', () => dcn('control.VoteApi.StartVotingById', { votingId: x.id }), { cls: 'small primary' }) : null)))),
        control ? h('div', { class: 'actions' },
          v.state === 'opened' ? actionButton('Hold', () => api.domain('POST', '/voting/hold')) : null,
          v.state === 'onHold' ? actionButton('Resume', () => api.domain('POST', '/voting/resume'), { cls: 'primary' }) : null,
          busy ? actionButton('Stop voting', () => api.domain('POST', '/voting/close'), { cls: 'danger-outline', danger: true, confirm: 'Stop the voting and publish the results?' }) : null,
          busy ? actionButton('Summon', () => dcn('control.VoteApi.SummonVoting'), { title: 'Attention tone for the delegates' }) : null) : h('p', { class: 'muted hint' }, 'This DCN-SW user may not control votings.'),
        h('p', { class: 'muted small-text' }, 'Results and the live tally are shown in Settings → Voting.'));
    }

    function renderAdhoc() {
      const running = Boolean(t('dcnActiveMeeting')?.meetingId);
      const v = t('dcnVoting') ?? { state: 'closed' };
      const busy = v.state === 'opened' || v.state === 'onHold';
      if (!running) return replace(adhocBox, h('p', { class: 'muted' }, 'Start a meeting to run an ad-hoc voting.'));
      if (!canVote()) return replace(adhocBox, h('p', { class: 'muted' }, 'This DCN-SW user may not control votings.'));
      const subject = h('input', { name: 'subject', placeholder: 'e.g. Short break?', maxlength: 200 });
      const set = h('select', { name: 'answerSet', 'aria-label': 'Answer set' }, ANSWER_SETS.map(([value, label]) => h('option', { value }, label)));
      replace(adhocBox,
        h('label', { class: 'field' }, h('span', null, 'Subject'), subject),
        h('label', { class: 'field' }, h('span', null, 'Answers'), set),
        h('div', { class: 'actions' }, actionButton('Start ad-hoc voting', () => dcn('control.VoteApi.StartAdhocVoting', {
          votingSettings: { Subject: subject.value.trim(), VotingName: subject.value.trim(), VotingNumber: '', AnswerSet: set.value },
        }), { cls: 'primary', disabled: busy })),
        busy ? h('p', { class: 'muted hint' }, 'A voting is running.') : null);
    }

    // ---------------------------------------------------------------- discussion settings
    function renderSettings() {
      const s = t('dcnDiscussionSettings');
      if (!s) return replace(settingsBox, unavailable('dcnDiscussionSettings', 'Available while a meeting is running'));
      const may = allowed('DiscussionApi.IsDiscussMicrophoneManagementControllAllowed') || allowed('DiscussionApi.IsDiscussStandardControllAllowed');
      const num = (name, label, min, max) => h('label', { class: 'field' }, h('span', null, label),
        h('input', { name, type: 'number', min, max, value: String(s[name] ?? 0), disabled: !may }));
      const check = (name, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked: Boolean(s[name]), disabled: !may }), ` ${label}`);
      const form = h('form', { class: 'settings', novalidate: true },
        h('div', { class: 'row' }, num('NumberOfOpenMicrophones', 'Open microphones', 1, 25), num('MaximumNumberOfRequests', 'Max. requests (0 = none)', 0, 100)),
        check('AllowCancelRequest', 'Delegates may cancel their request'),
        check('AllowMicrophoneOff', 'Delegates may switch their microphone off'),
        check('MicrophonesOffAfterShift', 'Speakers off when the next request is shifted in'),
        check('CancelAllSpeakersAndRequests', 'Chairman priority cancels all speakers and requests'),
        check('AutomaticMicrophoneOff', 'Switch unused microphones off after 30 s'),
        may ? h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'secondary' }, 'Save')) : null);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const f = name => form.elements.namedItem(name);
        const next = { ...s };
        delete next.ChairmanMicrosOnCount; // read-only per the CHM ("not configurable")
        for (const n of ['NumberOfOpenMicrophones', 'MaximumNumberOfRequests']) next[n] = Number(f(n).value);
        for (const n of ['AllowCancelRequest', 'AllowMicrophoneOff', 'MicrophonesOffAfterShift', 'CancelAllSpeakersAndRequests', 'AutomaticMicrophoneOff']) next[n] = f(n).checked;
        try { await dcn('control.DiscussionApi.SetDiscussionSettings', { discussionInfo: next }); } catch (err) { toastError(err, 'Discussion settings: '); renderSettings(); }
      });
      replace(settingsBox, form, !may ? h('p', { class: 'muted hint' }, 'This DCN-SW user may not change discussion settings.') : null);
    }

    el.append(
      h('h1', { id: 'view-title' }, 'DCN'),
      h('div', { class: 'split' },
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Meeting'), meetingBox),
          h('article', { class: 'card' }, h('h2', null, 'Voting script'), votingBox),
          h('article', { class: 'card' }, h('h2', null, 'Ad-hoc voting'), adhocBox)),
        h('div', { class: 'stack' },
          h('article', { class: 'card' }, h('h2', null, 'Master audio'), audioBox),
          h('article', { class: 'card' }, h('h2', null, 'Discussion settings'), settingsBox),
          h('article', { class: 'card' }, h('h2', null, 'DCN-SW connection'), statusBox))),
    );
    const renders = [
      [['topic:dcnBridge', 'connection'], renderStatus],
      [['topic:dcnMeetings', 'topic:dcnActiveMeeting', 'topic:dcnActiveSession', 'topic:dcnSessions', 'connection'], renderMeeting],
      [['topic:dcnMasterVolume', 'topic:dcnMasterMute', 'connection'], renderAudio],
      [['topic:dcnVotingScript', 'topic:dcnVoting', 'topic:dcnActiveSession', 'connection'], renderVoting],
      [['topic:dcnActiveMeeting', 'topic:dcnVoting', 'connection'], renderAdhoc],
      [['topic:dcnDiscussionSettings', 'connection'], renderSettings],
    ];
    renders.forEach(([, fn]) => fn());
    const offs = renders.map(([keys, fn]) => store.subscribe(keys, fn));
    return () => offs.forEach(off => off());
  },
};
