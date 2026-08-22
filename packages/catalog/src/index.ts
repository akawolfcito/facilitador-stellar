export { catalogSettlement, encodeExtensionResponses } from "./catalog.js";
export {
  SEARCH_DOCUMENT_VERSION,
  SEARCH_LIMITS,
  buildSearchDocument,
  buildSearchTokens,
  tokenize,
} from "./search-document.js";
export type { CatalogSettlementInput } from "./catalog.js";
export { httpCanonicalKey, mcpCanonicalKey, normalizeResourceUrl } from "./canonical.js";
export {
  METADATA_VERSION,
  SqliteCatalogStore,
  VERIFICATION_GRACE_MS,
  VERIFICATION_TTL_MS,
  strongerBinding,
} from "./store.js";
export type { VerificationRecord } from "./store.js";

/* Domain binding. Enrichment only: nothing here runs on the settlement path. */
export {
  bindingFor,
  isStale,
  isVerifiable,
  refreshIfStale,
  scheduleVerification,
  supportsVerification,
  verifyAndRecord,
} from "./ownership/enrichment.js";
export { isForbiddenAddress, verifyOwnership } from "./ownership/verifier.js";
export {
  DOCUMENT_KIND,
  DOCUMENT_VERSION,
  WELL_KNOWN_PATH,
  isContradiction,
} from "./ownership/wellknown.js";
export type { VerificationReason } from "./ownership/wellknown.js";
export {
  DISCOVERY_X402_VERSION,
  toDiscoveryResource,
  toDiscoveryResourcesResponse,
  toDiscoverySearchResponse,
} from "./wire.js";
export type {
  BazaarStatus,
  CatalogListing,
  CatalogOutcome,
  CatalogRejectionCode,
  CatalogStore,
  EmbeddingRecord,
  DiscoveryPage,
  DiscoveryQuery,
  OwnershipBinding,
  ResourceType,
} from "./types.js";
