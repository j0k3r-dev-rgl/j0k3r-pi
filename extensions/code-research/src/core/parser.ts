import Parser from 'tree-sitter';
import tsModule from 'tree-sitter-typescript';
import jsModule from 'tree-sitter-javascript';
import javaModule from 'tree-sitter-java';
import type { SupportedLanguage } from '../types.js';

const { typescript, tsx } = tsModule;
const JavaScript = jsModule;
const Java = javaModule;

const DEFAULT_PARSE_BUFFER_SIZE = 1024 * 1024;

let tsParser: Parser | undefined;
let tsxParser: Parser | undefined;
let jsParser: Parser | undefined;
let javaParser: Parser | undefined;

export function getParser(language: Exclude<SupportedLanguage, 'auto'>): Parser {
  if (language === 'ts') {
    if (!tsParser) {
      tsParser = new Parser();
      tsParser.setLanguage(typescript);
    }
    return tsParser;
  }

  if (language === 'java') {
    if (!javaParser) {
      javaParser = new Parser();
      javaParser.setLanguage(Java);
    }
    return javaParser;
  }

  if (!jsParser) {
    jsParser = new Parser();
    jsParser.setLanguage(JavaScript);
  }
  return jsParser;
}

export function parseSource(
  parser: Parser,
  source: string,
  options?: { bufferSize?: number }
): Parser.Tree {
  const bufferSize = options?.bufferSize ?? DEFAULT_PARSE_BUFFER_SIZE;
  return parser.parse(source, undefined, { bufferSize });
}
