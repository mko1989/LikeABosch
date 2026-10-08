// Match the seats of a project to the seats of the connected system (WO-096): e.g. a room prepared on a simulated
// system, loaded at the venue. Pure, no DOM. Order of rules: same id, same name, same number in the name ("Seat 12",
// "seat-12", "12"), the chairman, then the rest in natural name order. Unmatched plan seats → null (off the plan).

const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** A comparable number or role in a seat name/id: "Seat 12" → "n12", "Chairman" → "chair". */
export function seatToken(name) {
  const n = norm(name);
  if (/chair|president|voorzitter|przewodnicz/.test(n)) return 'chair';
  const m = n.match(/(\d+)(?!.*\d)/);
  return m ? `n${Number(m[1])}` : null;
}
const natural = (a, b) => norm(a.name).localeCompare(norm(b.name), undefined, { numeric: true });

/**
 * @param {{ id: string, name: string }[]} plan    seats on the plan (name = remembered name, else id)
 * @param {{ id: string, name: string }[]} system  seats of the connected system
 * @returns {{ map: Record<string, string | null>, how: Record<string, 'id' | 'name' | 'number' | 'order' | null> }}
 */
export function proposeMatch(plan, system) {
  const map = {};
  const how = {};
  const free = new Map(system.map(s => [s.id, s]));
  const take = (p, s, why) => { map[p.id] = s.id; how[p.id] = why; free.delete(s.id); };
  const rule = (why, key) => {
    for (const p of plan) {
      if (p.id in map) continue;
      const k = key(p);
      if (k === null || k === '') continue;
      const s = [...free.values()].find(x => key(x) === k);
      if (s) take(p, s, why);
    }
  };
  rule('id', x => x.id);
  rule('name', x => norm(x.name));
  rule('number', x => seatToken(x.name) ?? seatToken(x.id));
  const restPlan = plan.filter(p => !(p.id in map)).sort(natural);
  const restSys = [...free.values()].sort(natural);
  restPlan.forEach((p, i) => { if (restSys[i]) take(p, restSys[i], 'order'); else { map[p.id] = null; how[p.id] = null; } });
  return { map, how };
}

/** Plan seats whose id the connected system does not know (they need matching). */
export function unmatchedSeats(planIds, systemIds) {
  const known = new Set(systemIds);
  return planIds.filter(id => !known.has(id));
}
