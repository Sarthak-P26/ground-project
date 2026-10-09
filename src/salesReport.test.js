import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesReportCsv } from './salesReport.js';

test('daily sales report sorts dates and excludes cancelled and refunded value', () => {
  const csv = buildSalesReportCsv([
    { date: '2026-10-11', paymentStatus: 'paid', price: 900, teamSize: 8 },
    { date: '2026-10-10', paymentStatus: 'unpaid', price: 600, teamSize: 10 },
    { date: '2026-10-10', paymentStatus: 'paid', price: 700, teamSize: 12 },
    { date: '2026-10-10', paymentStatus: 'refunded', price: 500, teamSize: 6 },
    { date: '2026-10-11', paymentStatus: 'paid', price: 400, teamSize: 4, cancelledAt: '2026-10-09' },
  ]);
  const rows = csv.split('\r\n').map((line) => line.split(','));

  assert.deepEqual(rows[0], [
    '"Date"',
    '"Total Bookings"',
    '"Confirmed Bookings"',
    '"Cancelled/Refunded Bookings"',
    '"Confirmed Players"',
    '"Booking Value (INR)"',
    '"Collected Revenue (INR)"',
    '"Pending Amount (INR)"',
  ]);
  assert.deepEqual(rows[1], ['"2026-10-10"', '3', '2', '1', '22', '1300', '700', '600']);
  assert.deepEqual(rows[2], ['"2026-10-11"', '2', '1', '1', '8', '900', '900', '0']);
  assert.deepEqual(rows[3], ['"TOTAL"', '5', '3', '2', '30', '2200', '1600', '600']);
});

test('empty export contains the headings and a zero total row', () => {
  const rows = buildSalesReportCsv([]).split('\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1], '"TOTAL",0,0,0,0,0,0,0');
});

test('CSV text is escaped and protected from spreadsheet formulas', () => {
  const csv = buildSalesReportCsv([
    { date: '=1+1', paymentStatus: 'unpaid', price: 100, teamSize: 1 },
    { date: '"2026-10-10"', paymentStatus: 'unpaid', price: 100, teamSize: 1 },
  ]);
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"""2026-10-10"""/);
});
