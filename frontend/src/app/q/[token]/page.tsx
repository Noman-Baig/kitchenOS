import { notFound, redirect } from 'next/navigation';
import { serverGet } from '@/lib/branding';

/** Restaurant-wide marketing QR → resolves the (revocable) token server-side and redirects to the storefront. */
export default async function OnlineQr({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await serverGet<any>(`/public/qr/${encodeURIComponent(token)}`, 0);
  if (!d) notFound();
  if (d.kind === 'table') redirect(`/t/${token}`);
  redirect(`/r/${d.restaurant.slug}?src=qr`);
}
