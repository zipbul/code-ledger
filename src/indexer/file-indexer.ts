import { promises as fsPromises } from 'node:fs';
import { join } from 'node:path';
import { hashString } from '../common/hasher';

// ── Types ─────────────────────────────────────────────────────────────────

export interface FileChangeRecord {
  filePath: string;
  contentHash: string;
  mtimeMs: number;
  size: number;
}

export interface DetectChangesResult {
  changed: FileChangeRecord[];
  unchanged: FileChangeRecord[];
  deleted: string[];
}

interface FileRepoPart {
  getFilesMap(...args: any[]): Map<string, { filePath: string; mtimeMs: number; size: number; contentHash: string }>;
}

export interface DetectChangesOptions {
  projectRoot: string;
  extensions: string[];
  ignorePatterns: string[];
  fileRepo: FileRepoPart;
}

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * Scans the project root for source files and classifies each as
 * changed / unchanged / deleted compared to the DB snapshot.
 *
 * Strategy:
 *  • mtime + size unchanged → unchanged (no hash read)
 *  • mtime or size changed → read content and compare hash
 *  • file in DB but missing from disk → deleted
 */
export async function detectChanges(opts: DetectChangesOptions): Promise<DetectChangesResult> {
  const { projectRoot, extensions, ignorePatterns, fileRepo } = opts;

  const existingMap = fileRepo.getFilesMap();
  const seenPaths = new Set<string>();
  const changed: FileChangeRecord[] = [];
  const unchanged: FileChangeRecord[] = [];

  // Pre-compile ignore patterns using Bun.Glob matching (scanning unsupported, matching is fine).
  const ignoreGlobs = ignorePatterns.map((p) => new Bun.Glob(p));

  // Glob with wildcard pattern — extension filtering done in-loop (mock ignores the pattern arg).
  for await (const relativePath of fsPromises.glob('**/*', { cwd: projectRoot })) {
    // Extension filter.
    if (!extensions.some((ext) => relativePath.endsWith(ext))) continue;

    // Ignore pattern filter.
    if (ignoreGlobs.some((g) => g.match(relativePath))) continue;

    seenPaths.add(relativePath);

    const absPath = join(projectRoot, relativePath);
    const bunFile = Bun.file(absPath);
    const { size, lastModified: mtimeMs } = bunFile;

    const existing = existingMap.get(relativePath);

    if (!existing) {
      // New file — read and hash.
      const text = await bunFile.text();
      const contentHash = hashString(text);
      changed.push({ filePath: relativePath, contentHash, mtimeMs, size });
      continue;
    }

    if (existing.mtimeMs === mtimeMs && existing.size === size) {
      // Fast-path: metadata unchanged → skip hash read.
      unchanged.push({ filePath: relativePath, contentHash: existing.contentHash, mtimeMs, size });
      continue;
    }

    // Metadata changed — read and check content hash.
    const text = await bunFile.text();
    const contentHash = hashString(text);
    if (contentHash === existing.contentHash) {
      unchanged.push({ filePath: relativePath, contentHash, mtimeMs, size });
    } else {
      changed.push({ filePath: relativePath, contentHash, mtimeMs, size });
    }
  }

  // Files present in DB but absent on disk → deleted.
  const deleted: string[] = [];
  for (const filePath of existingMap.keys()) {
    if (!seenPaths.has(filePath)) {
      deleted.push(filePath);
    }
  }

  return { changed, unchanged, deleted };
}
