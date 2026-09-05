const fs = require('fs');
const path = require('path');
const { addDays, createLevel, RULES_VERSION } = require('./daily-levels');

const TIME_ZONE = 'Asia/Shanghai';
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'schulte', 'data', 'daily-levels.json');

function dateInTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const startDate = process.env.LEVEL_START_DATE || dateInTimeZone();
const days = Number(process.env.LEVEL_DAYS || 8);

if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(days) || days < 1 || days > 31) {
  throw new Error('LEVEL_START_DATE 或 LEVEL_DAYS 不合法');
}

const payload = {
  generatedAt: new Date().toISOString(),
  timeZone: TIME_ZONE,
  rulesVersion: RULES_VERSION,
  levels: Object.fromEntries(
    Array.from({ length: days }, (_, offset) => {
      const date = addDays(startDate, offset);
      return [date, createLevel(date)];
    })
  )
};

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Generated ${days} daily levels from ${startDate}`);
