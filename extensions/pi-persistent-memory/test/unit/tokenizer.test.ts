import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGLISH_STOPWORDS,
  extractTokens,
  extractConstituentSegments,
  getQueryMeaningfulTerms,
  buildDocumentTermIndex,
  computeLiteralCoverage,
  computeTextCoverage,
  buildFts5MatchExpression,
} from '../../src/search/tokenizer.ts';

test('M3-A02: English stoplist retains technical words and excludes function words', () => {
  // Retains technical words
  assert.equal(ENGLISH_STOPWORDS.has('use'), false);
  assert.equal(ENGLISH_STOPWORDS.has('using'), false);
  assert.equal(ENGLISH_STOPWORDS.has('code'), false);
  assert.equal(ENGLISH_STOPWORDS.has('file'), false);
  assert.equal(ENGLISH_STOPWORDS.has('type'), false);

  // Excludes standard function words
  assert.equal(ENGLISH_STOPWORDS.has('the'), true);
  assert.equal(ENGLISH_STOPWORDS.has('and'), true);
  assert.equal(ENGLISH_STOPWORDS.has('or'), true);
  assert.equal(ENGLISH_STOPWORDS.has('in'), true);
  assert.equal(ENGLISH_STOPWORDS.has('for'), true);
  assert.equal(ENGLISH_STOPWORDS.has('with'), true);
});

test('M3-A02: Maximal literal technical tokens preserve short identifiers and punctuation', () => {
  const text = 'Using Go, TS, C++, C#, node:sqlite, foo_bar, package-name, and src/tools/index.ts in std::vector';
  const tokens = extractTokens(text);

  assert.ok(tokens.includes('go'));
  assert.ok(tokens.includes('ts'));
  assert.ok(tokens.includes('c++'));
  assert.ok(tokens.includes('c#'));
  assert.ok(tokens.includes('node:sqlite'));
  assert.ok(tokens.includes('foo_bar'));
  assert.ok(tokens.includes('package-name'));
  assert.ok(tokens.includes('src/tools/index.ts'));
  assert.ok(tokens.includes('std::vector'));

  // Plain punctuation alone does not produce tokens
  assert.deepEqual(extractTokens('... --- ::: +++ ### ???'), []);
});

test('M3-A02: Token boundaries prevent substring false positives', () => {
  // TS does not match typescript or tests
  const tsQuery = getQueryMeaningfulTerms('TS');
  assert.deepEqual(tsQuery, ['ts']);
  assert.equal(computeTextCoverage(tsQuery, 'Typescript guide', 'Running unit tests'), 0);
  assert.equal(computeTextCoverage(tsQuery, 'TS guide', 'Working with TS'), 1);

  // Go does not match django
  const goQuery = getQueryMeaningfulTerms('Go');
  assert.deepEqual(goQuery, ['go']);
  assert.equal(computeTextCoverage(goQuery, 'Django web framework', 'Building django apps'), 0);
  assert.equal(computeTextCoverage(goQuery, 'Go programming', 'Writing Go code'), 1);

  // C++ does not match C or C#
  const cppQuery = getQueryMeaningfulTerms('C++');
  assert.deepEqual(cppQuery, ['c++']);
  assert.equal(computeTextCoverage(cppQuery, 'C programming', 'Learn C language'), 0);
  assert.equal(computeTextCoverage(cppQuery, 'C# programming', 'Learn C# language'), 0);
  assert.equal(computeTextCoverage(cppQuery, 'C++ programming', 'Learn C++ language'), 1);

  // C does not match C++ or C#
  const cQuery = getQueryMeaningfulTerms('C');
  assert.deepEqual(cQuery, ['c']);
  assert.equal(computeTextCoverage(cQuery, 'C++ programming', 'Learn C++ language'), 0);
  assert.equal(computeTextCoverage(cQuery, 'C# programming', 'Learn C# language'), 0);
  assert.equal(computeTextCoverage(cQuery, 'C programming', 'Learn C language'), 1);
});

test('M3-A02: Compound identifiers match constituent segments ONLY when query requests them', () => {
  // Query requests constituent "node" -> matches compound "node:sqlite"
  const nodeQuery = getQueryMeaningfulTerms('node');
  assert.equal(computeTextCoverage(nodeQuery, 'Storage engine', 'Implemented in node:sqlite'), 1);

  // Query requests compound "node:sqlite" -> requires compound, does NOT match separated words
  const compoundQuery = getQueryMeaningfulTerms('node:sqlite');
  assert.deepEqual(compoundQuery, ['node:sqlite']);
  assert.equal(computeTextCoverage(compoundQuery, 'Using node with sqlite', 'Connecting node to sqlite'), 0);
  assert.equal(computeTextCoverage(compoundQuery, 'Storage engine', 'Using node:sqlite driver'), 1);
});

test('M3-A02: Safe parameterized FTS5 MATCH expression handles quotes, injection, and empty terms', () => {
  // Empty terms produce null
  assert.equal(buildFts5MatchExpression([]), null);
  assert.equal(buildFts5MatchExpression(getQueryMeaningfulTerms('the and or in')), null);

  // C++ produces "c"
  assert.equal(buildFts5MatchExpression(['c++']), '"c"');

  // node:sqlite produces ("node" AND "sqlite")
  assert.equal(buildFts5MatchExpression(['node:sqlite']), '("node" AND "sqlite")');

  // Escaping quotes prevents FTS syntax injection
  const injection = 'hello" OR 1=1 --';
  const terms = getQueryMeaningfulTerms(injection);
  const expr = buildFts5MatchExpression(terms);
  assert.ok(expr);
  assert.ok(!expr.includes('1=1 --'));
  assert.ok(expr.includes('"hello"'));
});
