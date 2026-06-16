export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Relative time label for a unix-epoch-*seconds* timestamp. */
export function relativeTime(ts: number | null | undefined, suffix = ''): string {
  if (ts == null || ts === 0) return suffix ? '未知' : '从未启动';
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 0) return '刚刚';
  const day = 86400;
  const month = day * 30.4375;
  const year = month * 12;
  const s = suffix; // '' or '更新'
  if (diff < day) return `今天${s}`;
  if (diff < 2 * day && !s) return '昨天';
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前${s}`;
  if (diff < month) return `${Math.floor(diff / day / 7)} 周前${s}`;
  if (diff < 2 * month && !s) return '上月';
  if (diff < year) return `${Math.floor(diff / month)} 个月前${s}`;
  return `${Math.floor(diff / year)} 年前${s}`;
}

/** ISO date string for a unix-epoch-*seconds* timestamp. */
export function absoluteTime(ts: number | null | undefined): string {
  if (ts == null || ts === 0) return '从未启动';
  return new Date(ts * 1000).toISOString().slice(0, 10);
}