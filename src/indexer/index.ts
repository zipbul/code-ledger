export { detectChanges } from './file-indexer';
export type { DetectChangesOptions, DetectChangesResult, FileChangeRecord } from './file-indexer';
export { indexFileSymbols } from './symbol-indexer';
export type { IndexFileSymbolsOptions, SymbolDbRow } from './symbol-indexer';
export { indexFileRelations } from './relation-indexer';
export type { IndexFileRelationsOptions, RelationDbRow } from './relation-indexer';
export { IndexCoordinator, WATCHER_DEBOUNCE_MS } from './index-coordinator';
export type { IndexCoordinatorOptions, IndexResult } from './index-coordinator';
