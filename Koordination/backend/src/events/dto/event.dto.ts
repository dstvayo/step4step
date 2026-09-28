import { IsString, IsOptional, IsDateString, IsEnum, IsArray, IsNumber } from 'class-validator';

export enum Urgency { LOW = 'LOW', NORMAL = 'NORMAL', HIGH = 'HIGH', CRITICAL = 'CRITICAL' }
export enum MessageType { REMINDER = 'REMINDER', TASK = 'TASK', REQUEST = 'REQUEST', APPOINTMENT = 'APPOINTMENT', EVENT = 'EVENT', INFO = 'INFO' }

export class CreateEventDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  start: string;

  @IsDateString()
  end: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  categoryColor?: string;

  @IsOptional()
  @IsString()
  recurrenceRule?: string;

  @IsOptional()
  @IsEnum(Urgency)
  urgency?: Urgency;

  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType;

  @IsOptional()
  @IsNumber()
  reminderMinutes?: number;

  @IsOptional()
  @IsArray()
  participantIds?: string[];
}

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  start?: string;

  @IsOptional()
  @IsDateString()
  end?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  categoryColor?: string;

  @IsOptional()
  @IsString()
  recurrenceRule?: string;

  @IsOptional()
  @IsEnum(Urgency)
  urgency?: Urgency;

  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType;

  @IsOptional()
  @IsNumber()
  reminderMinutes?: number;

  @IsOptional()
  @IsArray()
  participantIds?: string[];
}
