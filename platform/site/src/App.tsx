import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { Board } from './pages/Board';
import { Landing } from './pages/Landing';
import { Ledger } from './pages/Ledger';

export function App() {
  return (
    <div className="page">
      <nav aria-label="Site">
        <NavLink to="/" end>
          Studio
        </NavLink>
        <NavLink to="/ledger">Ledger</NavLink>
        <NavLink to="/board">Board</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/board" element={<Board />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}

function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <p>There is no page at this address.</p>
      <p>
        <Link to="/">Studio</Link>
      </p>
    </main>
  );
}
