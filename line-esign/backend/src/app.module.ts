import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { CertificatesService } from './admin/certificates.service';
import { StampsController } from './companies/stamps.controller';
import { StampsService } from './companies/stamps.service';
import { DocumentAccessService } from './documents/document-access.service';
import { DocumentEventsService } from './documents/document-events';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { FinalizeService } from './documents/finalize.service';
import { SchedulerService } from './documents/scheduler.service';
import { SigningService } from './documents/signing.service';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';
import { TextService } from './search/text.service';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { LineLoginService } from './auth/line-login.service';
import { config } from './config/config';
import { OriginCheckMiddleware } from './common/origin.middleware';
import { StorageService } from './common/storage.service';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { CompanyAccessService } from './companies/company-access.service';
import { ImportsService } from './companies/imports.service';
import { DatabaseModule } from './db/database';
import { HealthController } from './health.controller';
import { JobsService } from './jobs/jobs.service';
import { LinePushService } from './notifications/line-push.service';
import { NotificationsService } from './notifications/notifications.service';
import { LineWebhookController } from './notifications/webhook.controller';
import { MeController } from './users/me.controller';
import { SignaturesService } from './users/signatures.service';
import { UsersService } from './users/users.service';

@Module({
  imports: [DatabaseModule, ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
      skipIf: () => config().NODE_ENV === 'test',
    })],
  controllers: [HealthController, AuthController, MeController, CompaniesController, StampsController, AdminController, DocumentsController, SearchController, LineWebhookController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    AuditService,
    StorageService,
    LineLoginService,
    UsersService,
    SignaturesService,
    CompanyAccessService,
    CompaniesService,
    ImportsService,
    AdminService,
    JobsService,
    LinePushService,
    NotificationsService,
    CertificatesService,
    StampsService,
    DocumentEventsService,
    DocumentAccessService,
    DocumentsService,
    SigningService,
    FinalizeService,
    SchedulerService,
    TextService,
    SearchService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(OriginCheckMiddleware).forRoutes('*path');
  }
}
