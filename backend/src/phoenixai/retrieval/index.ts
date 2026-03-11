import { MongoClient } from 'mongodb';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';

export const PHOENIX_RETRIEVAL_NAMESPACE = 'phoenixai.retrieval';

export interface PhoenixRetrievedItemMetadata extends Record<string, unknown> {
    doc_type?: string;
    canonicalId?: string;
    field_path?: string;
    collection?: string;
    intent?: string;
    target_collections?: string[];
    maps_to?: Array<Record<string, unknown>>;
    synonyms?: string[];
}

export interface PhoenixRetrievedItem {
    text: string;
    score: number;
    metadata: PhoenixRetrievedItemMetadata;
    matched_synonyms?: string[];
}

export interface PhoenixRetrievalResult {
    business_context: PhoenixRetrievedItem[];
    technical_structure_fields: PhoenixRetrievedItem[];
    domain_logic_rules: PhoenixRetrievedItem[];
    mapping_rules: PhoenixRetrievedItem[];
    vector_hits: unknown[];
    allowed_fields_whitelist: string[];
}

type PhoenixSimilarityResult = [{ pageContent?: string; metadata?: unknown; text?: string }, number];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function groupRetrievedResults(
    userQuery: string,
    results: PhoenixSimilarityResult[],
): Omit<PhoenixRetrievalResult, 'vector_hits' | 'allowed_fields_whitelist'> {
    const grouped: Omit<PhoenixRetrievalResult, 'vector_hits' | 'allowed_fields_whitelist'> = {
        business_context: [],
        technical_structure_fields: [],
        domain_logic_rules: [],
        mapping_rules: [],
    };

    for (const [doc, score] of results) {
        const metadata = isRecord(doc.metadata) ? doc.metadata as PhoenixRetrievedItemMetadata : {};
        const docType = String(metadata.doc_type ?? '').toLowerCase();
        let matchedSynonyms: string[] | undefined;

        if (docType === 'technical_structure' && Array.isArray(metadata.synonyms)) {
            const q = userQuery.toLowerCase();
            matchedSynonyms = metadata.synonyms
                .map((synonym) => String(synonym))
                .filter((synonym) => synonym.length > 0 && q.includes(synonym.toLowerCase()));
        }

        const item: PhoenixRetrievedItem = {
            text: String(doc.pageContent ?? doc.text ?? ''),
            score,
            metadata,
            ...(matchedSynonyms && matchedSynonyms.length > 0 ? { matched_synonyms: matchedSynonyms } : {}),
        };

        if (docType === 'business_context') grouped.business_context.push(item);
        else if (docType === 'technical_structure') grouped.technical_structure_fields.push(item);
        else if (docType === 'domain_logic') grouped.domain_logic_rules.push(item);
        else if (docType === 'mapping_rules') grouped.mapping_rules.push(item);
    }

    return grouped;
}

async function retrieveChunksGroupedQdrant(userQuery: string, keywordTerms: string[] = []): Promise<PhoenixRetrievalResult> {
    const { QdrantClient } = await import('@qdrant/js-client-rest');

    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    const qdrantApiKey = process.env.QDRANT_API_KEY || undefined;
    const collectionName = process.env.INDEX_NAME_MAIN_RAG || 'vector_index';
    const topK = Number(process.env.RAG_TOPK || 8);
    const embeddings = new OpenAIEmbeddings({
        model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
    });
    const client = new QdrantClient({
        url: qdrantUrl,
        ...(qdrantApiKey ? { apiKey: qdrantApiKey } : {}),
    });
    const searchTargets = [
        { text: userQuery, type: 'query' as const },
        ...keywordTerms.map((keyword) => ({ text: `keyword: ${keyword}`, type: 'keyword' as const })),
    ];
    const rawResults: Array<Record<string, unknown>> = [];
    const similarityResults: PhoenixSimilarityResult[] = [];

    for (const target of searchTargets) {
        const vector = await embeddings.embedQuery(target.text);
        const searchResults = await client.search(collectionName, {
            vector,
            limit: target.type === 'query' ? topK : 3,
            with_payload: true,
        });

        for (const hit of searchResults) {
            const payload = isRecord(hit.payload) ? hit.payload : {};
            similarityResults.push([{ pageContent: String(payload.pageContent ?? ''), metadata: payload }, Number(hit.score ?? 0)]);
            rawResults.push({ ...payload, score: hit.score });
        }
    }

    const grouped = groupRetrievedResults(userQuery, similarityResults);
    return {
        ...grouped,
        vector_hits: rawResults,
        allowed_fields_whitelist: grouped.technical_structure_fields
            .map((item) => item.metadata.field_path)
            .filter((fieldPath): fieldPath is string => typeof fieldPath === 'string' && fieldPath.length > 0),
    };
}

