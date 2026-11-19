// GET /feed: an RSS 2.0 feed of the releases, one item per release, newest
// first, from the same list the Releases page reads: tag, date, method version, files changed and the check summary.
// The proxy's matcher excludes this path, so it is served without a language prefix.
import { releases } from '@/lib/data';
import { SITE } from '@/lib/seo';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function GET() {
  let xml: string;
  let status = 200;
  try {
    const rows = releases();
    const items = rows.map((r) => {
      const c = r.checks;
      const en = `Release ${r.tag} of ${r.date}: method ${r.method}, ${r.changed.length} files changed; checks: ${c.pass ?? 0} pass, ${c.warning ?? 0} warnings, ${c.info ?? 0} for information${c.fail ? `, ${c.fail} failed` : ''}.`;
      const ko = `${r.date} 릴리스 ${r.tag}. 방법론 ${r.method}, 바뀐 파일 ${r.changed.length}개. 점검은 통과 ${c.pass ?? 0}, 경고 ${c.warning ?? 0}, 참고 ${c.info ?? 0}${c.fail ? `, 실패 ${c.fail}` : ''}.`;
      return `    <item>
      <title>${esc(`money-flow release ${r.tag} · method ${r.method}`)}</title>
      <link>${SITE}/en/releases#${r.tag}</link>
      <guid isPermaLink="false">${SITE}/releases/${r.tag}</guid>
      <pubDate>${new Date(r.built).toUTCString()}</pubDate>
      <description>${esc(`${en} ${ko}`)}</description>
    </item>`;
    });
    const last = rows[0] ? new Date(rows[0].built).toUTCString() : new Date().toUTCString();
    xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>money-flow releases</title>
    <link>${SITE}/en/releases</link>
    <atom:link href="${SITE}/feed" rel="self" type="application/rss+xml" />
    <description>datasteg money-flow: every release of the site's data, with its method version, the files that changed and the check summary. Where money is made and where it goes, from BIS, IMF and central bank statistics.</description>
    <language>en</language>
    <lastBuildDate>${last}</lastBuildDate>
    <generator>datasteg money-flow</generator>
${items.join('\n')}
  </channel>
</rss>
`;
  } catch {
    status = 503;
    xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>money-flow releases</title><link>${SITE}/en/releases</link><description>no data</description></channel></rss>\n`;
  }
  return new Response(xml, { status, headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': status === 200 ? 'public, max-age=3600' : 'no-store' } });
}
