// Štimovanja gitare (MIDI brojevi žica od 6. do 1. žice) i nazivi tonova za prikaz.
export const TUNINGS = {
  standard: { midi: [40, 45, 50, 55, 59, 64], names: ['E', 'A', 'D', 'G', 'B', 'E'] },
  dropD: { midi: [38, 45, 50, 55, 59, 64], names: ['D', 'A', 'D', 'G', 'B', 'E'] },
  halfDown: { midi: [39, 44, 49, 54, 58, 63], names: ['Eb', 'Ab', 'Db', 'Gb', 'Bb', 'Eb'] },
  dadgad: { midi: [38, 45, 50, 55, 57, 62], names: ['D', 'A', 'D', 'G', 'A', 'D'] },
  openG: { midi: [38, 43, 50, 55, 59, 62], names: ['D', 'G', 'D', 'G', 'B', 'D'] },
};
export const TUNING_IDS = Object.keys(TUNINGS);
export const tuningOf = (id) => TUNINGS[id] || TUNINGS.standard;
export const cleanTuning = (id) => (typeof id === 'string' && TUNINGS[id] ? id : 'standard');
/** Kratak zapis, npr. „D A D G B E“. */
export const tuningNotes = (id) => tuningOf(id).names.join(' ');
