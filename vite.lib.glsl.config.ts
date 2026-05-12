import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-lib/glsl',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/core/glsl/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'cjs' ? 'three-fluid-fx.cjs' : `three-fluid-fx.${format}.js`),
    },
    rollupOptions: {
      external: ['three'],
    },
  },
})
