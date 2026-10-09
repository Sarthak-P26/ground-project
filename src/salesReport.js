const headers = [
  'Date',
  'Total Bookings',
  'Confirmed Bookings',
  'Cancelled/Refunded Bookings',
  'Confirmed Players',
  'Booking Value (INR)',
  'Collected Revenue (INR)',
  'Pending Amount (INR)',
];

function csvCell(value) {
  let text = String(value ?? '').replace(/\r\n?|\n/g, ' ');
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function amount(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function playerCount(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function buildSalesReportCsv(bookings) {
  const daily = new Map();

  for (const booking of Array.isArray(bookings) ? bookings : []) {
    const date = String(booking?.date || 'Unknown date');
    const row = daily.get(date) || {
      totalBookings: 0,
      confirmedBookings: 0,
      cancelledOrRefunded: 0,
      confirmedPlayers: 0,
      bookingValue: 0,
      collectedRevenue: 0,
      pendingAmount: 0,
    };
    row.totalBookings += 1;

    const paymentStatus = String(booking?.paymentStatus || 'unpaid').toLowerCase();
    const cancelled = Boolean(booking?.cancelledAt)
      || paymentStatus === 'cancelled'
      || paymentStatus === 'refunded';
    if (cancelled) {
      row.cancelledOrRefunded += 1;
    } else {
      row.confirmedBookings += 1;
      row.confirmedPlayers += playerCount(booking?.teamSize);
      const bookingPrice = amount(booking?.price);
      row.bookingValue += bookingPrice;
      if (paymentStatus === 'paid') row.collectedRevenue += bookingPrice;
      if (paymentStatus === 'unpaid') row.pendingAmount += bookingPrice;
    }
    daily.set(date, row);
  }

  const totals = {
    totalBookings: 0,
    confirmedBookings: 0,
    cancelledOrRefunded: 0,
    confirmedPlayers: 0,
    bookingValue: 0,
    collectedRevenue: 0,
    pendingAmount: 0,
  };
  const rows = [...daily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, metrics]) => {
      for (const key of Object.keys(totals)) totals[key] += metrics[key];
      return [
        csvCell(date),
        metrics.totalBookings,
        metrics.confirmedBookings,
        metrics.cancelledOrRefunded,
        metrics.confirmedPlayers,
        metrics.bookingValue,
        metrics.collectedRevenue,
        metrics.pendingAmount,
      ].join(',');
    });

  rows.push([
    csvCell('TOTAL'),
    totals.totalBookings,
    totals.confirmedBookings,
    totals.cancelledOrRefunded,
    totals.confirmedPlayers,
    totals.bookingValue,
    totals.collectedRevenue,
    totals.pendingAmount,
  ].join(','));

  return [headers.map(csvCell).join(','), ...rows].join('\r\n');
}
