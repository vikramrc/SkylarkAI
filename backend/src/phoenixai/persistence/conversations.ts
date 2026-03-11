import { ObjectId, type Filter, type OptionalId } from 'mongodb';
import { downloadJSONFromGridFS, uploadJSONToGridFS } from './gridfs.js';
import { connectPersistenceMongo, connectQueryMongo, getPersistenceMongoDb } from './mongodb.js';
import { detectDualViewOpportunity } from '../utils/dual-view.js';

export const PHOENIX_CONVERSATIONS_COLLECTION = 'phoenixconversations';

export interface PhoenixResultsRef {
    gridFSFileId?: string;
    fileId?: string;
    _id?: string;
    bucketName?: string;
    [key: string]: unknown;
}

export interface PhoenixConversationDocument {
    _id: ObjectId;
    userQuery: string;
    resolvedQuery?: string;
    status?: string;
    generatedQuery?: unknown;
    selectedIntents?: unknown[];
    targetCollections?: unknown[];
    results?: unknown[];
    resultsRef?: PhoenixResultsRef;
    executionMetadata?: unknown;
    clarifyingQuestions?: unknown[];
    assumptions?: unknown[];
    disambiguationLog?: unknown;
    relatedConversationId?: string;
    pinned?: boolean;
    deleted?: boolean;
    dualViewConfig?: unknown;
    createdAt?: Date;
    updatedAt?: Date;
    [key: string]: unknown;
}

export interface PhoenixConversation {
    conversationId: string;
    userQuery: string;
    originalQuery: string;
    resolvedQuery?: string;
    status?: string;
    generatedQuery?: unknown;
    selectedIntents?: unknown[];
    targetCollections?: unknown[];
    results?: unknown[];
    executionMetadata?: unknown;
    clarifyingQuestions?: unknown[];
    assumptions?: unknown[];
    disambiguationLog?: unknown;
    relatedConversationId?: string;
    isPinned: boolean;
    deleted: boolean;
    createdAt?: Date;
    updatedAt?: Date;
    dualViewConfig?: unknown;
}

export interface ListPhoenixConversationsInput {
    page?: number;
    pageSize?: number;
}

export interface ListPhoenixConversationsResult {
    conversations: PhoenixConversation[];
    total: number;
    page: number;
    pageSize: number;
}

export type PhoenixConversationCreateInput = Omit<OptionalId<PhoenixConversationDocument>, '_id'>;
export type PhoenixConversationPatch = Partial<Omit<PhoenixConversationDocument, '_id' | 'createdAt'>>;

export interface PhoenixReadTimeFormDocument {
    _id?: unknown;
    organizationID?: unknown;
    activityWorkHistoryID?: unknown;
    formTemplateID?: unknown;
    name?: unknown;
    status?: unknown;
    submittedAt?: unknown;
    committedAt?: unknown;
}

export interface PhoenixReadTimeDocumentMetadataDocument {
    _id?: unknown;
    organizationID?: unknown;
}

type PhoenixConversationReadTimeFetchDocuments = (
    collection: string,
    ids: readonly string[],
    projection: Record<string, 1>,
) => Promise<Array<Record<string, unknown>>>;

type PhoenixConversationReadTimeFetchComponentActivitiesByActivityIds = (
    activityIds: readonly string[],
) => Promise<Array<Record<string, unknown>>>;

type PhoenixConversationReadTimeFetchActivityWorkHistoryEventsByActivityWorkHistoryIds = (
    activityWorkHistoryIds: readonly string[],
) => Promise<Array<Record<string, unknown>>>;

export interface PhoenixConversationReadTimeDependencies {
    fetchFormsByActivityWorkHistoryIds(activityWorkHistoryIds: readonly string[]): Promise<PhoenixReadTimeFormDocument[]>;
    fetchDocumentMetadataByIds(documentMetadataIds: readonly string[]): Promise<PhoenixReadTimeDocumentMetadataDocument[]>;
    fetchDocumentsByIds?: PhoenixConversationReadTimeFetchDocuments;
    fetchComponentActivitiesByActivityIds?: PhoenixConversationReadTimeFetchComponentActivitiesByActivityIds;
    fetchActivityWorkHistoryEventsByActivityWorkHistoryIds?: PhoenixConversationReadTimeFetchActivityWorkHistoryEventsByActivityWorkHistoryIds;
    uploadResults: typeof uploadJSONToGridFS;
    updateConversation(id: string, patch: PhoenixConversationPatch): Promise<PhoenixConversation | null>;
    now: () => Date;
}

