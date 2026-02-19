import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { ImportReference } from './types';

// ── Mock ../parser/ast-utils ──
const mockVisit = mock((_node: any, _cb: any) => {});
const mockGetQualifiedName = mock(() => null as any);

import { extractHeritage } from './heritage-extractor';

const FILE = '/project/src/index.ts';

function makeImportMap(entries: [string, ImportReference][] = []): Map<string, ImportReference> {
  return new Map(entries);
}

// ── Fake class node helpers ──
function fakeClassNode(
  name: string,
  opts: { superClass?: any; implements?: any[] } = {},
): Record<string, unknown> {
  return {
    type: 'ClassDeclaration',
    id: { name },
    superClass: opts.superClass ?? null,
    implements: opts.implements ?? [],
    body: { body: [] },
  };
}

describe('extractHeritage', () => {
  beforeEach(() => {
    mock.module('../parser/ast-utils', () => ({
      visit: mockVisit,
      getQualifiedName: mockGetQualifiedName,
    }));
    mockVisit.mockClear();
    mockGetQualifiedName.mockClear();
    mockVisit.mockImplementation(() => {});
    mockGetQualifiedName.mockReturnValue(null);
  });

  // HP — extends (local)
  it('should produce an extends relation when class extends a locally defined class', () => {
    const superClassNode = { type: 'Identifier', name: 'Animal' };
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb(fakeClassNode('Dog', { superClass: superClassNode }));
    });
    mockGetQualifiedName.mockReturnValue({ root: 'Animal', parts: [], full: 'Animal' });

    const relations = extractHeritage({} as any, FILE, makeImportMap());
    const rel = relations.find((r) => r.type === 'extends' && r.srcSymbolName === 'Dog');

    expect(rel).toBeDefined();
    expect(rel!.dstSymbolName).toBe('Animal');
    expect(rel!.metaJson).toContain('"isLocal":true');
  });

  // HP — implements (local)
  it('should produce an implements relation when class implements a locally defined interface', () => {
    const exprNode = { type: 'Identifier', name: 'Service' };
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb(fakeClassNode('ServiceImpl', { implements: [{ expression: exprNode }] }));
    });
    mockGetQualifiedName.mockReturnValue({ root: 'Service', parts: [], full: 'Service' });

    const relations = extractHeritage({} as any, FILE, makeImportMap());
    const rel = relations.find((r) => r.type === 'implements' && r.srcSymbolName === 'ServiceImpl');

    expect(rel).toBeDefined();
    expect(rel!.dstSymbolName).toBe('Service');
  });

  // HP — extends (imported)
  it('should set dstFilePath to imported module path when base class is an imported symbol', () => {
    const superClassNode = { type: 'Identifier', name: 'Base' };
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb(fakeClassNode('Child', { superClass: superClassNode }));
    });
    mockGetQualifiedName.mockReturnValue({ root: 'Base', parts: [], full: 'Base' });

    const importMap = makeImportMap([
      ['Base', { path: '/project/src/base.ts', importedName: 'Base' }],
    ]);
    const relations = extractHeritage({} as any, FILE, importMap);
    const rel = relations.find((r) => r.type === 'extends');

    expect(rel?.dstFilePath).toBe('/project/src/base.ts');
  });

  // HP — implements (imported)
  it('should set dstFilePath to imported module path when implemented interface is an imported symbol', () => {
    const exprNode = { type: 'Identifier', name: 'IFoo' };
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb(fakeClassNode('FooImpl', { implements: [{ expression: exprNode }] }));
    });
    mockGetQualifiedName.mockReturnValue({ root: 'IFoo', parts: [], full: 'IFoo' });

    const importMap = makeImportMap([
      ['IFoo', { path: '/project/src/ifoo.ts', importedName: 'IFoo' }],
    ]);
    const relations = extractHeritage({} as any, FILE, importMap);
    const rel = relations.find((r) => r.type === 'implements');

    expect(rel?.dstFilePath).toBe('/project/src/ifoo.ts');
  });

  // NE — no heritage
  it('should return empty array when class has no extends or implements clause', () => {
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb(fakeClassNode('Plain'));
    });

    const relations = extractHeritage({} as any, FILE, makeImportMap());

    expect(relations).toEqual([]);
  });

  // ED — empty source
  it('should return empty array when source is empty', () => {
    // visit never calls callback → no relations
    const relations = extractHeritage({} as any, FILE, makeImportMap());

    expect(relations).toEqual([]);
  });

  // multiple implements
  it('should produce one relation per interface when class implements multiple interfaces', () => {
    const exprA = { type: 'Identifier', name: 'A' };
    const exprB = { type: 'Identifier', name: 'B' };
    const exprC = { type: 'Identifier', name: 'C' };
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb(fakeClassNode('Multi', {
        implements: [{ expression: exprA }, { expression: exprB }, { expression: exprC }],
      }));
    });
    mockGetQualifiedName
      .mockReturnValueOnce({ root: 'A', parts: [], full: 'A' })
      .mockReturnValueOnce({ root: 'B', parts: [], full: 'B' })
      .mockReturnValueOnce({ root: 'C', parts: [], full: 'C' });

    const relations = extractHeritage({} as any, FILE, makeImportMap());
    const implRels = relations.filter((r) => r.type === 'implements' && r.srcSymbolName === 'Multi');

    expect(implRels.length).toBe(3);
  });

  // namespace import
  it('should include {"isNamespaceImport":true} in metaJson when base class is accessed via namespace import', () => {
    const superClassNode = { type: 'MemberExpression', object: { type: 'Identifier', name: 'ns' }, property: { name: 'Base' } };
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb(fakeClassNode('Child', { superClass: superClassNode }));
    });
    mockGetQualifiedName.mockReturnValue({ root: 'ns', parts: ['Base'], full: 'ns.Base' });

    const importMap = makeImportMap([
      ['ns', { path: '/project/src/ns.ts', importedName: '*' }],
    ]);
    const relations = extractHeritage({} as any, FILE, importMap);
    const rel = relations.find((r) => r.type === 'extends');

    expect(rel?.metaJson).toContain('"isNamespaceImport":true');
  });

  // ID
  it('should return identical relations when called repeatedly with the same AST', () => {
    const superClassNode = { type: 'Identifier', name: 'A' };
    mockVisit.mockImplementation((_ast: any, cb: any) => {
      cb(fakeClassNode('B', { superClass: superClassNode }));
    });
    mockGetQualifiedName.mockReturnValue({ root: 'A', parts: [], full: 'A' });

    const r1 = extractHeritage({} as any, FILE, makeImportMap());
    const r2 = extractHeritage({} as any, FILE, makeImportMap());

    expect(r1).toEqual(r2);
  });
});
