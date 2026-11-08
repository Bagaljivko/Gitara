// v1.71: vraćanje je sada u backups.js („Cela aplikacija“ / „Samo pesme“). Ovaj modul ostaje radi starih poziva:
// Pesme → „+“ → „Iz rezervne kopije“ = samo pesme; „Dobrodošao nazad“ → „vrati iz rezervne kopije“ = cela aplikacija.
export const restoreBackup = async () => (await import('./backups.js')).restoreSongs();
export const restoreFromFile = async () => (await import('./backups.js')).restoreFull();
