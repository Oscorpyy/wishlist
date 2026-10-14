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
 * Decodes common HTML entities (named, decimal, and hexadecimal).
 */
function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&euro;': '€',
  };

  return text
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|euro|#39);/gi, (match) => namedEntities[match.toLowerCase()] ?? match)
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
 * Extracts the content attribute of a meta tag by property or name using regex.
 */
function extractMetaContent(html: string, nameOrProperty: string): string | null {
  const escaped = nameOrProperty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRegex = new RegExp(
    `<meta(?=[^>]*\\b(?:property|name)\\s*=\\s*["']${escaped}["'])[^>]*>`,
    'i'
  );
  const tagMatch = html.match(tagRegex);
  if (!tagMatch) {
    return null;
  }

  const contentMatch = tagMatch[0].match(
    /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"'\s>]+))/i
  );
  if (!contentMatch) {
    return null;
  }

  const raw = contentMatch[1] ?? contentMatch[2] ?? contentMatch[3] ?? null;
  return raw !== null ? decodeHtmlEntities(raw) : null;
}

/**
 * Extracts the href attribute of a link tag by rel using regex.
 */
function extractLinkHref(html: string, rel: string): string | null {
  const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRegex = new RegExp(
    `<link(?=[^>]*\\brel\\s*=\\s*["']${escaped}["'])[^>]*>`,
    'i'
  );
  const tagMatch = html.match(tagRegex);
  if (!tagMatch) {
    return null;
  }

  const hrefMatch = tagMatch[0].match(
    /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"'\s>]+))/i
  );
  if (!hrefMatch) {
    return null;
  }

  const raw = hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? null;
  return raw !== null ? decodeHtmlEntities(raw) : null;
}

/**
 * Parses numeric price value from a string, handling European and standard decimal formats.
 */
function parsePrice(raw: string): number | null {
  if (!raw) return null;
  let clean = raw.trim().replace(/\s/g, '');

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
 * Extracts product title using Amazon productTitle, og:title, twitter:title, or <title>.
 */
function extractTitle(html: string): string {
  const amazonTitleMatch = html.match(/id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i);
  if (amazonTitleMatch && amazonTitleMatch[1].trim()) {
    return decodeHtmlEntities(amazonTitleMatch[1].trim());
  }

  const ogTitle = extractMetaContent(html, 'og:title');
  if (ogTitle && ogTitle.trim()) {
    return ogTitle.trim();
  }

  const twitterTitle = extractMetaContent(html, 'twitter:title');
  if (twitterTitle && twitterTitle.trim()) {
    return twitterTitle.trim();
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const raw = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    return decodeHtmlEntities(raw);
  }

  return '';
}

/**
 * Extracts all valid images from HTML (Amazon gallery, landingImage, JSON-LD, og:image, etc.)
 */
function extractImages(html: string, baseUrl: string): string[] {
  const images: string[] = [];

  const addUrl = (raw: string | undefined | null) => {
    if (!raw || typeof raw !== 'string') return;
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.includes('grey-pixel') || trimmed.includes('placeholder')) {
      return;
    }
    try {
      trimmed = new URL(trimmed, baseUrl).href;
    } catch {
      // keep if valid url
    }
    if (!images.includes(trimmed)) {
      images.push(trimmed);
    }
  };

  // 1. Amazon colorImages JSON gallery
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

  // 2. Amazon landingImage / imgBlkFront
  const landingTag = html.match(/<img(?=[^>]*\bid=["'](?:landingImage|imgBlkFront)["'])[^>]*>/i);
  if (landingTag) {
    const hires = landingTag[0].match(/\bdata-old-hires=["']([^"']+)["']/i);
    const src = landingTag[0].match(/\bsrc=["']([^"']+)["']/i);
    addUrl(hires ? hires[1] : (src ? src[1] : null));
  }

  // 3. Amazon data-a-dynamic-image
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

  // 4. JSON-LD scripts
  const jsonLdScripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const s of jsonLdScripts) {
    try {
      const parsed = JSON.parse(s[1].trim());
      const findImages = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.image) {
          if (Array.isArray(obj.image)) {
            obj.image.forEach((img: any) => addUrl(typeof img === 'string' ? img : img?.url));
          } else if (typeof obj.image === 'string') {
            addUrl(obj.image);
          } else if (obj.image.url) {
            addUrl(obj.image.url);
          }
        }
        if (Array.isArray(obj)) {
          obj.forEach(findImages);
        }
        if (obj['@graph'] && Array.isArray(obj['@graph'])) {
          obj['@graph'].forEach(findImages);
        }
      };
      findImages(parsed);
    } catch {
      // ignore
    }
  }

  // 5. OpenGraph and Twitter meta tags
  addUrl(extractMetaContent(html, 'og:image'));
  addUrl(extractMetaContent(html, 'og:image:secure_url'));
  addUrl(extractMetaContent(html, 'twitter:image'));
  addUrl(extractMetaContent(html, 'twitter:image:src'));
  addUrl(extractLinkHref(html, 'image_src'));

  return images.slice(0, 10);
}

