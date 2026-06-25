import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GroupsService } from './groups.service';
import { CreateGroupDto, UpdateGroupDto, AddMemberDto } from './dto/group.dto';

@ApiTags('groups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private groups: GroupsService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateGroupDto) {
    return this.groups.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req: any) {
    return this.groups.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.groups.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(id, req.user.id, dto);
  }

  @Post(':id/members')
  addMember(@Request() req: any, @Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.groups.addMember(id, req.user.id, dto);
  }

  @Delete(':id/members/:memberId')
  removeMember(@Request() req: any, @Param('id') id: string, @Param('memberId') memberId: string) {
    return this.groups.removeMember(id, req.user.id, memberId);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.groups.remove(id, req.user.id);
  }
}
