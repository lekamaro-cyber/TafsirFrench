import { build } from 'esbuild';
import { cpSync } from 'fs';

await build({
  entryPoints: ['../worker/index.js'],
  bundle: true,
  outfile: 'worker.js',
  format: 'esm',
  target: 'esnext',
  minify: false,
});

console.log('Worker bundled to worker.js');
