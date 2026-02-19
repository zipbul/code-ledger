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
  mock.module('comment-parser', () => realCommentParser);
  mock.module('node:path', () => realNodePath);
  mock.module('node:fs', () => realNodeFs);

  // Restore spy implementations + clear call history.
  mock.restore();
});
