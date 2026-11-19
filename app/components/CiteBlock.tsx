'use client';
// "Cite this view", after articles.datasteg.com's CiteBlock: one line with a copy button, the figure
// note, BibTeX and RIS under a fold, and the original datasets' and the method's own citations.
import { CopyButton, DownloadText } from './sn/client';
import { citationBibtex, citationRis, citationText, figureNote, type ViewCite } from '@/lib/citation';

export function CiteBlock({ cite, labels, datasets, method }: {
  cite: ViewCite;
  labels: { title: string; copy: string; copied: string; note: string; bibtex: string; ris: string; datasets: string; method: string };
  datasets: { name: string; text: string; bibtex: string }[];
  method: { text: string; bibtex: string };
}) {
  const text = citationText(cite), note = figureNote(cite), bib = citationBibtex(cite), ris = citationRis(cite);
  const allBib = [bib, ...datasets.map((d) => d.bibtex), method.bibtex].join('\n\n');
  return (
    <section className="mf-cite" id="cite" aria-labelledby="mf-cite-h">
      <h2 id="mf-cite-h" className="mf-h2">{labels.title}</h2>
      <p className="mf-cite__text">{text}</p>
      <div className="mf-cite__tools">
        <CopyButton text={text} label={labels.copy} done={labels.copied} />
        <CopyButton text={note} label={labels.note} done={labels.copied} />
        <DownloadText text={allBib} filename={`datasteg-mf-${cite.key}-${cite.release}.bib`} label={labels.bibtex} mime="application/x-bibtex" />
        <DownloadText text={ris} filename={`datasteg-mf-${cite.key}-${cite.release}.ris`} label={labels.ris} mime="application/x-research-info-systems" />
      </div>
      <p className="mf-cite__note"><span className="mf-muted">{labels.note}: </span>{note}</p>
      <details className="mf-fold">
        <summary>{labels.bibtex}</summary>
        <pre className="mf-code">{bib}</pre>
      </details>
      <details className="mf-fold">
        <summary>{labels.datasets} ({datasets.length})</summary>
        <ul className="mf-list">{datasets.map((d) => <li key={d.name}>{d.text}</li>)}</ul>
      </details>
      <details className="mf-fold">
        <summary>{labels.method}</summary>
        <p>{method.text}</p>
        <pre className="mf-code">{method.bibtex}</pre>
      </details>
    </section>
  );
}
