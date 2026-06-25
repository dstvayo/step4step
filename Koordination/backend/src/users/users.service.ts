import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, phone: true, language: true, avatar: true },
    });
  }

  async findOne(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, phone: true, language: true, avatar: true },
    });
  }

  async updateProfile(id: string, data: { name?: string; phone?: string; language?: string; avatar?: string }) {
    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, phone: true, language: true, avatar: true },
    });
  }
}
