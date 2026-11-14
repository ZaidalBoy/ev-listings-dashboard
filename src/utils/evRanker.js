export const RANKER_STORAGE_KEY = 'voltwatch_ranker_prefs_v1';

export const IONIQ5_DIMENSIONS = [
  {
    key: 'price',
    rank: 1,
    label: 'Price',
    description: 'Lower listing price scores higher',
    color: '#059669',
  },
  {
    key: 'mileage',
    rank: 2,
    label: 'Mileage',
    description: 'Lower odometer miles score higher',
    color: '#0d9488',
  },
  {
    key: 'range',
    rank: 3,
    label: 'EPA Range',
    description: 'Higher estimated EPA range (prefers RWD)',
    color: '#0284c7',
  },
  {
    key: 'trim',
    rank: 4,
    label: 'Trim',
    description: 'Limited preferred over SEL',
    color: '#7c3aed',
  },
  {
    key: 'year',
    rank: 5,
    label: 'Model Year',
    description: 'Newer model year (2026 > 2025)',
    color: '#d97706',
  },
  {
    key: 'condition',
    rank: 6,
    label: 'Condition',
    description: 'Certified Pre-Owned (CPO) over Used',
    color: '#475569',
  },
];

export const ALL_IONIQ5_TRIMS = [
  'Limited',
  'SEL',
  'SE',
  'SE Standard Range',
  'XRT',
  'N',
];

export const DEFAULT_IONIQ5_CONFIG = {
  maxPrice: 45000,
  allowedTrims: ['SEL', 'Limited'],
  weights: {
    price: 30,
    mileage: 24,
    range: 18,
    trim: 14,
    year: 8,
    condition: 6,
  },
};

export const RANKER_PROFILES = [
  {
    id: 'ioniq5',
    make: 'Hyundai',
    model: 'Ioniq 5',
    label: 'Hyundai Ioniq 5',
    ready: true,
    subtitle: 'SEL & Limited · <= $45k · Price > Mileage > Range > Trim > Year > Condition',
  },
  {
    id: 'lucid_air',
    make: 'Lucid',
    model: 'Air',
    label: 'Lucid Air',
    ready: false,
    subtitle: 'Separate Lucid Air ranking profile (dimensions & weights coming next)',
  },
];

export function isIoniq5Listing(listing) {
  const model = String(listing?.model || '').toLowerCase();
  return model.includes('ioniq 5') || model.includes('ioniq5');
}

export function isLucidAirListing(listing) {
  const make = String(listing?.make || '').toLowerCase();
  const model = String(listing?.model || '').toLowerCase();
  return make === 'lucid' && model.includes('air');
}

export function normalizeIoniq5Trim(rawTrim) {
  const s = String(rawTrim || '').trim();
  if (!s) return 'Unknown';
  if (/^se\s+standard\s+range\b/i.test(s)) return 'SE Standard Range';
  if (/^limited\b/i.test(s)) return 'Limited';
  if (/^sel\b/i.test(s)) return 'SEL';
  if (/^se\b/i.test(s)) return 'SE';
  if (/^xrt\b/i.test(s)) return 'XRT';
  if (/^n\b/i.test(s)) return 'N';
  return s;
}

export function normalizeDrivetrain(listing) {
  const dt = String(listing?.drivetrain || '').trim().toUpperCase();
  if (dt === 'AWD' || dt === 'RWD') return dt;
  const trimStr = String(listing?.trim || '').toUpperCase();
  if (trimStr.includes('AWD')) return 'AWD';
  if (trimStr.includes('RWD')) return 'RWD';
  return 'UNKNOWN';
}

/**
 * Derive official EPA-estimated range (miles) from Year + Trim + Drivetrain.
 * 2025-2026 US-spec Ioniq 5 received the 84 kWh Long Range / 63 kWh Standard Range packs.
 */
