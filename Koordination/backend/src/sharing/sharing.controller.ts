import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SharingService } from './sharing.service';
import { CreateMessageDto, ReactToMessageDto } from './dto/sharing.dto';

@ApiTags('sharing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sharing')
export class SharingController {
  constructor(private sharing: SharingService) {}

  @Post('send')
  send(@Request() req: any, @Body() dto: CreateMessageDto) {
    return this.sharing.createAndSend(req.user.id, dto);
  }

  @Get('sent')
  getSent(@Request() req: any) {
    return this.sharing.findSent(req.user.id);
  }

  @Get('received')
  getReceived(@Request() req: any) {
    return this.sharing.findReceived(req.user.id);
  }

  @Get(':id')
  getOne(@Request() req: any, @Param('id') id: string) {
    return this.sharing.findOne(id, req.user.id);
  }

  @Post(':id/react')
  react(@Request() req: any, @Param('id') id: string, @Body() dto: ReactToMessageDto) {
    return this.sharing.react(id, req.user.id, dto);
  }

  @Post(':id/translate')
  translate(@Request() req: any, @Param('id') id: string, @Body('language') language: string) {
    return this.sharing.translate(id, req.user.id, language);
  }

  @Get(':id/whatsapp')
  whatsapp(@Request() req: any, @Param('id') id: string) {
    return this.sharing.generateWhatsAppLink(id, req.user.id);
  }
}
