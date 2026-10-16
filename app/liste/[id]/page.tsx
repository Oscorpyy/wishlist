'use client';

import { useEffect, useState, useRef, useCallback, useMemo, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getListWithItems, addItemToList, reserveItem, cancelReservation, updateItem, deleteItem } from '@/app/actions/wishlist';
import { scrapeProductUrl } from '@/app/actions/scrape';
import {
  parseReservations,
  getItemReservationStats,
  formatReserversSummary,
  formatReserversTooltip,
  formatQuantityAvailability,
} from '@/lib/reservations';

interface Item {
  id: string;
  title: string;
  price: number | null;
  image_url: string;
  product_url: string;
  preference_order: number;
  options?: string;
  quantity?: number;
  is_reserved?: boolean;
  reserved_by?: string;
}

interface ListData {
  list: { id: string; title: string };
  items: Item[];
  isAdmin: boolean;
}

// Helper to extract clean site/store name from product URL
function extractSiteName(rawUrl: string | undefined | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return 'Autre';
  try {
    let u = rawUrl.trim();
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = `https://${u}`;
    }
    const host = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('amazon.') || host.includes('amzn.')) return 'Amazon';
    if (host.includes('streetzen.co')) return 'Streetzen';
    if (host.includes('displate.com')) return 'Displate';
    if (host.includes('lego.com')) return 'LEGO';
    if (host.includes('fnac.com')) return 'Fnac';
    if (host.includes('darty.com')) return 'Darty';
    if (host.includes('boulanger.com')) return 'Boulanger';
    if (host.includes('cdiscount.com')) return 'Cdiscount';
    if (host.includes('decathlon.')) return 'Decathlon';
    if (host.includes('nike.com')) return 'Nike';
    if (host.includes('rhinoshield.')) return 'Rhinoshield';
    if (host.includes('maxesport.')) return 'Maxesport';
    if (host.includes('aliexpress.com')) return 'AliExpress';
    if (host.includes('sephora.')) return 'Sephora';
    if (host.includes('zara.com')) return 'Zara';
    if (host.includes('uniqlo.com')) return 'Uniqlo';
    if (host.includes('asos.com')) return 'ASOS';
    if (host.includes('apple.com')) return 'Apple';
    if (host.includes('ebay.')) return 'eBay';
    if (host.includes('montblanc.com')) return 'Montblanc';
    if (host.includes('maty.com')) return 'Maty';
    if (host.includes('topachat.com')) return 'TopAchat';
    if (host.includes('materiel.net')) return 'Materiel.net';
    if (host.includes('ldlc.com')) return 'LDLC';

    const domainParts = host.split('.');
    let s = domainParts[0];
    if (domainParts.length > 2 && /^(co|com|org|net|gov|edu)$/i.test(domainParts[domainParts.length - 2])) {
      s = domainParts[domainParts.length - 3];
    } else if (domainParts.length >= 2) {
      s = domainParts[domainParts.length - 2];
    }
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return 'Autre';
  }
}

// Helper to parse single or multiple images
function parseItemImages(imageUrl: string | undefined | null): string[] {
  if (!imageUrl) return [];
  if (imageUrl.startsWith('[')) {
    try {
      const parsed = JSON.parse(imageUrl);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(
          (u): u is string =>
            typeof u === 'string' &&
            u.trim().length > 0 &&
            !u.includes('.01.PT01.') &&
            !u.includes('.01.PT02.') &&
            !u.includes('.01.PT03.')
        );
      }
    } catch {
      // fallback
    }
  }
  return [imageUrl];
}

