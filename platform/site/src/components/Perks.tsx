import { Link } from 'react-router-dom';
import { legal } from '../lib/legal';
import { useSignInOpen } from '../lib/sign-in';

// What a contribution gets you (docs/specs/place.md): the perks that exist today, as a guest and with
// a free profile, said where people decide to pay (/contribute, which home and a card's page link to)
// and once they have (/me, and /thanks as Keep this card). Kernel, so /contribute and /thanks may draw
// it: it imports only legal.ts (its words, kernel too, so no card can change what paying is said to
// get), the sign-in probe and the router. XP is a record of taking part and never money; paying never
// needs an account. While sign-in is closed the panel keeps to the guest side and Keep this card hides,
// so nothing points at a form that cannot work.

export function Perks() {
  const words = legal.perks;
  const open = useSignInOpen();
  return (
    <section className="perks" aria-labelledby="perks-title" data-sign-in={open ? 'open' : 'closed'}>
      <h3 id="perks-title" className="perks-title">
        {words.title}
      </h3>
      <div className="perks-columns">
        <div className="perks-column">
          <p className="perks-label">{words.guestTitle}</p>
          <ul className="perks-list">
            {words.guest.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        {open ? (
          <div className="perks-column" data-perks="profile">
            <p className="perks-label">{words.profileTitle}</p>
            <ul className="perks-list">
              {words.profile.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="small perks-note">{open ? words.note : words.noteClosed}</p>
    </section>
  );
}

/** /thanks, once a payment is recorded: keep the card by signing in with the receipt's email. */
export function KeepThisCard() {
  const words = legal.perks;
  if (!useSignInOpen()) return null;
  return (
    <section className="perks perks-keep" aria-labelledby="keep-title">
      <h3 id="keep-title" className="perks-title">
        {words.keepTitle}
      </h3>
      <p>{words.keepBody}</p>
      <ul className="perks-list">
        {words.profile.slice(0, 3).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p>
        <Link className="button button-secondary" to="/me?keep=1">
          {words.keep}
        </Link>
      </p>
    </section>
  );
}
