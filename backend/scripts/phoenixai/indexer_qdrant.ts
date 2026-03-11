import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

type Document = {
  pageContent: string;
  metadata: Record<string, any>;
};

// Qdrant configuration
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined;
const COLLECTION_NAME = process.env.INDEX_NAME_MAIN_RAG || "vector_index";

function getQdrantClient() {
  return new QdrantClient({
    url: QDRANT_URL,
    ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
  });
}

function splitIntoChunks(text: string): string[] {
  const norm = text.replace(/\r\n/g, "\n");
  const parts = norm.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const p of parts) {
    if (p.length <= 2000) chunks.push(p);
    else {
      const sentences = p.split(/(?<=[。！？\.!?\n])/g);
      let current = "";
      for (const s of sentences) {
        if ((current + " " + s).length > 1800) {
          chunks.push(current.trim());
          current = s;
        } else current = (current + " " + s).trim();
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }
  return chunks;
}

async function loadJSON(file: string) {
  return JSON.parse(fs.readFileSync(path.join("seed", file), {encoding:"utf8"}));
}

async function run() {
  console.log(`[indexer_qdrant] Starting Qdrant indexing...`);
  console.log(`[indexer_qdrant] Qdrant URL: ${QDRANT_URL}`);
  console.log(`[indexer_qdrant] Collection: ${COLLECTION_NAME}`);

  const embeddingsModel = "text-embedding-3-small";
  console.log(`[indexer_qdrant] Using embeddings model: ${embeddingsModel}`);
  const embeddings = new OpenAIEmbeddings({ model: embeddingsModel });

  // Initialize Qdrant client
  const client = getQdrantClient();

  // Drop and recreate collection in Qdrant
  try {
    // Try to delete existing collection
    try {
      await client.deleteCollection(COLLECTION_NAME);
      console.log(`[indexer_qdrant] Deleted existing collection: ${COLLECTION_NAME}`);
    } catch (e: any) {
      console.log(`[indexer_qdrant] Collection doesn't exist or delete failed (OK): ${e?.message || e}`);
    }

    // Create fresh collection
    await client.createCollection(COLLECTION_NAME, {
      vectors: {
        size: 1536, // text-embedding-3-small dimensions
        distance: "Cosine",
      },
    });
    console.log(`[indexer_qdrant] Created collection: ${COLLECTION_NAME}`);
  } catch (e) {
    console.error(`[indexer_qdrant] Failed to setup collection:`, e);
    throw e;
  }

  // Index mapping_rules (revised)
  const mappingDocs = await loadJSON("mapping_rules_revised.json");
  console.log(`[indexer_qdrant] mapping_rules_revised docs: ${mappingDocs.length}`);

  let totalChunks = 0;
  for (const doc of mappingDocs) {
    const { doc_type, tenant_id, version, payload } = doc;
    const canonicalId = `canonical_${doc_type}_${tenant_id}_${version}_${Date.now()}`;

    const chunks: Document[] = [];
    for (const rule of Array.isArray(payload) ? payload : []) {
      const questions: string[] = Array.isArray(rule.sample_questions) ? rule.sample_questions : [];
      const keywords: string[] = Array.isArray(rule.keywords) ? rule.keywords : [];
      const targetCollections: string[] = Array.isArray(rule.maps_to)
        ? (rule.maps_to.map((m: any) => m && m.collection).filter((c: any) => !!c))
        : [];

      // per-question chunks, lowercased for consistent intent narrowing
      for (const q of questions) {
        const qt = (typeof q === "string" ? q.toLowerCase().trim() : "");
        if (!qt) continue;
        chunks.push({
          pageContent: qt,
          metadata: { doc_type, tenant_id, canonicalId, section_type: "sample_question", intent: rule.intent, target_collections: targetCollections }
        });
      }

      // per-keyword chunks (as-authored), dedup within rule
      const kwSet = new Set<string>(keywords.filter(k => typeof k === "string" && k.trim().length > 0));
      for (const kw of kwSet) {
        chunks.push({
          pageContent: `keyword: ${kw}`,
          metadata: { doc_type, tenant_id, canonicalId, section_type: "keyword", intent: rule.intent, target_collections: targetCollections }
        });
      }
    }

    console.log(`[indexer_qdrant] mapping_rules_revised chunks: ${chunks.length}`);

    // Batch upload in chunks of 100 to avoid payload size limits
    const BATCH_SIZE = 100;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      // Generate embeddings for this batch
      const batchTexts = batch.map(doc => doc.pageContent);
      const batchEmbeddings = await embeddings.embedDocuments(batchTexts);

      // Prepare points for Qdrant
      const points = batch.flatMap((doc, idx) => {
        const vector = batchEmbeddings[idx];
        if (!vector) {
          return [];
        }

        return [{
          id: randomUUID(),
          vector,
          payload: {
            pageContent: doc.pageContent,
            ...doc.metadata
          }
        }];
      });

      // Upload to Qdrant
      await client.upsert(COLLECTION_NAME, {
        wait: true,
        points: points
      });

      console.log(`[indexer_qdrant] Uploaded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (${batch.length} docs)`);
    }
    totalChunks += chunks.length;
  }

  console.log(`[indexer_qdrant] Indexing complete. Total chunks indexed: ${totalChunks}`);
}

run().catch(console.error);

