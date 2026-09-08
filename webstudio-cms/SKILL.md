---
name: webstudio-cms
description: "Set up, administer, build, design, and publish with Webstudio (self-hosted or Cloud). Covers install/self-hosting, the Builder UI, the programmatic build path (writing Webstudio-native build objects into Postgres), styling and design tokens, assets, publishing, domains, and advanced features (CMS, data variables, forms, integrations). Use when working on a Webstudio site, installing/configuring one, building or fixing pages, applying styles, editing the canvas, uploading assets, managing domains, or publishing. Triggers: webstudio, cms, build pages in webstudio, webstudio publish, webstudio style, webstudio asset, webstudio domain, webstudio install, webstudio self-host."
---

# Webstudio Self-Hosted CMS

Build pages by writing Webstudio-native build objects into the Postgres `Build` row,
then publish via the publisher API. This skill manages a self-hosted Webstudio
instance (Docker Compose) and everything you can do with it.

## Quick Reference

| Topic | File |
|-------|------|
| Install / self-host setup, CLI, deploy | `install.md` |
| Stack, services, health, gotchas | `database.md` (stack) |
| Build table schema, PostgREST, load/commit | `database.md` |
| Element tree, pages, instances, props | `build-objects.md` |
| Styling, css-data parser, tokens, breakpoints | `styling.md` |
| Pages, folders, assets, MinIO storage | `assets-pages.md` |
| Publishing, domains, auth tokens | `publishing.md` |
| Canvas verification, Playwright audit | `verification.md` |
| Full documented API surface | `api.md` |
| The Builder UI (canvas, navigator, modes) | `ui-builder.md` |
| Webstudio design system (tokens, variables) | `design.md` |
| Advanced features (CMS, variables, forms, AI) | `features.md` |

Read the file for the area you're working in BEFORE touching the build. The master
file stays lean on purpose - detail lives in the per-area files.

## Where things live

This skill is generic to any self-hosted Webstudio deployment. Replace the placeholders
with your own values before relying on them:

- Deployment: `<your-dir>/docker-compose.yml` and `.env` (see `api.md` for every env knob)
- This skill folder: the skill itself (publishable as-is, pure markdown - no runnable code)

## Critical Rules

1. **One fix per turn. Save a NEW named copy after every change.** Never overwrite in place.
2. **Draft build = `where deployment is null order by "createdAt" desc limit 1`.** Always operate
   on the draft, never an arbitrary Build id.
3. **Never hand-write a style value.** Use Webstudio's own css-data parser (see `styling.md`).
4. **When you mutate instances, write back ALL loaded columns.** Partial writes corrupt the build.
5. **Every styled element needs a bound local style source** in `styleSourceSelections`, or the
   style silently won't apply.
6. **Styles are element-scoped with no cascade.** Apply every needed property to every target
   instance; don't rely on inheritance.
7. **Publish SSG (`buildMode:"ssg"`), not SSR** - SSR needs a docker socket the publisher may not have.
8. **Verify with canvas DOM measurements, not eyeballs.** Text-only, no images into the model.
9. **Assets upload to MinIO** (S3-compatible); they are not stored in Postgres.

## Standard Workflow

1. Open the draft build (see `database.md`).
2. Make ONE change on one page/element (only what's asked, no extras).
3. Save a NEW named copy of any script output.
4. Verify by inspecting the canvas DOM / XML (see `verification.md`).

## Memory

Operator/instance-specific preferences are not part of this published skill. The
skill is generic; any local customization lives in your own deployment notes,
not here.
