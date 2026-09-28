'use client';

import { useState, useEffect } from 'react';
import { X, Trash2, Plus } from 'lucide-react';
import { Task } from '@/types';
import { format, parseISO } from 'date-fns';
import { usersApi } from '@/lib/api';

interface Props {
  task?: Task | null;
  onSave: (data: any) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function TaskModal({ task, onSave, onDelete, onClose }: Props) {
  const isNew = !task;
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    dueDate: task?.dueDate ? format(parseISO(task.dueDate), "yyyy-MM-dd") : '',
    priority: task?.priority || 'MEDIUM',
    messageType: task?.messageType || 'TASK',
    assigneeIds: task?.assignees?.map((a) => a.user.id) || [],
  });
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { usersApi.getAll().then((r) => setUsers(r.data)); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...form, dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-900">
          <h2 className="font-semibold text-white">{isNew ? 'Neue Aufgabe' : 'Aufgabe bearbeiten'}</h2>
          <div className="flex items-center gap-2">
            {!isNew && <button onClick={() => onDelete(task!.id)} className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg"><Trash2 size={16} /></button>}
            <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-800 rounded-lg"><X size={16} /></button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="label">Titel *</label>
            <input className="input bg-slate-800 border-slate-700 text-white" placeholder="Aufgabentitel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="label">Beschreibung</label>
            <textarea className="input bg-slate-800 border-slate-700 text-white h-20 resize-none" placeholder="Details zur Aufgabe..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Priorität</label>
              <select className="input bg-slate-800 border-slate-700 text-white" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as any })}>
                <option value="LOW">Niedrig</option>
                <option value="MEDIUM">Mittel</option>
                <option value="HIGH">Hoch</option>
              </select>
            </div>
            <div>
              <label className="label">Nachrichtenart</label>
              <select className="input bg-slate-800 border-slate-700 text-white" value={form.messageType} onChange={(e) => setForm({ ...form, messageType: e.target.value as any })}>
                <option value="TASK">Aufgabe</option>
                <option value="REQUEST">Anfrage</option>
                <option value="REMINDER">Erinnerung</option>
                <option value="INFO">Info</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Fälligkeitsdatum</label>
            <input type="date" className="input bg-slate-800 border-slate-700 text-white" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Teammitglieder zuweisen</label>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" className="rounded" checked={form.assigneeIds.includes(u.id)}
                    onChange={(e) => setForm({ ...form, assigneeIds: e.target.checked ? [...form.assigneeIds, u.id] : form.assigneeIds.filter((id) => id !== u.id) })} />
                  <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white shrink-0">{u.name[0]}</div>
                  <span className="text-sm text-white">{u.name}</span>
                </label>
              ))}
            </div>
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
