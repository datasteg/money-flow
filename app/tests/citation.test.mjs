// The citation strings for a fixture view, in both languages, against fixed expected text (as
// articles' check-content.mjs does for articles). Run: node --test tests/ (Node strips the TypeScript types).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationBibtex, citationRis, citationText, figureNote, permalink } from '../lib/citation.ts';

const en = { lang: 'en', title: 'Money ladder: Korea, inflows', key: 'KOR-in', release: '20261029.1', method: '1.0', date: '2026-10-29',
  path: '/en/e/KOR', query: 'd=2026-10-27&dir=in', datasets: ['BIS LBS', 'IMF PIP (CPIS)', 'IMF IIP'] };
const ko = { ...en, lang: 'ko', title: '돈의 사다리: 한국, 유입', path: '/ko/e/KOR' };

test('view citation, English', () => {
  assert.equal(citationText(en), 'datasteg (2026), “Money ladder: Korea, inflows”, datasteg money-flow, release 20261029.1, method 1.0, 29 October 2026, https://money-flow.datasteg.com/en/e/KOR?r=20261029.1&d=2026-10-27&dir=in.');
});

test('view citation, Korean', () => {
  assert.equal(citationText(ko), 'datasteg (2026), 「돈의 사다리: 한국, 유입」, datasteg money-flow, 릴리스 20261029.1, 방법론 1.0, 2026년 10월 29일, https://money-flow.datasteg.com/ko/e/KOR?r=20261029.1&d=2026-10-27&dir=in.');
});

test('the permalink always carries the release, first', () => {
  assert.equal(permalink({ ...en, query: 'r=20200101.1&dir=out' }), 'https://money-flow.datasteg.com/en/e/KOR?r=20261029.1&dir=out');
});

test('figure note', () => {
  assert.equal(figureNote(en), 'Source: datasteg money-flow (release 20261029.1, method 1.0), from BIS LBS, IMF PIP (CPIS) and IMF IIP.');
  assert.equal(figureNote(ko), '자료: datasteg money-flow(릴리스 20261029.1, 방법론 1.0), 원자료 BIS LBS, IMF PIP (CPIS) 및 IMF IIP.');
});

test('BibTeX: @misc, the organisation braced, the key datasteg:mf:<view>:<release>', () => {
  assert.equal(citationBibtex(en), `@misc{datasteg:mf:KOR-in:20261029.1,
  author       = {{datasteg}},
  title        = {Money ladder: {Korea}, inflows},
  howpublished = {datasteg money-flow, release 20261029.1, method 1.0},
  year         = {2026},
  date         = {2026-10-29},
  url          = {https://money-flow.datasteg.com/en/e/KOR?r=20261029.1&d=2026-10-27&dir=in},
  urldate      = {2026-10-29},
  note         = {Positions from BIS LBS, IMF PIP (CPIS), IMF IIP}
}`);
});

test('RIS', () => {
  const r = citationRis(en);
  assert.match(r, /^TY  - DATA\nAU  - datasteg\nTI  - Money ladder: Korea, inflows\n/);
  assert.match(r, /UR  - https:\/\/money-flow\.datasteg\.com\/en\/e\/KOR\?r=20261029\.1&d=2026-10-27&dir=in\n/);
  assert.match(r, /ER  - $/);
});

test('the author is the organisation, datasteg', () => {
  for (const s of [citationText(en), citationText(ko), citationBibtex(en), citationRis(en)]) assert.match(s, /datasteg/);
});
