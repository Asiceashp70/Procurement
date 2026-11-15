import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Schema<T> = ZodType<T, ZodTypeDef, any>;

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: Schema<T>) {}
  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'ข้อมูลไม่ถูกต้อง',
        errors: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

export const zbody = <T>(schema: Schema<T>) => new ZodPipe(schema);
