'use server';

import * as cheerio from 'cheerio';

export interface ScrapedProduct {
  title: string;
  image: string;
  images: string[];
  price: number | null;
  options: string;
  availableOptions: Record<string, string[]>;
}

/**
 * Decodes named, decimal, and hexadecimal HTML entities.
 */
function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  const namedEntities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&euro;': '€',
    '&pound;': '£',
    '&yen;': '¥',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&ndash;': '–',
    '&mdash;': '—',
  };

  return text
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|euro|pound|yen|copy|reg|trade|ndash|mdash|#39);/gi, (match) => namedEntities[match.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return _;
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .trim();
}

/**
 * Robust numeric price parser supporting French formats (12,99 €, 1 299,00 €),
 * USD ($12.99), GBP (£12.99), EUR, etc. Handles discounts by capturing the first valid amount.
 */
function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isNaN(raw) ? null : Math.round(raw * 100) / 100;
  const str = String(raw).replace(/\u00A0|&nbsp;/g, ' ').trim();

  const priceRegexes = [
    /(?:€|\$|£|EUR|USD|GBP)\s*([0-9]{1,3}(?:[,\s.][0-9]{3})*(?:[.,][0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)/i,
    /([0-9]{1,3}(?:[,\s.][0-9]{3})*(?:[.,][0-9]{1,2})|[0-9]+(?:[.,][0-9]{1,2})?)\s*(?:€|\$|£|EUR|USD|GBP)/i,
    /\b([0-9]{1,4}(?:[.,][0-9]{1,2}))\b/,
    /\b([0-9]+)\b/,
  ];

  for (const reg of priceRegexes) {
    const m = str.match(reg);
    if (m && m[1]) {
      let numStr = m[1].replace(/\s/g, '');
      if (numStr.includes('.') && numStr.includes(',')) {
        if (numStr.lastIndexOf(',') > numStr.lastIndexOf('.')) {
          numStr = numStr.replace(/\./g, '').replace(',', '.');
        } else {
          numStr = numStr.replace(/,/g, '');
        }
      } else if (numStr.includes(',')) {
        numStr = numStr.replace(',', '.');
      }
      const val = parseFloat(numStr);
      if (!isNaN(val) && val > 0 && val < 500000) {
        return Math.round(val * 100) / 100;
      }
    }
  }
  return null;
}

/**
 * Strips common e-commerce brand suffixes and prefixes from titles.
 */
function cleanTitle(title: string): string {
  if (!title) return '';
  let cleaned = decodeHtmlEntities(title);

  const suffixes = [
    /\s*[-|–|—|:]\s*Amazon(?:\.[a-z]{2,3})?(?::.*)?$/i,
    /\s*[-|–|—|:]\s*Streetzen(?:\.co)?$/i,
    /\s*[-|–|—|:]\s*RHINOSHIELD(?:\s+France)?$/i,
    /\s*[-|–|—|:]\s*Maxesport(?:\s+France)?$/i,
    /\s*[-|–|—|:]\s*Displate(?:\.com)?$/i,
    /\s*[-|–|—|:]\s*Fnac(?:\.com)?$/i,
    /\s*[-|–|—|:]\s*Darty(?:\.com)?$/i,
    /\s*[-|–|—|:]\s*Boulanger(?:\.com)?$/i,
    /\s*[-|–|—|:]\s*Cdiscount(?:\.com)?$/i,
    /\s*[-|–|—|:]\s*Boutique(?:\s+officielle)?\s+LEGO[®\s]*(?:FR|US|DE)?$/i,
    /\s*[-|–|—|:]\s*LEGO(?:\.[a-z]{2,3})?$/i,
    /\s*[-|–|—|:]\s*Decathlon(?:\.[a-z]{2,3})?$/i,
    /\s*[-|–|—|:]\s*LDLC(?:\.[a-z]{2,3})?$/i,
    /\s*[-|–|—|:]\s*AliExpress$/i,
    /\s*[-|–|—|:]\s*Etsy(?:\s+France)?$/i,
    /\s*[-|–|—|:]\s*Zalando(?:\.[a-z]{2,3})?$/i,
    /\s*[-|–|—|:]\s*Apple(?:\s+\(FR\))?$/i,
    /\s*[-|–|—|:]\s*Nike(?:\.com)?$/i,
    /\s*[-|–|—|:]\s*Adidas(?:\.com)?$/i,
    /\s*[-|–|—|:]\s*Sephora(?:\.fr|\.com)?$/i,
    /\s*[-|–|—|:]\s*Zara$/i,
    /\s*[-|–|—|:]\s*Uniqlo$/i,
    /\s*[-|–|—|:]\s*ASOS$/i,
    /\s*[-|–|—|:]\s*Back\s*Market$/i,
    /\s*[-|–|—|:]\s*eBay(?:\.[a-z]{2,3})?$/i,
    /\s*[-|–|—|:]\s*TopAchat$/i,
    /\s*[-|–|—|:]\s*Materiel\.net$/i,
  ];

  for (const s of suffixes) {
    cleaned = cleaned.replace(s, '');
  }

  cleaned = cleaned.replace(/^Amazon(?:\.[a-z]{2,3})?\s*:\s*/i, '');
  cleaned = cleaned.replace(/^Streetzen(?:\.co)?\s*[-|–|—|:]\s*/i, '');
  cleaned = cleaned.replace(/^RHINOSHIELD(?:\s+France)?\s*[-|:]\s*/i, '');
  cleaned = cleaned.replace(/^Displate\s*[-|:]\s*/i, '');

  return cleaned.trim();
}

/**
 * Fallback to generate a clean product title from the URL slug when pages are blocked.
 */
function slugToTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return '';
    const candidate =
      segments.find(
        (s) =>
          s.length > 5 &&
          !/^(item|product|products|p|dp|gp|listing|buy|fr|en|fr-fr|en-us|de)$/i.test(s) &&
          !/^a\d+$/i.test(s) &&
          !/^w-\d+$/i.test(s)
      ) ||
      segments.reverse().find(
        (s) =>
          s.length > 3 &&
          !/^(item|product|products|p|dp|gp|listing|buy|fr|en|fr-fr|en-us|de)$/i.test(s) &&
          !/^a\d+$/i.test(s) &&
          !/^w-\d+$/i.test(s)
      );
    if (!candidate) return '';
    const words = candidate
      .replace(/\.(html|php|htm|asp)$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b[a-f0-9]{8,}\b/gi, '')
      .trim();
    if (!words) return '';
    return words
      .split(' ')
      .filter((w) => w.length > 0)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  } catch {
    return '';
  }
}

/**
 * Normalizes image URL, resolves relative paths, upgrades resolution,
 * and discards icons, tracking pixels, badges, SVGs.
 */
