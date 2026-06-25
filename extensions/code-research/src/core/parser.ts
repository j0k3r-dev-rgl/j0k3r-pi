import Parser from 'tree-sitter';
import tsModule from 'tree-sitter-typescript';
import jsModule from 'tree-sitter-javascript';
import type { SupportedLanguage } from '../types.js';

const { typescript, tsx } = tsModule;
const JavaScript = jsModule;

let tsParser: Parser | undefined;
let tsxParser: Parser | undefined;
let jsParser: Parser | undefined;

export function getParser(language: Exclude<SupportedLanguage, 'auto'>): Parser {
  if (language === 'ts') {
    if (!tsParser) {
      tsParser = new Parser();
      tsParser.setLanguage(typescript);
    }
    return tsParser;
  }

  if (!jsParser) {
    jsParser = new Parser();
    jsParser.setLanguage(JavaScript);
  }
  return jsParser;
}
