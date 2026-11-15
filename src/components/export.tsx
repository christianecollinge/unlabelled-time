"use client";
// Exporting time: a CSV for spreadsheets, or a printed report (and so a PDF) for invoices.

import { useMemo, useState } from "react";
import { hoursMinutes, startOfWeek } from "@/lib/format";
import { csv, decimalHours, exportRows, hhmm, isoDay, type ExportRow } from "@/lib/export";
import type { Project, Snapshot, Task } from "@/lib/types";
import { useEntriesBetween } from "./week";

type Preset = "this-week" | "last-week" | "this-month" | "last-month" | "custom";

function presetRange(preset: Preset, now: number): { from: Date; to: Date } | null {
  const today = new Date(now);
  if (preset === "this-week" || preset === "last-week") {
    const monday = startOfWeek(today);
    const from = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - (preset === "last-week" ? 7 : 0));
    return { from, to: new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7) };
  }
  if (preset === "this-month" || preset === "last-month") {
    const from = new Date(today.getFullYear(), today.getMonth() - (preset === "last-month" ? 1 : 0), 1);
    return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 1) };
  }
  return null;
}

/** A yyyy-mm-dd field's value as that day's midnight here, or null. */
const dayOf = (value: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

const longDay = (d: Date) => d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });

export function ExportPanel(props: { state: Snapshot; projects: Project[]; byId: Map<string, Project>; taskById: Map<string, Task>; now: number; onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>("this-month");
  const [projectId, setProjectId] = useState<string>("");
  const [customFrom, setCustomFrom] = useState(() => isoDay(new Date(new Date(props.now).getFullYear(), new Date(props.now).getMonth(), 1)));
  const [customTo, setCustomTo] = useState(() => isoDay(new Date(props.now)));

  // Fixed for the panel's life, so the period does not move while it is open.
  const [openedAt] = useState(props.now);
  const range = useMemo(() => {
    if (preset !== "custom") return presetRange(preset, openedAt);
    const from = dayOf(customFrom);
    const last = dayOf(customTo);
    if (!from || !last || last < from) return null;
    return { from, to: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) };
  }, [preset, customFrom, customTo, openedAt]);

  const fallback = useMemo(() => ({ from: new Date(openedAt), to: new Date(openedAt + 1) }), [openedAt]);
  const { entries, problem } = useEntriesBetween(range?.from ?? fallback.from, range?.to ?? fallback.to, props.state);
  const rows = useMemo(() => (range && entries ? exportRows(entries, range.from, range.to, props.now, projectId || null) : []), [range, entries, props.now, projectId]);
  const total = rows.reduce((sum, r) => sum + r.seconds, 0);
  const lastDay = range ? new Date(range.to.getFullYear(), range.to.getMonth(), range.to.getDate() - 1) : null;
  const project = projectId ? props.byId.get(projectId) : undefined;
  const fileName = range ? `time ${isoDay(range.from)} to ${isoDay(lastDay!)}${project ? ` ${project.name}` : ""}` : "time";

  const downloadCsv = () => {
    const lines: (string | number)[][] = [["Date", "Start", "End", "Hours", "Duration", "Project", "Task", "Note"]];
    for (const r of rows) {
      lines.push([
        isoDay(r.start),
        hhmm(r.start),
        r.running ? `${hhmm(r.end)} (running)` : hhmm(r.end),
        decimalHours(r.seconds),
        hoursMinutes(r.seconds),
        props.byId.get(r.projectId)?.name ?? "Deleted project",
        r.taskId ? (props.taskById.get(r.taskId)?.name ?? "") : "",
        r.note,
      ]);
    }
    // A byte-order mark, so Excel reads accents correctly.
    const blob = new Blob(["﻿" + csv(lines)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName.replace(/[\\/:*?"<>|]+/g, "-")}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <section className="panel export-panel" aria-labelledby="export-title">
        <div className="panel-head">
          <h2 id="export-title">Export</h2>
          <span className="spacer" />
          <button type="button" className="link" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="export-controls">
          <label>
            <span>Period</span>
            <select value={preset} onChange={(event) => setPreset(event.target.value as Preset)}>
              <option value="this-week">This week</option>
              <option value="last-week">Last week</option>
              <option value="this-month">This month</option>
              <option value="last-month">Last month</option>
              <option value="custom">Choose dates…</option>
            </select>
          </label>
          {preset === "custom" ? (
            <>
              <label>
                <span>From</span>
                <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
              </label>
              <label>
                <span>To</span>
                <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
              </label>
            </>
          ) : null}
          <label>
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Every project</option>
              {props.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        {problem ? <p className="problem">{problem}</p> : null}
        {!range ? <p className="problem">The end date is before the start.</p> : null}
        <p className="export-sum">
          {range && entries ? (
            <>
              {rows.length} {rows.length === 1 ? "entry" : "entries"}, <b>{hoursMinutes(total)}</b> ({decimalHours(total)} hours), {longDay(range.from)} to {longDay(lastDay!)}
            </>
          ) : range ? (
            "Reading the time…"
          ) : null}
        </p>
        <div className="form-actions">
          <button type="button" className="primary" disabled={!rows.length} onClick={downloadCsv}>
            Download CSV
          </button>
          <button type="button" className="quiet" disabled={!rows.length} onClick={() => window.print()}>
            Print or save as PDF
          </button>
          <span className="export-hint">For a PDF, choose “Save as PDF” as the printer.</span>
        </div>
      </section>
      {range && rows.length ? <Report rows={rows} from={range.from} lastDay={lastDay!} project={project} byId={props.byId} taskById={props.taskById} /> : null}
    </>
  );
}

/** What is printed: totals by project and task, then every entry. Hidden on screen. */
function Report(props: { rows: ExportRow[]; from: Date; lastDay: Date; project: Project | undefined; byId: Map<string, Project>; taskById: Map<string, Task> }) {
  const totals = useMemo(() => {
    const map = new Map<string, { seconds: number; tasks: Map<string, number> }>();
    for (const r of props.rows) {
      const t = map.get(r.projectId) ?? { seconds: 0, tasks: new Map<string, number>() };
      t.seconds += r.seconds;
      const key = r.taskId ?? "";
      t.tasks.set(key, (t.tasks.get(key) ?? 0) + r.seconds);
      map.set(r.projectId, t);
    }
    return [...map].sort((a, b) => b[1].seconds - a[1].seconds);
  }, [props.rows]);
  const total = props.rows.reduce((sum, r) => sum + r.seconds, 0);
  const name = (id: string) => props.byId.get(id)?.name ?? "Deleted project";
  const taskName = (id: string | null) => (id ? (props.taskById.get(id)?.name ?? "") : "");

  return (
    <article className="report" aria-hidden="true">
      <h1>{props.project ? props.project.name : "Time report"}</h1>
      <p>
        {longDay(props.from)} to {longDay(props.lastDay)} · <b>{hoursMinutes(total)}</b> ({decimalHours(total)} hours)
      </p>
      <table>
        <thead>
          <tr>
            <th>Project and task</th>
            <th className="num">Time</th>
            <th className="num">Hours</th>
          </tr>
        </thead>
        <tbody>
          {totals.map(([projectId, t]) => (
            <ReportProject key={projectId} name={name(projectId)} seconds={t.seconds} tasks={[...t.tasks].filter(([id]) => id).map(([id, s]) => [taskName(id), s] as const)} />
          ))}
        </tbody>
      </table>
      <h2>Entries</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Project</th>
            <th>Note</th>
            <th className="num">Hours</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((r, i) => (
            <tr key={i}>
              <td>{isoDay(r.start)}</td>
              <td>
                {hhmm(r.start)}–{hhmm(r.end)}
              </td>
              <td>
                {name(r.projectId)}
                {r.taskId ? ` › ${taskName(r.taskId)}` : ""}
              </td>
              <td>{r.note}</td>
              <td className="num">{hoursMinutes(r.seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

function ReportProject(props: { name: string; seconds: number; tasks: (readonly [string, number])[] }) {
  return (
    <>
      <tr className="report-project">
        <td>{props.name}</td>
        <td className="num">{hoursMinutes(props.seconds)}</td>
        <td className="num">{decimalHours(props.seconds)}</td>
      </tr>
      {props.tasks.map(([task, seconds]) => (
        <tr key={task} className="report-task">
          <td>{task}</td>
          <td className="num">{hoursMinutes(seconds)}</td>
          <td className="num">{decimalHours(seconds)}</td>
        </tr>
      ))}
    </>
  );
}
