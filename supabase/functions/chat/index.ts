import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const lovableKey  = Deno.env.get("LOVABLE_API_KEY")!;

  // ── Auth ────────────────────────────────────────────────────────────────────
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

  const { question, conversation_id } = await req.json();
  if (!question) {
    return new Response(JSON.stringify({ error: "question is required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    // ── 1. RAG retrieval ───────────────────────────────────────────────────────
    const keywords = question
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w: string) =>
        w.length > 2 &&
        !["the","and","for","are","was","that","with","this","have","from","not","what","how","who","when","where","which"].includes(w)
      );

    type RagChunk = { id: string; chunk_index: number; content: string; metadata: Record<string, unknown> };
    let chunks: RagChunk[] = [];

    if (keywords.length > 0) {
      const filter = keywords.slice(0, 5).map((k: string) => `content.ilike.%${k}%`).join(",");
      const { data, error } = await adminClient
        .from("rag_chunks")
        .select("id, chunk_index, content, metadata")
        .eq("doc_id", "csv-kb")
        .or(filter)
        .limit(12);

      if (error) throw new Error(error.message);

      const scored = (data ?? []).map((c) => {
        const lower = c.content.toLowerCase();
        const score = keywords.filter((k: string) => lower.includes(k)).length;
        return { ...c, score };
      });
      scored.sort((a, b) => b.score - a.score);
      chunks = scored.slice(0, 6);
    }

    if (chunks.length === 0) {
      const { data } = await adminClient
        .from("rag_chunks")
        .select("id, chunk_index, content, metadata")
        .eq("doc_id", "csv-kb")
        .limit(6);
      chunks = data ?? [];
    }

    const hasContext = chunks.length > 0;

    // ── 2. Build prompt ────────────────────────────────────────────────────────
    let contextBlock = "";
    if (hasContext) {
      contextBlock = chunks
        .map((c) => {
          const rowNum = (c.metadata?.row_number as number | undefined) ?? c.chunk_index + 2;
          return `[Row ${rowNum}]\n${c.content}`;
        })
        .join("\n\n");
    }

    const systemPrompt = hasContext
      ? `You are a precise data assistant. Answer the user's question using ONLY the data rows provided below.
- Cite every row you use in the format [Row N] — e.g. "The value is X [Row 5]."
- If multiple rows are relevant, cite all of them.
- If the answer cannot be found in the provided rows, say: "I don't have that information in the current knowledge base."
- Never make up information.`
      : `You are a helpful assistant. No knowledge base has been synced yet. Let the user know they should ask the admin to upload a CSV first.`;

    const userPrompt = hasContext
      ? `Data rows:\n${contextBlock}\n\nQuestion: ${question}`
      : question;

    // ── 3. Citations metadata ──────────────────────────────────────────────────
    const citations = hasContext
      ? chunks.map((c, i) => ({
          chunk_id: c.id,
          chunk_index: c.chunk_index,
          excerpt: c.content.slice(0, 250),
          row_number: (c.metadata?.row_number as number | undefined) ?? c.chunk_index + 2,
          reference: i + 1,
        }))
      : [];

    // ── 4. Call LLM with streaming ─────────────────────────────────────────────
    const llmRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        stream: true,
      }),
    });

    if (!llmRes.ok) {
      const status = llmRes.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`LLM error (${status}): ${await llmRes.text()}`);
    }

    // ── 5. Collect full answer first, then stream back ─────────────────────────
    // Read the entire LLM stream synchronously so we can persist before responding.
    const llmReader = llmRes.body!.getReader();
    const dec = new TextDecoder();
    let rawBuffer = "";
    let fullAnswer = "";

    while (true) {
      const { done, value } = await llmReader.read();
      if (done) break;
      rawBuffer += dec.decode(value, { stream: true });

      let nl: number;
      while ((nl = rawBuffer.indexOf("\n")) !== -1) {
        let line = rawBuffer.slice(0, nl);
        rawBuffer = rawBuffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (delta) fullAnswer += delta;
        } catch { /* partial JSON */ }
      }
    }

    // ── 6. Persist the assistant message ──────────────────────────────────────
    if (conversation_id && user?.id && fullAnswer) {
      await adminClient.from("messages").insert({
        conversation_id,
        user_id: user.id,
        role: "assistant",
        content: fullAnswer,
        citations,
      });
    }

    // ── 7. Stream the answer back as SSE so the client renders tokens live ─────
    // We simulate streaming from the collected answer by chunking it in 6-char pieces.
    const encoder = new TextEncoder();

    // Send citations event first
    const citationsLine = `event: citations\ndata: ${JSON.stringify(citations)}\n\n`;

    // Chunk the answer into small pieces to simulate streaming
    const chunkSize = 6;
    const answerChunks: string[] = [];
    for (let i = 0; i < fullAnswer.length; i += chunkSize) {
      answerChunks.push(fullAnswer.slice(i, i + chunkSize));
    }

    const stream = new ReadableStream({
      async start(controller) {
        // Send citations preamble
        controller.enqueue(encoder.encode(citationsLine));

        // Stream answer chunks
        for (const chunk of answerChunks) {
          const payload = JSON.stringify({ choices: [{ delta: { content: chunk } }] });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          // Small delay to make streaming visible in the UI
          await new Promise((r) => setTimeout(r, 8));
        }

        // SSE done signal
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
