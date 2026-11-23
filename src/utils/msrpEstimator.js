/**
 * Zero-API-call Original MSRP & Savings Estimator for VoltWatch EV Monitor.
 *
 * Uses Auto.dev's cached `vehicle.baseMsrp` (included in /listings responses at 0 extra calls)
 * when available, and falls back to verified Year + Trim + Drivetrain MSRP tables for
 * Lucid Direct (.mhtml) imports or missing records.
 */

const IONIQ5_BASE_MSRP = {
  2022: {
    'SE Standard Range': { RWD: 39950 },
    SE: { RWD: 44000, AWD: 47500 },
    SEL: { RWD: 46250, AWD: 49750 },
    Limited: { RWD: 51100, AWD: 55000 },
  },
  2023: {
    'SE Standard Range': { RWD: 41450 },
    SE: { RWD: 45500, AWD: 49000 },
    SEL: { RWD: 47450, AWD: 50950 },
    Limited: { RWD: 52600, AWD: 56500 },
  },
  2024: {
    'SE Standard Range': { RWD: 41800 },
    SE: { RWD: 45850, AWD: 49350 },
    SEL: { RWD: 47400, AWD: 50900 },
    Limited: { RWD: 53500, AWD: 57400 },
  },
  2025: {
    'SE Standard Range': { RWD: 42600 },
    SE: { RWD: 46650, AWD: 50150 },
    SEL: { RWD: 49600, AWD: 53100 },
    Limited: { RWD: 54300, AWD: 58200 },
    XRT: { AWD: 55950 },
    N: { AWD: 66200 },
  },
  2026: {
    'SE Standard Range': { RWD: 35000 },
    SE: { RWD: 37500, AWD: 41000 },
    SEL: { RWD: 39800, AWD: 43300 },
    Limited: { RWD: 45075, AWD: 48975 },
    XRT: { AWD: 46275 },
    N: { AWD: 66200 },
  },
  2027: {
    'SE Standard Range': { RWD: 35250 },
    SE: { RWD: 37800, AWD: 41300 },
    SEL: { RWD: 40200, AWD: 43700 },
    Limited: { RWD: 45225, AWD: 49125 },
    XRT: { AWD: 46425 },
  },
};

const LUCID_AIR_BASE_MSRP = {
  2022: {
    Pure: { RWD: 87400, AWD: 92900 },
    Touring: { AWD: 107400 },
    'Grand Touring': { AWD: 138000 },
    Sapphire: { AWD: 249000 },
  },
  2023: {
    Pure: { RWD: 77400, AWD: 82400 },
    Touring: { AWD: 95000 },
    'Grand Touring': { AWD: 125600 },
    Sapphire: { AWD: 249000 },
  },
  2024: {
    Pure: { RWD: 69900, AWD: 74900 },
    Touring: { AWD: 77900 },
    'Grand Touring': { AWD: 109900 },
    Sapphire: { AWD: 249000 },
  },
  2025: {
    Pure: { RWD: 69900 },
    Touring: { AWD: 78900 },
    'Grand Touring': { AWD: 110900 },
    Sapphire: { AWD: 249000 },
  },
  2026: {
    Pure: { RWD: 70900 },
    Touring: { AWD: 79900 },
    'Grand Touring': { AWD: 114900 },
    Sapphire: { AWD: 249000 },
  },
  2027: {
    Pure: { RWD: 70900 },
    Touring: { AWD: 79900 },
    'Grand Touring': { AWD: 114900 },
    Sapphire: { AWD: 249000 },
  },
};

function normalizeTrimForLookup(make, rawTrim) {
  const s = String(rawTrim || '').trim();
  const m = String(make || '').toLowerCase();
  if (m === 'hyundai') {
    if (/^se\s+standard\s+range\b/i.test(s)) return 'SE Standard Range';
    if (/^limited\b/i.test(s)) return 'Limited';
    if (/^sel\b/i.test(s)) return 'SEL';
    if (/^se\b/i.test(s)) return 'SE';
    if (/^xrt\b/i.test(s)) return 'XRT';
    if (/^n\b/i.test(s)) return 'N';
  }
  if (m === 'lucid') {
    if (/grand\s+touring/i.test(s)) return 'Grand Touring';
    if (/sapphire/i.test(s)) return 'Sapphire';
    if (/touring/i.test(s)) return 'Touring';
    if (/pure/i.test(s)) return 'Pure';
  }
  return s;
}

export function getDefaultDestinationFee(listing) {
  const make = String(listing?.make || '').toLowerCase();
  const year = Number(listing?.year) || 2025;
  if (make === 'lucid') {
    return year <= 2023 ? 1650 : 1500;
  }
  if (make === 'hyundai') {
    if (year >= 2026) return 1600;
    if (year === 2025) return 1475;
    return 1395;
  }
  return 1500;
}

