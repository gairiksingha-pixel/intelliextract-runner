export function scheduleId() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const base =
    now.getFullYear() +
    "-" +
    pad(now.getMonth() + 1) +
    "-" +
    pad(now.getDate()) +
    "T" +
    pad(now.getHours()) +
    ":" +
    pad(now.getMinutes()) +
    ":" +
    pad(now.getSeconds());
  const rand = Math.random().toString(36).slice(2, 6);
  return "sched_" + base + "_" + rand;
}
