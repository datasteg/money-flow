// GET /health: the container healthcheck (ds-deploy waits for 200 before routing traffic). It also says which release
// the image carries, so a deploy can be checked from outside.
import { latestTag } from '@/lib/data';

export const dynamic = 'force-dynamic';

export function GET() {
  let release: string | null = null;
  try { release = latestTag(); } catch { release = null; }
  return Response.json(
    { status: release ? 'ok' : 'no-release', service: 'money-flow', version: process.env.APP_VERSION ?? 'dev', built: process.env.BUILD_TIME, release, time: new Date().toISOString() },
    { status: release ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
