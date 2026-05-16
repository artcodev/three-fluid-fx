import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const useLocalLibrary = process.env.THREE_FLUID_FX_LOCAL === '1'

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: useLocalLibrary
      ? [
          { find: /^three-fluid-fx\/tsl$/, replacement: resolve(here, '../../src/core/tsl/index.ts') },
          { find: /^three-fluid-fx$/, replacement: resolve(here, '../../src/core/glsl/index.ts') },
        ]
      : [],
  },
})
