'use server';

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { parseReservations, ReservationEntry } from '@/lib/reservations';

function assertSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase n’est pas configuré. Veuillez renseigner NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY dans votre fichier .env.local.'
    );
  }
}

export async function createList(title: string) {
  assertSupabase();
  const { data, error } = await supabase
    .from('lists')
    .insert([{ title }])
    .select()
    .single();

  if (error) throw new Error(error.message);

  if (data?.id && data?.admin_token) {
    try {
      const cookieStore = await cookies();
      cookieStore.set(`wishlist_admin_${data.id}`, data.admin_token, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      });
    } catch {
      // ignore in environments where cookies cannot be set
    }
  }

  return data;
}

export async function getListWithItems(listId: string, adminToken?: string) {
  if (!isSupabaseConfigured) return null;

  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('*')
    .eq('id', listId)
    .single();

  if (listError || !list) return null;

  let isAdmin = false;

  try {
    const cookieStore = await cookies();
    const storedToken = cookieStore.get(`wishlist_admin_${listId}`)?.value;

    const effectiveToken = adminToken || storedToken;
    if (effectiveToken && effectiveToken === list.admin_token) {
      isAdmin = true;
      try {
        cookieStore.set(`wishlist_admin_${listId}`, effectiveToken, {
          path: '/',
          maxAge: 60 * 60 * 24 * 365,
          sameSite: 'lax',
        });
      } catch {
        // ignore cookie write error during read actions
      }
    }
  } catch {
    isAdmin = adminToken === list.admin_token;
  }

  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('*')
    .eq('list_id', listId)
    .order('preference_order', { ascending: true });

  if (itemsError) throw new Error(itemsError.message);

  const sanitizedItems = items.map((item) => {
    let effectiveQuantity: number = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
    let cleanOptions: string = item.options || '';

    // Check for quantity encoded in options (e.g. [qty:3] or "Quantité : 3")
    const qtyMatch = cleanOptions.match(/\[qty:(\d+)\]/i) || cleanOptions.match(/\b(?:quantit[eé]|qt[eé])\s*[:=]\s*(\d+)\b/i);
    if (qtyMatch) {
      if (!item.quantity) {
        effectiveQuantity = parseInt(qtyMatch[1], 10) || 1;
      }
      cleanOptions = cleanOptions.replace(/\[qty:\d+\]/gi, '').trim();
    }

    const itemWithQty = {
      ...item,
      options: cleanOptions,
      quantity: effectiveQuantity,
    };

    if (isAdmin) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { is_reserved, reserved_by, ...rest } = itemWithQty;
      return rest;
    }
    return itemWithQty;
  });

  return {
    list,
    items: sanitizedItems,
    isAdmin,
  };
}

