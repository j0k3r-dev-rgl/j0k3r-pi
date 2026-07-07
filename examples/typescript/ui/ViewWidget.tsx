/**
 * Library-agnostic TSX fixture: exported component-like callable wrapped by an arbitrary helper.
 */

declare function withViewBehavior<T>(value: T): T;

export const ViewWidget = withViewBehavior(({ title }: { title: string }) => {
  return <section data-kind="widget"><h1>{title}</h1></section>;
});
