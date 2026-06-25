import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';

export enum Channel { EMAIL = 'EMAIL', WHATSAPP = 'WHATSAPP', IN_APP = 'IN_APP' }
export enum MessageType { REMINDER = 'REMINDER', TASK = 'TASK', REQUEST = 'REQUEST', APPOINTMENT = 'APPOINTMENT', EVENT = 'EVENT', INFO = 'INFO' }

export class CreateMessageDto {
  @IsArray()
  recipientIds: string[];

  @IsString()
  subject: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType;

  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  translateTo?: string;
}

export class ReactToMessageDto {
  @IsString()
  reaction: string;

  @IsOptional()
  @IsString()
  note?: string;
}