export function detectLucidKnownAdas(listing) {
  if (String(listing?.make || '').toLowerCase() !== 'lucid') {
    return { label: null, msrp: 0 };
  }
  const year = Number(listing?.year) || 2025;
  const trimNorm = normalizeTrimForLookup('lucid', listing?.trim);
  const text = `${listing?.trim || ''} ${listing?.lucidMeta?.adas || ''}`;

  let label = null;
  if (/dreamdrive\s*pro/i.test(text)) label = 'DreamDrive Pro';
  else if (/dreamdrive\s*premium/i.test(text)) label = 'DreamDrive Premium';
  else if (/dreamdrive/i.test(text)) label = 'DreamDrive';

  if (!label) return { label: null, msrp: 0 };

  if (label === 'DreamDrive Pro') {
    // DreamDrive Pro was bundled standard on 2022 Grand Touring & Sapphire
    if ((year <= 2022 && trimNorm === 'Grand Touring') || trimNorm === 'Sapphire') {
      return { label, msrp: 0 };
    }
    return { label, msrp: 6750 };
  }
  if (label === 'DreamDrive Premium') {
    // DreamDrive Premium became standard across Air trims for 2026+
    if (year >= 2026 || trimNorm === 'Sapphire') {
      return { label, msrp: 0 };
    }
    return { label, msrp: 2000 };
  }
  return { label, msrp: 0 };
}

export function lookupBaseMsrp(listing) {
  const make = String(listing?.make || '').toLowerCase();
  const model = String(listing?.model || '').toLowerCase();
  const year = Number(listing?.year) || 2025;
  const dt = String(listing?.drivetrain || '').trim().toUpperCase();
  const trimNorm = normalizeTrimForLookup(make, listing?.trim);

  let table = null;
  if (make === 'hyundai' && (model.includes('ioniq 5') || model.includes('ioniq5'))) {
    table = IONIQ5_BASE_MSRP;
  } else if (make === 'lucid' && model.includes('air')) {
    table = LUCID_AIR_BASE_MSRP;
  }
  if (!table) return null;

  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  const resolvedYear = table[year]
    ? year
    : year < years[0]
      ? years[0]
      : years[years.length - 1];
  const byTrim = table[resolvedYear];
  const byDrive = byTrim?.[trimNorm];
  if (!byDrive) return null;

  if (dt && byDrive[dt] != null) return byDrive[dt];
  if (byDrive.RWD != null) return byDrive.RWD;
  if (byDrive.AWD != null) return byDrive.AWD;
  const firstVal = Object.values(byDrive)[0];
  return Number.isFinite(firstVal) ? firstVal : null;
}

export function estimateListingMsrp(
  listing,
  { includeDestination = true, includeKnownAdas = true, customOptionsMsrp = 0 } = {}
) {
  const cachedBase =
    listing?.base_msrp != null && Number(listing.base_msrp) > 0
      ? Number(listing.base_msrp)
      : null;
  const lookupBase = cachedBase ? null : lookupBaseMsrp(listing);
  const baseMsrp = cachedBase ?? lookupBase ?? null;
  const msrpSource = cachedBase
    ? 'autodev_base'
    : lookupBase
      ? 'trim_lookup'
      : 'unavailable';

  if (!baseMsrp) {
    return {
      baseMsrp: null,
      msrpSource,
      knownAdasLabel: null,
      knownAdasMsrp: 0,
      destinationMsrp: 0,
      customOptionsMsrp: 0,
      effectiveMsrp: null,
      savingsAmount: null,
      savingsPct: null,
      isEstimatedOptions: false,
    };
  }

  const adas = detectLucidKnownAdas(listing);
  const knownAdasMsrp = includeKnownAdas ? adas.msrp : 0;
  const destinationMsrp = getDefaultDestinationFee(listing);
  const customOpt = Number.isFinite(Number(customOptionsMsrp))
    ? Math.max(0, Number(customOptionsMsrp))
    : 0;

  const effectiveMsrp =
    baseMsrp + knownAdasMsrp + (includeDestination ? destinationMsrp : 0) + customOpt;

  const price =
    listing?.price != null && Number.isFinite(Number(listing.price))
      ? Number(listing.price)
      : null;

  const savingsAmount = price != null ? effectiveMsrp - price : null;
  const savingsPct =
    savingsAmount != null && effectiveMsrp > 0
      ? Number(((savingsAmount / effectiveMsrp) * 100).toFixed(1))
      : null;

  const make = String(listing?.make || '').toLowerCase();
  return {
    baseMsrp,
    msrpSource,
    knownAdasLabel: adas.label,
    knownAdasMsrp,
    destinationMsrp,
    customOptionsMsrp: customOpt,
    effectiveMsrp,
    savingsAmount,
    savingsPct,
    isEstimatedOptions: make === 'lucid' || msrpSource === 'trim_lookup',
  };
}