export interface PhoenixConversationReadTimeResult {
    resultsChanged: boolean;
    persisted: boolean;
}

function getConversationCollection() {
    return getPersistenceMongoDb().collection<PhoenixConversationDocument>(PHOENIX_CONVERSATIONS_COLLECTION);
}

function parseConversationId(id: string): ObjectId {
    if (!ObjectId.isValid(id)) {
        throw Object.assign(new Error(`Invalid conversation id: ${id}`), { status: 400 });
    }

    return new ObjectId(id);
}

function stripUndefinedFields(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function getResultsRefFileId(resultsRef: PhoenixResultsRef | undefined): string | null {
    if (!resultsRef) {
        return null;
    }

    const candidate = resultsRef.gridFSFileId ?? resultsRef._id ?? resultsRef.fileId;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function getBaseCollection(generatedQuery: unknown): string {
    if (typeof generatedQuery !== 'object' || generatedQuery === null) {
        return '';
    }

    const value = Reflect.get(generatedQuery, 'base_collection');
    return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function toObjectIdString(value: unknown): string | null {
    if (value instanceof ObjectId) {
        return value.toHexString();
    }

    return typeof value === 'string' && ObjectId.isValid(value) ? value : null;
}

function getSourceMeta(row: Record<string, unknown>): Record<string, unknown> | null {
    return isRecord(row.sourceMeta) ? row.sourceMeta : null;
}

function getSourceMetaEntities(row: Record<string, unknown>): Record<string, unknown> | null {
    const sourceMeta = getSourceMeta(row);
    return sourceMeta && isRecord(sourceMeta.entities) ? sourceMeta.entities : null;
}

function ensureSourceMeta(row: Record<string, unknown>): { sourceMeta: Record<string, unknown>; entities: Record<string, unknown> } {
    const sourceMeta = getSourceMeta(row) ?? {};
    const entities = isRecord(sourceMeta.entities) ? sourceMeta.entities : {};
    sourceMeta.entities = entities;
    row.sourceMeta = sourceMeta;
    return { sourceMeta, entities };
}

function getActivityWorkHistoryId(row: Record<string, unknown>): string | null {
    return toObjectIdString(getSourceMetaEntities(row)?.activityWorkHistoryId);
}

function getDocumentMetadataId(row: Record<string, unknown>): string | null {
    return toObjectIdString(getSourceMetaEntities(row)?.documentMetadataId);
}

function getOrganizationId(value: unknown): string | null {
    if (value instanceof ObjectId) {
        return value.toHexString();
    }

    return typeof value === 'string' && value.length > 0 ? value : null;
}

function collectActivityWorkHistoryRowsNeedingBackfill(
    value: unknown,
    rows: Array<Record<string, unknown>>,
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectActivityWorkHistoryRowsNeedingBackfill(item, rows);
        }
        return;
    }

    if (!isRecord(value)) {
        return;
    }

    if (getActivityWorkHistoryId(value) && !Array.isArray(value.validatedForms) && value.awh_hasForms !== false) {
        rows.push(value);
    }

    for (const nested of Object.values(value)) {
        collectActivityWorkHistoryRowsNeedingBackfill(nested, rows);
    }
}

function collectDocumentMetadataRowsMissingOrganizationId(
    value: unknown,
    rows: Array<Record<string, unknown>>,
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectDocumentMetadataRowsMissingOrganizationId(item, rows);
        }
        return;
    }

    if (!isRecord(value)) {
        return;
    }

    const sourceMeta = getSourceMeta(value);
    if (getDocumentMetadataId(value) && !getOrganizationId(sourceMeta?.organizationID)) {
        rows.push(value);
    }

    for (const nested of Object.values(value)) {
        collectDocumentMetadataRowsMissingOrganizationId(nested, rows);
    }
}

