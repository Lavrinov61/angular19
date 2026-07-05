/**
 * Russian pluralization helper.
 * pluralize(1, 'задачу', 'задачи', 'задач') → 'задачу'
 * pluralize(3, 'задачу', 'задачи', 'задач') → 'задачи'
 * pluralize(5, 'задачу', 'задачи', 'задач') → 'задач'
 */
export function pluralize(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
