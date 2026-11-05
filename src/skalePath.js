// Skale → „Put“: koraci redom. Svaki korak = skala, pozicija i obrazac (+ kartica posle prvog prolaza).
// Dodavanje koraka: novi red ovde (+ naziv „sk.step.<id>“ u practiceText.js i kartica u skaleTheory.js ako je nova tema).
// key: osnovni ton 0–11 (C = 0, A = 9), pos: početni prag kutije, patterns: obrasci redom (korak je gotov posle poslednjeg).
export const PATH = [
  { id: 'first', key: 9, scale: 'minPent', pos: 5, patterns: ['updown'], card: 'pentatonic' },
  { id: 'home', key: 9, scale: 'minPent', pos: 5, patterns: ['updown'], roots: true, card: 'root' },
  { id: 'move', key: 7, scale: 'minPent', pos: 3, patterns: ['updown'], card: 'movable' },
  { id: 'thirds', key: 9, scale: 'minPent', pos: 5, patterns: ['thirds'], card: 'thirds' },
  { id: 'blues', key: 9, scale: 'blues', pos: 5, patterns: ['updown'], card: 'blues' },
  { id: 'majpent', key: 9, scale: 'majPent', pos: 4, patterns: ['updown'], card: 'majPent' },
  { id: 'minor', key: 9, scale: 'minor', pos: 5, patterns: ['updown'], card: 'minor' },
  { id: 'major', key: 0, scale: 'major', pos: 7, patterns: ['updown'], card: 'major' },
  { id: 'seq', key: 9, scale: 'minPent', pos: 5, patterns: ['seq3', 'seq4'], card: 'sequences' },
];
// Kartica za skalu iz slobodnog izbora (šta je ta skala)
export const SCALE_CARD = { minPent: 'pentatonic', majPent: 'majPent', major: 'major', minor: 'minor', blues: 'blues', chromatic: 'chromatic' };
export const PATTERN_CARD = { thirds: 'thirds', seq3: 'sequences', seq4: 'sequences' };
