function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, amount) {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + amount);
  return dateKey(next);
}

function sumPrices(items) {
  return items.reduce((sum, booking) => {
    const price = Number(booking.price);
    return sum + (Number.isFinite(price) && price > 0 ? price : 0);
  }, 0);
}

export function buildOwnerAnalytics(bookings, settings, now = new Date()) {
  const allBookings = Array.isArray(bookings) ? bookings : [];
  const today = dateKey(now);
  const dates = Array.from({ length: 30 }, (_, index) => addDays(today, index - 29));
  const firstDate = dates[0];
  const activeBookings = allBookings.filter((booking) =>
    !booking.cancelledAt && booking.paymentStatus !== 'refunded',
  );
  const paidBookings = activeBookings.filter((booking) => booking.paymentStatus === 'paid');
  const unpaidBookings = activeBookings.filter((booking) => booking.paymentStatus === 'unpaid');
  const cancelledBookings = allBookings.filter((booking) => Boolean(booking.cancelledAt));
  const refundedBookings = allBookings.filter((booking) => booking.paymentStatus === 'refunded');
  const dayRows = dates.map((date) => {
    const day = new Date(`${date}T00:00:00.000Z`);
    const scheduled = allBookings.filter((booking) => booking.date === date);
    const active = scheduled.filter((booking) => !booking.cancelledAt && booking.paymentStatus !== 'refunded');
    return {
      date,
      label: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(day),
      bookings: scheduled.length,
      activeBookings: active.length,
      cancelledBookings: scheduled.filter((booking) => Boolean(booking.cancelledAt)).length,
      collectedRevenue: sumPrices(active.filter((booking) => booking.paymentStatus === 'paid')),
      pendingRevenue: sumPrices(active.filter((booking) => booking.paymentStatus === 'unpaid')),
      cancellations: 0,
    };
  });
  const trendByDate = new Map(dayRows.map((row) => [row.date, row]));
  for (const booking of cancelledBookings) {
    const cancellationDate = String(booking.cancelledAt).slice(0, 10);
    const row = trendByDate.get(cancellationDate);
    if (row) row.cancellations += 1;
  }

  const sevenDayStart = addDays(today, -6);
  const sevenDayActiveBookings = activeBookings.filter((booking) =>
    booking.date >= sevenDayStart && booking.date <= today,
  );
  const weeklyCapacity = 7 * makeTimeSlots(settings).length * settings.sections.length;
  const occupancy = weeklyCapacity
    ? Math.round((sevenDayActiveBookings.length / weeklyCapacity) * 100)
    : 0;
  const monthStart = `${today.slice(0, 7)}-01`;
  const sportCounts = activeBookings.reduce((totals, booking) => {
    totals[booking.sport] = (totals[booking.sport] || 0) + 1;
    return totals;
  }, {});
  const sportData = Object.entries(sportCounts).map(([sport, count]) => ({ sport, count }));
  const timeData = makeTimeSlots(settings).map((hour) => {
    const count = sevenDayActiveBookings.filter((booking) => Number(booking.startHour) === hour).length;
    const capacity = 7 * settings.sections.length;
    return { hour, count, capacity, utilization: capacity ? Math.round((count / capacity) * 100) : 0 };
  });
  const sectionData = settings.sections.map((section) => {
    const count = sevenDayActiveBookings.filter((booking) => booking.section === section).length;
    const capacity = 7 * makeTimeSlots(settings).length;
    return { section, count, capacity, utilization: capacity ? Math.round((count / capacity) * 100) : 0 };
  });
  const busiest = timeData.reduce(
    (best, period) => period.count > best.count ? period : best,
    { hour: null, count: 0 },
  );
  const leastUsed = timeData.reduce(
    (least, period) => period.count < least.count ? period : least,
    { hour: null, count: Infinity },
  );

  return {
    totals: {
      totalBookings: allBookings.length,
      activeBookings: activeBookings.length,
      paidBookings: paidBookings.length,
      unpaidBookings: unpaidBookings.length,
      cancelledBookings: cancelledBookings.length,
      refundedBookings: refundedBookings.length,
      cancellationRate: allBookings.length ? Math.round((cancelledBookings.length / allBookings.length) * 100) : 0,
      collectedRevenue: sumPrices(paidBookings),
      pendingAmount: sumPrices(unpaidBookings),
      lastSevenDayCollectedRevenue: sumPrices(paidBookings.filter((booking) =>
        booking.date >= sevenDayStart && booking.date <= today,
      )),
      monthToDateCollectedRevenue: sumPrices(paidBookings.filter((booking) =>
        booking.date >= monthStart && booking.date <= today,
      )),
      lastSevenDayOccupancy: occupancy,
    },
    dayRows,
    sportData,
    timeData,
    sectionData,
    busiest,
    leastUsed,
    hasRecentBookings: allBookings.some((booking) => booking.date >= firstDate && booking.date <= today),
    hasRecentCancellations: cancelledBookings.some((booking) => {
      const cancellationDate = String(booking.cancelledAt).slice(0, 10);
      return cancellationDate >= firstDate && cancellationDate <= today;
    }),
  };
}

function makeTimeSlots(settings) {
  const slots = [];
  for (let hour = settings.openHour; hour + settings.durationHours <= settings.closeHour; hour += settings.durationHours) {
    slots.push(hour);
  }
  return slots;
}
