import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/branding';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/dashboard', '/admin', '/api', '/t/', '/q/', '/suspended', '/login'] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
