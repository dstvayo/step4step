import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { PushService } from '../notifications/push.service';
import { CreateReminderDto } from './dto/reminder.dto';

@Injectable()
export class RemindersService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsGateway,
    private push: PushService,
  ) {}

  async create(userId: string, dto: CreateReminderDto) {
    return this.prisma.reminder.create({
      data: {
        ...dto,
        triggerAt: new Date(dto.triggerAt),
        userId,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.reminder.findMany({
      where: { userId },
      include: {
        event: { select: { id: true, title: true, start: true } },
        task: { select: { id: true, title: true, dueDate: true } },
      },
      orderBy: { triggerAt: 'asc' },
    });
  }

  async findOne(id: string, userId: string) {
    return this.prisma.reminder.findFirst({ where: { id, userId } });
  }

  async update(id: string, userId: string, data: Partial<CreateReminderDto>) {
    await this.prisma.reminder.findFirstOrThrow({ where: { id, userId } });
    const updateData: any = { ...data };
    if (data.triggerAt) updateData.triggerAt = new Date(data.triggerAt);
    return this.prisma.reminder.update({ where: { id }, data: updateData });
  }

  async remove(id: string, userId: string) {
    await this.prisma.reminder.findFirstOrThrow({ where: { id, userId } });
    await this.prisma.reminder.delete({ where: { id } });
    return { message: 'Reminder deleted' };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueReminders() {
    const now = new Date();
    const dueReminders = await this.prisma.reminder.findMany({
      where: { sent: false, triggerAt: { lte: now } },
      include: { user: { select: { id: true, name: true } } },
    });

    for (const reminder of dueReminders) {
      const msg = reminder.message || 'Erinnerung';
      await this.notifications.sendReminder(reminder.userId, {
        id: reminder.id,
        message: msg,
        triggerAt: reminder.triggerAt,
        relatedEventId: reminder.relatedEventId,
        relatedTaskId: reminder.relatedTaskId,
      });
      await this.push.sendToUser(reminder.userId, {
        title: '⏰ Koordination',
        body: msg,
        tag: `reminder-${reminder.id}`,
        url: reminder.relatedEventId ? '/calendar' : reminder.relatedTaskId ? '/tasks' : '/reminders',
        requireInteraction: true,
      });
      await this.prisma.reminder.update({ where: { id: reminder.id }, data: { sent: true } });
    }
  }

  @Cron('*/15 * * * *')
  async escalateOverdueReminders() {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const overdue = await this.prisma.reminder.findMany({
      where: { sent: true, escalated: false, triggerAt: { lte: fifteenMinutesAgo }, escalationCount: { lt: 3 } },
    });
    for (const reminder of overdue) {
      const escalationMsg = `[Eskalation] ${reminder.message || 'Erinnerung nicht bestätigt'}`;
      await this.notifications.sendReminder(reminder.userId, {
        id: reminder.id,
        message: escalationMsg,
        triggerAt: reminder.triggerAt,
        relatedEventId: reminder.relatedEventId,
        relatedTaskId: reminder.relatedTaskId,
      });
      await this.push.sendToUser(reminder.userId, {
        title: '🚨 Koordination – Eskalation',
        body: escalationMsg,
        tag: `reminder-escalation-${reminder.id}`,
        url: '/reminders',
        requireInteraction: true,
      });
      await this.prisma.reminder.update({
        where: { id: reminder.id },
        data: { escalationCount: { increment: 1 }, escalated: reminder.escalationCount >= 2 },
      });
    }
  }
}
