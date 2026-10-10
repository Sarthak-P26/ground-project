import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOwnerAnalytics } from './ownerAnalytics.js';

const settings = {
  openHour: 6,
  closeHour: 21,
  durationHours: 3,
  sections: ['A', 'B', 'C', 'D'],
};

test('owner analytics keeps cancellation, refund, payment, and date scopes distinct', () => {
  const analytics = buildOwnerAnalytics([
    { id: 'today-paid', date: '2026-08-20', section: 'A', sport: 'Football', startHour: 6, price: 700, paymentStatus: 'paid' },
    { id: 'today-unpaid', date: '2026-08-20', section: 'B', sport: 'Cricket', startHour: 9, price: 600, paymentStatus: 'unpaid' },
    { id: 'old-paid', date: '2026-07-01', section: 'A', sport: 'Football', startHour: 6, price: 900, paymentStatus: 'paid' },
    { id: 'cancelled', date: '2026-08-19', section: 'C', sport: 'Football', startHour: 12, price: 500, paymentStatus: 'refunded', cancelledAt: '2026-08-20T12:00:00.000Z' },
    { id: 'refunded', date: '2026-08-18', section: 'D', sport: 'Cricket', startHour: 12, price: 400, paymentStatus: 'refunded' },
  ], settings, new Date('2026-08-20T12:00:00.000Z'));

  assert.deepEqual(analytics.totals, {
    totalBookings: 5,
    activeBookings: 3,
    paidBookings: 2,
    unpaidBookings: 1,
    cancelledBookings: 1,
    refundedBookings: 2,
    cancellationRate: 20,
    collectedRevenue: 1600,
    pendingAmount: 600,
    lastSevenDayCollectedRevenue: 700,
    monthToDateCollectedRevenue: 700,
    lastSevenDayOccupancy: 1,
  });
  assert.equal(analytics.dayRows.find((row) => row.date === '2026-08-20').activeBookings, 2);
  assert.equal(analytics.dayRows.find((row) => row.date === '2026-08-20').collectedRevenue, 700);
  assert.equal(analytics.dayRows.find((row) => row.date === '2026-08-20').pendingRevenue, 600);
  assert.equal(analytics.dayRows.find((row) => row.date === '2026-08-20').cancellations, 1);
  assert.equal(analytics.dayRows.find((row) => row.date === '2026-08-19').cancelledBookings, 1);
  assert.deepEqual(analytics.sectionData.map(({ count, capacity }) => [count, capacity]), [[1, 35], [1, 35], [0, 35], [0, 35]]);
  assert.equal(analytics.hasRecentBookings, true);
  assert.equal(analytics.hasRecentCancellations, true);
});

test('owner analytics returns empty-state values for no bookings', () => {
  const analytics = buildOwnerAnalytics([], settings, new Date('2026-08-20T12:00:00.000Z'));
  assert.equal(analytics.totals.totalBookings, 0);
  assert.equal(analytics.totals.collectedRevenue, 0);
  assert.equal(analytics.hasRecentBookings, false);
  assert.equal(analytics.hasRecentCancellations, false);
  assert.equal(analytics.dayRows.length, 30);
});
