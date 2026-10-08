// Interpreter desk helpers shared by Room, Audio and Interpretation views (WO-048).
// Real DICENTIS 6.50 semantics (probe 2026-10-03):
//   - GetInterpretationRoutings lists a desk only while its microphone is on → input unknown while the mic is off;
//   - floor = the language with index 0 (abbreviation "FLR"); SelectInterpretationFloor reports its id as the source;
//   - relay = empty source language with quality "Unknown";
//   - enum values come back PascalCase ("ActiveOnOutputA", "Plus").

const camel = v => (typeof v === 'string' && v ? v[0].toLowerCase() + v.slice(1) : v);

/** @param {{ topic: (name: string) => any }} store */
export function interpreters(store) {
  const languages = () => store.topic('interpretationLanguages')?.languages ?? [];
  const floorId = () => languages().find(l => l.index === 0)?.languageId ?? null;
  const isFloor = id => Boolean(id) && (id === floorId() || String(id).toLowerCase() === 'floor');
  const isRelay = id => id === '' || String(id).toLowerCase() === 'relay';
  const find = id => languages().find(l => l.languageId === id);
  return {
    /** Meeting languages without the floor entry. */
    languages: () => languages().filter(l => !isFloor(l.languageId)),
    floorId,
    isFloor,
    /** Short label of a language id (floor → "Floor"). */
    abbr: id => (!id ? '—' : isFloor(id) ? 'Floor' : find(id)?.abbreviation ?? '?'),
    /** Full name of a language id. */
    name: id => (!id ? '—' : isFloor(id) ? 'Floor' : find(id)?.label ?? id),
    /** The routing of a desk, or undefined (no routing = microphone off). */
    routing: seatId => store.topic('interpretationRoutings')?.routings?.find(r => r.seatId === seatId),
    /** 'off' | 'activeOnOutputA' | 'activeOnOutputB' | 'activeOnOutputC' */
    mic: routing => camel(routing?.microphoneState) ?? 'off',
    /** What the desk listens to: 'floor' | 'relay' | languageId | null (not reported). */
    source: routing => (!routing ? null : isFloor(routing.sourceLanguageId) ? 'floor' : isRelay(routing.sourceLanguageId) ? 'relay' : routing.sourceLanguageId),
    /** Display label for a source() value. */
    sourceLabel(src, { short = true } = {}) {
      if (src === null || src === undefined) return null;
      if (src === 'floor') return 'Floor';
      if (src === 'relay') return 'Relay';
      return short ? this.abbr(src) : this.name(src);
    },
    quality: routing => camel(routing?.destinationLanguageQuality) ?? null,
  };
}
