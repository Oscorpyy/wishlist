export interface ReservationEntry {
  name: string;
  count: number;
}

/**
 * Parses reservations stored in items.reserved_by
 * Supports JSON arrays: [{"name": "Alice", "count": 1}, ...]
 * Supports legacy plain strings: "Alice"
 */
export function parseReservations(reservedBy: string | null | undefined): ReservationEntry[] {
  if (!reservedBy || typeof reservedBy !== 'string') return [];
  const trimmed = reservedBy.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => {
            if (typeof entry === 'string') {
              const name = entry.trim();
              return name ? { name, count: 1 } : null;
            }
            if (typeof entry === 'object' && entry !== null) {
              const name = String((entry as { name?: unknown }).name || '').trim();
              const count =
                typeof (entry as { count?: unknown }).count === 'number' &&
                (entry as { count: number }).count > 0
                  ? (entry as { count: number }).count
                  : 1;
              return name ? { name, count } : null;
            }
            return null;
          })
          .filter((e): e is ReservationEntry => e !== null);
      }
    } catch {
      // fallback
    }
  }

  return [{ name: trimmed, count: 1 }];
}

/**
 * Computes quantity and reservation statistics for an item
 */
export function getItemReservationStats(
  quantity: number | undefined | null,
  reservedBy: string | undefined | null,
  isReservedFlag?: boolean | null
) {
  const totalQty = typeof quantity === 'number' && quantity > 0 ? quantity : 1;
  const reservations = parseReservations(reservedBy);
  const reservedCount = reservations.reduce((sum, r) => sum + r.count, 0);
  const remainingQty = Math.max(0, totalQty - reservedCount);
  const isFullyReserved =
    reservedCount >= totalQty || (reservations.length === 0 && Boolean(isReservedFlag));

  return {
    totalQty,
    reservations,
    reservedCount,
    remainingQty,
    isFullyReserved,
  };
}

/**
 * Formats names for compact display:
 * Shows 2 or 3 people then '...' if too long to prevent font resize or button overflow
 */
export function formatReserversSummary(reservations: ReservationEntry[]): string {
  if (reservations.length === 0) return '';
  const names = reservations.map((r) => r.name.trim()).filter(Boolean);
  if (names.length === 0) return '';

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    const combined = `${names[0]}, ${names[1]}`;
    if (combined.length <= 24) {
      return combined;
    }
    return `${names[0]}, ...`;
  }

  if (names.length === 3) {
    const threeNames = `${names[0]}, ${names[1]}, ${names[2]}`;
    if (threeNames.length <= 24) {
      return threeNames;
    }
    const twoNames = `${names[0]}, ${names[1]}`;
    if (twoNames.length <= 18) {
      return `${twoNames}, ...`;
    }
    return `${names[0]}, ...`;
  }

  // 4 or more people: show 2 or 3 persons then "..."
  const threeNames = `${names[0]}, ${names[1]}, ${names[2]}`;
  if (threeNames.length <= 20) {
    return `${threeNames}, ...`;
  }
  const twoNames = `${names[0]}, ${names[1]}`;
  if (twoNames.length <= 16) {
    return `${twoNames}, ...`;
  }
  return `${names[0]}, ...`;
}

/**
 * Formats full tooltip string for hover
 */
export function formatReserversTooltip(reservations: ReservationEntry[]): string {
  if (reservations.length === 0) return '';
  return reservations
    .map((r) => (r.count > 1 ? `${r.name} (${r.count})` : r.name))
    .join(', ');
}

/**
 * Formats the availability string for quantity > 1:
 * e.g. "1 pris • 2/3 libre" or "2/3 libre"
 */
export function formatQuantityAvailability(stats: {
  totalQty: number;
  reservedCount: number;
  remainingQty: number;
  isFullyReserved: boolean;
}): string {
  if (stats.totalQty <= 1) return '';
  if (stats.isFullyReserved) {
    return `Tous réservés (${stats.totalQty}/${stats.totalQty})`;
  }
  if (stats.reservedCount > 0) {
    return `${stats.reservedCount} pris • ${stats.remainingQty}/${stats.totalQty} libre`;
  }
  return `${stats.totalQty}/${stats.totalQty} libre`;
}
