'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { remindersApi } from '@/lib/api';
import { Plus, Bell, BellOff, Trash2, AlertCircle } from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';
import { de } from 'date-fns/locale';
import { Reminder } from '@/types';

export default function RemindersPage() {
  const { reminders, setReminders, addReminder, removeReminder } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ triggerAt: '', message: '', type: 'TIME' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { remindersApi.getAll().then((r) => setReminders(r.data)); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await remindersApi.create({ ...form, triggerAt: new Date(form.triggerAt).toISOString() });
      addReminder(res.data);
      setShowForm(false);
      setForm({ triggerAt: '', message: '', type: 'TIME' });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    await remindersApi.delete(id);
    removeReminder(id);
  };

  const upcoming = reminders.filter((r) => !r.sent && !isPast(parseISO(r.triggerAt)));
  const past = reminders.filter((r) => r.sent || isPast(parseISO(r.triggerAt)));

  const ReminderCard = ({ reminder }: { reminder: Reminder }) => {
    const overdue = isPast(parseISO(reminder.triggerAt)) && !reminder.sent;
    return (
      <div className={`card flex items-start gap-3 ${overdue ? 'border-amber-500/30 bg-amber-500/5' : ''}`}>
        <div className={`mt-0.5 p-2 rounded-lg ${reminder.sent ? 'bg-slate-700' : overdue ? 'bg-amber-500/20' : 'bg-blue-500/20'}`}>
          {reminder.sent ? <BellOff size={16} className="text-slate-500" /> : overdue ? <AlertCircle size={16} className="text-amber-400" /> : <Bell size={16} className="text-blue-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{reminder.message || 'Erinnerung'}</p>
          <p className={`text-xs mt-0.5 ${overdue ? 'text-amber-400' : 'text-slate-500'}`}>
            {format(parseISO(reminder.triggerAt), "d. MMMM yyyy 'um' HH:mm 'Uhr'", { locale: de })}
            {overdue && ' · Überfällig'}
            {reminder.sent && ' · Gesendet'}
            {reminder.escalated && ' · Eskaliert'}
          </p>
          {reminder.event && <p className="text-xs text-blue-400 mt-0.5">📅 {reminder.event.title}</p>}
          {reminder.task && <p className="text-xs text-purple-400 mt-0.5">✅ {reminder.task.title}</p>}
          {reminder.escalationCount > 0 && <p className="text-xs text-orange-400 mt-0.5">{reminder.escalationCount}x eskaliert</p>}
        </div>
        <button onClick={() => handleDelete(reminder.id)} className="p-1.5 text-slate-600 hover:text-red-400 rounded-lg hover:bg-slate-800 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">{upcoming.length} aktive Erinnerungen</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={16} /> Neue Erinnerung
        </button>
      </div>

      {showForm && (
        <div className="card border-blue-500/20 bg-blue-500/5">
          <h3 className="font-medium text-white mb-4">Neue Erinnerung</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="label">Zeitpunkt</label>
              <input type="datetime-local" className="input bg-slate-800 border-slate-700 text-white" value={form.triggerAt} onChange={(e) => setForm({ ...form, triggerAt: e.target.value })} required />
            </div>
            <div>
              <label className="label">Nachricht</label>
              <input className="input bg-slate-800 border-slate-700 text-white" placeholder="Was soll dich erinnern?" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Abbrechen</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Erstellen...' : 'Erstellen'}</button>
            </div>
          </form>
        </div>
      )}

      {upcoming.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Bevorstehend</h3>
          <div className="space-y-2">{upcoming.map((r) => <ReminderCard key={r.id} reminder={r} />)}</div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Vergangen</h3>
          <div className="space-y-2 opacity-70">{past.slice(0, 10).map((r) => <ReminderCard key={r.id} reminder={r} />)}</div>
        </div>
      )}

      {reminders.length === 0 && !showForm && (
        <div className="text-center py-16">
          <Bell size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500">Noch keine Erinnerungen</p>
          <p className="text-xs text-slate-600 mt-1">Erstelle deine erste Erinnerung</p>
        </div>
      )}
    </div>
  );
}
