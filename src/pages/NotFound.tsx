import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="wrap page">
      <h1>Page not found</h1>
      <p>This address does not correspond to a page or a candidate in the current data release.</p>
      <p>
        <Link className="btn" to="/explore">
          Go to the Explorer
        </Link>
      </p>
    </div>
  );
}
