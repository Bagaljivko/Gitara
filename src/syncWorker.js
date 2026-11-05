// Web Worker za sinhronizaciju: mreža, gzip, SHA i upis u bazu ne opterećuju ekran.
import { createRunner } from './syncRunner.js';
const handle = createRunner((m) => self.postMessage(m));
self.onmessage = (e) => { handle(e.data); };