export function estimateIoniq5Range(listing) {
  const year = Number(listing?.year) || 2025;
  const trim = normalizeIoniq5Trim(listing?.trim);
  const dt = normalizeDrivetrain(listing);

  if (year >= 2025) {
    if (trim === 'N') return { miles: 221, estimated: true };
    if (trim === 'XRT') return { miles: 259, estimated: true };
    if (trim === 'SE Standard Range') return { miles: 245, estimated: true };
    if (trim === 'Limited') {
      return { miles: dt === 'AWD' ? 269 : 318, estimated: true };
    }
    if (trim === 'SEL' || trim === 'SE') {
      return { miles: dt === 'AWD' ? 290 : 318, estimated: true };
    }
    return { miles: dt === 'AWD' ? 280 : 318, estimated: true };
  }

  // 2022-2024 fallback
  if (trim === 'SE Standard Range') return { miles: 220, estimated: true };
  if (trim === 'Limited') return { miles: dt === 'AWD' ? 260 : 303, estimated: true };
  return { miles: dt === 'AWD' ? 266 : 303, estimated: true };
}

export function cloneDefaultIoniq5Config() {
  return {
    maxPrice: DEFAULT_IONIQ5_CONFIG.maxPrice,
    allowedTrims: [...DEFAULT_IONIQ5_CONFIG.allowedTrims],
    weights: { ...DEFAULT_IONIQ5_CONFIG.weights },
  };
}

export function sanitizeIoniq5Config(rawConfig) {
  const base = cloneDefaultIoniq5Config();
  if (!rawConfig || typeof rawConfig !== 'object') return base;

  const maxPrice =
    rawConfig.maxPrice === null || rawConfig.maxPrice === ''
      ? null
      : Number(rawConfig.maxPrice);
  const validMaxPrice =
    maxPrice === null ? null : Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : base.maxPrice;

  const allowedTrims = Array.isArray(rawConfig.allowedTrims)
    ? rawConfig.allowedTrims.filter((t) => ALL_IONIQ5_TRIMS.includes(t))
    : base.allowedTrims;

  const weights = { ...base.weights };
  if (rawConfig.weights && typeof rawConfig.weights === 'object') {
    for (const dim of IONIQ5_DIMENSIONS) {
      const val = Number(rawConfig.weights[dim.key]);
      if (Number.isFinite(val) && val >= 0) {
        weights[dim.key] = Math.min(100, Math.round(val));
      }
    }
  }

  return {
    maxPrice: validMaxPrice,
    allowedTrims,
    weights,
  };
}

export function normalizeWeights(weights) {
  const entries = IONIQ5_DIMENSIONS.map((d) => [d.key, Math.max(0, Number(weights?.[d.key]) || 0)]);
  const sum = entries.reduce((acc, [, v]) => acc + v, 0);
  if (sum <= 0) {
    const equal = 100 / entries.length;
    return Object.fromEntries(entries.map(([k]) => [k, equal]));
  }
  return Object.fromEntries(entries.map(([k, v]) => [k, (v / sum) * 100]));
}

function getTrimSubScore(normTrim) {
  switch (normTrim) {
    case 'Limited':
      return 100;
    case 'SEL':
      return 50;
    case 'N':
      return 30;
    case 'XRT':
      return 25;
    case 'SE':
      return 20;
    case 'SE Standard Range':
      return 0;
    default:
      return 0;
  }
}

function getConditionSubScore(condition) {
  const c = String(condition || '').toLowerCase();
  if (c === 'cpo' || c === 'new') return 100;
  return 0;
}

function minMaxLowerBetter(value, min, max) {
  if (value == null || !Number.isFinite(value)) return 0;
  if (max <= min) return 100;
  return Math.max(0, Math.min(100, ((max - value) / (max - min)) * 100));
}

