import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo';

// Open to crawlers: everything but the health check, the internal API views (/svc/) and
// old releases (?r=, which the pages canonicalise to the latest). The feed and the sitemap stay crawlable.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/health', '/svc/', '/*?r='] }], sitemap: `${SITE}/sitemap.xml` };
}
