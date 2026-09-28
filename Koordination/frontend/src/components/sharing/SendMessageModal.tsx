'use client';

import { useState, useEffect } from 'react';
import { X, Send, Globe, MessageCircle, Mail } from 'lucide-react';
import { sharingApi, usersApi, groupsApi } from '@/lib/api';
import { useAppStore } from '@/store/appStore';

interface Props {
  eventId?: string;
  taskId?: string;
  subject?: string;
  onClose: () => void;
}

const REACTIONS = ['✅ Bestätigt', '🔄 In Bearbeitung', '❌ Abgelehnt', '⏰ Später', '❓ Rückfrage'];

export default function SendMessageModal({ eventId, taskId, subject: defaultSubject, onClose }: Props) {
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [form, setForm] = useState({
    subject: defaultSubject || '',
    body: '',
    messageType: taskId ? 'TASK' : 'EVENT',
    channel: 'IN_APP',
    language: 'de',
    translateTo: '',
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const addMessage = useAppStore((s) => s.addMessage);

  useEffect(() => { usersApi.getAll().then((r) => setUsers(r.data)); }, []);

  const handleSend = async () => {
    if (selectedRecipients.length === 0) return;
    setSending(true);
    try {
      const res = await sharingApi.send({
        recipientIds: selectedRecipients,
        ...form,
        eventId,
        taskId,
      });
      res.data.forEach((m: any) => addMessage(m));
      onClose();
    } finally { setSending(false); }
  };

  const buildPreview = () => {
    const names = users.filter((u) => selectedRecipients.includes(u.id)).map((u) => u.name);
    if (names.length === 0) return;
    const greetings: Record<string, string> = {
      TASK: 'du hast eine neue Aufgabe erhalten:',
      REMINDER: 'dies ist eine Erinnerung für dich:',
      REQUEST: 'wir bitten dich um Folgendes:',
      APPOINTMENT: 'du bist zu folgendem Termin eingeladen:',
      EVENT: 'du bist zu folgendem Event eingeladen:',
      INFO: 'hier eine wichtige Information für dich:',
    };
    const sample = `Hallo ${names[0]},\n\n${greetings[form.messageType] || ''}\n\n${form.body || form.subject}\n\nBitte bestätige:\n${REACTIONS.join('\n')}`;
    setPreview(sample);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-xl max-h-[95vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-900">
          <h2 className="font-semibold text-white">Nachricht senden</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-800 rounded-lg"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="label">Empfänger</label>
            <div className="space-y-1 max-h-36 overflow-y-auto border border-slate-700 rounded-lg p-2">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={selectedRecipients.includes(u.id)}
                    onChange={(e) => setSelectedRecipients(e.target.checked ? [...selectedRecipients, u.id] : selectedRecipients.filter((id) => id !== u.id))} />
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white shrink-0">{u.name[0]}</div>
                  <div>
                    <p className="text-sm text-white">{u.name}</p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </div>
                </label>
              ))}
            </div>
            {selectedRecipients.length > 0 && <p className="text-xs text-blue-400 mt-1">{selectedRecipients.length} Empfänger ausgewählt</p>}
          </div>

          <div>
            <label className="label">Betreff</label>
            <input className="input bg-slate-800 border-slate-700 text-white" placeholder="Betreff der Nachricht" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Nachrichtenart</label>
              <select className="input bg-slate-800 border-slate-700 text-white" value={form.messageType} onChange={(e) => setForm({ ...form, messageType: e.target.value })}>
                <option value="TASK">Aufgabe</option>
                <option value="EVENT">Termin</option>
                <option value="APPOINTMENT">Meeting</option>
                <option value="REMINDER">Erinnerung</option>
                <option value="REQUEST">Anfrage</option>
                <option value="INFO">Info</option>
              </select>
            </div>
            <div>
              <label className="label">Kanal</label>
              <select className="input bg-slate-800 border-slate-700 text-white" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option value="IN_APP">In-App</option>
                <option value="EMAIL">E-Mail</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
          </div>

          <div>
            <label className="label">Nachrichtentext</label>
            <textarea className="input bg-slate-800 border-slate-700 text-white h-24 resize-none" placeholder="Optionaler zusätzlicher Text..." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>

          <div>
            <label className="label flex items-center gap-1.5"><Globe size={14} /> Übersetzung (optional)</label>
            <select className="input bg-slate-800 border-slate-700 text-white" value={form.translateTo} onChange={(e) => setForm({ ...form, translateTo: e.target.value })}>
              <option value="">Keine Übersetzung</option>
              <option value="en">Englisch</option>
              <option value="fr">Französisch</option>
              <option value="es">Spanisch</option>
              <option value="ar">Arabisch</option>
              <option value="tr">Türkisch</option>
              <option value="ru">Russisch</option>
              <option value="zh">Chinesisch</option>
            </select>
          </div>

          <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
            <p className="text-xs font-medium text-slate-400 mb-2">Reaktionsmöglichkeiten (automatisch eingefügt):</p>
            <div className="flex flex-wrap gap-1.5">
              {REACTIONS.map((r) => <span key={r} className="text-xs px-2 py-1 bg-slate-700 rounded-md text-slate-300">{r}</span>)}
            </div>
          </div>

          <button type="button" onClick={buildPreview} className="btn-secondary w-full text-sm">
            Vorschau anzeigen
          </button>

          {preview && (
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
              <p className="text-xs font-medium text-slate-400 mb-2">Vorschau für {users.find((u) => selectedRecipients[0] === u.id)?.name || 'Empfänger'}:</p>
              <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans">{preview}</pre>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">Abbrechen</button>
            <button onClick={handleSend} disabled={sending || selectedRecipients.length === 0} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Send size={16} />
              {sending ? 'Senden...' : `Senden (${selectedRecipients.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
