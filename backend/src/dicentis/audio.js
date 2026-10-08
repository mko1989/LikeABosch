// DICENTIS audio & Dante over the DCNM API (WO-081, DEC-029): DCNM payloads → plain topics, request bodies → DCNM data
// classes. Pure functions; the service (service.js) does the calls.
import { AppError } from '../lib/errors.js';

export const EQ_TYPES = ['Loudspeaker', 'SoundReinforcement'];
export const EQ_FILTERS = ['LowShelving', 'Notch', 'HighShelving'];
export const DANTE_OUT = ['Disabled', 'DanteOutEnabledWhenMicOn', 'DanteOutEnabledAlways'];

/**
 * DcnmRoomAudioSettingsInfo → topic `dicentis.audio` (without capabilities, which the service adds).
 * @param {any} info
 */
export function audioFromDcnm(info) {
  const gains = (info?.AudioGainSettingList ?? []).map(g => ({
    type: g.GainSettingType, value: g.Value, min: g.MinimumGain, max: g.MaximumGain, step: g.StepSize || 0.5,
    muted: Boolean(g.IsMuted), testTone: Boolean(g.IsPlayingTestTone),
  }));
  const equalizers = Object.fromEntries(EQ_TYPES.map(t => [t, (info?.AudioEqualizerSettingsList ?? [])
    .filter(e => e.EqualizerType === t).sort((a, b) => a.FilterNumber - b.FilterNumber)
    .map(e => ({ band: e.FilterNumber, filter: e.FilterType, enabled: Boolean(e.FilterEnabled), gain: e.Gain, frequency: e.Frequency, q: e.QFactor }))]));
  const selections = (info?.AudioSelectionSettingList ?? []).map(s => ({ type: s.SelectionSettingType, value: s.Value }));
  return { gains, equalizers, selections };
}

/** DcnmSeatConfigurationInfo[] → seat audio rows. */
export function seatAudioFromDcnm(seats) {
  return (seats ?? []).map(s => ({
    id: s.Id, name: s.Name, number: s.SeatNumber, kind: s.SeatType === 'InterpreterSeat' ? 'interpreter' : 'participant',
    danteOut: s.DanteOut ?? 'Disabled', headroom: s.Headroom ?? 0,
  })).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
}

const bad = msg => new AppError('VALIDATION', msg);
const num = (v, what) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${what} must be a number`); return v; };
const bool = (v, what) => { if (typeof v !== 'boolean') throw bad(`${what} must be true or false`); return v; };

/**
 * Body { type, value?, muted?, testTone? } + the current gain → DcnmAudioGainSetting.
 * @param {any} body @param {ReturnType<typeof audioFromDcnm> | null} current
 */
export function gainSetting(body, current) {
  const g = current?.gains.find(x => x.type === body?.type);
  if (!g) throw bad(`Unknown gain '${body?.type}'`);
  const value = body.value === undefined ? g.value : num(body.value, 'value');
  if (value < g.min || value > g.max) throw bad(`value must be within ${g.min} … ${g.max} dB`);
  return {
    GainSettingType: g.type, Value: value, MinimumGain: g.min, MaximumGain: g.max, StepSize: g.step,
    IsMuted: body.muted === undefined ? g.muted : bool(body.muted, 'muted'),
    IsPlayingTestTone: body.testTone === undefined ? g.testTone : bool(body.testTone, 'testTone'),
  };
}

/** Body { equalizer, band, enabled?, filter?, gain?, frequency?, q? } + current → DcnmAudioEqualizerSettings. */
export function equalizerSetting(body, current) {
  if (!EQ_TYPES.includes(body?.equalizer)) throw bad(`equalizer must be one of ${EQ_TYPES.join(', ')}`);
  const b = current?.equalizers[body.equalizer]?.find(x => x.band === body.band);
  if (!b) throw bad(`Unknown band ${body.band} of the ${body.equalizer} equaliser`);
  const gain = body.gain === undefined ? b.gain : num(body.gain, 'gain');
  const frequency = body.frequency === undefined ? b.frequency : num(body.frequency, 'frequency');
  const q = body.q === undefined ? b.q : num(body.q, 'q');
  if (gain < -12 || gain > 12) throw bad('gain must be within -12 … 12 dB');
  if (!Number.isInteger(frequency) || frequency < 20 || frequency > 20000) throw bad('frequency must be a whole number 20 … 20000 Hz');
  if (q < 0.1 || q > 10) throw bad('q must be within 0.1 … 10');
  const filter = body.filter ?? b.filter;
  if (!EQ_FILTERS.includes(filter)) throw bad(`filter must be one of ${EQ_FILTERS.join(', ')}`);
  return {
    EqualizerType: body.equalizer, FilterNumber: b.band, FilterType: filter,
    FilterEnabled: body.enabled === undefined ? b.enabled : bool(body.enabled, 'enabled'), Gain: gain, Frequency: frequency, QFactor: q,
  };
}

/** Body { type, value } + current → DcnmAudioSelectionSetting. */
export function selectionSetting(body, current) {
  if (!current?.selections.some(s => s.type === body?.type)) throw bad(`Unknown audio selection setting '${body?.type}'`);
  if (!Number.isInteger(body.value)) throw bad('value must be a whole number');
  return { SelectionSettingType: body.type, Value: body.value };
}

/**
 * Body { seatIds, danteOut?, headroom? } + the DCNM seat objects → the updated DcnmSeatConfigurationInfo list.
 * @param {any} body @param {any[]} seats raw DCNM seats
 */
export function seatDanteUpdate(body, seats) {
  if (!Array.isArray(body?.seatIds) || !body.seatIds.length || body.seatIds.some(id => typeof id !== 'string')) throw bad('seatIds must be a non-empty list of seat ids');
  if (body.danteOut === undefined && body.headroom === undefined) throw bad('Give danteOut and/or headroom');
  if (body.danteOut !== undefined && !DANTE_OUT.includes(body.danteOut)) throw bad(`danteOut must be one of ${DANTE_OUT.join(', ')}`);
  if (body.headroom !== undefined && (!Number.isInteger(body.headroom) || body.headroom < -30 || body.headroom > 0)) throw bad('headroom must be a whole number -30 … 0 dB');
  return body.seatIds.map(id => {
    const s = seats.find(x => x.Id === id);
    if (!s) throw bad(`Unknown seat '${id}'`);
    return { ...s, ...(body.danteOut !== undefined ? { DanteOut: body.danteOut } : {}), ...(body.headroom !== undefined ? { Headroom: body.headroom } : {}) };
  });
}
