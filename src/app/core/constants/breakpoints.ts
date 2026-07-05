/**
 * Material Design 3 window size classes breakpoints
 * Extended with XXLarge and Ultra for large monitor support
 */
export const MD3_BP = {
  Compact : '(max-width: 599.99px)',
  Medium  : '(min-width: 600px)  and (max-width: 839.99px)',
  Expanded: '(min-width: 840px)  and (max-width: 1199.99px)',
  Large   : '(min-width: 1200px) and (max-width: 1599.99px)',
  XLarge  : '(min-width: 1600px) and (max-width: 1919.99px)',
  XXLarge : '(min-width: 1920px) and (max-width: 2559.99px)',
  Ultra   : '(min-width: 2560px)',
} as const;

/**
 * Common Media Queries combos for reactive layout
 */
export const MEDIA_QUERIES = {
  // At least Medium (≥ 600px)
  AtLeastMedium: '(min-width: 600px)',

  // At least Expanded (≥ 840px)
  AtLeastExpanded: '(min-width: 840px)',

  // At least Large (≥ 1200px)
  AtLeastLarge: '(min-width: 1200px)',

  // At least XLarge (≥ 1600px) — large monitors
  AtLeastXLarge: '(min-width: 1600px)',

  // At least XXLarge (≥ 1920px) — Full HD monitors
  AtLeastXXLarge: '(min-width: 1920px)',

  // At least Ultra (≥ 2560px) — 2K/QHD monitors
  AtLeastUltra: '(min-width: 2560px)',

  // Tablet and Desktop (≥ 600px)
  NotMobile: '(min-width: 600px)',

  // Mobile Only (< 600px)
  OnlyMobile: '(max-width: 599.99px)',
};