export async function addItemToList(data: {
  listId: string;
  title: string;
  price: number | null;
  image: string;
  url: string;
  preferenceOrder: number;
  options?: string;
  quantity?: number;
}) {
  try {
    assertSupabase();
    const qty = typeof data.quantity === 'number' && data.quantity > 0 ? data.quantity : 1;
    const payload: Record<string, unknown> = {
      list_id: data.listId,
      title: data.title,
      price: data.price,
      image_url: data.image ?? '',
      product_url: data.url ?? '',
      preference_order: data.preferenceOrder,
      options: data.options ?? '',
      quantity: qty,
    };

    const { error } = await supabase.from('items').insert([payload]);

    if (error) {
      if (
        (error.code === 'PGRST204' ||
          error.code === '42703' ||
          String(error.message).toLowerCase().includes('quantity')) &&
        payload.quantity !== undefined
      ) {
        // If the column 'quantity' does not exist yet in Supabase, embed in options seamlessly
        delete payload.quantity;
        const cleanOpts = (data.options || '').replace(/\[qty:\d+\]/gi, '').trim();
        const qtyStr = `[qty:${qty}]`;
        payload.options = cleanOpts ? `${cleanOpts} ${qtyStr}` : qtyStr;

        const { error: retryError } = await supabase.from('items').insert([payload]);
        if (retryError) return { success: false, error: retryError.message };
      } else {
        return { success: false, error: error.message };
      }
    }

    try {
      revalidatePath(`/liste/${data.listId}`);
    } catch {
      // ignore revalidation error
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de l’ajout de l’article';
    return { success: false, error: msg };
  }
}

export async function reserveItem(
  itemId: string,
  listId: string,
  reservedBy: string,
  count: number = 1
) {
  try {
    assertSupabase();
    const name = reservedBy.trim();
    if (!name) return { success: false, error: 'Le nom est requis pour réserver.' };

    let item: { reserved_by?: string | null; quantity?: number | null; options?: string | null } | null = null;

    const { data: itemData, error: fetchError } = await supabase
      .from('items')
      .select('reserved_by, quantity, options')
      .eq('id', itemId)
      .single();

    if (fetchError) {
      if (
        fetchError.code === 'PGRST204' ||
        fetchError.code === '42703' ||
        String(fetchError.message).toLowerCase().includes('quantity')
      ) {
        // Fallback without quantity column if not present in schema
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('items')
          .select('reserved_by, options')
          .eq('id', itemId)
          .single();

        if (fallbackError || !fallbackData) {
          return { success: false, error: fallbackError?.message || 'Article non trouvé' };
        }
        item = fallbackData;
      } else {
        return { success: false, error: fetchError.message || 'Article non trouvé' };
      }
    } else {
      item = itemData;
    }

    if (!item) return { success: false, error: 'Article non trouvé' };

    let totalQty = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
    if (!item.quantity && item.options) {
      const match = item.options.match(/\[qty:(\d+)\]/i);
      if (match) totalQty = parseInt(match[1], 10) || 1;
    }

    const existing = parseReservations(item.reserved_by);
    const currentTotal = existing.reduce((s, r) => s + r.count, 0);
    const remaining = Math.max(0, totalQty - currentTotal);
    const validCount = Math.max(1, Math.min(count, remaining > 0 ? remaining : 1));

    const existingIdx = existing.findIndex((e) => e.name.toLowerCase() === name.toLowerCase());
    let updated: ReservationEntry[];
    if (existingIdx >= 0) {
      updated = existing.map((entry, idx) =>
        idx === existingIdx ? { ...entry, count: entry.count + validCount } : entry
      );
    } else {
      updated = [...existing, { name, count: validCount }];
    }

    const newTotal = updated.reduce((s, r) => s + r.count, 0);
    const isFullyReserved = newTotal >= totalQty;

    const { error: updateError } = await supabase
      .from('items')
      .update({
        is_reserved: isFullyReserved,
        reserved_by: JSON.stringify(updated),
      })
      .eq('id', itemId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    try {
      revalidatePath(`/liste/${listId}`);
    } catch {
      // ignore revalidation error
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la réservation';
    return { success: false, error: msg };
  }
}

export async function cancelReservation(itemId: string, listId: string, reserverName?: string) {
  try {
    assertSupabase();
    if (reserverName) {
      let item: { reserved_by?: string | null; quantity?: number | null } | null = null;
      const { data: itemData, error: fetchError } = await supabase
        .from('items')
        .select('reserved_by, quantity')
        .eq('id', itemId)
        .single();

      if (fetchError) {
        if (
          fetchError.code === 'PGRST204' ||
          fetchError.code === '42703' ||
          String(fetchError.message).toLowerCase().includes('quantity')
        ) {
          const { data: fbData } = await supabase
            .from('items')
            .select('reserved_by')
            .eq('id', itemId)
            .single();
          item = fbData;
        }
      } else {
        item = itemData;
      }

      if (item) {
        const existing = parseReservations(item.reserved_by);
        const filtered = existing.filter((r) => r.name.toLowerCase() !== reserverName.toLowerCase());
        const totalQty = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
        const totalReserved = filtered.reduce((s, r) => s + r.count, 0);
        const isFullyReserved = filtered.length > 0 && totalReserved >= totalQty;

        const { error } = await supabase
          .from('items')
          .update({
            is_reserved: isFullyReserved,
            reserved_by: filtered.length > 0 ? JSON.stringify(filtered) : null,
          })
          .eq('id', itemId);

        if (error) return { success: false, error: error.message };

        try {
          revalidatePath(`/liste/${listId}`);
        } catch {}

        return { success: true };
      }
    }

    // Fallback: reset all reservations on this item
    const { error } = await supabase
      .from('items')
      .update({ is_reserved: false, reserved_by: null })
      .eq('id', itemId);

    if (error) return { success: false, error: error.message };

    try {
      revalidatePath(`/liste/${listId}`);
    } catch {}

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de l’annulation de la réservation';
    return { success: false, error: msg };
  }
}

export async function updateItem(
  itemId: string,
  listId: string,
  data: {
    title: string;
    price: number | null;
    image_url?: string;
    product_url?: string;
    preference_order: number;
    options?: string;
    quantity?: number;
  }
) {
  try {
    assertSupabase();
    const qty = typeof data.quantity === 'number' && data.quantity > 0 ? data.quantity : 1;
    const updatePayload: Record<string, unknown> = {
      title: data.title,
      price: data.price,
      preference_order: data.preference_order,
      options: data.options ?? '',
      quantity: qty,
    };

    if (data.image_url !== undefined) {
      updatePayload.image_url = data.image_url;
    }
    if (data.product_url !== undefined) {
      updatePayload.product_url = data.product_url;
    }

    const { error } = await supabase
      .from('items')
      .update(updatePayload)
      .eq('id', itemId);

    if (error) {
      if (
        (error.code === 'PGRST204' ||
          error.code === '42703' ||
          String(error.message).toLowerCase().includes('quantity')) &&
        updatePayload.quantity !== undefined
      ) {
        delete updatePayload.quantity;
        const cleanOpts = (data.options || '').replace(/\[qty:\d+\]/gi, '').trim();
        const qtyStr = `[qty:${qty}]`;
        updatePayload.options = cleanOpts ? `${cleanOpts} ${qtyStr}` : qtyStr;

        const { error: retryError } = await supabase
          .from('items')
          .update(updatePayload)
          .eq('id', itemId);

        if (retryError) return { success: false, error: retryError.message };
      } else {
        return { success: false, error: error.message };
      }
    }

    try {
      revalidatePath(`/liste/${listId}`);
    } catch {
      // ignore revalidation error
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
    return { success: false, error: msg };
  }
}

export async function deleteItem(itemId: string, listId: string) {
  try {
    assertSupabase();
    const { error } = await supabase.from('items').delete().eq('id', itemId);
    if (error) return { success: false, error: error.message };

    try {
      revalidatePath(`/liste/${listId}`);
    } catch {}

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
    return { success: false, error: msg };
  }
}