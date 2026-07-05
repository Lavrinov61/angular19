/** Common view types used across multiple domains. */

/** COUNT(*)::text result — used in 12+ places across the backend. */
export interface CountResult {
  count: string;
}

/** DELETE/INSERT RETURNING id. */
export interface IdResult {
  id: string;
}
