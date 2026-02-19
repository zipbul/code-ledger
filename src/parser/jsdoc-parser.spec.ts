import { describe, it, expect, mock, beforeEach } from 'bun:test';

// comment-parser의 parse를 mock으로 교체. 변수를 여기서 캡처해야 mockImplementationOnce 사용 가능.
const mockParse = mock(() => [{ description: 'A description.', tags: [] as any[] }]);

import { parseJsDoc } from './jsdoc-parser';
import { ParseError } from '../errors';

describe('parseJsDoc', () => {
  beforeEach(() => {
    mock.module('comment-parser', () => ({
      parse: mockParse,
    }));
    mockParse.mockClear();
    mockParse.mockImplementation(() => [{ description: 'A description.', tags: [] as any[] }]);
  });
  // HP
  it('should return description and empty tags for a simple comment', () => {
    // Arrange & Act
    const result = parseJsDoc('/** A description. */');
    // Assert
    expect(result.description).toBe('A description.');
    expect(result.tags).toEqual([]);
  });

  it('should return parsed tags when comment-parser returns tags', () => {
    // Arrange
    mockParse.mockImplementationOnce(() => ([
      {
        description: 'Handles auth.',
        tags: [
          { tag: 'param', name: 'userId', type: 'string', description: 'The user ID.', optional: false },
        ],
      },
    ]));
    // Act
    const result = parseJsDoc('/** Handles auth. @param {string} userId The user ID. */');
    // Assert
    expect(result.description).toBe('Handles auth.');
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].tag).toBe('param');
    expect(result.tags[0].name).toBe('userId');
    expect(result.tags[0].type).toBe('string');
  });

  it('should map optional field from comment-parser tag', () => {
    mockParse.mockImplementationOnce(() => ([
      {
        description: '',
        tags: [
          { tag: 'param', name: 'x', type: 'number', description: '', optional: true },
        ],
      },
    ]));
    const result = parseJsDoc('/** @param {number} [x] */');
    expect(result.tags[0].optional).toBe(true);
  });

  it('should map default field from comment-parser tag when present', () => {
    mockParse.mockImplementationOnce(() => ([
      {
        description: '',
        tags: [
          { tag: 'param', name: 'x', type: 'number', description: '', optional: true, default: '42' },
        ],
      },
    ]));
    const result = parseJsDoc('/** @param {number} [x=42] */');
    expect(result.tags[0].default).toBe('42');
  });

  // NE — comment-parser throws
  it('should throw ParseError when comment-parser throws', () => {
    mockParse.mockImplementationOnce(() => { throw new Error('parse failure'); });
    expect(() => parseJsDoc('/** broken */')).toThrow(ParseError);
  });

  it('should preserve original error as cause inside thrown ParseError', () => {
    const cause = new Error('inner');
    mockParse.mockImplementationOnce(() => { throw cause; });
    let thrown: unknown;
    try { parseJsDoc('/** broken */'); } catch (e) { thrown = e; }
    expect((thrown as ParseError).cause).toBe(cause);
  });

  // ED
  it('should handle empty comment text without throwing', () => {
    mockParse.mockImplementationOnce(() => ([{ description: '', tags: [] }]));
    expect(() => parseJsDoc('')).not.toThrow();
  });

  it('should handle undefined default in tag gracefully (no default field)', () => {
    mockParse.mockImplementationOnce(() => ([
      {
        description: '',
        tags: [
          { tag: 'param', name: 'x', type: 'string', description: '', optional: false, default: undefined },
        ],
      },
    ]));
    const result = parseJsDoc('/** @param {string} x */');
    expect(result.tags[0].default).toBeUndefined();
  });

  // ID
  it('should return identical results when called twice with the same input', () => {
    mockParse.mockImplementation(() => ([{ description: 'Same.', tags: [] }]));
    const r1 = parseJsDoc('/** Same. */');
    const r2 = parseJsDoc('/** Same. */');
    expect(r1).toEqual(r2);
  });

  // plain text without /** wrapper — G14
  it('should parse input without /** wrapper by passing it through as description', () => {
    mockParse.mockImplementationOnce(() => ([{ description: 'plain text', tags: [] }]));
    const result = parseJsDoc('plain text');
    expect(result.description).toBe('plain text');
    expect(result.tags).toHaveLength(0);
  });
});
