# P0 extension checkpoint

The repository now contains an installable VS Code extension skeleton. `Assessment Studio` is an activity-bar container with `STIG Library` and `Assessment Library` child placeholders. The extension has no network, telemetry, scanner, evaluator, or shell execution.

## Pin and validation boundary

`schema-profile.json` is the contract descriptor:

- SCAP-NG schema version: `0.4.0`
- canonical source commit: `d4e477998cda438a1e53a7c3c84123ec92e5ba1f`
- verified metadata manifest SHA-256: `33fa58aa40b627fc1d3ae03a5ef08312461614f3c99f21ffedf26003524d4dee`

The extension always displays this version/SHA. A local editor pack can be selected through `scapNg.schemaPackPath`; it is accepted only when `MetadataPack` verifies every manifest/resource hash and exact pin. With no pack, the host reports only YAML parse and obvious document-version diagnostics—it does not claim schema validity.

This checkpoint deliberately does not vendor canonical schemas or examples. It preserves the offline redistribution boundary and uses the existing `MetadataPack` adapter for an explicitly selected, verified local pack.

## Build and package

```sh
npm ci
npm test
npm run package:vsix
unzip -t scap-ng-vscode-0.0.1.vsix
```

The VSIX is a standard ZIP containing `extension/package.json`, compiled host code, the pin descriptor and Apache-licensed repository documentation. Install it locally with VS Code's **Install from VSIX...** command.

## Dependency decisions

- `yaml` remains the minimal format-preserving parser used by the source layer and host diagnostics.
- `ajv` remains the pinned JSON Schema validator in the metadata adapter.
- No UI framework is introduced in P0. The native Tree View and Webview APIs keep the extension offline and small.
- Red Hat YAML, Visual JSON and RJSF remain optional future interoperability/UI evaluations; no code is copied or bundled here.
