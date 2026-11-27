// v2.5.1: pravilo „sve što aplikacija čuva ide u sinhronizaciju i rezervnu kopiju — ili je izričito samo na uređaju“.
// Pretražuje kod: svaki ključ podešavanja (settings.set/get/update) mora biti sinhronizovan (db.js) ili na spisku ispod.
// Nova funkcija sa novim ključem → ovaj test pada dok se ne odluči gde ključ pripada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { SYNCED_SETTING } from '../src/db.js';

/** Samo na ovom uređaju (sa razlogom). Rezervna kopija „Cela aplikacija“ ih i dalje nosi, osim prijave na Google. */
const DEVICE_ONLY = {
  syncCfg: 'stanje sinhronizacije ovog uređaja', drive: 'stanje stare Drive veze', driveToken: 'Google ključ', driveRT: 'Google dozvola',
  driveRestoreAsked: 'već pitano na ovom uređaju', geminiLastModel: 'keš', geminiModels: 'keš spiska modela', shareFolder2: 'Drive fascikla za deljenje (keš, nova veza)', driveToken2: 'Google ključ (nova veza)', driveRT2: 'Google dozvola (nova veza)',
  mig: 'stanje prelaska na novu Google vezu (ovaj uređaj)', migCopy: 'kopija pre prelaska (ovaj uređaj)',
  notes: 'zvonce — obaveštenja ovog uređaja', keySync: 'izbor „prenesi ključ“ za ovaj uređaj', backupNudge: 'podsetnik na ovom uređaju',
  syncOffered: 'već ponuđeno', shareLatestSeen: 'već viđeno deljenje', demoSeeded: 'primer pesme na ovom uređaju', autoBackup: 'dnevna kopija sa ovog uređaja',
  remindCfg: 'obaveštenja za vežbanje — po uređaju', shares: 'linkovi deljenja napravljeni ovde', boxOutbox: 'slanje koje čeka', dedupeV1: 'jednokratna provera',
};

function settingKeys() {
  const out = new Map();
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
    const consts = Object.fromEntries([...src.matchAll(/\b([A-Z_]+) = '([^']+)'/g)].map((m) => [m[1], m[2]]));
    for (const m of src.matchAll(/settings\.(?:set|get|update|remove)\((?:'([^']+)'|([A-Z_]+))/g)) {
      const k = m[1] || consts[m[2]]; if (k) out.set(k, f);
    }
  }
  return out;
}

test('svaki sačuvan ključ podešavanja je sinhronizovan ili izričito samo na uređaju', () => {
  const missing = [...settingKeys()].filter(([k]) => !SYNCED_SETTING(k) && !DEVICE_ONLY[k]).map(([k, f]) => `${k} (${f})`);
  assert.deepEqual(missing, [], 'novi ključ: dodaj ga u sinhronizaciju (db.js) ili u DEVICE_ONLY sa razlogom');
});

test('spisak „samo na uređaju“ nema zastarelih ključeva', () => {
  const used = settingKeys();
  assert.deepEqual(Object.keys(DEVICE_ONLY).filter((k) => !used.has(k)), []);
});
