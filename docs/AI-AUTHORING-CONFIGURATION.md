# AI-assisted authoring configuration

The Authoring Sidebar **Options** tab now contains the first configuration slice
for optional AI-assisted authoring. The provider details open on a dedicated **AI-assisted authoring
configuration** page, and the sidebar button is hidden while **None (no AI)**
is selected. This slice intentionally configures no
provider and makes no network requests.

## Modes

- **None (no AI)** (default): do not use AI assistance. The deterministic
  offline workflow remains available separately and does not use a model.
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

## GenAI.mil

The current remote configuration supports generic OpenAI-compatible gateways.
GenAI.mil is one supported example. Use:

- Endpoint: `https://api.genai.mil/v1`
- Model: `gemini-3.5-flash-lite-withtools` (or another approved model)
- Authentication: STARK API key

The configuration page provides **Store API key securely**, **Query available models**, and **Test
OpenAI-compatible gateway** actions. The model field is an editable dropdown
(list suggestions) so nonstandard or newly introduced model IDs remain usable. The key is stored with VS Code SecretStorage, never in settings or YAML. The test calls only `GET /models`; it does not send
Assessment content.
