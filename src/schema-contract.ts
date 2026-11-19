/** The one schema grammar supported by this editor build. */
export const SCHEMA_VERSION = '0.4.1' as const;
export const SCHEMA_BASE = `https://scap-ng.dev/schema/v${SCHEMA_VERSION}/`;
export const schemaUri = (resource: string) => `${SCHEMA_BASE}${resource}`;

/** Old documents are intentionally not auto-migrated or silently rewritten. */
export function isSupportedSchemaVersion(version: unknown): version is typeof SCHEMA_VERSION {
  return version === SCHEMA_VERSION;
}
