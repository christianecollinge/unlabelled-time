// Turning seconds and dates into what the page shows. No React, so it can be tested.

/** 5025 → "1:23". Hours are not wrapped at a day: 100 hours is "100:00". */
export function hoursMinutes(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 5025 → "1:23:45", for the running timer. */
export function clock(seconds: number): string {
  const s = Math.floor(Math.max(0, seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The length of an entry, counting a running one up to `now`. */
export function entrySeconds(entry: { startedAt: string; endedAt: string | null }, now: number): number {
  const end = entry.endedAt ? Date.parse(entry.endedAt) : now;
  return Math.max(0, (end - Date.parse(entry.startedAt)) / 1000);
}

/** The part of an entry that falls between `from` and `to` (milliseconds). */
export function secondsWithin(entry: { startedAt: string; endedAt: string | null }, from: number, to: number, now: number): number {
  const start = Math.max(Date.parse(entry.startedAt), from);
  const end = Math.min(entry.endedAt ? Date.parse(entry.endedAt) : now, to);
  return Math.max(0, (end - start) / 1000);
}

/** Midnight at the start of the day `date` falls on, in the browser's time zone. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Midnight at the start of the Monday of the week `date` falls in. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/** "Last worked: 3 days ago", in words, as Tyme says it. */
export function ago(iso: string | null, now: number): string {
  if (!iso) return "Not worked on yet";
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return minutes === 1 ? "A minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "An hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "Yesterday" : `${days} days ago`;
  const months = Math.round(days / 30.4);
  if (months < 12) return months === 1 ? "A month ago" : `${months} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? "A year ago" : `${years} years ago`;
}

/** A date and time as the value of a datetime-local field, in the browser's time zone. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local field's value back to an ISO time, or null if it is not one. */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
