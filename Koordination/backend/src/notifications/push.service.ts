import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';

@Injectable()
export class PushService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    webpush.setVapidDetails(
      this.config.get('VAPID_SUBJECT') || 'mailto:admin@koordination.app',
      this.config.get('VAPID_PUBLIC_KEY') || '',
      this.config.get('VAPID_PRIVATE_KEY') || '',
    );
  }

  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    return this.prisma.pushSubscription.upsert({
      where: { userId_endpoint: { userId, endpoint: sub.endpoint } },
      update: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  async unsubscribe(userId: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId } });
  }

  async sendToUser(userId: string, payload: {
    title: string;
    body: string;
    tag?: string;
    url?: string;
    messageId?: string;
    requireInteraction?: boolean;
    actions?: { action: string; title: string }[];
  }) {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        ),
      ),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        const code = (r.reason as any)?.statusCode;
        if (code === 404 || code === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: subs[i].id } }).catch(() => {});
        }
      }
    }
  }
}