function collectActivityWorkHistoryRowsNeedingAuxiliaryBackfill(
    value: unknown,
    rows: Array<Record<string, unknown>>,
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectActivityWorkHistoryRowsNeedingAuxiliaryBackfill(item, rows);
        }
        return;
    }

    if (!isRecord(value)) {
        return;
    }

    if (
        getActivityWorkHistoryId(value)
        && (value.machinery_ID === undefined || value.component_ID === undefined || value.awh_hasAttachments === undefined)
    ) {
        rows.push(value);
    }

    for (const nested of Object.values(value)) {
        collectActivityWorkHistoryRowsNeedingAuxiliaryBackfill(nested, rows);
    }
}

async function defaultFetchFormsByActivityWorkHistoryIds(
    activityWorkHistoryIds: readonly string[],
): Promise<PhoenixReadTimeFormDocument[]> {
    if (activityWorkHistoryIds.length === 0) {
        return [];
    }

    const db = await connectQueryMongo();

    return db
        .collection<PhoenixReadTimeFormDocument>('forms')
        .find({
            activityWorkHistoryID: {
                $in: activityWorkHistoryIds.map((id) => new ObjectId(id)),
            },
        })
        .project({
            _id: 1,
            organizationID: 1,
            activityWorkHistoryID: 1,
            formTemplateID: 1,
            name: 1,
            status: 1,
            submittedAt: 1,
            committedAt: 1,
        })
        .toArray();
}

async function defaultFetchDocumentMetadataByIds(
    documentMetadataIds: readonly string[],
): Promise<PhoenixReadTimeDocumentMetadataDocument[]> {
    if (documentMetadataIds.length === 0) {
        return [];
    }

    const db = await connectQueryMongo();

    return db
        .collection<PhoenixReadTimeDocumentMetadataDocument>('DocumentMetadata')
        .find({
            _id: {
                $in: documentMetadataIds.map((id) => new ObjectId(id)),
            },
        })
        .project({ _id: 1, organizationID: 1 })
        .toArray();
}

async function defaultFetchDocumentsByIds(
    collection: string,
    ids: readonly string[],
    projection: Record<string, 1>,
): Promise<Array<Record<string, unknown>>> {
    if (ids.length === 0) {
        return [];
    }

    const db = await connectQueryMongo();

    return db
        .collection<Record<string, unknown>>(collection)
        .find({
            _id: {
                $in: ids.map((id) => new ObjectId(id)),
            },
        })
        .project(projection)
        .toArray();
}

async function defaultFetchComponentActivitiesByActivityIds(
    activityIds: readonly string[],
): Promise<Array<Record<string, unknown>>> {
    if (activityIds.length === 0) {
        return [];
    }

    const db = await connectQueryMongo();

    return db
        .collection<Record<string, unknown>>('ComponentActivity')
        .find({
            activityIDs: {
                $in: activityIds.map((id) => new ObjectId(id)),
            },
        })
        .project({ activityIDs: 1, componentID: 1 })
        .toArray();
}

async function defaultFetchActivityWorkHistoryEventsByActivityWorkHistoryIds(
    activityWorkHistoryIds: readonly string[],
): Promise<Array<Record<string, unknown>>> {
    if (activityWorkHistoryIds.length === 0) {
        return [];
    }

    const db = await connectQueryMongo();

    return db
        .collection<Record<string, unknown>>('ActivityWorkHistoryEvent')
        .find({
            activityWorkHistoryID: {
                $in: activityWorkHistoryIds.map((id) => new ObjectId(id)),
            },
        })
        .project({
            activityWorkHistoryID: 1,
            documents: 1,
            files: 1,
            attachments: 1,
            documentIDs: 1,
        })
        .toArray();
}

function activityWorkHistoryEventHasAttachments(event: Record<string, unknown>): boolean {
    return ['documents', 'files', 'attachments', 'documentIDs']
        .some((key) => Array.isArray(event[key]) && event[key].length > 0);
}

