import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function embed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`Embedding failed (${res.status}): ${await res.text()}`);
  const { data } = await res.json();
  return data[0].embedding as number[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const lovableKey  = Deno.env.get("LOVABLE_API_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { question } = await req.json();
  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Embed the question
    const queryEmbedding = await embed(question, lovableKey);

    // 2. Retrieve top-6 matching row chunks
    const { data: chunks, error: matchErr } = await adminClient.rpc("match_chunks", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
      match_threshold: 0.25,
      match_count: 6,
    });
    if (matchErr) throw new Error(matchErr.message);

    const hasContext = chunks && chunks.length > 0;

    // 3. Build context block with row numbers
    type Chunk = { id: string; chunk_index: number; content: string; metadata: Record<string, unknown>; similarity: number };
    let contextBlock = "";
    if (hasContext) {
      contextBlock = (chunks as Chunk[])
        .map((c) => {
          const rowNum = (c.metadata?.row_number as number | undefined) ?? c.chunk_index + 2;
          return `[Row ${rowNum}]\n${c.content}`;
        })
        .join("\n\n");
    }

    // 4. Prompt
    const systemPrompt = hasContext
      ? `You are a precise data assistant. Answer the user's question using ONLY the data rows provided below.
- Cite every row you use in the format [Row N] — e.g. "Alice is 30 years old [Row 2]."
- If multiple rows are relevant, cite all of them.
- If the answer cannot be found in the provided rows, respond with: "I don't have that information in the current knowledge base."
- Never make up information.`
      : `You are a helpful assistant. No knowledge base has been synced yet. Let the user know they should ask the admin to upload a CSV first.`;

    const userPrompt = hasContext
      ? `Data rows:\n${contextBlock}\n\nQuestion: ${question}`
      : question;

    // 5. LLM call
    const llmRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
      }),
    });

    if (!llmRes.ok) {
      const status = llmRes.status;
      if (status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
      if (status === 402) throw new Error("AI usage limit reached. Please add credits.");
      throw new Error(`LLM error (${status}): ${await llmRes.text()}`);
    }

    const llmJson = await llmRes.json();
    const answer = llmJson.choices[0].message.content as string;

    // 6. Build citation objects
    const citations = hasContext
      ? (chunks as Chunk[]).map((c, i) => ({
          chunk_id: c.id,
          chunk_index: c.chunk_index,
          excerpt: c.content.slice(0, 250),
          row_number: (c.metadata?.row_number as number | undefined) ?? c.chunk_index + 2,
          reference: i + 1,
          similarity: Math.round(c.similarity * 100),
        }))
      : [];

    return new Response(JSON.stringify({ answer, citations }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
