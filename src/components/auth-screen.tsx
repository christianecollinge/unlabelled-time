import { Wordmark } from "@/components/wordmark";

/**
 * Unlabelled Time's own sign-in screens (signed out, no access), in the look of the
 * sign-in page at login.unlabelled.cc (keycloak-theme/unlabelled in the emee repository), so the two
 * read as one place. Like that page, each load takes the next of the three
 * palettes; the choice is made by a small script before the screen is drawn.
 * Without it the screen shows the first palette.
 */
const PALETTE = `(function(){var p=["rose-sage","mint-wine","peony-plum"],k="time-signin-palette-next",i=0;try{var s=Number(localStorage.getItem(k));i=s>=0&&s<p.length&&s%1===0?s:0;localStorage.setItem(k,String((i+1)%p.length))}catch(e){}document.currentScript.parentElement.setAttribute("data-palette",p[i])})()`;

export function AuthScreen({ title, text, action }: { title: string; text?: string; action: { href: string; label: string } }) {
  return (
    <main className="auth-page" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: PALETTE }} />
      <header className="auth-head">
        <div className="brand">
          <Wordmark />
        </div>
      </header>
      <div className="auth-main">
        <div className="auth-copy">
          <p className="auth-eyebrow">✳&nbsp; A little less noise. A little more you.</p>
          <h1>
            {title}
            <span className="auth-dot">.</span>
          </h1>
          {text ? <p>{text}</p> : null}
        </div>
        <div className="auth-card">
          <a className="auth-button" href={action.href}>
            {action.label}
          </a>
          <p className="auth-card-note">With your Unlabelled account, at login.unlabelled.cc.</p>
        </div>
      </div>
      <div className="auth-note" aria-hidden="true">
        <span>✳</span>
        <div>
          A little more headspace.<small>That’s a good place to start.</small>
        </div>
      </div>
    </main>
  );
}
