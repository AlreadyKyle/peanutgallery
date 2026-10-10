import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent } from 'react';
import { enrolTotp, TOTP_CODE, twoFactorState, verifyTotp, type TotpEnrolment, type TwoFactorState } from './lib/board';
import { errorMessage } from './lib/supabase';

/** At the first factor nothing else renders: the panel opens once the authenticator code is in. */
export const SECOND_FACTOR_LINE = 'Enter the 6-digit code from your authenticator app to open the panel. Until then the page shows nothing else.';

/**
 * The second factor for a board member: enrol an authenticator app when the account has no verified
 * TOTP factor, otherwise verify a code from it. Reports aal2 through onVerified.
 */
export function TwoFactor({ client, onVerified }: { client: SupabaseClient; onVerified: (verified: boolean) => void }) {
  const [state, setState] = useState<TwoFactorState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    twoFactorState(client)
      .then((next) => {
        if (!live) return;
        setState(next);
        if (next.level === 'aal2') onVerified(true);
      })
      .catch((error: unknown) => {
        if (live) setLoadError(errorMessage(error));
      });
    return () => {
      live = false;
    };
  }, [client, onVerified]);

  async function startEnrolment() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      setEnrolment(await enrolTotp(client));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const factorId = enrolment?.factorId ?? state?.verifiedFactorId ?? null;

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (factorId === null) return;
    const entered = code.trim();
    if (!TOTP_CODE.test(entered)) {
      setMessage('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    try {
      await verifyTotp(client, factorId, entered);
      const next = await twoFactorState(client);
      if (next.level === 'aal2') {
        onVerified(true);
      } else {
        setState(next);
        setMessage('The code was accepted, but this session has no second factor. Sign out and sign in again.');
      }
    } catch (error) {
      setMessage(errorMessage(error));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  const codeForm =
    factorId === null ? null : (
      <form className="stack" onSubmit={verify} aria-label="Verify a code">
        <label>
          6-digit code
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <button type="submit" aria-disabled={busy}>
          Verify
        </button>
      </form>
    );

  return (
    <section aria-label="Two-factor sign-in">
      <h2>Two-factor sign-in</h2>
      <p>{SECOND_FACTOR_LINE}</p>
      {state === null ? <p role="status">{loadError === '' ? 'Checking two-factor sign-in.' : loadError}</p> : null}
      {state !== null && state.verifiedFactorId !== null ? <p>Enter the code your authenticator app shows for Mob Machine.</p> : null}
      {state !== null && state.verifiedFactorId === null && enrolment === null ? (
        <>
          <p>This account has no authenticator app yet.</p>
          <button type="button" aria-disabled={busy} onClick={() => void startEnrolment()}>
            Set up an authenticator app
          </button>
        </>
      ) : null}
      {enrolment === null ? null : (
        <>
          <p>Scan the QR code with an authenticator app, or type the secret into it. Then enter the code it shows.</p>
          <img className="qr" src={enrolment.qrCode} alt="QR code for your authenticator app" width={200} height={200} />
          <p>
            Secret: <code>{enrolment.secret}</code>
          </p>
        </>
      )}
      {codeForm}
      {message === '' ? null : <p role="status">{message}</p>}
    </section>
  );
}
