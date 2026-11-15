"use client";
// Pausing when the person steps away, and reaching the timer without finding the page:
// the installed app, its Dock menu and badge, the notification and the P key.

import { useCallback, useEffect, useRef, useState } from "react";
import { awaySince, clampMinutes, readAwaySettings, sleptSince, type AwayReason, type AwaySettings } from "@/lib/away";

const SETTINGS_KEY = "time.away";

// The browser's idle detection (Chrome and Edge). Not in TypeScript's own types yet.
interface IdleDetectorLike extends EventTarget {
  userState: string | null;
  screenState: string | null;
  start(options: { threshold: number; signal: AbortSignal }): Promise<void>;
}
interface IdleDetectorClass {
  new (): IdleDetectorLike;
  requestPermission(): Promise<"granted" | "denied">;
}
const idleDetector = (): IdleDetectorClass | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { IdleDetector?: IdleDetectorClass }).IdleDetector;

/** Local storage can be missing or refuse (private windows); the page must work without it. */
export function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function store(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not kept; it only lasts for this visit.
  }
}

export type IdleAccess = "unsupported" | "ask" | "granted" | "denied";

async function idleAccess(): Promise<IdleAccess> {
  if (!idleDetector()) return "unsupported";
  try {
    const status = await navigator.permissions.query({ name: "idle-detection" as PermissionName });
    return status.state === "granted" ? "granted" : status.state === "denied" ? "denied" : "ask";
  } catch {
    return "ask";
  }
}

/** This browser's away settings, and whether it may watch for idle time. */
export function useAwaySettings() {
  const [settings, setSettings] = useState<AwaySettings | null>(null);
  const [access, setAccess] = useState<IdleAccess>("unsupported");
  const [notifications, setNotifications] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    const first = window.setTimeout(() => {
      setSettings(readAwaySettings(stored(SETTINGS_KEY)));
      setNotifications(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    }, 0);
    idleAccess().then(setAccess);
    return () => window.clearTimeout(first);
  }, []);

  const change = useCallback((next: AwaySettings) => {
    const clean = { enabled: next.enabled, minutes: clampMinutes(next.minutes) };
    setSettings(clean);
    store(SETTINGS_KEY, JSON.stringify(clean));
  }, []);

  /** Asks for idle detection and notifications; must run from a click. */
  const allow = useCallback(async () => {
    const Detector = idleDetector();
    if (Detector) {
      try {
        setAccess((await Detector.requestPermission()) === "granted" ? "granted" : "denied");
      } catch {
        setAccess("denied");
      }
    }
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      setNotifications(await Notification.requestPermission());
    }
  }, []);

  return { settings, change, access, notifications, allow };
}

/**
 * Calls `onAway` with when the person left, while something runs: when the browser's idle
 * detection says nothing was touched for the threshold or the screen locked, or when the
 * page's own clock jumped because the computer slept.
 */
export function useAwayWatch(props: { running: boolean; settings: AwaySettings | null; access: IdleAccess; onAway: (at: number, why: AwayReason) => void }) {
  const { running, settings, access, onAway } = props;
  const latest = useRef(onAway);
  useEffect(() => {
    latest.current = onAway;
  }, [onAway]);

  const on = Boolean(running && settings?.enabled);
  const minutes = settings?.minutes ?? 10;

  // Sleep: every browser.
  useEffect(() => {
    if (!on) return;
    let last = Date.now();
    const step = window.setInterval(() => {
      const now = Date.now();
      const since = sleptSince(last, now, minutes);
      last = now;
      if (since !== null) latest.current(since, "asleep");
    }, 15_000);
    return () => window.clearInterval(step);
  }, [on, minutes]);

  // Idle and locked: Chrome and Edge, once allowed.
  useEffect(() => {
    const Detector = idleDetector();
    if (!on || access !== "granted" || !Detector) return;
    const controller = new AbortController();
    const detector = new Detector();
    const check = () => {
      const since = awaySince(detector, Date.now(), minutes);
      if (since !== null) latest.current(since, detector.screenState === "locked" && detector.userState !== "idle" ? "locked" : "idle");
    };
    detector.addEventListener("change", check);
    // The browser will not watch for less than a minute.
    detector.start({ threshold: Math.max(60_000, minutes * 60_000), signal: controller.signal }).catch(() => undefined);
    return () => {
      detector.removeEventListener("change", check);
      controller.abort();
    };
  }, [on, access, minutes]);
}

/** Shows a notification through the app's service worker, so its Resume button works with the page hidden. */
export async function notify(title: string, body: string, data: object) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, {
        body,
        tag: "time-paused",
        requireInteraction: true,
        icon: "/app-icon-192.png",
        data,
        // Action buttons are not in every TypeScript version's types.
        ...({ actions: [{ action: "resume", title: "Resume" }] } as object),
      });
      return;
    }
    const plain = new Notification(title, { body, tag: "time-paused", icon: "/app-icon-192.png" });
    plain.onclick = () => window.focus();
  } catch {
    // A notification is a courtesy; the card on the page says the same.
  }
}

