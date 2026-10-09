import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidMaintenanceDate,
  maintenanceDatesFromPeriods,
  maintenancePeriodsFromDates,
} from './maintenancePeriods.js';

test('validates calendar dates and combines consecutive stored dates', () => {
  assert.equal(isValidMaintenanceDate('2026-02-28'), true);
  assert.equal(isValidMaintenanceDate('2026-02-30'), false);
  assert.deepEqual(maintenancePeriodsFromDates([
    '2026-06-03',
    '2026-06-01',
    '2026-06-02',
    '2026-06-08',
    'not-a-date',
    '2026-06-02',
  ]), [
    { startDate: '2026-06-01', endDate: '2026-06-03' },
    { startDate: '2026-06-08', endDate: '2026-06-08' },
  ]);
});

test('expands maintenance ranges inclusively and deduplicates overlaps', () => {
  assert.deepEqual(maintenanceDatesFromPeriods([
    { startDate: '2026-06-01', endDate: '2026-06-03' },
    { startDate: '2026-06-03', endDate: '2026-06-04' },
    { startDate: '2026-06-09', endDate: '2026-06-08' },
  ]), ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
});
