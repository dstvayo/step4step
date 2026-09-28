import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [NotificationsModule, ConfigModule],
  controllers: [RemindersController],
  providers: [RemindersService, PrismaService],
  exports: [RemindersService],
})
export class RemindersModule {}
