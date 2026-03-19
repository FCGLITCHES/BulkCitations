/**
 * Engine — Barrel export
 * 
 * Single entry point for the citation processing engine.
 * Consumers import from here, never from internal modules directly.
 */

export { processReferences, reformatReferences } from './pipeline.js';
export type { PipelineOptions, PipelineResult } from './pipeline.js';

// Re-export frequently used engine utilities
export { formatCSLData, parsedReferenceToCSL, initCSLStyles } from './cslConverter.js';
export { fixFormatting, runAssertions } from './strictRenderer.js';
