import { NextResponse, type NextRequest } from 'next/server';

const LANGS = ['en', 'ko'];
const COOKIE = 'datasteg-lang';

/** Korean if the browser lists Korean at all, otherwise English. */
function fromAcceptLanguage(header: string): string {
  const listed = header.split(',').map((part) => part.trim().toLowerCase().split(';')[0].split('-')[0]);
  return listed.includes('ko') ? 'ko' : 'en';
}

/** Every page lives under /en/ or /ko/. A path without one is redirected: the saved choice first, then the browser. */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const first = pathname.split('/')[1];
  if (LANGS.includes(first)) return NextResponse.next();
  const saved = req.cookies.get(COOKIE)?.value;
  const lang = saved && LANGS.includes(saved) ? saved : fromAcceptLanguage(req.headers.get('accept-language') ?? '');
  const url = req.nextUrl.clone();
  url.pathname = `/${lang}${pathname === '/' ? '' : pathname}`;
  url.search = search;
  return NextResponse.redirect(url, 307);
}

// /health, /feed, /svc (the internal views for the API service, the API service contract) and files with an extension
// (sitemap.xml, robots.txt, the IndexNow key) live outside the languages.
export const config = { matcher: ['/((?!health|feed|svc/|_next/|.*\\.[a-zA-Z0-9]+$).*)'] };
