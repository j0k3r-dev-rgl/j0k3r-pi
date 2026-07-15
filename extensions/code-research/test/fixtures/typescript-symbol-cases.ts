export interface TypeScriptSymbolCase {
  id: string;
  file: string;
  source: string;
  expected: Array<{ name: string; declarationKind: string; owner?: string; implementation?: boolean }>;
}

export const TYPESCRIPT_SYMBOL_CASES: TypeScriptSymbolCase[] = [
  {
    id: 'TS-FUNCTION-OVERLOAD-AMBIENT', file: 'functions.d.ts',
    source: `declare function ambient(value: string): void;\nfunction overloaded(value: string): string;\nfunction overloaded(value: number): number;\nfunction overloaded(value: string | number) { return value; }\n`,
    expected: [
      { name: 'ambient', declarationKind: 'function_overload', implementation: false },
      { name: 'overloaded', declarationKind: 'function_overload', implementation: false },
      { name: 'overloaded', declarationKind: 'function', implementation: true },
    ],
  },
  {
    id: 'TS-CLASS-MEMBERS', file: 'class.ts',
    source: `abstract class Box { abstract read(): string; private value?: string; constructor() {} get item() { return this.value; } set item(v: string | undefined) { this.value = v; } static ['make']() { return new BoxImpl(); } }\nclass BoxImpl extends Box { read() { return ''; } }\n`,
    expected: [
      { name: 'read', declarationKind: 'method', owner: 'Box', implementation: false },
      { name: 'value', declarationKind: 'field', owner: 'Box', implementation: false },
      { name: 'constructor', declarationKind: 'constructor', owner: 'Box', implementation: true },
      { name: 'item', declarationKind: 'getter', owner: 'Box', implementation: true },
      { name: 'item', declarationKind: 'setter', owner: 'Box', implementation: true },
      { name: 'make', declarationKind: 'method', owner: 'Box', implementation: true },
    ],
  },
  {
    id: 'TS-INTERFACE-SIGNATURES', file: 'interfaces.ts',
    source: `interface Factory<T> { value?: T; handler: (value: T) => void; run(value: T): void; (value: T): T; new (value: T): Factory<T>; [key: string]: unknown; }\ntype Identifier = string | number;\n`,
    expected: [
      { name: 'Factory', declarationKind: 'interface', implementation: false },
      { name: 'value', declarationKind: 'property', owner: 'Factory', implementation: false },
      { name: 'handler', declarationKind: 'property', owner: 'Factory', implementation: false },
      { name: 'run', declarationKind: 'interface_method', owner: 'Factory', implementation: false },
      { name: 'call', declarationKind: 'call_signature', owner: 'Factory', implementation: false },
      { name: 'new', declarationKind: 'construct_signature', owner: 'Factory', implementation: false },
      { name: '[index]', declarationKind: 'index_signature', owner: 'Factory', implementation: false },
      { name: 'Identifier', declarationKind: 'type_alias', implementation: false },
    ],
  },
  {
    id: 'TS-ENUM-NAMESPACE-ALIASES', file: 'declarations.ts',
    source: `import DefaultThing, * as Things from './things';\nimport { original as renamed } from './things';\nexport { renamed as publicThing };\nexport { original as remoteThing } from './things';\nenum Color { Red, Blue = 2 }\nnamespace Api { export function ping() {} }\ndeclare module 'virtual' { export interface Value {} }\n`,
    expected: [
      { name: 'DefaultThing', declarationKind: 'import_alias' },
      { name: 'Things', declarationKind: 'import_alias' },
      { name: 'renamed', declarationKind: 'import_alias' },
      { name: 'publicThing', declarationKind: 'export_alias' },
      { name: 'remoteThing', declarationKind: 'export_alias' },
      { name: 'Color', declarationKind: 'enum', implementation: true },
      { name: 'Red', declarationKind: 'enum_member', owner: 'Color', implementation: true },
      { name: 'Api', declarationKind: 'namespace', implementation: true },
      { name: 'ping', declarationKind: 'function', owner: 'Api', implementation: true },
      { name: 'virtual', declarationKind: 'module', implementation: false },
    ],
  },
  {
    id: 'TS-BINDINGS-OBJECTS-ASSIGNMENTS', file: 'bindings.ts',
    source: `const first = 1, second = () => 2;\nconst { a, old: renamed = 1, nested: { deep }, ...rest } = source;\nconst [head, , ...tail] = list;\nconst service = { run() {}, callable: () => 1, value: 2, ['literal']: 3, [dynamicName]: 4 };\ntarget = 1; target.value = 2; exports.named = 3; module.exports = { named: 4 };\n`,
    expected: [
      { name: 'first', declarationKind: 'variable' },
      { name: 'second', declarationKind: 'callable_variable' },
      { name: 'a', declarationKind: 'variable' },
      { name: 'renamed', declarationKind: 'variable' },
      { name: 'deep', declarationKind: 'variable' },
      { name: 'rest', declarationKind: 'variable' },
      { name: 'head', declarationKind: 'variable' },
      { name: 'tail', declarationKind: 'variable' },
      { name: 'run', declarationKind: 'object_method', owner: 'service' },
      { name: 'literal', declarationKind: 'object_property', owner: 'service' },
      { name: '[dynamicName]', declarationKind: 'object_property', owner: 'service' },
      { name: 'target', declarationKind: 'assignment' },
      { name: 'value', declarationKind: 'assignment' },
      { name: 'named', declarationKind: 'commonjs_export' },
      { name: 'module.exports', declarationKind: 'commonjs_export' },
      { name: 'named', declarationKind: 'commonjs_export', owner: 'module.exports' },
    ],
  },
  {
    id: 'TS-NAMING-MERGING', file: 'naming.ts',
    source: `export default function() {}\nfunction merged(value: string): void;\nfunction merged(value: unknown) {}\nnamespace merged { export const value = 1; }\ninterface Repeat { one: string }\ninterface Repeat { two: string }\n`,
    expected: [
      { name: 'default', declarationKind: 'function', implementation: true },
      { name: 'merged', declarationKind: 'function_overload', implementation: false },
      { name: 'merged', declarationKind: 'function', implementation: true },
      { name: 'merged', declarationKind: 'namespace', implementation: true },
      { name: 'Repeat', declarationKind: 'interface', implementation: false },
    ],
  },
  {
    id: 'TS-FUNCTION-FORMS', file: 'function-forms.ts',
    source: `export function exported<T>(value: T): T { function nested() { return value; } return nested(); }\nexport default function namedDefault() {}\n`,
    expected: [
      { name: 'exported', declarationKind: 'function', implementation: true },
      { name: 'nested', declarationKind: 'function', implementation: true },
      { name: 'namedDefault', declarationKind: 'function', implementation: true },
    ],
  },
  {
    id: 'TS-CALLABLE-BINDINGS', file: 'callable-bindings.ts',
    source: `const direct = function named() {};\nconst arrow = () => 1, wrapped = (((() => 2) satisfies () => number)!);\nconst callbackConsumer = consume(() => 3);\n`,
    expected: [
      { name: 'direct', declarationKind: 'callable_variable', implementation: true },
      { name: 'arrow', declarationKind: 'callable_variable', implementation: true },
      { name: 'wrapped', declarationKind: 'callable_variable', implementation: true },
      { name: 'callbackConsumer', declarationKind: 'variable', implementation: true },
    ],
  },
  {
    id: 'TS-CLASS-FORMS', file: 'class-forms.ts',
    source: `@sealed export abstract class Generic<T> {}\nexport default class NamedDefault {}\n`,
    expected: [
      { name: 'Generic', declarationKind: 'class', implementation: true },
      { name: 'NamedDefault', declarationKind: 'class', implementation: true },
    ],
  },
  {
    id: 'TS-MERGED-FAMILIES', file: 'merged-families.ts',
    source: `class Joined {}\nnamespace Joined { export const value = 1; }\ninterface Twin { one: string }\nclass Twin { two = 'x'; }\n`,
    expected: [
      { name: 'Joined', declarationKind: 'class', implementation: true },
      { name: 'Joined', declarationKind: 'namespace', implementation: true },
      { name: 'Twin', declarationKind: 'interface', implementation: false },
      { name: 'Twin', declarationKind: 'class', implementation: true },
    ],
  },
  {
    id: 'TS-ANONYMOUS-COMPUTED-PRIVATE', file: 'naming-forms.ts',
    source: `export default class { #secret = 1; ['literal']() {} [dynamicName]() {} }\n`,
    expected: [
      { name: 'default', declarationKind: 'class', implementation: true },
      { name: 'secret', declarationKind: 'field', owner: 'default', implementation: true },
      { name: 'literal', declarationKind: 'method', owner: 'default', implementation: true },
      { name: '[dynamicName]', declarationKind: 'method', owner: 'default', implementation: true },
    ],
  },
  {
    id: 'TSX-COMPONENTS-WRAPPERS', file: 'components.tsx',
    source: `export function View() { return <div />; }\nexport const Arrow = <T,>({ value }: { value: T }) => <span>{String(value)}</span>;\nexport const Wrapped = (((() => <div />) as () => JSX.Element)!);\nexport const NotCallable = consume(() => <div />);\n`,
    expected: [
      { name: 'View', declarationKind: 'function' },
      { name: 'Arrow', declarationKind: 'callable_variable' },
      { name: 'Wrapped', declarationKind: 'callable_variable' },
      { name: 'NotCallable', declarationKind: 'variable' },
    ],
  },
];
