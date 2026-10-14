-- Tables for Dynamic Wishlist
create extension if not exists "pgcrypto";

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  admin_token uuid not null default gen_random_uuid(),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  title text not null,
  price numeric(10, 2),
  image_url text default '',
  product_url text default '',
  preference_order integer default 1,
  options text default '',
  is_reserved boolean default false,
  reserved_by text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (optional / policy open for anonymous access if needed)
alter table public.lists enable row level security;
alter table public.items enable row level security;

create policy "Allow public all access on lists" on public.lists for all using (true) with check (true);
create policy "Allow public all access on items" on public.items for all using (true) with check (true);
