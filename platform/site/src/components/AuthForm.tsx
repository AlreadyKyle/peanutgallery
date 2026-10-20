import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  PASSWORD_MIN,
  PROVIDERS,
  providerUrl,
  resendConfirmation,
  sendMagicLink,
  sendPasswordReset,
  setNewPassword,
  signInWithPassword,
  signUp,
  type Provider,
} from '../lib/account';
import { CommunityError } from '../lib/community';
import { copy } from '../lib/copy';
import { useSignInProviders } from '../lib/sign-in';
import { Glyph } from './Glyph';
import { ProviderIcon } from './ProviderIcon';

// The sign-in form (docs/specs/accounts.md): sign in, create an account and reset a password, the
// way any site does it. Continue with a provider (only the ones switched on in Supabase Auth), or an
// email and a password; a one-time sign-in link stays as the quiet second way. The same form sits on
// /sign-in, /sign-up and /forgot-password (routed: switching mode moves to that page) and wherever a
// page asks a visitor to sign in (Follow, a seed's save, the desk), where it switches in place.

const words = copy.auth;

export type AuthMode = 'sign-in' | 'sign-up' | 'forgot';

const PATHS: Record<AuthMode, string> = { 'sign-in': '/sign-in', 'sign-up': '/sign-up', forgot: '/forgot-password' };

type Sent = { kind: 'confirm' | 'reset' | 'link'; email: string };

type Problem = 'wrong' | 'unconfirmed' | 'weak' | 'exists' | 'limit' | 'closed' | 'failed' | 'same';
type ResetProblem = Problem | 'expired';

function problemOf(error: unknown): Problem {
  if (!(error instanceof CommunityError)) return 'failed';
  if (error.status === 429) return 'limit';
  const code = error.code;
  return code === 'wrong' || code === 'unconfirmed' || code === 'weak' || code === 'exists' || code === 'closed' || code === 'same' ? code : 'failed';
}