function normalizeImageUrl(rawUrl: string | undefined | null, baseUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let trimmed = rawUrl.trim();
  if (
    !trimmed ||
    trimmed.startsWith('data:') ||
    trimmed.includes('grey-pixel') ||
    trimmed.includes('placeholder') ||
    trimmed.includes('spinner') ||
    trimmed.includes('loading') ||
    trimmed.includes('logo') ||
    trimmed.includes('badge') ||
    trimmed.includes('payment') ||
    trimmed.includes('paypal') ||
    trimmed.includes('visa') ||
    trimmed.includes('icon') ||
    trimmed.includes('avatar') ||
    trimmed.includes('aplus-media') ||
    trimmed.includes('amazon-avatars') ||
    trimmed.includes('community-reviews') ||
    trimmed.includes('transparent') ||
    trimmed.includes('spacer') ||
    trimmed.includes('pixel') ||
    trimmed.includes('play-button') ||
    trimmed.includes('video') ||
    trimmed.includes('stars') ||
    trimmed.includes('rating') ||
    trimmed.includes('banner') ||
    trimmed.includes('sprite') ||
    trimmed.endsWith('.svg') ||
    /\b(blank|1x1|spacer)\.(gif|png|jpe?g)/i.test(trimmed)
  ) {
    return null;
  }

  try {
    trimmed = new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }

  // Reject invalid amazon.fr/dp/ relative image URLs
  if (trimmed.includes('amazon.') && (trimmed.includes('/dp/') || trimmed.includes('/gp/'))) {
    return null;
  }

  // Upgrade http:// to https://
  if (trimmed.startsWith('http://')) {
    trimmed = trimmed.replace(/^http:\/\//i, 'https://');
  }

  // Remove Amazon dynamic downscaling (e.g. ._AC_US40_.jpg -> .jpg)
  trimmed = trimmed.replace(/\._[A-Z0-9,_]+_\.(jpg|png|webp)$/i, '.$1');

  // Remove Shopify thumbnail downscaling (e.g. _100x100.jpg -> .jpg)
  trimmed = trimmed.replace(/_(?:pico|icon|thumb|small|compact|medium|large|grande|100x100|150x150|200x200|300x300|400x400|600x600)\.(jpg|png|webp)/i, '.$1');

  return trimmed;
}

/**
 * Translates option dimensions (Size, Color, etc.) into clean French labels.
 */
function translateDimension(dim: string): string {
  const lower = (dim || '').trim().toLowerCase();
  if (lower === 'size' || lower === 'sizes' || lower === 'size_name') return 'Taille';
  if (lower === 'shoe size' || lower === 'shoe sizes') return 'Pointure';
  if (lower === 'color' || lower === 'colour' || lower === 'colors' || lower === 'couleurs' || lower === 'color_name') return 'Couleur';
  if (lower === 'model' || lower === 'models' || lower === 'pattern' || lower === 'device') return 'Modèle';
  if (lower === 'capacity' || lower === 'storage' || lower === 'memory' || lower === 'rom' || lower === 'hard_disk_size') return 'Capacité';
  if (lower === 'ram') return 'RAM';
  if (lower === 'resolution' || lower === 'résolution' || lower === 'max_resolution') return 'Résolution';
  if (lower === 'style' || lower === 'styles' || lower === 'style_name') return 'Style';
  if (lower === 'edition' || lower === 'editions') return 'Édition';
  if (lower === 'finish' || lower === 'finition') return 'Finition';
  if (lower === 'frame' || lower === 'frames' || lower === 'cadre' || lower === 'cadres') return 'Cadre';
  if (lower === 'platform' || lower === 'plateforme') return 'Plateforme';
  if (lower === 'format' || lower === 'formats') return 'Format';
  if (lower === 'length' || lower === 'longueur') return 'Longueur';
  if (lower === 'width' || lower === 'largeur') return 'Largeur';
  if (lower === 'switch' || lower === 'switches') return 'Switch';
  if (lower === 'layout' || lower === 'disposition') return 'Disposition';
  if (lower === 'connection' || lower === 'connectivity' || lower === 'connexion') return 'Connexion';
  if (lower === 'content' || lower === 'volume' || lower === 'contenance') return 'Contenance';
  return dim.charAt(0).toUpperCase() + dim.slice(1);
}

/**
 * Dedicated LEGO set extractor querying the official Brickset set database.
 */
async function scrapeLego(url: string): Promise<ScrapedProduct | null> {
  const setMatch = url.match(/(?:product\/[a-z0-9_-]*-|product\/|sets\/)(\d{4,6})/i);
  if (!setMatch) return null;
  const setNumber = setMatch[1];

  try {
    const res = await fetch(`https://brickset.com/sets/${setNumber}-1`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    const rawTitle = $('h1').first().text().trim();
    const img = $('meta[property="og:image"]').attr('content') || '';
    const rrpText = $('dt:contains("RRP")').next('dd').text() || '';
    const price = parsePrice(rrpText);

    const images: string[] = [];
    if (img) images.push(img);
    $('a.highslide').each((_, el) => {
      const h = $(el).attr('href');
      if (h && !images.includes(h)) images.push(h);
    });

    if (rawTitle) {
      return {
        title: rawTitle,
        image: images[0] || '',
        images,
        price,
        options: `Set #${setNumber}`,
        availableOptions: {},
      };
    }
  } catch {
    // fallback
  }
  return null;
}

/**
 * Dedicated Displate metal poster extractor using __NEXT_DATA__.
 */
async function scrapeDisplate(url: string): Promise<ScrapedProduct | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    const nextDataText = $('#__NEXT_DATA__').text();
    if (!nextDataText) return null;

    const nextData = JSON.parse(nextDataText);
    const pageProps = nextData.props?.pageProps;
    if (!pageProps) return null;

    const pdp = pageProps.pdpGeneral || {};
    const prod = pdp.product || {};
    const sv = pageProps.selectedVariant || {};

    const rawTitle = prod.title || pdp.seo?.title || '';
    const author = prod.author?.name || '';
    const title = rawTitle ? (author && !rawTitle.includes(author) ? `${rawTitle} - ${author}` : rawTitle) : 'Displate Poster';

    const coreUrl = prod.imageCoreUrl;
    const image = coreUrl ? `https://cdn.displate.com/artwork/857x1200/${coreUrl}.jpg` : '';
    const images: string[] = [];
    if (image) images.push(image);

    let price: number | null = null;
    if (sv.currentVariant?.price?.amountInCurrency) {
      price = sv.currentVariant.price.amountInCurrency / 100;
    } else if (pdp.seo?.price) {
      price = parsePrice(pdp.seo.price);
    }

    const sizeMap: Record<string, string> = {
      M: 'M (45x32 cm)',
      L: 'L (67.5x48 cm)',
      XL: 'XL (90x64 cm)',
    };
    const typeMap: Record<string, string> = {
      matte: 'Matte',
      gloss: 'Brillante (Gloss)',
      textra: 'Textra 3D',
    };
    const frameMap: Record<string, string> = {
      none: 'Sans cadre',
      black: 'Cadre Noir',
      white: 'Cadre Blanc',
      graphite: 'Cadre Graphite',
      natural: 'Cadre Bois Naturel',
    };

    const availableOptions: Record<string, string[]> = {};
    if (Array.isArray(sv.availableSizes)) {
      availableOptions['Taille'] = sv.availableSizes.map((s: string) => sizeMap[s] || s);
    }
    if (Array.isArray(sv.availableTypes)) {
      availableOptions['Finition'] = sv.availableTypes.map((t: string) => typeMap[t] || t);
    }
    if (Array.isArray(sv.availableFrames)) {
      availableOptions['Cadre'] = sv.availableFrames.map((f: string) => frameMap[f] || f);
    }

    const pUrl = new URL(url);
    const qSize = pUrl.searchParams.get('size')?.toUpperCase();
    const qType = pUrl.searchParams.get('type') || pUrl.searchParams.get('finish');
    const qFrame = pUrl.searchParams.get('frame');

    const selectedList: string[] = [];
    if (qSize && sizeMap[qSize]) selectedList.push(`Taille: ${sizeMap[qSize]}`);
    if (qType && typeMap[qType]) selectedList.push(`Finition: ${typeMap[qType]}`);
    if (qFrame && frameMap[qFrame]) selectedList.push(`Cadre: ${frameMap[qFrame]}`);

    return {
      title: cleanTitle(title),
      image,
      images,
      price,
      options: selectedList.join(', '),
      availableOptions,
    };
  } catch {
    return null;
  }
}

/**
 * Dedicated Shopify API extractor preserving localized subpaths (e.g. /fr/products/...).
 */
