import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateEventDto) {
    const { participantIds, ...data } = dto;
    const event = await this.prisma.event.create({
      data: {
        ...data,
        start: new Date(dto.start),
        end: new Date(dto.end),
        ownerId: userId,
        participants: participantIds
          ? { create: participantIds.map((id) => ({ userId: id })) }
          : undefined,
      },
      include: { participants: { include: { user: { select: { id: true, name: true, email: true } } } }, owner: { select: { id: true, name: true } } },
    });
    return event;
  }

  async findAll(userId: string, from?: string, to?: string) {
    const where: any = {
      OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
    };
    if (from || to) {
      where.start = {};
      if (from) where.start.gte = new Date(from);
      if (to) where.start.lte = new Date(to);
    }
    return this.prisma.event.findMany({
      where,
      include: {
        participants: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
        owner: { select: { id: true, name: true } },
      },
      orderBy: { start: 'asc' },
    });
  }

  async findOne(id: string, userId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id, OR: [{ ownerId: userId }, { participants: { some: { userId } } }] },
      include: {
        participants: { include: { user: { select: { id: true, name: true, email: true } } } },
        owner: { select: { id: true, name: true } },
        reminders: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async update(id: string, userId: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findFirst({ where: { id, ownerId: userId } });
    if (!event) throw new ForbiddenException('Not authorized to update this event');

    const { participantIds, ...data } = dto;
    const updated: any = { ...data };
    if (dto.start) updated.start = new Date(dto.start);
    if (dto.end) updated.end = new Date(dto.end);

    if (participantIds !== undefined) {
      await this.prisma.eventParticipant.deleteMany({ where: { eventId: id } });
      updated.participants = { create: participantIds.map((uid) => ({ userId: uid })) };
    }

    return this.prisma.event.update({
      where: { id },
      data: updated,
      include: { participants: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
  }

  async remove(id: string, userId: string) {
    const event = await this.prisma.event.findFirst({ where: { id, ownerId: userId } });
    if (!event) throw new ForbiddenException('Not authorized to delete this event');
    await this.prisma.event.delete({ where: { id } });
    return { message: 'Event deleted' };
  }

  async checkConflicts(userId: string, start: string, end: string, excludeId?: string) {
    const conflicts = await this.prisma.event.findMany({
      where: {
        OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
        id: excludeId ? { not: excludeId } : undefined,
        AND: [{ start: { lt: new Date(end) } }, { end: { gt: new Date(start) } }],
      },
      select: { id: true, title: true, start: true, end: true },
    });
    return conflicts;
  }
}
