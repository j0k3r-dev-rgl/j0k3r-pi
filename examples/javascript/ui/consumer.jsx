/**
 * JSX consumer fixture using a jsconfig path alias and JSX reads.
 */

import { DefaultPanel, ViewWidget } from '@fixtures/ui';

export function renderDashboard() {
  return (
    <main>
      <ViewWidget title="Dashboard" />
      <DefaultPanel label="Summary" />
    </main>
  );
}
