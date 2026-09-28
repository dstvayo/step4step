import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket;

  socket = io(`${process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001'}/ws`, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
  });

  socket.on('connect', () => console.log('WebSocket connected'));
  socket.on('disconnect', (reason) => console.log('WebSocket disconnected:', reason));
  socket.on('connect_error', (err) => console.error('WebSocket error:', err.message));

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

export function joinGroup(groupId: string) {
  socket?.emit('join-group', groupId);
}

export function leaveGroup(groupId: string) {
  socket?.emit('leave-group', groupId);
}
