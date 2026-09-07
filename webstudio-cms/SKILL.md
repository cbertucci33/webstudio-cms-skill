---
name: webstudio-cms
description: "Operate a self-hosted Webstudio CMS (Docker Compose) and programmatically build pages, elements, and styles by writing Webstudio-native build objects into Postgres, then publish. Use when working on a Webstudio site, building or fixing pages, applying styles, editing the canvas, or publishing. Triggers: webstudio, cms, build pages in webstudio, webstudio publish."
---

# Webstudio Self-Hosted CMS

Build pages by writing Webstudio-native build objects into the Postgres `Build` row, then
publish via the publisher API.

## Stack layout

Services: `app` (builder, :3000), `db` (Postgres 15), `postgrest`, `minio`, `publisher`
(build API :4000, site proxy :4001), `nginx`.

```bash
docker compose ps          # health check
docker compose logs -f app # builder logs
```

## Build table schema

- `instances` - element tree: `{type:'instance', id, component, tag, children}`
- `styleSources` - `{type:'local', id: '<instanceId>:ws:style'}`
- `styleSourceSelections` - `{instanceId, values:['<instanceId>:ws:style']}` (binds styles to element)
- `styles` - `{breakpointId, styleSourceId, property, value}`
- `props` - element props: `{id:'<iid>:<name>', instanceId, name, type, value}`
- `pages` - `{homePageId, rootFolderId, pages:[{id,name,rootInstanceId,path}], folders}`
- `breakpoints` - `{id, label}`

The draft build is the row `where deployment is null order by "createdAt" desc limit 1`.

## Generate style values with Webstudio's own parser

Webstudio ships a CSS parser inside the app container. Use it to produce every style
value so Webstudio accepts them. The parser lives at:

```js
require("/app/node_modules/.pnpm/@webstudio-is+css-data@file+packages+css-data_zod@4.4.3/node_modules/@webstudio-is/css-data/lib/index.js")
```

Use a `parseStyle(property, cssValue)` helper that calls the parser and is memoized so
identical calls hit a cache. Never write a style value object by hand.

```js
import { styleDecl, parseStyle } from './lib/genstyle.mjs'
function S(iid, property, cssValue) {
  styles.push(styleDecl(BASE_BREAKPOINT, iid + ':ws:style', property, cssValue))
}
S(elId, 'display', 'flex')
S(elId, 'backgroundColor', '#090D12')
S(elId, 'gridTemplateColumns', '1fr 1fr')   // parser produces the valid tuple
```

## Loading and committing the build

Load the columns you need, mutate them, then write them all back with dollar-quoted SQL:

```js
const load = (col) => execSync(`${DBC} ${q(`select "${col}" from "Build" where deployment is null order by "createdAt" desc limit 1`)}`, {encoding:'utf8'}).trim()
let inst = JSON.parse(load('instances'))
let styles = JSON.parse(load('styles'))

const rows = { instances: JSON.stringify(inst), styles: JSON.stringify(styles) }
const assignments = Object.entries(rows).map(([c,v])=>`"${c}" = $js$${v}$js$`).join(', ')
writeFileSync('/tmp/skin.sql', `update "Build" set ${assignments} where deployment is null;\n`)
execSync('docker compose exec -T db psql -U postgres -d webstudio < /tmp/skin.sql', {shell:'/bin/zsh'})
```

When you mutate instances, write back ALL loaded columns.

## Applying styles to elements

### 1. Create and bind a style source

Each styled element needs a local style source bound in `styleSourceSelections`, or the
style will not apply:

```js
styleSources.push({ type: 'local', id: iid + ':ws:style' })
styleSourceSelections.push({ instanceId: iid, values: [iid + ':ws:style'] })
```

### 2. Set properties

Add one row per property, keyed to the element's style source. Use the parser for values.

### 3. Reuse values with tokens

Create a token style source and reference it, or apply the same declarations to each
element's local source. Tokens are `styleSources` with `type:'token'`:

```js
styleSources.push({ type: 'token', id: 'tok-surface', name: 'surface' })
styles.push({ breakpointId, styleSourceId: 'tok-surface', property: 'backgroundColor', value: parsedColor })
```

### 4. Responsive styles via breakpoints

Breakpoints have `{id, label, maxWidth}`. The `Base` breakpoint applies everywhere;
mobile breakpoints carry `maxWidth`. Write the same property to different breakpoint ids
on the same style source to make an element responsive.

### 5. Page and element scoping

Page-level defaults (background, body font, text color) go on the page root instance;
component styles go on the specific instances. Styles are element-scoped with no cascade,
so apply every needed property to every target instance.

### 6. Styling HtmlEmbed content

HtmlEmbeds render raw HTML and cannot use native style rows. Put a `<style>` block inside
the embed's `code`. Site-wide fonts/imports go in a `<style>` HtmlEmbed on each page body
as the first child; HtmlEmbeds inside page bodies publish, global root children do not.

## Publishing via the publisher API

Publish directly against the publisher API:

```bash
DRAFT_ID=$(docker compose exec -T db psql -U postgres -d webstudio -t -A -c \
  "select id from \"Build\" where deployment is null order by \"createdAt\" desc limit 1" | tr -d '[:space:]')
docker compose exec -T app sh -c "wget -qO- --post-data='{\"buildId\":\"$DRAFT_ID\",\"builderOrigin\":\"http://app:3000\",\"buildMode\":\"ssg\"}' --header='Content-Type: application/json' http://publisher:4000/publish"
docker compose logs publisher | tail   # confirm "Successfully published"
```

Publish the DRAFT build (`deployment is null`), not an arbitrary Build id. Use
`buildMode:"ssg"` (static); `ssr` needs a docker socket the publisher may not have.

## Verification

The canvas renders only the selected page (a button with `aria-label="Toggle pages"`);
the canvas is an `<iframe>` whose URL contains `/canvas`. Verify with DOM measurements in
the canvas frame: `overflowX`/`overflowY` (scrollWidth - clientWidth), computed fonts,
total elements.
