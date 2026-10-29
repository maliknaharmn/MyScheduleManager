import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const files = {
  '/': '../dist/index.html',
  '/privacy/': '../dist/privacy/index.html',
  '/terms/': '../dist/terms/index.html',
  '/cookies/': '../dist/cookies/index.html',
  '/icons/brand-80.png': '../dist/icons/brand-80.png',
  '/icons/favicon-32.png': '../dist/icons/favicon-32.png',
}
export function createLegalPreview() {
  return createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    if (['/privacy', '/terms', '/cookies'].includes(path)) { response.writeHead(302, { Location: `${path}/` }); return response.end() }
    const asset = /^\/assets\/[\w-]+\.(?:js|css)$/.test(path) ? `../dist${path}` : null
    const file = Object.hasOwn(files, path) ? files[path] : asset
    if (!file || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); return response.end('Not found') }
    try {
      const content = await readFile(new URL(file, import.meta.url))
      const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.png') ? 'image/png' : path.endsWith('.ico') ? 'image/x-icon' : 'text/html'
      response.writeHead(200, { 'Content-Type': `${type}${type === 'image/png' ? '' : '; charset=utf-8'}`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' })
      response.end(request.method === 'HEAD' ? undefined : content)
    } catch { response.writeHead(404); response.end('Build file unavailable. Run npm run build first.') }
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createLegalPreview().listen(4180, '127.0.0.1', () => console.log('Release build preview: http://127.0.0.1:4180/privacy/'))
}
