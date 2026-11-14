export function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return 'Unpriced';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function formatMiles(miles) {
  if (miles == null || Number.isNaN(Number(miles))) return '—';
  return `${new Intl.NumberFormat('en-US').format(Number(miles))} mi`;
}

export function formatRelativeTime(iso) {
  if (!iso) return 'Never';
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return 'Unknown';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function isNewToday(listing) {
  if (!listing?.first_seen_at) return false;
  return Date.now() - Date.parse(listing.first_seen_at) <= 24 * 3600 * 1000;
}

export function getPriceDropAmount(listing) {
  if (
    listing?.previous_price != null &&
    listing?.price != null &&
    listing.price < listing.previous_price
  ) {
    return listing.previous_price - listing.price;
  }
  return 0;
}
