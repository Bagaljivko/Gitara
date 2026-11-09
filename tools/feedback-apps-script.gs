// MARLI — prijem utisaka i dijagnostike u ovu tabelu.
// Kartice: „Utisci – srpski“, „Utisci – engleski“ (po jeziku aplikacije) i „Dijagnostika“.
// Verzija 2: kolone „Imejl“ i „Korisnik (ID)“ — da se zna ko je šta poslao.

// Da li da ti stigne imejl kad neko prijavi „Nešto ne radi“ (true = da, false = ne)
const EMAIL_ON_BUG = true;

const TABS = {
  sr: { name: 'Utisci – srpski', head: ['Vreme', 'Vrsta', 'Tekst', 'Imejl', 'Korisnik (ID)', 'Ekran', 'Verzija', 'Uređaj', 'Tehnički podaci'] },
  en: { name: 'Utisci – engleski', head: ['Vreme', 'Vrsta', 'Tekst', 'Imejl', 'Korisnik (ID)', 'Ekran', 'Verzija', 'Uređaj', 'Tehnički podaci'] },
  diag: { name: 'Dijagnostika', head: ['Vreme', 'Imejl', 'Korisnik (ID)', 'Verzija', 'Jezik', 'Uređaj', 'Napomena', 'Izveštaj'] },
};
const TYPE_NAMES = { bug: 'Nešto ne radi', idea: 'Ideja', like: 'Sviđa mi se', dislike: 'Ne sviđa mi se' };

// Pokreni JEDNOM posle svake promene koda (▶ Run, izabrano „setup“): napravi / osveži kartice i zatraži dozvole.
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (k) { sheetFor(ss, TABS[k]); });
  if (EMAIL_ON_BUG) MailApp.getRemainingDailyQuota(); // da Google odmah pita i za slanje imejla
}

function sheetFor(ss, tab) {
  let sh = ss.getSheetByName(tab.name);
  if (!sh) sh = ss.insertSheet(tab.name);
  const r = sh.getRange(1, 1, 1, tab.head.length);
  const cur = r.getValues()[0].join('|');
  if (cur !== tab.head.join('|')) { r.setValues([tab.head]); r.setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}

// Tekst iz aplikacije nikad ne postaje formula (=, +, -, @ na početku) i ima granicu dužine
function safe(v, max) {
  let s = String(v == null ? '' : v).slice(0, max || 1000);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (d.kind === 'diag') {
      sheetFor(ss, TABS.diag).appendRow([new Date(), safe(d.email, 200), safe(d.uid, 40), safe(d.version, 20), safe(d.lang, 5), safe(d.device, 300), safe(d.note, 1000), safe(d.report, 45000)]);
    } else {
      const tab = d.lang === 'en' ? TABS.en : TABS.sr;
      sheetFor(ss, tab).appendRow([new Date(), safe(TYPE_NAMES[d.type] || d.type, 30), safe(d.text, 5000), safe(d.email, 200), safe(d.uid, 40), safe(d.screen, 100), safe(d.version, 20), safe(d.device, 300), safe(d.tech, 20000)]);
      if (EMAIL_ON_BUG && d.type === 'bug') {
        MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'MARLI: nešto ne radi',
          String(d.text || '').slice(0, 3000) + '\n\nOd: ' + (d.email || '(bez imejla)') + ' · ' + (d.uid || '') +
          '\nEkran: ' + (d.screen || '') + ' · verzija ' + (d.version || '') + ' · ' + (d.device || '') + '\n\nTabela: ' + ss.getUrl());
      }
    }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false });
  }
}

// Otvori adresu u pregledaču: ako piše „MARLI utisci rade (v2)“, sve je u redu
function doGet() {
  return ContentService.createTextOutput('MARLI utisci rade (v2)');
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