// Sub-component containing the dynamic logic
function WishlistContent() {
  const params = useParams();
  const searchParams = useSearchParams();

  const listId = params.id as string;
  const adminKey = searchParams.get('key') || undefined;

  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  // Form states for adding a new item
  const [url, setUrl] = useState('');
  const [lastScrapedUrl, setLastScrapedUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapedTitle, setScrapedTitle] = useState('');
  const [scrapedImage, setScrapedImage] = useState('');
  const [scrapedImages, setScrapedImages] = useState<string[]>([]);
  const [scrapedPrice, setScrapedPrice] = useState<string>('');
  const [preference, setPreference] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [options, setOptions] = useState('');
  const [scrapedAvailableOptions, setScrapedAvailableOptions] = useState<Record<string, string[]>>({});

  // Modal & Gallery states
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Edit Modal states
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editQuantity, setEditQuantity] = useState(1);
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editProductUrl, setEditProductUrl] = useState('');
  const [editPreference, setEditPreference] = useState(1);
  const [editOptions, setEditOptions] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Form states for reserving an item
  const [reservingItemId, setReservingItemId] = useState<string | null>(null);
  const [reserverName, setReserverName] = useState('');
  const [reserveCount, setReserveCount] = useState(1);

  // Filter states
  const [selectedSites, setSelectedSites] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number] | null>(null);
  const [includeNoPrice, setIncludeNoPrice] = useState(true);
  const [hideReserved, setHideReserved] = useState(false);

  const loadList = useCallback(async () => {
    if (!listId) return;

    // Check URL query param first, then client-side cookie and localStorage
    let effectiveKey = adminKey;
    if (!effectiveKey && typeof document !== 'undefined') {
      const match = document.cookie.match(new RegExp(`(?:^|; )wishlist_admin_${listId}=([^;]*)`));
      if (match && match[1]) {
        effectiveKey = decodeURIComponent(match[1]);
      }
      if (!effectiveKey) {
        try {
          effectiveKey = localStorage.getItem(`wishlist_admin_${listId}`) || undefined;
        } catch {}
      }
    }

    // Persist effectiveKey into cookie and localStorage
    if (effectiveKey && typeof document !== 'undefined') {
      document.cookie = `wishlist_admin_${listId}=${effectiveKey}; path=/; max-age=31536000; SameSite=Lax`;
      try {
        localStorage.setItem(`wishlist_admin_${listId}`, effectiveKey);
      } catch {}
    }

    const res = await getListWithItems(listId, effectiveKey);
    const listData = res as ListData | null;
    setData(listData);
    if (listData && listData.items) {
      const maxPref = listData.items.reduce((max, item) => Math.max(max, item.preference_order || 0), 0);
      setPreference(maxPref + 1);
      setSelectedItem((prev) => {
        if (!prev) return null;
        return listData.items.find((it) => it.id === prev.id) || prev;
      });
    }
    setLoading(false);
  }, [listId, adminKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadList();
  }, [loadList]);

  // Calculate dynamic price bounds from the current items
  const { minPriceBound, maxPriceBound, hasPricedItems, unpricedCount } = useMemo(() => {
    if (!data?.items || data.items.length === 0) {
      return { minPriceBound: 0, maxPriceBound: 0, hasPricedItems: false, unpricedCount: 0 };
    }
    const numericPrices = data.items
      .map((i) => i.price)
      .filter((p): p is number => typeof p === 'number' && !isNaN(p));

    const unpriced = data.items.filter((i) => i.price === null || i.price === undefined).length;

    if (numericPrices.length === 0) {
      return { minPriceBound: 0, maxPriceBound: 0, hasPricedItems: false, unpricedCount: unpriced };
    }

    const min = Math.floor(Math.min(...numericPrices));
    const max = Math.ceil(Math.max(...numericPrices));
    return { minPriceBound: min, maxPriceBound: max, hasPricedItems: true, unpricedCount: unpriced };
  }, [data?.items]);

  // Dynamic available sites strictly from items in current list
  const availableSites = useMemo(() => {
    if (!data?.items) return [];
    const map = new Map<string, number>();
    data.items.forEach((item) => {
      const site = extractSiteName(item.product_url);
      map.set(site, (map.get(site) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [data?.items]);

  // Effective min/max for sliders (guaranteed min < max when minPriceBound < maxPriceBound)
  const effectiveMin = priceRange
    ? Math.max(minPriceBound, Math.min(priceRange[0], maxPriceBound > minPriceBound ? maxPriceBound - 1 : maxPriceBound))
    : minPriceBound;
  const effectiveMax = priceRange
    ? Math.min(maxPriceBound, Math.max(priceRange[1], maxPriceBound > minPriceBound ? minPriceBound + 1 : minPriceBound))
    : maxPriceBound;

  // Handlers for price bounds ensuring they can never be equivalent (min < max)
  const handleMinPriceChange = (newVal: number) => {
    if (isNaN(newVal)) return;
    const val = Math.max(minPriceBound, Math.min(newVal, maxPriceBound));
    if (val < effectiveMax) {
      setPriceRange([val, effectiveMax]);
    } else if (val === effectiveMax) {
      if (effectiveMax < maxPriceBound) {
        setPriceRange([effectiveMax, effectiveMax + 1]);
      } else if (effectiveMax > minPriceBound) {
        setPriceRange([effectiveMax - 1, effectiveMax]);
      }
    } else {
      // Dragged past max
      if (val < maxPriceBound) {
        setPriceRange([effectiveMax, val]);
      } else {
        setPriceRange([effectiveMax, maxPriceBound]);
      }
    }
  };

  const handleMaxPriceChange = (newVal: number) => {
    if (isNaN(newVal)) return;
    const val = Math.max(minPriceBound, Math.min(newVal, maxPriceBound));
    if (val > effectiveMin) {
      setPriceRange([effectiveMin, val]);
    } else if (val === effectiveMin) {
      if (effectiveMin > minPriceBound) {
        setPriceRange([effectiveMin - 1, effectiveMin]);
      } else if (effectiveMin < maxPriceBound) {
        setPriceRange([effectiveMin, effectiveMin + 1]);
      }
    } else {
      // Dragged below min
      if (val > minPriceBound) {
        setPriceRange([val, effectiveMin]);
      } else {
        setPriceRange([minPriceBound, effectiveMin]);
      }
    }
  };

  // Filtered items list based on active criteria
  const filteredItems = useMemo(() => {
    if (!data?.items) return [];

    return data.items.filter((item) => {
      // 1. Site filter
      if (selectedSites.length > 0) {
        const itemSite = extractSiteName(item.product_url);
        if (!selectedSites.includes(itemSite)) {
          return false;
        }
      }

      // 2. Price filter
      if (hasPricedItems && priceRange !== null) {
        if (item.price === null || item.price === undefined) {
          if (!includeNoPrice) return false;
        } else {
          if (item.price < effectiveMin || item.price > effectiveMax) {
            return false;
          }
        }
      }

      // 3. Optional reservation filter (for guests)
      if (hideReserved) {
        const stats = getItemReservationStats(item.quantity, item.reserved_by, item.is_reserved);
        if (stats.isFullyReserved) {
          return false;
        }
      }

      return true;
    });
  }, [data?.items, selectedSites, priceRange, hasPricedItems, includeNoPrice, effectiveMin, effectiveMax, hideReserved]);

  const isPriceFiltered = hasPricedItems && priceRange !== null && (effectiveMin > minPriceBound || effectiveMax < maxPriceBound);
  const isSiteFiltered = selectedSites.length > 0;
  const isFiltered = isPriceFiltered || isSiteFiltered || (!includeNoPrice && unpricedCount > 0) || hideReserved;

  const handleToggleSite = (siteName: string) => {
    setSelectedSites((prev) =>
      prev.includes(siteName) ? prev.filter((s) => s !== siteName) : [...prev, siteName]
    );
  };

  const handleSelectAllSites = () => {
    if (selectedSites.length === availableSites.length) {
      setSelectedSites([]);
    } else {
      setSelectedSites(availableSites.map((s) => s.name));
    }
  };

  const handleResetFilters = () => {
    setSelectedSites([]);
    setPriceRange(null);
    setIncludeNoPrice(true);
    setHideReserved(false);
  };

  const handleShare = () => {
    const guestUrl = `${window.location.origin}/liste/${listId}`;
    navigator.clipboard.writeText(guestUrl);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  // Refs for add-item form keyboard navigation
  const urlInputRef = useRef<HTMLInputElement>(null);
  const fieldRef0 = useRef<HTMLInputElement>(null);
  const fieldRef1 = useRef<HTMLInputElement>(null);
  const fieldRef2 = useRef<HTMLInputElement>(null);
  const fieldRefQuantity = useRef<HTMLInputElement>(null);
  const fieldRef3 = useRef<HTMLInputElement>(null);
  const fieldRef4 = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  const handleCancelAddItem = () => {
    setUrl('');
    setLastScrapedUrl('');
    setScrapedTitle('');
    setScrapedImage('');
    setScrapedImages([]);
    setScrapedPrice('');
    setQuantity(1);
    setOptions('');
    setScrapedAvailableOptions({});
    setTimeout(() => {
      urlInputRef.current?.focus();
    }, 50);
  };

  // Modal & Global keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showShareModal) {
          setShowShareModal(false);
        } else if (editingItem) {
          setEditingItem(null);
        } else if (selectedItem) {
          setSelectedItem(null);
        } else if (reservingItemId) {
          setReservingItemId(null);
          setReserverName('');
          setReserveCount(1);
        } else if (scrapedTitle) {
          handleCancelAddItem();
        }
      } else if (e.key === 'ArrowLeft' && selectedItem && !editingItem) {
        const images = parseItemImages(selectedItem.image_url);
        if (images.length > 1) {
          setActiveImageIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
        }
      } else if (e.key === 'ArrowRight' && selectedItem && !editingItem) {
        const images = parseItemImages(selectedItem.image_url);
        if (images.length > 1) {
          setActiveImageIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItem, editingItem, showShareModal, reservingItemId, scrapedTitle]);

  const openEditModal = (item: Item, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingItem(item);
    setEditTitle(item.title);
    setEditPrice(item.price !== null ? item.price.toString() : '');
    setEditQuantity(item.quantity || 1);

    // Parse image array so we display a clean single URL in the input field, not a JSON string!
    const imgs = parseItemImages(item.image_url);
    setEditImages(imgs);
    setEditImageUrl(imgs[0] || '');

    let prodUrl = item.product_url || '';
    if (prodUrl && !prodUrl.startsWith('http://') && !prodUrl.startsWith('https://')) {
      prodUrl = `https://${prodUrl}`;
    }
    setEditProductUrl(prodUrl);
    setEditPreference(item.preference_order || 1);
    setEditOptions(item.options || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !listId || !editTitle.trim()) return;
    setSavingEdit(true);
    try {
      let finalProductUrl = editProductUrl.trim();
      if (finalProductUrl && !finalProductUrl.startsWith('http://') && !finalProductUrl.startsWith('https://')) {
        finalProductUrl = `https://${finalProductUrl}`;
      }

      let finalImageUrl = editImageUrl.trim();
      if (
        finalImageUrl &&
        !finalImageUrl.startsWith('http://') &&
        !finalImageUrl.startsWith('https://') &&
        !finalImageUrl.startsWith('data:') &&
        !finalImageUrl.startsWith('/')
      ) {
        finalImageUrl = `https://${finalImageUrl}`;
      }

      // Preserve multiple images gallery if applicable
      let imagePayload = finalImageUrl;
      if (editImages.length > 1) {
        if (editImages.includes(finalImageUrl)) {
          // Reorder with selected cover image first
          const reordered = [finalImageUrl, ...editImages.filter((u) => u !== finalImageUrl)];
          imagePayload = JSON.stringify(reordered);
        } else if (finalImageUrl) {
          // New image added as first item in gallery
          imagePayload = JSON.stringify([finalImageUrl, ...editImages.slice(1)]);
        } else {
          imagePayload = JSON.stringify(editImages);
        }
      } else if (finalImageUrl) {
        imagePayload = JSON.stringify([finalImageUrl]);
      }

      const res = await updateItem(editingItem.id, listId, {
        title: editTitle.trim(),
        price: editPrice ? parseFloat(editPrice) : null,
        image_url: imagePayload,
        product_url: finalProductUrl,
        preference_order: editPreference,
        options: editOptions.trim(),
        quantity: editQuantity,
      });

      if (res && res.success === false) {
        alert(res.error || 'Erreur lors de la mise à jour');
        return;
      }

      if (selectedItem && selectedItem.id === editingItem.id) {
        setSelectedItem({
          ...selectedItem,
          title: editTitle.trim(),
          price: editPrice ? parseFloat(editPrice) : null,
          image_url: imagePayload,
          product_url: finalProductUrl,
          preference_order: editPreference,
          options: editOptions.trim(),
          quantity: editQuantity,
        });
      }

      setEditingItem(null);
      await loadList();
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      const msg = rawMsg.includes('Minified React error #441')
        ? 'Une erreur serveur est survenue lors de la mise à jour. Veuillez vérifier la connexion ou les permissions Supabase.'
        : rawMsg;
      alert(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet article de la liste ?')) return;
    try {
      const res = await deleteItem(itemId, listId);
      if (res && res.success === false) {
        alert(res.error || 'Erreur lors de la suppression');
        return;
      }
      if (selectedItem && selectedItem.id === itemId) setSelectedItem(null);
      if (editingItem && editingItem.id === itemId) setEditingItem(null);
      loadList();
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      const msg = rawMsg.includes('Minified React error #441')
        ? 'Une erreur serveur est survenue lors de la suppression.'
        : rawMsg;
      alert(msg);
    }
  };

  const handleScrape = async () => {
    if (!url.trim()) return;
    setScraping(true);
    try {
      const res = await scrapeProductUrl(url);
      setScrapedTitle(res.title || 'Product');
      setScrapedImage(res.image || '');
      setScrapedImages(res.images && res.images.length > 0 ? res.images : (res.image ? [res.image] : []));
      setScrapedPrice(res.price !== null ? res.price.toString() : '');
      setQuantity(1);
      setOptions(res.options || '');
      setScrapedAvailableOptions(res.availableOptions || {});
      const maxPref = data?.items?.reduce((max, item) => Math.max(max, item.preference_order || 0), 0) ?? 0;
      setPreference(maxPref + 1);
      setLastScrapedUrl(url);

      // Focus the first text zone (Title) so Shift+Enter cycles through fields and Ctrl+Enter saves
      setTimeout(() => {
        fieldRef0.current?.focus();
        fieldRef0.current?.select();
      }, 50);
    } catch {
      alert('Impossible d’extraire automatiquement les informations du produit. Vous pouvez remplir les champs manuellement.');
      setScrapedTitle('Produit');
      setQuantity(1);
      setLastScrapedUrl(url);
      setTimeout(() => {
        fieldRef0.current?.focus();
      }, 50);
    } finally {
      setScraping(false);
    }
  };

  const toggleOptionChip = (dimension: string, value: string) => {
    const currentPairs = options
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const dimPrefix = `${dimension}:`.toLowerCase();
    const existingIndex = currentPairs.findIndex((p) =>
      p.toLowerCase().startsWith(dimPrefix)
    );

    if (existingIndex !== -1) {
      const existingVal = currentPairs[existingIndex].slice(dimension.length + 1).trim();
      if (existingVal.toLowerCase() === value.toLowerCase()) {
        // Already selected -> toggle off
        currentPairs.splice(existingIndex, 1);
      } else {
        // Change to new value
        currentPairs[existingIndex] = `${dimension}: ${value}`;
      }
    } else {
      // Add new option
      currentPairs.push(`${dimension}: ${value}`);
    }

    setOptions(currentPairs.join(', '));
  };

  const isOptionSelected = (dimension: string, value: string) => {
    const currentPairs = options
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const dimPrefix = `${dimension}:`.toLowerCase();
    return currentPairs.some((p) => {
      const lower = p.toLowerCase();
      if (lower.startsWith(dimPrefix)) {
        return lower.slice(dimension.length + 1).trim().toLowerCase() === value.toLowerCase();
      }
      return lower === value.toLowerCase();
    });
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scrapedTitle || !listId) return;

    let imagePayload = scrapedImage;
    if (scrapedImages.length > 1) {
      if (scrapedImages.includes(scrapedImage)) {
        const reordered = [scrapedImage, ...scrapedImages.filter((u) => u !== scrapedImage)];
        imagePayload = JSON.stringify(reordered);
      } else if (scrapedImage) {
        imagePayload = JSON.stringify([scrapedImage, ...scrapedImages]);
      } else {
        imagePayload = JSON.stringify(scrapedImages);
      }
    } else if (scrapedImage) {
      imagePayload = JSON.stringify([scrapedImage]);
    }

    const res = await addItemToList({
      listId,
      title: scrapedTitle,
      price: scrapedPrice ? parseFloat(scrapedPrice) : null,
      image: imagePayload,
      url,
      preferenceOrder: preference,
      options,
      quantity,
    });

    if (res && res.success === false) {
      alert(res.error || 'Erreur lors de l’ajout de l’article');
      return;
    }

    const maxPref = data?.items?.reduce((max, item) => Math.max(max, item.preference_order || 0), 0) ?? 0;
    setPreference(Math.max(maxPref, preference) + 1);

    handleCancelAddItem();
    loadList();
  };

  const handleReserve = async (itemId: string, count: number = 1) => {
    if (!reserverName.trim() || !listId) return;
    const name = reserverName.trim();
    try {
      const res = await reserveItem(itemId, listId, name, count);
      if (res && res.success === false) {
        alert(res.error || 'Erreur lors de la réservation');
        return;
      }
      setReservingItemId(null);
      setReserverName('');
      setReserveCount(1);
      await loadList();
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Erreur lors de la réservation';
      const msg = rawMsg.includes('Minified React error #441')
        ? 'Une erreur serveur est survenue lors de la réservation. Veuillez vérifier les permissions Supabase.'
        : rawMsg;
      alert(msg);
    }
  };

  const handleCancelReservation = async (
    itemId: string,
    e?: React.MouseEvent,
    existingReservations?: { name: string; count: number }[]
  ) => {
    if (e) e.stopPropagation();
    if (!listId) return;

    const reservations = existingReservations || [];
    let nameToCancel: string | undefined = undefined;

    if (reservations.length > 1) {
      const promptMessage = `Plusieurs personnes ont réservé cet article (${reservations.map((r) => r.name).join(', ')}).\nEntrez votre nom pour annuler votre réservation (ou laissez vide pour tout annuler) :`;
      const input = window.prompt(promptMessage);
      if (input === null) return;
      if (input.trim()) {
        nameToCancel = input.trim();
      } else {
        if (!confirm('Voulez-vous vraiment annuler TOUTES les réservations pour cet article ?')) {
          return;
        }
      }
    } else if (reservations.length === 1) {
      if (!confirm(`Voulez-vous annuler la réservation de ${reservations[0].name} ?`)) {
        return;
      }
      nameToCancel = reservations[0].name;
    } else {
      if (!confirm('Voulez-vous annuler la réservation de cet article ?')) {
        return;
      }
    }

    try {
      const res = await cancelReservation(itemId, listId, nameToCancel);
      if (res && res.success === false) {
        alert(res.error || 'Erreur lors de l’annulation de la réservation');
        return;
      }
      await loadList();
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Erreur lors de l’annulation de la réservation';
      const msg = rawMsg.includes('Minified React error #441')
        ? 'Une erreur serveur est survenue lors de l’annulation de la réservation.'
        : rawMsg;
      alert(msg);
    }
  };

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelAddItem();
      return;
    }
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Shift + Enter: Strictly navigates between text zones
        e.preventDefault();
        const refs = [fieldRef0, fieldRef1, fieldRef2, fieldRefQuantity, fieldRef3, fieldRef4];
        if (index < refs.length - 1) {
          refs[index + 1].current?.focus();
          refs[index + 1].current?.select();
        } else {
          // Loop back to URL input or first field
          urlInputRef.current?.focus();
          urlInputRef.current?.select();
        }
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl + Enter: Validate and save the item
        e.preventDefault();
        submitRef.current?.click();
      } else {
        // Plain Enter: also validates and saves
        e.preventDefault();
        submitRef.current?.click();
      }
    }
  };


  if (loading) {
    return <div className="p-8 text-center text-gray-600">Loading wishlist...</div>;
  }

  if (!data) {
    return (
      <div className="max-w-md mx-auto p-8 text-center space-y-4">
        <p className="text-red-500 font-medium">Wishlist not found.</p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition"
        >
          <img src="/favicon.ico" alt="Logo" className="w-5 h-5 rounded object-contain" />
          <span>Créer une nouvelle liste</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="bg-white p-6 rounded-xl shadow flex justify-between items-center gap-4">
        <div className="flex items-center gap-3.5">
          <Link
            href="/"
            className="flex items-center justify-center p-1 rounded-xl border border-gray-200 hover:border-blue-500 hover:bg-blue-50/50 shadow-xs transition-all group shrink-0"
            title="Créer une nouvelle liste"
          >
            <img
              src="/favicon.ico"
              alt="Créer une nouvelle liste"
              className="w-10 h-10 rounded-lg object-contain transition-transform group-hover:scale-105"
            />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-800">{data.list.title}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {data.isAdmin
                ? '👑 Mode Créateur (Réservations masquées pour garder la surprise !)'
                : '👥 Mode Invité (Vous pouvez réserver des articles)'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            handleShare();
            setShowShareModal(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-xl font-medium shadow-sm transition-all cursor-pointer shrink-0"
          title="Partager le lien de la wishlist"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span className="text-sm font-semibold">{copied ? 'Lien copié !' : 'Partager'}</span>
        </button>
      </header>

      {/* Creator Section: Add items */}
      {data.isAdmin && (
        <section className="bg-white p-6 rounded-xl shadow space-y-4">
          <h2 className="text-xl font-semibold text-gray-800">Add an Item</h2>
          <div className="flex gap-2">
            <input
              ref={urlInputRef}
              type="url"
              placeholder="Paste product link (Amazon, Maxesport, Rhinoshield, Fnac...)"
              value={url}
              disabled={scraping}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCancelAddItem();
                  return;
                }
                if (e.key === 'Enter') {
                  if (e.shiftKey) {
                    e.preventDefault();
                    if (scrapedTitle) {
                      fieldRef0.current?.focus();
                      fieldRef0.current?.select();
                    }
                  } else if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    if (scrapedTitle) {
                      submitRef.current?.click();
                    } else {
                      await handleScrape();
                    }
                  } else {
                    e.preventDefault();
                    if (scraping) return;
                    if (scrapedTitle && url === lastScrapedUrl) {
                      submitRef.current?.click();
                    } else {
                      await handleScrape();
                    }
                  }
                }
              }}
              className="flex-1 border rounded-lg px-3 py-2 text-black disabled:opacity-60"
            />
            {scrapedTitle && (
              <button
                type="button"
                onClick={handleCancelAddItem}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3.5 py-2 rounded-lg transition font-medium cursor-pointer shrink-0 border border-gray-300"
                title="Annuler et fermer (Échap)"
              >
                ✕
              </button>
            )}
            <button
              type="button"
              onClick={scrapedTitle ? () => submitRef.current?.click() : handleScrape}
              disabled={scraping || !url.trim()}
              className="bg-gray-800 text-white px-5 py-2 rounded-lg hover:bg-gray-900 disabled:opacity-50 transition font-medium cursor-pointer shrink-0"
            >
              {scraping ? 'Parsing...' : scrapedTitle ? 'Save Item' : 'Fetch Info'}
            </button>
          </div>

          {scrapedTitle && (
            <form onSubmit={handleAddItem} className="space-y-3 pt-4 border-t">
              {/* Keyboard hint */}
              <p className="text-xs text-gray-500 italic">
                💡 <kbd className="bg-gray-100 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold text-gray-700">Échap</kbd> annuler l&apos;ajout &nbsp;·&nbsp; <kbd className="bg-gray-100 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold text-gray-700">Shift</kbd> + <kbd className="bg-gray-100 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold text-gray-700">↵</kbd> naviguer entre les champs &nbsp;·&nbsp; <kbd className="bg-gray-100 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold text-gray-700">Ctrl</kbd> + <kbd className="bg-gray-100 border border-gray-300 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold text-gray-700">↵</kbd> valider l&apos;article
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700">Title</label>
                <input
                  ref={fieldRef0}
                  type="text"
                  value={scrapedTitle}
                  onChange={(e) => setScrapedTitle(e.target.value)}
                  onKeyDown={(e) => handleFormKeyDown(e, 0)}
                  className="w-full border rounded-lg px-3 py-2 text-black"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Image URL</label>
                <div className="flex gap-3 items-center mt-1">
                  {scrapedImage ? (
                    <img
                      src={scrapedImage}
                      alt="Preview"
                      className="w-14 h-14 object-contain rounded-lg border bg-white p-1 shadow-sm shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 bg-gray-100 rounded-lg border border-dashed flex items-center justify-center text-gray-400 text-xs shrink-0">
                      No img
                    </div>
                  )}
                  <input
                    ref={fieldRef1}
                    type="url"
                    placeholder="https://... (or auto-detected from product page)"
                    value={scrapedImage}
                    onKeyDown={(e) => handleFormKeyDown(e, 1)}
                    onChange={(e) => {
                      setScrapedImage(e.target.value);
                      if (e.target.value && !scrapedImages.includes(e.target.value)) {
                        setScrapedImages([e.target.value, ...scrapedImages]);
                      }
                    }}
                    className="flex-1 border rounded-lg px-3 py-2 text-black text-sm"
                  />
                </div>

                {/* Detected photos gallery: user can click to choose which photo is the primary cover photo */}
                {scrapedImages.length > 1 && (
                  <div className="mt-2.5 space-y-1.5">
                    <p className="text-xs text-gray-600 font-medium flex items-center gap-1.5">
                      <span>📸</span>
                      <span>Photos détectées (cliquez pour choisir l&apos;image principale) :</span>
                    </p>
                    <div className="flex gap-2 overflow-x-auto p-2 bg-gray-50 rounded-xl border border-gray-200">
                      {scrapedImages.map((img, idx) => {
                        const isMain = scrapedImage === img;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setScrapedImage(img)}
                            className={`relative w-16 h-16 rounded-xl border-2 p-1 bg-white shrink-0 cursor-pointer transition-all ${
                              isMain
                                ? 'border-blue-600 ring-2 ring-blue-100 shadow-md scale-105'
                                : 'border-gray-200 opacity-60 hover:opacity-100 hover:border-gray-300'
                            }`}
                            title="Définir comme image principale"
                          >
                            <img
                              src={img}
                              alt=""
                              className="w-full h-full object-contain rounded-lg"
                              onError={() => {
                                setScrapedImages((prev) => prev.filter((u) => u !== img));
                              }}
                            />
                            {isMain && (
                              <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold shadow">
                                ✓
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price (€)</label>
                  <input
                    ref={fieldRef2}
                    type="number"
                    step="0.01"
                    value={scrapedPrice}
                    onChange={(e) => setScrapedPrice(e.target.value)}
                    onKeyDown={(e) => handleFormKeyDown(e, 2)}
                    className="w-full border rounded-lg px-3 py-2 text-black"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Quantité
                  </label>
                  <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className="px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold text-sm border-r border-gray-200 transition-colors cursor-pointer select-none"
                      title="Diminuer la quantité"
                    >
                      −
                    </button>
                    <input
                      ref={fieldRefQuantity}
                      type="number"
                      min={1}
                      max={999}
                      value={quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setQuantity(isNaN(val) || val < 1 ? 1 : val);
                      }}
                      onKeyDown={(e) => handleFormKeyDown(e, 3)}
                      className="w-full text-center py-2 text-black font-semibold text-sm focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => q + 1)}
                      className="px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold text-sm border-l border-gray-200 transition-colors cursor-pointer select-none"
                      title="Augmenter la quantité"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preference Rank (1 = Top)
                  </label>
                  <input
                    ref={fieldRef3}
                    type="number"
                    value={preference}
                    onChange={(e) => setPreference(parseInt(e.target.value) || 1)}
                    onKeyDown={(e) => handleFormKeyDown(e, 4)}
                    className="w-full border rounded-lg px-3 py-2 text-black"
                    min={1}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Options / Notes (Couleur, Taille, Version...)
                </label>
                <input
                  ref={fieldRef4}
                  type="text"
                  placeholder="e.g. Taille: 5 m, Couleur: Blanc"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  onKeyDown={(e) => handleFormKeyDown(e, 5)}
                  className="w-full border rounded-lg px-3 py-2 text-black"
                />

                {/* Detected options chips from the store */}
                {Object.entries(scrapedAvailableOptions).length > 0 && (
                  <div className="mt-2.5 p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                        <span>🏷️</span>
                        <span>Options détectées sur le site (cliquez pour sélectionner) :</span>
                      </p>
                      {options && (
                        <button
                          type="button"
                          onClick={() => setOptions('')}
                          className="text-[11px] text-gray-500 hover:text-red-600 underline cursor-pointer"
                        >
                          Effacer tout
                        </button>
                      )}
                    </div>
                    {Object.entries(scrapedAvailableOptions).map(([dimension, values]) => (
                      <div key={dimension} className="space-y-1">
                        <span className="text-xs font-semibold text-gray-700">{dimension} :</span>
                        <div className="flex flex-wrap gap-1.5">
                          {values.map((val) => {
                            const isSelected = isOptionSelected(dimension, val);
                            return (
                              <button
                                key={val}
                                type="button"
                                onClick={() => toggleOptionChip(dimension, val)}
                                className={`text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer font-medium ${
                                  isSelected
                                    ? 'bg-blue-600 border-blue-600 text-white font-semibold shadow-sm ring-1 ring-blue-300'
                                    : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-100'
                                }`}
                              >
                                {val} {isSelected && '✓'}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-2.5 pt-2">
                <button
                  ref={submitRef}
                  type="submit"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-xl font-semibold transition shadow-sm cursor-pointer"
                >
                  Ajouter l&apos;article
                </button>
                <button
                  type="button"
                  onClick={handleCancelAddItem}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl font-medium text-sm transition border border-gray-300 cursor-pointer"
                  title="Annuler et fermer ce formulaire (Échap)"
                >
                  Annuler (Échap)
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Filters Section (Displayed whenever the list has items) */}
      {data.items.length > 0 && (
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 space-y-4">
          {/* Header with counter and reset */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2.5">
              <span className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span>🔍</span>
                <span>Filtres</span>
              </span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                {filteredItems.length} sur {data.items.length} {filteredItems.length <= 1 ? 'article' : 'articles'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {!data.isAdmin && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600 font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hideReserved}
                    onChange={(e) => setHideReserved(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Masquer déjà réservés</span>
                </label>
              )}

              {isFiltered && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Réinitialiser les filtres
                </button>
              )}
            </div>
          </div>

          {/* Filter options grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* 1. Sites Filter (col-span-7) */}
            <div className="lg:col-span-7 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
                  <span>🏪</span>
                  <span>Sites & Boutiques ({availableSites.length})</span>
                </span>
                <div className="flex gap-2">
                  {selectedSites.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setSelectedSites([])}
                      className="text-[11px] text-blue-600 hover:underline cursor-pointer font-medium"
                    >
                      Afficher tous les sites
                    </button>
                  ) : availableSites.length > 1 ? (
                    <button
                      type="button"
                      onClick={handleSelectAllSites}
                      className="text-[11px] text-gray-500 hover:text-gray-800 hover:underline cursor-pointer"
                    >
                      Tout sélectionner
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Site chips: strictly from items present in the list */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedSites([])}
                  className={`text-xs px-3 py-1.5 rounded-xl border transition-all cursor-pointer font-medium ${
                    selectedSites.length === 0
                      ? 'bg-gray-900 text-white border-gray-900 shadow-sm font-semibold'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                  }`}
                >
                  Tous les sites ({data.items.length})
                </button>
                {availableSites.map((site) => {
                  const isSelected = selectedSites.includes(site.name);
                  return (
                    <button
                      key={site.name}
                      type="button"
                      onClick={() => handleToggleSite(site.name)}
                      className={`text-xs px-3 py-1.5 rounded-xl border transition-all cursor-pointer font-medium flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm font-semibold ring-2 ring-blue-100'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                      }`}
                    >
                      <span>{site.name}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                          isSelected ? 'bg-blue-800 text-white' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {site.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Dynamic Price Filter (col-span-5) */}
            <div className="lg:col-span-5 space-y-2 border-t lg:border-t-0 lg:border-l lg:pl-5 border-gray-100 pt-3 lg:pt-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-600 flex items-center gap-1.5">
                  <span>💶</span>
                  <span>Échelle de prix</span>
                </span>
                {isPriceFiltered && (
                  <button
                    type="button"
                    onClick={() => setPriceRange(null)}
                    className="text-[11px] text-blue-600 hover:underline cursor-pointer font-medium"
                  >
                    Réinitialiser prix
                  </button>
                )}
              </div>

              {hasPricedItems ? (
                <div className="space-y-3 pt-1">
                  {minPriceBound < maxPriceBound ? (
                    <>
                      {/* Price values display & direct inputs */}
                      <div className="flex items-center justify-between text-xs font-semibold text-gray-700">
                        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500">
                          <span className="text-gray-400 text-[11px]">Min :</span>
                          <input
                            type="number"
                            min={minPriceBound}
                            max={effectiveMax - 1}
                            value={effectiveMin}
                            onChange={(e) => {
                              handleMinPriceChange(Number(e.target.value));
                            }}
                            className="w-14 text-center font-bold text-emerald-700 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-emerald-700">€</span>
                        </div>
                        <span className="text-gray-400 font-normal">à</span>
                        <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500">
                          <span className="text-gray-400 text-[11px]">Max :</span>
                          <input
                            type="number"
                            min={effectiveMin + 1}
                            max={maxPriceBound}
                            value={effectiveMax}
                            onChange={(e) => {
                              handleMaxPriceChange(Number(e.target.value));
                            }}
                            className="w-14 text-center font-bold text-emerald-700 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-emerald-700">€</span>
                        </div>
                      </div>

                      {/* Dual range slider */}
                      <div className="relative h-6 flex items-center py-2">
                        <div className="absolute w-full h-2 bg-gray-200 rounded-lg">
                          <div
                            className="absolute h-2 bg-blue-600 rounded-lg"
                            style={{
                              left: `${((effectiveMin - minPriceBound) / (maxPriceBound - minPriceBound || 1)) * 100}%`,
                              width: `${((effectiveMax - effectiveMin) / (maxPriceBound - minPriceBound || 1)) * 100}%`,
                            }}
                          />
                        </div>
                        <input
                          type="range"
                          min={minPriceBound}
                          max={maxPriceBound}
                          value={effectiveMin}
                          onChange={(e) => {
                            handleMinPriceChange(Number(e.target.value));
                          }}
                          style={{
                            zIndex: effectiveMin > (minPriceBound + maxPriceBound) / 2 ? 20 : 10,
                          }}
                          className="absolute w-full h-2 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
                        />
                        <input
                          type="range"
                          min={minPriceBound}
                          max={maxPriceBound}
                          value={effectiveMax}
                          onChange={(e) => {
                            handleMaxPriceChange(Number(e.target.value));
                          }}
                          style={{
                            zIndex: effectiveMin > (minPriceBound + maxPriceBound) / 2 ? 10 : 20,
                          }}
                          className="absolute w-full h-2 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span>Min : {minPriceBound} €</span>
                        <span>Max : {maxPriceBound} €</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-gray-600 italic">
                      Tous les articles avec prix sont à {minPriceBound} €.
                    </p>
                  )}

                  {unpricedCount > 0 && (
                    <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-600 select-none pt-1">
                      <input
                        type="checkbox"
                        checked={includeNoPrice}
                        onChange={(e) => setIncludeNoPrice(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>Inclure articles sans prix ({unpricedCount})</span>
                    </label>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-500 italic pt-1">Aucun prix renseigné sur les articles.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Items List View or Filter Empty State */}
      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-200 shadow-sm space-y-3">
          <span className="text-4xl block">🔎</span>
          <h3 className="text-lg font-bold text-gray-800">Aucun article trouvé</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Aucun article ne correspond aux critères de prix ou de boutique sélectionnés.
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="mt-2 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2.5 px-4 rounded-xl shadow-sm transition-colors cursor-pointer"
          >
            Réinitialiser les filtres
          </button>
        </div>
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {filteredItems.map((item) => {
          const itemImages = parseItemImages(item.image_url);
          const coverImage = itemImages[0] || '';
          const stats = getItemReservationStats(item.quantity, item.reserved_by, item.is_reserved);

          return (
            <div
              key={item.id}
              className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 border border-gray-200 overflow-hidden flex flex-col justify-between"
            >
              <div>
                {/* Clickable Image & Title (Opens detailed popup without opening store site) */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedItem(item);
                    setActiveImageIndex(0);
                  }}
                  className="w-full text-left group/btn focus:outline-none block cursor-pointer"
                >
                  {/* Product Image Container */}
                  <div className="relative w-full h-56 bg-white flex items-center justify-center p-4 border-b border-gray-100 overflow-hidden">
                    {/* Ranking Badge */}
                    <span
                      className={`absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full text-xs font-bold shadow-sm tracking-wide ${
                        item.preference_order === 1
                          ? 'bg-amber-400 text-amber-950 border border-amber-300'
                          : 'bg-gray-900 text-white'
                      }`}
                    >
                      # {item.preference_order}
                    </span>

                    {/* Edit Pencil Button (admin only) */}
                    {data.isAdmin && (
                      <button
                        type="button"
                        onClick={(e) => openEditModal(item, e)}
                        className="absolute top-3 right-3 z-10 bg-white/90 hover:bg-white text-gray-600 hover:text-blue-600 p-1.5 rounded-lg shadow-sm border border-gray-200 opacity-0 group-hover/btn:opacity-100 transition-all"
                        title="Modifier cet article"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    )}

                    {/* Status ribbon for guests */}
                    {!data.isAdmin && stats.isFullyReserved && (
                      <span className="absolute top-3 right-3 z-10 bg-red-600/90 text-white text-[11px] font-bold px-2.5 py-0.5 rounded-full shadow-sm tracking-wide uppercase">
                        Réservé
                      </span>
                    )}

                    {/* Multiple images indicator */}
                    {itemImages.length > 1 && (
                      <span className="absolute bottom-2 right-2 z-10 bg-black/70 backdrop-blur-sm text-white text-[11px] font-medium px-2 py-0.5 rounded-md flex items-center gap-1 shadow">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {itemImages.length} photos
                      </span>
                    )}

                    {/* Image or Fallback */}
                    {coverImage ? (
                      <img
                        src={coverImage}
                        alt={item.title}
                        className="w-full h-full object-contain group-hover/btn:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-50 flex flex-col items-center justify-center text-gray-400 gap-1.5">
                        <svg
                          className="w-10 h-10 text-gray-300"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                        <span className="text-xs font-medium">No image</span>
                      </div>
                    )}
                  </div>

                  {/* Product Title & Quantity Badge */}
                  <div className="p-4 pb-2 flex items-start justify-between gap-2">
                    <h3 className="font-bold text-gray-900 line-clamp-2 text-base leading-snug group-hover/btn:text-blue-600 transition-colors">
                      {item.title}
                    </h3>
                    {stats.totalQty > 1 && (
                      <span
                        className={`shrink-0 font-bold text-xs px-2 py-0.5 rounded-md border shadow-xs ${
                          !data.isAdmin && stats.isFullyReserved
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : !data.isAdmin && stats.reservedCount > 0
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200'
                        }`}
                        title={
                          !data.isAdmin && stats.reservedCount > 0
                            ? `${stats.reservedCount} pris sur ${stats.totalQty} (${stats.remainingQty} libre)`
                            : `${stats.totalQty} unités souhaitées`
                        }
                      >
                        {!data.isAdmin ? `${stats.remainingQty}/${stats.totalQty} libre` : `×${stats.totalQty}`}
                      </span>
                    )}
                  </div>
                </button>

                {/* Price and Options / Notes */}
                <div className="px-4 pb-4">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    {item.price !== null && (
                      <div>
                        <p className="text-xl font-extrabold text-emerald-600">
                          {item.price.toFixed(2)} €
                        </p>
                        {stats.totalQty > 1 && (
                          <p className="text-[11px] text-gray-500 font-medium">
                            {(item.price * stats.totalQty).toFixed(2)} € total ({stats.totalQty} unités)
                          </p>
                        )}
                      </div>
                    )}
                    {item.price === null && stats.totalQty > 1 && (
                      <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                        {stats.totalQty} unités
                      </span>
                    )}
                    <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-md border border-gray-200">
                      {extractSiteName(item.product_url)}
                    </span>
                  </div>
                  {item.options && (
                    <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">
                      <span className="font-medium text-gray-600">Options:</span> {item.options}
                    </p>
                  )}
                </div>
              </div>

              {/* Actions: Reservation Logic */}
              <div className="p-4 pt-3 border-t border-gray-100 mt-auto bg-gray-50/50">
                {!data.isAdmin ? (
                  <div>
                    {stats.isFullyReserved ? (
                      <div className="flex items-center justify-between gap-2 bg-red-50 text-red-700 border border-red-200 py-1.5 px-3 rounded-lg text-xs font-semibold">
                        <span
                          className="truncate min-w-0 flex-1"
                          title={formatReserversTooltip(stats.reservations)}
                        >
                          Réservé par {formatReserversSummary(stats.reservations)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleCancelReservation(item.id, e, stats.reservations)}
                          className="text-xs bg-white hover:bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded shadow-xs transition-colors cursor-pointer shrink-0 font-medium"
                          title="Annuler cette réservation"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : reservingItemId === item.id ? (
                      <div className="space-y-2 bg-white p-2.5 rounded-lg border border-blue-200 shadow-xs">
                        {stats.remainingQty > 1 && (
                          <div className="flex items-center justify-between text-xs text-gray-700 font-medium">
                            <span>Quantité :</span>
                            <div className="flex items-center gap-1 border border-gray-200 rounded-md overflow-hidden bg-gray-50">
                              <button
                                type="button"
                                onClick={() => setReserveCount((c) => Math.max(1, c - 1))}
                                className="px-2 py-0.5 text-gray-700 hover:bg-gray-200 font-bold select-none cursor-pointer"
                                title="Diminuer"
                              >
                                −
                              </button>
                              <span className="px-2 text-xs font-bold text-gray-800 select-none">
                                {reserveCount}
                              </span>
                              <button
                                type="button"
                                onClick={() => setReserveCount((c) => Math.min(stats.remainingQty, c + 1))}
                                className="px-2 py-0.5 text-gray-700 hover:bg-gray-200 font-bold select-none cursor-pointer"
                                title="Augmenter"
                              >
                                +
                              </button>
                            </div>
                            <span className="text-[11px] text-emerald-700 font-semibold">
                              ({stats.remainingQty}/{stats.totalQty} libre)
                            </span>
                          </div>
                        )}
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            placeholder="Votre nom"
                            value={reserverName}
                            onChange={(e) => setReserverName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleReserve(item.id, reserveCount)}
                            className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 text-black flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleReserve(item.id, reserveCount)}
                            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow-xs cursor-pointer"
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReservingItemId(null);
                              setReserverName('');
                              setReserveCount(1);
                            }}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                            title="Annuler"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {stats.totalQty > 1 && stats.reservedCount > 0 && (
                          <div className="flex items-center justify-between text-xs px-0.5 text-gray-600">
                            <span
                              className="truncate text-[11px] text-gray-500 max-w-[65%]"
                              title={formatReserversTooltip(stats.reservations)}
                            >
                              <strong className="text-amber-700 font-semibold">{stats.reservedCount} pris</strong>{' '}
                              ({formatReserversSummary(stats.reservations)})
                            </span>
                            <span className="text-xs font-bold text-emerald-700 shrink-0">
                              {stats.remainingQty}/{stats.totalQty} libre
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReservingItemId(item.id);
                            setReserveCount(1);
                          }}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 px-3 rounded-lg transition-colors shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <span>Réserver</span>
                          {stats.totalQty > 1 && (
                            <span className="bg-blue-700/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                              {stats.remainingQty}/{stats.totalQty} libre
                            </span>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <a
                    href={item.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-xs font-medium text-gray-500 hover:text-blue-600 py-1.5 rounded-lg border border-gray-200 hover:bg-white transition-colors"
                  >
                    Voir sur {extractSiteName(item.product_url)} ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </section>
      )}

      {/* Product Detail Modal */}
      {selectedItem && (() => {
        const modalImages = parseItemImages(selectedItem.image_url);
        const currentImage = modalImages[activeImageIndex] || modalImages[0] || '';
        const modalStats = getItemReservationStats(selectedItem.quantity, selectedItem.reserved_by, selectedItem.is_reserved);

        return (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
            onClick={() => setSelectedItem(null)}
          >
            <div
              className="relative bg-white rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden my-8 max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="absolute top-4 right-4 z-20 bg-white/80 hover:bg-white text-gray-700 hover:text-black p-2 rounded-full shadow-md backdrop-blur-sm transition-colors"
                title="Fermer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <div className="overflow-y-auto flex-1">
                {/* Large Image & Gallery Carousel */}
                <div className="relative w-full h-72 sm:h-96 bg-white flex items-center justify-center p-6 border-b border-gray-100">
                  {/* Ranking Badge */}
                  <span
                    className={`absolute top-4 left-4 z-10 px-3 py-1 rounded-full text-xs font-bold shadow-md tracking-wide ${
                      selectedItem.preference_order === 1
                        ? 'bg-amber-400 text-amber-950 border border-amber-300'
                        : 'bg-gray-900 text-white'
                    }`}
                  >
                    # {selectedItem.preference_order}
                  </span>

                  {/* Main Large Image */}
                  {currentImage ? (
                    <img
                      src={currentImage}
                      alt={selectedItem.title}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 bg-gray-50">
                      <svg className="w-12 h-12 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-sm font-medium">No image available</span>
                    </div>
                  )}

                  {/* Previous / Next buttons if multiple images */}
                  {modalImages.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveImageIndex((prev) =>
                            prev > 0 ? prev - 1 : modalImages.length - 1
                          )
                        }
                        className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white text-gray-800 p-2 rounded-full shadow-lg backdrop-blur-sm transition-all"
                        title="Image précédente"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveImageIndex((prev) =>
                            prev < modalImages.length - 1 ? prev + 1 : 0
                          )
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white text-gray-800 p-2 rounded-full shadow-lg backdrop-blur-sm transition-all"
                        title="Image suivante"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>

                      {/* Counter indicator */}
                      <span className="absolute bottom-3 right-4 bg-black/60 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-full">
                        {activeImageIndex + 1} / {modalImages.length}
                      </span>
                    </>
                  )}
                </div>

                {/* Thumbnails Row if multiple images */}
                {modalImages.length > 1 && (
                  <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 flex gap-2 overflow-x-auto">
                    {modalImages.map((img, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActiveImageIndex(idx)}
                        className={`w-14 h-14 rounded-lg bg-white p-1 border-2 shrink-0 transition-all cursor-pointer ${
                          idx === activeImageIndex
                            ? 'border-blue-600 ring-2 ring-blue-100 shadow-sm'
                            : 'border-gray-200 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <img src={img} alt="" className="w-full h-full object-contain rounded" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Product Full Details */}
                <div className="p-6 space-y-4">
                  {/* Full detailed product name */}
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-900 leading-snug">
                    {selectedItem.title}
                  </h2>

                  {/* Large Price and Quantity */}
                  <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    {selectedItem.price !== null ? (
                      <div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-extrabold text-emerald-600">
                            {selectedItem.price.toFixed(2)} €
                          </span>
                          {selectedItem.quantity && selectedItem.quantity > 1 && (
                            <span className="text-xs text-gray-500 font-medium">l&apos;unité</span>
                          )}
                        </div>
                        {selectedItem.quantity && selectedItem.quantity > 1 && (
                          <p className="text-sm text-gray-600 font-medium mt-1">
                            Total estimé : <span className="font-bold text-emerald-700">{(selectedItem.price * selectedItem.quantity).toFixed(2)} €</span> pour {selectedItem.quantity} unités
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 italic">Prix non renseigné</span>
                    )}

                    {modalStats.totalQty > 1 && (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 px-3.5 py-1.5 rounded-xl border border-blue-200 shadow-xs">
                          <span className="text-xs font-bold uppercase tracking-wider">Quantité souhaitée :</span>
                          <span className="text-lg font-black">{modalStats.totalQty}</span>
                        </div>
                        {!data.isAdmin && (
                          <span
                            className={`text-xs font-semibold px-2.5 py-0.5 rounded-md border ${
                              modalStats.isFullyReserved
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : modalStats.reservedCount > 0
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}
                          >
                            {modalStats.isFullyReserved
                              ? 'Tous réservés'
                              : modalStats.reservedCount > 0
                              ? `${modalStats.reservedCount} pris • ${modalStats.remainingQty}/${modalStats.totalQty} libre`
                              : `${modalStats.totalQty}/${modalStats.totalQty} libre`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Notes / Options */}
                  {selectedItem.options && (
                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Options & Remarques
                      </p>
                      <p className="text-sm text-gray-800 whitespace-pre-line">
                        {selectedItem.options}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer: Actions */}
              <div className="p-6 pt-4 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row gap-3 items-center justify-between">
                <a
                  href={selectedItem.product_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full sm:w-auto flex-1 bg-white hover:bg-gray-100 text-gray-800 text-sm font-semibold py-3 px-4 rounded-xl border border-gray-300 text-center transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  <span>Voir sur {extractSiteName(selectedItem.product_url)}</span>
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>

                {!data.isAdmin && (
                  <div className="w-full sm:w-auto flex-1">
                    {modalStats.isFullyReserved ? (
                      <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 py-2.5 px-4 rounded-xl min-w-0">
                        <span
                          className="text-sm font-semibold text-red-700 truncate min-w-0 flex-1"
                          title={formatReserversTooltip(modalStats.reservations)}
                        >
                          Réservé par {formatReserversSummary(modalStats.reservations)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCancelReservation(selectedItem.id, undefined, modalStats.reservations)}
                          className="bg-white hover:bg-red-100 text-red-700 border border-red-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow-xs cursor-pointer shrink-0"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : reservingItemId === selectedItem.id ? (
                      <div className="bg-white p-3 rounded-xl border border-blue-200 shadow-xs space-y-2.5 w-full">
                        {modalStats.remainingQty > 1 && (
                          <div className="flex items-center justify-between text-xs text-gray-700 font-medium">
                            <span>Quantité à réserver :</span>
                            <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                              <button
                                type="button"
                                onClick={() => setReserveCount((c) => Math.max(1, c - 1))}
                                className="px-2.5 py-1 text-gray-700 hover:bg-gray-200 font-bold select-none cursor-pointer"
                                title="Diminuer"
                              >
                                −
                              </button>
                              <span className="px-2 text-sm font-bold text-gray-900 select-none">
                                {reserveCount}
                              </span>
                              <button
                                type="button"
                                onClick={() => setReserveCount((c) => Math.min(modalStats.remainingQty, c + 1))}
                                className="px-2.5 py-1 text-gray-700 hover:bg-gray-200 font-bold select-none cursor-pointer"
                                title="Augmenter"
                              >
                                +
                              </button>
                            </div>
                            <span className="text-xs text-emerald-700 font-bold">
                              ({modalStats.remainingQty}/{modalStats.totalQty} libre)
                            </span>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Votre nom"
                            value={reserverName}
                            onChange={(e) => setReserverName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleReserve(selectedItem.id, reserveCount)}
                            className="text-sm border border-gray-300 rounded-xl px-3 py-2 text-black flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleReserve(selectedItem.id, reserveCount)}
                            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shadow-xs cursor-pointer"
                          >
                            OK
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReservingItemId(null);
                              setReserverName('');
                              setReserveCount(1);
                            }}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm px-3 py-2 rounded-xl transition-colors cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5 w-full">
                        {modalStats.totalQty > 1 && modalStats.reservedCount > 0 && (
                          <div className="flex items-center justify-between text-xs px-1 text-gray-600">
                            <span
                              className="truncate text-xs text-gray-500 max-w-[65%]"
                              title={formatReserversTooltip(modalStats.reservations)}
                            >
                              <strong className="text-amber-700 font-semibold">{modalStats.reservedCount} pris</strong>{' '}
                              ({formatReserversSummary(modalStats.reservations)})
                            </span>
                            <span className="text-xs font-bold text-emerald-700">
                              {modalStats.remainingQty}/{modalStats.totalQty} libre
                            </span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReservingItemId(selectedItem.id);
                            setReserveCount(1);
                          }}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-3 px-5 rounded-xl transition-colors shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <span>Réserver ce cadeau</span>
                          {modalStats.totalQty > 1 && (
                            <span className="bg-blue-700/60 text-white text-xs font-bold px-2 py-0.5 rounded-md">
                              {modalStats.remainingQty}/{modalStats.totalQty} libre
                            </span>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Item Modal (admin only) */}
      {editingItem && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setEditingItem(null)}
        >
          <div
            className="relative bg-white rounded-3xl max-w-lg w-full shadow-2xl my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                Modifier l&apos;article
              </h2>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Titre</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prix (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full border rounded-xl px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantité</label>
                  <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden bg-white focus-within:ring-2 focus-within:ring-blue-500">
                    <button
                      type="button"
                      onClick={() => setEditQuantity((q) => Math.max(1, q - 1))}
                      className="px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold border-r border-gray-200 cursor-pointer select-none"
                      title="Diminuer la quantité"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={editQuantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setEditQuantity(isNaN(val) || val < 1 ? 1 : val);
                      }}
                      className="w-full text-center py-2 text-black font-semibold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => setEditQuantity((q) => q + 1)}
                      className="px-3 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold border-l border-gray-200 cursor-pointer select-none"
                      title="Augmenter la quantité"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rang préférence</label>
                  <input
                    type="number"
                    min={1}
                    value={editPreference}
                    onChange={(e) => setEditPreference(parseInt(e.target.value) || 1)}
                    className="w-full border rounded-xl px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Options / Notes</label>
                <input
                  type="text"
                  value={editOptions}
                  onChange={(e) => setEditOptions(e.target.value)}
                  placeholder="Taille: 5 m, Couleur: Blanc..."
                  className="w-full border rounded-xl px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL du produit</label>
                <input
                  type="text"
                  value={editProductUrl}
                  onChange={(e) => setEditProductUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full border rounded-xl px-3 py-2 text-black text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Image du produit</label>
                <div className="flex gap-2 items-center">
                  {editImageUrl ? (
                    <img
                      src={editImageUrl}
                      alt=""
                      className="w-12 h-12 object-contain rounded-lg border bg-white p-1 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-gray-100 rounded-lg border border-dashed flex items-center justify-center text-gray-400 text-xs shrink-0">
                      No img
                    </div>
                  )}
                  <input
                    type="text"
                    value={editImageUrl}
                    onChange={(e) => setEditImageUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 border rounded-xl px-3 py-2 text-black text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* If multiple images exist, let user click a thumbnail to choose as cover */}
                {editImages.length > 1 && (
                  <div className="mt-2.5 space-y-1">
                    <p className="text-xs text-gray-500 font-medium">Photos détectées (cliquez pour choisir l&apos;image principale) :</p>
                    <div className="flex gap-2 overflow-x-auto p-1.5 bg-gray-50 rounded-xl border border-gray-100">
                      {editImages.map((img, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setEditImageUrl(img)}
                          className={`w-12 h-12 rounded-lg border-2 p-0.5 bg-white shrink-0 cursor-pointer transition-all ${
                            editImageUrl === img ? 'border-blue-600 ring-2 ring-blue-100 shadow-sm' : 'border-gray-200 opacity-60 hover:opacity-100'
                          }`}
                          title="Définir comme image principale"
                        >
                          <img src={img} alt="" className="w-full h-full object-contain rounded" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl transition-colors shadow-sm"
                >
                  {savingEdit ? 'Enregistrement...' : 'Enregistrer'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteItem(editingItem.id)}
                  className="bg-red-50 hover:bg-red-100 text-red-600 font-semibold py-2.5 px-4 rounded-xl border border-red-200 transition-colors"
                  title="Supprimer l'article"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Modal Dialog */}
      {showShareModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowShareModal(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 relative animate-in fade-in duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-2 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Partager la wishlist</h3>
                  <p className="text-xs text-gray-500">Lien invité sans spoiler</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="text-gray-400 hover:text-gray-700 p-2 rounded-full hover:bg-gray-100 transition cursor-pointer"
                title="Fermer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-600 leading-relaxed">
              Donnez ce lien public à vos amis pour qu&apos;ils puissent consulter la liste et réserver des cadeaux sans spoiler vos surprises :
            </p>

            <div className="flex gap-2 items-center bg-gray-50 border border-gray-200 rounded-xl p-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
              <input
                type="text"
                readOnly
                value={typeof window !== 'undefined' ? `${window.location.origin}/liste/${listId}` : ''}
                className="flex-1 bg-transparent border-none px-2 py-1 text-xs font-mono text-gray-800 outline-none select-all"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                onClick={handleShare}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm shrink-0 cursor-pointer"
              >
                {copied ? '✓ Copié !' : 'Copier'}
              </button>
            </div>

            {copied && (
              <p className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
                <span>✓</span> Lien copié dans votre presse-papiers !
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Main page component wrapped in a Suspense boundary
export default function WishlistPage() {
  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <Suspense fallback={<div className="p-8 text-center text-gray-600">Loading wishlist...</div>}>
        <WishlistContent />
      </Suspense>
    </main>
  );
}