export interface PhoenixDualViewOption {
    id: string;
    label: string;
    icon: string;
    renderer: string;
    count: number;
    description: string;
}

export interface PhoenixDualViewConfig {
    available: boolean;
    views?: PhoenixDualViewOption[];
    defaultView?: string;
    reason?: string;
    transformationNeeded?: boolean;
}

interface DualViewResultRow {
    sourceMeta?: {
        entities?: {
            activityWorkHistoryId?: unknown;
        };
    };
    activityWorkHistory_ID?: unknown;
    activityWorkHistoryID?: unknown;
}

const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

function getActivityWorkHistoryId(result: DualViewResultRow): string | null {
    const candidate = result.sourceMeta?.entities?.activityWorkHistoryId
        ?? result.activityWorkHistory_ID
        ?? result.activityWorkHistoryID;

    if (candidate === null || candidate === undefined) {
        return null;
    }

    const normalized = String(candidate);
    return OBJECT_ID_REGEX.test(normalized) ? normalized : null;
}

export function detectDualViewOpportunity(results: unknown[] = [], baseCollection = ''): PhoenixDualViewConfig {
    if (!Array.isArray(results) || results.length === 0) {
        return { available: false };
    }

    if (baseCollection === 'forms') {
        const awhIds = results
            .map((result) => getActivityWorkHistoryId((result ?? {}) as DualViewResultRow))
            .filter((id): id is string => id !== null);

        if (awhIds.length === results.length && awhIds.length > 0) {
            const uniqueAwhCount = new Set(awhIds).size;

            return {
                available: true,
                views: [
                    {
                        id: 'forms',
                        label: 'Forms',
                        icon: 'FileText',
                        renderer: 'FormCard',
                        count: results.length,
                        description: 'View individual forms',
                    },
                    {
                        id: 'activityWorkHistory',
                        label: 'Work History',
                        icon: 'ClipboardList',
                        renderer: 'WorkHistoryCard',
                        count: uniqueAwhCount,
                        description: 'View activities with forms grouped',
                    },
                ],
                defaultView: 'activityWorkHistory',
                reason: 'All forms are linked to work history activities',
                transformationNeeded: true,
            };
        }
    }

    return { available: false };
}