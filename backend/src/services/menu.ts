import { q } from '../lib/db.js';
import { emit, rooms } from '../realtime/bus.js';

const cache = new Map<number, { at: number; data: any }>();
const TTL = 15_000;

export function invalidateMenu(restaurantId: number) {
  cache.delete(restaurantId);
  emit(rooms.menu(restaurantId), 'menu:updated', {});
}

/** Full menu for customer channels. Only active categories/items; unavailable items are flagged, not hidden. */
export async function publicMenu(restaurantId: number, channel: 'qr' | 'online' | 'staff' = 'qr') {
  const c = cache.get(restaurantId);
  let data = c && Date.now() - c.at < TTL ? c.data : null;
  if (!data) {
    const [cats, items, variants, addons] = await Promise.all([
      q<any>('SELECT id, name, description, prep_minutes, sort_order FROM menu_categories WHERE restaurant_id=? AND active=1 ORDER BY sort_order, name', [restaurantId]),
      q<any>(`SELECT mi.id, mi.category_id, mi.name, mi.description, mi.price, mi.prep_minutes, mi.allergens, mi.ingredients_text, mi.is_featured, mi.available, mi.online_enabled, mi.sort_order,
                     f.public_id image_public_id, f.thumb_key
                FROM menu_items mi LEFT JOIN files f ON f.id=mi.image_file_id WHERE mi.restaurant_id=? AND mi.active=1 ORDER BY mi.sort_order, mi.name`, [restaurantId]),
      q<any>('SELECT id, item_id, name, price_delta, is_default FROM item_variants WHERE restaurant_id=? AND active=1 ORDER BY sort_order, id', [restaurantId]),
      q<any>('SELECT id, item_id, name, price FROM item_addons WHERE restaurant_id=? AND active=1 ORDER BY id', [restaurantId]),
    ]);
    data = {
      categories: cats.map((cat) => ({
        ...cat,
        items: items.filter((i) => i.category_id === cat.id).map((i) => ({
          id: i.id, name: i.name, description: i.description, price: i.price, prepMinutes: i.prep_minutes ?? cat.prep_minutes, allergens: i.allergens,
          ingredients: i.ingredients_text, featured: !!i.is_featured, available: !!i.available, onlineEnabled: !!i.online_enabled,
          imageUrl: i.image_public_id ? `/api/v1/files/${i.image_public_id}` : null,
          thumbUrl: i.image_public_id && i.thumb_key ? `/api/v1/files/${i.image_public_id}?thumb=1` : null,
          variants: variants.filter((v) => v.item_id === i.id).map((v) => ({ id: v.id, name: v.name, priceDelta: v.price_delta, isDefault: !!v.is_default })),
          addons: addons.filter((a) => a.item_id === i.id).map((a) => ({ id: a.id, name: a.name, price: a.price })),
        })),
      })).filter((cat) => cat.items.length),
    };
    cache.set(restaurantId, { at: Date.now(), data });
  }
  if (channel === 'online') {
    return { categories: data.categories.map((c: any) => ({ ...c, items: c.items.filter((i: any) => i.onlineEnabled) })).filter((c: any) => c.items.length) };
  }
  return data;
}
