import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AuthForm, NewPasswordForm, type AuthMode } from '../components/AuthForm';
import { Glyph, type GlyphName } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { readSession, useSignedIn } from '../lib/account';
import { arrival, claimInBackground } from '../lib/arrive';
import { copy } from '../lib/copy';
import { useSignInOpen } from '../lib/sign-in';

// The account pages (docs/specs/accounts.md): /sign-in, /sign-up, /forgot-password and
// /reset-password. The plate names the page; under it the form, and on sign-in and sign-up what a
// profile keeps beside it. A player already signed in goes to their desk. After a password sign-in
// the player goes where they were headed (a seed to save, a card to follow, the page they left),
// else to their desk, which claims their guest contributions.

const words = copy.auth;

function Why() {
  return (
    <aside className="auth-why" aria-labelledby="auth-why-title">
      <h2 id="auth-why-title">{words.whyTitle}</h2>
      <ul className="auth-why-list">
        {words.why.map((item) => (
          <li key={item.line}>
            <Glyph name={item.glyph as GlyphName} />
            <span>{item.line}</span>
          </li>
        ))}
      </ul>
      <p className="small muted">{words.whyNote}</p>
    </aside>
  );
}

/** After a password sign-in: the waiting seed, card or page, else the desk (which claims). */
export function useArrive(): () => void {
  const navigate = useNavigate();
  return () => {
    const next = arrival();
    if (next.to === 'page') {
      claimInBackground();
      navigate(next.path, { replace: true });
    } else {
      navigate('/me', { replace: true, state: { arrived: true } });
    }
  };
}

function AuthPage({ mode }: { mode: AuthMode }) {
  // Signed in when the page opened: nothing to do here. A sign-in on this page navigates itself.
  const [already] = useState(() => readSession() !== null);
  const open = useSignInOpen();
  const arrive = useArrive();
  if (already) return <Navigate to="/me" replace />;
  const title = mode === 'sign-in' ? words.signInTitle : mode === 'sign-up' ? words.signUpTitle : words.forgotTitle;
  const lede = mode === 'sign-in' ? words.signInLede : mode === 'sign-up' ? words.signUpLede : words.forgotLede;
  return (
    <main className="wide auth-page">
      <div className="band">
        <PageHeader title={title} lede={lede} />
      </div>
      <div className="band">
        <div className="auth-layout" data-aside={mode === 'forgot' ? undefined : ''}>
          <div className="auth-panel">
            {mode === 'sign-up' && !open ? (
              <div className="auth-problem" role="status">
                <p>{words.signUpClosed}</p>
                <p>
                  <Link to="/sign-in">{words.toSignInLink}</Link>
                </p>
              </div>
            ) : (
              <AuthForm mode={mode} routed onSignedIn={arrive} />
            )}
          </div>
          {mode === 'forgot' ? null : <Why />}
        </div>
      </div>
    </main>
  );
}

export function SignInPage() {
  return <AuthPage mode="sign-in" />;
}

export function SignUpPage() {
  return <AuthPage mode="sign-up" />;
}

export function ForgotPasswordPage() {
  return <AuthPage mode="forgot" />;
}

/** /reset-password: /me sends a reset link's player here, signed in, to choose a new password. */
export function ResetPasswordPage() {
  const signedIn = useSignedIn();
  const [done, setDone] = useState(false);
  return (
    <main className="wide auth-page">
      <div className="band">
        <PageHeader title={words.resetTitle} lede={words.resetLede} />
      </div>
      <div className="band">
        <div className="auth-layout">
          <div className="auth-panel">
            {done ? (
              <div className="auth-sent" role="status">
                <p className="auth-sent-title">
                  <Glyph name="check" />
                  <span>{words.resetDone}</span>
                </p>
                <p>
                  <Link className="button" to="/me">
                    {words.toDesk}
                  </Link>
                </p>
              </div>
            ) : signedIn ? (
              <NewPasswordForm onDone={() => setDone(true)} />
            ) : (
              <div className="auth-problem" role="status">
                <p>{words.resetExpired}</p>
                <p>
                  <Link to="/forgot-password">{words.sendReset}</Link>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