async function retrieveChunksGroupedMongoDB(userQuery: string, keywordTerms: string[] = []): Promise<PhoenixRetrievalResult> {
    const mongoUri = process.env.MONGODB_ATLAS_URI || '';
    const dbName = process.env.MONGODB_ATLAS_DB_NAME || 'pms_rag';
    const collectionName = process.env.INDEX_NAME_MAIN_RAG || 'vector_index';
    const indexName = process.env.INDEX_NAME_MAIN_RAG || 'vector_index';

    if (!mongoUri) {
        throw new Error('MONGODB_ATLAS_URI is required for vector retrieval');
    }

    const client = new MongoClient(mongoUri);
    await client.connect();

    try {
        const collection = client.db(dbName).collection(collectionName);
        const embeddings = new OpenAIEmbeddings({
            model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
        });
        const topK = Number(process.env.RAG_TOPK || 8);
        const searchTargets = [
            { text: userQuery, type: 'query' as const },
            ...keywordTerms.map((keyword) => ({ text: `keyword: ${keyword}`, type: 'keyword' as const })),
        ];
        const similarityResults: PhoenixSimilarityResult[] = [];
        const rawResults: unknown[] = [];

        for (const target of searchTargets) {
            const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
                // @langchain/mongodb currently resolves its own mongodb types, so cast across the package boundary.
                collection: collection as never,
                indexName,
                textKey: 'text',
                embeddingKey: 'embedding',
            });
            const hits = await vectorStore.similaritySearchWithScore(target.text, target.type === 'query' ? topK : 3);
            similarityResults.push(...(hits as PhoenixSimilarityResult[]));

            const queryVector = await embeddings.embedQuery(target.text);
            const raw = await collection.aggregate([
                {
                    $vectorSearch: {
                        index: indexName,
                        path: 'embedding',
                        queryVector,
                        numCandidates: 200,
                        limit: target.type === 'query' ? topK : 3,
                    },
                },
                { $project: { text: 1, pageContent: 1, metadata: 1, score: { $meta: 'vectorSearchScore' } } },
            ]).toArray();
            rawResults.push(...raw);
        }

        const grouped = groupRetrievedResults(userQuery, similarityResults);
        return {
            ...grouped,
            vector_hits: rawResults,
            allowed_fields_whitelist: grouped.technical_structure_fields
                .map((item) => item.metadata.field_path)
                .filter((fieldPath): fieldPath is string => typeof fieldPath === 'string' && fieldPath.length > 0),
        };
    } finally {
        await client.close();
    }
}

export async function retrieveChunksGrouped(userQuery: string, keywordTerms: string[] = []): Promise<PhoenixRetrievalResult> {
    return process.env.USE_QDRANT_VECTOR_DB === 'true'
        ? retrieveChunksGroupedQdrant(userQuery, keywordTerms)
        : retrieveChunksGroupedMongoDB(userQuery, keywordTerms);
}

export function dedupByCanonical(items: readonly PhoenixRetrievedItem[] | undefined): PhoenixRetrievedItem[] {
    const byCanonical = new Map<string, PhoenixRetrievedItem>();

    for (const item of items ?? []) {
        const canonicalId = String(item.metadata.canonicalId ?? '');
        if (!canonicalId) continue;

        const existing = byCanonical.get(canonicalId);
        if (!existing || item.score > existing.score) {
            byCanonical.set(canonicalId, item);
        }
    }

    return Array.from(byCanonical.values());
}