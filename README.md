# Dynamic Wishlist

A serverless, zero-cost gift wishlist application built with Next.js, Supabase, and Tailwind CSS. Inspired by platforms like Throne, it allows users to create ranked wishlists by simply pasting product links, automatically extracting metadata (titles, prices, images), and sharing them with friends without spoiling gift surprises for the creator.

## Features

- **Dynamic Metadata Scraping:** Automatically fetches product titles, images, and prices from provided URLs using OpenGraph and HTML parsing.
- **Dual-Link Architecture:**
  - **Creator Link:** Allows complete list management (adding/removing items, setting order preference, adding options) while hiding gift reservation statuses.
  - **Guest Link:** Public view for friends to inspect items, select options, and reserve gifts without mandatory account registration.
- **Customization & Preference:** Support for explicit priority rankings and custom product options (e.g., color, size).
- **Anti-Spoiler Security:** Server-side payload filtering ensures reservation status is never sent to creator requests.
- **Zero-Cost Deployment:** Optimized for free-tier infrastructure using Vercel Serverless Functions and Supabase.

## Tech Stack

- **Framework:** Next.js (App Router, TypeScript)
- **Database:** Supabase (PostgreSQL)
- **Styling:** Tailwind CSS
- **Scraping:** Cheerio
- **Deployment:** Vercel

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
