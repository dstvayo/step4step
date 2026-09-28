'use client';

import { useState, useEffect } from 'react';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { Event } from '@/types';
import { format, parseISO } from 'date-fns';
import { eventsApi, usersApi } from '@/lib/api';

interface Props {
  event?: Event | null;
  defaultDate?: Date | null;
  onSave: (data: any) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const categories = [
  { label: 'Arbeit', color: '#3b82f6' }, { label: 'Privat', color: '#8b5cf6' },
  { label: 'Meeting', color: '#10b981' }, { label: 'Frist', color: '#ef4444' },
  { label: 'Urlaub', color: '#f59e0b' },
];

export default function EventModal({ event, defaultDate, onSave, onDelete, onClose }: Props) {
  const isNew = !event;
  const defaultStart = defaultDate ? format(defaultDate, "yyyy-MM-dd'T'09:00") : format(new Date(), "yyyy-MM-dd'T'09:00");
  const defaultEnd = defaultDate ? format(defaultDate, "yyyy-MM-dd'T'10:00") : format(new Date(), "yyyy-MM-dd'T'10:00");

  const [form, setForm] = useState({
    title: event?.title || '',
    description: event?.description || '',
    start: event ? format(parseISO(event.start), "yyyy-MM-dd'T'HH:mm") : defaultStart,
    end: event ? format(parseISO(event.end), "yyyy-MM-dd'T'HH:mm") : defaultEnd,
    location: event?.location || '',
    notes: event?.notes || '',
    category: event?.category || '',
    categoryColor: event?.categoryColor || '#3b82f6',
    urgency: event?.urgency || 'NORMAL',
    messageType: event?.messageType || 'EVENT',
    recurrenceRule: event?.recurrenceRule || '',
    reminderMinutes: event?.reminderMinutes?.toString() || '15',
    participantIds: event?.participants?.map((p) => p.user.id) || [],
  });

  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    usersApi.getAll().then((res) => setUsers(res.data));
  }, []);

  useEffect(() => {
    if (form.start && form.end) {
      eventsApi.checkConflicts(new Date(form.start).toISOString(), new Date(form.end).toISOString(), event?.id)
        .then((res) => setConflicts(res.data));
    }
  }, [form.start, form.end]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        start: new Date(form.start).toISOString(),
        end: new Date(form.end).toISOString(),
        reminderMinutes: form.reminderMinutes ? parseInt(form.reminderMinutes) : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-900">
          <h2 className="font-semibold text-white">{isNew ? 'Neuer Termin' : 'Termin bearbeiten'}</h2>
          <div className="flex items-center gap-2">
            {!isNew && <button onClick={() => onDelete(event!.id)} className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 size={16} /></button>}
            <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-800 rounded-lg"><X size={16} /></button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {conflicts.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
              <div className="text-sm text-amber-300">
                <p className="font-medium">Terminkonflikt erkannt</p>
                {conflicts.map((c) => <p key={c.id} className="text-xs opacity-80">{c.title}</p>)}
              </div>
            </div>
          )}

          <div>
            <label className="label">Titel *</label>
            <input className="input bg-slate-800 border-slate-700 text-white" placeholder="Titel eingeben" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Von *</label>
              <input type="datetime-local" className="input bg-slate-800 border-slate-700 text-white" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} required />
            </div>
            <div>
              <label className="label">Bis *</label>
              <input type="datetime-local" className="input bg-slate-800 border-slate-700 text-white" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} required />
            </div>
          </div>

          <div>
            <label className="label">Ort</label>
            <input className="input bg-slate-800 border-slate-700 text-white" placeholder="Ort eingeben" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Dringlichkeit</label>
              <select className="input bg-slate-800 border-slate-700 text-white" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value as any })}>
                <option value="LOW">Niedrig</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">Hoch</option>
                <option value="CRITICAL">Kritisch</option>
              </select>
            </div>
            <div>
              <label className="label">Nachrichtenart</label>
              <select className="input bg-slate-800 border-slate-700 text-white" value={form.messageType} onChange={(e) => setForm({ ...form, messageType: e.target.value as any })}>
                <option value="EVENT">Termin</option>
                <option value="APPOINTMENT">Meeting</option>
                <option value="TASK">Aufgabe</option>
                <option value="REMINDER">Erinnerung</option>
                <option value="REQUEST">Anfrage</option>
                <option value="INFO">Info</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Kategorie</label>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  type="button"
                  key={c.label}
                  onClick={() => setForm({ ...form, category: c.label, categoryColor: c.color })}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                    ${form.category === c.label ? 'border-current opacity-100' : 'border-slate-700 opacity-60 hover:opacity-100'}`}
                  style={{ color: c.color, borderColor: form.category === c.label ? c.color : undefined }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Erinnerung (Minuten vorher)</label>
            <select className="input bg-slate-800 border-slate-700 text-white" value={form.reminderMinutes} onChange={(e) => setForm({ ...form, reminderMinutes: e.target.value })}>
              <option value="">Keine</option>
              <option value="5">5 Minuten</option>
              <option value="15">15 Minuten</option>
              <option value="30">30 Minuten</option>
              <option value="60">1 Stunde</option>
              <option value="1440">1 Tag</option>
            </select>
          </div>

          <div>
            <label className="label">Teilnehmer</label>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={form.participantIds.includes(u.id)}
                    onChange={(e) => setForm({
                      ...form,
                      participantIds: e.target.checked
                        ? [...form.participantIds, u.id]
                        : form.participantIds.filter((id) => id !== u.id),
                    })}
                  />
                  <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white shrink-0">
                    {u.name[0]}
                  </div>
                  <div>
                    <p className="text-sm text-white">{u.name}</p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Notizen</label>
            <textarea className="input bg-slate-800 border-slate-700 text-white h-20 resize-none" placeholder="Zusätzliche Notizen..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Speichern...' : 'Speichern'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
