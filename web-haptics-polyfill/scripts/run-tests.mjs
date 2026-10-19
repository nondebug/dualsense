// Test build & runner script using esbuild and Node.js native test runner
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  console.log('Compiling test suite with esbuild...');
  await build({
    entryPoints: [
      'tests/dualsense.test.ts',
      'tests/polyfill.test.ts',
      'tests/pointer.test.ts',
      'tests/audio.test.ts'
    ],
    bundle: true,
    packages: 'external',
    outdir: 'dist-tests',
    format: 'esm',
    target: 'node20',
    platform: 'node',
    sourcemap: 'inline'
  });

  console.log('Executing test suite via node --test...');
  const testFiles = readdirSync('dist-tests')
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => join('dist-tests', f));

  const child = spawn(process.execPath, ['--test', ...testFiles], {
    stdio: 'inherit'
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
