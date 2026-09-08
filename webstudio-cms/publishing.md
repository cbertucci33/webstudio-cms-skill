# Webstudio Publishing, Domains & Auth

## Publishing via the publisher API (VERIFIED live)

Publish the DRAFT build (`deployment is null`), not an arbitrary Build id. Use
`buildMode:"ssg"` (static) - `ssr` needs a docker socket the publisher may not have.

```bash
DRAFT_ID=$(docker compose exec -T db psql -U postgres -d webstudio -t -A -c \
  "select id from \"Build\" where deployment is null order by \"createdAt\" desc limit 1" | tr -d '[:space:]')
docker compose exec -T app sh -c "wget -qO- --post-data='{\"buildId\":\"$DRAFT_ID\",\"builderOrigin\":\"http://app:3000\",\"buildMode\":\"ssg\"}' --header='Content-Type: application/json' http://publisher:4000/publish"
docker compose logs publisher | tail   # confirm "Successfully published"
```

Verified end-to-end on a live instance:
- The POST returns `{"success":true}`.
- Publisher logs confirm: `Publishing <domain> to /var/publish/<domain>...` then
  `Successfully published <domain>` and `notifyBuildStatus(<buildId>, PUBLISHED) OK`.
- The site is then served on port 80 with the project's domain as the Host header.
- This creates a new `Build` row with `deployment` set and `publishStatus='PUBLISHED'`.

To fetch the published site (uses the project's domain from the `Domain` table):
```bash
D=$(docker compose exec -T db psql -U postgres -d webstudio -t -A -c "select domain from \"Domain\" limit 1" | tr -d '[:space:]')
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: $D" http://localhost:80/
```

## Publisher service

- Port 4000 (internal): build API - receives publish requests from the builder.
- Port 4001 -> host :80: site proxy - serves ALL published sites.
  - **SSR domains** -> reverse-proxied to their react-router-serve subprocess.
  - **SSG domains** -> static files served directly from `/var/publish/<domain>/`.
- Volumes: `published-sites:/var/publish`, `publisher-work:/var/work`.

The publisher is `ghcr.io/webstudio-community/webstudio-publisher:latest`. Health
check: `wget -qO- http://127.0.0.1:4000/health`.

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

Playwright login pattern (used by `lib/audit-all.mjs` and the working scripts):
1. `page.goto('http://localhost:3000/')`
2. Click `button:has-text("Login with Secret")`
3. Fill the secret input with `AUTH_SECRET` (read from `.env`)
4. Submit, then navigate to the editor URL `http://p-<projectId>.localhost:3000/`

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
