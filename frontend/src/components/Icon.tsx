import { Armchair, BookOpen, Boxes, Building2, ChefHat, LayoutDashboard, Monitor, QrCode, Receipt, ShoppingBag, type LucideIcon } from 'lucide-react';

const MAP: Record<string, LucideIcon> = { Armchair, BookOpen, Boxes, Building2, ChefHat, LayoutDashboard, Monitor, QrCode, Receipt, ShoppingBag };
export function FeatureIcon({ name, size = 18 }: { name: string; size?: number }) {
  const I = MAP[name] || LayoutDashboard;
  return <I size={size} />;
}
