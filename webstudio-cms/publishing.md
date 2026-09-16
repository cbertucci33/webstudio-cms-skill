# Webstudio Publishing, Domains & Auth

## Publishing safely

Publishing is an external production change. Immediately before publishing, show the operator the
deployment, project ID, exact draft build ID, domain, and build mode, then get explicit approval.

Prefer, in order:

1. the authenticated Builder UI;
2. the official CLI with a scoped project credential;
3. a project-scoped token with `canPublish` and no unrelated permissions;
4. an internal publisher API only when it is private to the deployment network and protected by
   an authenticated service boundary.

Do not expose or document an unauthenticated publish endpoint as an admin interface. Resolve one
exact draft by project ID and build ID, back it up, use `buildMode:"ssg"` unless SSR was deliberately
configured, and confirm the returned build ID matches the approved target.

Verify the approved domain without querying the database as a superuser:
```bash
test -n "$WEBSTUDIO_EXPECTED_DOMAIN"
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Host: $WEBSTUDIO_EXPECTED_DOMAIN" http://localhost:80/
```

## Publisher service

- Port 4000 (internal): build API. Keep it private; add authenticated service-to-service access if
  anything outside the trusted compose network can reach it.
- Port 4001 -> host :80: site proxy - serves ALL published sites.
  - **SSR domains** -> reverse-proxied to their react-router-serve subprocess.
  - **SSG domains** -> static files served directly from `/var/publish/<domain>/`.
- Volumes: `published-sites:/var/publish`, `publisher-work:/var/work`.

Pin the publisher image by reviewed immutable digest in production. Do not use a mutable `latest`
tag for unattended administration.

`publishStatus` on the Build is `PENDING` | `PUBLISHED` | `FAILED` - check it after a
publish if something didn't go live.

## Domains

Custom domains are stored in `Domain` and `ProjectDomain`:

- `Domain` - `{id, domain, txtRecord, status, error, createdAt, updatedAt}`
- `ProjectDomain` - `{projectId, domainId, txtRecord, cname, createdAt}`

To attach a custom domain you must:
1. Create/point the `Domain` + `ProjectDomain` records (domain id, DNS `txtRecord` /
   `cname`).
2. Configure DNS at the registrar (the `txtRecord`/`cname` from the table).
3. Republish so the publisher picks up the new domain.

Optional Traefik integration: setting `TRAEFIK_DYNAMIC_DIR` auto-generates per-domain
route configs with Let's Encrypt TLS. Not enabled by default.

## Authentication tokens

`AuthorizationToken` - `{token, projectId, name, relation, canClone, canCopy,
canPublish, canUseApi}`. These are scoped per-project and control what a token can
do (clone/copy/publish/use API). Create least-privilege tokens - don't hand out a
token with `canPublish` if it only reads.

## Login (for Playwright / browser automation)

The builder supports a dev/login-by-secret flow. `DEV_LOGIN` / `DEV_LOGIN_EMAIL` env
vars control it; `AUTH_SECRET` is the shared secret for "Login with Secret".

Prefer an already-authenticated browser session or a dedicated low-privilege automation identity.
If `AUTH_SECRET` is the only available login method:

1. Get explicit approval to use it for this named deployment and task.
2. Receive it through the operator's approved secret manager or ephemeral process environment.
3. Fill the secret field without printing, logging, recording, or persisting the value.
4. Remove the injected value when the task ends.

Never search for or read `AUTH_SECRET` from `.env` automatically. Rotate it if exposure is suspected.

After login the editor sets auth cookies (`_csrf`, session). For direct tRPC/API
calls inside the page, use the browser's own `fetch` so cookies/CSRF are handled.

## Known gotchas

- **Global root children don't publish.** HtmlEmbeds / elements attached to the
  global root may not make it to the published site. Put site-wide fonts/imports in
  a `<style>` HtmlEmbed inside each page body as the first child.
- **Verify the live site, not just the canvas.** After publish, load the published
  URL (port 80) and check the served HTML reflects the build.
- **Publish is asynchronous.** Confirm in `docker compose logs publisher` that it
  "Successfully published" before trusting the live output.
