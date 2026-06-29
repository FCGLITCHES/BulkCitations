export const ENGINE_PARSE_PROFILES = [
  'core_parse_fast',
  'core_parse_full',
  'core_parse_full_enrich',
  'current_runtime',
  'pro_overlay_enrich',
  'debug_full',
] as const;

export type ParseProfile = (typeof ENGINE_PARSE_PROFILES)[number];

