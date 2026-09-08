// Webstudio full-page audit (Playwright).
// Logs into a self-hosted Webstudio builder, switches through pages, and measures
// the canvas DOM (overflow, bg, element counts, inline styles). Text-only output.
//
// Everything here comes from native Webstudio config/data - no custom env vars:
//   - Builder origin is Webstudio's native :3000 (or the DEPLOYMENT_URL it ships with).
//   - AUTH_SECRET / POSTGRES_USER / POSTGRES_DB are read from the deployment .env
//     (all native Webstudio compose vars).
//   - The project id resolves from the native "Project" table.
//   - Page names resolve from the native "pages" column of the draft Build.
//
// Uses the container layout the official self-host compose ships (db service).
import { chromium } from 'playwright'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Native builder origin (Webstudio app listens on :3000; DEPLOYMENT_URL is a native var).
const BASE = process.env.DEPLOYMENT_URL || 'http://localhost:3000'
// Path to the deployment's .env (holds native AUTH_SECRET / POSTGRES_*).
const ENV_FILE = './../.env'

let pw = ''
let PG_USER = 'postgres'   // native POSTGRES_USER fallback
let PG_DB = 'webstudio'    // native POSTGRES_DB fallback
try {
  const env = readFileSync(ENV_FILE, 'utf8')
  for (const l of env.split('\n')) {
    if (l.startsWith('AUTH_SECRET=')) pw = l.slice('AUTH_SECRET='.length).trim()
    if (l.startsWith('POSTGRES_USER=')) PG_USER = l.slice('POSTGRES_USER='.length).trim()
    if (l.startsWith('POSTGRES_DB=')) PG_DB = l.slice('POSTGRES_DB='.length).trim()
  }
} catch (e) {
  console.error('WARN: could not read env file for AUTH_SECRET:', e.message)
}

// dbExec runs SQL against the native database (standard self-host layout).
function dbExec(sql) {
  return execSync(
    `docker compose exec -T db psql -U ${PG_USER} -d ${PG_DB} -t -A -c ${JSON.stringify(sql)}`,
    { encoding: 'utf8' }
  ).trim()
}

// Resolve the project id from the native "Project" table (first non-deleted project).
function projectId() {
  return dbExec('select id from "Project" where "isDeleted" = false order by "createdAt" asc limit 1')
}
const pid = projectId()
if (!pid) {
  console.error('ERROR: no project found in the Project table.')
  process.exit(1)
}

// Pages to audit come from the native "pages" column of the draft Build row.
function pageNames() {
  try {
    return JSON.parse(dbExec('select pages from "Build" where deployment is null order by "createdAt" desc limit 1')).pages.map(p => p.name)
  } catch { return [] }
}
const targetPages = pageNames()

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.locator('button:has-text("Login with Secret"), a:has-text("Login with Secret")').first().click()
await page.waitForTimeout(2000)
await page.locator('input').nth(0).fill(pw)
await page.locator('button[type=submit], button:has-text("Log in"), button:has-text("Login")').first().click()
await page.waitForTimeout(3500)
await page.goto(`http://p-${pid}.localhost:3000/`, { waitUntil: 'networkidle' }).catch(e=>console.log('nav',e.message.slice(0,50)))
await page.waitForTimeout(6000)

async function currentCanvas() {
  await page.waitForTimeout(4000)
  let frame = null
  for (const f of page.frames()) { if (/chrome-extension/.test(f.url())) continue; if (f.url().includes('/canvas')) { frame = f; break } }
  if (!frame) return { noCanvas: true }
  await frame.waitForTimeout(2500)
  return frame.evaluate(() => {
    const doc = document, b = doc.body
    return {
      overflowX: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
      overflowY: doc.documentElement.scrollHeight - doc.documentElement.clientHeight,
      bodyBg: getComputedStyle(b).backgroundColor,
      totalEls: b.querySelectorAll('*').length,
      bodyChildren: [...b.children].map(el=>({tag: el.tagName, txt:(el.textContent||'').trim().slice(0,24)})),
      inlineStyleCount: document.querySelectorAll('[style]').length,
    }
  })
}

console.log('===== HOME =====')
console.log(JSON.stringify(await currentCanvas(), null, 1))

for (const name of targetPages) {
  const tg = page.locator('[aria-label="Toggle pages"]').first()
  if (await tg.count() === 0) { console.log(name, 'NO TOGGLE'); continue }
  await tg.click()
  await page.waitForTimeout(2000)
  const clicked = await page.evaluate((nm) => {
    const els = [...document.querySelectorAll('*')]
    for (const el of els) {
      if ((el.textContent||'').trim() === nm && el.children.length === 0) {
        const clickTarget = el.closest('[role="button"],button,a,[data-state],[role="menuitem"]') || el
        clickTarget.click()
        return clickTarget.tagName + ':' + (clickTarget.textContent||'').trim().slice(0,20)
      }
    }
    return 'NOT-FOUND'
  }, name)
  console.log(`===== ${name} (clicked ${clicked}) =====`)
  console.log(JSON.stringify(await currentCanvas(), null, 1))
}
await browser.close()
console.log('DONE')
