export declare const LIMITS: {
  readonly balanceFloor: number;
  readonly balanceShare: number;
  readonly hollow: number;
  readonly cardHollow: number;
  readonly button: number;
  readonly topBar: number;
};
export declare function auditLayout(limits: typeof LIMITS): string[];