/**
 * Extracts price by looking for Amazon pricing, meta tags, or regex patterns.
 */
function extractPrice(html: string): number | null {
  // 1. Amazon offscreen / whole price
  const amazonPriceMatch = html.match(/<span class=["'][^"']*a-price-whole[^"']*["']>([\d\s.,]+)<\/span>/i) ||
                           html.match(/<span class=["'][^"']*a-offscreen[^"']*["']>([\s\S]*?)<\/span>/i);
  if (amazonPriceMatch && amazonPriceMatch[1]) {
    const parsed = parsePrice(amazonPriceMatch[1]);
    if (parsed !== null) return parsed;
  }

  // 2. Check meta tags
  const metaPrice =
    extractMetaContent(html, 'product:price:amount') ||
    extractMetaContent(html, 'og:price:amount');

  if (metaPrice) {
    const parsed = parsePrice(metaPrice);
    if (parsed !== null) {
      return parsed;
    }
  }

  // 3. Fall back to standard Euro pattern in HTML content
  const cleanedHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/&(?:euro|#8364|#x20ac);/gi, '€')
    .replace(/&(?:nbsp|#160|#xa0);|\u00A0/gi, ' ');

  const euroRegex = /(?:€\s*(\d+(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?)|(\d+(?:[\s.,]\d{3})*(?:[.,]\d{1,2})?)\s*€)/i;
  const match = cleanedHtml.match(euroRegex);
  if (match) {
    const rawMatch = match[1] || match[2] || '';
    return parsePrice(rawMatch);
  }

  return null;
}

/**
 * Extracts options and variants (size, color, style, etc.) from e-commerce product pages.
 */
function extractOptions(html: string): {
  selectedOptionsText: string;
  availableOptions: Record<string, string[]>;
} {
  const friendlyNames: Record<string, string> = {
    size_name: 'Taille',
    color_name: 'Couleur',
    style_name: 'Style',
    pattern_name: 'Modèle',
    flavor_name: 'Saveur',
    edition_name: 'Édition',
    material_type: 'Matière',
  };

  const selectedOptionsList: string[] = [];
  const availableOptions: Record<string, string[]> = {};

  // 1. Amazon twister variationValues & selectedVariationValues JSON
  const varValuesMatch = html.match(/"variationValues"\s*:\s*(\{[^}]+\})/);
  const selectedMatch = html.match(/"selectedVariationValues"\s*:\s*(\{[^}]+\})/);

  if (varValuesMatch) {
    try {
      const varValues: Record<string, string[]> = JSON.parse(varValuesMatch[1]);
      const selected: Record<string, number> = selectedMatch ? JSON.parse(selectedMatch[1]) : {};

      for (const [key, values] of Object.entries(varValues)) {
        if (!Array.isArray(values) || values.length === 0) continue;
        const label = friendlyNames[key] || key.replace(/_/g, ' ');
        const cleanValues = values.map((v) => decodeHtmlEntities(v).trim()).filter(Boolean);
        if (cleanValues.length > 0) {
          availableOptions[label] = cleanValues;
          const selectedIdx = selected[key];
          if (typeof selectedIdx === 'number' && cleanValues[selectedIdx]) {
            selectedOptionsList.push(`${label}: ${cleanValues[selectedIdx]}`);
          } else if (cleanValues.length === 1) {
            selectedOptionsList.push(`${label}: ${cleanValues[0]}`);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Amazon DOM variation elements (e.g., #variation_color_name, #variation_size_name)
  const variationDivs = [...html.matchAll(/id=["']variation_([a-zA-Z0-9_-]+)["'][^>]*>([\s\S]*?)<\/div>/gi)];
  for (const vMatch of variationDivs) {
    const dim = vMatch[1];
    const label = friendlyNames[dim] || dim.replace(/_/g, ' ');
    const selMatch = vMatch[2].match(/class=["'][^"']*selection[^"']*["']>([\s\S]*?)<\/span>/i);
    if (selMatch && selMatch[1].trim()) {
      const val = decodeHtmlEntities(selMatch[1].trim());
      if (!selectedOptionsList.some((o) => o.startsWith(label))) {
        selectedOptionsList.push(`${label}: ${val}`);
      }
    }
  }

  // 3. Shopify / Generic JSON options (e.g., "options":[{"name":"Color","values":["Black","White"]}])
  const shopifyOptionsMatch = html.match(/"options"\s*:\s*(\[[^\]]+\])/);
  if (shopifyOptionsMatch) {
    try {
      const parsed = JSON.parse(shopifyOptionsMatch[1]);
      if (Array.isArray(parsed)) {
        for (const opt of parsed) {
          if (typeof opt === 'object' && opt && opt.name && Array.isArray(opt.values)) {
            const label = opt.name;
            const vals = opt.values.map((v: any) => String(v).trim()).filter(Boolean);
            if (vals.length > 0 && !availableOptions[label]) {
              availableOptions[label] = vals;
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. HTML Select elements with color, size, etc.
  const selectMatches = [
    ...html.matchAll(
      /<select\b(?=[^>]*\b(?:name|id)=["']([^"']*(?:color|couleur|size|taille|version|modele|style)[^"']*)["'])[^>]*>([\s\S]*?)<\/select>/gi
    ),
  ];
  for (const sm of selectMatches) {
    const attr = sm[1].toLowerCase();
    let dimName = 'Option';
    if (attr.includes('color') || attr.includes('couleur')) dimName = 'Couleur';
    else if (attr.includes('size') || attr.includes('taille')) dimName = 'Taille';
    else if (attr.includes('version')) dimName = 'Version';
    else if (attr.includes('style')) dimName = 'Style';

    const optionTags = [...sm[2].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)];
    const vals = optionTags
      .map((o) => decodeHtmlEntities(o[1].replace(/<[^>]+>/g, '').trim()))
      .filter((v) => v && !v.toLowerCase().includes('choisir') && !v.toLowerCase().includes('select'));
    if (vals.length > 0 && !availableOptions[dimName]) {
      availableOptions[dimName] = Array.from(new Set(vals));

      const selectedOpt = sm[2].match(/<option\b(?=[^>]*\bselected\b)[^>]*>([\s\S]*?)<\/option>/i);
      if (selectedOpt) {
        const selVal = decodeHtmlEntities(selectedOpt[1].replace(/<[^>]+>/g, '').trim());
        if (selVal && !selVal.toLowerCase().includes('choisir') && !selectedOptionsList.some((o) => o.startsWith(dimName))) {
          selectedOptionsList.push(`${dimName}: ${selVal}`);
        }
      }
    }
  }

  const selectedOptionsText = selectedOptionsList.join(', ');

  return {
    selectedOptionsText,
    availableOptions,
  };
}

/**
 * Next.js Server Action to scrape product metadata from a given URL.
 */
export async function scrapeProductUrl(url: string): Promise<ScrapedProduct> {
  try {
    if (!url || typeof url !== 'string') {
      return {
        title: '',
        image: '',
        images: [],
        price: null,
        options: '',
        availableOptions: {},
      };
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      return {
        title: '',
        image: '',
        images: [],
        price: null,
        options: '',
        availableOptions: {},
      };
    }

    const html = await response.text();

    const title = extractTitle(html);
    const images = extractImages(html, url);
    const image = images[0] || '';
    const price = extractPrice(html);
    const { selectedOptionsText, availableOptions } = extractOptions(html);

    return {
      title,
      image,
      images,
      price,
      options: selectedOptionsText,
      availableOptions,
    };
  } catch {
    return {
      title: '',
      image: '',
      images: [],
      price: null,
      options: '',
      availableOptions: {},
    };
  }
}
