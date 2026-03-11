import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getPersistenceMongoConfig,
    getQueryMongoConfig,
} from './mongodb.js';

const MONGO_ENV_KEYS = [
    'SKYLARK_MONGODB_URI',
    'SKYLARK_PERSISTENCE_MONGODB_URI',
    'SKYLARK_MONGODB_DB_NAME',
    'SKYLARK_PERSISTENCE_MONGODB_DB_NAME',
    'PHOENIX_QUERY_MONGODB_URI',
    'PHOENIX_SOURCE_MONGODB_URI',
    'PHOENIX_QUERY_MONGODB_DB_NAME',
    'PHOENIX_SOURCE_MONGODB_DB_NAME',
    'MONGODB_URI',
    'MONGO_URI',
    'MONGODB_DB_NAME',
    'MONGO_DB_NAME',
    'DB_NAME',
] as const;

function withEnv(overrides: Record<string, string | undefined>, run: () => void): void {
    const previous = new Map<string, string | undefined>(
        MONGO_ENV_KEYS.map((key) => [key, process.env[key]]),
    );

    for (const key of MONGO_ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) process.env[key] = value;
    }

    try {
        run();
    } finally {
        for (const key of MONGO_ENV_KEYS) {
            const value = previous.get(key);
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

test('mongodb config defaults keep Skylark persistence separate from Phoenix query DB', () => {
    withEnv({}, () => {
        assert.deepEqual(getPersistenceMongoConfig(), {
            uri: 'mongodb://localhost:27017',
            dbName: 'SkylarkDB',
        });
        assert.deepEqual(getQueryMongoConfig(), {
            uri: 'mongodb://localhost:27017/ProductsDB',
        });
    });
});

test('mongodb config honors Skylark-specific persistence env and Phoenix query compatibility env', () => {
    withEnv({
        SKYLARK_MONGODB_URI: 'mongodb://localhost:27017',
        SKYLARK_MONGODB_DB_NAME: 'SkylarkDB',
        MONGODB_URI: 'mongodb://localhost:27017/ProductsDB',
        MONGODB_DB_NAME: 'ProductsDB',
    }, () => {
        assert.deepEqual(getPersistenceMongoConfig(), {
            uri: 'mongodb://localhost:27017',
            dbName: 'SkylarkDB',
        });
        assert.deepEqual(getQueryMongoConfig(), {
            uri: 'mongodb://localhost:27017/ProductsDB',
            dbName: 'ProductsDB',
        });
    });
});

test('mongodb config prefers explicit Phoenix query overrides when provided', () => {
    withEnv({
        MONGODB_URI: 'mongodb://localhost:27017/ProductsDB',
        PHOENIX_QUERY_MONGODB_URI: 'mongodb://localhost:27017/PhoenixReplica',
        PHOENIX_QUERY_MONGODB_DB_NAME: 'PhoenixReplica',
    }, () => {
        assert.deepEqual(getQueryMongoConfig(), {
            uri: 'mongodb://localhost:27017/PhoenixReplica',
            dbName: 'PhoenixReplica',
        });
    });
});