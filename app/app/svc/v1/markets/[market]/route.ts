// /svc/v1 (the API service contract): an internal view for the datasteg API service; lib/svcviews.ts builds it.
import { serve, svcGuard } from '@/lib/svc';
import { context, marketView } from '@/lib/svcviews';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ market: string }> }) {
  const denied = svcGuard(req); if (denied) return denied;
  const p = await params;
  return serve(() => marketView(context(req), p.market));
}
