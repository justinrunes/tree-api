/* eslint-env jest */

// Set up required environment variables for the test environment.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.com';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'anon-key';

// --- Mock Data ---
// The mock database now uses strings for IDs to match the updated route.
type MockNode = { id: string; label: string; parent_id: string | null };

let nodes: MockNode[] = [];
let nextId = 1; // A simple counter to generate unique string IDs.

// Reset mock data before each test to ensure test isolation.
beforeEach(() => {
  nodes = [{ id: '1', label: 'root', parent_id: null }];
  nextId = 2;
});

// --- Mocks ---

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    from: () => ({
      select: (columns?: string) => {
        if (columns === '*') {
          // GET all nodes.
          return Promise.resolve({ data: [...nodes], error: null });
        }
        // GET a single node by ID (used for parent validation).
        return {
          eq: (_col: string, id: string) => ({
            single: () => {
              const row = nodes.find((n) => n.id === id);
              if (row) {
                return Promise.resolve({ data: { id: row.id }, error: null });
              }
              return Promise.resolve({
                data: null,
                error: { code: 'PGRST116', message: 'No rows found' },
              });
            },
          }),
        };
      },
      insert: ({
        label,
        parent_id,
      }: {
        label: string;
        parent_id: string | null;
      }) => ({
        select: () => ({
          single: () => {
            // Simulate unique constraint violation.
            if (nodes.some((n) => n.label === label)) {
              return Promise.resolve({
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint',
                },
              });
            }
            // Create and add the new node with a string ID.
            const node = { id: (nextId++).toString(), label, parent_id };
            nodes.push(node);
            return Promise.resolve({ data: node, error: null });
          },
        }),
      }),
      delete: () => ({
        eq: (_col: string, id: string) => ({
          select: () => ({
            single: () => {
              const index = nodes.findIndex((n) => n.id === id);
              if (index === -1) {
                return Promise.resolve({
                  data: null,
                  error: { message: 'Not found' },
                });
              }
              const [removed] = nodes.splice(index, 1);
              return Promise.resolve({ data: removed, error: null });
            },
          }),
        }),
      }),
    }),
  }),
}));

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

// Import the route handlers to be tested.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, POST, DELETE: DELETE_NODE } = require('../app/api/tree/route');

// --- Test Suite ---

describe('tree API', () => {
  test('GET /api/tree returns array', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].id).toBe('1'); // Verify the ID is a string.
  });

  test('POST /api/tree inserts node', async () => {
    const label = `test-node-${Date.now()}`;
    const res = await POST(
      new Request('http://localhost/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // parentId is now a string.
        body: JSON.stringify({ parentId: '1', label }),
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(res.headers.get('Location')).toBe(`/api/tree/${data.id}`);
    expect(data.label).toBe(label);
    expect(typeof data.id).toBe('string');
  });

  test('POST /api/tree rejects empty label', async () => {
    const res = await POST(
      new Request('http://localhost/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // parentId is now a string.
        body: JSON.stringify({ parentId: '1', label: '' }),
      }),
    );
    expect(res.status).toBe(422);
  });

  test('POST /api/tree rejects invalid parentId', async () => {
    const label = `test-invalid-parent-${Date.now()}`;
    const res = await POST(
      new Request('http://localhost/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // parentId is now a string.
        body: JSON.stringify({ parentId: '9999', label }),
      }),
    );
    expect(res.status).toBe(422);
  });

  test('POST /api/tree handles conflicts', async () => {
    const label = 'duplicate';
    await POST(
      new Request('http://localhost/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: '1', label }),
      }),
    );
    const res = await POST(
      new Request('http://localhost/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: '1', label }),
      }),
    );
    expect(res.status).toBe(409);
  });

  test('DELETE /api/tree removes node', async () => {
    const label = `test-delete-${Date.now()}`;
    const createRes = await POST(
      new Request('http://localhost/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: null, label }),
      }),
    );
    const created = await createRes.json();

    const deleteRes = await DELETE_NODE(
      new Request('http://localhost/api/tree', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        // The id from the created node is already a string.
        body: JSON.stringify({ id: created.id }),
      }),
    );
    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.id).toBe(created.id);
  });
});
