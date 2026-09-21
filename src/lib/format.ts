export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 2 : 1)} ${units[i]}`;
}

export function humanDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function pad(n: number): string {
  return n.toFixed(n % 1 ? 2 : 0).padStart(2, '0');
}

export function kbps(bps: number): string {
  return `${Math.round(bps / 1000)} kbps`;
}
