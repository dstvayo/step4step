'use client';

import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { usersApi } from '@/lib/api';
import { User, Globe, Bell, Shield, Info } from 'lucide-react';

export default function SettingsPage() {
  const { user, setAuth, token } = useAuthStore();
  const [form, setForm] = useState({ name: user?.name || '', phone: user?.phone || '', language: user?.language || 'de' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await usersApi.updateProfile(form);
      setAuth(res.data, token!);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="card bg-slate-900 border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <User size={18} className="text-blue-400" />
          <h3 className="font-semibold text-white">Profil</h3>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="input bg-slate-800 border-slate-700 text-white" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Telefon (WhatsApp)</label>
              <input className="input bg-slate-800 border-slate-700 text-white" placeholder="+49 123 456789" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label flex items-center gap-1"><Globe size={14} /> Sprache</label>
            <select className="input bg-slate-800 border-slate-700 text-white" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="es">Español</option>
              <option value="ar">العربية</option>
              <option value="tr">Türkçe</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Speichern...' : 'Speichern'}</button>
            {saved && <span className="text-sm text-green-400">✓ Gespeichert</span>}
          </div>
        </form>
      </div>

      <div className="card bg-slate-900 border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <Info size={18} className="text-blue-400" />
          <h3 className="font-semibold text-white">Über Koordination</h3>
        </div>
        <div className="space-y-2 text-sm text-slate-400">
          <div className="flex justify-between"><span>Version</span><span className="text-white font-medium">{process.env.NEXT_PUBLIC_VERSION}</span></div>
          <div className="flex justify-between"><span>E-Mail</span><span className="text-white">{user?.email}</span></div>
          <div className="flex justify-between"><span>Rolle</span><span className="text-white">{user?.role === 'ADMIN' ? 'Administrator' : 'Mitglied'}</span></div>
        </div>
      </div>

      <div className="card bg-slate-900 border-slate-800">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-blue-400" />
          <h3 className="font-semibold text-white">Sicherheit</h3>
        </div>
        <p className="text-sm text-slate-400">JWT-basierte Authentifizierung · Sitzung: 7 Tage</p>
      </div>
    </div>
  );
}
