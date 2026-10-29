import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';

const TIMEOUT_MS = 10_000;

// Kirim pesan lewat Telegram Bot API. Token dan chat id hanya dari env,
// tidak pernah di-log.
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor(
    configService: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    this.botToken = configService.get<string>('telegram.botToken') ?? '';
    this.chatId = configService.get<string>('telegram.chatId') ?? '';
  }

  get isEnabled(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  onModuleInit(): void {
    if (!this.isEnabled) {
      this.logger.warn('telegram.disabled', {
        reason: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID kosong',
      });
    }
  }

  // true kalau terkirim.
  async send(text: string): Promise<boolean> {
    if (!this.isEnabled) return false;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            disable_web_page_preview: true,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        this.logger.warn('telegram.send_failed', { status: response.status });
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn('telegram.send_failed', {
        error: (error as Error).message,
      });
      return false;
    }
  }
}
