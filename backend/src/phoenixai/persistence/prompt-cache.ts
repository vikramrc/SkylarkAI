import mongoose, { Schema, type Document } from 'mongoose';
import { connectPersistenceMongo } from './mongodb.js';

export interface IPromptCache extends Document {
    key: string;            // Hash of purpose + specific configuration
    purpose: string;
    responseId: string;
    uses: number;
    maxUses: number;
    expiresAt: Date;
    promptHash: string;     // SHA256 of the system prompt text
    createdAt: Date;
    updatedAt: Date;
}

const PromptCacheSchema: Schema = new Schema({
    key: { type: String, required: true, unique: true, index: true },
    purpose: { type: String, required: true },
    responseId: { type: String, required: true },
    uses: { type: Number, default: 0 },
    maxUses: { type: Number, default: 5 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }, // Mongo TTL index
    promptHash: { type: String, required: true },
}, { timestamps: true });

// Avoid model recompilation error in dev/watch mode
export const PromptCacheModel = mongoose.models.PromptCache || mongoose.model<IPromptCache>('PromptCache', PromptCacheSchema);

/**
 * Retrieves a valid cached response ID if it exists and matches the prompt hash.
 */
export async function getCachedResponseId(key: string, currentPromptHash: string, purpose?: string, logPrefix: string = '[phx-cache]'): Promise<string | null> {
    try {
        await connectPersistenceMongo();
        const cached = await PromptCacheModel.findOne({ key });

        if (!cached) {
            console.log(`${logPrefix} Cache MISS for ${key} (uses: 0/5) -> Proceeding to generate... (purpose: ${purpose ?? 'unknown'})`);
            return null;
        }

        // Invalidate if the system prompt definition has changed
        if (cached.promptHash !== currentPromptHash) {
            console.log(`${logPrefix} Cache INVALIDATED for ${key}: static prompt logic changed`);
            await PromptCacheModel.deleteOne({ _id: cached._id }).catch(() => {});
            return null;
        }

        // Invalidate if max uses reached
        if (cached.uses >= cached.maxUses) {
            console.log(`${logPrefix} Cache EXPIRED for ${key}: reached max uses (${cached.uses}/${cached.maxUses})`);
            await PromptCacheModel.deleteOne({ _id: cached._id }).catch(() => {});
            return null;
        }

        // Invalidate if expired (Mongo TTL might not have cleaned it yet)
        if (cached.expiresAt < new Date()) {
            console.log(`${logPrefix} Cache EXPIRED for ${key}: TTL elapsed`);
            await PromptCacheModel.deleteOne({ _id: cached._id }).catch(() => {});
            return null;
        }

        // Increment uses
        cached.uses += 1;
        await cached.save().catch((err: any) => console.warn(`${logPrefix} Failed to increment use count:`, err));

        console.log(`${logPrefix} Cache HIT for ${key} (uses: ${cached.uses}/${cached.maxUses}) -> responseId: ${cached.responseId}`);

        return cached.responseId;
    } catch (error) {
        console.warn('[phx-cache] Silent failure in getCachedResponseId (skipping cache):', error);
        return null;
    }
}

/**
 * Saves or updates a cached response ID with a 30-minute TTL.
 */
export async function saveCachedResponseId(
    key: string,
    responseId: string,
    promptHash: string,
    purpose: string,
    maxUses: number = 5,
    logPrefix: string = '[phx-cache]'
) {
    try {
        if (!responseId) return;

        await connectPersistenceMongo();
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

        const result = await PromptCacheModel.findOneAndUpdate(
            { key },
            {
                responseId,
                promptHash,
                purpose,
                uses: 1, // Start at 1 since this is the first use (the one that generated the ID)
                maxUses,
                expiresAt
            },
            { upsert: true, returnDocument: 'after' }
        );

        if (result) {
            console.log(`${logPrefix} PERSISTED responseId ${responseId} (uses: 1/${maxUses}) for key ${key} (purpose: ${purpose})`);
        }
    } catch (error) {
        console.warn(`${logPrefix} Silent failure in saveCachedResponseId:`, error);
    }
}
/**
 * Saves a static (non-user-specific) cached response ID with a very long TTL.
 * Use this for shared static prompts like `keyword_extraction` and `ambiguity`
 * that are NOT scoped to a specific user or session.
 *
 * TTL: 30 days. MaxUses: 10,000 (effectively permanent until the prompt changes).
 */
export async function saveStaticCachedResponseId(
    key: string,
    responseId: string,
    promptHash: string,
    purpose: string,
    logPrefix: string = '[phx-cache]'
) {
    try {
        if (!responseId) return;

        await connectPersistenceMongo();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        const result = await PromptCacheModel.findOneAndUpdate(
            { key },
            {
                responseId,
                promptHash,
                purpose,
                uses: 1,
                maxUses: 10000, // effectively unlimited
                expiresAt
            },
            { upsert: true, returnDocument: 'after' }
        );

        if (result) {
            console.log(`${logPrefix} PERSISTED static responseId ${responseId} (30-day TTL, 10000 uses) for key ${key} (purpose: ${purpose})`);
        }
    } catch (error) {
        console.warn(`${logPrefix} Silent failure in saveStaticCachedResponseId:`, error);
    }
}
