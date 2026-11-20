# AI-assisted authoring configuration

The Authoring Sidebar **Options** tab now contains the first configuration slice
for optional AI-assisted authoring. The provider details stay behind a
**Configure AI…** popup and that button is hidden while **Offline only** is
selected. This slice intentionally configures no
provider and makes no network requests.

## Modes

- **Offline only** (default): use the deterministic offline workflow; no model
  or network access is used.
- **Local AI**: reserve a loopback endpoint for a locally hosted model. The
  endpoint is restricted to `localhost`, `127.0.0.1`, or `::1` and may use HTTP
  or HTTPS.
- **VS Code AI provider**: reserve the VS Code Language Model API integration
  for hosts that expose an approved provider. A ChatGPT/Codex license is not
  assumed to make a provider available to an extension.
- **Configured remote AI**: reserve an explicitly configured enterprise/remote
  endpoint. Remote endpoints must use HTTPS.

The endpoint and model fields are configuration only. Credentials are not
stored in settings, and this release does not connect to or transmit content to
any endpoint.

## Safety boundary

Future providers must show the exact outbound data scope, require explicit
consent, include the pinned schema-pack identity, return a structured proposal,
validate proposed YAML locally, and show a human-reviewable diff before saving
or linking an Assessment. AI must not declare compliance or silently mutate
source files.
