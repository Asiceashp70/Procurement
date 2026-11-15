import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { ZodPipe } from '../common/validation';
import type { User } from '../db/types';
import { SearchService } from './search.service';

const searchSchema = z.object({
  q: z.string().max(200).optional(),
  scope: z.enum(['mine', 'company', 'all']).default('mine'),
  companyId: z.string().uuid().optional(),
  status: z.enum(['draft', 'pending', 'completed', 'declined', 'voided']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  creatorId: z.string().uuid().optional(),
  signerId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  docType: z.string().max(100).optional(),
  tag: z.string().max(50).optional(),
  overdue: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).max(500).optional(),
});

@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('search')
  find(@CurrentUser() user: User, @Query(new ZodPipe(searchSchema)) q: z.infer<typeof searchSchema>) {
    return this.search.search(user, q);
  }

  @Get('search/facets')
  facets(@CurrentUser() user: User, @Query(new ZodPipe(searchSchema.pick({ scope: true, companyId: true }))) q: { scope: 'mine' | 'company' | 'all'; companyId?: string }) {
    return this.search.facets(user, q);
  }

  @Get('documents/:id/pages/:pageNo/highlights')
  highlights(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageNo', ParseIntPipe) pageNo: number,
    @Query('q') q: string | undefined,
    @Meta() meta: RequestMeta,
  ) {
    return this.search.highlights(user, id, pageNo, (q ?? '').slice(0, 200), meta);
  }
}
