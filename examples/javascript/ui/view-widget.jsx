/**
 * Library-agnostic JSX fixture: exported component-like callable wrapped by an arbitrary helper.
 */

const withViewBehavior = (value) => value;

export const ViewWidget = withViewBehavior(({ title }) => {
  return <section data-kind="widget"><h1>{title}</h1></section>;
});
