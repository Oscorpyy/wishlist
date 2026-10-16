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
    if (error.code === 'PGRST204' && String(error.message).includes('quantity')) {
      // If the column 'quantity' does not exist yet in Supabase, embed in options seamlessly
      delete payload.quantity;
      const cleanOpts = (data.options || '').replace(/\[qty:\d+\]/gi, '').trim();
      const qtyStr = `[qty:${qty}]`;
      payload.options = cleanOpts ? `${cleanOpts} ${qtyStr}` : qtyStr;

      const { error: retryError } = await supabase.from('items').insert([payload]);
      if (retryError) throw new Error(retryError.message);
    } else {
      throw new Error(error.message);
    }
  }

  revalidatePath(`/liste/${data.listId}`);
}

export async function reserveItem(
  itemId: string,
  listId: string,
  reservedBy: string,
  count: number = 1
) {
  assertSupabase();
  const name = reservedBy.trim();
  if (!name) throw new Error('Le nom est requis pour réserver.');

  const { data: item, error: fetchError } = await supabase
    .from('items')
    .select('reserved_by, quantity, options')
    .eq('id', itemId)
    .single();

  if (fetchError || !item) throw new Error(fetchError?.message || 'Article non trouvé');

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

  const { error } = await supabase
    .from('items')
    .update({
      is_reserved: isFullyReserved,
      reserved_by: JSON.stringify(updated),
    })
    .eq('id', itemId);

  if (error) throw new Error(error.message);
  revalidatePath(`/liste/${listId}`);
}

export async function cancelReservation(itemId: string, listId: string, reserverName?: string) {
  assertSupabase();
  if (reserverName) {
    const { data: item, error: fetchError } = await supabase
      .from('items')
      .select('reserved_by, quantity')
      .eq('id', itemId)
      .single();

    if (!fetchError && item) {
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

      if (error) throw new Error(error.message);
      revalidatePath(`/liste/${listId}`);
      return;
    }
  }

  // Fallback: reset all reservations on this item
  const { error } = await supabase
    .from('items')
    .update({ is_reserved: false, reserved_by: null })
    .eq('id', itemId);

  if (error) throw new Error(error.message);
  revalidatePath(`/liste/${listId}`);
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
    if (error.code === 'PGRST204' && String(error.message).includes('quantity')) {
      delete updatePayload.quantity;
      const cleanOpts = (data.options || '').replace(/\[qty:\d+\]/gi, '').trim();
      const qtyStr = `[qty:${qty}]`;
      updatePayload.options = cleanOpts ? `${cleanOpts} ${qtyStr}` : qtyStr;

      const { error: retryError } = await supabase
        .from('items')
        .update(updatePayload)
        .eq('id', itemId);
      if (retryError) throw new Error(retryError.message);
    } else {
      throw new Error(error.message);
    }
  }

  if (error) throw new Error(error.message);
  revalidatePath(`/liste/${listId}`);
}

export async function deleteItem(itemId: string, listId: string) {
  assertSupabase();
  const { error } = await supabase.from('items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/liste/${listId}`);
}