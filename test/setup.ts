/**
 * Global test setup — loaded via bunfig.toml [test] preload.
 *
 * Captures real module references before any spec file can mock them,
 * then restores those references in a global afterEach so that
 * mock.module() calls in one spec file do not leak into the next.
 *
 * Why afterEach + mock.module(real)?
 *   - mock.restore() does NOT undo mock.module() (bun official docs).
 *   - mock.module() updates ESM live bindings, so re-calling it with
 *     the real exports effectively "un-mocks" the module for subsequent tests.
 *
 * IMPORTANT: `import * as ns` returns a live-binding namespace object.
 *   When mock.module() replaces the module, the namespace is ALSO updated.
 *   Therefore we must spread the namespace into a plain object to snapshot
 *   the real exports BEFORE any mocking occurs.
 */
import { afterEach, mock } from 'bun:test';

// ── Capture real modules (snapshot via spread, before any mock.module) ──
import * as _realAstUtils from '../src/parser/ast-utils';
import * as _realSourcePosition from '../src/parser/source-position';
import * as _realJsdocParser from '../src/parser/jsdoc-parser';
import * as _realExtractorUtils from '../src/extractor/extractor-utils';
import * as _realImportsExtractor from '../src/extractor/imports-extractor';
import * as _realCallsExtractor from '../src/extractor/calls-extractor';
import * as _realHeritageExtractor from '../src/extractor/heritage-extractor';
import * as _realSymbolExtractor from '../src/extractor/symbol-extractor';
import * as _realRelationExtractor from '../src/extractor/relation-extractor';
import * as _realHasher from '../src/common/hasher';
import * as _realPathUtils from '../src/common/path-utils';
import * as _realTsconfigResolver from '../src/common/tsconfig-resolver';
import * as _realProjectDiscovery from '../src/common/project-discovery';
import * as _realFileIndexer from '../src/indexer/file-indexer';
import * as _realSymbolIndexer from '../src/indexer/symbol-indexer';
import * as _realRelationIndexer from '../src/indexer/relation-indexer';
import * as _realCommentParser from 'comment-parser';
import * as _realNodePath from 'node:path';
import * as _realNodeFs from 'node:fs';

const realAstUtils = { ..._realAstUtils };
const realSourcePosition = { ..._realSourcePosition };
const realJsdocParser = { ..._realJsdocParser };
const realExtractorUtils = { ..._realExtractorUtils };
const realImportsExtractor = { ..._realImportsExtractor };
const realCallsExtractor = { ..._realCallsExtractor };
const realHeritageExtractor = { ..._realHeritageExtractor };
const realSymbolExtractor = { ..._realSymbolExtractor };
const realRelationExtractor = { ..._realRelationExtractor };
const realHasher = { ..._realHasher };
const realPathUtils = { ..._realPathUtils };
const realTsconfigResolver = { ..._realTsconfigResolver };
const realProjectDiscovery = { ..._realProjectDiscovery };
const realFileIndexer = { ..._realFileIndexer };
const realSymbolIndexer = { ..._realSymbolIndexer };
const realRelationIndexer = { ..._realRelationIndexer };
const realCommentParser = { ..._realCommentParser };
const realNodePath = { ..._realNodePath };
const realNodeFs = { ..._realNodeFs };

// ── Global cleanup after every test ──
afterEach(() => {
  // Restore real module implementations via live binding updates.
  mock.module('../src/parser/ast-utils', () => realAstUtils);
  mock.module('../src/parser/source-position', () => realSourcePosition);
  mock.module('../src/parser/jsdoc-parser', () => realJsdocParser);
  mock.module('../src/extractor/extractor-utils', () => realExtractorUtils);
  mock.module('../src/extractor/imports-extractor', () => realImportsExtractor);
  mock.module('../src/extractor/calls-extractor', () => realCallsExtractor);
  mock.module('../src/extractor/heritage-extractor', () => realHeritageExtractor);
  mock.module('../src/extractor/symbol-extractor', () => realSymbolExtractor);
  mock.module('../src/extractor/relation-extractor', () => realRelationExtractor);
  mock.module('../src/common/hasher', () => realHasher);
  mock.module('../src/common/path-utils', () => realPathUtils);
  mock.module('../src/common/tsconfig-resolver', () => realTsconfigResolver);
  mock.module('../src/common/project-discovery', () => realProjectDiscovery);
  mock.module('../src/indexer/file-indexer', () => realFileIndexer);
  mock.module('../src/indexer/symbol-indexer', () => realSymbolIndexer);
  mock.module('../src/indexer/relation-indexer', () => realRelationIndexer);
  mock.module('comment-parser', () => realCommentParser);
  mock.module('node:path', () => realNodePath);
  mock.module('node:fs', () => realNodeFs);

  // Restore spy implementations + clear call history.
  mock.restore();
});
