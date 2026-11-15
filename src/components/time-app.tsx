"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ago, clock, entrySeconds, fromLocalInput, hoursMinutes, secondsWithin, startOfDay, startOfWeek, toLocalInput } from "@/lib/format";
import { projectColors, type Entry, type Project, type ProjectColor, type Snapshot, type Task } from "@/lib/types";
import Link from "next/link";
import { Wordmark } from "./wordmark";
import { pausedBecause, readPaused, type AwayReason, type AwaySettings, type PausedInfo } from "@/lib/away";
import {
  AwaySettingsPanel,
  closeNotifications,
  notify,
  store,
  stored,
  useAppShell,
  useAwaySettings,
  useAwayWatch,
  useNothingRunningReminder,
  usePauseKey,
} from "./away";
import { QuickSwitcher, useSwitcherKey } from "./switcher";

const PAUSED_KEY = "time.paused";
const INTRODUCED_KEY = "time.away.introduced";

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
  const [paused, setPausedState] = useState<PausedInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  // Whether the person has seen (or waved off) the note about pausing when away.
  const [introduced, setIntroduced] = useState(true);
  const now = useNow(current);

  const load = useCallback(
    () =>
      ask("GET", "/api/state").then(
        (snapshot) => setCurrent(loaded(snapshot)),
        (error) => setProblem(error instanceof Error ? error.message : String(error)),
      ),
    [],
  );

  // Read when the page opens, and again when it comes back into view: the
  // timer may have been started or stopped on another device meanwhile.
  // Opened from the app icon's "Pause or resume" (?do=toggle), it does that first.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("do") === "toggle") {
      window.history.replaceState(null, "", "/");
      ask("POST", "/api/timer/toggle").then(
        (snapshot) => setCurrent(loaded(snapshot)),
        (error) => {
          setProblem(error instanceof Error ? error.message : String(error));
          load();
        },
      );
    } else {
      load();
    }
    // Opened from the app icon's "Start a project…" (?do=switch).
    // The address is tidied only once it has been acted on, so a second run of this effect
    // (React runs it twice in development) still sees it.
    const openSwitcher = url.searchParams.get("do") === "switch";
    const first = window.setTimeout(() => {
      setPausedState(readPaused(stored(PAUSED_KEY)));
      setIntroduced(stored(INTRODUCED_KEY) !== null);
      if (openSwitcher) {
        window.history.replaceState(null, "", "/");
        setShowSwitcher(true);
      }
    }, 0);
    const again = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", again);
    return () => {
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", again);
    };
  }, [load]);

  /** Remembers (in this browser) that the timer paused itself, so the card can offer to resume. */
  const setPaused = useCallback((info: PausedInfo | null) => {
    setPausedState(info);
    store(PAUSED_KEY, info ? JSON.stringify(info) : null);
    if (!info) closeNotifications("time-paused");
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
  const tasks = useMemo(() => state?.tasks ?? [], [state]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  const running = state?.running ?? null;
  const runningProject = running ? byId.get(running.projectId) : undefined;
  // What "Resume" starts again: the entry that ended last.
  const last = useMemo(() => {
    const ended = (state?.entries ?? []).filter((e) => e.endedAt);
    return ended.reduce<Entry | null>((latest, e) => (!latest || Date.parse(e.endedAt!) > Date.parse(latest.endedAt!) ? e : latest), null);
  }, [state]);
  const lastProject = last ? byId.get(last.projectId) : undefined;

  // Once something runs again, the "paused" notification has done its job. (The paused card
  // only shows while the paused entry is still the last one, so it goes by itself.)
  useEffect(() => {
    if (running) closeNotifications();
  }, [running]);

  const away = useAwaySettings();
  const pausing = useRef(false);
  const onAway = useCallback(
    async (at: number, why: AwayReason) => {
      if (!running || pausing.current) return;
      pausing.current = true;
      // Never before the entry began; on the server's clock.
      const when = Math.max(at + (current?.skew ?? 0), Date.parse(running.startedAt));
      const ok = await act("DELETE", "/api/timer", { at: new Date(when).toISOString() });
      pausing.current = false;
      if (!ok) return;
      const info: PausedInfo = { entryId: running.id, projectId: running.projectId, at: new Date(when).toISOString(), why };
      setPaused(info);
      const time = new Date(when).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      notify(`Timer paused at ${time}`, `${runningProject?.name ?? "Your timer"} paused because ${pausedBecause(why)}.`, { entryId: running.id });
    },
    [running, runningProject, current, act, setPaused],
  );
  useAwayWatch({ running: Boolean(running), settings: away.settings, access: away.access, onAway });
  const onRemind = useCallback(() => {
    const minutes = away.settings?.remindMinutes ?? 20;
    const resumable = lastProject && !lastProject.archived ? lastProject : null;
    notify(
      "No timer is running",
      `You have been at the computer for ${minutes} minute${minutes === 1 ? "" : "s"} without recording time.${resumable ? ` Resume ${resumable.name}?` : " Open Unlabelled Time to start one."}`,
      {},
      { tag: "time-reminder", resume: Boolean(resumable) },
    );
  }, [away.settings, lastProject]);
  useNothingRunningReminder({ running: Boolean(running), settings: away.settings, access: away.access, onRemind });
  const shell = useAppShell(Boolean(running), load);
  const toggle = useCallback(() => {
    if (!busy) act("POST", "/api/timer/toggle");
  }, [busy, act]);
  usePauseKey(toggle);
  const openSwitcher = useCallback(() => setShowSwitcher(true), []);
  useSwitcherKey(openSwitcher);

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
      <Header viewer={viewer} away={away.settings} onSettings={() => setShowSettings(!showSettings)} settingsOpen={showSettings} onSwitch={active.length ? openSwitcher : undefined} />
      {showSwitcher && active.length ? (
        <QuickSwitcher
          projects={active}
          tasks={tasks}
          running={running}
          busy={busy}
          onStart={(projectId, note, taskId) => act("POST", "/api/timer", { projectId, note, ...(taskId ? { task: { id: taskId } } : {}) })}
          onPause={() => act("DELETE", "/api/timer")}
          onNote={(note) => running && act("PATCH", `/api/entries/${running.id}`, { note })}
          onClose={() => setShowSwitcher(false)}
        />
      ) : null}
      <main className="page">
        {showSettings && away.settings ? (
          <AwaySettingsPanel
            settings={away.settings}
            onChange={away.change}
            access={away.access}
            notifications={away.notifications}
            onAllow={away.allow}
            canInstall={shell.canInstall}
            installed={shell.installed}
            onInstall={shell.promptInstall}
            onClose={() => setShowSettings(false)}
          />
        ) : null}

        <RunningCard
          key={running?.id ?? "idle"}
          running={running}
          project={runningProject}
          seconds={running ? entrySeconds(running, now) : 0}
          busy={busy}
          onStop={() => act("DELETE", "/api/timer")}
          onNote={(note) => running && act("PATCH", `/api/entries/${running.id}`, { note })}
          task={running?.taskId ? taskById.get(running.taskId) : undefined}
          projectTasks={running ? tasks.filter((t) => t.projectId === running.projectId) : []}
          onTask={(task) => running && act("PATCH", `/api/entries/${running.id}`, { task })}
          lastTask={last?.taskId ? taskById.get(last.taskId) : undefined}
          hasProjects={active.length > 0}
          paused={paused && paused.entryId === last?.id ? paused : null}
          last={last && lastProject && !lastProject.archived ? { entry: last, project: lastProject } : null}
          now={now}
          onResume={(keepAwayTime) =>
            act("POST", "/api/timer/resume", keepAwayTime && paused ? { entryId: paused.entryId, keepAwayTime: true } : {}).then((ok) => ok && setPaused(null))
          }
          onDismissPaused={() => setPaused(null)}
        />

        {away.settings && away.access === "ask" && away.settings.enabled && !showSettings && !introduced ? (
          <p className="hint">
            The timer can now pause itself when you step away from the computer, and resume from a notification or the app icon.
            <button
              type="button"
              className="link"
              onClick={() => {
                store(INTRODUCED_KEY, "1");
                setIntroduced(true);
                setShowSettings(true);
              }}
            >
              Set it up
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                store(INTRODUCED_KEY, "1");
                setIntroduced(true);
              }}
            >
              Not now
            </button>
          </p>
        ) : null}

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
            tasks={tasks}
            taskById={taskById}
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

function Header(props: { viewer: ViewerInfo | null; away?: AwaySettings | null; onSettings?: () => void; settingsOpen?: boolean; onSwitch?: () => void }) {
  const { viewer, away } = props;
  return (
    <header className="top">
      <Link href="/" className="home">
        <Wordmark />
      </Link>
      <div className="who">
        {props.onSwitch ? (
          <button type="button" className="quiet switch-button" onClick={props.onSwitch} title="Start a project by typing its name (⌘K or /)">
            Start… <kbd>⌘K</kbd>
          </button>
        ) : null}
        {props.onSettings && away ? (
          <button type="button" className="quiet" onClick={props.onSettings} aria-expanded={props.settingsOpen} title="When you step away, and quick pause">
            {away.enabled ? `Auto-pause: ${away.minutes} min` : "Auto-pause: off"}
          </button>
        ) : null}
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
  /** The running entry's task, and the tasks of its project to choose from. */
  task: Task | undefined;
  projectTasks: Task[];
  onTask: (task: string) => void;
  /** The task of what Resume starts again. */
  lastTask: Task | undefined;
  /** Set when the timer paused itself because the person was away. */
  paused: PausedInfo | null;
  /** What Resume starts again. */
  last: { entry: Entry; project: Project } | null;
  now: number;
  onResume: (keepAwayTime: boolean) => void;
  onDismissPaused: () => void;
}) {
  const { running, project } = props;
  // The card is keyed by the running entry, so a new timer starts with its own note.
  const [note, setNote] = useState(running?.note ?? "");
  const runningNote = running?.note ?? "";
  const [task, setTask] = useState(props.task?.name ?? "");

  useEffect(() => {
    document.title = running && project ? `${clock(props.seconds)} · ${project.name}` : "Unlabelled Time";
  }, [running, project, props.seconds]);

  if ((!running || !project) && props.paused && props.last) {
    const { paused, last } = props;
    const awayFor = hoursMinutes((props.now - Date.parse(paused.at)) / 1000);
    return (
      <section className="now paused" data-color={last.project.color} aria-live="polite">
        <div className="now-text">
          <p className="eyebrow">
            ❚❚&nbsp; Paused at {timeOf(paused.at)} because {pausedBecause(paused.why)}
          </p>
          <h1>{last.project.name}</h1>
          {props.lastTask ? <p className="task-line">{props.lastTask.name}</p> : null}
          {last.entry.note ? <p className="paused-note">{last.entry.note}</p> : null}
          <p className="paused-help">The {awayFor} since then is not counted.</p>
        </div>
        <div className="now-clock">
          <button type="button" className="stop" disabled={props.busy} onClick={() => props.onResume(false)}>
            <span className="play-triangle" aria-hidden="true" /> Resume
          </button>
          <button type="button" className="link" disabled={props.busy} onClick={() => props.onResume(true)}>
            Resume and count the {awayFor} away
          </button>
          <button type="button" className="link" onClick={props.onDismissPaused}>
            Leave it paused
          </button>
        </div>
      </section>
    );
  }

  if (!running || !project) {
    return (
      <section className="now idle" aria-live="polite">
        <div className="now-text">
          <p className="eyebrow">✳&nbsp; Nothing is running</p>
          <h1>
            {props.hasProjects ? "Press play on a project" : "Start with a project"}
            <span className="dot">.</span>
          </h1>
        </div>
        {props.last ? (
          <div className="now-clock">
            <button type="button" className="quiet resume" data-color={props.last.project.color} disabled={props.busy} onClick={() => props.onResume(false)}>
              <span className="play-triangle" aria-hidden="true" /> Resume {props.last.project.name}
              {props.lastTask ? ` › ${props.lastTask.name}` : ""}
            </button>
          </div>
        ) : null}
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
          className="note-input task-input"
          value={task}
          placeholder="Task (optional)"
          aria-label="Task for this time"
          list="running-tasks"
          maxLength={120}
          onChange={(event) => setTask(event.target.value)}
          onBlur={() => task.trim() !== (props.task?.name ?? "") && props.onTask(task)}
          onKeyDown={(event) => event.key === "Enter" && (event.currentTarget as HTMLInputElement).blur()}
        />
        <datalist id="running-tasks">
          {props.projectTasks.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
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
          <span className="pause-bars" aria-hidden="true" /> Pause
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
  tasks: Task[];
  taskById: Map<string, Task>;
  filter: string | null;
  onClearFilter: () => void;
  now: number;
  busy: boolean;
  act: (method: string, path: string, body?: object) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // A task filter only holds while its project is the one shown.
  const filteredTask = taskFilter && props.filter && props.taskById.get(taskFilter)?.projectId === props.filter ? taskFilter : null;
  const shown = props.filter
    ? props.entries.filter((e) => e.projectId === props.filter && (!filteredTask || e.taskId === filteredTask))
    : props.entries;
  const projectTasks = props.filter ? props.tasks.filter((t) => t.projectId === props.filter) : [];
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
      {projectTasks.length > 0 ? (
        <div className="task-strip" aria-label="Tasks of this project">
          {projectTasks.map((t) => (
            <span key={t.id} className={`task-chip${filteredTask === t.id ? " is-on" : ""}`}>
              <button type="button" className="task-chip-name" aria-pressed={filteredTask === t.id} onClick={() => setTaskFilter(filteredTask === t.id ? null : t.id)} title="Show only this task's time">
                {t.name} <b>{hoursMinutes(t.totalSeconds)}</b>
              </button>
              <button
                type="button"
                className="task-chip-edit"
                title="Rename or delete this task"
                aria-label={`Rename or delete ${t.name}`}
                disabled={props.busy}
                onClick={() => {
                  const name = window.prompt(`Rename “${t.name}”. Leave it empty to delete the task; its time stays on the project.`, t.name);
                  if (name === null || name.trim() === t.name) return;
                  if (name.trim()) props.act("PATCH", `/api/tasks/${t.id}`, { name });
                  else props.act("DELETE", `/api/tasks/${t.id}`);
                }}
              >
                ✎
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {adding ? (
        <EntryForm
          tasks={props.tasks}
          projects={choosable}
          initial={{ projectId: props.filter ?? choosable[0]?.id ?? "", startedAt: new Date(props.now - 3_600_000).toISOString(), endedAt: new Date(props.now).toISOString(), note: "", task: "" }}
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
                        tasks={props.tasks}
                        projects={props.projects.filter((p) => !p.archived || p.id === entry.projectId)}
                        initial={{ ...entry, task: entry.taskId ? (props.taskById.get(entry.taskId)?.name ?? "") : "" }}
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
                        <span className="entry-project">
                          {project?.name ?? "Deleted project"}
                          {entry.taskId && props.taskById.get(entry.taskId) ? <span className="entry-task"> › {props.taskById.get(entry.taskId)!.name}</span> : null}
                        </span>
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
  task: string;
  startedAt: string;
  endedAt: string | null;
  note: string;
}

function EntryForm(props: {
  tasks: Task[];
  projects: Project[];
  initial: EntryValues;
  busy: boolean;
  submitLabel: string;
  onSubmit: (values: { projectId: string; task: string; startedAt: string; endedAt?: string; note: string }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [projectId, setProjectId] = useState(props.initial.projectId);
  const [start, setStart] = useState(toLocalInput(props.initial.startedAt));
  const [end, setEnd] = useState(props.initial.endedAt ? toLocalInput(props.initial.endedAt) : "");
  const [note, setNote] = useState(props.initial.note);
  const [task, setTask] = useState(props.initial.task);
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
    props.onSubmit({ projectId, task, startedAt, ...(endedAt ? { endedAt } : {}), note });
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
      <label className="wide">
        <span>Task</span>
        <input value={task} onChange={(event) => setTask(event.target.value)} placeholder="Optional: pick one or type a new one" list="entry-form-tasks" maxLength={120} />
        <datalist id="entry-form-tasks">
          {props.tasks
            .filter((t) => t.projectId === projectId)
            .map((t) => (
              <option key={t.id} value={t.name} />
            ))}
        </datalist>
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
