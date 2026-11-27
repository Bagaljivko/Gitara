// Podešavanje deljenja kratkim linkom (jedno mesto). API ključ je JAVAN ključ pregledača, ograničen u Google Cloud
// konzoli na Drive API i adresu https://bagaljivko.github.io/* — služi samo da primalac preuzme javno podeljen
// fajl bez prijave. Nije tajna (nijedan token, lozinka ni Gemini ključ ne idu ovde).
// v2.5.66: projekat „MARLI“ (Drive API + YouTube Data API v3)
export const SHARE_API_KEY = 'AIzaSyCsWZXdj2FyQUxZQocDVnjraa3He-5stjI';
/** Adresa aplikacije za kratke linkove: <SHARE_BASE>#d/<fileId> */
export const SHARE_BASE = 'https://bagaljivko.github.io/Gitara/';
/** Folder na Drive-u pošiljaoca (vidi ga samo aplikacija i vlasnik; javni su samo pojedinačni fajlovi). */
export const SHARE_FOLDER = 'MARLI – deljeno'; // v2.5.66 (nova veza; stari folder „Gitara – deljeno“ ostaje do čišćenja)
/**
 * Pomoćnik za Google ključ (Google Apps Script u nalogu vlasnika aplikacije; kod: tools/token-helper.gs).
 * Samo javna adresa — tajni deo prijave (client secret) je SAMO u Apps Script-u (Script properties), nikad ovde.
 * Prazno = kao ranije (Google-ov prozor na tren pri obnavljanju ključa). Sa adresom: ključ se obnavlja bez prozora.
 */
export const TOKEN_HELPER = 'https://script.google.com/macros/s/AKfycbwcmmpoCw1i3CkWEcQqCjgblIDcl3QU4d4zgyPQ8jvbCtVkuR1EsOOKTWdY3_N8xml9/exec'; // v2.5.66: „MARLI Pomoćnik“ (nov klijent)
