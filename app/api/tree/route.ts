import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// No longer need NodeRow or TreeNode types here, as the DB returns the final structure.

function mapDbError(code?: string): number {
  switch (code) {
    case '23505': // unique_violation
      return 409;
    case '23503': // foreign_key_violation
    case '23502': // not_null_violation
    case 'PGRST116': // invalid_range
      return 422;
    default:
      return 500;
  }
}

async function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;

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

// The buildTree function is no longer needed and can be deleted.

export async function GET() {
  try {
    const supabase = await getClient();
    // Call the powerful database function to get the entire tree as JSON.
    const { data, error } = await supabase.rpc('get_full_tree');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // The data is already in the correct hierarchical format.
    return NextResponse.json(data);
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

    // The manual check for parentId is removed. The database constraint handles it.
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
    // This function's code doesn't change, but thanks to `ON DELETE CASCADE`,
    // its behavior is now much more powerful and correct.
    const { id } = (await req.json()) as { id: string };
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('tree_nodes')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      // PGRST116 can happen if the ID doesn't exist
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Node not found' }, { status: 404 });
      }
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
