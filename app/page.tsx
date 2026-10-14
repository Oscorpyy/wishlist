'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createList } from '@/app/actions/wishlist';

export default function HomePage() {
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    try {
      const newList = await createList(title);
      // Redirect directly with the admin_token key
      router.push(`/liste/${newList.id}?key=${newList.admin_token}`);
    } catch (err) {
      console.error(err);
      alert('Failed to create wishlist');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-4 text-center">
          Create Your Wishlist
        </h1>
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
