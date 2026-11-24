// v2.4.10: dani zaredom sa „štitom“. Svakih 7 dana vežbanja zaredom = 1 štit (najviše 2). Propušten dan pojede štit
// umesto da prekine niz (štit se troši sam). Danas se ne računa kao propušten dok dan traje.
// Čista funkcija nad istorijom dana — isti rezultat na svakom uređaju (sinhronizuje se samo aktivnost, ne štitovi).
export const SHIELD_EVERY = 7, SHIELD_MAX = 2;

/** days: { [dayNum]: ms vežbanja/sviranja }, today: dayNum. */
export function streakOf(days, today) {
  const keys = Object.keys(days || {}).map(Number).filter((d) => Number.isFinite(d) && d <= today && Number(days[d]) > 0).sort((a, b) => a - b);
  let streak = 0, shields = 0, run = 0, best = 0, saved = [], prev = null;
  const miss = (from, to) => { // propušteni dani strogo između from i to
    const gap = to - from - 1; if (gap <= 0) return true;
    if (gap <= shields) { shields -= gap; for (let k = from + 1; k < to; k++) saved.push(k); return true; }
    return false;
  };
  for (const d of keys) {
    if (prev != null && !miss(prev, d)) { streak = 0; run = 0; shields = 0; saved = []; }
    streak++; run++;
    if (run % SHIELD_EVERY === 0) shields = Math.min(SHIELD_MAX, shields + 1);
    if (streak > best) best = streak;
    prev = d;
  }
  if (prev == null) return { streak: 0, shields: 0, saved: [], best: 0, todayDone: false };
  if (!miss(prev, today)) return { streak: 0, shields: 0, saved: [], best, todayDone: false };
  return { streak, shields, saved, best, todayDone: prev === today };
}
/** Iz zbira aktivnosti (activity.totals().days). */
export const daysMs = (totDays) => Object.fromEntries(Object.entries(totDays || {}).map(([k, v]) => [k, (Number(v && v.p) || 0) + (Number(v && v.x) || 0)]));