async function scrapeShopify(url: string): Promise<ScrapedProduct | null> {
  try {
    const parsedUrl = new URL(url);
    const cleanPath = parsedUrl.pathname.replace(/\/+$/, '');
    const productPathMatch = cleanPath.match(/(.*\/products\/[a-zA-Z0-9_-]+)/);
    if (!productPathMatch) return null;

    const slug = cleanPath.split('/').filter(Boolean).pop();
    const candidateUrls = [
      `${parsedUrl.origin}${productPathMatch[1]}.json`,
      slug ? `${parsedUrl.origin}/products/${slug}.json` : null,
    ].filter(Boolean) as string[];

    interface ShopifyVariant {
      id?: string | number;
      price?: string | number;
      title?: string;
      option1?: string;
      option2?: string;
      option3?: string;
      featured_image?: { src?: string } | null;
      image_id?: number | string | null;
    }
    interface ShopifyOption {
      name?: string;
      values?: string[];
    }
    interface ShopifyProduct {
      title?: string;
      images?: Array<string | { src?: string }>;
      image?: { src?: string };
      variants?: ShopifyVariant[];
      options?: ShopifyOption[];
    }
    interface ShopifyResponse {
      product?: ShopifyProduct;
    }

    let data: ShopifyResponse | null = null;
    for (const jsonUrl of candidateUrls) {
      try {
        const res = await fetch(jsonUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json = (await res.json()) as ShopifyResponse;
          if (json && json.product) {
            data = json;
            break;
          }
        }
      } catch {}
    }

    if (!data || !data.product) return null;

    const p = data.product;
    const title = cleanTitle(p.title || '');
    const images: string[] = [];
    if (Array.isArray(p.images)) {
      p.images.forEach((img) => {
        const src = typeof img === 'string' ? img : img?.src;
        const u = normalizeImageUrl(src, url);
        if (u && !images.includes(u)) images.push(u);
      });
    } else if (p.image?.src) {
      const u = normalizeImageUrl(p.image.src, url);
      if (u) images.push(u);
    }

    let price: number | null = null;
    let selectedVariant = p.variants?.[0];
    const variantIdParam = parsedUrl.searchParams.get('variant');
    if (variantIdParam && Array.isArray(p.variants)) {
      const match = p.variants.find((v) => String(v.id) === variantIdParam);
      if (match) selectedVariant = match;
    }
    if (selectedVariant && selectedVariant.price) {
      price = parsePrice(selectedVariant.price);
    }

    // Elevate variant-specific image if present
    if (selectedVariant?.featured_image?.src) {
      const varImg = normalizeImageUrl(selectedVariant.featured_image.src, url);
      if (varImg) {
        const idx = images.indexOf(varImg);
        if (idx > -1) images.splice(idx, 1);
        images.unshift(varImg);
      }
    } else if (selectedVariant?.image_id && Array.isArray(p.images)) {
      const matchImg = p.images.find(
        (img) => typeof img === 'object' && img !== null && 'id' in img && String(img.id) === String(selectedVariant?.image_id)
      ) as { src?: string } | undefined;
      if (matchImg?.src) {
        const varImg = normalizeImageUrl(matchImg.src, url);
        if (varImg) {
          const idx = images.indexOf(varImg);
          if (idx > -1) images.splice(idx, 1);
          images.unshift(varImg);
        }
      }
    }

    const availableOptions: Record<string, string[]> = {};
    const selectedOptionsList: string[] = [];

    if (Array.isArray(p.options)) {
      p.options.forEach((opt, idx) => {
        const dimName = translateDimension(opt.name || `Option ${idx + 1}`);
        if (Array.isArray(opt.values)) {
          const vals = opt.values.map(String).filter((v: string) => v && v !== 'Default Title');
          if (vals.length > 0 && dimName !== 'Title') {
            availableOptions[dimName] = vals;
            const optKey = `option${idx + 1}` as keyof ShopifyVariant;
            const selectedVal = selectedVariant?.[optKey];
            if (selectedVal && selectedVal !== 'Default Title') {
              selectedOptionsList.push(`${dimName}: ${selectedVal}`);
            }
          }
        }
      });
    }

    if (Object.keys(availableOptions).length === 0 && Array.isArray(p.variants) && p.variants.length > 1) {
      const varTitles = p.variants
        .map((v) => v.title)
        .filter((t): t is string => Boolean(t && typeof t === 'string' && t !== 'Default Title'));
      if (varTitles.length > 0) {
        availableOptions['Option'] = Array.from(new Set(varTitles));
      }
    }

    if (selectedOptionsList.length === 0 && selectedVariant && selectedVariant.title && selectedVariant.title !== 'Default Title') {
      selectedOptionsList.push(selectedVariant.title);
    }

    // Default pre-fill if any dimension has no selection
    for (const [dim, vals] of Object.entries(availableOptions)) {
      if (!selectedOptionsList.some((o) => o.startsWith(`${dim}:`)) && vals.length > 0) {
        selectedOptionsList.push(`${dim}: ${vals[0]}`);
      }
    }

    return {
      title,
      image: images[0] || '',
      images,
      price,
      options: selectedOptionsList.join(', '),
      availableOptions,
    };
  } catch {
    return null;
  }
}

/**
 * Dedicated, resilient Streetzen extractor (https://streetzen.co).
 * Handles direct product URLs, collection-nested links, localized subpaths (en-fr, fr, etc.),
 * and provides a robust 2-tier extraction strategy:
 *  1. Direct Shopify JSON API with fast timeout (for instant variant, pricing, and image extraction)
 *  2. Rich HTML Document parsing with Schema.org JSON-LD, embedded Shopify JSON script tags,
 *     DOM variant selectors, and high-res image gallery deduplication.
 */
