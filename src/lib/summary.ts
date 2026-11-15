// Adding up time by day, project and task for the week view and exports. No React, so it can be tested.
import { secondsWithin } from "./format.ts";

interface Timed {
  projectId: string;
  taskId?: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface DaySummary {
  /** Midnight at the start of the day, in the browser's time zone. */
  day: Date;
  seconds: number;
  /** Each project's time that day, most first. */
  byProject: { projectId: string; seconds: number }[];
}

export interface PeriodSummary {
  days: DaySummary[];
  seconds: number;
  /** Each project's time in the period, most first. */
  byProject: { projectId: string; seconds: number }[];
  /** Each task's time in the period. */
  byTask: Map<string, number>;
}

/** The days from `from` up to (not including) `to`, each as its midnight. Safe across clock changes. */
export function daysBetween(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push(d);
  }
  return days;
}

const sorted = (totals: Map<string, number>) =>
  [...totals]
    .filter(([, seconds]) => seconds > 0)
    .map(([projectId, seconds]) => ({ projectId, seconds }))
    .sort((a, b) => b.seconds - a.seconds);

/** Adds up the entries' time day by day between `from` and `to`, counting a running one up to `now`. */
export function summarize(entries: Timed[], from: Date, to: Date, now: number): PeriodSummary {
  const all = new Map<string, number>();
  const byTask = new Map<string, number>();
  let seconds = 0;
  const days = daysBetween(from, to).map((day) => {
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const totals = new Map<string, number>();
    let daySeconds = 0;
    for (const entry of entries) {
      const s = secondsWithin(entry, day.getTime(), next.getTime(), now);
      if (s <= 0) continue;
      daySeconds += s;
      totals.set(entry.projectId, (totals.get(entry.projectId) ?? 0) + s);
      all.set(entry.projectId, (all.get(entry.projectId) ?? 0) + s);
      if (entry.taskId) byTask.set(entry.taskId, (byTask.get(entry.taskId) ?? 0) + s);
    }
    seconds += daySeconds;
    return { day, seconds: daySeconds, byProject: sorted(totals) };
  });
  return { days, seconds, byProject: sorted(all), byTask };
}

/** Monday to Friday. */
export const isWorkday = (day: Date) => day.getDay() !== 0 && day.getDay() !== 6;
