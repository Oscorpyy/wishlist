'use server';

import * as cheerio from 'cheerio';

interface ScrapedData {
  title: string;
  image: string;
  price: number | null;
}

export async function scrapeProductUrl(url: string): Promise<ScrapedData> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('title').text().trim() ||
      '';

    const image =
      $('meta[property="og:image"]').attr('content') || '';

    const rawPrice =
      $('meta[property="product:price:amount"]').attr('content') ||
      $('meta[property="og:price:amount"]').attr('content') ||
      '';

    const parsedPrice = rawPrice ? parseFloat(rawPrice) : null;

    return {
      title,
      image,
      price: parsedPrice,
    };
  } catch (error) {
    console.error('Scraping error:', error);
    throw new Error('Unable to extract product metadata');
  }
}
