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
