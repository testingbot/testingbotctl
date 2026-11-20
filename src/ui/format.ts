/** "just now", "5m ago", "3h ago", "2d ago", or the date for older times. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** A small usage meter: ▰▰▱▱▱ for 2 of 5. Capped at `slots` cells. */
export function meter(used: number, total: number, slots = 10): string {
  if (!Number.isFinite(total) || total <= 0) return '';
  const cells = Math.min(slots, total);
  const filled = Math.min(cells, Math.round((used / total) * cells));
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled);
}