function mapMinimalValidatedForm(
    form: PhoenixReadTimeFormDocument,
    fallbackOrganizationId: string | null,
): Record<string, unknown> {
    const formId = toObjectIdString(form._id);
    const formTemplateId = toObjectIdString(form.formTemplateID);
    const organizationId = getOrganizationId(form.organizationID) ?? fallbackOrganizationId;

    return stripUndefinedFields({
        formTemplateID: formTemplateId ?? '',
        validatedAt: form.committedAt ?? form.submittedAt ?? null,
        ...(formId ? { _id: formId } : {}),
        ...(typeof form.name === 'string' ? { name: form.name } : {}),
        ...(typeof form.status === 'string' ? { status: form.status } : {}),
        sourceMeta: stripUndefinedFields({
            ...(organizationId ? { organizationID: organizationId } : {}),
            entities: stripUndefinedFields({
                ...(formId ? { formId } : {}),
                ...(formTemplateId ? { formTemplateId } : {}),
            }),
        }),
    });
}

export async function backfillActivityWorkHistoryValidatedForms(
    results: unknown[],
    fetchFormsByActivityWorkHistoryIds: PhoenixConversationReadTimeDependencies['fetchFormsByActivityWorkHistoryIds'] = defaultFetchFormsByActivityWorkHistoryIds,
): Promise<boolean> {
    if (!Array.isArray(results) || results.length === 0) {
        return false;
    }

    const rows: Array<Record<string, unknown>> = [];
    collectActivityWorkHistoryRowsNeedingBackfill(results, rows);

    const activityWorkHistoryIds = Array.from(new Set(
        rows
            .map((row) => getActivityWorkHistoryId(row))
            .filter((value): value is string => value !== null),
    ));

    if (activityWorkHistoryIds.length === 0) {
        return false;
    }

    let formDocs: PhoenixReadTimeFormDocument[];
    try {
        formDocs = await fetchFormsByActivityWorkHistoryIds(activityWorkHistoryIds);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[phoenixai] read-time AWH forms backfill failed:', message);
        return false;
    }

    const formsByParent = new Map<string, PhoenixReadTimeFormDocument[]>();
    for (const form of formDocs) {
        const activityWorkHistoryId = toObjectIdString(form.activityWorkHistoryID);
        if (!activityWorkHistoryId) {
            continue;
        }

        const bucket = formsByParent.get(activityWorkHistoryId);
        if (bucket) {
            bucket.push(form);
            continue;
        }

        formsByParent.set(activityWorkHistoryId, [form]);
    }

    let changed = false;
    for (const row of rows) {
        const activityWorkHistoryId = getActivityWorkHistoryId(row);
        if (!activityWorkHistoryId) {
            continue;
        }

        const fallbackOrganizationId = getOrganizationId(getSourceMeta(row)?.organizationID);
        const minimalForms = (formsByParent.get(activityWorkHistoryId) ?? [])
            .map((form) => mapMinimalValidatedForm(form, fallbackOrganizationId))
            .filter((form) => typeof form.formTemplateID === 'string' && form.formTemplateID.length > 0);

        if (minimalForms.length > 0) {
            row.validatedForms = minimalForms;
            row.awh_hasForms = true;
            changed = true;
            continue;
        }

        if (row.awh_hasForms !== false) {
            row.awh_hasForms = false;
            changed = true;
        }
    }

    return changed;
}

