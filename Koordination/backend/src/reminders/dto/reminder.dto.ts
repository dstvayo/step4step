import { IsString, IsOptional, IsDateString, IsEnum, IsBoolean } from 'class-validator';

export enum ReminderType { TIME = 'TIME', EVENT = 'EVENT', TASK = 'TASK' }

export class CreateReminderDto {
  @IsOptional()
  @IsEnum(ReminderType)
  type?: ReminderType;

  @IsDateString()
  triggerAt: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  relatedEventId?: string;

  @IsOptional()
  @IsString()
  relatedTaskId?: string;
}
