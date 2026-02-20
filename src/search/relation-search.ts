import type { CodeRelation } from '../extractor/types';
import type { RelationRecord } from '../store/repositories/relation.repository';

export interface RelationSearchQuery {
  srcFilePath?: string;
  srcSymbolName?: string;
  dstFilePath?: string;
  dstSymbolName?: string;
  type?: CodeRelation['type'];
  project?: string;
  limit?: number;
}

export interface IRelationRepo {
  searchRelations(opts: {
    srcFilePath?: string;
    srcSymbolName?: string;
    dstFilePath?: string;
    dstSymbolName?: string;
    type?: string;
    project?: string;
    limit: number;
  }): RelationRecord[];
}

export function relationSearch(options: {
  relationRepo: IRelationRepo;
  project?: string;
  query: RelationSearchQuery;
}): CodeRelation[] {
  const { relationRepo, project, query } = options;
  const effectiveProject = query.project ?? project;
  const limit = query.limit ?? 500;

  const records = relationRepo.searchRelations({
    srcFilePath: query.srcFilePath,
    srcSymbolName: query.srcSymbolName,
    dstFilePath: query.dstFilePath,
    dstSymbolName: query.dstSymbolName,
    type: query.type,
    project: effectiveProject,
    limit,
  });

  return records.map(r => ({
    type: r.type as CodeRelation['type'],
    srcFilePath: r.srcFilePath,
    srcSymbolName: r.srcSymbolName,
    dstFilePath: r.dstFilePath,
    dstSymbolName: r.dstSymbolName,
    metaJson: r.metaJson ?? undefined,
  }));
}