export async function backfillDocumentMetadataOrganizationIds(
    results: unknown[],
    fetchDocumentMetadataByIds: PhoenixConversationReadTimeDependencies['fetchDocumentMetadataByIds'] = defaultFetchDocumentMetadataByIds,
): Promise<boolean> {
    if (!Array.isArray(results) || results.length === 0) {
        return false;
    }

    const rows: Array<Record<string, unknown>> = [];
    collectDocumentMetadataRowsMissingOrganizationId(results, rows);

    const documentMetadataIds = Array.from(new Set(
        rows
            .map((row) => getDocumentMetadataId(row))
            .filter((value): value is string => value !== null),
    ));

    if (documentMetadataIds.length === 0) {
        return false;
    }

    let documentMetadataDocs: PhoenixReadTimeDocumentMetadataDocument[];
    try {
        documentMetadataDocs = await fetchDocumentMetadataByIds(documentMetadataIds);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[phoenixai] read-time DocumentMetadata org backfill failed:', message);
        return false;
    }

    const organizationIdByDocumentMetadataId = new Map<string, string>();
    for (const doc of documentMetadataDocs) {
        const documentMetadataId = toObjectIdString(doc._id);
        const organizationId = getOrganizationId(doc.organizationID);
        if (!documentMetadataId || !organizationId) {
            continue;
        }

        organizationIdByDocumentMetadataId.set(documentMetadataId, organizationId);
    }

    let changed = false;
    for (const row of rows) {
        const documentMetadataId = getDocumentMetadataId(row);
        if (!documentMetadataId) {
            continue;
        }

        const organizationId = organizationIdByDocumentMetadataId.get(documentMetadataId);
        if (!organizationId) {
            continue;
        }

        const { sourceMeta } = ensureSourceMeta(row);
        if (!getOrganizationId(sourceMeta.organizationID)) {
            sourceMeta.organizationID = organizationId;
            changed = true;
        }

        if (typeof row.type !== 'string' || row.type.length === 0) {
            row.type = 'document';
            changed = true;
        }
    }

    return changed;
}

export async function backfillActivityWorkHistoryAuxiliaryFields(
    results: unknown[],
    fetchDocumentsByIds: PhoenixConversationReadTimeFetchDocuments = defaultFetchDocumentsByIds,
    fetchComponentActivitiesByActivityIds: PhoenixConversationReadTimeFetchComponentActivitiesByActivityIds = defaultFetchComponentActivitiesByActivityIds,
    fetchActivityWorkHistoryEventsByActivityWorkHistoryIds: PhoenixConversationReadTimeFetchActivityWorkHistoryEventsByActivityWorkHistoryIds = defaultFetchActivityWorkHistoryEventsByActivityWorkHistoryIds,
): Promise<boolean> {
    if (!Array.isArray(results) || results.length === 0) {
        return false;
    }

    const rows: Array<Record<string, unknown>> = [];
    collectActivityWorkHistoryRowsNeedingAuxiliaryBackfill(results, rows);

    const activityWorkHistoryIds = Array.from(new Set(
        rows
            .map((row) => getActivityWorkHistoryId(row))
            .filter((value): value is string => value !== null),
    ));

    if (activityWorkHistoryIds.length === 0) {
        return false;
    }

    try {
        const awhDocs = await fetchDocumentsByIds('ActivityWorkHistory', activityWorkHistoryIds, {
            activityID: 1,
            organizationID: 1,
        });
        const knownActivityWorkHistoryIds = new Set<string>();
        const awhToActivity = new Map<string, string>();
        const activityIds = new Set<string>();

        for (const doc of awhDocs) {
            const awhId = toObjectIdString(doc._id);
            const activityId = toObjectIdString(doc.activityID);
            if (!awhId) {
                continue;
            }

            knownActivityWorkHistoryIds.add(awhId);
            if (activityId) {
                awhToActivity.set(awhId, activityId);
                activityIds.add(activityId);
            }
        }

        const activityDocs = activityIds.size > 0
            ? await fetchDocumentsByIds('Activity', [...activityIds], { machineryID: 1 })
            : [];
        const activityToMachinery = new Map<string, string>();

        for (const doc of activityDocs) {
            const activityId = toObjectIdString(doc._id);
            const machineryId = toObjectIdString(doc.machineryID);
            if (!activityId || !machineryId) {
                continue;
            }

            activityToMachinery.set(activityId, machineryId);
        }

        const componentActivityDocs = activityIds.size > 0
            ? await fetchComponentActivitiesByActivityIds([...activityIds])
            : [];
        const componentByActivity = new Map<string, string>();

        for (const doc of componentActivityDocs) {
            const componentId = toObjectIdString(doc.componentID);
            if (!componentId || !Array.isArray(doc.activityIDs)) {
                continue;
            }

            for (const rawActivityId of doc.activityIDs) {
                const activityId = toObjectIdString(rawActivityId);
                if (!activityId || componentByActivity.has(activityId)) {
                    continue;
                }
                componentByActivity.set(activityId, componentId);
            }
        }

        const componentIds = Array.from(new Set(componentByActivity.values()));
        const componentDocs = componentIds.length > 0
            ? await fetchDocumentsByIds('Component', componentIds, { componentName: 1, machineryID: 1 })
            : [];
        const componentNameById = new Map<string, unknown>();
        const compMachById = new Map<string, string>();

        for (const doc of componentDocs) {
            const componentId = toObjectIdString(doc._id);
            if (!componentId) {
                continue;
            }

            if (doc.componentName !== undefined) {
                componentNameById.set(componentId, doc.componentName);
            }

            const machineryId = toObjectIdString(doc.machineryID);
            if (machineryId) {
                compMachById.set(componentId, machineryId);
            }
        }

        const machineryIds = Array.from(new Set([
            ...activityToMachinery.values(),
            ...compMachById.values(),
        ]));
        const machineryDocs = machineryIds.length > 0
            ? await fetchDocumentsByIds('Machinery', machineryIds, { machineryName: 1 })
            : [];
        const machineryNameById = new Map<string, unknown>();

        for (const doc of machineryDocs) {
            const machineryId = toObjectIdString(doc._id);
            if (!machineryId || doc.machineryName === undefined) {
                continue;
            }

            machineryNameById.set(machineryId, doc.machineryName);
        }

        const activityWorkHistoryEventDocs = await fetchActivityWorkHistoryEventsByActivityWorkHistoryIds(activityWorkHistoryIds);
        const awhHasAttachments = new Map<string, boolean>();

        for (const doc of activityWorkHistoryEventDocs) {
            const awhId = toObjectIdString(doc.activityWorkHistoryID);
            if (!awhId || !activityWorkHistoryEventHasAttachments(doc)) {
                continue;
            }

            awhHasAttachments.set(awhId, true);
        }

        let changed = false;
        for (const row of rows) {
            const awhId = getActivityWorkHistoryId(row);
            if (!awhId || !knownActivityWorkHistoryIds.has(awhId)) {
                continue;
            }

            const activityId = awhToActivity.get(awhId);
            let machineryId = activityId ? activityToMachinery.get(activityId) : undefined;
            const componentId = activityId ? componentByActivity.get(activityId) : undefined;

            if (!machineryId && componentId) {
                machineryId = compMachById.get(componentId);
            }

            const machineryName = machineryId ? machineryNameById.get(machineryId) : undefined;
            const componentName = componentId ? componentNameById.get(componentId) : undefined;

            if (machineryName !== undefined && row.machinery_ID === undefined) {
                row.machinery_ID = machineryName;
                changed = true;
            }

            if (componentName !== undefined && row.component_ID === undefined) {
                row.component_ID = componentName;
                changed = true;
            }

            if (row.awh_hasAttachments === undefined) {
                row.awh_hasAttachments = awhHasAttachments.get(awhId) === true;
                changed = true;
            }
        }

        return changed;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[phoenixai] read-time AWH auxiliary backfill failed:', message);
        return false;
    }
}

