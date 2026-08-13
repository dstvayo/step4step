import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PushService } from './push.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private pushService: PushService) {}

  @Post('subscribe')
  subscribe(
    @Req() req: any,
    @Body() body: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    return this.pushService.subscribe(req.user.id, body);
  }

  @Post('unsubscribe')
  unsubscribe(@Req() req: any) {
    return this.pushService.unsubscribe(req.user.id);
  }
}
