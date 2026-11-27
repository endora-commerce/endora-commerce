export declare class AcmeLinksOrganizationRef {
  organizationId: string;
  externalRef: string;
}
export declare class AcmeLinksOrderNote {
  orderId: string;
  note: string;
}
export declare const entities: readonly [typeof AcmeLinksOrganizationRef, typeof AcmeLinksOrderNote];
export declare const AcmeLinksOrganizationRefSchema: import('zod').ZodType<{ externalRef: string }>;
export declare function registerModule(ctx: import('@endora-commerce/platform/kernel').ModuleContext): void;
