'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import Link from 'next/link';

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await authApi.register(form);
      setAuth(res.data.user, res.data.token);
      router.push('/');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registrierung fehlgeschlagen');
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
          <p className="text-slate-400 text-sm mt-1">Neues Konto erstellen</p>
        </div>

        <div className="card bg-slate-900 border-slate-800">
          <h2 className="text-lg font-semibold text-white mb-5">Registrieren</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Name</label>
              <input type="text" className="input bg-slate-800 border-slate-700 text-white" placeholder="Max Mustermann" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="label">E-Mail</label>
              <input type="email" className="input bg-slate-800 border-slate-700 text-white" placeholder="name@beispiel.de" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="label">Telefon (optional, für WhatsApp)</label>
              <input type="tel" className="input bg-slate-800 border-slate-700 text-white" placeholder="+49 123 456789" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">Passwort</label>
              <input type="password" className="input bg-slate-800 border-slate-700 text-white" placeholder="Mindestens 8 Zeichen" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
            </div>
            {error && <p className="text-red-400 text-sm bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Konto erstellen...' : 'Konto erstellen'}</button>
          </form>
          <p className="text-center text-sm text-slate-500 mt-4">Bereits registriert? <Link href="/auth/login" className="text-blue-400 hover:text-blue-300">Anmelden</Link></p>
        </div>
      </div>
    </div>
  );
}
