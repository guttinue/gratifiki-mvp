// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./syntheticPipeline.ts', import.meta.url));

describe('synthetic-only offline CLI', () => {
  it('runs the built-in fixture and emits an explicitly synthetic reference of 11', () => {
    const run = spawnSync(process.execPath, ['--experimental-strip-types', script], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    const output = JSON.parse(run.stdout);
    expect(output.synthetic).toBe(true);
    expect(output.asOfMonth).toBe('2026-10');
    expect(output.candidateHistoricalMedian).toBe('11');
    expect(output.prepared.accepted.map((entry: { value: string }) => entry.value)).toEqual(['10', '12', '11']);
    expect(output.prepared.excluded.map((entry: { reason: string }) => entry.reason)).toEqual(['not_before_cutoff', 'ausente']);
  });

  it('rejects file arguments without consuming input', () => {
    const run = spawnSync(process.execPath, ['--experimental-strip-types', script, '--file', 'institutional.xlsx'], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('synthetic_fixture_only');
  });
});
