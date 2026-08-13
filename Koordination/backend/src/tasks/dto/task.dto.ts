import { IsString, IsOptional, IsDateString, IsEnum, IsArray } from 'class-validator';

export enum Priority { LOW = 'LOW', MEDIUM = 'MEDIUM', HIGH = 'HIGH' }
export enum TaskStatus { OPEN = 'OPEN', IN_PROGRESS = 'IN_PROGRESS', DONE = 'DONE' }
export enum MessageType { REMINDER = 'REMINDER', TASK = 'TASK', REQUEST = 'REQUEST', APPOINTMENT = 'APPOINTMENT', EVENT = 'EVENT', INFO = 'INFO' }

export class CreateTaskDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsArray()
  assigneeIds?: string[];
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType;

  @IsOptional()
  @IsArray()
  assigneeIds?: string[];
}
