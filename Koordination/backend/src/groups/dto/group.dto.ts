import { IsString, IsOptional, IsArray } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  memberIds?: string[];
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AddMemberDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  role?: string;
}
