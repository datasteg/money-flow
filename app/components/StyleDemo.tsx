'use client';
// The token sheet's live controls: the filter signboard's segments, select, play button and scrubber, with local state
// only (the real FilterRow writes the URL).
import { useState } from 'react';
import { SegmentedControl } from './sn/client';

export function StyleControls({ lang }: { lang: string }) {
  const ko = lang === 'ko';
  const [dir, setDir] = useState('in');
  const [k, setK] = useState('10');
  const [p, setP] = useState(70);
  return (
    <div className="mf-filters mf-filters--demo" role="group" aria-label={ko ? '컨트롤 견본' : 'Control samples'}>
      <div className="sn-field mf-field"><span className="sn-field__label">{ko ? '방향' : 'Direction'}</span>
        <SegmentedControl label={ko ? '방향' : 'Direction'} value={dir} onChange={setDir} options={[{ value: 'in', label: ko ? '유입' : 'Inflows' }, { value: 'out', label: ko ? '유출' : 'Outflows' }]} /></div>
      <div className="sn-field mf-field"><span className="sn-field__label">{ko ? '보유국 수' : 'Holders shown'}</span>
        <SegmentedControl label={ko ? '보유국 수' : 'Holders shown'} value={k} onChange={setK} options={['5', '10', '20'].map((x) => ({ value: x, label: x }))} /></div>
      <div className="sn-field mf-field mf-field--day"><span className="sn-field__label">{ko ? '날짜' : 'Day'}</span>
        <div className="mf-dayctl">
          <button type="button" className="sn-btn sn-btn--deep sn-btn--sm mf-play">{ko ? '재생' : 'Play'}</button>
          <input className="mf-range" type="range" min={0} max={100} value={p} onChange={(e) => setP(Number(e.target.value))} style={{ ['--p' as string]: `${p}%` }} aria-label={ko ? '날짜' : 'Day'} />
          <output className="mf-dayctl__out">{p === 100 ? <span className="mf-led" /> : null}{p === 100 ? '2026-10-30' : '2024-03-31'}</output>
        </div>
      </div>
    </div>
  );
}