function minMaxHigherBetter(value, min, max) {
  if (value == null || !Number.isFinite(value)) return 0;
  if (max <= min) return 100;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

export function rankIoniq5Listings(allListings, rawConfig = DEFAULT_IONIQ5_CONFIG) {
  const config = sanitizeIoniq5Config(rawConfig);
  const ioniqListings = (allListings || []).filter(isIoniq5Listing);
  const normalizedWeights = normalizeWeights(config.weights);

  const eligible = [];
  const disqualified = [];

  for (const listing of ioniqListings) {
    const normTrim = normalizeIoniq5Trim(listing.trim);
    const normDrivetrain = normalizeDrivetrain(listing);
    const epa = estimateIoniq5Range(listing);
    const reasons = [];

    if (config.allowedTrims.length > 0 && !config.allowedTrims.includes(normTrim)) {
      reasons.push(`Trim "${normTrim}" excluded`);
    }
    if (listing.price == null || !Number.isFinite(Number(listing.price))) {
      reasons.push('Missing listing price');
    } else if (config.maxPrice != null && Number(listing.price) > config.maxPrice) {
      reasons.push(`Price $${Number(listing.price).toLocaleString()} > $${config.maxPrice.toLocaleString()} max`);
    }

    const enriched = {
      ...listing,
      normTrim,
      normDrivetrain,
      epaRange: epa.miles,
    };

    if (reasons.length > 0) {
      disqualified.push({
        ...enriched,
        disqualifyReasons: reasons,
      });
    } else {
      eligible.push(enriched);
    }
  }

  if (eligible.length === 0) {
    return {
      config,
      normalizedWeights,
      totalIoniq5: ioniqListings.length,
      eligibleCount: 0,
      disqualifiedCount: disqualified.length,
      ranked: [],
      top5: [],
      disqualified,
      byVin: new Map(disqualified.map((d) => [d.vin, { eligible: false, disqualifyReasons: d.disqualifyReasons, epaRange: d.epaRange, normTrim: d.normTrim }])),
      stats: null,
    };
  }

  const prices = eligible.map((l) => Number(l.price));
  const milesList = eligible.map((l) => Number(l.miles)).filter((m) => Number.isFinite(m));
  const ranges = eligible.map((l) => Number(l.epaRange));
  const years = eligible.map((l) => Number(l.year));

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minMiles = milesList.length ? Math.min(...milesList) : 0;
  const maxMiles = milesList.length ? Math.max(...milesList) : 0;
  const minRange = Math.min(...ranges);
  const maxRange = Math.max(...ranges);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const scored = eligible.map((l) => {
    const priceVal = Number(l.price);
    const milesVal = l.miles != null && Number.isFinite(Number(l.miles)) ? Number(l.miles) : maxMiles;
    const rangeVal = Number(l.epaRange);
    const yearVal = Number(l.year);

    const subScores = {
      price: minMaxLowerBetter(priceVal, minPrice, maxPrice),
      mileage: minMaxLowerBetter(milesVal, minMiles, maxMiles),
      range: minMaxHigherBetter(rangeVal, minRange, maxRange),
      trim: getTrimSubScore(l.normTrim),
      year: minMaxHigherBetter(yearVal, minYear, maxYear),
      condition: getConditionSubScore(l.condition),
    };

    const breakdown = {};
    let totalScore = 0;

    for (const dim of IONIQ5_DIMENSIONS) {
      const sub = subScores[dim.key];
      const wPct = normalizedWeights[dim.key];
      const contribution = (sub * wPct) / 100;
      totalScore += contribution;
      breakdown[dim.key] = {
        key: dim.key,
        label: dim.label,
        subScore: Number(sub.toFixed(1)),
        weightPct: Number(wPct.toFixed(1)),
        contribution: Number(contribution.toFixed(1)),
      };
    }

    return {
      ...l,
      score: Number(totalScore.toFixed(1)),
      breakdown,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((a.price ?? 9e9) !== (b.price ?? 9e9)) return (a.price ?? 9e9) - (b.price ?? 9e9);
    if ((a.miles ?? 9e9) !== (b.miles ?? 9e9)) return (a.miles ?? 9e9) - (b.miles ?? 9e9);
    return String(a.vin).localeCompare(String(b.vin));
  });

  const ranked = scored.map((item, idx) => ({
    ...item,
    rank: idx + 1,
    isTop5: idx < 5,
  }));

  const byVin = new Map();
  for (const item of ranked) {
    byVin.set(item.vin, {
      eligible: true,
      rank: item.rank,
      isTop5: item.isTop5,
      score: item.score,
      epaRange: item.epaRange,
      normTrim: item.normTrim,
      normDrivetrain: item.normDrivetrain,
      breakdown: item.breakdown,
    });
  }
  for (const item of disqualified) {
    byVin.set(item.vin, {
      eligible: false,
      disqualifyReasons: item.disqualifyReasons,
      epaRange: item.epaRange,
      normTrim: item.normTrim,
      normDrivetrain: item.normDrivetrain,
    });
  }

  return {
    config,
    normalizedWeights,
    totalIoniq5: ioniqListings.length,
    eligibleCount: ranked.length,
    disqualifiedCount: disqualified.length,
    ranked,
    top5: ranked.slice(0, 5),
    disqualified,
    byVin,
    stats: {
      minPrice,
      maxPrice,
      minMiles,
      maxMiles,
      minRange,
      maxRange,
      minYear,
      maxYear,
    },
  };
}
