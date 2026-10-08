import session from './session.js';
import seats from './seats.js';
import meeting from './meeting.js';
import voting from './voting.js';
import system from './system.js';
import interpretation from './interpretation.js';
import files from './files.js';
import v650 from './v650.js';
import plugins from './plugins.js';

/** operation name (lower case) → behaviour */
export const behaviours = new Map(
  Object.entries({ ...session, ...seats, ...meeting, ...voting, ...system, ...interpretation, ...files, ...v650, ...plugins }).map(([k, v]) => [k.toLowerCase(), v]),
);
