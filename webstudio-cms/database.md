# Webstudio Database & Stack

The deployment is a Docker Compose stack. Everything (elements, styles, pages,
assets) is ultimately stored in Postgres; the build is a JSON `Build` row that the
builder edits in the UI and that we edit directly via SQL. This file documents the
standard self-hosted Webstudio stack.

## Services

| Service | Port | Role |
|---------|------|------|
| `app` | :3000 | Builder UI |
| `db` | (internal) | Postgres 15 |
| `postgrest` | (internal :3000) | REST API over Postgres |
| `minio` | :9000/:9001 | S3-compatible asset storage |
| `publisher` | :4000 build / :4001 -> :80 site proxy | Build API + serves published sites |
| `migrate`, `db-setup`, `minio-init` | one-shot | Schema/perms/bucket init |

```bash
docker compose ps          # health check
docker compose logs -f app # builder logs
docker compose logs publisher | tail   # publish confirmations
```

## Accessing the database

```bash
# direct SQL (assumes the standard self-hosted layout)
docker compose exec -T db psql -U postgres -d webstudio -c "..."
```

If your deployment renamed services or the DB, adjust the `docker compose exec`
service name / `-d` db name to match. The DB user is typically `postgres`.

The DB has an `anon` role granted full access on all tables so PostgREST can serve
them. You can also hit PostgREST RESTfully, but direct SQL is the reliable path for
build editing (see below).

## Build table schema (the core)

The `Build` table holds the entire site as JSON text columns. Columns:

- `id`, `projectId`, `createdAt`, `updatedAt`, `version`
- `pages` - page tree `{homePageId, rootFolderId, pages:[{id,name,rootInstanceId,path,meta}], folders}`
- `instances` - the element tree
- `styleSources` - `{type:'local'|'token', id, name?}`
- `styles` - `{breakpointId, styleSourceId, property, value}`
- `styleSourceSelections` - `{instanceId, values:['<iid>:ws:style']}` (binds styles to element)
- `props` - element props `{id:'<iid>:<name>', instanceId, name, type, value}`
- `breakpoints` - `{id, label, maxWidth?}`
- `dataSources`, `resources`, `marketplaceProduct`, `projectSettings` - advanced, usually `[]`/defaults
- `deployment` - NULL = draft; set = published build
- `publishStatus` - `PENDING` | `PUBLISHED` | `FAILED`
- `isCleaned`

The draft build is the row `where deployment is null order by "createdAt" desc limit 1`.

## Other tables

- `Project` - `{id, title, domain, userId, isDeleted, workspaceId, ...}`
- `Asset` - `{id, projectId, name, filename, folderId}` (metadata; bytes live in MinIO)
- `AssetFileMetadata` - `{projectId, assetId, revision, document(jsonb)}`
- `Domain` / `ProjectDomain` - custom domains and DNS records (`txtRecord`, `cname`)
- `AuthorizationToken` - `{token, projectId, name, relation, canClone, canCopy, canPublish, canUseApi}`
- `User`, `Workspace`, `WorkspaceMember` - auth/multi-tenancy
- `File` - `{name, format, size, status(UploadStatus), meta}` (uploads)

## Loading and committing the build (the supported pattern)

Load the columns you need, mutate them, then write them all back with dollar-quoted SQL.
**Always write back ALL loaded columns** - partial writes corrupt the build.

This load/commit pattern is **verified live**: loading every column (`instances`, `styles`,
`styleSources`, `styleSourceSelections`, `props`, `pages`, `breakpoints`, `dataSources`,
`resources`), writing them all back unchanged, and re-reading leaves the draft build
byte-identical (confirmed via an md5 checksum of `instances` before/after).

```js
const DBC = 'docker compose exec -T db psql -U postgres -d webstudio -t -A -c'
const q = (s) => JSON.stringify(s)
const load = (col) => execSync(`${DBC} ${q(`select "${col}" from "Build" where deployment is null order by "createdAt" desc limit 1`)}`, { encoding:'utf8' }).trim()

let inst   = JSON.parse(load('instances'))
let styles = JSON.parse(load('styles'))
let ss     = JSON.parse(load('styleSources'))
let ssel   = JSON.parse(load('styleSourceSelections'))
let props  = JSON.parse(load('props'))
let pages  = JSON.parse(load('pages'))

// ...mutate...

const rows = {
  instances: JSON.stringify(inst),
  styles: JSON.stringify(styles),
  styleSources: JSON.stringify(ss),
  styleSourceSelections: JSON.stringify(ssel),
  props: JSON.stringify(props),
  pages: JSON.stringify(pages),
}
const assignments = Object.entries(rows).map(([c,v])=>`"${c}" = $js$${v}$js$`).join(', ')
writeFileSync('/tmp/skin.sql', `update "Build" set ${assignments} where deployment is null;\n`)
execSync('docker compose exec -T db psql -U postgres -d webstudio < /tmp/skin.sql', {shell:'/bin/zsh'})
```

> Gotcha: SQL `$js$...$js$` quoting breaks if a value contains the literal `$js$`
> sequence. If you hit that, escape or switch to a different dollar-quote tag.

## Finding things by structure (not hardcoded ids)

Instance ids are random and change between builds. Locate elements by walking the
tree, not by remembered ids:

```js
const byId = {}; for (const i of inst) byId[i.id] = i
const page = pages.pages.find(p => p.name === 'Home')
const root = byId[page.rootInstanceId]
function walk(id, fn) {
  const i = byId[id]; if (!i) return
  fn(i)
  for (const c of i.children||[]) if (c.type==='id') walk(c.value, fn)
}
```

Match on tag + structure (e.g. a `div` whose children are all `a` = a card grid),
not on remembered ids.
