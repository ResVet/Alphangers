// npm test: the fast suites that need no browser and no emulator.
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = ['schedule-model.test.mjs', 'validate.test.mjs', 'content.test.mjs', 'v5.test.mjs'].map((f) => join(here, f));
const stream = run({ files });
stream.on('test:fail', () => { process.exitCode = 1; });
stream.compose(spec).pipe(process.stdout);
