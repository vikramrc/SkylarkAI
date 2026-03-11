import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDualViewOpportunity } from './dual-view.js';

test('detectDualViewOpportunity enables forms -> work history toggle when all rows have AWH ids', () => {
    const result = detectDualViewOpportunity([
        { sourceMeta: { entities: { activityWorkHistoryId: '507f1f77bcf86cd799439011' } } },
        { activityWorkHistory_ID: '507f1f77bcf86cd799439012' },
        { activityWorkHistoryID: '507f1f77bcf86cd799439011' },
    ], 'forms');

    assert.equal(result.available, true);
    assert.equal(result.defaultView, 'activityWorkHistory');
    assert.equal(result.views?.[0]?.id, 'forms');
    assert.equal(result.views?.[1]?.count, 2);
});

test('detectDualViewOpportunity stays disabled when any form row lacks a valid AWH id', () => {
    const result = detectDualViewOpportunity([
        { sourceMeta: { entities: { activityWorkHistoryId: '507f1f77bcf86cd799439011' } } },
        { activityWorkHistory_ID: 'not-an-object-id' },
    ], 'forms');

    assert.deepEqual(result, { available: false });
});