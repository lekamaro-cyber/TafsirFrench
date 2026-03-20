import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://tafsir.example.com',
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
