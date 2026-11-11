import { useState } from 'react';
import { download } from '../lib/csv';
import type { Manifest } from '../lib/types';

/** Citation of the research repository (from its CITATION.cff), pinned to the exported commit. */
export function citations(m: Manifest) {
  const commit = m.source_commit_hash.replace(/-dirty$/, '').slice(0, 7);
  const year = (m.source_commit_date ?? '2026').slice(0, 4);
  const title = 'Active learning for low-band-gap 3D metal-organic frameworks (code and data)';
  const bibtex = `@software{guerreronavarro_${year}_mof3dgenerator,
  author  = {Guerrero Navarro, C. H. and Ghotbi, Maryam and Balbuena, Perla B.},
  title   = {${title}},
  year    = {${year}},
  version = {0.1.0},
  url     = {${m.source_repository_url}},
  note    = {Commit ${commit}. Manuscript in preparation; DOI to be added}
}`;
  const ris = `TY  - COMP
AU  - Guerrero Navarro, C. H.
AU  - Ghotbi, Maryam
AU  - Balbuena, Perla B.
TI  - ${title}
PY  - ${year}
ET  - 0.1.0
UR  - ${m.source_repository_url}
N1  - Commit ${commit}. Manuscript in preparation; DOI to be added
ER  - `;
  const text = `C. H. Guerrero Navarro, M. Ghotbi, P. B. Balbuena. ${title}, v0.1.0 (commit ${commit}), ${year}. ${m.source_repository_url}`;
  return { bibtex, ris, text };
}

function CopyBlock({ label, content, filename, type }: { label: string; content: string; filename: string; type: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="cite-block">
      <div className="cite-head">
        <strong>{label}</strong>
        <span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>{' '}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => download(filename, content, type)}>Download</button>
        </span>
      </div>
      <pre><code>{content}</code></pre>
    </div>
  );
}

export default function Cite({ m }: { m: Manifest }) {
  const c = citations(m);
  return (
    <div className="cite">
      <p className="cite-text">{c.text}</p>
      <CopyBlock label="BibTeX" content={c.bibtex} filename="MOF_3D_Generator.bib" type="application/x-bibtex" />
      <CopyBlock label="RIS" content={c.ris} filename="MOF_3D_Generator.ris" type="application/x-research-info-systems" />
      <p className="small muted">Replace with the article and Zenodo DOI once they exist. Please also cite the tools the study relied on (PORMAKE, Zeo++, QMOF, VASP) as listed in the repository.</p>
    </div>
  );
}
