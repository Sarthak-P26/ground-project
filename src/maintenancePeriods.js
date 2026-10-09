export function isValidMaintenanceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function maintenancePeriodsFromDates(dates) {
  const orderedDates = [...new Set((Array.isArray(dates) ? dates : []).filter(isValidMaintenanceDate))].sort();
  const periods = [];
  for (const date of orderedDates) {
    const lastPeriod = periods.at(-1);
    if (lastPeriod) {
      const nextDate = new Date(`${lastPeriod.endDate}T00:00:00.000Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      if (nextDate.toISOString().slice(0, 10) === date) {
        lastPeriod.endDate = date;
        continue;
      }
    }
    periods.push({ startDate: date, endDate: date });
  }
  return periods;
}

export function maintenanceDatesFromPeriods(periods) {
  const dates = new Set();
  for (const period of Array.isArray(periods) ? periods : []) {
    if (!period || !isValidMaintenanceDate(period.startDate) || !isValidMaintenanceDate(period.endDate) || period.endDate < period.startDate) continue;
    const current = new Date(`${period.startDate}T00:00:00.000Z`);
    const end = new Date(`${period.endDate}T00:00:00.000Z`);
    while (current <= end) {
      dates.add(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }
  }
  return [...dates].sort();
}
