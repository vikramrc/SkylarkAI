import { MongoClient, type Db } from 'mongodb';
import mongoose from 'mongoose';
import type { Connection } from 'mongoose';

export interface PhoenixMongoConnectionConfig {
    uri: string;
    dbName?: string;
}

let persistenceConnectionPromise: Promise<Connection> | null = null;
let queryDbPromise: Promise<Db> | null = null;
let queryClient: MongoClient | null = null;
let queryDb: Db | null = null;

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
    return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

export function getPersistenceMongoConfig(): PhoenixMongoConnectionConfig {
    const uri = firstNonEmpty(
        process.env.SKYLARK_MONGODB_URI,
        process.env.SKYLARK_PERSISTENCE_MONGODB_URI,
    ) ?? 'mongodb://localhost:27017/SkylarkDB';

    return { uri };
}

export function getQueryMongoConfig(): PhoenixMongoConnectionConfig {
    const uri = firstNonEmpty(
        process.env.PHOENIX_QUERY_MONGODB_URI,
        process.env.PHOENIX_SOURCE_MONGODB_URI,
        process.env.PHOENIX_MONGO_URI,
        process.env.PHOENIX_SOURCE_MONGO_URI,
    ) ?? 'mongodb://localhost:27017/SkylarkDB';
    const dbName = firstNonEmpty(
        process.env.PHOENIX_QUERY_MONGODB_DB_NAME,
        process.env.PHOENIX_SOURCE_MONGODB_DB_NAME,
        process.env.PHOENIX_MONGO_DB_NAME,
        process.env.PHOENIX_SOURCE_MONGO_DB_NAME,
    );

    return dbName ? { uri, dbName } : { uri };
}

export async function connectPersistenceMongo(): Promise<Connection> {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
        return mongoose.connection;
    }

    if (!persistenceConnectionPromise) {
        const { uri, dbName } = getPersistenceMongoConfig();

        persistenceConnectionPromise = mongoose.connect(uri, {
            serverSelectionTimeoutMS: 2_000,
            ...(dbName ? { dbName } : {}),
        }).then((instance) => instance.connection);

        persistenceConnectionPromise.catch(() => {
            persistenceConnectionPromise = null;
        });
    }

    return persistenceConnectionPromise;
}

export function getPersistenceMongo(): Connection {
    if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
        throw new Error('Persistence Mongo not connected');
    }

    return mongoose.connection;
}

export function getPersistenceMongoDb(): Db {
    const connection = getPersistenceMongo();

    if (!connection.db) {
        throw new Error('Persistence Mongo database handle is not available');
    }

    return connection.db;
}

export async function connectQueryMongo(): Promise<Db> {
    if (queryDb) {
        return queryDb;
    }

    if (!queryDbPromise) {
        const { uri, dbName } = getQueryMongoConfig();
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2_000 });

        queryDbPromise = client.connect()
            .then((connectedClient) => {
                queryClient = connectedClient;
                queryDb = dbName ? connectedClient.db(dbName) : connectedClient.db();
                return queryDb;
            })
            .catch(async (error) => {
                queryDbPromise = null;
                queryDb = null;
                queryClient = null;
                await client.close().catch(() => undefined);
                throw error;
            });
    }

    return queryDbPromise;
}

export function getQueryMongoDb(): Db {
    if (!queryDb) {
        throw new Error('Query Mongo not connected');
    }

    return queryDb;
}

export const connectMongo = connectPersistenceMongo;
export const getMongo = getPersistenceMongo;
export const getMongoDb = getPersistenceMongoDb;