const defaultReadTimeDependencies: PhoenixConversationReadTimeDependencies = {
    fetchFormsByActivityWorkHistoryIds: defaultFetchFormsByActivityWorkHistoryIds,
    fetchDocumentMetadataByIds: defaultFetchDocumentMetadataByIds,
    fetchDocumentsByIds: defaultFetchDocumentsByIds,
    fetchComponentActivitiesByActivityIds: defaultFetchComponentActivitiesByActivityIds,
    fetchActivityWorkHistoryEventsByActivityWorkHistoryIds: defaultFetchActivityWorkHistoryEventsByActivityWorkHistoryIds,
    uploadResults: uploadJSONToGridFS,
    updateConversation,
    now: () => new Date(),
};

export async function applyReadTimeConversationBackfills(
    id: string,
    doc: PhoenixConversationDocument,
    dependencies: PhoenixConversationReadTimeDependencies = defaultReadTimeDependencies,
): Promise<PhoenixConversationReadTimeResult> {
    if (!Array.isArray(doc.results) || doc.results.length === 0) {
        return { resultsChanged: false, persisted: false };
    }

    const baseCollection = getBaseCollection(doc.generatedQuery);
    let resultsChanged = false;

    if (!baseCollection || baseCollection === 'ActivityWorkHistory') {
        const fetchDocumentsByIds: PhoenixConversationReadTimeFetchDocuments = dependencies.fetchDocumentsByIds
            ?? (dependencies === defaultReadTimeDependencies ? defaultFetchDocumentsByIds : async () => []);
        const fetchComponentActivitiesByActivityIds: PhoenixConversationReadTimeFetchComponentActivitiesByActivityIds = dependencies.fetchComponentActivitiesByActivityIds
            ?? (dependencies === defaultReadTimeDependencies ? defaultFetchComponentActivitiesByActivityIds : async () => []);
        const fetchActivityWorkHistoryEventsByActivityWorkHistoryIds: PhoenixConversationReadTimeFetchActivityWorkHistoryEventsByActivityWorkHistoryIds = dependencies.fetchActivityWorkHistoryEventsByActivityWorkHistoryIds
            ?? (dependencies === defaultReadTimeDependencies ? defaultFetchActivityWorkHistoryEventsByActivityWorkHistoryIds : async () => []);

        resultsChanged = await backfillActivityWorkHistoryValidatedForms(
            doc.results,
            dependencies.fetchFormsByActivityWorkHistoryIds,
        ) || resultsChanged;
        resultsChanged = await backfillActivityWorkHistoryAuxiliaryFields(
            doc.results,
            fetchDocumentsByIds,
            fetchComponentActivitiesByActivityIds,
            fetchActivityWorkHistoryEventsByActivityWorkHistoryIds,
        ) || resultsChanged;
    }

    if (baseCollection === 'DocumentMetadata') {
        resultsChanged = await backfillDocumentMetadataOrganizationIds(
            doc.results,
            dependencies.fetchDocumentMetadataByIds,
        ) || resultsChanged;
    }

    if (!resultsChanged) {
        return { resultsChanged: false, persisted: false };
    }

    try {
        const upload = await dependencies.uploadResults(
            doc.results,
            `phoenix_results_${String(id)}_enriched.json`,
            {
                conversationId: String(id),
                role: 'results',
                reason: 'view-read-backfill',
            },
            doc.resultsRef?.bucketName ?? 'fs',
        );

        const resultsRef = {
            gridFSFileId: upload.fileId,
            filename: upload.filename,
            contentType: upload.contentType,
            bucketName: upload.bucketName,
            storedAt: dependencies.now(),
        };

        doc.resultsRef = resultsRef;
        await dependencies.updateConversation(String(id), { resultsRef });
        return { resultsChanged: true, persisted: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[phoenixai] failed to persist read-time conversation backfill:', message);
        return { resultsChanged: true, persisted: false };
    }
}

export async function ensureModelsLoaded(): Promise<void> {
    await connectPersistenceMongo();
}

export async function createConversation(initial: PhoenixConversationCreateInput): Promise<PhoenixConversation> {
    await ensureModelsLoaded();

    const now = new Date();
    const document: PhoenixConversationCreateInput = {
        ...initial,
        createdAt: initial.createdAt ?? now,
        updatedAt: initial.updatedAt ?? now,
        status: initial.status ?? 'processing',
        pinned: initial.pinned ?? false,
        deleted: initial.deleted ?? false,
        results: initial.results ?? [],
        clarifyingQuestions: initial.clarifyingQuestions ?? [],
        assumptions: initial.assumptions ?? [],
        selectedIntents: initial.selectedIntents ?? [],
        targetCollections: initial.targetCollections ?? [],
    };

    const result = await getConversationCollection().insertOne(document as OptionalId<PhoenixConversationDocument>);
    const stored = await getConversationCollection().findOne({ _id: result.insertedId });

    if (!stored) {
        throw new Error('Failed to load created Phoenix conversation');
    }

    const conversation = toClient(stored);

    if (!conversation) {
        throw new Error('Failed to normalize created Phoenix conversation');
    }

    return conversation;
}

export async function updateConversation(id: string, patch: PhoenixConversationPatch): Promise<PhoenixConversation | null> {
    await ensureModelsLoaded();

    const update = stripUndefinedFields({
        ...patch,
        updatedAt: new Date(),
    });

    const result = await getConversationCollection().findOneAndUpdate(
        { _id: parseConversationId(id) },
        { $set: update },
        { returnDocument: 'after' },
    );

    return toClient(result);
}

export async function togglePin(id: string, pinned: boolean): Promise<PhoenixConversation | null> {
    return updateConversation(id, { pinned });
}

export async function softDelete(id: string): Promise<PhoenixConversation | null> {
    return updateConversation(id, { deleted: true });
}

export async function listConversations({ page = 1, pageSize = 20 }: ListPhoenixConversationsInput): Promise<ListPhoenixConversationsResult> {
    await ensureModelsLoaded();

    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 100) : 20;
    const skip = (safePage - 1) * safePageSize;
    const filter: Filter<PhoenixConversationDocument> = { deleted: { $ne: true } };

    const [items, total] = await Promise.all([
        getConversationCollection()
            .find(filter)
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(safePageSize)
            .toArray(),
        getConversationCollection().countDocuments(filter),
    ]);

    return {
        conversations: items
            .map((item) => toClient(item))
            .filter((item): item is PhoenixConversation => item !== null),
        total,
        page: safePage,
        pageSize: safePageSize,
    };
}

