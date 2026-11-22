import { useEffect, useMemo, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useBundle } from '../app/BundleContext';
import StructureViewer from '../components/StructureViewer';
import { ErrorState, Formula, InfoTip, Loading } from '../components/ui';
import { defaultColumns, formatValue, groupColumns, isStatusColumn, MISSING, statusColumns, structurePath, type BundleColumn, type BundleRecord, type BundleValue, type ColumnGroup } from '../lib/bundle';
import { G } from '../lib/guardrails';
import { BundleClosed, BundleNotices } from './BundleView';

/** What a stage did for this record, read from its status columns; null when the bundle has none for the group. */
function stageStatus(record: BundleRecord, group: ColumnGroup): { status: string; reason: string | null } | null {
  const names = statusColumns(group.key);
  const status = record[names.status];
  if (typeof status !== 'string') return null;
  const reason = record[names.reason];
  return { status, reason: typeof reason === 'string' ? reason : null };
}

function anchor(group: ColumnGroup): string {
  return `g-${(group.key || 'other').replace(/[^A-Za-z0-9]+/g, '-')}`;
}

function Value({ column, value }: { column: BundleColumn; value: BundleValue | undefined }) {
  if (value === null || value === undefined) {
    return (
      <span className="missing" title="Not computed">
        {MISSING}
        <span className="sr-only"> not computed</span>
      </span>
    );
  }
  if (column.name === 'formula' || column.name === 'expected_formula') return <Formula f={String(value)} />;
  return (
    <>
      {formatValue(column, value)}
      {column.unit ? <span className="unit"> {column.unit}</span> : null}
    </>
  );
}

