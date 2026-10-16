'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createList } from '@/app/actions/wishlist';

export default function HomePage() {
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const newList = await createList(title);
      if (typeof document !== 'undefined' && newList?.id && newList?.admin_token) {
        document.cookie = `wishlist_admin_${newList.id}=${newList.admin_token}; path=/; max-age=31536000; SameSite=Lax`;
        try {
          localStorage.setItem(`wishlist_admin_${newList.id}`, newList.admin_token);
        } catch {}
      }
      // Redirect directly with the admin_token key
      router.push(`/liste/${newList.id}?key=${newList.admin_token}`);
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Failed to create wishlist';
      setErrorMsg(msg);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  const isConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-6">
        <div className="flex justify-center mb-3">
          <img
            src="/favicon.ico"
            alt="Wishlist Logo"
            className="w-12 h-12 rounded-xl object-contain shadow-xs"
          />
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-4 text-center">
          Create Your Wishlist
        </h1>

        {!isConfigured && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg space-y-1">
            <p className="font-semibold">⚠️ Configuration Supabase manquante</p>
            <p>
              Créez ou complétez le fichier <code>.env.local</code> avec vos clés <code>NEXT_PUBLIC_SUPABASE_URL</code> et <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
            </p>
          </div>
        )}

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
            {errorMsg}
          </div>
        )}
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              List Name
            </label>
            <input
              type="text"
              placeholder="e.g., Birthday 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 text-black"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white font-medium py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? 'Creating...' : 'Create Wishlist'}
          </button>
        </form>
      </div>
    </main>
  );
}
