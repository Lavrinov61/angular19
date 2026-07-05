const BADGE_PREFIX = 'new_badge_seen_';
const BADGE_EXPIRY_DAYS = 14;
const BADGE_START = '2026-03-27'; // Sprint 4 release date

export function isNewBadgeVisible(featureKey: string): boolean {
  const seenAt = localStorage.getItem(BADGE_PREFIX + featureKey);
  if (seenAt) return false;
  const daysSinceStart = (Date.now() - new Date(BADGE_START).getTime()) / 86400000;
  return daysSinceStart <= BADGE_EXPIRY_DAYS;
}

export function markBadgeSeen(featureKey: string): void {
  localStorage.setItem(BADGE_PREFIX + featureKey, new Date().toISOString());
}
