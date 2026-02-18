import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Minimal RFC 4180-compliant CSV parser */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells.map((c) => c.trim().replace(/^"|"$/g, "")));
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify user
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify admin
  const adminClient = createClient(supabaseUrl, serviceKey);
  const { data: roleData } = await adminClient
    .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (!roleData) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const csv: string = body?.csv ?? "";
  const sourceLabel: string = body?.source_label ?? "csv";

  if (!csv.trim()) {
    return new Response(JSON.stringify({ error: "csv is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Ensure sync_status row exists
  const { data: existingStatus } = await adminClient.from("sync_status").select("id").maybeSingle();
  let statusId: string;
  if (existingStatus) {
    statusId = existingStatus.id;
    await adminClient.from("sync_status").update({ status: "syncing", error_message: null }).eq("id", statusId);
  } else {
    const { data: ns } = await adminClient.from("sync_status")
      .insert({ status: "syncing", error_message: null }).select("id").single();
    statusId = ns!.id;
  }

  try {
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new Error("CSV must have at least a header row and one data row.");

    const headers = rows[0];
    const dataRows = rows.slice(1);
    const DOC_ID = "csv-kb";

    // Delete previous chunks for this source
    await adminClient.from("rag_chunks").delete().eq("doc_id", DOC_ID);

    let indexed = 0;
    // Insert in batches of 50
    const batch: object[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (row.every((v) => !v)) continue; // skip empty rows

      // Build text: "Header: Value; Header: Value; …"
      const text = headers
        .map((h, ci) => `${h}: ${row[ci] ?? ""}`)
        .filter((pair) => !pair.endsWith(": "))
        .join("; ");

      if (!text.trim()) continue;

      batch.push({
        doc_id: DOC_ID,
        chunk_index: i,
        content: text,
        // No embedding — using full-text search for retrieval
        token_count: Math.ceil(text.length / 4),
        metadata: {
          source: sourceLabel,
          row_number: i + 2, // 1-based, accounting for header row
          headers,
        },
      });
      indexed++;

      if (batch.length === 50) {
        const { error } = await adminClient.from("rag_chunks").insert([...batch]);
        if (error) throw new Error(error.message);
        batch.length = 0;
      }
    }

    // Insert remaining
    if (batch.length > 0) {
      const { error } = await adminClient.from("rag_chunks").insert([...batch]);
      if (error) throw new Error(error.message);
    }

    await adminClient.from("sync_status").update({
      status: "done",
      chunk_count: indexed,
      last_synced_at: new Date().toISOString(),
      doc_title: sourceLabel,
      error_message: null,
    }).eq("id", statusId);

    return new Response(JSON.stringify({ chunk_count: indexed, row_count: dataRows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await adminClient.from("sync_status").update({ status: "error", error_message: msg }).eq("id", statusId);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
