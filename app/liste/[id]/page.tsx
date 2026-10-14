'use client';

import { useEffect, useState, useRef, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { getListWithItems, addItemToList, reserveItem, updateItem, deleteItem } from '@/app/actions/wishlist';
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
        return parsed.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
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

  // Form states for adding a new item
  const [url, setUrl] = useState('');
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
  const [editProductUrl, setEditProductUrl] = useState('');
  const [editPreference, setEditPreference] = useState(1);
  const [editOptions, setEditOptions] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Form states for reserving an item
  const [reservingItemId, setReservingItemId] = useState<string | null>(null);
  const [reserverName, setReserverName] = useState('');

  const loadList = async () => {
    if (!listId) return;
    setLoading(true);
    const res = await getListWithItems(listId, adminKey);
    const listData = res as ListData | null;
    setData(listData);
    if (listData && listData.items) {
      const maxPref = listData.items.reduce((max, item) => Math.max(max, item.preference_order || 0), 0);
      setPreference(maxPref + 1);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadList();
  }, [listId, adminKey]);

  // Modal keyboard navigation
  useEffect(() => {
    if (!selectedItem && !editingItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingItem) setEditingItem(null);
        else if (selectedItem) setSelectedItem(null);
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
  }, [selectedItem, editingItem]);

  const openEditModal = (item: Item, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingItem(item);
    setEditTitle(item.title);
    setEditPrice(item.price !== null ? item.price.toString() : '');
    setEditImageUrl(item.image_url || '');
    setEditProductUrl(item.product_url || '');
    setEditPreference(item.preference_order || 1);
    setEditOptions(item.options || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !listId || !editTitle.trim()) return;
    setSavingEdit(true);
    try {
      await updateItem(editingItem.id, listId, {
        title: editTitle.trim(),
        price: editPrice ? parseFloat(editPrice) : null,
        image_url: editImageUrl.trim(),
        product_url: editProductUrl.trim(),
        preference_order: editPreference,
        options: editOptions.trim(),
      });

      if (selectedItem && selectedItem.id === editingItem.id) {
        setSelectedItem({
          ...selectedItem,
          title: editTitle.trim(),
          price: editPrice ? parseFloat(editPrice) : null,
          image_url: editImageUrl.trim(),
          product_url: editProductUrl.trim(),
          preference_order: editPreference,
          options: editOptions.trim(),
        });
      }

      setEditingItem(null);
      loadList();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la mise à jour');
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
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la suppression');
    }
  };

  const handleScrape = async () => {
    if (!url.trim()) return;
    setScraping(true);
    try {
      const res = await scrapeProductUrl(url);
      setScrapedTitle(res.title || '');
      setScrapedImage(res.image || '');
      setScrapedImages(res.images && res.images.length > 0 ? res.images : (res.image ? [res.image] : []));
      setScrapedPrice(res.price ? res.price.toString() : '');
      setOptions(res.options || '');
      setScrapedAvailableOptions(res.availableOptions || {});
      const maxPref = data?.items?.reduce((max, item) => Math.max(max, item.preference_order || 0), 0) ?? 0;
      setPreference(maxPref + 1);
      if (!res.title) {
        setScrapedTitle('Product');
      }
    } catch {
      alert('Unable to parse URL metadata. You can fill in the fields manually.');
      setScrapedTitle('Product');
    } finally {
      setScraping(false);
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scrapedTitle || !listId) return;

    let imagePayload = scrapedImage;
    if (scrapedImages.length > 1 && (scrapedImages[0] === scrapedImage || !scrapedImage)) {
      imagePayload = JSON.stringify(scrapedImages);
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

    setUrl('');
    setScrapedTitle('');
    setScrapedImage('');
    setScrapedImages([]);
    setScrapedPrice('');
    setOptions('');
    setScrapedAvailableOptions({});
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

  // Refs for add-item form keyboard navigation (Shift+Enter = next field, Ctrl+Enter = submit)
  const fieldRef0 = useRef<HTMLInputElement>(null);
  const fieldRef1 = useRef<HTMLInputElement>(null);
  const fieldRef2 = useRef<HTMLInputElement>(null);
  const fieldRef3 = useRef<HTMLInputElement>(null);
  const fieldRef4 = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const fieldRefs = [fieldRef0, fieldRef1, fieldRef2, fieldRef3, fieldRef4];

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      submitRef.current?.click();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (index < fieldRefs.length - 1) {
        fieldRefs[index + 1].current?.focus();
      } else {
        submitRef.current?.focus();
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
      <header className="bg-white p-6 rounded-xl shadow flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">{data.list.title}</h1>
          <p className="text-sm text-gray-500">
            {data.isAdmin ? '👑 Creator View (Spoilers hidden)' : '👥 Guest View'}
          </p>
        </div>
      </header>

      {/* Creator Section: Add items */}
      {data.isAdmin && (
        <section className="bg-white p-6 rounded-xl shadow space-y-4">
          <h2 className="text-xl font-semibold text-gray-800">Add an Item</h2>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="Paste product link (Amazon, Maxesport...)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && e.shiftKey) {
                  e.preventDefault();
                  if (!scraping) {
                    await handleScrape();
                    fieldRef0.current?.focus();
                  }
                } else if (e.key === 'Enter' && e.ctrlKey) {
                  e.preventDefault();
                  submitRef.current?.click();
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!scraping) handleScrape();
                }
              }}
              className="flex-1 border rounded-lg px-3 py-2 text-black"
            />
            <button
              type="button"
              onClick={handleScrape}
              disabled={scraping}
              className="bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-900 disabled:opacity-50"
            >
              {scraping ? 'Parsing...' : 'Fetch Info'}
            </button>
          </div>

          {scrapedTitle && (
            <form onSubmit={handleAddItem} className="space-y-3 pt-4 border-t">
              {/* Keyboard hint */}
              <p className="text-xs text-gray-400 italic">
                💡 <kbd className="bg-gray-100 border border-gray-300 rounded px-1 text-[11px]">Shift</kbd>+<kbd className="bg-gray-100 border border-gray-300 rounded px-1 text-[11px]">↵</kbd> champ suivant &nbsp;·&nbsp; <kbd className="bg-gray-100 border border-gray-300 rounded px-1 text-[11px]">Ctrl</kbd>+<kbd className="bg-gray-100 border border-gray-300 rounded px-1 text-[11px]">↵</kbd> enregistrer
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700">Title</label>
                <input
                  ref={fieldRefs[0]}
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
                    ref={fieldRefs[1]}
                    type="url"
                    placeholder="https://... (or auto-detected from product page)"
                    value={scrapedImage}
                    onKeyDown={(e) => handleFormKeyDown(e, 1)}
                    onChange={(e) => {
                      setScrapedImage(e.target.value);
                      setScrapedImages(e.target.value ? [e.target.value] : []);
                    }}
                    className="flex-1 border rounded-lg px-3 py-2 text-black text-sm"
                  />
                </div>
                {scrapedImages.length > 1 && (
                  <p className="text-xs text-gray-500 mt-1">
                    ✓ {scrapedImages.length} images automatically detected for the gallery
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Price (€)</label>
                  <input
                    ref={fieldRefs[2]}
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
                    ref={fieldRefs[3]}
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
                  ref={fieldRefs[4]}
                  type="text"
                  placeholder="e.g. Taille: 5 m, Couleur: Blanc"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  onKeyDown={(e) => handleFormKeyDown(e, 4)}
                  className="w-full border rounded-lg px-3 py-2 text-black"
                />

                {/* Detected options chips from the store */}
                {Object.entries(scrapedAvailableOptions).length > 0 && (
                  <div className="mt-2.5 p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Options détectées sur le site (cliquez pour sélectionner) :
                    </p>
                    {Object.entries(scrapedAvailableOptions).map(([dimension, values]) => (
                      <div key={dimension} className="space-y-1">
                        <span className="text-xs font-medium text-gray-700">{dimension} :</span>
                        <div className="flex flex-wrap gap-1.5">
                          {values.map((val) => {
                            const optStr = `${dimension}: ${val}`;
                            const isSelected = options.includes(val);
                            return (
                              <button
                                key={val}
                                type="button"
                                onClick={() => {
                                  let newOptions = options;
                                  if (newOptions.includes(`${dimension}:`)) {
                                    newOptions = newOptions.replace(
                                      new RegExp(`${dimension}:\\s*[^,;]+`, 'i'),
                                      optStr
                                    );
                                  } else if (newOptions.trim()) {
                                    newOptions = `${newOptions}, ${optStr}`;
                                  } else {
                                    newOptions = optStr;
                                  }
                                  setOptions(newOptions.trim());
                                }}
                                className={`text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                                  isSelected
                                    ? 'bg-blue-600 border-blue-600 text-white font-semibold shadow-sm'
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
              <button
                ref={submitRef}
                type="submit"
                className="w-full bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700"
              >
                Save Item
              </button>
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
                      <div className="w-full text-center text-xs font-semibold bg-red-50 text-red-700 border border-red-200 py-2 px-3 rounded-lg">
                        Reserved by {item.reserved_by}
                      </div>
                    ) : reservingItemId === item.id ? (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="Your Name"
                          value={reserverName}
                          onChange={(e) => setReserverName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleReserve(item.id)}
                          className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 text-black flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleReserve(item.id)}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReservingItemId(null);
                            setReserverName('');
                          }}
                          className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                          title="Cancel"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setReservingItemId(item.id)}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors shadow-sm"
                      >
                        Reserve
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
                    View on Store ↗
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
                      <div className="w-full text-center text-sm font-semibold bg-red-100 text-red-700 border border-red-200 py-3 px-4 rounded-xl">
                        Réservé par {selectedItem.reserved_by}
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
                  type="url"
                  value={editProductUrl}
                  onChange={(e) => setEditProductUrl(e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 text-black text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL de l&apos;image</label>
                <div className="flex gap-2 items-center">
                  {editImageUrl && (
                    <img
                      src={editImageUrl}
                      alt=""
                      className="w-12 h-12 object-contain rounded-lg border bg-white p-1 shrink-0"
                    />
                  )}
                  <input
                    type="url"
                    value={editImageUrl}
                    onChange={(e) => setEditImageUrl(e.target.value)}
                    className="flex-1 border rounded-xl px-3 py-2 text-black text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
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