/** A password field with a Show button, so a player can check what they typed. */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  aside,
  invalid,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  aside?: ReactNode;
  invalid?: boolean;
  /** The id of the form's error line, while it shows one: read out with the field. */
  describedBy?: string;
}) {
  const id = useId();
  const described = [hint === undefined ? null : `${id}-hint`, describedBy ?? null].filter((part) => part !== null).join(' ');
  const [shown, setShown] = useState(false);
  return (
    <div className="auth-field">
      <div className="auth-label-row">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      <div className="password-field">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={autoComplete === 'new-password' ? PASSWORD_MIN : undefined}
          value={value}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={described === '' ? undefined : described}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <button type="button" className="password-toggle" aria-label={shown ? words.hideLabel : words.showLabel} onClick={() => setShown((was) => !was)}>
          {shown ? words.hide : words.show}
        </button>
      </div>
      {hint === undefined ? null : (
        <p className="small muted" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function ProviderButtons({ providers, onLeave }: { providers: readonly Provider[]; onLeave?: () => void }) {
  return (
    <div className="auth-providers">
      {providers.map((provider) => (
        <a key={provider} className="button button-secondary button-block auth-provider" href={providerUrl(provider)} onClick={() => onLeave?.()} data-provider={provider}>
          <ProviderIcon provider={provider} />
          <span>{words.continueWith.replace('{provider}', words.providerNames[provider])}</span>
        </a>
      ))}
    </div>
  );
}

function CheckEmail({ sent, onBack }: { sent: Sent; onBack: () => void }) {
  const [again, setAgain] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const resend = () => {
    setAgain('sending');
    const send = sent.kind === 'confirm' ? resendConfirmation : sent.kind === 'reset' ? sendPasswordReset : sendMagicLink;
    send(sent.email)
      .then(() => setAgain('sent'))
      .catch(() => setAgain('error'));
  };
  const line = sent.kind === 'confirm' ? words.confirmSent : sent.kind === 'reset' ? words.resetSent : words.linkSent;
  return (
    <div className="auth-sent" role="status">
      <p className="auth-sent-title">
        <Glyph name="check" />
        <span>{words.checkTitle}</span>
      </p>
      <p>
        {line.split('{email}')[0]}
        <strong>{sent.email}</strong>
        {line.split('{email}')[1]}
      </p>
      <p className="small muted">{words.spam}</p>
      <p className="auth-sent-actions">
        <button type="button" className="button button-secondary" disabled={again === 'sending'} onClick={resend}>
          {again === 'sending' ? words.working : words.resend}
        </button>
        <button type="button" className="text-button" onClick={onBack}>
          {words.useOther}
        </button>
      </p>
      {again === 'sent' ? <p className="small">{words.resent}</p> : again === 'error' ? <p className="small">{words.limit}</p> : null}
    </div>
  );
}

export function AuthForm({
  mode: start = 'sign-in',
  routed = false,
  title,
  onSignedIn,
  onLeave,
  onFailed,
}: {
  mode?: AuthMode;
  /** On /sign-in, /sign-up and /forgot-password: switching mode is a link to that page. */
  routed?: boolean;
  /** A heading drawn inside the form (embedded use); the auth pages carry theirs in the plate. */
  title?: 'h2' | 'h3';
  /** After a password sign-in, or a sign-up that signs in at once. */
  onSignedIn?: () => void;
  /** As any way of signing in starts (a provider, a link, a password): keep what should happen after it. */
  onLeave?: () => void;
  /** When a way of signing in failed: drop what onLeave kept. */
  onFailed?: () => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<AuthMode>(start);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'submit' | 'link' | 'confirm' | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const providers = useSignInProviders().filter((name): name is Provider => (PROVIDERS as readonly string[]).includes(name));

  useEffect(() => setMode(start), [start]);
  useEffect(() => {
    setProblem(null);
    setSent(null);
  }, [mode]);

  const fail = (error: unknown) => {
    onFailed?.();
    setBusy(null);
    setProblem(problemOf(error));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    setProblem(null);
    setBusy('submit');
    if (mode !== 'forgot') onLeave?.();
    if (mode === 'sign-in') {
      signInWithPassword(address, password)
        .then(() => {
          setBusy(null);
          onSignedIn?.();
        })
        .catch(fail);
    } else if (mode === 'sign-up') {
      signUp(address, password)
        .then((result) => {
          setBusy(null);
          if (result === 'signed-in') onSignedIn?.();
          else setSent({ kind: 'confirm', email: address });
        })
        .catch(fail);
    } else {
      sendPasswordReset(address)
        .then(() => {
          setBusy(null);
          setSent({ kind: 'reset', email: address });
        })
        .catch(fail);
    }
  };

  const emailLink = () => {
    const input = emailRef.current;
    if (input !== null && !input.reportValidity()) return;
    const address = email.trim();
    setProblem(null);
    setBusy('link');
    onLeave?.();
    sendMagicLink(address)
      .then(() => {
        setBusy(null);
        setSent({ kind: 'link', email: address });
      })
      .catch(fail);
  };

  const confirmAgain = () => {
    setBusy('confirm');
    resendConfirmation(email.trim())
      .then(() => {
        setBusy(null);
        setSent({ kind: 'confirm', email: email.trim() });
      })
      .catch(fail);
  };

  const switchTo = (next: AuthMode, label: string) =>
    routed ? (
      <Link to={PATHS[next]}>{label}</Link>
    ) : (
      <button type="button" className="text-button" onClick={() => setMode(next)}>
        {label}
      </button>
    );

  const Heading = title;
  const heading = mode === 'sign-in' ? words.signInTitle : mode === 'sign-up' ? words.signUpTitle : words.forgotTitle;
  const message = problem === null ? null : words[problem];
  // While the form shows a refusal, each field names it (aria-describedby), so moving back to a field
  // to fix it reads why it was refused.
  const problemId = message === null ? undefined : `${id}-problem`;
  const submitLabel =
    mode === 'sign-in'
      ? busy === 'submit'
        ? words.signingIn
        : words.signIn
      : mode === 'sign-up'
        ? busy === 'submit'
          ? words.signingUp
          : words.signUp
        : busy === 'submit'
          ? words.working
          : words.sendReset;

  return (
    <div className="auth" data-auth-mode={mode}>
      {Heading === undefined ? null : (
        <Heading className="auth-title" id={`${id}-title`}>
          {heading}
        </Heading>
      )}
      {Heading === undefined || mode !== 'forgot' ? null : <p className="small muted">{words.forgotLede}</p>}
      {sent !== null ? (
        <CheckEmail sent={sent} onBack={() => setSent(null)} />
      ) : (
        <>
          {providers.length > 0 && mode !== 'forgot' ? (
            <>
              <ProviderButtons providers={providers} onLeave={onLeave} />
              <p className="auth-or" aria-hidden="true">
                <span>{words.or}</span>
              </p>
            </>
          ) : null}
          <form className="auth-form" onSubmit={submit} aria-labelledby={Heading === undefined ? undefined : `${id}-title`}>
            <div className="auth-field">
              <label htmlFor={`${id}-email`}>{words.email}</label>
              <input
                ref={emailRef}
                id={`${id}-email`}
                type="email"
                autoComplete={mode === 'sign-up' ? 'email' : 'username'}
                inputMode="email"
                required
                value={email}
                aria-describedby={problemId}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </div>
            {mode === 'forgot' ? null : (
              <PasswordField
                label={words.password}
                value={password}
                onChange={setPassword}
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                hint={mode === 'sign-up' ? words.passwordHint : undefined}
                invalid={problem === 'wrong' || problem === 'weak'}
                describedBy={problemId}
                aside={mode === 'sign-in' ? switchTo('forgot', words.forgot) : null}
              />
            )}
            {message === null ? null : (
              <div className="auth-problem" role="alert">
                <p id={problemId}>{message}</p>
                {problem === 'unconfirmed' ? (
                  <p>
                    <button type="button" className="text-button" disabled={busy !== null} onClick={confirmAgain}>
                      {words.sendConfirm}
                    </button>
                  </p>
                ) : problem === 'exists' ? (
                  <p>{switchTo('sign-in', words.toSignInLink)}</p>
                ) : null}
              </div>
            )}
            <button type="submit" className="button button-block" disabled={busy !== null}>
              {submitLabel}
            </button>
            {mode === 'sign-in' ? (
              <button type="button" className="button button-secondary button-block" disabled={busy !== null} onClick={emailLink}>
                {busy === 'link' ? words.working : words.magicLink}
              </button>
            ) : null}
          </form>
          <p className="auth-switch">
            {mode === 'sign-in' ? (
              <>
                <span>{words.toSignUp}</span> {switchTo('sign-up', words.toSignUpLink)}
              </>
            ) : mode === 'sign-up' ? (
              <>
                <span>{words.toSignIn}</span> {switchTo('sign-in', words.toSignInLink)}
              </>
            ) : (
              switchTo('sign-in', words.backToSignIn)
            )}
          </p>
        </>
      )}
    </div>
  );
}

/** /reset-password: the reset link signed the player in; they choose a new password here. */
export function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ResetProblem | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    setNewPassword(password)
      .then(() => {
        setBusy(false);
        onDone();
      })
      .catch((error: unknown) => {
        setBusy(false);
        // A reset link that ran out leaves no session to set the password with.
        setProblem(error instanceof CommunityError && error.status === 401 ? 'expired' : problemOf(error));
      });
  };
  return (
    <form className="auth-form" onSubmit={submit}>
      <PasswordField
        label={words.newPassword}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={words.passwordHint}
        invalid={problem === 'weak' || problem === 'same'}
        describedBy={problem === null ? undefined : `${id}-problem`}
      />
      {problem === null ? null : (
        <div className="auth-problem" role="alert">
          <p id={`${id}-problem`}>{problem === 'expired' ? words.resetExpired : words[problem]}</p>
          {problem === 'expired' ? (
            <p>
              <Link to="/forgot-password">{words.sendReset}</Link>
            </p>
          ) : null}
        </div>
      )}
      <button type="submit" className="button button-block" disabled={busy}>
        {busy ? words.working : words.savePassword}
      </button>
    </form>
  );
}
