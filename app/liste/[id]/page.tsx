'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { getListWithItems, addItemToList, reserveItem, cancelReservation, updateItem, deleteItem } from '@/app/actions/wishlist';
import { scrapeProductUrl } from '@/app/actions/scrape';

interface Item {
  id: string;
  title: string;
  price: number | null;
  image_url: string;
  product_url: string;
  preference_order: number;
  options?: string;
  is_reserved?: boolean;
  reserved_by?: string;
}

interface ListData {
  list: { id: string; title: string };
  items: Item[];
  isAdmin: boolean;
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
  const [options, setOptions] = useState('');
  const [scrapedAvailableOptions, setScrapedAvailableOptions] = useState<Record<string, string[]>>({});

  // Modal & Gallery states
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Edit Modal states
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editProductUrl, setEditProductUrl] = useState('');
  const [editPreference, setEditPreference] = useState(1);
  const [editOptions, setEditOptions] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Form states for reserving an item
  const [reservingItemId, setReservingItemId] = useState<string | null>(null);
  const [reserverName, setReserverName] = useState('');

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
    }
    setLoading(false);
  }, [listId, adminKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadList();
  }, [loadList]);

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

      await updateItem(editingItem.id, listId, {
        title: editTitle.trim(),
        price: editPrice ? parseFloat(editPrice) : null,
        image_url: imagePayload,
        product_url: finalProductUrl,
        preference_order: editPreference,
        options: editOptions.trim(),
      });

      if (selectedItem && selectedItem.id === editingItem.id) {
        setSelectedItem({
          ...selectedItem,
          title: editTitle.trim(),
          price: editPrice ? parseFloat(editPrice) : null,
          image_url: imagePayload,
          product_url: finalProductUrl,
          preference_order: editPreference,
          options: editOptions.trim(),
        });
      }

      setEditingItem(null);
      await loadList();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      alert(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cet article de la liste ?')) return;
    try {
      await deleteItem(itemId, listId);
      if (selectedItem && selectedItem.id === itemId) setSelectedItem(null);
      if (editingItem && editingItem.id === itemId) setEditingItem(null);
      loadList();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
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

    await addItemToList({
      listId,
      title: scrapedTitle,
      price: scrapedPrice ? parseFloat(scrapedPrice) : null,
      image: imagePayload,
      url,
      preferenceOrder: preference,
      options,
    });

    const maxPref = data?.items?.reduce((max, item) => Math.max(max, item.preference_order || 0), 0) ?? 0;
    setPreference(Math.max(maxPref, preference) + 1);

    handleCancelAddItem();
    loadList();
  };

  const handleReserve = async (itemId: string) => {
    if (!reserverName.trim() || !listId) return;
    await reserveItem(itemId, listId, reserverName);
    setReservingItemId(null);
    setReserverName('');
    if (selectedItem && selectedItem.id === itemId) {
      setSelectedItem({
        ...selectedItem,
        is_reserved: true,
        reserved_by: reserverName,
      });
    }
    loadList();
  };

  const handleCancelReservation = async (itemId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!listId) return;
    if (!confirm('Voulez-vous annuler la réservation de cet article ?')) return;

    try {
      await cancelReservation(itemId, listId);
      if (selectedItem && selectedItem.id === itemId) {
        setSelectedItem({
          ...selectedItem,
          is_reserved: false,
          reserved_by: undefined,
        });
      }
      await loadList();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de l’annulation de la réservation';
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
        const refs = [fieldRef0, fieldRef1, fieldRef2, fieldRef3, fieldRef4];
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
    return <div className="p-8 text-center text-red-500">Wishlist not found.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="bg-white p-6 rounded-xl shadow flex justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">{data.list.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {data.isAdmin
              ? '👑 Mode Créateur (Réservations masquées pour garder la surprise !)'
              : '👥 Mode Invité (Vous pouvez réserver des articles)'}
          </p>
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Price (€)</label>
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
                  <label className="block text-sm font-medium text-gray-700">
                    Preference Rank (1 = Top)
                  </label>
                  <input
                    ref={fieldRef3}
                    type="number"
                    value={preference}
                    onChange={(e) => setPreference(parseInt(e.target.value) || 1)}
                    onKeyDown={(e) => handleFormKeyDown(e, 3)}
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
                  onKeyDown={(e) => handleFormKeyDown(e, 4)}
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

      {/* Items List View */}
      <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {data.items.map((item) => {
          const itemImages = parseItemImages(item.image_url);
          const coverImage = itemImages[0] || '';

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

                  {/* Product Title */}
                  <div className="p-4 pb-2">
                    <h3 className="font-bold text-gray-900 line-clamp-2 text-base leading-snug group-hover/btn:text-blue-600 transition-colors">
                      {item.title}
                    </h3>
                  </div>
                </button>

                {/* Price and Options / Notes */}
                <div className="px-4 pb-4">
                  {item.price !== null && (
                    <p className="text-xl font-extrabold text-emerald-600">
                      {item.price.toFixed(2)} €
                    </p>
                  )}
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
                    {item.is_reserved ? (
                      <div className="flex items-center justify-between gap-2 bg-red-50 text-red-700 border border-red-200 py-1.5 px-3 rounded-lg text-xs font-semibold">
                        <span className="truncate">Réservé par {item.reserved_by}</span>
                        <button
                          type="button"
                          onClick={(e) => handleCancelReservation(item.id, e)}
                          className="text-xs bg-white hover:bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded shadow-sm transition-colors cursor-pointer shrink-0 font-medium"
                          title="Annuler cette réservation"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : reservingItemId === item.id ? (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="Votre nom"
                          value={reserverName}
                          onChange={(e) => setReserverName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleReserve(item.id)}
                          className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 text-black flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleReserve(item.id)}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReservingItemId(null);
                            setReserverName('');
                          }}
                          className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                          title="Annuler"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReservingItemId(item.id)}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors shadow-sm cursor-pointer"
                      >
                        Réserver
                      </button>
                    )}
                  </div>
                ) : (
                  <a
                    href={item.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-xs font-medium text-gray-500 hover:text-blue-600 py-1.5 rounded-lg border border-gray-200 hover:bg-white transition-colors"
                  >
                    Voir sur la boutique ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* Product Detail Modal */}
      {selectedItem && (() => {
        const modalImages = parseItemImages(selectedItem.image_url);
        const currentImage = modalImages[activeImageIndex] || modalImages[0] || '';

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

                  {/* Large Price */}
                  {selectedItem.price !== null && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-extrabold text-emerald-600">
                        {selectedItem.price.toFixed(2)} €
                      </span>
                    </div>
                  )}

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
                  <span>Voir sur la boutique</span>
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>

                {!data.isAdmin && (
                  <div className="w-full sm:w-auto flex-1">
                    {selectedItem.is_reserved ? (
                      <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 py-2.5 px-4 rounded-xl">
                        <span className="text-sm font-semibold text-red-700 truncate">
                          Réservé par {selectedItem.reserved_by}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCancelReservation(selectedItem.id)}
                          className="bg-white hover:bg-red-100 text-red-700 border border-red-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow-sm cursor-pointer shrink-0"
                        >
                          Annuler la réservation
                        </button>
                      </div>
                    ) : reservingItemId === selectedItem.id ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Votre nom"
                          value={reserverName}
                          onChange={(e) => setReserverName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleReserve(selectedItem.id)}
                          className="text-sm border border-gray-300 rounded-xl px-3 py-2 text-black flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleReserve(selectedItem.id)}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors shadow-sm"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReservingItemId(null);
                            setReserverName('');
                          }}
                          className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm px-3 py-2 rounded-xl transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReservingItemId(selectedItem.id)}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-3 px-4 rounded-xl transition-colors shadow-sm"
                      >
                        Réserver ce cadeau
                      </button>
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

              <div className="grid grid-cols-2 gap-3">
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