export function closeNotifications() {
  navigator.serviceWorker
    ?.getRegistration()
    .then((registration) => registration?.getNotifications({ tag: "time-paused" }))
    .then((open) => open?.forEach((n) => n.close()))
    .catch(() => undefined);
}

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

/**
 * The parts of being an installed app: the service worker (notifications with a Resume
 * button), the Dock badge while something runs, and the browser's offer to install.
 * `onChanged` runs when the service worker changed the timer, so the page reads it again.
 */
export function useAppShell(running: boolean, onChanged: () => void) {
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const latest = useRef(onChanged);
  useEffect(() => {
    latest.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    const message = (event: MessageEvent) => event.data?.type === "timer-changed" && latest.current();
    navigator.serviceWorker.addEventListener("message", message);
    return () => navigator.serviceWorker.removeEventListener("message", message);
  }, []);

  useEffect(() => {
    const offer = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
    };
    const done = () => {
      setInstall(null);
      setInstalled(true);
    };
    const first = window.setTimeout(() => setInstalled(window.matchMedia("(display-mode: standalone)").matches), 0);
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", done);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("beforeinstallprompt", offer);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  // A dot on the app's Dock icon while the timer runs.
  useEffect(() => {
    const badge = navigator as Navigator & { setAppBadge?: () => Promise<void>; clearAppBadge?: () => Promise<void> };
    (running ? badge.setAppBadge?.() : badge.clearAppBadge?.())?.catch(() => undefined);
  }, [running]);

  const promptInstall = useCallback(async () => {
    if (!install) return;
    await install.prompt();
    setInstall(null);
  }, [install]);

  return { canInstall: Boolean(install), installed, promptInstall };
}

/** P pauses or resumes, when the page has the keyboard and nobody is typing. */
export function usePauseKey(onToggle: () => void) {
  const latest = useRef(onToggle);
  useEffect(() => {
    latest.current = onToggle;
  }, [onToggle]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "p" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}

export function AwaySettingsPanel(props: {
  settings: AwaySettings;
  onChange: (settings: AwaySettings) => void;
  access: IdleAccess;
  notifications: NotificationPermission | "unsupported";
  onAllow: () => void;
  canInstall: boolean;
  installed: boolean;
  onInstall: () => void;
  onClose: () => void;
}) {
  const { settings } = props;
  const [minutes, setMinutes] = useState(String(settings.minutes));
  const needsAllowing = props.access === "ask" || props.notifications === "default";
  const mac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <section className="panel settings" aria-labelledby="settings-title">
      <div className="panel-head">
        <h2 id="settings-title">When you step away</h2>
        <span className="spacer" />
        <button type="button" className="link" onClick={props.onClose}>
          Close
        </button>
      </div>
      <label className="setting-line">
        <input type="checkbox" checked={settings.enabled} onChange={(event) => props.onChange({ ...settings, enabled: event.target.checked })} />
        <span>
          Pause the timer when I have not touched the computer for{" "}
          <input
            className="minutes"
            type="number"
            min={1}
            max={240}
            value={minutes}
            aria-label="Minutes"
            onChange={(event) => setMinutes(event.target.value)}
            onBlur={() => {
              const value = clampMinutes(Number(minutes));
              setMinutes(String(value));
              props.onChange({ ...settings, minutes: value });
            }}
          />{" "}
          minutes, or lock the screen, or the computer sleeps.
        </span>
      </label>
      <p className="setting-note">
        {props.access === "unsupported"
          ? "This browser can only tell when the computer sleeps. In Chrome or Edge, the timer also notices when you leave the computer alone or lock the screen."
          : props.access === "denied"
            ? "The browser was told not to watch for idle time, so only sleep is noticed. To change that, open the site settings from the icon left of the address and allow “Idle detection”."
            : props.access === "granted"
              ? "The time you were away is left out. You get a notification, and the card above offers to resume or to count the time away after all."
              : "The browser asks once before it lets the timer notice that you are away."}{" "}
        It works while this page or the app is open, even in the background.
      </p>
      {needsAllowing ? (
        <button type="button" className="primary" onClick={props.onAllow}>
          Allow idle detection and notifications
        </button>
      ) : null}

      <h3 className="settings-sub">Pause and resume without finding the page</h3>
      <ul className="setting-tips">
        <li>
          {props.installed ? (
            <>This is the installed app. {mac ? "Right-click its icon in the Dock" : "Right-click its icon in the taskbar"} and choose <b>Pause or resume</b>; a dot on the icon shows that the timer runs.</>
          ) : (
            <>
              Install Unlabelled Time as an app: it gets its own window and an icon in the {mac ? "Dock" : "taskbar"} with a dot while the timer runs, and right-clicking the icon offers <b>Pause or resume</b>.{" "}
              {props.canInstall ? (
                <button type="button" className="link" onClick={props.onInstall}>
                  Install it now
                </button>
              ) : (
                <>In Chrome: the menu ⋮, then <b>Cast, save and share</b>, then <b>Install page as app</b>.</>
              )}
            </>
          )}
        </li>
        <li>
          Press <kbd>P</kbd> on this page to pause or resume.
        </li>
        <li>The notification that says the timer paused has a <b>Resume</b> button.</li>
      </ul>
    </section>
  );
}
