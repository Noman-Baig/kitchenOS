import { SiteFooter, SiteHeader } from '@/components/Site';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (<><SiteHeader /><main id="main">{children}</main><SiteFooter /></>);
}
