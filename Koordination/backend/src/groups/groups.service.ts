import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto, UpdateGroupDto, AddMemberDto } from './dto/group.dto';

const groupInclude = {
  owner: { select: { id: true, name: true, email: true } },
  members: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
};

@Injectable()
export class GroupsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateGroupDto) {
    const { memberIds, ...data } = dto;
    return this.prisma.group.create({
      data: {
        ...data,
        ownerId: userId,
        members: {
          create: [
            { userId, role: 'owner' },
            ...(memberIds || []).map((id) => ({ userId: id, role: 'member' })),
          ],
        },
      },
      include: groupInclude,
    });
  }

  async findAll(userId: string) {
    return this.prisma.group.findMany({
      where: { members: { some: { userId } } },
      include: groupInclude,
    });
  }

  async findOne(id: string, userId: string) {
    const group = await this.prisma.group.findFirst({
      where: { id, members: { some: { userId } } },
      include: groupInclude,
    });
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async update(id: string, userId: string, dto: UpdateGroupDto) {
    const group = await this.prisma.group.findFirst({ where: { id, ownerId: userId } });
    if (!group) throw new ForbiddenException('Not authorized');
    return this.prisma.group.update({ where: { id }, data: dto, include: groupInclude });
  }

  async addMember(id: string, userId: string, dto: AddMemberDto) {
    await this.prisma.group.findFirstOrThrow({ where: { id, ownerId: userId } });
    return this.prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: id, userId: dto.userId } },
      create: { groupId: id, userId: dto.userId, role: dto.role || 'member' },
      update: { role: dto.role || 'member' },
    });
  }

  async removeMember(id: string, ownerId: string, memberId: string) {
    await this.prisma.group.findFirstOrThrow({ where: { id, ownerId } });
    await this.prisma.groupMember.delete({ where: { groupId_userId: { groupId: id, userId: memberId } } });
    return { message: 'Member removed' };
  }

  async remove(id: string, userId: string) {
    await this.prisma.group.findFirstOrThrow({ where: { id, ownerId: userId } });
    await this.prisma.group.delete({ where: { id } });
    return { message: 'Group deleted' };
  }
}
