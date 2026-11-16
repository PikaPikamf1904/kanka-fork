import { assertDatabaseUrl, assertDisposableDatabase, localAdminUrl, readLocalEnv } from '../../scripts/local-targets.mjs';

const url = process.env.CHRONICLE_TEST_DB_URL ?? localAdminUrl;
assertDatabaseUrl(url);
readLocalEnv();
await assertDisposableDatabase(url);
