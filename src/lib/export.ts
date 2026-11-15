// Turning time into rows for a spreadsheet or an invoice. No React, so it can be tested.
import type { Entry } from "./types.ts";

export interface ExportRow {
  start: Date;
  end: Date;
  seconds: number;
  projectId: string;
  taskId: string | null;
  note: string;
  /** Still running when exported: counted up to the moment of export. */
  running: boolean;
}

/**
 * The entries' time between `from` and `to`, oldest first. An entry that crosses either end
 * is cut there, so a month's export holds exactly that month's time.
 */
export function exportRows(entries: Entry[], from: Date, to: Date, now: number, projectId: string | null = null): ExportRow[] {
  return entries
    .filter((e) => !projectId || e.projectId === projectId)
    .map((e) => {
      const start = Math.max(Date.parse(e.startedAt), from.getTime());
      const end = Math.min(e.endedAt ? Date.parse(e.endedAt) : now, to.getTime());
      return { start: new Date(start), end: new Date(end), seconds: Math.max(0, (end - start) / 1000), projectId: e.projectId, taskId: e.taskId, note: e.note, running: !e.endedAt };
    })
    // Less than a second is a slip, not time worked.
    .filter((r) => r.seconds >= 1)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** One CSV field: quoted when it holds a comma, quote or line break; a leading = + - @ is defused for spreadsheets. */
export function csvField(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csv = (rows: (string | number)[][]) => rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";

const pad = (n: number) => String(n).padStart(2, "0");
/** 2026-11-15, in the browser's time zone. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 09:05, in the browser's time zone. */
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** 1.25 for an hour and a quarter: what invoices and spreadsheets add up. */
export const decimalHours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
