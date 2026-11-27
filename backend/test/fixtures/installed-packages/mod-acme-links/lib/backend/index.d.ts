export declare class AcmeLinksOrganizationRef {
  organizationId: string;
  externalRef: string;
}
export declare class AcmeLinksOrderNote {
  orderId: string;
  note: string;
}
export declare const entities: readonly [typeof AcmeLinksOrganizationRef, typeof AcmeLinksOrderNote];
export declare function registerModule(): void;
