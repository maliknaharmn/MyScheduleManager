import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// Render the same Welcome component used by the client, never a second copy deck.
const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: false,
  plugins: [react()],
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
})
try {
  const { renderHomepage } = await server.ssrLoadModule('/src/prerender.tsx')
  const file = new URL('../dist/index.html', import.meta.url)
  const html = await readFile(file, 'utf8')
  const marker = '<!--public-homepage-->'
  if (html.split(marker).length !== 2) throw new Error('Expected exactly one public homepage placeholder')
  const markup = renderHomepage()
  if (!markup.includes('id="welcome-title"')) throw new Error('Public homepage render is missing its title')
  await writeFile(file, html.replace(marker, () => markup))
  console.log('Prerendered public Welcome into dist/index.html (no API or private data).')
} finally {
  await server.close()
}
