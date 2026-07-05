/**
 * Empty module used for browser builds to replace server-only dependencies
 * This helps prevent issues during bundling browser code when it encounters
 * references to Node.js-only modules like firebase-admin, express, etc.
 */

export default {};

// Empty implementations for common exports
export const initializeApp = () => undefined;
export const getApps = () => [];
export const credential = {
  cert: () => ({}),
  applicationDefault: () => ({})
};
export const firestore = () => ({});
export const storage = () => ({});
export const auth = () => ({});

// Express mock
export const Router = () => ({});
export const json = () => undefined;
export const urlencoded = () => undefined;
export const staticServe = () => undefined;

// Default export for CommonJS compatibility
module.exports = {
  initializeApp,
  getApps,
  credential,
  firestore,
  storage,
  auth,
  Router,
  json,
  urlencoded,
  staticServe
};
