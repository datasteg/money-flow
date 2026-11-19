// /svc/v1 (the API service contract): an internal view for the datasteg API service; lib/svcviews.ts builds it.
import { serve, svcGuard } from '@/lib/svc';
import { context, releasesView } from '@/lib/svcviews';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const denied = svcGuard(req); if (denied) return denied;
  return serve(() => releasesView(context(req)));
}
