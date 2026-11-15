"use client";
// The quick switcher: ⌘K (Ctrl+K) or /, type a few letters of a project, Enter starts it.
// "shotz: homepage" starts Shotz website with the note "homepage".

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { matching } from "@/lib/switcher";
import type { Entry, Project, Task } from "@/lib/types";

/** Opens the switcher on ⌘K or Ctrl+K anywhere, and on / when nobody is typing. */
export function useSwitcherKey(onOpen: () => void) {
  const latest = useRef(onOpen);
  useEffect(() => {
    latest.current = onOpen;
  }, [onOpen]);
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)));
      const command = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
      const slash = event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!command && !slash) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
}

/** Splits "shotz: homepage" into what finds the project and the note. */
const split = (text: string) => {
  const colon = text.indexOf(":");
  return colon < 0 ? { query: text, note: "" } : { query: text.slice(0, colon), note: text.slice(colon + 1).trim() };
};

export function QuickSwitcher(props: {
  projects: Project[];
  tasks: Task[];
  running: Entry | null;
  busy: boolean;
  onStart: (projectId: string, note: string, taskId?: string) => void;
  onPause: () => void;
  /** A new note for what already runs. */
  onNote: (note: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { query, note } = split(text);

  type Choice = { kind: "pause"; label: string } | { kind: "project"; project: Project; task?: Task };
  const runningProjectId = props.running?.projectId ?? null;
  const choices = useMemo<Choice[]>(() => {
    // Projects, and each project's tasks as "Project › Task", found by either name.
    const byId = new Map(props.projects.map((p) => [p.id, p]));
    const items: { name: string; choice: Choice }[] = [];
    for (const project of props.projects) {
      items.push({ name: project.name, choice: { kind: "project", project } });
      for (const task of props.tasks) {
        if (task.projectId === project.id && byId.has(task.projectId)) items.push({ name: `${project.name} ${task.name}`, choice: { kind: "project", project, task } });
      }
    }
    // With nothing typed, only the projects: the tasks would bury them.
    const found: Choice[] = (query.trim() ? matching(items, query) : items.filter((i) => !(i.choice.kind === "project" && i.choice.task))).map((i) => i.choice);
    const running = props.projects.find((p) => p.id === runningProjectId);
    // While something runs, an empty search offers to pause it first.
    if (running && !query.trim()) found.unshift({ kind: "pause", label: `Pause ${running.name}` });
    return found;
  }, [props.projects, props.tasks, runningProjectId, query]);
  const index = Math.min(chosen, Math.max(0, choices.length - 1));

  useEffect(() => input.current?.focus(), []);

  const choose = (choice: Choice | undefined) => {
    if (!choice || props.busy) return;
    if (choice.kind === "pause") props.onPause();
    else if (choice.project.id !== runningProjectId || (choice.task && choice.task.id !== props.running?.taskId)) props.onStart(choice.project.id, note, choice.task?.id);
    // The project that already runs carries on; a note given replaces its note.
    else if (note) props.onNote(note);
    props.onClose();
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setChosen((index + step + choices.length) % Math.max(1, choices.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(choices[index]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    }
  };

  return (
    <div className="switcher-backdrop" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="switcher" role="dialog" aria-modal="true" aria-label="Start a project">
        <input
          ref={input}
          className="switcher-input"
          value={text}
          placeholder="Start a project…   (add a note after a colon)"
          aria-label="Project to start"
          aria-controls="switcher-list"
          aria-activedescendant={choices.length ? `switcher-${index}` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            setChosen(0);
          }}
          onKeyDown={keys}
        />
        <ul className="switcher-list" id="switcher-list" role="listbox">
          {choices.length === 0 ? <li className="switcher-empty">No project matches “{query.trim()}”.</li> : null}
          {choices.map((choice, i) => (
            <li
              key={choice.kind === "pause" ? "pause" : `${choice.project.id}/${choice.task?.id ?? ""}`}
              id={`switcher-${i}`}
              role="option"
              aria-selected={i === index}
              className={`switcher-item${i === index ? " is-chosen" : ""}`}
              data-color={choice.kind === "project" ? choice.project.color : undefined}
              onMouseEnter={() => setChosen(i)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(choice);
              }}
            >
              {choice.kind === "pause" ? (
                <>
                  <span className="pause-bars" aria-hidden="true" /> {choice.label}
                </>
              ) : (
                <>
                  <span className="swatch" />
                  <span className="switcher-name">
                    {choice.project.name}
                    {choice.task ? <span className="switcher-task"> › {choice.task.name}</span> : null}
                  </span>
                  {choice.project.id === runningProjectId && (choice.task?.id ?? null) === (props.running?.taskId ?? null) ? <small>Running</small> : null}
                  {note && i === index ? <small className="switcher-note">“{note}”</small> : null}
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="switcher-help">
          <kbd>↑</kbd> <kbd>↓</kbd> to choose, <kbd>Enter</kbd> to start, <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}
