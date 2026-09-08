# Webstudio API Surface

This documents the programmatic surface of this self-hosted Webstudio instance -
what you can reach, how auth works, and what the underlying data model lets you do.
Everything here is verified against the live deployment (schema, env, working
scripts).

## Access layers (verified against a live self-hosted instance)

| Layer | What it is | How to reach it |
|-------|-----------|-----------------|
| **Direct SQL** | Postgres 15 | `docker compose exec -T db psql -U postgres -d webstudio -c "..."` |
| **PostgREST** | REST API over the public schema | `http://postgrest:3000/<table>` (internal only) |
| **Builder** | The Webstudio app (UI + tRPC) | `http://localhost:3000` (this is the Remix app, NOT postgrest) |
| **Publisher** | Build API + site proxy | `:4000` build API / `:4001` -> `:80` sites |
| **MinIO** | S3-compatible asset storage | `:9000` (S3 API), `:9001` (console) |

> Gotcha (verified): on the host, `:3000` is the Remix **builder app**, not postgrest.
> PostgREST is reachable only from inside the compose network (e.g. from the app
> container) at `http://postgrest:3000`.

## Verified PostgREST usage

The `anon` role has full table access (granted by `db-setup`), so reads AND writes
to the tables work without tokens. Tested live from inside the app container:

```bash
# read (anon) - verified
wget -qO- 'http://postgrest:3000/Build?select=id,projectId&limit=2'
wget -qO- 'http://postgrest:3000/Project?select=id,title,domain&limit=3'

# write (anon) - verified (returns the inserted row)
wget -qO- --post-data='{"name":"x.txt","format":"text/plain","size":10}' \
  --header='Content-Type: application/json' --header='Prefer: return=representation' \
  'http://postgrest:3000/File?select=name,format'

# RPCs (verified) - see the full RPC list in the OpenAPI spec below
wget -qO- --post-data='{"project_id":"<id>","from_build_id":"<id>"}' \
  --header='Content-Type: application/json' \
  'http://postgrest:3000/rpc/restore_development_build'      # -> "OK"

wget -qO- --post-data='{"project_id":"<id>","deployment":"<name>"}' \
  --header='Content-Type: application/json' \
  'http://postgrest:3000/rpc/create_production_build'        # -> a Build id; sets deployment + PUBLISHED
```

To see the full anon-queryable surface (tables + RPCs), fetch the OpenAPI spec:

```bash
wget -qO- http://postgrest:3000/   # swagger 2.0 JSON; paths = tables + /rpc/*
```

The instance exposes these RPCs (verified names from the OpenAPI spec):
`swap_asset_file`, `delete_stale_asset_file_metadata`, `restore_development_build`,
`replace_asset_file_metadata`, `clone_project`, `create_production_build`,
`delete_asset_file_metadata_if_matches`, `database_cleanup`.

## Database tables (public schema)

- `Build` - the site build (JSON columns; see `database.md`)
- `Project` - `{id, title, domain, userId, isDeleted, workspaceId, tags, ...}`
- `Asset`, `AssetFileMetadata`, `AssetFolder` - asset metadata (bytes in MinIO)
- `Domain`, `ProjectDomain` - custom domains + DNS records
- `AuthorizationToken` - `{token, projectId, name, relation, canClone, canCopy, canPublish, canUseApi}`
- `User`, `Workspace`, `WorkspaceMember` - auth / multi-tenancy
- `File` - upload records `{name, format, size, meta, status(UploadStatus)}`
- `Notification`, `TransactionLog`, `ClientReferences`, `Product` - peripheral

See `database.md` for the Build schema in full and the load/commit pattern.

## Environment / configuration knobs

Secrets and behavior are configured via your deployment's `.env` (names below,
values live in the file - never commit them). These are the standard self-hosted
Webstudio knobs:

- `AUTH_SECRET` - shared secret for "Login with Secret"
- `DEV_LOGIN`, `DEV_LOGIN_EMAIL` - dev login-by-email flow
- `GH_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` - OAuth providers
- `AUTH_WS_CLIENT_ID/SECRET` - Webstudio auth workspace
- `POSTGRES_PASSWORD`, `PGRST_JWT_SECRET` - DB + PostgREST
- `MINIO_ROOT_USER/PASSWORD`, `S3_*` - MinIO / object storage
- `MAX_ASSETS_PER_PROJECT` - asset cap (default 50)
- `TRPC_SERVER_API_TOKEN`, `SELF_HOSTED_PUBLISHER_URL`, `PUBLISHER_HOST`
- `CLOUDFLARE_API_TOKEN/ACCOUNT_ID` - optional Cloudflare DNS integration
- `BUILDER_IMAGE`, `PUBLISHER_IMAGE` - image tags
- `USER_PLAN` - default `Pro`
- `FEATURES` - default `*` (all features)

## Authentication

- **Builder UI:** "Login with Secret" using `AUTH_SECRET`, or OAuth if configured.
- **PostgREST:** the `anon` role has full access to all tables (granted by
  `db-setup`), so reads/writes via SQL work without tokens.
- **Publisher:** `TRPC_SERVER_API_TOKEN` authenticates publish requests to the
  builder/publisher.
- **AuthorizationToken:** per-project tokens with scoped permissions
  (`canClone`, `canCopy`, `canPublish`, `canUseApi`). Use least-privilege.

For browser automation, log in via Playwright using `AUTH_SECRET` and drive the
editor/canvas (see `verification.md`). For direct API calls inside the page, use the
browser's own `fetch` so cookies/CSRF (`_csrf`) are handled.

## Working against the build (not the UI)

The reliable path is direct SQL against the `Build` row, NOT clicking the editor
(the editor is fragile for programmatic edits). The supported workflow:

1. Load the draft build columns (see `database.md`).
2. Mutate instances/styles/props/pages.
3. Write ALL loaded columns back with dollar-quoted SQL.
4. Publish via the publisher API (see `publishing.md`).
5. Verify on the canvas / live site (see `verification.md`).

## tRPC endpoints (verified)

The builder app exposes tRPC (the UI calls these). **Auth is required** - verified
that `/api/trpc/health` returns `403 Forbidden` without a session, and the editor
URL (`p-<id>.localhost:3000/`) also returns `403` unauthenticated. So you must be
logged in to call tRPC.

In practice you rarely need to call tRPC directly - direct SQL + postgrest RPCs +
the publisher API cover building and publishing (all verified to work without the
builder session, via the `anon` role). If you do need an authenticated tRPC call,
run it inside the browser page after login so the auth cookies and CSRF token are
attached (see `verification.md`).
