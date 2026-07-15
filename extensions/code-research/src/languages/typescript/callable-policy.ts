import ts from 'typescript';

export interface CallableWrapperConfig {
  callee: string;
  argumentIndex: number;
}

export const DEFAULT_CALLABLE_WRAPPERS: CallableWrapperConfig[] = [];

export function unwrapTransparentTypeScriptExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function isCallableTypeScriptValue(node: ts.Expression | undefined, wrappers: CallableWrapperConfig[] = DEFAULT_CALLABLE_WRAPPERS): boolean {
  if (!node) return false;
  const current = unwrapTransparentTypeScriptExpression(node);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isFunctionDeclaration(current)) return true;
  if (!ts.isCallExpression(current)) return false;
  const calleeName = current.expression.getText();
  const match = wrappers.find((wrapper) => wrapper.callee === calleeName);
  if (!match) return false;
  const candidate = current.arguments[match.argumentIndex];
  return Boolean(candidate && isCallableTypeScriptValue(candidate, wrappers));
}
