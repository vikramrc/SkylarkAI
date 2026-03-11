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
const COLLECTION_NAME = process.env.INDEX_NAME_PMS_COLLECTIONS || "pms_collections_vector_index";

function getQdrantClient() {
  return new QdrantClient({
    url: QDRANT_URL,
    ...(QDRANT_API_KEY ? { apiKey: QDRANT_API_KEY } : {}),
  });
}

// Seed file path (same as original)
const SEED_FILE = path.join("seed", "pms_collections_vector_schema.json");

type SeedRow = {
  CollectionName: string;
  Synonyms: string[];
  Description: string;
};

async function loadSeed(): Promise<SeedRow[]> {
  const raw = fs.readFileSync(SEED_FILE, { encoding: "utf8" });
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Seed must be an array");
  return data.map((x: any) => ({
    CollectionName: String(x.CollectionName || ""),
    Synonyms: Array.isArray(x.Synonyms)
      ? x.Synonyms.filter((s: any) => typeof s === "string")
      : [],
    Description: String(x.Description || ""),
  }));
}

async function dropCollectionIfExists(client: QdrantClient, collectionName: string) {
  try {
    await client.deleteCollection(collectionName);
    console.log(
      `[indexer_collections:qdrant] Dropped existing collection: ${collectionName}`
    );
  } catch (err: any) {
    const msg = err?.message || err?.toString?.() || String(err);
    // If it's a 404 / not found, just log and continue.
    if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
      console.log(
        `[indexer_collections:qdrant] deleteCollection skipped (not found): ${collectionName}`
      );
    } else {
      console.log(
        `[indexer_collections:qdrant] deleteCollection error (ignored, will recreate):`,
        msg
      );
    }
  }
}

async function run() {
  console.log("[indexer_collections:qdrant] --- START ---");
  console.log(
    `[indexer_collections:qdrant] Using Qdrant URL: ${QDRANT_URL}, collection: ${COLLECTION_NAME}`
  );

  if (!QDRANT_URL) {
    throw new Error(
      "QDRANT_URL or MONGODB_ATLAS_URI must be set to your Qdrant HTTP endpoint (e.g. http://localhost:6333)"
    );
  }

  const client = getQdrantClient();

  // Drop & recreate collection on each run, like the original script
  await dropCollectionIfExists(client, COLLECTION_NAME);

  const embeddingsModel = "text-embedding-3-small";
  console.log(
    `[indexer_collections:qdrant] Using embeddings model: ${embeddingsModel}`
  );
  const embeddings = new OpenAIEmbeddings({ model: embeddingsModel });

  // Load seed
  const items = await loadSeed();
  console.log(`[indexer_collections:qdrant] Seed items: ${items.length}`);

  const docs: Document[] = [];
  for (const item of items) {
    const { CollectionName, Synonyms, Description } = item;
    const syns = Array.from(
      new Set(
        (Synonyms || [])
          .map((s) => (s || "").toString().trim())
          .filter((s) => !!s)
      )
    );

    for (const syn of syns) {
      // Same behavior as original: lowercased content for consistent narrowing
      const page = syn.toLowerCase();
      docs.push({
        pageContent: page,
        metadata: {
          collectionName: CollectionName,
          description: Description,
          synonyms: syns,
          source: "pms_collections_seed",
        },
      });
    }
  }

  console.log(
    `[indexer_collections:qdrant] Prepared docs (per synonym): ${docs.length}`
  );

  if (!docs.length) {
    console.warn(
      "[indexer_collections:qdrant] No documents to index. Exiting early."
    );
    return;
  }

  // Create collection (already done by dropCollectionIfExists, but ensure it exists)
  try {
    await client.createCollection(COLLECTION_NAME, {
      vectors: {
        size: 1536, // text-embedding-3-small dimensions
        distance: "Cosine",
      },
    });
    console.log(`[indexer_collections:qdrant] Created collection: ${COLLECTION_NAME}`);
  } catch (e: any) {
    // Collection might already exist, that's OK
    console.log(`[indexer_collections:qdrant] Collection creation skipped (may already exist): ${e?.message || e}`);
  }

  // Upload all docs to Qdrant
  const tIndex0 = Date.now();

  // Generate embeddings for all documents
  const docTexts = docs.map(doc => doc.pageContent);
  const docEmbeddings = await embeddings.embedDocuments(docTexts);

  // Prepare points for Qdrant
  const points = docs.flatMap((doc, idx) => {
    const vector = docEmbeddings[idx];
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

  console.log(
    `[indexer_collections:qdrant] Indexed ${docs.length} docs into Qdrant in ${
      Date.now() - tIndex0
    } ms`
  );

  console.log("[indexer_collections:qdrant] Indexing complete.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
