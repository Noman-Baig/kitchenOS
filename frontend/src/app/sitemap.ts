import type { MetadataRoute } from 'next';
import { FEATURES } from '@/content/marketing';
import { GUIDES } from '@/content/help';
import { siteUrl } from '@/lib/branding';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.6 },
    { url: `${base}/help`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/register`, lastModified: now, changeFrequency: 'yearly', priority: 0.6 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    ...FEATURES.map((f) => ({ url: `${base}/features/${f.slug}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.8 })),
    ...GUIDES.map((g) => ({ url: `${base}/help/${g.slug}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.5 })),
  ];
}
