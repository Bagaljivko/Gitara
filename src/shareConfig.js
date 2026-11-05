// Podešavanje deljenja kratkim linkom (jedno mesto). API ključ je JAVAN ključ pregledača, ograničen u Google Cloud
// konzoli na Drive API i adresu https://bagaljivko.github.io/* — služi samo da primalac preuzme javno podeljen
// fajl bez prijave. Nije tajna (nijedan token, lozinka ni Gemini ključ ne idu ovde).
export const SHARE_API_KEY = 'AIzaSyAKOHoLLPqesxqEC8hMLQSYetz8sinP2oA';
/** Adresa aplikacije za kratke linkove: <SHARE_BASE>#d/<fileId> */
export const SHARE_BASE = 'https://bagaljivko.github.io/Gitara/';
/** Folder na Drive-u pošiljaoca (vidi ga samo aplikacija i vlasnik; javni su samo pojedinačni fajlovi). */
export const SHARE_FOLDER = 'Gitara – deljeno';
