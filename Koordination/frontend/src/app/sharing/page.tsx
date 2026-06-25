'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { sharingApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Send, Inbox, Check, RefreshCw, X, Clock, Globe, ExternalLink } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { SharedMessage } from '@/types';
import SendMessageModal from '@/components/sharing/SendMessageModal';

const REACTIONS = ['✅ Bestätigt', '🔄 In Bearbeitung', '❌ Abgelehnt', '⏰ Später', '❓ Rückfrage'];

const messageTypeLabels: Record<string, string> = {
  TASK: 'Aufgabe', EVENT: 'Termin', APPOINTMENT: 'Meeting',
  REMINDER: 'Erinnerung', REQUEST: 'Anfrage', INFO: 'Info',
};

const channelIcons: Record<string, string> = { EMAIL: '📧', WHATSAPP: '💬', IN_APP: '🔔' };

export default function SharingPage() {
  const { user } = useAuthStore();
  const { messages, setMessages } = useAppStore();
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
  const [showSendModal, setShowSendModal] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<SharedMessage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [sent, received] = await Promise.all([sharingApi.getSent(), sharingApi.getReceived()]);
        const all = [...sent.data, ...received.data].filter((m: SharedMessage, i: number, arr: SharedMessage[]) => arr.findIndex((x) => x.id === m.id) === i);
        setMessages(all);
      } finally { setLoading(false); }
    };
    load();
  }, []);

  const inbox = messages.filter((m) => m.recipientId === user?.id);
  const sent = messages.filter((m) => m.senderId === user?.id);
  const current = tab === 'inbox' ? inbox : sent;

  const handleReact = async (messageId: string, reaction: string) => {
    await sharingApi.react(messageId, { reaction });
    const updated = await sharingApi.getOne(messageId);
    setMessages(messages.map((m) => m.id === messageId ? updated.data : m));
    if (selectedMessage?.id === messageId) setSelectedMessage(updated.data);
  };

  const handleTranslate = async (messageId: string, lang: string) => {
    const res = await sharingApi.translate(messageId, lang);
    setMessages(messages.map((m) => m.id === messageId ? { ...m, bodyTranslated: res.data.bodyTranslated } : m));
    if (selectedMessage?.id === messageId) setSelectedMessage({ ...selectedMessage, bodyTranslated: res.data.bodyTranslated });
  };

  const statusColors: Record<string, string> = {
    PENDING: 'text-slate-500', SENT: 'text-blue-400', DELIVERED: 'text-blue-400',
    READ: 'text-green-400', REACTED: 'text-purple-400',
  };

  return (
    <div className="flex h-full gap-4 -m-4 md:-m-6 p-4 md:p-6">
      <div className="w-80 shrink-0 flex flex-col bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <div className="p-3 border-b border-slate-800 flex items-center gap-2">
          <div className="flex bg-slate-800 rounded-lg p-0.5 flex-1">
            <button onClick={() => setTab('inbox')} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === 'inbox' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
              <Inbox size={12} className="inline mr-1" />Posteingang ({inbox.filter((m) => m.status !== 'REACTED').length})
            </button>
            <button onClick={() => setTab('sent')} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${tab === 'sent' ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
              <Send size={12} className="inline mr-1" />Gesendet ({sent.length})
            </button>
          </div>
          <button onClick={() => setShowSendModal(true)} className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg" title="Neue Nachricht">
            <Send size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center p-8"><RefreshCw size={20} className="animate-spin text-slate-500" /></div>
          ) : current.length === 0 ? (
            <div className="text-center p-8 text-slate-600 text-sm">Keine Nachrichten</div>
          ) : (
            current.map((message) => (
              <button
                key={message.id}
                onClick={() => setSelectedMessage(message)}
                className={`w-full text-left p-3 border-b border-slate-800 hover:bg-slate-800 transition-colors
                  ${selectedMessage?.id === message.id ? 'bg-slate-800' : ''}
                  ${tab === 'inbox' && message.status !== 'REACTED' && message.status !== 'READ' ? 'border-l-2 border-l-blue-500' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white shrink-0">
                    {(tab === 'inbox' ? message.sender?.name : message.recipient?.name)?.[0] || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-medium text-white truncate">
                        {tab === 'inbox' ? message.sender?.name : message.recipient?.name}
                      </p>
                      <span className="text-xs text-slate-600 shrink-0">
                        {format(parseISO(message.createdAt), 'd. MMM', { locale: de })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 truncate mt-0.5">{message.subject}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs text-slate-600">{channelIcons[message.channel]}</span>
                      <span className={`text-xs ${statusColors[message.status]}`}>{message.status === 'REACTED' ? '✓ Reaktion' : message.status === 'SENT' ? 'Gesendet' : message.status}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-slate-400">{messageTypeLabels[message.messageType]}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col">
        {selectedMessage ? (
          <>
            <div className="p-4 border-b border-slate-800 flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white">{selectedMessage.subject}</h3>
                <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                  <span>{channelIcons[selectedMessage.channel]}</span>
                  <span>Von: {selectedMessage.sender?.name} → {selectedMessage.recipient?.name}</span>
                  <span>·</span>
                  <span>{format(parseISO(selectedMessage.createdAt), "d. MMM 'um' HH:mm", { locale: de })}</span>
                </div>
              </div>
              {tab === 'sent' && (
                <div className="flex items-center gap-2">
                  <a href={`data:text/plain,${encodeURIComponent(selectedMessage.body)}`} download="nachricht.txt" className="text-xs text-blue-400 hover:text-blue-300">Exportieren</a>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selectedMessage.event && (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-sm">
                  <p className="font-medium text-blue-300">📅 {selectedMessage.event.title}</p>
                  <p className="text-xs text-blue-400 mt-0.5">{format(parseISO(selectedMessage.event.start), "d. MMMM 'um' HH:mm 'Uhr'", { locale: de })}</p>
                  {selectedMessage.event.location && <p className="text-xs text-blue-400">📍 {selectedMessage.event.location}</p>}
                </div>
              )}
              {selectedMessage.task && (
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 text-sm">
                  <p className="font-medium text-purple-300">✅ {selectedMessage.task.title}</p>
                  {selectedMessage.task.dueDate && <p className="text-xs text-purple-400 mt-0.5">Fällig: {format(parseISO(selectedMessage.task.dueDate), "d. MMMM yyyy", { locale: de })}</p>}
                </div>
              )}

              <div className="bg-slate-800 rounded-xl p-4">
                <pre className="text-sm text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">{selectedMessage.body}</pre>
              </div>

              {selectedMessage.bodyTranslated && (
                <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                  <p className="text-xs text-slate-500 mb-2 flex items-center gap-1"><Globe size={12} /> Übersetzung</p>
                  <pre className="text-sm text-slate-300 whitespace-pre-wrap font-sans">{selectedMessage.bodyTranslated}</pre>
                </div>
              )}

              {selectedMessage.reactions.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2">Reaktionen</p>
                  <div className="space-y-1.5">
                    {selectedMessage.reactions.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 bg-slate-800 rounded-lg px-3 py-2">
                        <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center text-xs text-white">{r.user.name[0]}</div>
                        <span className="text-sm text-white flex-1">{r.user.name}</span>
                        <span className="text-sm">{r.reaction}</span>
                        {r.note && <span className="text-xs text-slate-500 italic">"{r.note}"</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'inbox' && selectedMessage.recipientId === user?.id && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2">Deine Reaktion</p>
                  <div className="grid grid-cols-2 gap-2">
                    {REACTIONS.map((reaction) => {
                      const myReaction = selectedMessage.reactions.find((r) => r.userId === user?.id);
                      const active = myReaction?.reaction === reaction;
                      return (
                        <button
                          key={reaction}
                          onClick={() => handleReact(selectedMessage.id, reaction)}
                          className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-all
                            ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'}`}
                        >
                          {reaction}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {!selectedMessage.bodyTranslated && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2">Übersetzen</p>
                  <div className="flex flex-wrap gap-2">
                    {[['en', 'Englisch'], ['fr', 'Französisch'], ['es', 'Spanisch'], ['ar', 'Arabisch'], ['tr', 'Türkisch']].map(([code, label]) => (
                      <button key={code} onClick={() => handleTranslate(selectedMessage.id, code)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors flex items-center gap-1">
                        <Globe size={12} /> {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <Send size={40} className="text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500">Nachricht auswählen</p>
              <p className="text-xs text-slate-600 mt-1">oder neue Nachricht erstellen</p>
              <button onClick={() => setShowSendModal(true)} className="btn-primary mt-4 text-sm flex items-center gap-2 mx-auto">
                <Send size={14} /> Neue Nachricht
              </button>
            </div>
          </div>
        )}
      </div>

      {showSendModal && <SendMessageModal onClose={() => setShowSendModal(false)} />}
    </div>
  );
}
