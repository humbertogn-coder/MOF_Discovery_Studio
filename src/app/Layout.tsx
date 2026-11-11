import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useCompare } from './CompareContext';
import { useData } from './DataContext';
import { shortDate } from '../lib/format';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/explore', label: 'Explorer' },
  { to: '/compare', label: 'Compare' },
  { to: '/active-learning', label: 'Active learning' },
  { to: '/methods', label: 'Methods & data' },
];

export default function Layout() {
  const { manifest } = useData();
  const compare = useCompare();
  const loc = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  useEffect(() => {
    const titles: Record<string, string> = { '/': 'Overview', '/explore': 'Explorer', '/compare': 'Compare', '/active-learning': 'Active learning', '/methods': 'Methods & data' };
    const t = titles[loc.pathname];
    if (t) document.title = `${t} · MOF Discovery Studio`;
  }, [loc.pathname]);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="wrap header-inner">
          <Link to="/" className="brand" aria-label="MOF Discovery Studio, home">
            <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#132b45" />
              <g stroke="#2dd4bf" strokeWidth="2" fill="none">
                <path d="M9 9h14v14H9z" />
                <path d="M9 9l5-4h14l-5 4M23 23l5-4V5" />
              </g>
              <g fill="#e6fffb">
                <circle cx="9" cy="9" r="2.4" />
                <circle cx="23" cy="9" r="2.4" />
                <circle cx="9" cy="23" r="2.4" />
                <circle cx="23" cy="23" r="2.4" />
              </g>
            </svg>
            <span>
              <span className="brand-name">MOF Discovery Studio</span>
              <span className="brand-sub">Low-band-gap 3D MOF candidates</span>
            </span>
          </Link>
          <button type="button" className="menu-btn" aria-expanded={menuOpen} aria-controls="site-nav" onClick={() => setMenuOpen((o) => !o)}>
            <span className="sr-only">Menu</span>
            <span aria-hidden="true">☰</span>
          </button>
          <nav id="site-nav" className={`site-nav ${menuOpen ? 'open' : ''}`} aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
                {n.to === '/compare' && compare.ids.length > 0 ? <span className="pill" aria-label={`${compare.ids.length} selected`}>{compare.ids.length}</span> : null}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="wrap footer-inner">
          <div>
            <strong>MOF Discovery Studio</strong> v{manifest?.app_release ?? '0.1.0'} — an exploration interface for the data of{' '}
            <a href="https://github.com/humbertogn-coder/MOF_3D_Generator" rel="noopener noreferrer" target="_blank">
              MOF_3D_Generator
            </a>
            . All frameworks are hypothetical. Predicted band gaps are not measurements.
          </div>
          {manifest ? (
            <div className="small muted">
              Data snapshot <code>{manifest.source_commit_hash.slice(0, 7)}</code> ({shortDate(manifest.source_commit_date)}), prediction iteration {manifest.source_iteration}, exported {shortDate(manifest.export_timestamp_utc)}. Data {manifest.licenses_and_attributions.source_data}; code {manifest.licenses_and_attributions.source_code}. <Link to="/methods#citation">How to cite</Link>
            </div>
          ) : null}
        </div>
      </footer>
    </>
  );
}
