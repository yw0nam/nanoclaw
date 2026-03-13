#!/usr/bin/env ts-node
/**
 * generate_indexes.ts
 * Scans all *.md files in the knowledge base and regenerates:
 *   - {YYYY-MM}/INDEX.md (monthly index)
 *   - INDEX.md (top-level)
 *   - moc/{tag}-MOC.md (per-tag MOC files)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const KNOWLEDGE_BASE_PATH = process.env.KNOWLEDGE_BASE_PATH ?? '/home/spow12/data/knowledge_base';

const EXCLUDE_DIRS = new Set(['scripts', 'moc', '.git']);
const EXCLUDE_FILES = new Set(['INDEX.md']);

interface NoteEntry {
  path: string;
  title: string;
  tags: string[];
  createdAt: Date;
  summary: string;
}

/**
 * Recursively collect all *.md files, excluding specified dirs and filenames.
 */
function collectMarkdownFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    process.stderr.write(`WARN: cannot read dir ${dir}: ${(err as Error).message}\n`);
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Only exclude top-level dirs relative to baseDir
      const relToBase = path.relative(baseDir, path.join(dir, entry.name));
      const topLevelPart = relToBase.split(path.sep)[0];
      if (EXCLUDE_DIRS.has(topLevelPart)) continue;
      results.push(...collectMarkdownFiles(path.join(dir, entry.name), baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      results.push(path.join(dir, entry.name));
    }
  }

  return results;
}

/**
 * Extract summary: first non-empty, non-heading line of body (after frontmatter), max 100 chars.
 */
function extractSummary(body: string): string {
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) continue;
    return trimmed.length > 100 ? trimmed.slice(0, 100) : trimmed;
  }
  return '';
}

/**
 * Parse a single markdown file and return a NoteEntry.
 * Returns null if the file should be skipped.
 */
function parseNote(filePath: string): NoteEntry | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    process.stderr.write(`WARN: skipping ${filePath}: ${(err as Error).message}\n`);
    process.exitCode = 1;
    return null;
  }

  // Extract frontmatter
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    process.stderr.write(`WARN: skipping ${filePath}: no frontmatter found\n`);
    process.exitCode = 1;
    return null;
  }

  const fmRaw = fmMatch[1];
  const body = fmMatch[2] ?? '';

  let fm: Record<string, unknown>;
  try {
    const parsed = yaml.load(fmRaw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('frontmatter is not an object');
    }
    fm = parsed as Record<string, unknown>;
  } catch (err) {
    process.stderr.write(`WARN: skipping ${filePath}: YAML parse error: ${(err as Error).message}\n`);
    process.exitCode = 1;
    return null;
  }

  // title: missing → use filename stem
  const stem = path.basename(filePath, '.md');
  const title = typeof fm['title'] === 'string' && fm['title'].trim().length > 0
    ? fm['title'].trim()
    : stem;

  // tags: scalar string → array; missing/empty → []
  let tags: string[] = [];
  if (fm['tags'] !== undefined && fm['tags'] !== null) {
    if (typeof fm['tags'] === 'string') {
      // scalar string → normalize to array
      const trimmed = fm['tags'].trim();
      tags = trimmed.length > 0 ? [trimmed] : [];
    } else if (Array.isArray(fm['tags'])) {
      tags = (fm['tags'] as unknown[])
        .filter((t) => typeof t === 'string' && (t as string).trim().length > 0)
        .map((t) => (t as string).trim());
    }
  }

  // created_at: missing or unparseable → file mtime + WARN
  let createdAt: Date;
  if (fm['created_at'] !== undefined && fm['created_at'] !== null) {
    const raw = fm['created_at'];
    // js-yaml may parse date strings as Date objects
    if (raw instanceof Date) {
      if (isNaN(raw.getTime())) {
        process.stderr.write(`WARN: ${filePath}: created_at unparseable, using mtime\n`);
        process.exitCode = 1;
        createdAt = fs.statSync(filePath).mtime;
      } else {
        createdAt = raw;
      }
    } else if (typeof raw === 'string') {
      const parsed = new Date(raw as string);
      if (isNaN(parsed.getTime())) {
        process.stderr.write(`WARN: ${filePath}: created_at unparseable, using mtime\n`);
        process.exitCode = 1;
        createdAt = fs.statSync(filePath).mtime;
      } else {
        createdAt = parsed;
      }
    } else {
      process.stderr.write(`WARN: ${filePath}: created_at unparseable, using mtime\n`);
      process.exitCode = 1;
      createdAt = fs.statSync(filePath).mtime;
    }
  } else {
    process.stderr.write(`WARN: ${filePath}: created_at missing, using mtime\n`);
    process.exitCode = 1;
    createdAt = fs.statSync(filePath).mtime;
  }

  const summary = extractSummary(body);

  return {
    path: filePath,
    title,
    tags,
    createdAt,
    summary,
  };
}