async function scrapeStreetzen(url: string): Promise<ScrapedProduct | null> {
  try {
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }

    const parsedUrl = new URL(cleanUrl);

    // Extract product handle from pathname (supports /products/handle, /collections/.../products/handle, percent-encoded slugs)
    const handleMatch = parsedUrl.pathname.match(/\/products\/([a-zA-Z0-9_%-]+)/);
    let handle = handleMatch ? handleMatch[1].replace(/\/+$/, '') : null;
    const variantIdParam = parsedUrl.searchParams.get('variant');

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'application/json, text/html, application/xhtml+xml, */*',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    };

    // ==========================================
    // Tier 1: Direct Shopify JSON API
    // ==========================================
    if (handle) {
      const candidateJsonUrls = [
        `https://streetzen.co/products/${handle}.json`,
        `${parsedUrl.origin}/products/${handle}.json`,
      ];

      for (const jsonUrl of Array.from(new Set(candidateJsonUrls))) {
        try {
          const res = await fetch(jsonUrl, {
            headers,
            signal: AbortSignal.timeout(5000),
          });

          if (res.ok) {
            interface ShopifyVariant {
              id?: string | number;
              price?: string | number;
              title?: string;
              option1?: string;
              option2?: string;
              option3?: string;
              featured_image?: { src?: string } | null;
            }
            interface ShopifyProduct {
              title?: string;
              images?: Array<string | { src?: string }>;
              image?: { src?: string };
              variants?: ShopifyVariant[];
              options?: Array<{ name?: string; values?: string[] }>;
            }

            const data = (await res.json()) as { product?: ShopifyProduct };
            const p = data?.product;
            if (p && p.title) {
              const title = cleanTitle(p.title);
              const images: string[] = [];

              if (Array.isArray(p.images)) {
                p.images.forEach((img) => {
                  const src = typeof img === 'string' ? img : img?.src;
                  const u = normalizeImageUrl(src, cleanUrl);
                  if (u && !images.includes(u)) images.push(u);
                });
              } else if (p.image?.src) {
                const u = normalizeImageUrl(p.image.src, cleanUrl);
                if (u && !images.includes(u)) images.push(u);
              }

              let price: number | null = null;
              let selectedVariant = p.variants?.[0];
              if (variantIdParam && Array.isArray(p.variants)) {
                const match = p.variants.find((v) => String(v.id) === variantIdParam);
                if (match) selectedVariant = match;
              }

              if (selectedVariant?.price !== undefined) {
                let parsedP = parseFloat(String(selectedVariant.price));
                if (!isNaN(parsedP)) {
                  if (parsedP > 1000 && Number.isInteger(parsedP)) parsedP /= 100;
                  price = parsedP;
                }
              }

              // Elevate variant image if available
              if (selectedVariant?.featured_image?.src) {
                const varImg = normalizeImageUrl(selectedVariant.featured_image.src, cleanUrl);
                if (varImg) {
                  const idx = images.indexOf(varImg);
                  if (idx > -1) images.splice(idx, 1);
                  images.unshift(varImg);
                }
              }

              const availableOptions: Record<string, string[]> = {};
              const selectedOptionsList: string[] = [];

              if (Array.isArray(p.options)) {
                p.options.forEach((opt, idx) => {
                  const dimName = translateDimension(opt.name || `Option ${idx + 1}`);
                  if (Array.isArray(opt.values)) {
                    const vals = opt.values.map(String).filter((v) => v && v !== 'Default Title');
                    if (vals.length > 0 && dimName !== 'Title') {
                      availableOptions[dimName] = vals;
                      const optKey = `option${idx + 1}` as keyof ShopifyVariant;
                      const selectedVal = selectedVariant?.[optKey];
                      if (selectedVal && selectedVal !== 'Default Title') {
                        selectedOptionsList.push(`${dimName}: ${selectedVal}`);
                      }
                    }
                  }
                });
              }

              for (const [dim, vals] of Object.entries(availableOptions)) {
                if (!selectedOptionsList.some((o) => o.startsWith(`${dim}:`)) && vals.length > 0) {
                  selectedOptionsList.push(`${dim}: ${vals[0]}`);
                }
              }

              return {
                title,
                image: images[0] || '',
                images: images.slice(0, 10),
                price,
                options: selectedOptionsList.join(', '),
                availableOptions,
              };
            }
          }
        } catch {
          // Continue to next JSON or Tier 2 HTML
        }
      }
    }

    // ==========================================
    // Tier 2: HTML Page Fetch & Deep Extraction
    // ==========================================
    const pageRes = await fetch(cleanUrl, {
      headers,
      signal: AbortSignal.timeout(6000),
      redirect: 'follow',
    });

    if (!pageRes.ok) return null;
    const html = await pageRes.text();
    const $ = cheerio.load(html);

    // If initial URL had no handle, check canonical URL or collection links
    if (!handle) {
      const canonical = $('link[rel="canonical"]').attr('href');
      const canonicalMatch = canonical?.match(/\/products\/([a-zA-Z0-9_%-]+)/);
      if (canonicalMatch) {
        handle = canonicalMatch[1];
      } else {
        const firstProdLink = $('a[href*="/products/"]').first().attr('href');
        const firstMatch = firstProdLink?.match(/\/products\/([a-zA-Z0-9_%-]+)/);
        if (firstMatch) handle = firstMatch[1];
      }
    }

    let title = '';
    let price: number | null = null;
    const images: string[] = [];
    const availableOptions: Record<string, string[]> = {};
    const selectedOptionsList: string[] = [];

    // Title from OpenGraph or Title tag
    const ogTitle = $('meta[property="og:title"]').attr('content') || $('title').text();
    if (ogTitle) title = cleanTitle(ogTitle);

    // 1. Check Schema.org JSON-LD
    interface JsonLdOffer {
      price?: string | number;
      priceCurrency?: string;
    }
    interface JsonLdProd {
      name?: string;
      offers?: JsonLdOffer | JsonLdOffer[];
      image?: string | string[] | { url?: string };
      [key: string]: unknown;
    }

    let ldProduct: JsonLdProd | null = null;
    for (const el of $('script[type="application/ld+json"]').toArray()) {
      try {
        const parsed = JSON.parse($(el).text().trim()) as Record<string, unknown>;
        const type = parsed['@type'];
        if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
          ldProduct = parsed as JsonLdProd;
          break;
        }
      } catch {}
    }

    if (ldProduct) {
      const prod = ldProduct as JsonLdProd;
      if (!title && prod.name) title = cleanTitle(prod.name);
      if (prod.offers) {
        const offers = Array.isArray(prod.offers) ? prod.offers : [prod.offers];
        const offer = offers[0];
        if (offer?.price !== undefined) {
          const p = parseFloat(String(offer.price));
          if (!isNaN(p) && p > 0) price = p;
        }
      }
      if (prod.image) {
        const addLdImg = (im: unknown) => {
          const raw = typeof im === 'string' ? im : (im as { url?: string })?.url;
          const u = normalizeImageUrl(raw, cleanUrl);
          if (u && !images.includes(u)) images.push(u);
        };
        if (Array.isArray(prod.image)) prod.image.forEach(addLdImg);
        else addLdImg(prod.image);
      }
    }

    // 2. Check embedded Shopify product JSON scripts
    interface EmbeddedVariant {
      id?: string | number;
      price?: string | number;
      options?: string[];
    }
    interface EmbeddedOption {
      name?: string;
      defaultName?: string;
      values?: string[];
      optionValues?: Array<{ name?: string; value?: string; label?: string }>;
    }
    interface EmbeddedProd {
      handle?: string;
      title?: string;
      price?: string | number;
      variants?: EmbeddedVariant[];
      options?: EmbeddedOption[];
      images?: Array<string | { src?: string }>;
    }

    let embeddedProduct: EmbeddedProd | null = null;
    for (const el of $('script[type="application/json"]').toArray()) {
      try {
        const text = $(el).text().trim();
        if (text.length < 50) continue;
        const parsed = JSON.parse(text) as EmbeddedProd;
        if (parsed && (parsed.handle || parsed.variants) && (parsed.title || parsed.options)) {
          embeddedProduct = parsed;
          break;
        }
      } catch {}
    }

    if (embeddedProduct) {
      const prod = embeddedProduct as EmbeddedProd;
      if (!title && prod.title) title = cleanTitle(prod.title);

      if (price === null && Array.isArray(prod.variants) && prod.variants.length > 0) {
        let v = prod.variants[0];
        if (variantIdParam) {
          const match = prod.variants.find((item: EmbeddedVariant) => String(item.id) === variantIdParam);
          if (match) v = match;
        }
        if (v?.price !== undefined) {
          let p = parseFloat(String(v.price));
          if (p > 1000 && Number.isInteger(p)) p /= 100;
          if (!isNaN(p) && p > 0) price = p;
        }
      }

      if (Array.isArray(prod.images)) {
        prod.images.forEach((im: string | { src?: string }) => {
          const src = typeof im === 'string' ? im : im?.src;
          const u = normalizeImageUrl(src, cleanUrl);
          if (u && !images.includes(u)) images.push(u);
        });
      }

      if (Array.isArray(prod.options)) {
        prod.options.forEach((opt: EmbeddedOption, idx: number) => {
          const dimName = translateDimension(opt.name || opt.defaultName || `Option ${idx + 1}`);
          let vals: string[] = [];
          if (Array.isArray(opt.optionValues)) {
            vals = opt.optionValues
              .map((v: { name?: string; value?: string; label?: string }) => v.name || v.value || v.label)
              .filter((v): v is string => Boolean(v));
          } else if (Array.isArray(opt.values)) {
            vals = opt.values.map(String).filter(Boolean);
          }
          if (vals.length > 0 && dimName !== 'Title') {
            availableOptions[dimName] = vals;
            if (!selectedOptionsList.some((o) => o.startsWith(dimName))) {
              selectedOptionsList.push(`${dimName}: ${vals[0]}`);
            }
          }
        });
      }
    }

    // 3. Fallback price from variant select options or HTML text
    if (price === null) {
      $('select.product-single__variants option, form[action*="/cart/add"] option').each((_, el) => {
        const optText = $(el).text();
        const match = optText.match(/([€$£])\s*(\d+[.,]\d{2})|(\d+[.,]\d{2})\s*([€$£]|EUR|USD)/i);
        if (match && price === null) {
          const numStr = (match[2] || match[3]).replace(',', '.');
          const p = parseFloat(numStr);
          if (!isNaN(p) && p > 0) price = p;
        }
      });
    }

    // 4. OpenGraph image fallback
    const ogImg = $('meta[property="og:image"]').attr('content');
    if (ogImg) {
      const u = normalizeImageUrl(ogImg, cleanUrl);
      if (u && !images.includes(u)) images.unshift(u);
    }

    // 5. DOM Gallery images (excluding icons and non-product graphics)
    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-photoswipe-src');
      if (src && (src.includes('cdn/shop/files') || src.includes('cdn.shopify.com/s/files'))) {
        const lower = src.toLowerCase();
        if (
          !lower.includes('logo') &&
          !lower.includes('icon') &&
          !lower.includes('badge') &&
          !lower.includes('png-02') &&
          !lower.includes('png-03')
        ) {
          const cleanSrc = normalizeImageUrl(src.replace(/_(?:small|compact|medium|thumb)\./i, '.'), cleanUrl);
          if (cleanSrc && !images.includes(cleanSrc)) images.push(cleanSrc);
        }
      }
    });

    // 6. DOM Options fallback (fieldset.variant-input-wrap)
    if (Object.keys(availableOptions).length === 0) {
      $('fieldset.variant-input-wrap').each((_, el) => {
        const rawDim = $(el).attr('name') || $(el).find('legend').text().trim() || 'Option';
        const cleanDim = translateDimension(rawDim);
        const vals: string[] = [];
        $(el).find('input[type="radio"], label').each((__, inp) => {
          const val = $(inp).attr('value') || $(inp).text().trim();
          if (val && !vals.includes(val) && val.length < 30) vals.push(val);
        });
        if (vals.length > 0) {
          availableOptions[cleanDim] = vals;
          if (!selectedOptionsList.some((o) => o.startsWith(cleanDim))) {
            selectedOptionsList.push(`${cleanDim}: ${vals[0]}`);
          }
        }
      });
    }

    if (!title) {
      const h1 = $('h1.product-single__title, h1.product__title, h1').first().text().trim();
      if (h1) title = cleanTitle(h1);
    }

    return {
      title: title || 'Streetzen Produit',
      image: images[0] || '',
      images: images.slice(0, 10),
      price,
      options: selectedOptionsList.join(', '),
      availableOptions,
    };
  } catch {
    return null;
  }
}

