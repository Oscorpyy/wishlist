'use server';

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

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
    if (isAdmin) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { is_reserved, reserved_by, ...rest } = item;
      return rest;
    }
    return item;
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
}) {
  assertSupabase();
  const { error } = await supabase.from('items').insert([
    {
      list_id: data.listId,
      title: data.title,
      price: data.price,
      image_url: data.image,
      product_url: data.url,
      preference_order: data.preferenceOrder,
      options: data.options,
    },
  ]);

  if (error) throw new Error(error.message);
  revalidatePath(`/liste/${data.listId}`);
}

export async function reserveItem(itemId: string, listId: string, reservedBy: string) {
  assertSupabase();
  const { error } = await supabase
    .from('items')
    .update({ is_reserved: true, reserved_by: reservedBy })
    .eq('id', itemId);

  if (error) throw new Error(error.message);
  revalidatePath(`/liste/${listId}`);
}

export async function cancelReservation(itemId: string, listId: string) {
  assertSupabase();
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
  }
) {
  assertSupabase();
  const updatePayload: Record<string, unknown> = {
    title: data.title,
    price: data.price,
    preference_order: data.preference_order,
    options: data.options ?? '',
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

  if (error) throw new Error(error.message);
  revalidatePath(`/liste/${listId}`);
}

export async function deleteItem(itemId: string, listId: string) {
  assertSupabase();
  const { error } = await supabase.from('items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/liste/${listId}`);
}