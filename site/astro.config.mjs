import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://tafsir-french.org',
  output: 'static',
  build: {
    assets: '_assets',
  },
  vite: {
    css: {
      preprocessorOptions: {},
    },
  },
});
