# Webstudio API Surface

This documents the programmatic surface of this self-hosted Webstudio instance -
what you can reach, how auth works, and what the underlying data model lets you do.
Everything here is verified against the live deployment (schema, env, working
scripts).

## Access layers (verified against a live self-hosted instance)

| Layer | What it is | How to reach it |
|-------|-----------|-----------------|
| **Direct SQL** | Postgres 15 | Restricted maintenance role inside the compose network (advanced fallback) |
| **PostgREST** | REST API over the public schema | `http://postgrest:3000/<table>` (internal only) |
| **Builder** | The Webstudio app (UI + tRPC) | `http://localhost:3000` (this is the Remix app, NOT postgrest) |
| **Publisher** | Build API + site proxy | `:4000` build API / `:4001` -> `:80` sites |
| **MinIO** | S3-compatible asset storage | `:9000` (S3 API), `:9001` (console) |

> Gotcha (verified): on the host, `:3000` is the Remix **builder app**, not postgrest.
> PostgREST is reachable only from inside the compose network (e.g. from the app
> container) at `http://postgrest:3000`.

## PostgREST security boundary

Some community self-hosting stacks grant the `anon` database role broad table and RPC access.
Do not rely on that behavior. Anonymous reads can expose user, project, token, and domain data;
anonymous writes or RPC execution can alter or publish a site.

Before using PostgREST for administration:

1. Keep the service private to the deployment network.
2. Inspect current table, sequence, function, and default privileges.
3. Revoke broad `anon` writes and execution on state-changing RPCs.
4. Require an authenticated least-privilege role or project-scoped application token.
5. Verify that unauthenticated read, write, and state-changing RPC requests are rejected.

Do not include anonymous write or publish commands in runbooks. See `security.md` for the required
boundary. A deployment may expose these RPC names, but permission must be restricted:
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

## Environment and configuration

Non-secret behavior commonly includes asset limits, publisher URLs, image references, plan
selection, and feature flags. Pin image references by digest for production deployments.

Authentication, database, PostgREST, object-storage, publisher, OAuth, and DNS-provider settings
include secret values. Keep those values in the deployment's approved secret manager. Never read
or print them during discovery, copy them into instructions, or commit them. Document only the
names required by the deployment. See `security.md` before using any credential.

## Authentication

- **Builder UI:** "Login with Secret" using `AUTH_SECRET`, or OAuth if configured.
- **PostgREST:** require an authenticated least-privilege role. Broad anonymous access is a
  vulnerability to remediate.
- **Publisher:** `TRPC_SERVER_API_TOKEN` authenticates publish requests to the
  builder/publisher.
- **AuthorizationToken:** per-project tokens with scoped permissions
  (`canClone`, `canCopy`, `canPublish`, `canUseApi`). Use least-privilege.

For browser automation, prefer an existing authenticated session or a dedicated automation
identity. If the deployment requires `AUTH_SECRET`, obtain explicit approval and use an approved
ephemeral secret injection. Never discover it from `.env`. See `verification.md`.

## Working against the build (not the UI)

Prefer authenticated Builder, CLI, or application APIs. Direct SQL is an advanced fallback for
authorized self-hosted maintenance. Its safe workflow is:

1. Load the draft build columns (see `database.md`).
2. Mutate instances/styles/props/pages.
3. Write all loaded columns through a parameterized, transaction-protected, exact-row update.
4. Publish through an authenticated or network-isolated admin boundary after approval.
5. Verify on the canvas / live site (see `verification.md`).

## tRPC endpoints (verified)

The builder app exposes tRPC (the UI calls these). **Auth is required** - verified
that `/api/trpc/health` returns `403 Forbidden` without a session, and the editor
URL (`p-<id>.localhost:3000/`) also returns `403` unauthenticated. So you must be
logged in to call tRPC.

In practice you rarely need to call tRPC directly. Use authenticated Builder, CLI, or scoped API
paths first; use the safe direct-database fallback only when needed. If you need a tRPC call,
run it inside the browser page after login so the auth cookies and CSRF token are
attached (see `verification.md`).
