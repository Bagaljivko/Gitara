/**
 * Gitara — pomoćnik za Google ključ (Google Apps Script, besplatno, u nalogu vlasnika aplikacije).
 *
 * Zašto: Google daje kratak ključ (1 h) za Drive. Bez ovog pomoćnika, aplikacija ga obnavlja kroz Google-ov prozor koji
 * se na telefonu na tren pokaže (beli bljesak). Obnavljanje bez prozora zahteva tajni deo prijave (client secret), koji
 * ne sme biti u aplikaciji — zato je samo ovde, u „Script properties“ (nikad u kodu, nikad na GitHub-u).
 *
 * Šta radi (ništa ne čuva, ništa ne beleži):
 *   {a:'exchange', code}  → jednokratni kod iz „Dozvoli“ → kratki ključ + dugotrajna dozvola (vraća se telefonu)
 *   {a:'refresh', rt}     → dugotrajna dozvola → nov kratki ključ
 *
 * Podešavanje (jednom):
 *   1. script.google.com → Novi projekat → obriši sve i nalepi ovaj fajl → Sačuvaj.
 *   2. Podešavanja projekta (zupčanik) → Script properties → dodaj:
 *        CLIENT_ID      = Client ID web klijenta (Google Cloud → APIs & Services → Credentials)
 *        CLIENT_SECRET  = Client secret istog web klijenta
 *   3. Deploy → New deployment → tip „Web app“ → Execute as: Me → Who has access: Anyone → Deploy (dozvoli pristup).
 *   4. Kopiraj „Web app URL“ (…/exec) — to je jedino što aplikacija treba (nije tajna).
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function doPost(e) {
  let p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out({ error: 'bad_request' }); }
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CLIENT_ID'), secret = props.getProperty('CLIENT_SECRET');
  if (!id || !secret) return out({ error: 'not_configured' });
  let payload;
  if (p.a === 'exchange' && typeof p.code === 'string' && p.code.length < 2000) {
    payload = { code: p.code, client_id: id, client_secret: secret, redirect_uri: 'postmessage', grant_type: 'authorization_code' };
  } else if (p.a === 'refresh' && typeof p.rt === 'string' && p.rt.length < 2000) {
    payload = { refresh_token: p.rt, client_id: id, client_secret: secret, grant_type: 'refresh_token' };
  } else {
    return out({ error: 'bad_request' });
  }
  const r = UrlFetchApp.fetch(TOKEN_URL, { method: 'post', payload: payload, muteHttpExceptions: true });
  let j = {};
  try { j = JSON.parse(r.getContentText()); } catch (err) { return out({ error: 'google_error' }); }
  if (j.error) return out({ error: j.error });
  return out({ access_token: j.access_token, expires_in: j.expires_in, scope: j.scope, refresh_token: j.refresh_token });
}

// Provera u pregledaču (otvori Web app URL): samo potvrda da radi, bez ikakvih podataka.
function doGet() { return out({ ok: true, configured: !!PropertiesService.getScriptProperties().getProperty('CLIENT_SECRET') }); }

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
