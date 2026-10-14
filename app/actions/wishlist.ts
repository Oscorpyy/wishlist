'use server';

import { supabase } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

export async function createList(title: string) {
  const { data, error } = await supabase
    .from('lists')
    .insert([{ title }])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getListWithItems(listId: string, adminToken?: string) {
  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('*')
    .eq('id', listId)
    .single();

  if (listError || !list) return null;

  const isAdmin = adminToken === list.admin_token;

  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('*')
    .eq('list_id', listId)
    .order('preference_order', { ascending: true });

  if (itemsError) throw new Error(itemsError.message);

  const sanitizedItems = items.map((item) => {
    if (isAdmin) {
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
  const { error } = await supabase
    .from('items')
    .update({ is_reserved: true, reserved_by: reservedBy })
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
  const updatePayload: Record<string, any> = {
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
  const { error } = await supabase.from('items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/liste/${listId}`);
}