import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { serverGet, siteUrl, getBranding } from '@/lib/branding';
import { JsonLd } from '@/components/Site';
import { Storefront } from '@/components/customer/Storefront';

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const r = await serverGet<any>(`/public/restaurants/${slug}`, 60);
  if (!r) return { title: 'Restaurant not found' };
  const about = r.theme?.sections?.find((s: any) => s.type === 'about')?.body || `Order online from ${r.name}${r.city ? ` in ${r.city}` : ''}: pickup, delivery and table reservations.`;
  return {
    title: { absolute: `${r.name}${r.city ? ` — ${r.city}` : ''} | Menu & online ordering` },
    description: about.slice(0, 160),
    alternates: { canonical: `/r/${slug}` },
    openGraph: { title: r.name, description: about.slice(0, 160), images: r.bannerUrl ? [r.bannerUrl] : r.logoUrl ? [r.logoUrl] : undefined, url: `/r/${slug}` },
  };
}

export default async function RestaurantSite({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [r, menu, b] = await Promise.all([serverGet<any>(`/public/restaurants/${slug}`, 60), serverGet<any>(`/public/restaurants/${slug}/menu`, 60), getBranding()]);
  if (!r) notFound();
  const url = siteUrl();
  return (
    <>
      <JsonLd data={{
        '@context': 'https://schema.org', '@type': 'Restaurant', name: r.name, url: `${url}/r/${slug}`, image: r.bannerUrl ? `${url}${r.bannerUrl}` : undefined, telephone: r.phone || undefined,
        address: r.address ? { '@type': 'PostalAddress', streetAddress: r.address, addressLocality: r.city || undefined, addressCountry: r.country } : undefined,
        servesCuisine: undefined, acceptsReservations: true,
        hasMenu: menu ? { '@type': 'Menu', hasMenuSection: menu.categories.map((c: any) => ({ '@type': 'MenuSection', name: c.name, hasMenuItem: c.items.slice(0, 30).map((i: any) => ({ '@type': 'MenuItem', name: i.name, description: i.description || undefined, offers: { '@type': 'Offer', price: Number(i.price).toFixed(2), priceCurrency: r.currency } })) })) } : undefined,
        aggregateRating: r.reviews?.length ? { '@type': 'AggregateRating', ratingValue: (r.reviews.reduce((a: number, x: any) => a + x.rating, 0) / r.reviews.length).toFixed(1), reviewCount: r.reviews.length } : undefined,
      }} />
      <Storefront slug={slug} initial={r} menu={menu} poweredBy={b.softwareName} />
    </>
  );
}
