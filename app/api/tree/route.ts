import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

type NodeRow = {
  id: string;
  label: string;
  parent_id: string | null;
};

type TreeNode = {
  id: string;
  label: string;
  children: TreeNode[];
};

function mapDbError(code?: string): number {
  switch (code) {
    case '23505':
      return 409;
    case '23503':
    case '23502':
    case 'PGRST116':
      return 422;
    default:
      return 500;
  }
}

async function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        list.forEach((c) => cookieStore.set(c.name, c.value, c.options));
      },
    },
  });
}

function buildTree(nodes: NodeRow[]): TreeNode[] {
  // A map for quick lookups of nodes by their ID.
  const nodeMap = new Map<string, TreeNode>();

  // An array to store the root nodes (those without a parent).
  const roots: TreeNode[] = [];

  // First pass: Create a TreeNode for each row and store it in the map.
  // This ensures every node exists in our map before we start linking them.
  for (const row of nodes) {
    nodeMap.set(row.id, {
      id: row.id,
      label: row.label,
      children: [], // Initialize children as an empty array.
    });
  }

  // Second pass: Link children to their parents.
  // We iterate through the original nodes again to access parent_id.
  for (const row of nodes) {
    const node = nodeMap.get(row.id);

    // This should always find a node, but it's good practice to check.
    if (!node) continue;

    if (row.parent_id) {
      // This is a child node. Find its parent in the map.
      const parent = nodeMap.get(row.parent_id);
      if (parent) {
        // Add the current node to its parent's children array.
        parent.children.push(node);
      }
    } else {
      // This is a root node (it has no parent).
      roots.push(node);
    }
  }

  return roots;
}

export async function GET() {
  try {
    const supabase = await getClient();
    const { data, error } = await supabase.from('tree_nodes').select('*');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(buildTree((data ?? []) as NodeRow[]));
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { label, parentId } = (await req.json()) as {
      label: string;
      parentId: string | null;
    };

    if (!label || !label.trim()) {
      return NextResponse.json({ error: 'Label is required' }, { status: 422 });
    }

    const supabase = await getClient();

    if (parentId !== null) {
      const { data: parent, error: parentError } = await supabase
        .from('tree_nodes')
        .select('id')
        .eq('id', parentId)
        .single();
      if (parentError || !parent) {
        return NextResponse.json(
          { error: 'Invalid parentId' },
          { status: 422 },
        );
      }
    }

    const { data, error } = await supabase
      .from('tree_nodes')
      .insert({ label, parent_id: parentId })
      .select()
      .single();
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: mapDbError(error.code) },
      );
    }
    return NextResponse.json(data, {
      status: 201,
      headers: { Location: `/api/tree/${data.id}` },
    });
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = (await req.json()) as { id: string };
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('tree_nodes')
      .delete()
      .eq('id', id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}
