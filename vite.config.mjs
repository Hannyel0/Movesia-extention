import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * @type {import('vite').UserConfig}
 */
export default defineConfig({
  plugins: [react()],
  publicDir: 'src/webviews/public',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({}),
  },
  resolve: {
    alias: {
      // Handle zod/v4 subpath export for AI SDK compatibility
      'zod/v4': path.resolve(__dirname, 'node_modules/zod/v4/index.js'),
    },
  },
  build: {
    outDir: 'out/webviews',
    target: 'esnext',
    minify: 'esbuild',
    lib: {
      entry: path.resolve(__dirname, 'src/webviews/src/index.tsx'),
      name: 'VSWebview',
      formats: ['es'],
      fileName: 'index',
    },
    watch: {},
  },
})
