'use server';

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
  };

  return text
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|euro|pound|yen|copy|reg|trade|#39);/gi, (match) => namedEntities[match.toLowerCase()] ?? match)
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
 * Parses numeric price from text or numbers, supporting Euro (12,99 €), USD ($12.99), GBP, etc.
 */
function parsePrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isNaN(raw) ? null : raw;
  let clean = String(raw).trim().replace(/\s/g, '');

  if (clean.includes('.') && clean.includes(',')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      clean = clean.replace(/,/g, '');
    }
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  }

  clean = clean.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Strips common e-commerce brand suffixes and prefixes from titles.
 */
function cleanTitle(title: string): string {
  if (!title) return '';
  let cleaned = decodeHtmlEntities(title);

  const suffixes = [
    /\s*[-|:]\s*Amazon(?:\.[a-z]{2,3})?(?::.*)?$/i,
    /\s*[-|:]\s*RHINOSHIELD(?:\s+France)?$/i,
    /\s*[-|:]\s*Maxesport(?:\s+France)?$/i,
    /\s*[-|:]\s*Displate(?:\.com)?$/i,
    /\s*[-|:]\s*Space Exploration.*$/i,
    /\s*[-|:]\s*Fnac(?:\.com)?$/i,
    /\s*[-|:]\s*Darty(?:\.com)?$/i,
    /\s*[-|:]\s*Boulanger(?:\.com)?$/i,
    /\s*[-|:]\s*Cdiscount(?:\.com)?$/i,
    /\s*[-|:]\s*Boutique(?:\s+officielle)?\s+LEGO[®\s]*(?:FR|US|DE)?$/i,
    /\s*[-|:]\s*LEGO(?:\.[a-z]{2,3})?$/i,
    /\s*[-|:]\s*Decathlon(?:\.[a-z]{2,3})?$/i,
    /\s*[-|:]\s*LDLC(?:\.[a-z]{2,3})?$/i,
    /\s*[-|:]\s*AliExpress$/i,
    /\s*[-|:]\s*Etsy(?:\s+France)?$/i,
    /\s*[-|:]\s*Zalando(?:\.[a-z]{2,3})?$/i,
    /\s*[-|:]\s*Apple(?:\s+\(FR\))?$/i,
    /\s*[-|:]\s*Nike(?:\.com)?$/i,
    /\s*[-|:]\s*Adidas(?:\.com)?$/i,
    /\s*[-|:]\s*Sephora(?:\.fr|\.com)?$/i,
    /\s*[-|:]\s*Zara$/i,
    /\s*[-|:]\s*Uniqlo$/i,
    /\s*[-|:]\s*ASOS$/i,
    /\s*[-|:]\s*Back\s*Market$/i,
    /\s*[-|:]\s*eBay(?:\.[a-z]{2,3})?$/i,
    /\s*[-|:]\s*TopAchat$/i,
    /\s*[-|:]\s*Materiel\.net$/i,
  ];

  for (const s of suffixes) {
    cleaned = cleaned.replace(s, '');
  }

  // Remove leading store prefixes (e.g. "Amazon.fr : ", "Displate - ")
  cleaned = cleaned.replace(/^Amazon(?:\.[a-z]{2,3})?\s*:\s*/i, '');
  cleaned = cleaned.replace(/^RHINOSHIELD(?:\s+France)?\s*[-|:]\s*/i, '');
  cleaned = cleaned.replace(/^Displate\s*[-|:]\s*/i, '');

  return cleaned.trim();
}

/**
 * Fallback to generate a clean product title from the URL slug when bot shields block page rendering.
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
 * Extracts meta tag content by property or name attribute.
 */
function extractMetaContent(html: string, nameOrProperty: string): string | null {
  const escaped = nameOrProperty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRegex = new RegExp(`<meta(?=[^>]*\\b(?:property|name)\\s*=\\s*["']${escaped}["'])[^>]*>`, 'i');
  const tagMatch = html.match(tagRegex);
  if (!tagMatch) return null;

  const contentMatch = tagMatch[0].match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"'\s>]+))/i);
  if (!contentMatch) return null;

  const raw = contentMatch[1] ?? contentMatch[2] ?? contentMatch[3] ?? null;
  return raw !== null ? decodeHtmlEntities(raw) : null;
}

/**
 * Recursively parses JSON-LD scripts to find Schema.org Product / ProductGroup metadata and variants.
 */
