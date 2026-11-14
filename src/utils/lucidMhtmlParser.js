function decodeQuotedPrintableUtf8(str) {
  const cleaned = str.replace(/=\r?\n/g, '');
  const bytes = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = cleaned.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else {
        for (const b of encoder.encode(cleaned[i])) bytes.push(b);
      }
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
}

function decodeBase64Utf8(str) {
  const b64 = str.replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function extractHtmlFromMhtml(rawText) {
  if (!rawText) return '';
  const boundaryMatch =
    rawText.match(/boundary="([^"]+)"/i) || rawText.match(/boundary=([^\s;\r\n]+)/i);
  if (!boundaryMatch) {
    return rawText; // Already plain HTML
  }
  const parts = rawText.split(`--${boundaryMatch[1]}`);
  for (const part of parts) {
    if (/Content-Type:\s*text\/html/i.test(part)) {
      const crlfIdx = part.indexOf('\r\n\r\n');
      const lfIdx = part.indexOf('\n\n');
      const splitIdx = crlfIdx !== -1 ? crlfIdx + 4 : lfIdx !== -1 ? lfIdx + 2 : 0;
      const headers = part.slice(0, splitIdx);
      const body = part.slice(splitIdx);
      if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) {
        return decodeQuotedPrintableUtf8(body);
      }
      if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) {
        return decodeBase64Utf8(body);
      }
      return body;
    }
  }
  return rawText;
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&trade;|™/g, '')
    .trim();
}

function zipToStateHint(zip) {
  if (!zip) return '';
  const first = String(zip).trim()[0];
  if (first === '9') return 'CA';
  return '';
}

export function parseLucidMhtml(rawText, nowIso = new Date().toISOString()) {
  const html = extractHtmlFromMhtml(rawText);
  const chunks = html.split(/aria-label="vehicle card"/i).slice(1);
  const seenIds = new Set();
  const listings = [];

  for (const chunk of chunks) {
    const hrefMatch = chunk.match(/href="(https:\/\/lucidmotors\.com\/inventory-vehicle\?[^"]+)"/i);
    const vdpUrl = hrefMatch ? decodeHtmlEntities(hrefMatch[1]) : '';
    let id = '';
    let shortCode = '';
    let uuid = '';
    let zip = '';

    if (vdpUrl) {
      try {
        const u = new URL(vdpUrl);
        id = u.searchParams.get('id') || '';
        shortCode = u.searchParams.get('shortCode') || '';
        uuid = u.searchParams.get('UUID') || '';
        zip = u.searchParams.get('zip') || '';
      } catch {
        // ignore URL parse error
      }
    }

    const bodyPart = chunk.slice(chunk.indexOf('>') + 1);
    const text = decodeHtmlEntities(
      bodyPart.replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, '\n')
    );
    const lines = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const yearMatch = text.match(/\b(202[0-9])\b/);
    const year = yearMatch ? Number(yearMatch[1]) : new Date().getUTCFullYear();
    const titleLine = lines.find((l) => /^(Air|Gravity)\b/i.test(l)) || 'Air';
    const model = /^Gravity/i.test(titleLine) ? 'Gravity' : 'Air';
    const trimBase = titleLine.replace(/^(Air|Gravity)\s*/i, '').trim() || 'Base';

    const priceMatch = text.match(/\$([0-9]{2,3},[0-9]{3})/);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : null;

    const milesMatch = text.match(/([0-9,]+)\s*mi\./i);
    const miles = milesMatch ? Number(milesMatch[1].replace(/,/g, '')) : null;

    const isCpo = lines.some((l) => /\bcpo\b|certified/i.test(l));
    const condition = isCpo ? 'cpo' : 'used';
    const availLine = lines.find((l) => /^Available\b/i.test(l)) || '';

    const findBeforeLabel = (label) => {
      const idx = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
      return idx > 0 ? lines[idx - 1] : '';
    };

    const adas = findBeforeLabel('Driver Assistance System').trim();
    const drivetrainRaw = findBeforeLabel('DriveTrain');
    const drivetrain = /all-wheel|awd/i.test(drivetrainRaw)
      ? 'AWD'
      : /rear-wheel|rwd/i.test(drivetrainRaw)
        ? 'RWD'
        : '';
    const exteriorColor = findBeforeLabel('Exterior Color');
    const interiorColor = findBeforeLabel('Interior Theme');
    const rangeIdx = lines.findIndex((l) => l === 'EPA-est. range');
    const range = rangeIdx !== -1 ? lines[rangeIdx + 1] : '';

    const imgMatch =
      chunk.match(/src="(https:\/\/renderchain\.lucidmotors\.com\/[^"]+Angle_EXT[^"]+)"/i) ||
      chunk.match(/data-srcset="(https:\/\/renderchain\.lucidmotors\.com\/[^"\s]+)/i);
    const primaryImage = imgMatch ? decodeHtmlEntities(imgMatch[1]) : './images/ev_sedan_silver.jpg';

    const uniqueKey = id || shortCode || uuid || `${year}-${trimBase}-${price}-${miles}`;
    if (!uniqueKey || seenIds.has(uniqueKey)) continue;
    seenIds.add(uniqueKey);

    const vin = id ? `LUCID-${id}` : `LUCID-${shortCode || uniqueKey}`;
    const trim = [trimBase, adas, range ? `${range} EPA` : '', availLine]
      .filter(Boolean)
      .join(' · ');

    listings.push({
      vin,
      year,
      make: 'Lucid',
      model,
      trim,
      body_style: model === 'Gravity' ? 'SUV' : 'Sedan',
      drivetrain,
      fuel: 'Electric',
      exterior_color: exteriorColor,
      interior_color: interiorColor,
      price,
      previous_price: null,
      miles,
      condition,
      dealer: 'Lucid Motors Direct',
      city: 'Lucid Pre-Owned',
      state: zipToStateHint(zip),
      zip: zip || '',
      vdp_url: vdpUrl,
      carfax_url: '',
      primary_image: primaryImage,
      is_starred: false,
      notes: '',
      source: 'lucid_direct',
      first_seen_at: nowIso,
      last_seen_at: nowIso,
      updated_at: nowIso,
      removed_at: null,
      price_history: price != null ? [{ price, recordedAt: nowIso }] : [],
      lucidMeta: { id, shortCode, uuid, adas, range, availability: availLine },
    });
  }

  return listings;
}

export function findMatchingExistingLucid(existingListings, parsed) {
  return existingListings.find(
    (item) =>
      item.source !== 'lucid_direct' &&
      item.make === 'Lucid' &&
      item.model === parsed.model &&
      Number(item.year) === Number(parsed.year) &&
      item.price != null &&
      parsed.price != null &&
      Number(item.price) === Number(parsed.price) &&
      item.miles != null &&
      parsed.miles != null &&
      Math.abs(Number(item.miles) - Number(parsed.miles)) <= 25
  );
}
