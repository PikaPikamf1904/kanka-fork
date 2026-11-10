# Test results

All on the local disposable stack with synthetic data, on this branch after the final commit's code
changes. Nothing ran against the hosted project.

| Command (from `chronicle-cloud/`) | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 77 passed, 0 failed |
| `npm run test:db` | 89 passed, 0 failed (8 files) |
| `bash scripts/e2e-local.sh` | 23 passed, 0 failed |
| `npm run lore:check` | pack valid: 26 pages, 21 connections |

Earlier in the run, the browser suite failed three times on mistakes in the new import test
(selectors), not in the app; fixed before the passing run.
