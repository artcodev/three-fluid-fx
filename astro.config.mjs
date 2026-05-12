import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  integrations: [mdx()],
  outDir: './dist',
  devToolbar: {
    enabled: false,
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        { find: 'three-fluid-fx/tsl', replacement: resolve('./src/core/tsl/index.ts') },
        { find: 'three-fluid-fx', replacement: resolve('./src/core/glsl/index.ts') },
      ],
    },
  },
})
