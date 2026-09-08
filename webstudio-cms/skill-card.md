## Description

Set up, administer, build, design, and publish with Webstudio (self-hosted or
Cloud). Covers install/self-hosting, the Builder UI, the programmatic build path
(writing Webstudio-native build objects into Postgres), styling and design
tokens, assets, publishing, domains, and advanced features (CMS, data variables,
forms, integrations). Everything is Webstudio's native surface - nothing invented.

## Publisher

[Webstudio Self-Hosted skill](https://clawhub.ai)

## Use Case

Developers and operators using Webstudio use this skill to install/self-host it,
navigate the Builder UI, build and fix pages, apply styles and design tokens,
manage assets and domains, publish, verify output, and work with advanced
features (CMS, data variables, forms, integrations) - both through the UI and
programmatically against the Webstudio-native data model.

## Known Risks and Mitigations

- **Risk:** Direct SQL / docker exec commands assume the standard self-hosted
  Webstudio container layout (db service, postgres user, webstudio database).
  **Mitigation:** The commands read native `POSTGRES_USER`/`POSTGRES_DB` from the
  deployment `.env` instead of hardcoding credentials, and the skill documents the
  exact schema assumptions. If your layout differs, adjust the container/service
  names in the examples.
- **Risk:** Secrets (`AUTH_SECRET`, `POSTGRES_PASSWORD`, `S3_*`) can be exposed if
  copied into skill docs or memory files.
  **Mitigation:** Secrets live only in the deployment `.env`; the skill reads them
  from there and never hardcodes them.
- **Risk:** Writing partial build columns back to the `Build` row can corrupt the
  site.
  **Mitigation:** The skill's core rule is to always write back ALL loaded columns,
  and to operate only on the draft build (`deployment is null`).

## Skill Output

**Output Type(s):** guidance, markdown, code, shell commands, configuration
**Output Format:** Pure Markdown guidance with code examples and exact commands.
No runnable scripts are bundled, so there is no execution surface to audit.

## Ethical Considerations

Users should verify any generated or modified build against the live site before
relying on it, and apply their organization's safety, security, and compliance
requirements before deployment.
