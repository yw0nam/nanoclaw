/**
 * NanoClaw Structural Architecture Tests
 *
 * Enforces architectural invariants:
 *   T4 — No direct console.log usage (Pino logger required)
 *   T3 — File LOC limits
 *   T1 — Channel self-registration pattern
 *   T2 — skill-as-branch whitelist (no unauthorised files in src/)
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globSync } from 'tinyglobby';

const SRC_DIR = join(import.meta.dirname, '..');
const CHANNELS_DIR = join(SRC_DIR, 'channels');

// ---------------------------------------------------------------------------
// T4 — TestCodeConventions: No console.* usage outside test / declaration files
// ---------------------------------------------------------------------------

describe('TestCodeConventions', () => {
  const CONSOLE_PATTERN = /^\s*console\.(log|warn|error|debug|info)\s*\(/m;

  // Known debt: files that already violate the rule and need a fix-up PR.
  // DO NOT add new files here without a corresponding debt ticket.
  const KNOWN_CONSOLE_FILES = new Set<string>([
    'container-runtime.ts', // uses console.error for capability detection errors
  ]);

  it('T4: no console.* calls in production source files', () => {
    const files = globSync(['**/*.ts'], {
      cwd: SRC_DIR,
      ignore: ['**/*.test.ts', '**/*.d.ts'],
    });

    const violators = files.filter((relPath) => {
      if (
        KNOWN_CONSOLE_FILES.has(relPath) ||
        KNOWN_CONSOLE_FILES.has(relPath.split('/').pop()!)
      ) {
        return false; // known debt — skip
      }
      const src = readFileSync(join(SRC_DIR, relPath), 'utf8');
      return CONSOLE_PATTERN.test(src);
    });

    expect(violators).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T3 — TestFileSizeLimits: Files must not exceed LOC limits
// ---------------------------------------------------------------------------

describe('TestFileSizeLimits', () => {
  const DEFAULT_LOC_LIMIT = 400;

  // Per-file overrides (relative path from src/)
  const FILE_SIZE_LIMITS: Record<string, number> = {
    'index.ts': 800, // orchestrator — currently 719 lines
  };

  // Known debt: files that already exceed the limit.
  // Each entry should have an associated refactor task.
  const KNOWN_LARGE_FILES = new Set<string>([
    'container-runner.ts', // 736 lines — needs splitting
    'db.ts', // 719 lines — needs splitting
    'ipc.ts', // 464 lines — needs splitting
    'mount-security.ts', // 419 lines — needs splitting
  ]);

  it('T3: no file exceeds its LOC limit', () => {
    const files = globSync(['**/*.ts'], {
      cwd: SRC_DIR,
      ignore: ['**/*.test.ts', '**/*.d.ts'],
    });

    const violators: Array<{ file: string; lines: number; limit: number }> = [];

    for (const relPath of files) {
      const fileName = relPath.split('/').pop()!;
      if (KNOWN_LARGE_FILES.has(fileName) || KNOWN_LARGE_FILES.has(relPath)) {
        continue; // known debt
      }

      const limit =
        FILE_SIZE_LIMITS[fileName] ??
        FILE_SIZE_LIMITS[relPath] ??
        DEFAULT_LOC_LIMIT;
      const src = readFileSync(join(SRC_DIR, relPath), 'utf8');
      const lineCount = src.split('\n').length;

      if (lineCount > limit) {
        violators.push({ file: relPath, lines: lineCount, limit });
      }
    }

    expect(violators).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T1 — TestChannelSelfRegistration: Channel files must self-register
// ---------------------------------------------------------------------------

describe('TestChannelSelfRegistration', () => {
  it('T1-1: every channel file calls registerChannel()', () => {
    const files = readdirSync(CHANNELS_DIR).filter(
      (f) =>
        f.endsWith('.ts') &&
        !['registry.ts', 'index.ts'].includes(f) &&
        !f.endsWith('.test.ts'),
    );

    const violators = files.filter(
      (f) =>
        !readFileSync(join(CHANNELS_DIR, f), 'utf8').includes(
          'registerChannel(',
        ),
    );

    expect(violators).toEqual([]);
  });

  it('T1-2: channels/index.ts imports every channel file', () => {
    const channelFiles = readdirSync(CHANNELS_DIR).filter(
      (f) =>
        f.endsWith('.ts') &&
        !['registry.ts', 'index.ts'].includes(f) &&
        !f.endsWith('.test.ts'),
    );

    const indexSrc = readFileSync(join(CHANNELS_DIR, 'index.ts'), 'utf8');

    const missing = channelFiles.filter((f) => {
      const stem = f.replace('.ts', '');
      return (
        !indexSrc.includes(`'./${stem}.js'`) &&
        !indexSrc.includes(`'./${stem}'`)
      );
    });

    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T2 — TestSkillAsBranchEnforcement: No unauthorised files in src/
// ---------------------------------------------------------------------------

describe('TestSkillAsBranchEnforcement', () => {
  // Canonical list of approved source files.
  // To add a legitimate new file, update this set in the same PR — reviewers
  // will see the whitelist change and can verify intent.
  const KNOWN_SRC_FILES = new Set([
    // channels/
    'channels/http.ts',
    'channels/http.test.ts',
    'channels/index.ts',
    'channels/registry.ts',
    'channels/registry.test.ts',
    // root src/
    'claw-skill.test.ts',
    'config.ts',
    'container-runner.ts',
    'container-runner.test.ts',
    'container-runtime.ts',
    'container-runtime.test.ts',
    'db.ts',
    'db.test.ts',
    'db-migration.test.ts',
    'env.ts',
    'formatting.test.ts',
    'group-folder.ts',
    'group-folder.test.ts',
    'group-queue.ts',
    'group-queue.test.ts',
    'index.ts',
    'ipc.ts',
    'ipc-auth.test.ts',
    'logger.ts',
    'mount-security.ts',
    'remote-control.ts',
    'remote-control.test.ts',
    'router.ts',
    'routing.test.ts',
    'sender-allowlist.ts',
    'sender-allowlist.test.ts',
    'task-scheduler.ts',
    'task-scheduler.test.ts',
    'timezone.ts',
    'timezone.test.ts',
    'types.ts',
    // structural (this file)
    'structural/architecture.test.ts',
  ]);

  it('T2: no unregistered files exist in src/', () => {
    const allFiles = globSync(['**/*.ts'], {
      cwd: SRC_DIR,
      ignore: ['**/*.d.ts'],
    });

    const unknown = allFiles.filter((relPath) => !KNOWN_SRC_FILES.has(relPath));

    expect(unknown).toEqual([]);
  });
});
