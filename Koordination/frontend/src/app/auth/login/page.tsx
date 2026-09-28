'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await authApi.login(form);
      setAuth(res.data.user, res.data.token);
      router.push('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-xl mx-auto mb-3">K</div>
          <h1 className="text-2xl font-bold text-white">Koordination</h1>
          <p className="text-slate-400 text-sm mt-1">Version {process.env.NEXT_PUBLIC_VERSION}</p>
        </div>

        <div className="card bg-slate-900 border-slate-800">
          <h2 className="text-lg font-semibold text-white mb-5">Anmelden</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">E-Mail</label>
              <input
                type="email"
                className="input bg-slate-800 border-slate-700 text-white"
                placeholder="name@beispiel.de"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Passwort</label>
              <input
                type="password"
                className="input bg-slate-800 border-slate-700 text-white"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>

            {error && <p className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Anmelden...' : 'Anmelden'}
            </button>
          </form>

          <p className="text-center text-sm text-slate-500 mt-4">
            Noch kein Konto?{' '}
            <Link href="/auth/register" className="text-blue-400 hover:text-blue-300">Registrieren</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
