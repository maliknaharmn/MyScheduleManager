import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { createLegalPreview } from './preview-legal.mjs'

test('Google ownership verification is in the static homepage head before and after build', async () => {
  const token = 'lA8eMf-TnpUoUMN4jm3_-2j4k3BpfpFQcDjiqR3xPsM'
  for (const file of ['../index.html', '../dist/index.html']) {
    const html = await readFile(new URL(file, import.meta.url), 'utf8')
    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]
    assert.ok(head, `${file}: HTML head is required`)
    const tags = head.match(/<meta\b[^>]*\bname="google-site-verification"[^>]*>/g) ?? []
    assert.equal(tags.length, 1, `${file}: keep exactly one owner verification tag`)
    assert.equal(tags[0].match(/\bcontent="([^"]*)"/)?.[1], token)
  }
})

test('built homepage identifies the app, purpose and Google data use in ordinary static HTML', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html)
  try {
    const document = dom.window.document
    assert.equal(document.title, 'MySchedule Manager')
    assert.equal(document.querySelector('link[rel="canonical"]').href, 'https://myschedulemanager.netlify.app/')
    assert.equal(document.querySelectorAll('h1').length, 1)
    const root = document.getElementById('root')
    const title = root.querySelector('h1')
    assert.equal(title.textContent.replace(/\s/g, ''), 'MyScheduleManager')
    assert.equal(title.closest('noscript'), null, 'main content must not be confined to noscript')
    assert.match(root.querySelector('.welcome-hero-copy > p').textContent, /Aplikasi agenda dan catatan pribadi/)
    assert.match(root.querySelector('.welcome-data-use').textContent, /membuat akun, memverifikasi login/)
    assert.match(root.querySelector('.welcome-data-use').textContent, /openid, email dan profile/)
    assert.match(root.querySelector('.welcome-data-use').textContent, /Tidak meminta akses Gmail, Drive, kontak, atau Google Calendar/)
    assert.match(root.textContent, /Contoh tampilan dengan data ilustrasi/)
    assert.equal(root.querySelector('a[href="mailto:maliknahar.mn@gmail.com"]').textContent, 'maliknahar.mn@gmail.com')
    for (const path of ['/privacy/', '/terms/', '/cookies/']) assert.ok(root.querySelector(`nav a[href="${path}"]`))
    assert.equal(root.querySelector('.welcome-google').disabled, true, 'static HTML must not claim service readiness')
    assert.equal(root.querySelector('a[href^="/api/"]'), null)
    assert.equal(root.querySelector('.app-shell'), null)
    assert.equal(root.querySelector('.privacy-notice'), null, 'static content must not offer inert consent controls')
    assert.doesNotMatch(html, /<!--public-homepage-->/)
  } finally { dom.window.close() }
})

test('release documents are built as public HTML with contact details and working local references', async () => {
  const server = createLegalPreview()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    for (const path of ['/privacy/', '/terms/', '/cookies/']) {
      const response = await fetch(origin + path)
      const html = await response.text()
      assert.equal(response.status, 200)
      assert.match(response.headers.get('x-robots-tag'), /noindex/)
      assert.match(html, /<html lang="id">/)
      assert.equal((html.match(/<h1>/g) ?? []).length, 1)
      assert.match(html, /Berlaku mulai/)
      assert.match(html, /datetime="2026-10-29"/)
      assert.match(html, /Pengelola: MySchedule Manager/)
      assert.match(html, /mailto:maliknahar\.mn@gmail\.com/)
      assert.match(html, new RegExp(`rel="canonical" href="https://myschedulemanager.netlify.app${path}"`))
      assert.doesNotMatch(html, /Draf|belum ditetapkan|perlu ditetapkan|sebelum publikasi|noindex|<div id="root"/i)
      assert.match(html, /<article[\s>]/)
      assert.match(html, /data-cookie-settings/)
      for (const [, href] of html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)) assert.equal((await fetch(origin + href)).status, 200, href)
      for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${anchor}"`), `Missing anchor ${anchor}`)
      const source = await readFile(new URL(`..${path}index.html`, import.meta.url), 'utf8')
      assert.match(source, /<script type="module" src="\/src\/legal.tsx"><\/script>/)
      assert.doesNotMatch(source, /\/src\/main.tsx/)
    }
    assert.equal((await fetch(origin + '/.env')).status, 404)
    assert.equal((await fetch(origin + '/privacy/..%2f..%2f.env')).status, 404)
    assert.equal((await fetch(origin + '/legal-drafts/privacy/')).status, 404)
    assert.equal((await fetch(origin + '/privacy/', { method: 'POST' })).status, 404)
    const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(config, /legal-drafts/)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('release disclosures match the optional-storage and manual-request implementation', async () => {
  const privacy = await readFile(new URL('../privacy/index.html', import.meta.url), 'utf8')
  const terms = await readFile(new URL('../terms/index.html', import.meta.url), 'utf8')
  const cookies = await readFile(new URL('../cookies/index.html', import.meta.url), 'utf8')
  assert.match(privacy, /penghapusan lunak/)
  assert.match(privacy, /Permintaan ditangani manual/)
  assert.match(privacy, /tidak menjanjikan penghapusan seluruh cadangan seketika/)
  assert.match(privacy, /openid, email dan profile/)
  assert.match(terms, /bukan sebagai catatan persetujuan ketentuan di server/)
  for (const name of ['myschedule_session', 'myschedule_oauth', 'myschedule_storage', 'myschedule_theme', 'myschedule-week-cache-v1']) assert.ok(cookies.includes(name), name)
  for (const age of ['180 hari', '30 hari', '7 hari', '10 menit']) assert.ok(cookies.includes(age), age)
  assert.match(cookies, /<noscript>/)
})
