# Authenticated PostgREST for Self-Hosted Webstudio

The community self-host stack is functional because the Builder talks to an internal
PostgREST service whose `anon` role can read and write the Webstudio schema. This is a
compatibility profile, not a public API security model. It is acceptable only while
PostgREST is confined to a trusted Docker network and no untrusted container can join it.

Webstudio also supports a hardened profile. The Builder reads `POSTGREST_API_KEY` and sends it
as `Authorization: Bearer <token>` on every PostgREST request. PostgREST validates that JWT with
`PGRST_JWT_SECRET` and switches to the database role in the token's `role` claim.

## Choose a profile explicitly

### Community compatibility profile

Use this only when changing the deployment is out of scope or the exact Builder release has not
been qualified with authenticated PostgREST.

- Do not publish the PostgREST port on the host, reverse proxy it, or attach it to a public network.
- Put `app`, `postgrest`, and `db` on a private internal network. Do not attach unrelated services.
- Treat Docker/host access as deployment-admin access. Internal anonymous CRUD and RPC calls have
  the same authority as direct database administration.
- Require explicit approval for writes, restores, cloning, cleanup, production-build creation, and
  publishing. Resolve one exact project and build first.
- Report that the deployment still relies on broad internal `anon` privileges.

This preserves the current community stack. It does not make anonymous PostgREST safe to expose.

### Hardened JWT profile

Use this when the operator wants unauthenticated PostgREST requests rejected while preserving the
Builder's full database capability.

1. Confirm the running Builder supports `POSTGREST_API_KEY`. Current Webstudio Builder source and
   the live community image do; older images must be checked before migration.
2. Create a `NOLOGIN` database role for the Builder, such as `webstudio_app`.
3. Give that role the table, sequence, and function privileges the Builder currently receives
   through `anon`, including default privileges for objects created by future migrations.
4. Change both initialization and recurring `db-setup` SQL. If `db-setup` continues to grant
   `anon`, the next deploy silently reopens anonymous access.
5. Mint a JWT signed by `PGRST_JWT_SECRET` with `{"role":"webstudio_app"}` and a managed expiry.
   Create it through the operator's approved secret tooling. Do not print it or place it in chat,
   source control, shell history, screenshots, or logs.
6. Store the JWT as the Builder service's `POSTGREST_API_KEY`; keep `PGRST_JWT_SECRET` only in the
   deployment secret store.
7. Restart PostgREST and the Builder. Verify the Builder can log in, open and save a project,
   upload an asset, create a production build, and publish.
8. Verify an unauthenticated table read, table write, and state-changing RPC are all rejected.
9. Only after the Builder passes, revoke `anon` table and sequence privileges. Inspect function
   ownership and revoke state-changing function execution from `PUBLIC` as well as `anon`, then
   grant it to the authenticated Builder role. PostgreSQL functions are executable by `PUBLIC` by
   default, so revoking only from `anon` may not close the RPC surface.

Use the actual migration owner in `ALTER DEFAULT PRIVILEGES` (the community stack currently uses
`postgres`). The privilege shape that preserves the current Builder capability is:

```sql
begin;
create role webstudio_app nologin;
grant usage on schema public to webstudio_app;
grant all privileges on all tables in schema public to webstudio_app;
grant all privileges on all sequences in schema public to webstudio_app;
grant execute on all functions in schema public to webstudio_app;
alter default privileges for role postgres in schema public
  grant all privileges on tables to webstudio_app;
alter default privileges for role postgres in schema public
  grant all privileges on sequences to webstudio_app;
alter default privileges for role postgres in schema public
  grant execute on functions to webstudio_app;
commit;
```

If PostgREST later connects with a non-superuser authenticator role, that role must be allowed to
`set role webstudio_app`. The current community compose connects as `postgres`, but do not assume
that on another deployment.

After the JWT-backed Builder passes all acceptance checks, close the old boundary and its defaults:

```sql
begin;
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from public;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
commit;
```

These statements are a deployment migration, not a routine agent action. Back up the database,
inspect the actual owner/grants, get explicit approval, and keep a rollback session open. Update
the compose initialization and `db-setup` definitions in the same approved change so a redeploy
cannot undo the result.

The role migration should be transactional. Preserve Webstudio's required capabilities rather
than guessing a narrower grant set during the same change. Least-privilege refinement is a later,
separately tested operation.

## Automation access

Do not reuse the Builder's JWT for agents. Use one of these boundaries:

1. **Preferred:** official Webstudio CLI/MCP linked with a project-scoped Build-access share link.
   The Builder enforces the project permissions and the CLI keeps edits in Webstudio's native model.
2. **Deployment-wide administration:** a separately issued JWT for a dedicated database role.
   Grant only the tables/functions required by that workflow and rotate it independently.
3. **Break-glass maintenance:** direct database access from the authorized host, with the exact-row
   transaction contract in `database.md`.

A PostgREST JWT role is database-wide unless its grants, views, functions, or row-level policies
enforce narrower scope. Putting a project ID in a JWT does not create project isolation by itself.

## Acceptance checks

The migration is complete only when all of these are true:

- PostgREST has no host/public listener.
- An unauthenticated request cannot read or mutate Webstudio data or run state-changing RPCs.
- The Builder uses a non-empty `POSTGREST_API_KEY` and retains normal project functionality.
- The initialization and `db-setup` definitions no longer re-grant broad `anon` privileges.
- State-changing functions are not executable through `PUBLIC` or `anon`.
- Credentials remain in the secret store and were not exposed during testing.
