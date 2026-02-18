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

    // ── 3. Citations (pre-built, sent in the SSE preamble) ─────────────────────
    const citations = hasContext
      ? chunks.map((c, i) => ({
          chunk_id: c.id,
          chunk_index: c.chunk_index,
          excerpt: c.content.slice(0, 250),
          row_number: (c.metadata?.row_number as number | undefined) ?? c.chunk_index + 2,
          reference: i + 1,
        }))
      : [];

    // ── 4. Stream from LLM ─────────────────────────────────────────────────────
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

    // ── 5. Pipe SSE through a TransformStream, collect full answer, then persist ─
    let fullAnswer = "";

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Send citations as the very first SSE event so the client can display them
    // before any tokens arrive.
    const citationsEvent = `event: citations\ndata: ${JSON.stringify(citations)}\n\n`;
    await writer.write(encoder.encode(citationsEvent));

    // Read the upstream LLM stream, forward each line, and accumulate the answer.
    (async () => {
      try {
        const reader = llmRes.body!.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });

          let newlineIdx: number;
          while ((newlineIdx = textBuffer.indexOf("\n")) !== -1) {
            let line = textBuffer.slice(0, newlineIdx);
            textBuffer = textBuffer.slice(newlineIdx + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);

            // Forward the raw line to the client
            await writer.write(encoder.encode(line + "\n"));

            // Also accumulate the answer text
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const parsed = JSON.parse(line.slice(6));
                const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
                if (delta) fullAnswer += delta;
              } catch { /* partial JSON – skip */ }
            }
          }
        }

        // Flush remaining buffer
        if (textBuffer.trim()) {
          await writer.write(encoder.encode(textBuffer + "\n"));
        }

        // ── 6. Persist the completed assistant message to DB ─────────────────
        if (conversation_id && user?.id && fullAnswer) {
          await adminClient.from("messages").insert({
            conversation_id,
            user_id: user.id,
            role: "assistant",
            content: fullAnswer,
            citations,
          });
        }
      } catch (e) {
        console.error("stream error:", e);
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
