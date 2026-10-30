// -----------------------------------------------------------------------------
// The fake OpenProject of the tests answers the queries of the integration as
// the real server did: each captured query (path and answer of
// openproject/openproject:16, 30/10/2026) is replayed on the fake built from
// the same data, and both answers must agree on the totals, the group counts
// and the work packages, in order.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY, FakeOpenProject, fixture } from './helpers/fakeOpenProject.js';

const authorization = `Basic ${Buffer.from(`apikey:${API_KEY}`).toString('base64')}`;

const essentials = (body) => ({
  total: body.total,
  count: body.count,
  groups: (body.groups ?? []).map((group) => [
    group.value,
    group.count,
    group._links.valueLink[0].href,
  ]),
  elements: (body._embedded?.elements ?? []).map((item) => ({
    id: item.id,
    subject: item.subject,
    due: item.dueDate ?? item.date ?? null,
    project: item._links.project.href,
    status: item._links.status.href,
    assignee: item._links.assignee.href ?? null,
  })),
});

for (const name of ['open-by-project', 'done-today-by-project', 'dated', 'mine']) {
  test(`the fake answers the "${name}" query like the real server`, async () => {
    const captured = fixture(`real-query-${name}`);
    const fake = new FakeOpenProject();
    const response = await fake.handle({
      method: 'GET',
      path: captured.path,
      headers: { authorization },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(essentials(JSON.parse(response.body)), essentials(captured.body));
  });
}
