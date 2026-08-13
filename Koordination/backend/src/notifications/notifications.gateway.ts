import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true },
  namespace: '/ws',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSockets = new Map<string, Set<string>>();

  constructor(private jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.split(' ')[1];
      const payload = this.jwt.verify(token);
      const userId = payload.sub;
      client.data.userId = userId;
      client.join(`user:${userId}`);
      if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
      this.userSockets.get(userId)!.add(client.id);
      console.log(`User ${userId} connected (${client.id})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId) {
      this.userSockets.get(userId)?.delete(client.id);
      console.log(`User ${userId} disconnected`);
    }
  }

  @SubscribeMessage('join-group')
  handleJoinGroup(@ConnectedSocket() client: Socket, @MessageBody() groupId: string) {
    client.join(`group:${groupId}`);
  }

  @SubscribeMessage('leave-group')
  handleLeaveGroup(@ConnectedSocket() client: Socket, @MessageBody() groupId: string) {
    client.leave(`group:${groupId}`);
  }

  async sendReminder(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('reminder', data);
  }

  async sendMessage(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('new-message', data);
  }

  async sendReaction(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('message-reaction', data);
  }

  async broadcastEventUpdate(userIds: string[], event: any) {
    for (const uid of userIds) {
      this.server.to(`user:${uid}`).emit('event-updated', event);
    }
  }

  async broadcastTaskUpdate(userIds: string[], task: any) {
    for (const uid of userIds) {
      this.server.to(`user:${uid}`).emit('task-updated', task);
    }
  }

  isOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.size || 0) > 0;
  }
}