export async function getConversationById(id: string): Promise<PhoenixConversation | null> {
    await ensureModelsLoaded();

    const doc = await getConversationCollection().findOne({ _id: parseConversationId(id) });

    if (!doc) {
        return null;
    }

    if ((!Array.isArray(doc.results) || doc.results.length === 0) && doc.resultsRef) {
        try {
            const fileId = getResultsRefFileId(doc.resultsRef);
            if (fileId) {
                doc.results = await downloadJSONFromGridFS<unknown[]>(fileId, doc.resultsRef.bucketName ?? 'fs');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[phoenixai] getConversationById resultsRef load failed:', message);
        }
    }

    await applyReadTimeConversationBackfills(id, doc);

    if (doc.dualViewConfig === undefined && Array.isArray(doc.results) && doc.results.length > 0) {
        const dualViewConfig = detectDualViewOpportunity(doc.results, getBaseCollection(doc.generatedQuery));
        if (dualViewConfig.available) {
            doc.dualViewConfig = dualViewConfig;
        }
    }

    return toClient(doc);
}

export function toClient(doc: PhoenixConversationDocument | null): PhoenixConversation | null {
    if (!doc) {
        return null;
    }

    const conversation: PhoenixConversation = {
        conversationId: String(doc._id),
        userQuery: doc.userQuery,
        originalQuery: doc.userQuery,
        isPinned: !!doc.pinned,
        deleted: !!doc.deleted,
    };

    if (doc.resolvedQuery !== undefined) {
        conversation.resolvedQuery = doc.resolvedQuery;
    }

    if (doc.status !== undefined) {
        conversation.status = doc.status;
    }

    if (doc.generatedQuery !== undefined) {
        conversation.generatedQuery = doc.generatedQuery;
    }

    if (doc.selectedIntents !== undefined) {
        conversation.selectedIntents = doc.selectedIntents;
    }

    if (doc.targetCollections !== undefined) {
        conversation.targetCollections = doc.targetCollections;
    }

    if (doc.results !== undefined) {
        conversation.results = doc.results;
    }

    if (doc.executionMetadata !== undefined) {
        conversation.executionMetadata = doc.executionMetadata;
    }

    if (doc.clarifyingQuestions !== undefined) {
        conversation.clarifyingQuestions = doc.clarifyingQuestions;
    }

    if (doc.assumptions !== undefined) {
        conversation.assumptions = doc.assumptions;
    }

    if (doc.disambiguationLog !== undefined) {
        conversation.disambiguationLog = doc.disambiguationLog;
    }

    if (doc.relatedConversationId !== undefined) {
        conversation.relatedConversationId = doc.relatedConversationId;
    }

    if (doc.createdAt !== undefined) {
        conversation.createdAt = doc.createdAt;
    }

    if (doc.updatedAt !== undefined) {
        conversation.updatedAt = doc.updatedAt;
    }

    if (doc.dualViewConfig !== undefined) {
        conversation.dualViewConfig = doc.dualViewConfig;
    }

    return conversation;
}