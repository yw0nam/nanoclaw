#!/usr/bin/env ts-node
/**
 * test_generate_indexes.ts
 * TDD tests for generate_indexes.ts
 *
 * Run: npx ts-node test_generate_indexes.ts
 *
 * Tests are run sequentially and results printed to stdout.
 * Exit code 0 = all pass, 1 = any fail.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const SCRIPT = path.join(__dirname, 'generate_indexes.ts');
const TEST_KB = '/tmp/kb-test-tdd';

// ─────────────────── helpers ───────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual: string, expected: string, message: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function assertContains(haystack: string, needle: string, message: string): void {
  if (haystack.includes(needle)) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    console.error(`    haystack: ${JSON.stringify(haystack.slice(0, 300))}`);
    console.error(`    needle:   ${JSON.stringify(needle)}`);
    failed++;
  }
}

function assertNotContains(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    console.error(`    should NOT contain: ${JSON.stringify(needle)}`);
    failed++;
  }
}

/** Reset test KB to a clean state */
function resetKB(): void {
  fs.rmSync(TEST_KB, { recursive: true, force: true });
  fs.mkdirSync(path.join(TEST_KB, '2026-03'), { recursive: true });
}

/** Write a file to the test KB */
function writeNote(relPath: string, content: string): void {
  const abs = path.join(TEST_KB, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

/** Run the generate_indexes.ts script and return { stdout, stderr, exitCode } */
function runScript(): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(
      `npx ts-node ${SCRIPT}`,
      {
        env: { ...process.env, KNOWLEDGE_BASE_PATH: TEST_KB },
        encoding: 'utf-8',
        cwd: path.dirname(SCRIPT),
      }
    );
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

function readKBFile(relPath: string): string {
  return fs.readFileSync(path.join(TEST_KB, relPath), 'utf-8');
}

function kbFileExists(relPath: string): boolean {
  return fs.existsSync(path.join(TEST_KB, relPath));
}

// ─────────────────── TEST SUITE ───────────────────

function testScanAndFrontmatterParsing(): void {
  console.log('\n── Task 1: Scan + frontmatter parsing ──');

  resetKB();
  writeNote('2026-03/20260312-test-note.md', [
    '---',
    'title: 테스트 노트',
    'created_at: 2026-03-12T10:00:00Z',
    'tags: [test, nanoclaw]',
    '---',
    '첫 번째 요약 라인입니다.',
  ].join('\n'));

  const { exitCode, stderr } = runScript();
  assert(exitCode === 0, 'basic valid note: exit code 0');
  assert(stderr === '', 'basic valid note: no stderr');
}

function testTagsScalarNormalization(): void {
  console.log('\n── Task 1b: tags scalar → array normalization ──');

  resetKB();
  writeNote('2026-03/20260312-scalar-tags.md', [
    '---',
    'title: Scalar Tags Note',
    'created_at: 2026-03-12T10:00:00Z',
    'tags: nanoclaw',
    '---',
    'Summary line here.',
  ].join('\n'));

  const { exitCode } = runScript();
  assert(exitCode === 0, 'scalar tags: exit code 0');

  const moc = readKBFile('moc/nanoclaw-MOC.md');
  assertContains(moc, '20260312-scalar-tags.md', 'scalar tags: note appears in nanoclaw MOC');
}

function testNoFrontmatterSkip(): void {
  console.log('\n── Task 1c: no frontmatter → skip with WARN, exit 1 ──');

  resetKB();
  // Good note first so we get at least one processed
  writeNote('2026-03/20260312-good.md', [
    '---',
    'title: Good Note',
    'created_at: 2026-03-12T10:00:00Z',
    'tags: [test]',
    '---',
    'Good summary.',
  ].join('\n'));
  // Bad note with no frontmatter
  writeNote('2026-03/20260312-bad.md', 'no frontmatter here\njust plain text');

  const { exitCode, stderr } = runScript();
  assert(exitCode === 1, 'no frontmatter: exit code 1');
  assertContains(stderr, 'WARN: skipping', 'no frontmatter: WARN in stderr');
  assertContains(stderr, '20260312-bad.md', 'no frontmatter: bad file named in WARN');
}

function testMissingTitleFallback(): void {
  console.log('\n── Task 1d: missing title → filename stem fallback ──');

  resetKB();
  writeNote('2026-03/20260312-no-title.md', [
    '---',
    'created_at: 2026-03-12T10:00:00Z',
    'tags: [test]',
    '---',
    'Summary here.',
  ].join('\n'));

  const { exitCode } = runScript();
  assert(exitCode === 0, 'missing title: exit code 0');

  const monthIndex = readKBFile('2026-03/INDEX.md');
  assertContains(monthIndex, '20260312-no-title', 'missing title: filename stem used in INDEX');
}

function testMissingCreatedAtFallback(): void {
  console.log('\n── Task 1e: missing created_at → mtime fallback + WARN ──');

  resetKB();
  writeNote('2026-03/20260312-no-date.md', [
    '---',
    'title: No Date Note',
    'tags: [test]',
    '---',
    'Summary here.',
  ].join('\n'));

  const { exitCode, stderr } = runScript();
  assert(exitCode === 1, 'missing created_at: exit code 1 (WARN)');
  assertContains(stderr, 'WARN', 'missing created_at: WARN in stderr');
  assertContains(stderr, 'created_at', 'missing created_at: mentions created_at');
}

function testIndexAndMocGeneration(): void {
  console.log('\n── Task 2: INDEX + MOC generation ──');

  resetKB();
  writeNote('2026-03/20260312-test-note.md', [
    '---',
    'title: 테스트 노트',
    'created_at: 2026-03-12T10:00:00Z',
    'tags: [test, nanoclaw]',
    '---',
    '첫 번째 요약 라인입니다.',
  ].join('\n'));

  const { exitCode } = runScript();
  assert(exitCode === 0, 'INDEX+MOC: exit code 0');

  // Top-level INDEX.md
  assert(kbFileExists('INDEX.md'), 'top-level INDEX.md exists');
  const topIndex = readKBFile('INDEX.md');
  assertContains(topIndex, './2026-03/INDEX.md', 'top-level INDEX.md: monthly dir link');

  // Monthly INDEX.md
  assert(kbFileExists('2026-03/INDEX.md'), '2026-03/INDEX.md exists');
  const monthIndex = readKBFile('2026-03/INDEX.md');
  // Link path must be relative to 2026-03/INDEX.md → just filename
  assertContains(monthIndex, './20260312-test-note.md', 'monthly INDEX: relative link to note');
  assertContains(monthIndex, '테스트 노트', 'monthly INDEX: note title');
  assertContains(monthIndex, '첫 번째 요약 라인입니다.', 'monthly INDEX: note summary');
  assertContains(monthIndex, '#test', 'monthly INDEX: tag #test');
  assertContains(monthIndex, '#nanoclaw', 'monthly INDEX: tag #nanoclaw');

  // MOC files
  assert(kbFileExists('moc/test-MOC.md'), 'moc/test-MOC.md exists');
  assert(kbFileExists('moc/nanoclaw-MOC.md'), 'moc/nanoclaw-MOC.md exists');

  const testMoc = readKBFile('moc/test-MOC.md');
  // MOC link: relative from moc/ → ../2026-03/filename
  assertContains(testMoc, '../2026-03/20260312-test-note.md', 'MOC: relative link goes via ../2026-03/');
}

function testNoLoneHashForEmptyTags(): void {
  console.log('\n── Task 2b: no lone # when tags empty ──');

  resetKB();
  writeNote('2026-03/20260312-no-tags.md', [
    '---',
    'title: No Tags Note',
    'created_at: 2026-03-12T10:00:00Z',
    '---',
    'Summary with no tags.',
  ].join('\n'));

  const { exitCode } = runScript();
  assert(exitCode === 0, 'no tags: exit code 0');

  const monthIndex = readKBFile('2026-03/INDEX.md');
  // Should not have a trailing lone # or space-#
  assertNotContains(monthIndex, ' #\n', 'no tags: no lone # at end of line');
  assertNotContains(monthIndex, ' #"', 'no tags: no lone # before EOL');
  assertContains(monthIndex, 'No Tags Note', 'no tags: title present');
  assertContains(monthIndex, 'Summary with no tags.', 'no tags: summary present');

  // Untagged notes should NOT appear in any MOC
  assert(!kbFileExists('moc/'), 'no tags: no moc dir created');
}

function testIdempotency(): void {
  console.log('\n── Task 3: Idempotency ──');

  resetKB();
  writeNote('2026-03/20260312-test-note.md', [
    '---',
    'title: 테스트 노트',
    'created_at: 2026-03-12T10:00:00Z',
    'tags: [test, nanoclaw]',
    '---',
    '첫 번째 요약 라인입니다.',
  ].join('\n'));

  runScript();
  const afterFirst = {
    topIndex: readKBFile('INDEX.md'),
    monthIndex: readKBFile('2026-03/INDEX.md'),
    testMoc: readKBFile('moc/test-MOC.md'),
    nanoclawMoc: readKBFile('moc/nanoclaw-MOC.md'),
  };

  runScript();
  const afterSecond = {
    topIndex: readKBFile('INDEX.md'),
    monthIndex: readKBFile('2026-03/INDEX.md'),
    testMoc: readKBFile('moc/test-MOC.md'),
    nanoclawMoc: readKBFile('moc/nanoclaw-MOC.md'),
  };

  assertEqual(afterFirst.topIndex, afterSecond.topIndex, 'idempotent: top INDEX.md unchanged on second run');
  assertEqual(afterFirst.monthIndex, afterSecond.monthIndex, 'idempotent: 2026-03/INDEX.md unchanged');
  assertEqual(afterFirst.testMoc, afterSecond.testMoc, 'idempotent: test-MOC.md unchanged');
  assertEqual(afterFirst.nanoclawMoc, afterSecond.nanoclawMoc, 'idempotent: nanoclaw-MOC.md unchanged');
}

function testScriptsDirExcluded(): void {
  console.log('\n── Task 3b: scripts/ dir excluded from INDEX ──');

  resetKB();
  writeNote('2026-03/20260312-test-note.md', [
    '---',
    'title: Real Note',
    'created_at: 2026-03-12T10:00:00Z',
    'tags: [test]',
    '---',
    'Real summary.',
  ].join('\n'));
  // Simulate scripts dir with a md file
  writeNote('scripts/some-script.md', [
    '---',
    'title: Script Note',
    'created_at: 2026-03-12T10:00:00Z',
    'tags: [script]',
    '---',
    'Script summary.',
  ].join('\n'));

  const { exitCode } = runScript();
  assert(exitCode === 0, 'scripts excluded: exit code 0');

  const monthIndex = readKBFile('2026-03/INDEX.md');
  assertNotContains(monthIndex, 'Script Note', 'scripts excluded: Script Note not in monthly INDEX');
  assertNotContains(monthIndex, 'script-script', 'scripts excluded: no script tag MOC created via month INDEX');

  // script tag MOC should not exist
  assert(!kbFileExists('moc/script-MOC.md'), 'scripts excluded: no script-MOC.md created');
}

// ─────────────────── RUN ALL ───────────────────

async function main(): Promise<void> {
  console.log('=== TDD Tests for generate_indexes.ts ===');
  console.log(`Script under test: ${SCRIPT}`);
  console.log(`Test KB: ${TEST_KB}`);

  // These tests will FAIL until generate_indexes.ts is implemented
  testScanAndFrontmatterParsing();
  testTagsScalarNormalization();
  testNoFrontmatterSkip();
  testMissingTitleFallback();
  testMissingCreatedAtFallback();
  testIndexAndMocGeneration();
  testNoLoneHashForEmptyTags();
  testIdempotency();
  testScriptsDirExcluded();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
