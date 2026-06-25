import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EventsService } from './events.service';
import { CreateEventDto, UpdateEventDto } from './dto/event.dto';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('events')
export class EventsController {
  constructor(private events: EventsService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateEventDto) {
    return this.events.create(req.user.id, dto);
  }

  @Get()
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  findAll(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    return this.events.findAll(req.user.id, from, to);
  }

  @Get('conflicts')
  @ApiQuery({ name: 'start', required: true })
  @ApiQuery({ name: 'end', required: true })
  @ApiQuery({ name: 'excludeId', required: false })
  checkConflicts(
    @Request() req: any,
    @Query('start') start: string,
    @Query('end') end: string,
    @Query('excludeId') excludeId?: string,
  ) {
    return this.events.checkConflicts(req.user.id, start, end, excludeId);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.events.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(id, req.user.id, dto);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.events.remove(id, req.user.id);
  }
}
