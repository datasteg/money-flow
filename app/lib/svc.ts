// lib/svc.ts: the guard and response helpers for /svc/v1 (see the API service contract)
const PUBLIC = /\./; // public hosts have dots (money-flow.datasteg.com); Docker service names do not (money-flow)
export function svcGuard(req: Request): Response | null {
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const fwd = (req.headers.get("x-forwarded-host") || "").split(":")[0].toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if ((!local && PUBLIC.test(host)) || (fwd && PUBLIC.test(fwd) && fwd !== "127.0.0.1")) return svcError(404, "not-found", "Not found", "No such path.");
  const token = process.env.DATASTEG_SVC_TOKEN;
  if (token && req.headers.get("x-datasteg-gateway") !== token) return svcError(404, "not-found", "Not found", "No such path.");
  return null;
}
const HDRS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" };
export function svcJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HDRS });
}
export function svcError(status: number, type: string, title: string, detail: string): Response {
  return svcJson({ error: { status, type, title, detail } }, status);
}
export function svcLang(url: URL): "en" | "ko" { return url.searchParams.get("lang") === "ko" ? "ko" : "en"; }

// ---------------------------------------------------------------- money-flow's additions (the views are in lib/svcviews.ts)

/** A failed call: thrown by a view, turned into the error envelope by `serve` (400 bad parameter, 404 unknown id). */
export class SvcFail extends Error {
  constructor(public status: number, public type: string, public title: string, public detail: string) { super(detail); }
}

/** Run a view and answer with its envelope; a SvcFail becomes its error, anything else a 503 (never a stack trace). */
export function serve(fn: () => unknown): Response {
  try {
    return svcJson(fn());
  } catch (e) {
    if (e instanceof SvcFail) return svcError(e.status, e.type, e.title, e.detail);
    console.error('svc', e);
    return svcError(503, 'data-missing', 'Data not available', 'The release store could not be read. Try again later; GET /v1/money-flow/releases lists the releases.');
  }
}
