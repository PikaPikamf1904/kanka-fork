export const localAdminUrl: string;
export function assertDatabaseUrl(url: string | undefined): void;
export function assertServiceUrl(url: string | undefined): void;
export function assertBrowserUrl(url: string | undefined): void;
export function assertLocalKey(token: string | undefined, role: string, secret: string): void;
export function readLocalEnv(): Record<string, string>;
export function assertDisposableDatabase(url?: string): Promise<void>;
