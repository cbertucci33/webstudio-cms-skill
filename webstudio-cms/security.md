# Webstudio Security Boundaries

Use this file before any authenticated, state-changing, or production operation.

## Authorization and scope

- Work only on a Webstudio deployment the operator owns or is authorized to administer.
- Confirm the deployment, project ID, and intended action before reading or changing state.
- Treat investigation and planning as read-only. Database writes, asset deletion, domain changes,
  user or token changes, and publishing require explicit user approval.
- Never turn an internal-only endpoint into a public endpoint to make automation easier.

## Credentials

`AUTH_SECRET`, OAuth client secrets, database credentials, PostgREST JWT secrets, object-storage
keys, publisher tokens, and DNS-provider tokens are sensitive credentials.

- Do not search for or read a deployment's `.env` file merely because it exists.
- Do not request secret values in chat or place them in prompts, shell arguments, source files,
  screenshots, logs, or command output.
- Prefer an already-authenticated browser session, a dedicated low-privilege automation identity,
  or a project-scoped token.
- If `AUTH_SECRET` is the only supported login method, obtain explicit approval for that login and
  receive the value through the operator's approved secret manager or ephemeral environment
  injection. The automation may read the injected process variable but must never reveal it.
- Remove the injected value when the operation ends. Rotate any credential that may have leaked.

Secret names may be documented because operators need to configure deployments. Secret values
must remain in a secret manager or deployment mechanism with restrictive access.

## PostgREST and database access

Anonymous full-table or RPC access is unsafe. An internal Docker network reduces exposure but does
not turn unauthenticated writes into an acceptable admin interface.

- Revoke broad `anon` write grants and publish-capable RPC execution.
- Do not expose PostgREST directly to the public network.
- Use authenticated, least-privilege roles or project-scoped application APIs.
- For the advanced direct-database fallback, use a restricted maintenance role, bound parameters,
  one exact project/build target, a transaction, optimistic concurrency, a backup, and an exact
  affected-row check. Do not connect as the `postgres` superuser for routine edits.

The exact role and grants depend on the deployment schema. Inspect current grants before changing
them, preserve required application access, and test the Builder after hardening.

## Publishing and destructive actions

- Publishing is an external production change. Show the operator the project, draft build, domain,
  and build mode, then obtain explicit confirmation immediately before starting it.
- Prefer the authenticated Builder, official CLI, or a scoped token with only the required
  permission. If a self-hosted publisher lacks native authentication, keep it on a private network
  and put an authenticated service boundary in front of it. Do not publish through an exposed,
  unauthenticated endpoint.
- Back up the exact draft before publishing. Confirm the returned build ID and final status.
- Deletion, restore, database cleanup, token creation, and DNS changes require separate approval.

## Supply-chain controls

- Pin CLI packages to a reviewed version, for example `webstudio@<approved-version>`.
- Pin container images by immutable digest in production.
- Review version changes before updating. Do not use `latest` in an unattended admin workflow.
- Record the approved versions with the deployment so later runs reuse them.

## Reporting

Report which authenticated boundary was used, which project/build changed, whether a backup was
created, and the verification result. Never include credential values or full authorization tokens.
