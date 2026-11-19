// /svc/v1 (the API service contract): an internal view for the datasteg API service; lib/svcviews.ts builds it.
import { serve, svcGuard } from '@/lib/svc';
import { context, profileView } from '@/lib/svcviews';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ iso3: string }> }) {
  const denied = svcGuard(req); if (denied) return denied;
  const p = await params;
  return serve(() => profileView(context(req), p.iso3));
}
