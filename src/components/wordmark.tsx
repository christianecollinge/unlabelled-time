/** The Unlabelled mark and wordmark as unlabelled.cc shows them, with this tool's name after it. */
export function Wordmark() {
  return (
    <span className="wordmark" aria-label="Unlabelled Time">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="brand-icon" src="/unlabelled-icon.png" alt="" width="30" height="30" />
      <span className="brand-wordmark" aria-hidden="true">
        UNLABELLED <em>TIME</em>
        <span className="brand-dot">.</span>
      </span>
    </span>
  );
}
