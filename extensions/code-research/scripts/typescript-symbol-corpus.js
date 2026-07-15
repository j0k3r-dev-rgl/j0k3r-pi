import { createHash } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function generateTypeScriptSymbolCorpus(rootDir, size) {
  const fileCount = size === 'large' ? 10_000 : 1_000;
  const symbolsPerFile = 25;
  await rm(rootDir, { recursive: true, force: true });
  await mkdir(rootDir, { recursive: true });

  const manifest = createHash('sha256');
  for (let index = 0; index < fileCount; index += 1) {
    const functions = Array.from({ length: 8 }, (_, symbolIndex) => `export function fn_${index}_${symbolIndex}() { return ${index + symbolIndex}; }`);
    const variables = Array.from({ length: 4 }, (_, symbolIndex) => `export const value_${index}_${symbolIndex} = ${symbolIndex};`);
    const properties = Array.from({ length: 4 }, (_, symbolIndex) => `  property_${symbolIndex}: string;`).join('\n');
    const members = Array.from({ length: 3 }, (_, symbolIndex) => `  Member_${symbolIndex} = ${symbolIndex},`).join('\n');
    const methods = Array.from({ length: 3 }, (_, symbolIndex) => `  method_${symbolIndex}() { return ${symbolIndex}; }`).join('\n');
    const source = [...functions, ...variables, `export interface Contract_${index} {\n${properties}\n}`, `export enum Choice_${index} {\n${members}\n}`, `export class Service_${index} {\n${methods}\n}`].join('\n');
    const relativePath = `file-${index}.ts`;
    await writeFile(join(rootDir, relativePath), `${source}\n`, 'utf8');
    manifest.update(relativePath);
    manifest.update('\0');
    manifest.update(source);
    manifest.update('\0');
  }

  return { language: 'ts', size, fileCount, symbolCount: fileCount * symbolsPerFile, manifestHash: manifest.digest('hex') };
}

export async function generateJavaSymbolCorpus(rootDir, size) {
  const fileCount = size === 'large' ? 10_000 : 1_000;
  const packageCount = 20;
  const symbolsPerRegularFile = 25;
  await rm(rootDir, { recursive: true, force: true });
  await mkdir(rootDir, { recursive: true });

  const manifest = createHash('sha256');
  let symbolCount = 0;
  for (let index = 0; index < fileCount; index += 1) {
    const packageName = `bench.p${index % packageCount}`;
    let relativePath;
    let source;
    let fileSymbols = 0;

    if (index === 0) {
      relativePath = join(...packageName.split('.'), 'package-info.java');
      source = `package ${packageName};\n`;
      fileSymbols = 1;
    } else if (index === 1) {
      relativePath = 'module-info.java';
      source = `module bench.module {\n  exports bench.p0;\n}\n`;
      fileSymbols = 1;
    } else {
      const className = `BenchmarkFile${index}`;
      const fields = Array.from({ length: index === 2 ? 52 : 2 }, (_, fieldIndex) => `  private final String field${fieldIndex} = "f${index}_${fieldIndex}";`).join('\n');
      const getters = `  public String serviceMethod${index}(String input) {\n    String local = input + field0;\n    return local;\n  }`;
      const overloads = `  public int process(int value) {\n    return value + ${index};\n  }\n\n  public String process(String value) {\n    return value + field4;\n  }`;
      const enumMembers = ['FIRST', 'SECOND', 'THIRD'].map((name) => `    ${name}`).join(',\n');
      source = `package ${packageName};\n\npublic class ${className} {\n${fields}\n\n  public ${className}(String seed) {\n    seed.length();\n  }\n\n${getters}\n\n${overloads}\n\n  interface Contract {\n    String execute(String value);\n  }\n\n  enum Choice {\n${enumMembers}\n  }\n\n  record Pair(String left, String right) {\n    Pair { }\n  }\n\n  @interface Marker {\n    String value();\n  }\n}\n`;
      relativePath = `file-${index}.java`;
      fileSymbols = symbolsPerRegularFile + (index === 2 ? 50 : 0);
    }

    await mkdir(dirname(join(rootDir, relativePath)), { recursive: true });
    await writeFile(join(rootDir, relativePath), source, 'utf8');
    manifest.update(relativePath.replace(/\\/g, '/'));
    manifest.update('\0');
    manifest.update(source);
    manifest.update('\0');
    symbolCount += fileSymbols;
  }

  const regularFileCount = fileCount - 2;
  return {
    language: 'java',
    size,
    fileCount,
    symbolCount,
    familyCounts: {
      compilation_unit: fileCount,
      type: regularFileCount * 5,
      callable: regularFileCount * 7,
      member: regularFileCount * 6 + 50,
      binding: regularFileCount * 6,
    },
    manifestHash: manifest.digest('hex'),
  };
}
