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

Use a deployment-specific restricted maintenance role. Keep its credential in the deployment's
approved secret manager and inject it without placing the value in command arguments or output.

If your deployment renamed services or the DB, adjust the `docker compose exec`
service name / `-d` db name to match. The DB user is typically `postgres`.

Do not use the `anon` role for administration. Some community stacks grant it broad access;
revoke broad writes and state-changing RPC execution as described in `security.md`.

Direct SQL is an advanced maintenance fallback. Use a restricted maintenance role rather than
the `postgres` superuser for routine edits. Keep the database private to the deployment network.

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

A project can have several historical or concurrent rows. Resolve the target project first, then
select one exact draft within that project. Confirm the build ID and project ID before proceeding.

## Other tables

- `Project` - `{id, title, domain, userId, isDeleted, workspaceId, ...}`
- `Asset` - `{id, projectId, name, filename, folderId}` (metadata; bytes live in MinIO)
- `AssetFileMetadata` - `{projectId, assetId, revision, document(jsonb)}`
- `Domain` / `ProjectDomain` - custom domains and DNS records (`txtRecord`, `cname`)
- `AuthorizationToken` - `{token, projectId, name, relation, canClone, canCopy, canPublish, canUseApi}`
- `User`, `Workspace`, `WorkspaceMember` - auth/multi-tenancy
- `File` - `{name, format, size, status(UploadStatus), meta}` (uploads)

## Loading and committing a build safely

Direct database edits can corrupt the authoritative site state. Before a write, get explicit
approval, back up the exact row, and record its project ID, build ID, and concurrency value such
as `updatedAt` or `version`.

Use a PostgreSQL client with bound parameters. Do not construct SQL by interpolating JSON, do not
write SQL containing site data to a predictable `/tmp` path, and do not update every draft.

The following JavaScript is the required shape. Run it in a trusted deployment environment with
a restricted database URL injected through an approved secret mechanism. Adapt column casts to
the inspected schema.

```js
import pg from "pg"

const { Client } = pg
const client = new Client({ connectionString: process.env.WEBSTUDIO_MAINTENANCE_DATABASE_URL })
const projectId = process.env.WEBSTUDIO_PROJECT_ID
const buildId = process.env.WEBSTUDIO_BUILD_ID
const expectedUpdatedAt = process.env.WEBSTUDIO_EXPECTED_UPDATED_AT

if (!projectId || !buildId || !expectedUpdatedAt) throw new Error("exact target required")
await client.connect()
try {
  await client.query("BEGIN")
  const current = await client.query(
    `select id, "projectId", "updatedAt", instances, styles, "styleSources",
            "styleSourceSelections", props, pages
       from "Build"
      where id = $1 and "projectId" = $2 and deployment is null
      for update`,
    [buildId, projectId],
  )
  if (current.rowCount !== 1) throw new Error("draft identity mismatch")
  if (new Date(current.rows[0].updatedAt).toISOString() !== expectedUpdatedAt) {
    throw new Error("draft changed since backup")
  }

  // Save current.rows[0] to an operator-approved, mode-0600 backup location.
  // Build `next` from that exact row, mutate only the requested fields, and validate every JSON value.
  const next = mutateAndValidate(current.rows[0])

  const updated = await client.query(
    `update "Build"
        set instances = $1, styles = $2, "styleSources" = $3,
            "styleSourceSelections" = $4, props = $5, pages = $6
      where id = $7 and "projectId" = $8 and deployment is null and "updatedAt" = $9
      returning id`,
    [next.instances, next.styles, next.styleSources, next.styleSourceSelections,
     next.props, next.pages, buildId, projectId, expectedUpdatedAt],
  )
  if (updated.rowCount !== 1) throw new Error("concurrent update or target mismatch")
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
```

After commit, re-read the same build ID and verify only the intended values changed. Keep the
backup until canvas and published-site verification pass.

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
