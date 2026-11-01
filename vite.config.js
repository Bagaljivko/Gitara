import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Relativna osnova ('./') — aplikacija radi pod bilo kojom putanjom, npr. /gitara/ na GitHub Pages.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
