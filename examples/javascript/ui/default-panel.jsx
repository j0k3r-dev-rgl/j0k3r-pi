/**
 * Library-agnostic JSX fixture: local callable exported as the module default.
 */

const DefaultPanel = ({ label }) => {
  return <aside data-kind="panel">{label}</aside>;
};

export default DefaultPanel;