function Group({ record, group }: { record: BundleRecord; group: ColumnGroup }) {
  const state = stageStatus(record, group);
  const columns = group.columns.filter((c) => !isStatusColumn(c.name));
  if (columns.length === 0) return null;
  return (
    <section className="card group-card" id={anchor(group)} aria-label={group.label}>
      <div className="card-head">
        <h3>{group.label}</h3>
        {state ? <span className={`badge ${state.status === 'ok' ? 'badge-indomain' : 'badge-muted'}`}>{state.status === 'ok' ? 'computed' : state.status}</span> : null}
      </div>
      {state && state.status !== 'ok' ? (
        <p className="small">
          <strong>Not computed for this record:</strong> {state.reason ?? 'no reason was recorded'}.
        </p>
      ) : null}
      <table className="value-table">
        <caption className="sr-only">{group.label}: values of this record</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Column and its meaning</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name}>
              <th scope="row">
                <code>{c.name}</code>
                <span className="value-meaning">{c.description ?? 'Not described in the manifest.'}</span>
              </th>
              <td>
                <Value column={c} value={record[c.name]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function BundleRecordPage() {
  const { key, recordId } = useParams();
  const state = useBundle(key);
  const bundle = state.status === 'ready' ? state.bundle : null;
  const record = useMemo(() => bundle?.records.find((r) => r.id === recordId) ?? null, [bundle, recordId]);
  const groups = useMemo(() => groupColumns(bundle?.manifest.columns ?? []), [bundle]);
  useEffect(() => {
    document.title = `${record ? `${typeof record.name === 'string' ? record.name : record.id} · ` : ''}Bundles · MOF Discovery Studio`;
  }, [record]);

  if (state.status === 'loading') return <Loading what="bundle" />;
  if (state.status === 'closed') return <BundleClosed />;
  if (state.status === 'error' || !bundle) {
    return (
      <div className="wrap page">
        <h1>This bundle cannot be shown</h1>
        <ErrorState message={state.status === 'error' ? state.message : ''} />
        <Link className="btn" to="/bundles">
          Go to Bundles
        </Link>
      </div>
    );
  }
  const base = `/bundles/${encodeURIComponent(bundle.key)}`;
  if (!record) {
    return (
      <div className="wrap page">
        <h1>Record not found</h1>
        <p>
          The bundle <strong>{bundle.manifest.project}</strong> has no record with the id <code>{recordId}</code>.
        </p>
        <Link className="btn" to={base}>
          Back to the bundle
        </Link>
      </div>
    );
  }

  const cif = structurePath(record);
  const cifUrl = cif ? bundle.fileUrl(cif) : null;
  // mofsift has no relaxation stage: the file is the assembled structure, or the CIF the run was given.
  const structureLabel =
    record.source === 'pormake' ? 'Structure file of the bundle, as generated (not relaxed)' : record.source === 'cifs' ? 'Structure file of the bundle, as given to mofsift (not relaxed by it)' : 'Structure file of the bundle';
  const usual = defaultColumns(bundle.manifest.columns);
  const summary = bundle.manifest.columns.filter((c) => usual.includes(c.name) && c.name !== 'name');
  const shownGroups = groups.filter((g) => g.columns.some((c) => !isStatusColumn(c.name)));
  // Scroll to the group without adding an entry to the history.
  const jump = (e: MouseEvent, id: string) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const name = typeof record.name === 'string' ? record.name : record.id;
  const atoms = typeof record.n_atoms === 'number' ? record.n_atoms : null;
  const qc = record.qc_pass;
  const index = bundle.records.indexOf(record);
  const previous = index > 0 ? bundle.records[index - 1] : null;
  const next = index < bundle.records.length - 1 ? bundle.records[index + 1] : null;

  return (
    <div className="wrap page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/bundles">Bundles</Link> / <Link to={base}>{bundle.manifest.project}</Link> / {record.id}
      </nav>
      <header className="page-head detail-head">
        <h1 className="mono-title">{name}</h1>
        <p className="detail-sub">
          <code>{record.id}</code>
          {typeof record.formula === 'string' ? (
            <>
              {' '}
              · <Formula f={record.formula} />
            </>
          ) : null}
        </p>
        <div className="badges">
          {qc === true ? <span className="badge badge-indomain" title={G.qc}>Structural checks passed</span> : null}
          {qc === false ? <span className="badge badge-ood">Structural checks failed</span> : null}
          {qc === null || qc === undefined ? <span className="badge badge-muted">Structural checks not run</span> : null}
        </div>
      </header>

      <div className="detail-grid">
        <div className="detail-col">
          <section className="card" aria-labelledby="structure-h">
            <div className="card-head">
              <h2 id="structure-h" className="h3">
                Structure
              </h2>
            </div>
            {cif ? (
              <>
                <StructureViewer
                  source={{ path: `bundle:${bundle.key}/${cif}`, format: 'cif', label: structureLabel, provenance: 'bundle' }}
                  expectedAtoms={atoms}
                  title={name}
                  loadText={() => bundle.readText(cif)}
                  downloadUrl={cifUrl}
                />
                <p className="small muted">
                  The file is compared with its checksum in the manifest before it is shown.
                  {cifUrl ? (
                    <>
                      {' '}
                      <a href={cifUrl} download>
                        Download the CIF
                      </a>
                    </>
                  ) : null}
                </p>
              </>
            ) : (
              <p className="viewer-missing">This bundle holds no structure file for this record.</p>
            )}
          </section>
        </div>
        <div className="detail-col">
          <section className="card" aria-labelledby="summary-h">
            <div className="card-head">
              <h2 id="summary-h" className="h3">
                At a glance
              </h2>
            </div>
            <dl className="kv-grid">
              {summary.map((c) => (
                <div className="kv" key={c.name}>
                  <dt>
                    {c.name}
                    {c.description ? <InfoTip text={c.description} label={`About ${c.name}`} /> : null}
                  </dt>
                  <dd>
                    <Value column={c} value={record[c.name]} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="small muted">{G.bundleMissing}</p>
          </section>
          <BundleNotices bundle={bundle} />
        </div>
      </div>

      <section className="section" aria-labelledby="values-h">
        <h2 id="values-h">Every value of this record</h2>
        <nav className="chips" aria-label="Groups of columns">
          {shownGroups.map((g) => (
            <a key={g.key} className="chip" href={`#${anchor(g)}`} onClick={(e) => jump(e, anchor(g))}>
              {g.label}
            </a>
          ))}
        </nav>
        <div className="group-grid">
          {shownGroups.map((g) => (
            <Group key={g.key} record={record} group={g} />
          ))}
        </div>
      </section>

      <div className="pager" role="navigation" aria-label="Neighbouring records">
        {previous ? (
          <Link className="btn btn-sm btn-ghost" to={`${base}/${encodeURIComponent(previous.id)}`}>
            ← {previous.id}
          </Link>
        ) : (
          <span />
        )}
        <Link className="small" to={base}>
          All records
        </Link>
        {next ? (
          <Link className="btn btn-sm btn-ghost" to={`${base}/${encodeURIComponent(next.id)}`}>
            {next.id} →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
