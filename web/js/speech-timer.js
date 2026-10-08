// Speech timer per discussion entry (PDF p.68–69, docs/protocol/conference/README.md "Speech timer").
// Pure functions: unit-tested in web/test/speech-timer.test.js.

/**
 * Remaining speech time in ms (negative = overtime), or null if no timer should be shown.
 * @param {{ microphoneState: string, remainingSpeechDuration: number, speechStartTime: number, showSpeechTimer?: boolean }} entry
 * @param {number} referenceTime        `referenceTime` from the GetDiscussionList response (server tick, ms)
 * @param {number} localReferenceTime   Date.now() when that response was received
 * @param {number} [now]
 */
export function remainingSpeechMs(entry, referenceTime, localReferenceTime, now = Date.now()) {
  if (entry.showSpeechTimer === false) return null;
  if (!Number.isFinite(entry.remainingSpeechDuration)) return null;
  if (entry.microphoneState !== 'on') return entry.remainingSpeechDuration;
  return entry.remainingSpeechDuration - (referenceTime + (now - localReferenceTime) - entry.speechStartTime);
}