/**
 * Format a note entry line.
 * relPath is relative to the index file's directory.
 * If it starts with '../', keep it as-is; otherwise prefix with './'.
 */
function formatEntry(note: NoteEntry, relPath: string): string {
  const tagsStr = note.tags.length > 0 ? ' #' + note.tags.join(' #') : '';
  const href = relPath.startsWith('..') ? relPath : `./${relPath}`;
  return `- [${note.title}](${href}) — ${note.summary}${tagsStr}`;
}

/**
 * Get YYYY-MM string from a Date.
 */
function getYearMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Write a file, creating parent dirs as needed.
 */
function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function main(): Promise<void> {
  const baseDir = KNOWLEDGE_BASE_PATH;

  // Collect all markdown files
  const files = collectMarkdownFiles(baseDir, baseDir);

  // Parse all notes
  const notes: NoteEntry[] = [];
  for (const file of files) {
    const note = parseNote(file);
    if (note !== null) {
      notes.push(note);
    }
  }

  // Group by YYYY-MM
  const byMonth = new Map<string, NoteEntry[]>();
  for (const note of notes) {
    const ym = getYearMonth(note.createdAt);
    if (!byMonth.has(ym)) byMonth.set(ym, []);
    byMonth.get(ym)!.push(note);
  }

  // Sort each month's notes by created_at desc
  for (const monthNotes of byMonth.values()) {
    monthNotes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Get sorted month keys desc
  const sortedMonths = Array.from(byMonth.keys()).sort((a, b) => b.localeCompare(a));

  // 1. Write monthly INDEX.md files
  for (const ym of sortedMonths) {
    const monthDir = path.join(baseDir, ym);
    const monthIndexPath = path.join(monthDir, 'INDEX.md');
    const monthNotes = byMonth.get(ym)!;

    const lines: string[] = [`# ${ym}`, ''];
    for (const note of monthNotes) {
      const relPath = path.relative(monthDir, note.path);
      lines.push(formatEntry(note, relPath));
    }
    lines.push('');

    writeFile(monthIndexPath, lines.join('\n'));
  }

  // 2. Write top-level INDEX.md
  const topIndexPath = path.join(baseDir, 'INDEX.md');
  const topLines: string[] = ['# Knowledge Base Index', ''];
  for (const ym of sortedMonths) {
    topLines.push(`- [${ym}](./2026-03/INDEX.md)`.replace('2026-03', ym));
  }
  topLines.push('');

  writeFile(topIndexPath, topLines.join('\n'));

  // 3. Write per-tag MOC files
  const mocDir = path.join(baseDir, 'moc');

  // Collect all tags
  const byTag = new Map<string, NoteEntry[]>();
  for (const note of notes) {
    for (const tag of note.tags) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(note);
    }
  }

  // Sort each tag's notes by created_at desc
  for (const tagNotes of byTag.values()) {
    tagNotes.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Clean up existing MOC files to ensure idempotency (remove stale tags)
  if (fs.existsSync(mocDir)) {
    const existingMocs = fs.readdirSync(mocDir).filter((f) => f.endsWith('-MOC.md'));
    for (const moc of existingMocs) {
      const tag = moc.replace(/-MOC\.md$/, '');
      if (!byTag.has(tag)) {
        fs.unlinkSync(path.join(mocDir, moc));
      }
    }
  }

  // Only create moc dir and files if there are tags
  if (byTag.size > 0) {
    for (const [tag, tagNotes] of byTag.entries()) {
      const mocPath = path.join(mocDir, `${tag}-MOC.md`);
      const lines: string[] = [`# ${tag}`, ''];
      for (const note of tagNotes) {
        const relPath = path.relative(mocDir, note.path);
        lines.push(formatEntry(note, relPath));
      }
      lines.push('');
      writeFile(mocPath, lines.join('\n'));
    }
  }

  console.log(`Done. Processed ${notes.length} notes, ${sortedMonths.length} months, ${byTag.size} tags.`);
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${(err as Error).message}\n`);
  process.exit(1);
});