/**
 * Universal multi-platform product URL scraper.
 * Supports Amazon, Lego, Streetzen, Shopify stores (Maxesport, etc.), Rhinoshield, Fnac, Darty,
 * Boulanger, Cdiscount, Sephora, Zara, Nike, Decathlon, and all Schema.org/OpenGraph stores.
 */
export async function scrapeProductUrl(rawUrl: string): Promise<ScrapedProduct> {
  try {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return {
        title: '',
        image: '',
        images: [],
        price: null,
        options: '',
        availableOptions: {},
      };
    }

    let url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    // 1. Specialized Adapter: LEGO
    if (url.includes('lego.com')) {
      const legoResult = await scrapeLego(url);
      if (legoResult) return legoResult;
    }

    // 2. Specialized Adapter: Displate
    if (url.includes('displate.com')) {
      const displateResult = await scrapeDisplate(url);
      if (displateResult) return displateResult;
    }

    // 3. Specialized Adapter: Streetzen
    if (url.includes('streetzen.co')) {
      const streetzenResult = await scrapeStreetzen(url);
      if (streetzenResult) return streetzenResult;
    }

    // 4. Specialized Adapter: Shopify Stores (Maxesport, apparel, gaming brands)
    if (url.includes('/products/') || url.includes('/produits/')) {
      const shopifyResult = await scrapeShopify(url);
      if (shopifyResult) return shopifyResult;
    }

    // 5. Amazon ASIN Check
    const amazonMatch = url.match(/(?:dp|gp\/product|\/p)\/([A-Z0-9]{10})/i);
    const amazonAsin = amazonMatch ? amazonMatch[1] : null;

    // 5. HTTP Fetch with Multi-Level Anti-Bot Bypass
    const isAmazon = url.includes('amazon.');
    const headers: Record<string, string> = {
      'User-Agent': isAmazon
        ? 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    };

    // Essential session cookie for bypassing Amazon CloudFront
    if (isAmazon) {
      headers['Cookie'] = 'session-id=258-1234567-8901234; i18n-prefs=EUR; sp-cdn="L5Z9:FR"';
    }

    let html = '';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
      clearTimeout(timeoutId);
      html = await response.text();

      const isBotBlocked =
        html.includes('validateCaptcha') ||
        html.includes('Robot Check') ||
        (url.includes('amazon.') && html.includes('api-services-support@amazon.com'));

      if (isBotBlocked || !response.ok) {
        // Fallback with Mobile Safari headers
        const fallbackHeaders = {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9',
          Cookie: headers['Cookie'] || '',
        };
        const retryRes = await fetch(url, { headers: fallbackHeaders, redirect: 'follow' });
        if (retryRes.ok) {
          const retryHtml = await retryRes.text();
          if (!retryHtml.includes('validateCaptcha')) {
            html = retryHtml;
          }
        }
      }
    } catch {
      // network or abort error: will fall back to ASIN / URL slug
    }

    const $ = cheerio.load(html || '');

    // --- Title Extraction ---
    let title = '';

    // 1. Amazon #productTitle
    const amazonTitle = $('#productTitle').text().trim();
    if (amazonTitle) title = decodeHtmlEntities(amazonTitle);

    // 2. OpenGraph / Twitter title
    if (!title) {
      const ogTitle = $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content');
      if (ogTitle) title = cleanTitle(ogTitle);
    }

    // 3. Schema.org JSON-LD
    interface JsonLdProduct {
      name?: string;
      headline?: string;
      image?: unknown;
      offers?: unknown;
      hasVariant?: unknown;
      variants?: unknown;
      [key: string]: unknown;
    }

    const getJsonLdProduct = (): JsonLdProduct | null => {
      let best: JsonLdProduct | null = null;
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const parsed = JSON.parse($(el).text().trim()) as unknown;
          const findProduct = (obj: unknown) => {
            if (!obj || typeof obj !== 'object') return;
            const rec = obj as JsonLdProduct;
            const type = rec['@type'];
            const isProd =
              type === 'Product' ||
              type === 'ProductGroup' ||
              type === 'ProductModel' ||
              (Array.isArray(type) && (type.includes('Product') || type.includes('ProductGroup')));
            if (isProd && (!best || (rec.offers && !best.offers) || (rec.image && !best.image))) {
              best = rec;
            }
            if (rec.mainEntity) findProduct(rec.mainEntity);
            if (Array.isArray(obj)) obj.forEach(findProduct);
            if (rec['@graph'] && Array.isArray(rec['@graph'])) rec['@graph'].forEach(findProduct);
          };
          findProduct(parsed);
        } catch {}
      });
      return best;
    };

    const jsonLdProduct = getJsonLdProduct();

    if (!title && jsonLdProduct) {
      title = cleanTitle(String(jsonLdProduct.name || jsonLdProduct.headline || ''));
    }

    // 4. Next.js __NEXT_DATA__
    interface NextDataProduct {
      title?: string;
      name?: string;
      image?: unknown;
      images?: unknown;
      price?: unknown;
      currentPrice?: unknown;
      offers?: unknown;
      [key: string]: unknown;
    }

    const getNextDataProduct = (): NextDataProduct | null => {
      const nextDataText = $('#__NEXT_DATA__').text();
      if (!nextDataText) return null;
      try {
        const nextData = JSON.parse(nextDataText) as { props?: { pageProps?: Record<string, unknown> } };
        const pp = nextData.props?.pageProps;
        const pdpGeneral = pp?.pdpGeneral as Record<string, unknown> | undefined;
        const dataProp = pp?.data as Record<string, unknown> | undefined;
        const candidate = (pp?.product || pdpGeneral?.product || dataProp?.product || pp?.item) as NextDataProduct | undefined;
        return candidate && typeof candidate === 'object' ? candidate : null;
      } catch {
        return null;
      }
    };

    const nextDataProduct = getNextDataProduct();
    if (!title && nextDataProduct) {
      title = cleanTitle(String(nextDataProduct.title || nextDataProduct.name || ''));
    }

    // 5. DOM H1 or <title>
    if (!title) {
      const h1Text = $('h1.product-title, h1.product-name, h1.product__title, h1[itemprop="name"], h1').first().text().trim();
      if (h1Text) title = cleanTitle(h1Text);
    }
    if (!title) {
      const titleTag = $('title').text().trim();
      if (titleTag) title = cleanTitle(titleTag);
    }

    // 6. Safety fallback to URL slug
    const isGenericOrBlockedTitle =
      !title ||
      title.toLowerCase() === 'amazon.fr' ||
      title.toLowerCase() === 'amazon.com' ||
      title.toLowerCase().includes('robot check') ||
      title.toLowerCase().includes('captcha') ||
      title.toLowerCase().includes('access denied') ||
      title.toLowerCase().includes('forbidden') ||
      title.toLowerCase().includes('just a moment') ||
      title.toLowerCase().includes('page introuvable') ||
      title.toLowerCase().includes('404') ||
      title.toLowerCase().includes('protection ultime') ||
      /^[a-z0-9-]+\.[a-z]{2,4}$/i.test(title.trim());

    if (isGenericOrBlockedTitle) {
      const slugTitle = slugToTitle(url);
      if (slugTitle) title = slugTitle;
    }

    // --- Images Extraction ---
    const images: string[] = [];
    const seenImageKeys = new Set<string>();
    const addUrl = (raw: string | undefined | null) => {
      const norm = normalizeImageUrl(raw, url);
      if (!norm) return;
      const amazonImageMatch = norm.match(/\/images\/[IP]\/([A-Za-z0-9+_-]+)\./);
      const key = amazonImageMatch ? amazonImageMatch[1] : norm.split('?')[0];
      if (!seenImageKeys.has(key) && !images.includes(norm)) {
        seenImageKeys.add(key);
        images.push(norm);
      }
    };

    // 1. Amazon ColorImages and Gallery
    if (url.includes('amazon.')) {
      let parsedFromColorImages = false;
      const scriptRegex = /'colorImages':\s*\{\s*'initial':\s*(?:A\.\$\.parseJSON\('((?:\\.|[^'\\])*)'\)|(\[\{.+?\}\]))/;
      const match = html.match(scriptRegex);
      if (match) {
        const rawJson = match[1] ? match[1].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\') : match[2];
        try {
          const parsed = JSON.parse(rawJson) as Array<{ hiRes?: string; large?: string; main?: string }>;
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              addUrl(item.hiRes || item.large || item.main);
            }
            parsedFromColorImages = images.length > 0;
          }
        } catch {}
      }

      // If colorImages was not found in the script, fall back to DOM gallery
      if (!parsedFromColorImages) {
        addUrl($('#landingImage').attr('data-old-hires'));
        addUrl($('#landingImage').attr('src'));
        addUrl($('#imgBlkFront').attr('src'));
        const dynamicData = $('#landingImage').attr('data-a-dynamic-image');
        if (dynamicData) {
          try {
            const parsed = JSON.parse(decodeHtmlEntities(dynamicData)) as Record<string, unknown>;
            for (const u of Object.keys(parsed)) addUrl(u);
          } catch {}
        }

        // Amazon altImages thumbnails
        $('#altImages ul li.imageThumbnail img, #altImages ul li.item img').each((_, el) => {
          addUrl($(el).attr('src'));
        });

        // Fallback: ONLY if no images were found from the page, use the base ASIN image
        if (images.length === 0 && amazonAsin) {
          addUrl(`https://images-na.ssl-images-amazon.com/images/P/${amazonAsin}.01.jpg`);
        }
      }
    }

    // 2-6. Schema.org, NextData, OpenGraph, and DOM Gallery images (for non-Amazon sites or fallback)
    if (!url.includes('amazon.') || images.length === 0) {
      // 2. Schema.org JSON-LD images
      if (jsonLdProduct && jsonLdProduct.image) {
        if (Array.isArray(jsonLdProduct.image)) {
          jsonLdProduct.image.forEach((img: unknown) => {
            const u = typeof img === 'string' ? img : (img as { url?: string; contentUrl?: string })?.url || (img as { url?: string; contentUrl?: string })?.contentUrl;
            addUrl(u);
          });
        } else if (typeof jsonLdProduct.image === 'string') {
          addUrl(jsonLdProduct.image);
        } else if (typeof jsonLdProduct.image === 'object' && jsonLdProduct.image !== null) {
          const imgObj = jsonLdProduct.image as { url?: string; contentUrl?: string };
          addUrl(imgObj.url || imgObj.contentUrl);
        }
      }

      // 3. Next.js __NEXT_DATA__ images
      if (nextDataProduct) {
        if (typeof nextDataProduct.image === 'string') addUrl(nextDataProduct.image);
        if (Array.isArray(nextDataProduct.images)) {
          nextDataProduct.images.forEach((img: unknown) => {
            const u = typeof img === 'string' ? img : (img as { url?: string; src?: string })?.url || (img as { url?: string; src?: string })?.src;
            addUrl(u);
          });
        }
      }

      // 4. OpenGraph & Twitter images
      addUrl($('meta[property="og:image"]').attr('content'));
      addUrl($('meta[property="og:image:secure_url"]').attr('content'));
      addUrl($('meta[name="twitter:image"]').attr('content'));
      addUrl($('meta[name="twitter:image:src"]').attr('content'));
      addUrl($('link[rel="image_src"]').attr('href'));

      // 5. DOM Gallery images (from product gallery containers only)
      $(
        '.product-gallery img, .product-media img, .product-images img, .pdp-images img, [data-gallery] img, .gallery img, .product-single__media img, .woocommerce-product-gallery img'
      ).each((_, el) => {
        const src =
          $(el).attr('data-zoom-image') ||
          $(el).attr('data-large-src') ||
          $(el).attr('data-high-res-src') ||
          $(el).attr('data-src') ||
          $(el).attr('src');
        addUrl(src);
      });

      // 6. Parse srcset for high-res images
      $('picture source[srcset], img[srcset]').each((_, el) => {
        const srcset = $(el).attr('srcset');
        if (srcset) {
          const parts = srcset.split(',').map((p) => p.trim());
          const last = parts[parts.length - 1];
          if (last) {
            const u = last.split(' ')[0];
            addUrl(u);
          }
        }
      });
    }

    // --- Price Extraction ---
    let price: number | null = null;

    // 1. Amazon specific price
    const amazonPriceText =
      $('#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-strike) .a-offscreen').first().text().trim() ||
      $('#corePrice_feature_div .a-price:not(.a-text-strike) .a-offscreen').first().text().trim() ||
      $('#apex_desktop .a-price:not(.a-text-strike) .a-offscreen').first().text().trim() ||
      $('#booksHeaderSection .a-price:not(.a-text-strike) .a-offscreen').first().text().trim() ||
      $('.a-price:not(.a-text-strike) .a-offscreen').first().text().trim();

    if (amazonPriceText) {
      price = parsePrice(amazonPriceText);
    }

    // 2. Schema.org JSON-LD Price
    if (price === null && jsonLdProduct && jsonLdProduct.offers) {
      const off = jsonLdProduct.offers as Array<Record<string, unknown>> | Record<string, unknown> | undefined;
      if (Array.isArray(off)) {
        for (const o of off) {
          const spec = o.priceSpecification as Record<string, unknown> | undefined;
          const p = parsePrice((o.price ?? o.lowPrice ?? o.highPrice ?? spec?.price) as string | number | null);
          if (p !== null) {
            price = p;
            break;
          }
        }
      } else if (typeof off === 'object' && off !== null) {
        const spec = off.priceSpecification as Record<string, unknown> | undefined;
        price = parsePrice((off.price ?? off.lowPrice ?? off.highPrice ?? spec?.price) as string | number | null);
      }
    }

    // 3. Next.js __NEXT_DATA__ price
    if (price === null && nextDataProduct) {
      const off = nextDataProduct.offers as Record<string, unknown> | undefined;
      const priceObj = nextDataProduct.price as Record<string, unknown> | undefined;
      price = parsePrice(
        (nextDataProduct.price ??
          nextDataProduct.currentPrice ??
          off?.price ??
          priceObj?.amount) as string | number | null
      );
    }

    // 4. Meta tags: product:price:amount or og:price:amount
    if (price === null) {
      const metaPrice =
        $('meta[property="product:price:amount"]').attr('content') ||
        $('meta[property="og:price:amount"]').attr('content') ||
        $('meta[name="twitter:data1"]').attr('content') ||
        $('meta[itemprop="price"]').attr('content');
      if (metaPrice) price = parsePrice(metaPrice);
    }

    // 5. Microdata itemprop="price"
    if (price === null) {
      const microVal = $('[itemprop="price"]').attr('content') || $('[itemprop="price"]').text();
      if (microVal) price = parsePrice(microVal);
    }

    // 6. Common e-commerce DOM price selectors
    if (price === null) {
      const selectorPrice = $(
        '.price--current, .current-price, .product__price, .product-price, .price-item--sale, .product-price__current, [data-product-price], [data-price], [data-test="product-price"], .price-sales, .sales-price, .special-price'
      )
        .first()
        .text();
      if (selectorPrice) price = parsePrice(selectorPrice);
    }

    // 7. General text regex fallback for currency patterns
    if (price === null && html) {
      const cleanedText = html.replace(/\u00A0|&nbsp;/g, ' ');
      const currencyMatches = [...cleanedText.matchAll(/([0-9]{1,4}(?:[.,][0-9]{2})?)\s*€/g)];
      if (currencyMatches.length > 0) {
        for (const m of currencyMatches) {
          const p = parsePrice(m[0]);
          if (p !== null && p > 1 && p < 10000) {
            price = p;
            break;
          }
        }
      }
    }

    // --- Options & Variants Extraction ---
    const availableOptions: Record<string, string[]> = {};
    const selectedOptionsList: string[] = [];

    const addSelected = (dim: string, val: string) => {
      const cleanDim = translateDimension(dim);
      const cleanVal = (val || '').trim();
      if (cleanDim && cleanVal && !selectedOptionsList.some((o) => o.startsWith(`${cleanDim}:`))) {
        selectedOptionsList.push(`${cleanDim}: ${cleanVal}`);
      }
    };

    const addAvailable = (dim: string, vals: string[]) => {
      const cleanDim = translateDimension(dim);
      if (!cleanDim || !vals || vals.length === 0) return;
      const cleanVals = vals.map((v) => String(v).trim()).filter(Boolean);
      if (cleanVals.length > 0) {
        const existing = availableOptions[cleanDim] || [];
        availableOptions[cleanDim] = Array.from(new Set([...existing, ...cleanVals]));
      }
    };

    // 1. Amazon variation values & dimensionValuesDisplayData
    if (url.includes('amazon.')) {
      const varMatch = html.match(/"variationValues"\s*:\s*(\{[^;]+?\})\s*,\s*"\w+"/);
      if (varMatch) {
        try {
          const varObj = JSON.parse(varMatch[1]) as Record<string, string[]>;
          for (const [rawDim, vals] of Object.entries(varObj)) {
            if (Array.isArray(vals)) addAvailable(rawDim, vals);
          }
        } catch {}
      }

      const dimMatch = html.match(/"dimensionValuesDisplayData"\s*:\s*(\{[^;]+?\})\s*,\s*"\w+"/);
      if (dimMatch && amazonAsin) {
        try {
          const dimObj = JSON.parse(dimMatch[1]) as Record<string, string[]>;
          const currentVals = dimObj[amazonAsin];
          if (Array.isArray(currentVals)) {
            currentVals.forEach((val, i) => {
              const dims = Object.keys(availableOptions);
              const dimName = dims[i] || 'Couleur';
              addSelected(dimName, val);
            });
          }
        } catch {}
      }
    }

    // 2. Swatches (Amazon, etc.)
    $('div[id^="variation_"]').each((_, el) => {
      const rawId = $(el).attr('id') || '';
      const dim = translateDimension(rawId.replace(/^variation_/, '').replace(/_name$/, '').replace(/_/g, ' '));
      const selection = $(el).find('.selection').text().trim();
      if (selection) addSelected(dim, selection);

      const values: string[] = [];
      $(el)
        .find('li[title], img[alt], button')
        .each((_, item) => {
          const val = $(item).attr('title') || $(item).attr('alt') || $(item).text();
          const clean = (val || '').replace(/^(?:Cliquez pour sélectionner|Click to select)\s*/i, '').trim();
          if (clean && !values.includes(clean) && clean.length < 40) values.push(clean);
        });
      if (values.length > 0) addAvailable(dim, values);
    });

    // 3. Technical specifications table (Couleur, Taille, Résolution, Capacité, Pointure)
    $('#productDetails_techSpec_section_1 tr, #technicalSpecifications_section_1 tr, .prodDetTable tr, table.spec-table tr').each((_, tr) => {
      const key = $(tr).find('th, td:first-child').text().trim().toLowerCase();
      const val = $(tr).find('td:last-child').text().trim();
      if (!key || !val || val.length > 60) return;

      if (/couleur|color/i.test(key)) {
        addSelected('Couleur', val);
        addAvailable('Couleur', [val]);
      } else if (/taille|dimensions?\s+du\s+produit/i.test(key) && !/cm|mm/i.test(val)) {
        addSelected('Taille', val);
        addAvailable('Taille', [val]);
      } else if (/résolution|resolution/i.test(key)) {
        addSelected('Résolution', val);
        addAvailable('Résolution', [val]);
      } else if (/stockage|capacit|memory|storage|disque dur/i.test(key)) {
        addSelected('Capacité', val);
        addAvailable('Capacité', [val]);
      } else if (/pointure/i.test(key)) {
        addSelected('Pointure', val);
        addAvailable('Pointure', [val]);
      }
    });

    // 4. JSON-LD variants
    if (jsonLdProduct) {
      const variants = (jsonLdProduct.hasVariant || jsonLdProduct.variants) as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(variants)) {
        for (const v of variants) {
          if (!v || typeof v !== 'object') continue;
          if (v.color) addAvailable('Couleur', [String(v.color).trim()]);
          if (v.size) addAvailable('Taille', [String(v.size).trim()]);
          if (v.material) addAvailable('Matière', [String(v.material).trim()]);
          if (v.pattern) addAvailable('Modèle', [String(v.pattern).trim()]);
          if (v.image) {
            const u = typeof v.image === 'string' ? v.image : (v.image as { url?: string })?.url;
            addUrl(u);
          }
        }
      }
    }

    // 5. URL query parameters
    try {
      const pUrl = new URL(url);
      const dev = pUrl.searchParams.get('device') || pUrl.searchParams.get('model');
      if (dev) {
        const cleanDev = dev.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        addSelected('Modèle', cleanDev);
        addAvailable('Modèle', [cleanDev]);
      }
      const col = pUrl.searchParams.get('color') || pUrl.searchParams.get('couleur');
      if (col) {
        const cleanCol = col.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        addSelected('Couleur', cleanCol);
        addAvailable('Couleur', [cleanCol]);
      }
      const sz = pUrl.searchParams.get('size') || pUrl.searchParams.get('taille');
      if (sz) {
        const cleanSz = sz.replace(/-/g, ' ').toUpperCase();
        addSelected('Taille', cleanSz);
        addAvailable('Taille', [cleanSz]);
      }
    } catch {}

    // 6. Regex in title & URL for resolution, capacity, color, size
    const fullText = `${title} ${url}`;
    const colMatch = fullText.match(/\b(?:Couleur|Color)\s*[:\s-]\s*([a-zA-ZÀ-ÿ\s-]+?)(?:[;,|–\.]|\s+-\s+|$|\s+(?:avec|pour|de|et)\b)/i);
    if (colMatch && colMatch[1].trim().length < 25) {
      addSelected('Couleur', colMatch[1].trim());
      addAvailable('Couleur', [colMatch[1].trim()]);
    }
    const szMatch = fullText.match(/\b(?:Taille|Size)\s*[:\s-]\s*([a-zA-Z0-9À-ÿ\s/]+?)(?:[;,|–\.]|\s+-\s+|$|\s+(?:avec|pour|de|et)\b)/i);
    if (szMatch && szMatch[1].trim().length < 20) {
      addSelected('Taille', szMatch[1].trim());
      addAvailable('Taille', [szMatch[1].trim()]);
    }
    const resMatch = fullText.match(/\b(4K\s*UHD|4K|1440p|1080p|QHD|WQHD|FHD|2160p|2560\s*x\s*1440|3840\s*x\s*2160|1920\s*x\s*1080)\b/i);
    if (resMatch && resMatch[1]) {
      addSelected('Résolution', resMatch[1].toUpperCase());
      addAvailable('Résolution', [resMatch[1].toUpperCase()]);
    }
    const capMatch = fullText.match(/\b(64\s*Go|128\s*Go|256\s*Go|512\s*Go|1\s*To|2\s*To|64\s*GB|128\s*GB|256\s*GB|512\s*GB|1\s*TB|2\s*TB)\b/i);
    if (capMatch && capMatch[1]) {
      addSelected('Capacité', capMatch[1]);
      addAvailable('Capacité', [capMatch[1]]);
    }

    // 7. HTML Select elements
    $('select').each((_, el) => {
      if (
        $(el).closest(
          'header, nav, footer, #navbar, #nav-belt, #nav-main, form[action*="/search"], .search, .footer, .sidebar, #nav-search-dropdown-card'
        ).length > 0
      ) {
        return;
      }
      const nameOrId = ($(el).attr('name') || $(el).attr('id') || $(el).attr('aria-label') || '').toLowerCase();
      if (
        /quantity|quantite|\bqty\b|sort|rating|country|pays|currency|devise|lang|shipping|billing|search|category|categorie|offlinestore|feedback/i.test(
          nameOrId
        )
      ) {
        return;
      }

      let dimName = '';
      if (/color|couleur/i.test(nameOrId)) dimName = 'Couleur';
      else if (/pointure/i.test(nameOrId)) dimName = 'Pointure';
      else if (/size|taille/i.test(nameOrId)) dimName = 'Taille';
      else if (/capacit|stockage|storage|memory/i.test(nameOrId)) dimName = 'Capacité';
      else if (/version/i.test(nameOrId)) dimName = 'Version';
      else if (/model|modèle/i.test(nameOrId)) dimName = 'Modèle';
      else if (/finish|finition/i.test(nameOrId)) dimName = 'Finition';
      else if (/style/i.test(nameOrId)) dimName = 'Style';
      else if (/material|matiere|matière/i.test(nameOrId)) dimName = 'Matière';
      else if (/edition|édition/i.test(nameOrId)) dimName = 'Édition';
      else {
        const labelText = $(el)
          .closest('label, .form-group, .product-form__input, .variant-input')
          .find('label, legend, span')
          .first()
          .text()
          .trim();
        if (labelText && labelText.length < 30) {
          dimName = translateDimension(labelText);
        } else if (/variant|option/i.test(nameOrId)) {
          dimName = 'Option';
        }
      }

      if (!dimName) return;

      const vals: string[] = [];
      let selectedText = '';
      $(el)
        .find('option')
        .each((_, opt) => {
          const txt = $(opt).text().trim();
          const val = $(opt).attr('value') || '';
          if (
            txt &&
            !/^(choisir|select|sélectionner|veuillez|--|\.\.\.|none|aucun|toutes nos)/i.test(txt) &&
            !/^(choisir|select|sélectionner|veuillez|--|\.\.\.|none|aucun)/i.test(val) &&
            txt.length < 50
          ) {
            if (!vals.includes(txt)) vals.push(txt);
            if ($(opt).is(':selected') && !selectedText) {
              selectedText = txt;
            }
          }
        });

      if (vals.length > 0 && !vals.every((v) => /^\d+$/.test(v.trim()))) {
        addAvailable(dimName, vals);
        if (selectedText) {
          addSelected(dimName, selectedText);
        }
      }
    });

    // 8. Radio inputs & fieldsets
    $('fieldset').each((_, el) => {
      if (
        $(el).closest(
          'header, nav, footer, #navbar, form[action*="/search"], .search, .footer, .sidebar, #lower-price-feedback, #pricing-feedback'
        ).length > 0
      ) {
        return;
      }
      const legend = $(el).find('legend').text().trim();
      if (
        legend &&
        legend.length < 35 &&
        !/filtr|sort|trier|livraison|shipping|paiement|avis|rating|availab|prix|signal|offline|online/i.test(legend)
      ) {
        const dim = translateDimension(legend);
        const vals: string[] = [];
        let checkedVal = '';
        $(el)
          .find('input[type="radio"], button, [data-value]')
          .each((_, inp) => {
            const v = $(inp).attr('value') || $(inp).attr('data-value') || $(inp).text().trim();
            if (
              v &&
              !vals.includes(v) &&
              v.length < 40 &&
              !/^\d+$/.test(v.trim()) &&
              !/online|offline/i.test(v)
            ) {
              vals.push(v);
              if (
                ($(inp).is(':checked') ||
                  $(inp).attr('aria-checked') === 'true' ||
                  $(inp).hasClass('selected') ||
                  $(inp).hasClass('active')) &&
                !checkedVal
              ) {
                checkedVal = v;
              }
            }
          });
        if (vals.length > 0) {
          addAvailable(dim, vals);
          if (checkedVal) {
            addSelected(dim, checkedVal);
          }
        }
      }
    });

    // 9. If any dimension in availableOptions has no selected choice yet, pre-fill with the first available choice
    for (const [dim, vals] of Object.entries(availableOptions)) {
      if (!selectedOptionsList.some((o) => o.startsWith(`${dim}:`)) && vals.length > 0) {
        addSelected(dim, vals[0]);
      }
    }

    return {
      title: title || 'Produit',
      image: images[0] || '',
      images,
      price,
      options: selectedOptionsList.join(', '),
      availableOptions,
    };
  } catch {
    const slugT = slugToTitle(rawUrl) || 'Produit';
    return {
      title: slugT,
      image: '',
      images: [],
      price: null,
      options: '',
      availableOptions: {},
    };
  }
}
