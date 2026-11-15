"use client";
// The week at a glance: hours per day, stacked by project, against a daily target,
// with the week's projects below as a table. Any week can be looked at.

import { useEffect, useMemo, useState } from "react";
import { hoursMinutes, startOfWeek } from "@/lib/format";
import { isWorkday, summarize } from "@/lib/summary";
import type { Entry, Project, Snapshot } from "@/lib/types";
import { store, stored } from "./away";

const TARGET_KEY = "time.target";
const DEFAULT_TARGET = 6;

/** The entries with time in a period, read from the server; read again whenever `version` changes. */
export function useEntriesBetween(from: Date, to: Date, version: unknown): { entries: Entry[] | null; problem: string | null } {
  const [result, setResult] = useState<{ key: string; entries: Entry[] | null; problem: string | null }>({ key: "", entries: null, problem: null });
  const key = `${from.toISOString()}/${to.toISOString()}`;
  useEffect(() => {
    let current = true;
    fetch(`/api/entries?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`)
      .then(async (response) => {
        const answer = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(answer.error || "The time could not be read.");
        if (current) setResult({ key, entries: answer.entries as Entry[], problem: null });
      })
      .catch((error) => current && setResult({ key, entries: null, problem: error instanceof Error ? error.message : String(error) }));
    return () => {
      current = false;
    };
    // `from` and `to` are in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  // A different period's answer is not this one's.
  return result.key === key ? result : { entries: null, problem: null };
}

const dayName = (day: Date) => day.toLocaleDateString([], { weekday: "short" });
const dayDate = (day: Date) => day.toLocaleDateString([], { day: "numeric", month: "short" });

export function WeekView(props: { state: Snapshot; projects: Project[]; byId: Map<string, Project>; now: number }) {
  const [offset, setOffset] = useState(0);
  const [target, setTargetState] = useState(DEFAULT_TARGET);
  const [hover, setHover] = useState<{ day: number; projectId: string } | null>(null);

  useEffect(() => {
    const first = window.setTimeout(() => {
      const saved = Number(stored(TARGET_KEY));
      if (stored(TARGET_KEY) !== null && Number.isFinite(saved)) setTargetState(Math.min(24, Math.max(0, saved)));
    }, 0);
    return () => window.clearTimeout(first);
  }, []);
  const setTarget = (hours: number) => {
    const clean = Math.min(24, Math.max(0, Math.round(hours * 4) / 4));
    setTargetState(clean);
    store(TARGET_KEY, String(clean));
  };

  // Only a new week can move it; the clock ticking within one must not read the server again.
  const thisMonday = startOfWeek(new Date(props.now)).getTime();
  const from = useMemo(() => {
    const monday = new Date(thisMonday);
    return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + offset * 7);
  }, [offset, thisMonday]);
  const to = useMemo(() => new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7), [from]);
  // Read again after every change the page makes (each one brings a new snapshot).
  const { entries, problem } = useEntriesBetween(from, to, props.state);
  const week = useMemo(() => summarize(entries ?? [], from, to, props.now), [entries, from, to, props.now]);

  const today = new Date(props.now);
  const todayIndex = week.days.findIndex((d) => d.day.toDateString() === today.toDateString());
  const todaySeconds = todayIndex >= 0 ? week.days[todayIndex].seconds : 0;
  const workdays = week.days.filter((d) => isWorkday(d.day)).length;
  const weekTarget = target * workdays * 3600;
  const top = Math.max(target * 3600, ...week.days.map((d) => d.seconds), 3600);
  const label = offset === 0 ? "This week" : offset === -1 ? "Last week" : `Week of ${dayDate(from)}`;

  return (
    <section className="panel week-panel" aria-labelledby="week-title">
      <div className="panel-head">
        <h2 id="week-title">{label}</h2>
        <div className="week-nav">
          <button type="button" className="quiet" onClick={() => setOffset(offset - 1)} aria-label="The week before">
            ‹
          </button>
          {offset !== 0 ? (
            <button type="button" className="quiet" onClick={() => setOffset(0)}>
              This week
            </button>
          ) : null}
          <button type="button" className="quiet" onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label="The week after">
            ›
          </button>
        </div>
        <span className="spacer" />
        <label className="target">
          Daily target{" "}
          <input type="number" min={0} max={24} step={0.5} value={target} onChange={(event) => setTarget(Number(event.target.value))} aria-label="Daily target in hours" />{" "}
          h
        </label>
      </div>

      <p className="week-summary">
        {offset === 0 && todayIndex >= 0 ? (
          <>
            <b>Today {hoursMinutes(todaySeconds)}</b>
            {target > 0 && isWorkday(today)
              ? todaySeconds >= target * 3600
                ? ` · target of ${hoursMinutes(target * 3600)} reached`
                : ` · ${hoursMinutes(target * 3600 - todaySeconds)} to go for ${hoursMinutes(target * 3600)}`
              : null}
            {"  ·  "}
          </>
        ) : null}
        <b>Week {hoursMinutes(week.seconds)}</b>
        {target > 0 ? ` of ${hoursMinutes(weekTarget)} (Monday to Friday)` : null}
      </p>
      {problem ? <p className="problem">{problem}</p> : null}

      <div className="week-chart" role="img" aria-label={`Hours per day, ${label.toLowerCase()}. The table below has the numbers.`}>
        {target > 0 ? (
          <div className="target-line" style={{ bottom: `${(target * 3600 * 100) / top}%` }}>
            <span>{hoursMinutes(target * 3600)}</span>
          </div>
        ) : null}
        {week.days.map((d, i) => (
          <div key={d.day.getTime()} className={`week-day${i === todayIndex && offset === 0 ? " is-today" : ""}`}>
            <span className="week-day-total">{d.seconds >= 60 ? hoursMinutes(d.seconds) : ""}</span>
            <div className="week-bar" style={{ height: `${(d.seconds * 100) / top}%` }}>
              {/* Biggest at the bottom, so the day's main project sits on the baseline. */}
              {[...d.byProject].reverse().map((part) => {
                const project = props.byId.get(part.projectId);
                const on = hover?.day === i && hover.projectId === part.projectId;
                return (
                  <div
                    key={part.projectId}
                    className={`week-part${on ? " is-on" : ""}`}
                    data-color={project?.color ?? "slate"}
                    style={{ flexGrow: part.seconds }}
                    onMouseEnter={() => setHover({ day: i, projectId: part.projectId })}
                    onMouseLeave={() => setHover(null)}
                  >
                    {on ? (
                      <span className="week-tip" role="tooltip">
                        <b>{project?.name ?? "Deleted project"}</b>
                        <br />
                        {dayName(d.day)} {dayDate(d.day)} · {hoursMinutes(part.seconds)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <span className="week-day-name">
              {dayName(d.day)}
              <small>{d.day.getDate()}</small>
            </span>
          </div>
        ))}
      </div>

      {week.byProject.length ? (
        <table className="week-table">
          <caption className="visually-hidden">Each project&apos;s time {label.toLowerCase()}, by day</caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              {week.days.map((d) => (
                <th scope="col" key={d.day.getTime()}>
                  {dayName(d.day)}
                </th>
              ))}
              <th scope="col">Week</th>
            </tr>
          </thead>
          <tbody>
            {week.byProject.map((row) => {
              const project = props.byId.get(row.projectId);
              return (
                <tr key={row.projectId} data-color={project?.color ?? "slate"}>
                  <th scope="row">
                    <span className="week-name">
                      <span className="swatch" /> {project?.name ?? "Deleted project"}
                    </span>
                  </th>
                  {week.days.map((d) => {
                    const s = d.byProject.find((p) => p.projectId === row.projectId)?.seconds ?? 0;
                    return <td key={d.day.getTime()}>{s >= 60 ? hoursMinutes(s) : ""}</td>;
                  })}
                  <td className="week-total">{hoursMinutes(row.seconds)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : entries ? (
        <p className="empty">No time recorded {offset === 0 ? "this week yet" : "that week"}.</p>
      ) : null}
    </section>
  );
}
