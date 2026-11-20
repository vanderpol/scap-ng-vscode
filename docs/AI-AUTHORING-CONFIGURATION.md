# AI-assisted authoring configuration

The Authoring Sidebar **Options** tab now contains the first configuration slice
for optional AI-assisted authoring. The provider details open on a dedicated **AI-assisted authoring
configuration** page, and the sidebar button is hidden while **None (no AI)**
is selected. Configuration is local by default; only the explicit remote test,
model discovery, or consented generation action makes a network request.

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
stored in settings. When **Configured remote AI** is selected, the Rule automation
review page exposes an explicit, unchecked consent control and a **Generate with
configured AI** action. No request is made until the author checks that control.

## Safety boundary

Configured providers show the exact outbound data scope, require explicit
consent for content generation, include the pinned schema-pack identity, return
a structured proposal, validate proposed YAML locally, and show a human-reviewable
review surface before saving or linking an Assessment. AI must not declare
compliance or silently mutate source files.

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

## AI-assisted Assessment generation

AI generation is currently available from **Open Benchmark Rule → Graphical** for a
Rule that has no automated Assessment. It sends only the bounded authoring context
shown immediately beside the consent checkbox:

- Rule ID and title;
- the selected/manual Assessment procedure text;
- the current Rule YAML for context;
- inferred target platform context; and
- compact, provenance-labelled knowledge from the complete pinned offline 0.4.1
  pack, including schema summaries, relevant capability mappings, vocabulary,
  current authoring examples and editor guidance.

The prompt identifies the exact canonical schema commit and pack manifest hash.
The provider must return structured JSON. The extension rejects malformed JSON,
malformed YAML, schema-invalid Assessment YAML, missing mode declarations and
unsupported output before presenting a draft. A `manual-only` response is preserved
as a review result and cannot be linked as automated.

The result is never scanner/runtime proof and never asserts compliance. The author
must review the assumptions, unresolved questions, citations and generated YAML.
Only the existing explicit **Create and link automated Assessment** action writes
the Assessment and updates the Rule link/default; closing the page or rejecting the
draft writes nothing.

The configured provider is generic OpenAI-compatible HTTPS (`/chat/completions`
and `/models`); GenAI.mil is an example, not a hard-coded dependency. API keys are
retrieved from VS Code SecretStorage and are never placed in settings, AI
prompts, logs or YAML.
