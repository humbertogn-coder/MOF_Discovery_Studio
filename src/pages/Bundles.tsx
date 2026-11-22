import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBundleStore } from '../app/BundleContext';
import { Callout, ErrorState } from '../components/ui';
import type { LocalFile } from '../lib/bundle';
import { filesFromDrop, filesFromInput, loadSiteIndex, openLocalBundle, type SiteBundleEntry } from '../lib/bundleSource';
import { G } from '../lib/guardrails';

// React does not know this attribute, which turns a file input into a folder picker.
const FOLDER_PICKER = { webkitdirectory: '' } as Record<string, string>;

export default function Bundles() {
  const store = useBundleStore();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState<SiteBundleEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const local = store.get('local');

  useEffect(() => {
    let alive = true;
    loadSiteIndex()
      .then((list) => alive && setIndex(list))
      .catch(() => alive && setIndex([]));
    return () => {
      alive = false;
    };
  }, []);

  const open = async (files: LocalFile[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      store.put(await openLocalBundle(files));
      navigate('/bundles/local');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    try {
      await open(await filesFromDrop(e.dataTransfer));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="wrap page">
      <header className="page-head">
        <h1>Bundles</h1>
        <p className="lede-sm">
          Look at the result of any{' '}
          <a href="https://github.com/humbertogn-coder/mofsift" rel="noopener noreferrer" target="_blank">
            mofsift
          </a>{' '}
          run: the table of candidates, what every column means, and the 3D structures. This section is separate from the study shown on the other pages.
        </p>
      </header>
      <Callout kind="note">{G.bundle}</Callout>

      <section className="section" aria-labelledby="open-h">
        <h2 id="open-h">Open a bundle from your computer</h2>
        <p>
          Choose the folder that <code>mofsift export</code> wrote. It holds <code>manifest.json</code>, <code>candidates.json</code> and a <code>structures</code> folder.
        </p>
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <p>
            <strong>Drop the bundle folder here</strong>, or
          </p>
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? 'Reading…' : 'Choose a folder'}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            aria-label="Bundle folder"
            data-testid="bundle-folder"
            {...FOLDER_PICKER}
            onChange={(e) => {
              const files = filesFromInput(e.target.files ?? []);
              e.target.value = '';
              void open(files);
            }}
          />
          <p className="small muted">{G.bundleLocal} Choosing a folder needs a desktop browser.</p>
        </div>
        {error ? <ErrorState message={error} /> : null}
        {local ? (
          <p>
            Open now: <Link to="/bundles/local">{local.manifest.project}</Link> ({local.records.length} records, from the folder <code>{local.label}</code>).
          </p>
        ) : null}
      </section>

      <section className="section" aria-labelledby="site-h">
        <h2 id="site-h">Bundles on this site</h2>
        {index === null ? (
          <p className="muted">Loading the list…</p>
        ) : index.length === 0 ? (
          <p className="muted">This site does not include any bundle.</p>
        ) : (
          <ul className="bundle-cards">
            {index.map((b) => (
              <li key={b.id} className="card">
                <h3>
                  <Link to={`/bundles/${encodeURIComponent(b.id)}`}>{b.title}</Link>
                </h3>
                <p className="small">{b.description}</p>
                <Link className="btn btn-sm" to={`/bundles/${encodeURIComponent(b.id)}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="make-h">
        <h2 id="make-h">Make your own</h2>
        <p>
          A bundle is written by the last stage of mofsift. With a config file <code>mofsift.yaml</code>:
        </p>
        <pre className="code-block">
          <code>{'mofsift run mofsift.yaml          # generate, check, describe, score, filter, export\nmofsift validate export/<project> # check the bundle\n'}</code>
        </pre>
        <p className="small muted">
          The format is described in{' '}
          <a href="https://github.com/humbertogn-coder/mofsift/blob/main/docs/export.md" rel="noopener noreferrer" target="_blank">
            docs/export.md
          </a>{' '}
          of mofsift. This viewer reads bundles of schema version 1.
        </p>
      </section>
    </div>
  );
}
