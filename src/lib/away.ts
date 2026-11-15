// Deciding when the person has stepped away. No React and no browser, so it can be tested.

export interface AwaySettings {
  /** Whether the timer pauses itself when the person is away. */
  enabled: boolean;
  /** How long without touching the computer counts as away. */
  minutes: number;
  /** Whether to remind the person that nothing runs while they are using the computer. */
  remind: boolean;
  /** After how many minutes of use with nothing running. */
  remindMinutes: number;
}

export const defaultAwaySettings: AwaySettings = { enabled: true, minutes: 10, remind: true, remindMinutes: 20 };
export const MIN_AWAY_MINUTES = 1;
export const MAX_AWAY_MINUTES = 240;

export const clampMinutes = (value: number) =>
  Number.isFinite(value) ? Math.min(MAX_AWAY_MINUTES, Math.max(MIN_AWAY_MINUTES, Math.round(value))) : defaultAwaySettings.minutes;

/** The settings as this browser stored them; anything missing or odd falls back to the defaults. */
export function readAwaySettings(raw: string | null): AwaySettings {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object") return defaultAwaySettings;
    return {
      enabled: typeof value.enabled === "boolean" ? value.enabled : defaultAwaySettings.enabled,
      minutes: typeof value.minutes === "number" ? clampMinutes(value.minutes) : defaultAwaySettings.minutes,
      remind: typeof value.remind === "boolean" ? value.remind : defaultAwaySettings.remind,
      remindMinutes: typeof value.remindMinutes === "number" ? clampMinutes(value.remindMinutes) : defaultAwaySettings.remindMinutes,
    };
  } catch {
    return defaultAwaySettings;
  }
}

/** Why the timer paused itself. */
export type AwayReason = "idle" | "locked" | "asleep";

/**
 * When the person left, from what the browser's idle detection says, or null when they are there.
 * Idle means nothing was touched for the whole threshold, so they left that long ago; a locked
 * screen means they left just now.
 */
export function awaySince(state: { userState: string | null; screenState: string | null }, now: number, minutes: number): number | null {
  const times: number[] = [];
  if (state.userState === "idle") times.push(now - minutes * 60_000);
  if (state.screenState === "locked") times.push(now);
  return times.length ? Math.min(...times) : null;
}

/**
 * The page counts on in small steps; a gap much longer than a step means the computer slept
 * (or the browser was frozen) and nothing could have been worked on since the last step.
 * Browsers slow hidden pages down to one step a minute, so a gap must be longer than that,
 * and longer than the person's own threshold, before it counts.
 */
export function sleptSince(lastTick: number, now: number, minutes: number): number | null {
  return now - lastTick > Math.max(minutes * 60_000, 2 * 60_000) ? lastTick : null;
}

export interface PausedInfo {
  /** The entry that was paused, to carry on with if the person wants the time away counted. */
  entryId: string;
  projectId: string;
  /** When the person left, as an ISO string. */
  at: string;
  why: AwayReason;
}

export function readPaused(raw: string | null): PausedInfo | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (value && typeof value.entryId === "string" && typeof value.projectId === "string" && typeof value.at === "string") {
      return { entryId: value.entryId, projectId: value.projectId, at: value.at, why: value.why === "locked" || value.why === "asleep" ? value.why : "idle" };
    }
  } catch {
    // Unreadable: as if nothing was paused.
  }
  return null;
}

/** What the paused card and the notification say about why. */
export function pausedBecause(why: AwayReason): string {
  if (why === "locked") return "the screen was locked";
  if (why === "asleep") return "the computer was asleep";
  return "you were away";
}

/**
 * Whether to remind the person that nothing runs: they have been using the computer without
 * a break since `activeSince`, for at least `minutes`, and were not reminded in that time.
 */
export function shouldRemind(activeSince: number | null, lastReminded: number, now: number, minutes: number): boolean {
  if (activeSince === null) return false;
  const span = minutes * 60_000;
  return now - activeSince >= span && now - lastReminded >= span;
}