function extractJsonLd(html: string): {
  title: string;
  images: string[];
  price: number | null;
  brand?: string;
  availableOptions: Record<string, string[]>;
  options: string;
} | null {
  const jsonLdScripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let bestProduct: any = null;

  for (const s of jsonLdScripts) {
    try {
      const parsed = JSON.parse(s[1].trim());
      const findProduct = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        const type = obj['@type'];
        const isProd =
          type === 'Product' ||
          type === 'ProductGroup' ||
          type === 'ProductModel' ||
          (Array.isArray(type) && (type.includes('Product') || type.includes('ProductGroup')));
        if (isProd && (!bestProduct || (obj.offers && !bestProduct.offers) || (obj.hasVariant && !bestProduct.hasVariant))) {
          bestProduct = obj;
        }
        if (Array.isArray(obj)) {
          obj.forEach(findProduct);
        }
        if (obj['@graph'] && Array.isArray(obj['@graph'])) {
          obj['@graph'].forEach(findProduct);
        }
      };
      findProduct(parsed);
    } catch {
      // ignore JSON parse error in individual scripts
    }
  }

  if (!bestProduct) return null;

  const title = bestProduct.name || bestProduct.headline || '';
  const images: string[] = [];
  if (bestProduct.image) {
    if (Array.isArray(bestProduct.image)) {
      bestProduct.image.forEach((img: any) => {
        const u = typeof img === 'string' ? img : img?.url || img?.contentUrl;
        if (u && !images.includes(u)) images.push(u);
      });
    } else if (typeof bestProduct.image === 'string') {
      images.push(bestProduct.image);
    } else if (bestProduct.image.url) {
      images.push(bestProduct.image.url);
    }
  }

  let price: number | null = null;
  if (bestProduct.offers) {
    const off = bestProduct.offers;
    if (Array.isArray(off)) {
      for (const o of off) {
        const p = parsePrice(o.price ?? o.lowPrice ?? o.highPrice);
        if (p !== null) {
          price = p;
          break;
        }
      }
    } else if (typeof off === 'object') {
      price = parsePrice(off.price ?? off.lowPrice ?? off.highPrice ?? off.priceSpecification?.price);
    }
  }

  const availableOptions: Record<string, string[]> = {};
  const selectedOptionsList: string[] = [];

  // Parse variants from hasVariant or variants
  const variants = bestProduct.hasVariant || bestProduct.variants || [];
  if (Array.isArray(variants)) {
    for (const v of variants) {
      if (!v || typeof v !== 'object') continue;
      if (v.color) {
        const c = String(v.color).trim();
        if (c) {
          if (!availableOptions['Couleur']) availableOptions['Couleur'] = [];
          if (!availableOptions['Couleur'].includes(c)) availableOptions['Couleur'].push(c);
        }
      }
      if (v.size) {
        const sz = String(v.size).trim();
        if (sz) {
          if (!availableOptions['Taille']) availableOptions['Taille'] = [];
          if (!availableOptions['Taille'].includes(sz)) availableOptions['Taille'].push(sz);
        }
      }
      if (v.material) {
        const m = String(v.material).trim();
        if (m) {
          if (!availableOptions['Matière']) availableOptions['Matière'] = [];
          if (!availableOptions['Matière'].includes(m)) availableOptions['Matière'].push(m);
        }
      }
      if (v.pattern) {
        const pat = String(v.pattern).trim();
        if (pat) {
          if (!availableOptions['Modèle']) availableOptions['Modèle'] = [];
          if (!availableOptions['Modèle'].includes(pat)) availableOptions['Modèle'].push(pat);
        }
      }
      if (price === null && v.offers) {
        const vp = Array.isArray(v.offers) ? v.offers[0]?.price : v.offers?.price;
        if (vp) price = parsePrice(vp);
      }
      if (v.image && images.length < 10) {
        const imgUrl = typeof v.image === 'string' ? v.image : v.image?.url;
        if (imgUrl && !images.includes(imgUrl)) images.push(imgUrl);
      }
    }
  }

  // Check if offers array has named options
  if (Array.isArray(bestProduct.offers)) {
    for (const o of bestProduct.offers) {
      if (o.name && typeof o.name === 'string' && o.name !== title && o.name.length < 50) {
        if (!availableOptions['Option']) availableOptions['Option'] = [];
        if (!availableOptions['Option'].includes(o.name)) availableOptions['Option'].push(o.name);
      }
    }
  }

  return {
    title,
    images,
    price,
    brand: typeof bestProduct.brand === 'object' ? bestProduct.brand?.name : bestProduct.brand,
    availableOptions,
    options: selectedOptionsList.join(', '),
  };
}

/**
 * Safely parses a balanced JSON block from HTML text starting from a given search key.
 */
