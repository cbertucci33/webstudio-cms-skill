// Reliable Webstudio style-value generator.
// Uses Webstudio's OWN css-data parser to produce valid style values - never hand-guess.
import { execSync } from 'node:child_process'

const PARSE_SNIPPET = `const {parseCssValue}=require("/app/node_modules/.pnpm/@webstudio-is+css-data@file+packages+css-data_zod@4.4.3/node_modules/@webstudio-is/css-data/lib/index.js");`

// Parse a CSS value for a property into a valid Webstudio style value object.
// property: e.g. "color", "font-size", "display"
// cssValue: e.g. "#E8E2D6", "54px", "none"
// Memoized: identical (property, cssValue) pairs hit the cache, so batch
// skinning of many elements only pays the docker-exec cost once per unique style.
const _cache = new Map()
export function parseStyle(property, cssValue) {
  const key = property + '\u0000' + cssValue
  if (_cache.has(key)) return _cache.get(key)
  const prop = JSON.stringify(property)
  const val = JSON.stringify(cssValue)
  const script = `${PARSE_SNIPPET} console.log(JSON.stringify(parseCssValue(${prop},${val})))`
  const out = execSync(`docker compose exec -T app node -e ${JSON.stringify(script)}`, { encoding:'utf8' }).trim()
  const parsed = JSON.parse(out)
  if (!parsed || parsed.type === 'invalid') {
    throw new Error(`Invalid style for ${property}: ${cssValue}`)
  }
  _cache.set(key, parsed)
  return parsed
}

// Generate a valid style declaration for the build.
export function styleDecl(breakpointId, styleSourceId, property, cssValue) {
  return { breakpointId, styleSourceId, property, value: parseStyle(property, cssValue) }
}
