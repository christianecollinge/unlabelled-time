// What the server sends the page. Times are ISO strings; durations are seconds.

/** The colours a project can have, as names; their tones are in src/app/styles/time.css. */
export const projectColors = ["wine", "plum", "rose", "coral", "amber", "sage", "teal", "blue", "slate"] as const;
export type ProjectColor = (typeof projectColors)[number];

export interface Project {
  id: string;
  name: string;
  color: ProjectColor;
  archived: boolean;
  /** Every finished entry, plus the running one up to the moment it was read. */
  totalSeconds: number;
  lastWorkedAt: string | null;
}

export interface Entry {
  id: string;
  projectId: string;
  startedAt: string;
  /** Null while the timer runs. */
  endedAt: string | null;
  note: string;
}

export interface Snapshot {
  projects: Project[];
  /** The running entry, if any. It is also in `entries`. */
  running: Entry | null;
  /** The most recent entries, newest first. */
  entries: Entry[];
  /** When the server read this, so the page can count on from there. */
  now: string;
}
