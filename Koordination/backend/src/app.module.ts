import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma/prisma.service';
import { AuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { TasksModule } from './tasks/tasks.module';
import { RemindersModule } from './reminders/reminders.module';
import { GroupsModule } from './groups/groups.module';
import { SharingModule } from './sharing/sharing.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    EventsModule,
    TasksModule,
    RemindersModule,
    GroupsModule,
    SharingModule,
    NotificationsModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
