/**
 * Library-agnostic TSX fixture: local callable exported as the module default.
 */

const DefaultPanel = ({ label }: { label: string }) => {
  return <aside data-kind="panel">{label}</aside>;
};

export default DefaultPanel;