function extractJsonBlock(text: string, searchKey: string): any | null {
  const keyIndex = text.indexOf(searchKey);
  if (keyIndex === -1) return null;

  const braceStart = text.indexOf('{', keyIndex);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escape = false;

  for (let i = braceStart; i < text.length && i < braceStart + 50000; i++) {
    const char = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (inString) {
      if (char === quoteChar) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quoteChar = char;
      continue;
    }
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(braceStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Translates option dimensions (Size, Color, etc.) into clean French labels.
 */
function translateDimension(dim: string): string {
  const lower = (dim || '').trim().toLowerCase();
  if (lower === 'size' || lower === 'sizes') return 'Taille';
  if (lower === 'shoe size' || lower === 'shoe sizes') return 'Pointure';
  if (lower === 'color' || lower === 'colour' || lower === 'colors' || lower === 'couleurs') return 'Couleur';
  if (lower === 'model' || lower === 'models' || lower === 'pattern' || lower === 'device') return 'Modèle';
  if (lower === 'capacity' || lower === 'storage' || lower === 'memory' || lower === 'rom') return 'Capacité';
  if (lower === 'ram') return 'RAM';
  if (lower === 'style' || lower === 'styles') return 'Style';
  if (lower === 'material' || lower === 'materials') return 'Matière';
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
 * Intelligently suggests contextual options (sizes, colors, storage, models, finishes)
 * based on product category, title keywords, and store brand.
 */
function enrichOptions(
  availableOptions: Record<string, string[]>,
  title: string,
  url: string
): Record<string, string[]> {
  const options: Record<string, string[]> = { ...availableOptions };
  const lowerTitle = (title || '').toLowerCase();
  const lowerUrl = (url || '').toLowerCase();

  // Wall art / Posters / Displate / Desenio / Neons / Prints
  if (
    lowerUrl.includes('displate') ||
    lowerUrl.includes('desenio') ||
    lowerUrl.includes('posterlounge') ||
    lowerUrl.includes('redbubble') ||
    /\b(poster|affiche|tableau|displate|wall art|metal print|toile|impression|art print|neon|enseigne|peinture)\b/i.test(
      lowerTitle
    )
  ) {
    if (!options['Taille']) {
      options['Taille'] = ['M (45x32 cm)', 'L (67.5x48 cm)', 'XL (90x64 cm)'];
    }
    if (!options['Finition']) {
      options['Finition'] = ['Matte', 'Brillante (Gloss)'];
    }
    if (!options['Cadre']) {
      options['Cadre'] = ['Sans cadre', 'Cadre Noir', 'Cadre Blanc', 'Cadre Graphite', 'Cadre Bois Naturel'];
    }
  }

  // Rhinoshield
  if (lowerUrl.includes('rhinoshield')) {
    if (!options['Modèle']) {
      try {
        const pUrl = new URL(url);
        const dev = pUrl.searchParams.get('device');
        if (dev) {
          const cleanDev = dev.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
          options['Modèle'] = [cleanDev, 'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16', 'iPhone 15 Pro'];
        } else {
          options['Modèle'] = ['iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16', 'iPhone 15 Pro'];
        }
      } catch {
        options['Modèle'] = ['iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16'];
      }
    }
    if (!options['Finition']) {
      options['Finition'] = ['Mat', 'Transparent', 'Fibre de Carbone', 'Bordure Noire'];
    }
    if (!options['Compatibilité']) {
      options['Compatibilité'] = ['Compatible MagSafe', 'Standard'];
    }
  }

  // Fashion & Clothing (t-shirts, hoodies, pants, jackets, etc.)
  if (
    /\b(t-?shirt|chemise|sweat|hoodie|pull|veste|jacket|manteau|pantalon|jean|short|maillot|robe|jupe|blouson|polo)\b/i.test(
      lowerTitle
    )
  ) {
    if (!options['Taille']) {
      options['Taille'] = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
    }
    if (!options['Couleur']) {
      options['Couleur'] = ['Noir', 'Blanc', 'Gris', 'Bleu', 'Kaki', 'Beige'];
    }
  }

  // Shoes & Footwear (sneakers, boots, slides)
  if (
    /\b(chaussures?|baskets?|sneakers?|sandales?|bottes?|crocs|claquettes?|air force|dunk|jordan|boots)\b/i.test(
      lowerTitle
    )
  ) {
    if (!options['Pointure']) {
      options['Pointure'] = ['38', '39', '40', '41', '42', '43', '44', '45', '46'];
    }
    if (!options['Couleur']) {
      options['Couleur'] = ['Noir', 'Blanc', 'Gris', 'Bleu', 'Beige'];
    }
  }

  // Video Games & Consoles
  if (
    /\b(jeu|game|playstation|ps5|ps4|xbox|nintendo|switch|steam|zelda|pokemon|mario|gta|fifa|call of duty|elden ring)\b/i.test(
      lowerTitle
    )
  ) {
    if (!options['Plateforme']) {
      options['Plateforme'] = ['PlayStation 5', 'Nintendo Switch', 'Xbox Series X', 'PC'];
    }
    if (!options['Édition']) {
      options['Édition'] = ['Standard', 'Deluxe', 'Collector'];
    }
  }

  // Smartphones, Tablets, Laptops
  if (/\b(iphone|ipad|galaxy|smartphone|pixel|macbook|laptop|tablette)\b/i.test(lowerTitle)) {
    if (!options['Capacité']) {
      options['Capacité'] = ['128 Go', '256 Go', '512 Go', '1 To'];
    }
    if (!options['Couleur']) {
      options['Couleur'] = ['Noir', 'Blanc', 'Titane', 'Bleu', 'Argent'];
    }
  }

  // Smartwatches / Connected watches
  if (/\b(apple watch|galaxy watch|smartwatch|montre connectée|garmin)\b/i.test(lowerTitle)) {
    if (!options['Boîtier']) {
      options['Boîtier'] = ['40 mm', '41 mm', '44 mm', '45 mm', '49 mm'];
    }
    if (!options['Connectivité']) {
      options['Connectivité'] = ['GPS', 'GPS + Cellular'];
    }
  }

  // Gaming / Peripherals
  if (
    /\b(manette|controller|souris|mouse|clavier|keyboard|casque|headset|écouteurs|earbuds|airpods|superlight)\b/i.test(
      lowerTitle
    )
  ) {
    if (!options['Couleur']) {
      options['Couleur'] = ['Noir', 'Blanc'];
    }
    if (!options['Connexion'] && !lowerTitle.includes('airpods')) {
      options['Connexion'] = ['Sans fil', 'Filaire'];
    }
  }

  // Books / Mangas / Comics
  if (/\b(manga|roman|livre|tome|bd|comics)\b/i.test(lowerTitle)) {
    if (!options['Format']) {
      options['Format'] = ['Broché', 'Relié', 'Poche', 'Ebook / Kindle'];
    }
  }

  // Perfumes & Cosmetics
  if (/\b(parfum|eau de parfum|eau de toilette|serum|creme|fragrance)\b/i.test(lowerTitle)) {
    if (!options['Contenance']) {
      options['Contenance'] = ['30 ml', '50 ml', '100 ml', '200 ml'];
    }
  }

  // Jewelry & Rings
  if (/\b(bague|collier|bracelet|bijou|boucles d'oreilles)\b/i.test(lowerTitle)) {
    if (!options['Matière']) {
      options['Matière'] = ['Argent 925', 'Plaqué Or', 'Acier Inoxydable'];
    }
    if (lowerTitle.includes('bague') && !options['Taille']) {
      options['Taille'] = ['50', '52', '54', '56', '58'];
    }
  }

  // Lego
  if (lowerUrl.includes('lego') || lowerTitle.includes('lego')) {
    if (!options['État']) {
      options['État'] = ['Neuf sous scellé', 'Complet avec boîte', 'Occasion'];
    }
  }

  return options;
}

/**
 * Dedicated LEGO set extractor querying the official Brickset set database.
 * Lego.com blocks direct bot requests with Cloudflare Turnstile, but every Lego URL
 * contains the set number (e.g. millennium-falcon-75192 -> 75192).
 */
async function scrapeLego(url: string): Promise<ScrapedProduct | null> {
  const setMatch = url.match(/(?:product\/[a-z0-9_-]*-|product\/|sets\/)(\d{4,6})/i);
  if (!setMatch) return null;
  const setNumber = setMatch[1];

  try {
    const res = await fetch(`https://brickset.com/sets/${setNumber}-1`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const rawTitle = html.match(/<h1>([^<]+)<\/h1>/)?.[1]?.trim() || '';
    const img = html.match(/property=["']og:image["'] content=["']([^"']+)["']/i)?.[1] || '';
    const rrpMatch = html.match(/<dt>RRP<\/dt>\s*<dd>([^<]+)<\/dd>/i);
    let price: number | null = null;
    if (rrpMatch && rrpMatch[1]) {
      const euroMatch = rrpMatch[1].match(/€\s*([0-9.]+)/) || rrpMatch[1].match(/([0-9.]+)\s*€/);
      if (euroMatch) {
        price = parseFloat(euroMatch[1]);
      } else {
        const anyNum = rrpMatch[1].match(/[0-9.]+/);
        if (anyNum) price = parseFloat(anyNum[0]);
      }
    }

    const images: string[] = [];
    if (img) images.push(img);
    const additionalMatches = [...html.matchAll(/class=["'][^"']*highslide[^"']*["'] href=["']([^"']+\.jpg)["']/gi)];
    for (const m of additionalMatches) {
      if (!images.includes(m[1])) images.push(m[1]);
    }

    if (rawTitle) {
      return {
        title: rawTitle,
        image: img,
        images: images.slice(0, 10),
        price,
        options: `Set #${setNumber}`,
        availableOptions: {
          'État': ['Neuf sous scellé', 'Complet avec boîte', 'Occasion'],
        },
      };
    }
  } catch {
    // fallback to generic scraper
  }
  return null;
}

/**
 * Dedicated Displate metal poster extractor using __NEXT_DATA__.
 * Provides high-resolution artwork, clean title with artist name,
 * and localized option chips for Sizes, Finishes, and Frames.
 */
async function scrapeDisplate(url: string): Promise<ScrapedProduct | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const nextDataMatch = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!nextDataMatch) return null;

    const nextData = JSON.parse(nextDataMatch[1]);
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
    const curSize = qSize || sv.size || sv.selectedProductSize || 'M';
    if (curSize) selectedList.push(`Taille: ${sizeMap[curSize] || curSize}`);
    const curType = qType || sv.type || 'matte';
    if (curType) selectedList.push(`Finition: ${typeMap[curType] || curType}`);
    const curFrame = qFrame || sv.currentVariant?.frame || sv.frame || 'none';
    if (curFrame) selectedList.push(`Cadre: ${frameMap[curFrame] || curFrame}`);

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
 * Generic Next.js (__NEXT_DATA__) extractor for Next.js e-commerce sites
 * (including BackMarket, Target, Nike, headless Shopify, etc.)
 */
function extractNextData(html: string): {
  title?: string;
  images?: string[];
  price?: number | null;
  availableOptions?: Record<string, string[]>;
  options?: string;
} | null {
  const nextDataMatch = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch) return null;
  try {
    const nextData = JSON.parse(nextDataMatch[1]);
    const pageProps = nextData.props?.pageProps;
    if (!pageProps || typeof pageProps !== 'object') return null;

    const candidateProduct =
      pageProps.product ||
      pageProps.pdpGeneral?.product ||
      pageProps.initialState?.product ||
      pageProps.data?.product ||
      pageProps.item ||
      pageProps.listing;

    if (candidateProduct && typeof candidateProduct === 'object') {
      const title = candidateProduct.title || candidateProduct.name || '';
      const price = parsePrice(
        candidateProduct.price ||
          candidateProduct.currentPrice ||
          candidateProduct.offers?.price ||
          candidateProduct.price?.amount
      );
      const images: string[] = [];
      if (candidateProduct.image) images.push(candidateProduct.image);
      if (Array.isArray(candidateProduct.images)) {
        candidateProduct.images.forEach((img: any) => {
          const u = typeof img === 'string' ? img : img?.url || img?.src;
          if (u && !images.includes(u)) images.push(u);
        });
      }

      const availableOptions: Record<string, string[]> = {};
      const variants = candidateProduct.variants || candidateProduct.options || [];
      if (Array.isArray(variants)) {
        for (const v of variants) {
          if (!v) continue;
          if (v.name && Array.isArray(v.values)) {
            const dim = translateDimension(v.name);
            const vals = v.values
              .map((val: any) => String(val.name || val.value || val.label || val))
              .filter(Boolean);
            if (vals.length > 0) availableOptions[dim] = vals;
          }
        }
      }

      return {
        title,
        images,
        price,
        availableOptions,
        options: '',
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Dedicated Shopify API extractor.
 * Millions of e-commerce sites (including Maxesport, apparel, gaming brands) run on Shopify
 * and expose their entire catalog cleanly via `/products/{handle}.json`.
 */
async function scrapeShopify(url: string): Promise<ScrapedProduct | null> {
  try {
    const parsedUrl = new URL(url);
    const productMatch = parsedUrl.pathname.match(/\/products\/([a-zA-Z0-9_-]+)/);
    if (!productMatch) return null;
    const handle = productMatch[1];
    const jsonUrl = `${parsedUrl.origin}/products/${handle}.json`;

    const res = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.product) return null;

    const p = data.product;
    const title = p.title || '';
    const images: string[] = Array.isArray(p.images)
      ? p.images.map((img: any) => (typeof img === 'string' ? img : img.src)).filter(Boolean)
      : (p.image?.src ? [p.image.src] : []);
    const image = images[0] || '';

    let price: number | null = null;
    let selectedVariant = p.variants?.[0];
    const variantIdParam = parsedUrl.searchParams.get('variant');
    if (variantIdParam && Array.isArray(p.variants)) {
      const match = p.variants.find((v: any) => String(v.id) === variantIdParam);
      if (match) selectedVariant = match;
    }
    if (selectedVariant && selectedVariant.price) {
      price = parseFloat(selectedVariant.price);
    }

    const availableOptions: Record<string, string[]> = {};
    const selectedOptionsList: string[] = [];

    if (Array.isArray(p.options)) {
      for (const opt of p.options) {
        const dimName = translateDimension(opt.name || 'Option');
        if (Array.isArray(opt.values)) {
          const vals = opt.values.map(String).filter((v: string) => v && v !== 'Default Title');
          if (vals.length > 0 && dimName !== 'Title') {
            availableOptions[dimName] = vals;
          }
        }
      }
    }

    // If options is empty but variants exist, extract variant names
    if (Object.keys(availableOptions).length === 0 && Array.isArray(p.variants) && p.variants.length > 1) {
      const varTitles = p.variants
        .map((v: any) => v.title)
        .filter((t: any) => t && typeof t === 'string' && t !== 'Default Title');
      if (varTitles.length > 0) {
        availableOptions['Option'] = Array.from(new Set(varTitles));
      }
    }

    if (selectedVariant && selectedVariant.title && selectedVariant.title !== 'Default Title') {
      selectedOptionsList.push(selectedVariant.title);
    }

    const finalOptions = enrichOptions(availableOptions, title, url);

    return {
      title,
      image,
      images: images.slice(0, 10),
      price: isNaN(price as number) ? null : price,
      options: selectedOptionsList.join(', '),
      availableOptions: finalOptions,
    };
  } catch {
    return null;
  }
}

/**
 * Master multi-platform product URL scraper.
 * Supports Amazon, Lego, Shopify stores (Maxesport, etc.), Rhinoshield, Fnac, Darty,
 * Boulanger, Cdiscount, AliExpress, Etsy, Apple, and generic Schema.org/OpenGraph stores.
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

    // 1. Specialized Adapter: LEGO (bypasses Cloudflare on lego.com via Brickset)
    if (url.includes('lego.com')) {
      const legoResult = await scrapeLego(url);
      if (legoResult) return legoResult;
    }

    // 2. Specialized Adapter: Displate
    if (url.includes('displate.com')) {
      const displateResult = await scrapeDisplate(url);
      if (displateResult) return displateResult;
    }

    // 3. Specialized Adapter: Shopify Stores (Maxesport, apparel, gaming brands)
    if (url.includes('/products/') || url.includes('/produits/')) {
      const shopifyResult = await scrapeShopify(url);
      if (shopifyResult) return shopifyResult;
    }

    // 4. HTTP Fetch with Multi-Level Anti-Bot Bypass
    const defaultHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    };

    let html = '';
    try {
      const response = await fetch(url, { headers: defaultHeaders });
      html = await response.text();

      const isBotBlocked =
        html.includes('validateCaptcha') ||
        html.includes('Robot Check') ||
        (url.includes('amazon.') && (html.includes('api-services-support@amazon.com') || response.status === 503));

      if (isBotBlocked || !response.ok) {
        // Fallback with Mobile Safari User-Agent
        const fallbackHeaders = {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9',
        };
        const retryRes = await fetch(url, { headers: fallbackHeaders });
        if (retryRes.ok) {
          const retryHtml = await retryRes.text();
          if (!retryHtml.includes('validateCaptcha')) {
            html = retryHtml;
          }
        }
      }
    } catch {
      // network error: will fall back to slug
    }

    // --- Title Extraction ---
    let title = '';

    // Amazon #productTitle
    const amazonTitleMatch = html.match(/id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i);
    if (amazonTitleMatch && amazonTitleMatch[1].trim()) {
      title = decodeHtmlEntities(amazonTitleMatch[1].trim());
    }

    const ogTitle = extractMetaContent(html, 'og:title');
    const twitterTitle = extractMetaContent(html, 'twitter:title');
    const jsonLd = extractJsonLd(html);
    const nextData = extractNextData(html);

    if (!title) {
      if (nextData && nextData.title) {
        title = cleanTitle(nextData.title);
      } else if (ogTitle && ogTitle.trim()) {
        title = cleanTitle(ogTitle);
      } else if (jsonLd && jsonLd.title) {
        title = cleanTitle(jsonLd.title);
      } else if (twitterTitle && twitterTitle.trim()) {
        title = cleanTitle(twitterTitle);
      } else {
        const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
        if (titleTag && titleTag[1]) {
          title = cleanTitle(titleTag[1].replace(/<[^>]+>/g, '').trim());
        }
      }
    }

    // Safety fallback: extract clean title from URL slug if empty, blocked, or just a domain
    const isGenericOrBlockedTitle =
      !title ||
      title.toLowerCase() === 'amazon.fr' ||
      title.toLowerCase() === 'amazon.com' ||
      title.toLowerCase().includes('robot check') ||
      title.toLowerCase().includes('captcha') ||
      title.toLowerCase().includes('access denied') ||
      title.toLowerCase().includes('forbidden') ||
      title.toLowerCase().includes('just a moment') ||
      title.toLowerCase().includes('attention required') ||
      title.toLowerCase().includes('page introuvable') ||
      title.toLowerCase().includes('404') ||
      title.toLowerCase().includes('protection ultime') ||
      /^[a-z0-9-]+\.[a-z]{2,4}$/i.test(title.trim());

    if (isGenericOrBlockedTitle) {
      const slugTitle = slugToTitle(url);
      if (slugTitle) {
        title = slugTitle;
      }
    }

    // --- Images Extraction ---
    const images: string[] = [];
    const addUrl = (raw: string | undefined | null) => {
      if (!raw || typeof raw !== 'string') return;
      let trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('data:') || trimmed.includes('grey-pixel') || trimmed.includes('placeholder')) {
        return;
      }
      try {
        trimmed = new URL(trimmed, url).href;
      } catch {
        // keep if already valid
      }
      if (!images.includes(trimmed)) {
        images.push(trimmed);
      }
    };

    // Amazon colorImages JSON gallery
    const amazonJsonStart = html.indexOf("A.$.parseJSON('[");
    if (amazonJsonStart !== -1) {
      const amazonJsonEnd = html.indexOf("]')", amazonJsonStart);
      if (amazonJsonEnd !== -1) {
        try {
          const raw = html.slice(amazonJsonStart + "A.$.parseJSON('".length, amazonJsonEnd + 1);
          const unescaped = raw.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
          const items = JSON.parse(unescaped);
          if (Array.isArray(items)) {
            for (const it of items) {
              const u = it.hiRes || it.large || (it.main && typeof it.main === 'object' ? Object.keys(it.main)[0] : null);
              addUrl(u);
            }
          }
        } catch {
          // ignore
        }
      }
    }

    // Amazon landingImage / imgBlkFront
    const landingTag = html.match(/<img(?=[^>]*\bid=["'](?:landingImage|imgBlkFront)["'])[^>]*>/i);
    if (landingTag) {
      const hires = landingTag[0].match(/\bdata-old-hires=["']([^"']+)["']/i);
      const src = landingTag[0].match(/\bsrc=["']([^"']+)["']/i);
      addUrl(hires ? hires[1] : (src ? src[1] : null));
    }

    // Amazon data-a-dynamic-image
    const dynamicMatch = html.match(/data-a-dynamic-image=["']([^"']+)["']/i);
    if (dynamicMatch) {
      try {
        const parsed = JSON.parse(decodeHtmlEntities(dynamicMatch[1]));
        for (const u of Object.keys(parsed)) {
          addUrl(u);
        }
      } catch {
        // ignore
      }
    }

    // JSON-LD images (covers Rhinoshield, Boulanger, Darty, LDLC, etc.)
    if (jsonLd && jsonLd.images) {
      jsonLd.images.forEach(addUrl);
    }

    // Next.js __NEXT_DATA__ images
    if (nextData && nextData.images) {
      nextData.images.forEach(addUrl);
    }

    // OpenGraph and Twitter images
    addUrl(extractMetaContent(html, 'og:image'));
    addUrl(extractMetaContent(html, 'og:image:secure_url'));
    addUrl(extractMetaContent(html, 'twitter:image'));
    addUrl(extractMetaContent(html, 'twitter:image:src'));

    // HTML link image_src
    const linkMatch = html.match(/<link(?=[^>]*\brel=["']image_src["'])[^>]*>/i);
    if (linkMatch) {
      const href = linkMatch[0].match(/\bhref=["']([^"']+)["']/i);
      if (href) addUrl(href[1]);
    }

    // --- Price Extraction ---
    let price: number | null = null;

    // Amazon price
    const wholeMatch = html.match(/<span class=["'][^"']*a-price-whole[^"']*["']>([\s\S]*?)<\/span>/i);
    const fractionMatch = html.match(/<span class=["'][^"']*a-price-fraction[^"']*["']>([\s\S]*?)<\/span>/i);
    if (wholeMatch && wholeMatch[1]) {
      const whole = wholeMatch[1].replace(/<[^>]+>/g, '').replace(/[^0-9]/g, '');
      const fraction = fractionMatch && fractionMatch[1] ? fractionMatch[1].replace(/<[^>]+>/g, '').replace(/[^0-9]/g, '') : '';
      if (whole) {
        price = parseFloat(fraction ? `${whole}.${fraction}` : whole);
      }
    }

    if (price === null) {
      const offscreenMatch = html.match(/<span class=["'][^"']*a-offscreen[^"']*["']>([\s\S]*?)<\/span>/i);
      if (offscreenMatch && offscreenMatch[1]) {
        price = parsePrice(offscreenMatch[1].replace(/<[^>]+>/g, ''));
      }
    }

    // Next.js pageProps price
    if (price === null && nextData && nextData.price !== null && nextData.price !== undefined) {
      price = nextData.price;
    }

    // Schema.org JSON-LD Price (e.g. Rhinoshield 62.99, LDLC, Cdiscount, etc.)
    if (price === null && jsonLd && jsonLd.price !== null) {
      price = jsonLd.price;
    }

    // Meta tags: product:price:amount or og:price:amount
    if (price === null) {
      const metaPrice =
        extractMetaContent(html, 'product:price:amount') ||
        extractMetaContent(html, 'og:price:amount') ||
        extractMetaContent(html, 'price');
      if (metaPrice) price = parsePrice(metaPrice);
    }

    // Microdata itemprop="price"
    if (price === null) {
      const microMatch = html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i);
      if (microMatch && microMatch[1]) {
        price = parsePrice(microMatch[1]);
      }
    }

    // HTML Currency patterns (€, $, £)
    if (price === null) {
      const cleanedHtml = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/&(?:euro|#8364|#x20ac);/gi, '€')
        .replace(/&(?:nbsp|#160|#xa0);|\u00A0/gi, ' ');

      const euroRegex = /(?:€\s*(\d+(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?)|(\d+(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?)\s*€)/i;
      const match = cleanedHtml.match(euroRegex);
      if (match) {
        price = parsePrice(match[1] || match[2] || '');
      }
    }

    // --- Options & Variants Extraction ---
    const availableOptions: Record<string, string[]> = {
      ...(jsonLd?.availableOptions || {}),
      ...(nextData?.availableOptions || {}),
    };
    const selectedOptionsList: string[] = [];
    if (jsonLd?.options) selectedOptionsList.push(jsonLd.options);
    if (nextData?.options) selectedOptionsList.push(nextData.options);

    // Check URL parameters for selected model / device / color / size
    try {
      const pUrl = new URL(url);
      const deviceParam = pUrl.searchParams.get('device') || pUrl.searchParams.get('model');
      if (deviceParam) {
        const cleanDev = deviceParam.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        selectedOptionsList.push(`Modèle: ${cleanDev}`);
        availableOptions['Modèle'] = [cleanDev];
      }
      const colorParam = pUrl.searchParams.get('color') || pUrl.searchParams.get('couleur');
      if (colorParam) {
        const cleanCol = colorParam.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        selectedOptionsList.push(`Couleur: ${cleanCol}`);
        availableOptions['Couleur'] = [cleanCol];
      }
      const sizeParam = pUrl.searchParams.get('size') || pUrl.searchParams.get('taille');
      if (sizeParam) {
        const cleanSize = sizeParam.replace(/-/g, ' ').toUpperCase();
        selectedOptionsList.push(`Taille: ${cleanSize}`);
        availableOptions['Taille'] = [cleanSize];
      }
    } catch {
      // ignore
    }

    // Amazon variationValues JSON (using robust balanced block parser)
    const varValues = extractJsonBlock(html, '"variationValues"');
    const selectedVar = extractJsonBlock(html, '"selectedVariationValues"') || {};
    if (varValues && typeof varValues === 'object') {
      const friendlyNames: Record<string, string> = {
        size_name: 'Taille',
        color_name: 'Couleur',
        style_name: 'Style',
        pattern_name: 'Modèle',
        flavor_name: 'Saveur',
        edition_name: 'Édition',
        material_type: 'Matière',
        capacity_name: 'Capacité',
      };

      for (const [key, values] of Object.entries(varValues)) {
        if (!Array.isArray(values) || values.length === 0) continue;
        const label = friendlyNames[key] || translateDimension(key.replace(/_/g, ' '));
        const cleanValues = values.map((v) => decodeHtmlEntities(String(v)).trim()).filter(Boolean);
        if (cleanValues.length > 0) {
          availableOptions[label] = cleanValues;
          const selectedIdx = (selectedVar as any)[key];
          if (typeof selectedIdx === 'number' && cleanValues[selectedIdx]) {
            if (!selectedOptionsList.some((o) => o.startsWith(label))) {
              selectedOptionsList.push(`${label}: ${cleanValues[selectedIdx]}`);
            }
          }
        }
      }
    }

    // AliExpress skuPropertyList
    const skuProps = extractJsonBlock(html, '"skuPropertyList"');
    if (Array.isArray(skuProps)) {
      for (const prop of skuProps) {
        const dim = translateDimension(prop.skuPropertyName || 'Option');
        if (Array.isArray(prop.skuPropertyValues)) {
          const vals = prop.skuPropertyValues
            .map((v: any) => v.propertyValueDisplayName || v.skuPropertyDisplayName || v.propertyValueName)
            .filter(Boolean);
          if (vals.length > 0) {
            const existing = availableOptions[dim] || [];
            availableOptions[dim] = Array.from(new Set([...existing, ...vals]));
          }
        }
      }
    }

    // Amazon DOM variation blocks (#variation_color_name, #variation_size_name, etc.)
    const amazonVarDivs = [
      ...html.matchAll(/<div\b(?=[^>]*\bid=["']variation_([a-zA-Z0-9_]+)["'])[^>]*>([\s\S]*?)<\/ul>/gi),
    ];
    for (const match of amazonVarDivs) {
      const rawDim = match[1];
      const dim = translateDimension(rawDim.replace(/_name$/, '').replace(/_/g, ' '));
      const block = match[2];

      const selMatch = block.match(/<span class=["'][^"']*selection[^"']*["']>([\s\S]*?)<\/span>/i);
      if (selMatch && selMatch[1].trim()) {
        const selVal = decodeHtmlEntities(selMatch[1].replace(/<[^>]+>/g, '').trim());
        if (selVal && !selectedOptionsList.some((o) => o.startsWith(dim))) {
          selectedOptionsList.push(`${dim}: ${selVal}`);
        }
      }

      const swatchItems = [
        ...block.matchAll(/\btitle=["'](?:Cliquez pour sélectionner\s*|Click to select\s*)?([^"']+)["']/gi),
      ];
      const swatchVals = swatchItems
        .map((m) =>
          decodeHtmlEntities(m[1].replace(/^(?:Taille|Couleur|Taille\s*:|Couleur\s*:)\s*/i, '').trim())
        )
        .filter(Boolean);
      if (swatchVals.length > 0) {
        const existing = availableOptions[dim] || [];
        availableOptions[dim] = Array.from(new Set([...existing, ...swatchVals]));
      }
    }

    // HTML Select elements (color, size, etc.)
    const selectMatches = [
      ...html.matchAll(
        /<select\b(?=[^>]*\b(?:name|id)=["']([^"']*(?:color|couleur|size|taille|version|modele|style|dimension|pointure|stockage|capacite)[^"']*)["'])[^>]*>([\s\S]*?)<\/select>/gi
      ),
    ];
    for (const sm of selectMatches) {
      const attr = sm[1].toLowerCase();
      let dimName = 'Option';
      if (attr.includes('color') || attr.includes('couleur')) dimName = 'Couleur';
      else if (attr.includes('pointure')) dimName = 'Pointure';
      else if (attr.includes('size') || attr.includes('taille')) dimName = 'Taille';
      else if (attr.includes('capacite') || attr.includes('stockage')) dimName = 'Capacité';
      else if (attr.includes('version')) dimName = 'Version';
      else if (attr.includes('modele')) dimName = 'Modèle';
      else if (attr.includes('style')) dimName = 'Style';

      const optionTags = [...sm[2].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)];
      const vals = optionTags
        .map((o) => decodeHtmlEntities(o[1].replace(/<[^>]+>/g, '').trim()))
        .filter(
          (v) =>
            v &&
            !v.toLowerCase().includes('choisir') &&
            !v.toLowerCase().includes('select') &&
            !v.toLowerCase().includes('sélection')
        );
      if (vals.length > 0) {
        const existing = availableOptions[dimName] || [];
        availableOptions[dimName] = Array.from(new Set([...existing, ...vals]));

        const selectedOpt = sm[2].match(/<option\b(?=[^>]*\bselected\b)[^>]*>([\s\S]*?)<\/option>/i);
        if (selectedOpt) {
          const selVal = decodeHtmlEntities(selectedOpt[1].replace(/<[^>]+>/g, '').trim());
          if (
            selVal &&
            !selVal.toLowerCase().includes('choisir') &&
            !selectedOptionsList.some((o) => o.startsWith(dimName))
          ) {
            selectedOptionsList.push(`${dimName}: ${selVal}`);
          }
        }
      }
    }

    // Enrich with smart category suggestions
    const finalAvailableOptions = enrichOptions(availableOptions, title, url);

    const selectedOptionsText = selectedOptionsList.join(', ');

    return {
      title: title || 'Produit',
      image: images[0] || '',
      images: images.slice(0, 10),
      price,
      options: selectedOptionsText,
      availableOptions: finalAvailableOptions,
    };
  } catch {
    const slugT = slugToTitle(rawUrl) || 'Produit';
    return {
      title: slugT,
      image: '',
      images: [],
      price: null,
      options: '',
      availableOptions: enrichOptions({}, slugT, rawUrl),
    };
  }
}
