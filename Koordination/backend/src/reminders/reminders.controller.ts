import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RemindersService } from './reminders.service';
import { CreateReminderDto } from './dto/reminder.dto';

@ApiTags('reminders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reminders')
export class RemindersController {
  constructor(private reminders: RemindersService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateReminderDto) {
    return this.reminders.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: any) {
    return this.reminders.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.reminders.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() body: Partial<CreateReminderDto>) {
    return this.reminders.update(id, req.user.id, body);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.reminders.remove(id, req.user.id);
  }
}
