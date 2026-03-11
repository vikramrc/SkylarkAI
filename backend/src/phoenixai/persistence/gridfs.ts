import { Readable } from 'node:stream';
import { GridFSBucket, ObjectId } from 'mongodb';
import type { Document } from 'mongodb';
import { getPersistenceMongoDb } from './mongodb.js';

const buckets = new Map<string, GridFSBucket>();

export interface GridFSUploadResult {
    fileId: string;
    filename: string;
    contentType: string;
    bucketName: string;
    metadata: Record<string, unknown>;
}

function toObjectId(fileId: string): ObjectId {
    return new ObjectId(String(fileId));
}

export function getGridFSBucket(bucketName = 'fs'): GridFSBucket {
    const existingBucket = buckets.get(bucketName);

    if (existingBucket) {
        return existingBucket;
    }

    const bucket = new GridFSBucket(getPersistenceMongoDb(), { bucketName });
    buckets.set(bucketName, bucket);
    return bucket;
}

export async function uploadJSONToGridFS(
    data: unknown,
    filename: string,
    metadata: Record<string, unknown> = {},
    bucketName = 'fs',
): Promise<GridFSUploadResult> {
    const bucket = getGridFSBucket(bucketName);
    const uploadMetadata = {
        ...metadata,
        uploadedAt: new Date(),
        dataType: 'json',
    };

    return new Promise((resolve, reject) => {
        const uploadStream = bucket.openUploadStream(filename, {
            metadata: uploadMetadata,
        });

        uploadStream.on('error', reject);
        uploadStream.on('finish', () => {
            resolve({
                fileId: String(uploadStream.id),
                filename,
                contentType: 'application/json',
                bucketName,
                metadata: uploadMetadata,
            });
        });

        Readable.from([Buffer.from(JSON.stringify(data))]).pipe(uploadStream);
    });
}

export async function downloadJSONFromGridFS<T = unknown>(fileId: string, bucketName = 'fs'): Promise<T> {
    const bucket = getGridFSBucket(bucketName);
    const downloadStream = bucket.openDownloadStream(toObjectId(fileId));

    return new Promise<T>((resolve, reject) => {
        const chunks: Buffer[] = [];

        downloadStream.on('data', (chunk: Uint8Array) => {
            chunks.push(Buffer.from(chunk));
        });

        downloadStream.on('error', reject);

        downloadStream.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');

                try {
                    resolve(JSON.parse(text) as T);
                    return;
                } catch {
                    const jsonLines = text
                        .split(/\r?\n/)
                        .filter(Boolean)
                        .map((line) => {
                            try {
                                return JSON.parse(line) as Document;
                            } catch {
                                return null;
                            }
                        })
                        .filter((entry): entry is Document => entry !== null);

                    resolve(jsonLines as T);
                }
            } catch (error) {
                reject(error);
            }
        });
    });
}

export async function fileExistsInGridFS(fileId: string, bucketName = 'fs'): Promise<boolean> {
    try {
        const bucket = getGridFSBucket(bucketName);
        const files = await bucket.find({ _id: toObjectId(fileId) }).toArray();
        return files.length > 0;
    } catch {
        return false;
    }
}

export async function deleteFileFromGridFS(fileId: string, bucketName = 'fs'): Promise<boolean> {
    try {
        const bucket = getGridFSBucket(bucketName);
        await bucket.delete(toObjectId(fileId));
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to delete GridFS file ${fileId}: ${message}`);
        return false;
    }
}