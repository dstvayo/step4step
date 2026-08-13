import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { CreateMessageDto, ReactToMessageDto } from './dto/sharing.dto';

@Injectable()
export class SharingService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsGateway,
  ) {}

  private buildPersonalizedBody(recipientName: string, subject: string, body: string, messageType: string): string {
    const greetings: Record<string, string> = {
      TASK: `Hallo ${recipientName},\n\ndu hast eine neue Aufgabe erhalten:`,
      REMINDER: `Hallo ${recipientName},\n\ndies ist eine Erinnerung für dich:`,
      REQUEST: `Hallo ${recipientName},\n\nwir bitten dich um Folgendes:`,
      APPOINTMENT: `Hallo ${recipientName},\n\ndu bist zu folgendem Termin eingeladen:`,
      EVENT: `Hallo ${recipientName},\n\ndu bist zu folgendem Event eingeladen:`,
      INFO: `Hallo ${recipientName},\n\nhier eine wichtige Information für dich:`,
    };
    const greeting = greetings[messageType] || `Hallo ${recipientName},`;
    return `${greeting}\n\n${body}\n\nBitte bestätige mit einer der folgenden Optionen:\n✅ Bestätigt\n🔄 In Bearbeitung\n❌ Abgelehnt`;
  }

  async createAndSend(senderId: string, dto: CreateMessageDto) {
    const sender = await this.prisma.user.findUnique({ where: { id: senderId }, select: { name: true } });
    const messages = [];

    for (const recipientId of dto.recipientIds) {
      const recipient = await this.prisma.user.findUnique({
        where: { id: recipientId },
        select: { id: true, name: true, email: true, phone: true },
      });
      if (!recipient) continue;

      const personalizedBody = this.buildPersonalizedBody(
        recipient.name,
        dto.subject,
        dto.body || dto.subject,
        dto.messageType || 'INFO',
      );

      const message = await this.prisma.sharedMessage.create({
        data: {
          senderId,
          recipientId,
          subject: dto.subject,
          body: personalizedBody,
          language: dto.language || 'de',
          messageType: dto.messageType || 'INFO',
          channel: dto.channel || 'IN_APP',
          eventId: dto.eventId,
          taskId: dto.taskId,
          status: 'SENT',
          sentAt: new Date(),
        },
        include: {
          sender: { select: { id: true, name: true } },
          recipient: { select: { id: true, name: true, email: true } },
          event: { select: { id: true, title: true, start: true } },
          task: { select: { id: true, title: true, dueDate: true } },
          reactions: true,
        },
      });

      await this.notifications.sendMessage(recipientId, {
        messageId: message.id,
        subject: message.subject,
        body: message.body,
        senderName: sender?.name || 'Admin',
        messageType: message.messageType,
        channel: message.channel,
      });

      messages.push(message);
    }

    return messages;
  }

  async findSent(userId: string) {
    return this.prisma.sharedMessage.findMany({
      where: { senderId: userId },
      include: {
        recipient: { select: { id: true, name: true, email: true, avatar: true } },
        reactions: { include: { user: { select: { id: true, name: true } } } },
        event: { select: { id: true, title: true } },
        task: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findReceived(userId: string) {
    return this.prisma.sharedMessage.findMany({
      where: { recipientId: userId },
      include: {
        sender: { select: { id: true, name: true, avatar: true } },
        reactions: { include: { user: { select: { id: true, name: true } } } },
        event: { select: { id: true, title: true, start: true } },
        task: { select: { id: true, title: true, dueDate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string) {
    const message = await this.prisma.sharedMessage.findFirst({
      where: { id, OR: [{ senderId: userId }, { recipientId: userId }] },
      include: {
        sender: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true, email: true } },
        reactions: { include: { user: { select: { id: true, name: true } } } },
        event: { select: { id: true, title: true, start: true, location: true } },
        task: { select: { id: true, title: true, dueDate: true, priority: true, status: true } },
      },
    });
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }

  async react(messageId: string, userId: string, dto: ReactToMessageDto) {
    const message = await this.prisma.sharedMessage.findFirst({ where: { id: messageId, recipientId: userId } });
    if (!message) throw new ForbiddenException('Not authorized to react to this message');

    const reaction = await this.prisma.messageReaction.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: { messageId, userId, reaction: dto.reaction, note: dto.note },
      update: { reaction: dto.reaction, note: dto.note },
    });

    await this.prisma.sharedMessage.update({ where: { id: messageId }, data: { status: 'REACTED' } });

    await this.notifications.sendReaction(message.senderId, {
      messageId,
      userId,
      reaction: dto.reaction,
      note: dto.note,
    });

    return reaction;
  }

  async translate(messageId: string, userId: string, targetLanguage: string) {
    const message = await this.prisma.sharedMessage.findFirst({
      where: { id: messageId, OR: [{ senderId: userId }, { recipientId: userId }] },
    });
    if (!message) throw new NotFoundException('Message not found');

    const translated = `[Übersetzung nach ${targetLanguage}]\n${message.body}`;

    return this.prisma.sharedMessage.update({
      where: { id: messageId },
      data: { bodyTranslated: translated },
    });
  }

  async generateWhatsAppLink(messageId: string, userId: string) {
    const message = await this.findOne(messageId, userId);
    const text = encodeURIComponent(`${message.subject}\n\n${message.body}`);
    const phone = (message.recipient as any)?.phone || '';
    return { link: `https://wa.me/${phone}?text=${text}` };
  }
}
