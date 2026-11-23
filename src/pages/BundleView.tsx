import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBundle } from '../app/BundleContext';
import { Callout, ErrorState, InfoTip, Loading, Notice } from '../components/ui';
import {
  coverage,
  defaultColumns,
  formatValue,
  groupColumns,
  MISSING,
  searchRecords,
  sortRecords,
  type BundleColumn,
  type LoadedBundle,
  type SortState,
} from '../lib/bundle';
import { shortDate } from '../lib/format';
import { G } from '../lib/guardrails';

const PAGE_SIZE = 50;

export function BundleClosed() {
  return (
    <div className="wrap page">
      <h1>No bundle is open</h1>
      <p>A bundle opened from your computer is kept only until the page is reloaded. Open it again to continue.</p>
      <Link className="btn" to="/bundles">
        Go to Bundles
      </Link>
    </div>
  );
}

/** What a reader must know before reading the numbers: one visible sentence; the fixed texts of the Studio and the notices of the bundle folded under it. */
export function BundleNotices({ bundle }: { bundle: LoadedBundle }) {
  const groups = new Set(bundle.manifest.columns.map((c) => c.group));
  const own: string[] = [];
  if (groups.has('describe.xtb')) own.push(G.xtbProxy);
  if (groups.has('score')) own.push(G.scoreComponents);
  own.push(G.noConductivity);
  return (
    <Notice lead={G.bundleLead} more="What the values mean">
      <ul>
        {own.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {bundle.manifest.notices.length > 0 ? (
        <>
          <p className="small">Notices stored in the bundle:</p>
          <ul className="small">
            {bundle.manifest.notices.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      ) : null}
    </Notice>
  );
}

function label(column: BundleColumn): string {
  return column.unit ? `${column.name} (${column.unit})` : column.name;
}

/** Data of other people that the numbers rest on, with licence and citation as the manifest gives them. */
export function ThirdParty({ bundle }: { bundle: LoadedBundle }) {
  const list = bundle.manifest.third_party;
  if (list.length === 0) return null;
  return (
    <section className="section" aria-labelledby="third-h">
      <h2 id="third-h" className="h3">
        Data from others used in this bundle
      </h2>
      <ul className="prov-list small">
        {list.map((t) => (
          <li key={`${t.source}${t.used_for}`}>
            <strong>{t.source ?? 'Source not named'}</strong>
            {t.licence ? ` (${t.licence})` : ''}
            {t.used_for ? `. Used for: ${t.used_for}` : ''}
            {t.cite ? `. Cite: ${t.cite}` : ''}.
          </li>
        ))}
      </ul>
    </section>
  );
}

function Provenance({ bundle }: { bundle: LoadedBundle }) {
  const m = bundle.manifest;
  return (
    <details className="disclosure">
      <summary>Where this bundle comes from</summary>
      <dl className="kv-grid">
        <div className="kv">
          <dt>Project</dt>
          <dd>{m.project}</dd>
        </div>
        <div className="kv">
          <dt>Written by</dt>
          <dd>
            mofsift {m.mofsift_version} on {shortDate(m.created_utc)}
          </dd>
        </div>
        <div className="kv">
          <dt>Config hash</dt>
          <dd>{m.config_hash ? <code>{m.config_hash.slice(0, 16)}…</code> : MISSING}</dd>
        </div>
        <div className="kv">
          <dt>Tools</dt>
          <dd>
            {Object.entries(m.tools)
              .filter(([, v]) => v)
              .map(([k, v]) => `${k} ${v}`)
              .join(', ') || MISSING}
          </dd>
        </div>
      </dl>
      {m.stages.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table compact">
            <caption className="sr-only">Rows per status, for each stage of the run</caption>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col" className="num">ok</th>
                <th scope="col" className="num">skipped</th>
                <th scope="col" className="num">failed</th>
              </tr>
            </thead>
            <tbody>
              {m.stages.map((s) => (
                <tr key={s.stage}>
                  <th scope="row">{s.stage}</th>
                  {(['ok', 'skipped', 'failed'] as const).map((k) => (
                    <td key={k} className="num">
                      {typeof s.status_counts?.[k] === 'number' ? s.status_counts[k] : MISSING}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {m.sources.length > 0 ? (
        <p className="small">
          Merged from {m.sources.length} bundles: {m.sources.map((s) => `${s.project} (${s.selected} records, mofsift ${s.mofsift_version})`).join('; ')}.
        </p>
      ) : null}
      {m.config ? (
        <details className="disclosure">
          <summary>Config of the run</summary>
          <pre className="code-block">
            <code>{JSON.stringify(m.config, null, 2)}</code>
          </pre>
        </details>
      ) : null}
    </details>
  );
}

export default function BundleView() {
  const { key } = useParams();
  const state = useBundle(key);
  const project = state.status === 'ready' ? state.bundle.manifest.project : null;
  useEffect(() => {
    document.title = `${project ? `${project} · ` : ''}Bundles · MOF Discovery Studio`;
  }, [project]);
  if (state.status === 'loading') return <Loading what="bundle" />;
  if (state.status === 'closed') return <BundleClosed />;
  if (state.status === 'error') {
    return (
      <div className="wrap page">
        <h1>This bundle cannot be shown</h1>
        <ErrorState message={state.message} />
        <Link className="btn" to="/bundles">
          Go to Bundles
        </Link>
      </div>
    );
  }
  // A new bundle (another one, or the same folder opened again) starts with its own columns and no sort.
  return <BundleBody key={`${state.bundle.key}:${state.bundle.manifest.created_utc}:${state.bundle.manifest.records?.sha256}`} bundle={state.bundle} />;
}

function BundleBody({ bundle }: { bundle: LoadedBundle }) {
  const columns = bundle.manifest.columns;
  const [shown, setShown] = useState<string[]>(() => defaultColumns(columns));
  const [sort, setSort] = useState<SortState | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const groups = useMemo(() => groupColumns(columns), [columns]);
  const filled = useMemo(() => coverage(bundle.records, columns), [bundle, columns]);
  const rows = useMemo(() => sortRecords(searchRecords(bundle.records, query, columns), sort), [bundle, query, columns, sort]);

  const m = bundle.manifest;
  const nameColumn = columns.find((c) => c.name === 'name' && c.type === 'string');
  const first = nameColumn ?? columns[0];
  const visible = columns.filter((c) => shown.includes(c.name) && c !== first);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const base = `/bundles/${encodeURIComponent(bundle.key)}`;
  const tableUrl = bundle.fileUrl(m.table.path);
  const toggle = (name: string) => setShown((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));
  const sortBy = (column: string) => {
    setSort((s) => (s?.column === column ? (s.dir === 'asc' ? { column, dir: 'desc' } : null) : { column, dir: 'asc' }));
    setPage(0);
  };
  const header = (column: BundleColumn, text: string) => {
    const active = sort?.column === column.name;
    const numeric = column.type === 'number' || column.type === 'integer';
    return (
      <th key={column.name} scope="col" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={numeric ? 'num' : undefined}>
        <button type="button" className="th-btn" onClick={() => sortBy(column.name)} title={column.description ?? undefined}>
          {text}
          <span className="sort-ind" aria-hidden="true">
            {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="wrap page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/bundles">Bundles</Link> / {m.project}
      </nav>
      <header className="page-head">
        <h1>{m.project}</h1>
        <p className="lede-sm">
          {bundle.origin === 'local' ? (
            <>
              Opened from your computer (folder <code>{bundle.label}</code>). {G.bundleLocal}
            </>
          ) : (
            bundle.label
          )}
        </p>
      </header>

      <div className="stats" role="list">
        <div className="stat" role="listitem">
          <span className="stat-n">{m.counts.selected}</span>
          <span className="stat-l">records in the bundle</span>
        </div>
        <div className="stat" role="listitem">
          <span className="stat-n">{m.counts.enumerated ?? MISSING}</span>
          <span className="stat-l">candidates before the filters</span>
        </div>
        <div className="stat" role="listitem">
          <span className="stat-n">{m.counts.structures}</span>
          <span className="stat-l">with a structure file</span>
        </div>
        <div className="stat" role="listitem">
          <span className="stat-n">{columns.length - 1}</span>
          <span className="stat-l">columns</span>
        </div>
      </div>
      <p className="check-line ok small">
        ✓ candidates.json matches the checksum in the manifest <InfoTip text={G.bundleChecksum} label="About checksums" />
      </p>

      <BundleNotices bundle={bundle} />
      {m.warnings.length > 0 ? (
        <Callout kind="warn" title="Warnings recorded when the bundle was exported">
          <ul>
            {m.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <section className="section" aria-labelledby="filters-h">
        <h2 id="filters-h" className="h3">
          Filters that selected these records
        </h2>
        {m.filters.length === 0 ? (
          <p className="muted">{m.sources.length > 0 ? 'This bundle was merged from others; each source had its own filters.' : 'None: every candidate of the run is in the bundle.'}</p>
        ) : (
          <ul className="prov-list">
            {m.filters.map((f) => (
              <li key={f.expression}>
                <code>{f.expression}</code>
                {f.passed !== null ? (
                  <>
                    : true for {f.passed}, false for {f.rejected}
                    {f.undecided ? `, undecided for ${f.undecided} (a value was missing)` : ''}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="table-h">
        <h2 id="table-h" className="h3">
          Records
        </h2>
        <div className="results-bar">
          <label className="field inline">
            <span>Search</span>
            <input
              type="search"
              placeholder="Name, formula, topology, metal…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <p className="results-count" aria-live="polite">
            <strong>{rows.length}</strong> of {bundle.records.length} records
          </p>
          <div className="results-actions">
            {tableUrl ? (
              <a className="btn btn-sm btn-ghost" href={tableUrl} download>
                Download the table ({m.table.format})
              </a>
            ) : null}
          </div>
        </div>

        <details className="disclosure colpicker">
          <summary>
            Columns ({visible.length + (nameColumn ? 1 : 0)} of {columns.length - 1} shown)
          </summary>
          <p className="small muted">
            {G.bundleMissing} Columns no record has a value for are marked <em>empty</em>.
          </p>
          <div className="colpicker-groups">
            {groups.map((g) => (
              <fieldset key={g.key}>
                <legend>{g.label}</legend>
                {g.columns.map((c) => (
                  <label key={c.name} className="check small" title={c.description ?? undefined}>
                    <input type="checkbox" checked={c === first || shown.includes(c.name)} disabled={c === first} onChange={() => toggle(c.name)} /> <span>{label(c)}</span>
                    {filled[c.name] === 0 ? <em className="muted"> empty</em> : null}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <button type="button" className="link-btn" onClick={() => setShown(defaultColumns(columns))}>
            Back to the usual columns
          </button>
        </details>

        {rows.length === 0 ? (
          <div className="empty">
            <h3>No record matches</h3>
            <p>{bundle.records.length === 0 ? 'The filters of the run left no candidate in this bundle.' : 'No record contains every word of the search.'}</p>
          </div>
        ) : (
          <>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Records of the bundle (scrolls horizontally)">
              <table className="data-table bundle-table">
                <caption className="sr-only">Records of the bundle; click a column header to sort.</caption>
                <thead>
                  <tr>
                    {header(first, 'Record')}
                    {visible.map((c) => header(c, label(c)))}
                  </tr>
                </thead>
                <tbody>
                  {slice.map((r) => (
                    <tr key={r.id}>
                      <th scope="row" className="col-name">
                        <Link to={`${base}/${encodeURIComponent(r.id)}`}>{nameColumn && typeof r.name === 'string' ? r.name : r.id}</Link>
                        {nameColumn && typeof r.name === 'string' ? <span className="record-id">{r.id}</span> : null}
                      </th>
                      {visible.map((c) => {
                        const v = r[c.name];
                        const missing = v === null || v === undefined;
                        return (
                          <td key={c.name} className={c.type === 'number' || c.type === 'integer' ? 'num' : undefined}>
                            {missing ? (
                              <span className="missing" title="Not computed">
                                {MISSING}
                                <span className="sr-only"> not computed</span>
                              </span>
                            ) : (
                              formatValue(c, v)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 ? (
              <div className="pager" role="navigation" aria-label="Pages of records">
                <button type="button" className="btn btn-sm btn-ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>
                  Previous
                </button>
                <span className="small">
                  Records {current * PAGE_SIZE + 1}–{Math.min(rows.length, (current + 1) * PAGE_SIZE)} of {rows.length}
                </span>
                <button type="button" className="btn btn-sm btn-ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                  Next
                </button>
              </div>
            ) : null}
            <details className="disclosure">
              <summary>What the shown columns mean</summary>
              <dl className="column-meanings">
                {[first, ...visible].map((c) => (
                  <div key={c.name}>
                    <dt>
                      <code>{c.name}</code>
                      {c.unit ? <span className="unit"> {c.unit}</span> : null}
                    </dt>
                    <dd>{c.description ?? 'Not described in the manifest.'}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        )}
      </section>

      <ThirdParty bundle={bundle} />
      <Provenance bundle={bundle} />
    </div>
  );
}
