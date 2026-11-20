import { one, type Db } from '../lib/db.js';

/** Returns a conflicting reservation on the same table (overlap including the seating buffer), or null. */
export async function checkReservationConflict(db: Db, restaurantId: number, tableId: number, start: Date, durationMinutes: number, bufferMinutes: number, excludeId: number | null) {
  const end = new Date(start.getTime() + (durationMinutes + bufferMinutes) * 60000);
  const startWithBuffer = new Date(start.getTime() - bufferMinutes * 60000);
  return one<any>(
    `SELECT id, customer_name, reserved_for FROM reservations
      WHERE restaurant_id=? AND table_id=? AND status IN ('requested','confirmed','arrived') ${excludeId ? 'AND id<>?' : ''}
        AND reserved_for < ? AND DATE_ADD(reserved_for, INTERVAL duration_minutes MINUTE) > ? LIMIT 1`,
    excludeId ? [restaurantId, tableId, excludeId, end, startWithBuffer] : [restaurantId, tableId, end, startWithBuffer], db);
}
