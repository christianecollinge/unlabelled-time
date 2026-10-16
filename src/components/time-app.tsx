"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ago, clock, entrySeconds, fromLocalInput, hoursMinutes, secondsWithin, startOfDay, startOfWeek, toLocalInput } from "@/lib/format";
import { projectColors, type Entry, type Project, type ProjectColor, type Snapshot } from "@/lib/types";
import Link from "next/link";
import { Wordmark } from "./wordmark";

export interface ViewerInfo {
  name: string;
  email: string;
}

/** Asks the server for a change and returns the state it answers with, or the reason it gave. */
async function ask(method: string, path: string, body?: object): Promise<Snapshot> {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    // /auth/login is a route handler that leaves for Keycloak, so a whole-page load is what is wanted.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/auth/login");
    throw new Error("Your sign-in has run out.");
  }
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(answer.error || "That did not work. Please try again.");
  return answer as Snapshot;
}

/** The state as the server sent it, and how far the server's clock is ahead of this one. */
interface Loaded {
  snapshot: Snapshot;
  skew: number;
}
const loaded = (snapshot: Snapshot): Loaded => ({ snapshot, skew: Date.parse(snapshot.now) - Date.now() });

/** Ticks once a second while something runs, counting on the server's clock. */
function useNow(state: Loaded | null): number {
  const [now, setNow] = useState(0);
  const skew = state?.skew ?? 0;
  const running = Boolean(state?.snapshot.running);
  useEffect(() => {
    const tick = () => setNow(Date.now() + skew);
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, running ? 1000 : 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [skew, running, state]);
  return now;
}

export function TimeApp({ viewer }: { viewer: ViewerInfo | null }) {
  const [current, setCurrent] = useState<Loaded | null>(null);
  const state = current?.snapshot ?? null;
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const now = useNow(current);

  // Read when the page opens, and again when it comes back into view: the
  // timer may have been started or stopped on another device meanwhile.
  useEffect(() => {
    const load = () =>
      ask("GET", "/api/state").then(
        (snapshot) => setCurrent(loaded(snapshot)),
        (error) => setProblem(error instanceof Error ? error.message : String(error)),
      );
    load();
    const again = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, []);

  const act = useCallback(async (method: string, path: string, body?: object): Promise<boolean> => {
    setBusy(true);
    try {
      setCurrent(loaded(await ask(method, path, body)));
      setProblem(null);
      return true;
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const projects = useMemo(() => state?.projects ?? [], [state]);
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  const running = state?.running ?? null;
  const runningProject = running ? byId.get(running.projectId) : undefined;

  const totals = useMemo(() => {
    const entries = state?.entries ?? [];
    const today = startOfDay(new Date(now)).getTime();
    const week = startOfWeek(new Date(now)).getTime();
    const sum = (from: number) => entries.reduce((total, e) => total + secondsWithin(e, from, Infinity, now), 0);
    const perProjectToday = new Map<string, number>();
    for (const e of entries) perProjectToday.set(e.projectId, (perProjectToday.get(e.projectId) ?? 0) + secondsWithin(e, today, Infinity, now));
    return { today: sum(today), week: sum(week), perProjectToday };
  }, [state, now]);

  // A project's total from the server counts its running entry up to the moment
  // it was read; this keeps it counting on.
  const totalOf = (project: Project) =>
    project.totalSeconds + (running && running.projectId === project.id && state ? Math.max(0, (now - Date.parse(state.now)) / 1000) : 0);
  const allTime = projects.reduce((sum, p) => sum + totalOf(p), 0);

  if (!state || now === 0) {
    return (
      <div className="app">
        <Header viewer={viewer} />
        <main className="page">{problem ? <p className="problem">{problem}</p> : <p className="loading">Loading your time…</p>}</main>
      </div>
    );
  }

  return (
    <div className="app">
      <Header viewer={viewer} />
      <main className="page">
        <RunningCard
          key={running?.id ?? "idle"}
          running={running}
          project={runningProject}
          seconds={running ? entrySeconds(running, now) : 0}
          busy={busy}
          onStop={() => act("DELETE", "/api/timer")}
          onNote={(note) => running && act("PATCH", `/api/entries/${running.id}`, { note })}
          hasProjects={active.length > 0}
        />

        {problem ? (
          <p className="problem" role="alert">
            {problem}
            <button type="button" className="link" onClick={() => setProblem(null)}>
              Close
            </button>
          </p>
        ) : null}

        <section className="stats" aria-label="Totals">
          <Stat value={hoursMinutes(totals.today)} label="Today" />
          <Stat value={hoursMinutes(totals.week)} label="This week" />
          <Stat value={hoursMinutes(allTime)} label="All time" />
          <Stat value={String(active.length)} label={active.length === 1 ? "Project" : "Projects"} />
        </section>

        <div className="columns">
          <section className="panel projects-panel" aria-labelledby="projects-title">
            <div className="panel-head">
              <h2 id="projects-title">Projects</h2>
            </div>
            <NewProject busy={busy} onCreate={(name, color) => act("POST", "/api/projects", { name, color })} />
            {active.length === 0 ? <p className="empty">No projects yet. Name your first one above, then press play to start the clock.</p> : null}
            <ul className="project-list">
              {active.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  total={totalOf(project)}
                  today={totals.perProjectToday.get(project.id) ?? 0}
                  now={now}
                  isRunning={running?.projectId === project.id}
                  isFiltered={filter === project.id}
                  busy={busy}
                  onPlay={() => (running?.projectId === project.id ? act("DELETE", "/api/timer") : act("POST", "/api/timer", { projectId: project.id }))}
                  onFilter={() => setFilter(filter === project.id ? null : project.id)}
                  onChange={(patch) => act("PATCH", `/api/projects/${project.id}`, patch)}
                  onDelete={() => act("DELETE", `/api/projects/${project.id}`).then((ok) => ok && filter === project.id && setFilter(null))}
                />
              ))}
            </ul>
            {archived.length > 0 ? (
              <div className="archived">
                <button type="button" className="link" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>
                  {showArchived ? "Hide" : "Show"} archived projects ({archived.length})
                </button>
                {showArchived ? (
                  <ul className="project-list">
                    {archived.map((project) => (
                      <li key={project.id} className="project archived-project" data-color={project.color}>
                        <span className="swatch" />
                        <span className="project-text">
                          <span className="project-name">{project.name}</span>
                          <small>{hoursMinutes(project.totalSeconds)} recorded</small>
                        </span>
                        <button type="button" className="quiet" disabled={busy} onClick={() => act("PATCH", `/api/projects/${project.id}`, { archived: false })}>
                          Bring back
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <Entries
            entries={state.entries}
            projects={projects}
            byId={byId}
            filter={filter}
            onClearFilter={() => setFilter(null)}
            now={now}
            busy={busy}
            act={act}
          />
        </div>
      </main>
    </div>
  );
}

function Header({ viewer }: { viewer: ViewerInfo | null }) {
  return (
    <header className="top">
      <Link href="/" className="home">
        <Wordmark />
      </Link>
      <div className="who">
        {viewer ? (
          <>
            <span className="who-name" title={viewer.email}>
              {viewer.name || viewer.email}
            </span>
            <a className="quiet" href="/auth/logout">
              Sign out
            </a>
          </>
        ) : (
          <span className="who-name">Local development</span>
        )}
      </div>
    </header>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RunningCard(props: {
  running: Entry | null;
  project: Project | undefined;
  seconds: number;
  busy: boolean;
  hasProjects: boolean;
  onStop: () => void;
  onNote: (note: string) => void;
}) {
  const { running, project } = props;
  // The card is keyed by the running entry, so a new timer starts with its own note.
  const [note, setNote] = useState(running?.note ?? "");
  const runningNote = running?.note ?? "";

  useEffect(() => {
    document.title = running && project ? `${clock(props.seconds)} · ${project.name}` : "Unlabelled Time";
  }, [running, project, props.seconds]);

  if (!running || !project) {
    return (
      <section className="now idle" aria-live="polite">
        <p className="eyebrow">✳&nbsp; Nothing is running</p>
        <h1>
          {props.hasProjects ? "Press play on a project" : "Start with a project"}
          <span className="dot">.</span>
        </h1>
      </section>
    );
  }
  const saveNote = () => note.trim() !== runningNote && props.onNote(note);
  return (
    <section className="now running" data-color={project.color} aria-live="polite">
      <div className="now-text">
        <p className="eyebrow">
          <span className="pulse" aria-hidden="true" /> Recording since{" "}
          {new Date(running.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
        <h1>{project.name}</h1>
        <input
          className="note-input"
          value={note}
          placeholder="What are you working on?"
          aria-label="Note for this time"
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          onBlur={saveNote}
          onKeyDown={(event) => event.key === "Enter" && (event.currentTarget as HTMLInputElement).blur()}
        />
      </div>
      <div className="now-clock">
        <span className="clock">{clock(props.seconds)}</span>
        <button type="button" className="stop" disabled={props.busy} onClick={props.onStop}>
          <span className="stop-square" aria-hidden="true" /> Stop
        </button>
      </div>
    </section>
  );
}

function ColorPicker({ value, onChange, name }: { value: ProjectColor; onChange: (color: ProjectColor) => void; name: string }) {
  return (
    <div className="colors" role="radiogroup" aria-label="Colour">
      {projectColors.map((color) => (
        <label key={color} className="color-choice" data-color={color} title={color}>
          <input type="radio" name={name} value={color} checked={value === color} onChange={() => onChange(color)} />
          <span className="swatch" />
        </label>
      ))}
    </div>
  );
}

function NewProject({ busy, onCreate }: { busy: boolean; onCreate: (name: string, color: ProjectColor) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<ProjectColor>("wine");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    if (await onCreate(name, color)) {
      setName("");
      setColor(projectColors[(projectColors.indexOf(color) + 1) % projectColors.length]);
    }
  };
  return (
    <form className="new-project" onSubmit={submit}>
      <div className="new-project-line">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="New project" aria-label="New project's name" maxLength={120} />
        <button type="submit" className="primary" disabled={busy || !name.trim()}>
          Add
        </button>
      </div>
      {name.trim() ? <ColorPicker value={color} onChange={setColor} name="new-project-color" /> : null}
    </form>
  );
}

function ProjectRow(props: {
  project: Project;
  total: number;
  today: number;
  now: number;
  isRunning: boolean;
  isFiltered: boolean;
  busy: boolean;
  onPlay: () => void;
  onFilter: () => void;
  onChange: (patch: { name?: string; color?: ProjectColor; archived?: boolean }) => Promise<boolean>;
  onDelete: () => void;
}) {
  const { project } = props;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const open = () => {
    setName(project.name);
    setColor(project.color);
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const patch: { name?: string; color?: ProjectColor } = {};
    if (name.trim() !== project.name) patch.name = name;
    if (color !== project.color) patch.color = color;
    if (Object.keys(patch).length === 0 || (await props.onChange(patch))) setEditing(false);
  };

  if (editing) {
    return (
      <li className="project editing" data-color={color}>
        <form className="project-form" onSubmit={save}>
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Project name" maxLength={120} autoFocus />
          <ColorPicker value={color} onChange={setColor} name={`color-${project.id}`} />
          <div className="form-actions">
            <button type="submit" className="primary" disabled={props.busy || !name.trim()}>
              Save
            </button>
            <button type="button" className="quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <span className="spacer" />
            <button type="button" className="quiet" disabled={props.busy} onClick={() => props.onChange({ archived: true }).then(() => setEditing(false))}>
              Archive
            </button>
            <button
              type="button"
              className="quiet danger"
              disabled={props.busy}
              onClick={() => {
                if (window.confirm(`Delete “${project.name}” and all ${hoursMinutes(project.totalSeconds)} recorded on it? This cannot be undone.`)) props.onDelete();
              }}
            >
              Delete
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={`project${props.isRunning ? " is-running" : ""}${props.isFiltered ? " is-filtered" : ""}`} data-color={project.color}>
      <button
        type="button"
        className="play"
        disabled={props.busy}
        onClick={props.onPlay}
        aria-label={props.isRunning ? `Stop ${project.name}` : `Start ${project.name}`}
        title={props.isRunning ? "Stop" : "Start"}
      >
        {props.isRunning ? <span className="stop-square" /> : <span className="play-triangle" />}
      </button>
      <button type="button" className="project-text" onClick={props.onFilter} aria-pressed={props.isFiltered} title="Show only this project's time">
        <span className="project-name">{project.name}</span>
        <small>{props.isRunning ? "Running now" : `Last worked: ${ago(project.lastWorkedAt, props.now).toLowerCase()}`}</small>
      </button>
      <span className="project-total">
        <strong>{hoursMinutes(props.total)}</strong>
        {props.today > 0 ? <small>{hoursMinutes(props.today)} today</small> : null}
      </span>
      <button type="button" className="edit" onClick={open} aria-label={`Edit ${project.name}`} title="Edit">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
    </li>
  );
}

const dayLabel = (day: Date, now: number) => {
  const today = startOfDay(new Date(now)).getTime();
  const diff = Math.round((today - day.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: day.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
};

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Entries(props: {
  entries: Entry[];
  projects: Project[];
  byId: Map<string, Project>;
  filter: string | null;
  onClearFilter: () => void;
  now: number;
  busy: boolean;
  act: (method: string, path: string, body?: object) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const shown = props.filter ? props.entries.filter((e) => e.projectId === props.filter) : props.entries;
  const days = useMemo(() => {
    const groups: { day: Date; entries: Entry[] }[] = [];
    for (const entry of shown) {
      const day = startOfDay(new Date(entry.startedAt));
      const last = groups.at(-1);
      if (last && last.day.getTime() === day.getTime()) last.entries.push(entry);
      else groups.push({ day, entries: [entry] });
    }
    return groups;
  }, [shown]);
  const filtered = props.filter ? props.byId.get(props.filter) : undefined;
  const choosable = props.projects.filter((p) => !p.archived);

  return (
    <section className="panel entries-panel" aria-labelledby="entries-title">
      <div className="panel-head">
        <h2 id="entries-title">Time</h2>
        {filtered ? (
          <button type="button" className="chip" data-color={filtered.color} onClick={props.onClearFilter} title="Show every project">
            <span className="swatch" /> {filtered.name} <span aria-hidden="true">×</span>
          </button>
        ) : null}
        <span className="spacer" />
        {choosable.length > 0 && !adding ? (
          <button type="button" className="quiet" onClick={() => setAdding(true)}>
            + Add time
          </button>
        ) : null}
      </div>
      {adding ? (
        <EntryForm
          projects={choosable}
          initial={{ projectId: props.filter ?? choosable[0]?.id ?? "", startedAt: new Date(props.now - 3_600_000).toISOString(), endedAt: new Date(props.now).toISOString(), note: "" }}
          busy={props.busy}
          submitLabel="Add"
          onCancel={() => setAdding(false)}
          onSubmit={(values) => props.act("POST", "/api/entries", values).then((ok) => ok && setAdding(false))}
        />
      ) : null}
      {days.length === 0 ? <p className="empty">{props.filter ? "No time recorded on this project yet." : "Time you record shows up here, day by day."}</p> : null}
      {days.map(({ day, entries }) => {
        const total = entries.reduce((sum, e) => sum + entrySeconds(e, props.now), 0);
        return (
          <div className="day" key={day.getTime()}>
            <div className="day-head">
              <h3>{dayLabel(day, props.now)}</h3>
              <span>{hoursMinutes(total)}</span>
            </div>
            <ul className="entry-list">
              {entries.map((entry) => {
                const project = props.byId.get(entry.projectId);
                if (editing === entry.id) {
                  return (
                    <li key={entry.id} className="entry editing">
                      <EntryForm
                        projects={props.projects.filter((p) => !p.archived || p.id === entry.projectId)}
                        initial={entry}
                        busy={props.busy}
                        submitLabel="Save"
                        onCancel={() => setEditing(null)}
                        onSubmit={(values) => props.act("PATCH", `/api/entries/${entry.id}`, values).then((ok) => ok && setEditing(null))}
                        onDelete={() => props.act("DELETE", `/api/entries/${entry.id}`).then((ok) => ok && setEditing(null))}
                      />
                    </li>
                  );
                }
                return (
                  <li key={entry.id} className={`entry${entry.endedAt ? "" : " is-running"}`} data-color={project?.color ?? "slate"}>
                    <button type="button" className="entry-button" onClick={() => setEditing(entry.id)} title="Change this time">
                      <span className="swatch" />
                      <span className="entry-text">
                        <span className="entry-project">{project?.name ?? "Deleted project"}</span>
                        {entry.note ? <span className="entry-note">{entry.note}</span> : null}
                      </span>
                      <span className="entry-times">
                        {timeOf(entry.startedAt)}–{entry.endedAt ? timeOf(entry.endedAt) : "now"}
                      </span>
                      <span className="entry-duration">{entry.endedAt ? hoursMinutes(entrySeconds(entry, props.now)) : clock(entrySeconds(entry, props.now))}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

interface EntryValues {
  projectId: string;
  startedAt: string;
  endedAt: string | null;
  note: string;
}

function EntryForm(props: {
  projects: Project[];
  initial: EntryValues;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: { projectId: string; startedAt: string; endedAt?: string; note: string }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [projectId, setProjectId] = useState(props.initial.projectId);
  const [start, setStart] = useState(toLocalInput(props.initial.startedAt));
  const [end, setEnd] = useState(props.initial.endedAt ? toLocalInput(props.initial.endedAt) : "");
  const [note, setNote] = useState(props.initial.note);
  const [problem, setProblem] = useState<string | null>(null);
  const running = props.initial.endedAt === null;
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const startedAt = fromLocalInput(start);
    const endedAt = end ? fromLocalInput(end) : null;
    if (!startedAt) return setProblem("Give a start.");
    if (!running && !endedAt) return setProblem("Give an end.");
    if (endedAt && endedAt < startedAt) return setProblem("The end is before the start.");
    setProblem(null);
    props.onSubmit({ projectId, startedAt, ...(endedAt ? { endedAt } : {}), note });
  };

  return (
    <form className="entry-form" onSubmit={submit}>
      <label className="wide">
        <span>Project</span>
        <select ref={first} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          {props.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>From</span>
        <input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required />
      </label>
      <label>
        <span>To</span>
        {running && !end ? (
          <span className="still-running">
            Still running{" "}
            <button type="button" className="link" onClick={() => setEnd(toLocalInput(new Date().toISOString()))}>
              Set an end
            </button>
          </span>
        ) : (
          <input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required={!running} />
        )}
      </label>
      <label className="wide">
        <span>Note</span>
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" maxLength={2000} />
      </label>
      {problem ? <p className="problem wide">{problem}</p> : null}
      <div className="form-actions wide">
        <button type="submit" className="primary" disabled={props.busy || !projectId}>
          {props.submitLabel}
        </button>
        <button type="button" className="quiet" onClick={props.onCancel}>
          Cancel
        </button>
        <span className="spacer" />
        {props.onDelete ? (
          <button type="button" className="quiet danger" disabled={props.busy} onClick={() => window.confirm("Delete this time?") && props.onDelete?.()}>
            Delete
          </button>
        ) : null}
      </div>
    </form>
  );
}
