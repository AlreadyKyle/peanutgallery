import type { Locator } from '@playwright/test';

export interface RunningRoleRow {
  name: string;
  facts: string;
}
export declare const RUNNING_MODEL: 'claude-opus-5-5';
export declare const DESIGNER_ROLE: 'Game Designer';
export declare const DESIGNER_MODEL: 'claude-sonnet-5-5';
export declare function runningModelsCheck(rows: readonly RunningRoleRow[]): { ok: boolean; message: string };
export declare function runningRoleRows(running: Locator): Promise<RunningRoleRow[]>;
