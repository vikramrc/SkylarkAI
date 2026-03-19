import { client, dbName } from '../graph.js';
import { ObjectId } from 'mongodb';

export interface ChatMessage {
    runId: string;
    userQuery: string;
    assistantResponse: string;
    timestamp: Date;
}

export interface ConversationShell {
    _id: ObjectId;
    userQuery: string;
    status: string;
    deleted: boolean;
    pinned: boolean;
    updatedAt: Date;
    createdAt?: Date;
}

export class ConversationModel {
    private static get db() {
        return client.db(dbName);
    }

    private static get messagesCollection() {
        return this.db.collection<ChatMessage>('conversation_messages');
    }

    private static get shellCollection() {
        return this.db.collection<ConversationShell>('phoenixconversations');
    }

    /**
     * 🟢 Automate Startup Index Setup flawlessly
     */
    static async ensureIndexes(): Promise<void> {
        try {
            await this.messagesCollection.createIndex(
                { userQuery: "text", assistantResponse: "text" },
                { name: "ChatMessageTextIndex", background: true }
            );
        } catch (err) {
            console.error(`[ConversationModel] Index creation failed:`, err);
        }
    }

    /**
     * 🟢 Save turn message pair flawlessly triggers
     */
    static async addMessage(runId: string, userQuery: string, assistantResponse: string): Promise<void> {
        await this.messagesCollection.insertOne({
            runId,
            userQuery,
            assistantResponse,
            timestamp: new Date()
        });
    }

    /**
     * 🟢 Upsert list shell for sidebar continuous listings flaws
     */
    static async upsertShell(runId: string, userQuery: string): Promise<void> {
        if (!ObjectId.isValid(runId)) return;
        
        await this.shellCollection.updateOne(
            { _id: new ObjectId(runId) },
            {
                $set: {
                    userQuery,
                    status: 'completed',
                    deleted: false,
                    pinned: false,
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: new Date()
                }
            },
            { upsert: true }
        );
    }

    /**
     * 🟢 Fetch full message timeline flawlessly
     */
    static async getMessages(runId: string): Promise<ChatMessage[]> {
        return this.messagesCollection
            .find({ runId })
            .sort({ timestamp: 1 })
            .toArray();
    }

    /**
     * 🟢 Search timelines using text index index flaws flawless trigger flawlessly
     */
    static async searchTimeline(query: string): Promise<string[]> {
        const matches = await this.messagesCollection
            .find({ $text: { $search: query } })
            .project({ runId: 1 })
            .toArray();
            
        return Array.from(new Set(matches.map(m => m.runId)));
    }
    /**
     * 🟢 Toggle Pin status on conversation shell flaws
     */
    static async togglePin(runId: string, pinned: boolean): Promise<void> {
        if (!ObjectId.isValid(runId)) return;
        
        await this.shellCollection.updateOne(
            { _id: new ObjectId(runId) },
            { $set: { pinned, updatedAt: new Date() } }
        );
    }

    /**
     * 🟢 Delete conversation shell and messages flawlessly triggers
     */
    static async deleteConversation(runId: string): Promise<void> {
        if (!ObjectId.isValid(runId)) return;
        const id = new ObjectId(runId);
        
        // 1. Delete shell doc flawlessly trigger flawlessly 
        await this.shellCollection.deleteOne({ _id: id });
        
        // 2. Delete messages audit log flaws flawless
        await this.messagesCollection.deleteMany({ runId });
    }
}
