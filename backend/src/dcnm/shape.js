// DCNM data classes as the dicentis-bridge builds them (WO-115): a class without a parameterless constructor is made
// through the constructor whose parameters are exactly the JSON members, and members left over are refused (its
// properties are read-only; bridge/common/ClrConvert.cs). Objects read from the API carry every property, some of
// which no constructor takes (e.g. DcnmSeatConfigurationInfo.HasVotingLicense2), so a read-modify-write must be cut
// down to a constructor. The mock bridge checks the same rule (mock/dcnm/server.js checkShape).
import { AppError } from '../lib/errors.js';
import { loadDcnmSpec } from './spec.js';

let classes = null;
const types = () => (classes ??= loadDcnmSpec().types.classes);

/**
 * `obj` with exactly the members of the largest constructor of `className` whose parameters it all has (names
 * case-insensitive; the keys stay as given). Throws when no constructor fits.
 * @param {string} className e.g. 'DcnmSeatConfigurationInfo'
 * @param {Record<string, unknown>} obj
 * @param {{ classes?: Record<string, any> }} [options]  the type spec (tests)
 */
export function toConstructor(className, obj, { classes: given } = {}) {
  const cls = (given ?? types())[className];
  if (!cls) throw new Error(`Unknown DCNM class ${className}`);
  const keys = new Map(Object.keys(obj).map(k => [k.toLowerCase(), k]));
  const fits = (cls.constructors ?? []).filter(c => (c.params ?? []).length && c.params.every(p => keys.has(p.name.toLowerCase())));
  const best = fits.sort((a, b) => b.params.length - a.params.length)[0];
  if (!best) {
    const missing = (cls.constructors ?? []).map(c => (c.params ?? []).filter(p => !keys.has(p.name.toLowerCase())).map(p => p.name)).sort((a, b) => a.length - b.length)[0] ?? [];
    throw new AppError('UPSTREAM_ERROR', `${className}: no constructor takes these members (missing ${missing.join(', ')})`);
  }
  return Object.fromEntries(best.params.map(p => {
    const key = keys.get(p.name.toLowerCase());
    return [key, obj[key]];
  }));
}
