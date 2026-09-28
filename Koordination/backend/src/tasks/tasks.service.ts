import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskDto, TaskStatus } from './dto/task.dto';

const taskInclude = {
  owner: { select: { id: true, name: true } },
  assignees: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
  subtasks: {
    include: {
      assignees: { include: { user: { select: { id: true, name: true } } } },
    },
  },
};

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateTaskDto) {
    const { assigneeIds, ...data } = dto;
    return this.prisma.task.create({
      data: {
        ...data,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        ownerId: userId,
        assignees: assigneeIds
          ? { create: assigneeIds.map((id) => ({ userId: id, receivedAt: new Date() })) }
          : undefined,
      },
      include: taskInclude,
    });
  }

  async findAll(userId: string, status?: string) {
    const where: any = {
      OR: [{ ownerId: userId }, { assignees: { some: { userId } } }],
      parentId: null,
    };
    if (status) where.status = status;
    return this.prisma.task.findMany({ where, include: taskInclude, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string, userId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, OR: [{ ownerId: userId }, { assignees: { some: { userId } } }] },
      include: taskInclude,
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async update(id: string, userId: string, dto: UpdateTaskDto) {
    const task = await this.prisma.task.findFirst({ where: { id, ownerId: userId } });
    if (!task) throw new ForbiddenException('Not authorized to update this task');

    const { assigneeIds, ...data } = dto;
    const updateData: any = { ...data };
    if (dto.dueDate) updateData.dueDate = new Date(dto.dueDate);
    if (dto.status) updateData.statusUpdatedAt = new Date();
    if (assigneeIds !== undefined) {
      await this.prisma.taskAssignee.deleteMany({ where: { taskId: id } });
      updateData.assignees = { create: assigneeIds.map((uid) => ({ userId: uid, receivedAt: new Date() })) };
    }

    return this.prisma.task.update({ where: { id }, data: updateData, include: taskInclude });
  }

  async updateStatus(id: string, userId: string, status: TaskStatus) {
    const task = await this.prisma.task.findFirst({
      where: { id, OR: [{ ownerId: userId }, { assignees: { some: { userId } } }] },
    });
    if (!task) throw new NotFoundException('Task not found');

    return this.prisma.task.update({
      where: { id },
      data: { status, statusUpdatedAt: new Date() },
      include: taskInclude,
    });
  }

  async remove(id: string, userId: string) {
    const task = await this.prisma.task.findFirst({ where: { id, ownerId: userId } });
    if (!task) throw new ForbiddenException('Not authorized to delete this task');
    await this.prisma.task.delete({ where: { id } });
    return { message: 'Task deleted' };
  }
}
