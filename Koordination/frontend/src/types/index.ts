export interface User {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  phone?: string;
  language: string;
  avatar?: string;
}

export interface Event {
  id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  notes?: string;
  category?: string;
  categoryColor?: string;
  recurrenceRule?: string;
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  messageType: MessageType;
  reminderMinutes?: number;
  ownerId: string;
  owner: { id: string; name: string };
  participants: Array<{ userId: string; user: User; status: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE';
  statusUpdatedAt?: string;
  messageType: MessageType;
  ownerId: string;
  owner: { id: string; name: string };
  parentId?: string;
  subtasks?: Task[];
  assignees: Array<{ userId: string; user: User; assignedAt: string; receivedAt?: string }>;
  eventId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Reminder {
  id: string;
  type: 'TIME' | 'EVENT' | 'TASK';
  triggerAt: string;
  message?: string;
  sent: boolean;
  escalated: boolean;
  escalationCount: number;
  relatedEventId?: string;
  relatedTaskId?: string;
  userId: string;
  event?: { id: string; title: string; start: string };
  task?: { id: string; title: string; dueDate?: string };
}

export interface SharedMessage {
  id: string;
  senderId: string;
  recipientId: string;
  subject: string;
  body: string;
  bodyTranslated?: string;
  language: string;
  messageType: MessageType;
  channel: 'EMAIL' | 'WHATSAPP' | 'IN_APP';
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'REACTED';
  sentAt?: string;
  sender?: { id: string; name: string; avatar?: string };
  recipient?: { id: string; name: string; email: string; avatar?: string };
  reactions: Array<{ id: string; reaction: string; note?: string; user: { id: string; name: string }; createdAt: string }>;
  event?: { id: string; title: string; start: string; location?: string };
  task?: { id: string; title: string; dueDate?: string; priority: string; status: string };
  createdAt: string;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  owner: { id: string; name: string; email: string };
  members: Array<{ id: string; userId: string; role: string; user: User }>;
}

export type MessageType = 'REMINDER' | 'TASK' | 'REQUEST' | 'APPOINTMENT' | 'EVENT' | 'INFO';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
