const RULES_VERSION = 3;
const SIZES = [3, 4, 5];

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function positionDistance(first, second, size) {
  const firstRow = Math.floor(first / size);
  const firstColumn = first % size;
  const secondRow = Math.floor(second / size);
  const secondColumn = second % size;
  return Math.max(Math.abs(firstRow - secondRow), Math.abs(firstColumn - secondColumn));
}

function passesQuality(layout, size) {
  const positions = new Map(layout.map((number, index) => [number, index]));
  let adjacentPairs = 0;
  let sameRowRuns = 0;
  let sameColumnRuns = 0;

  for (let number = 1; number < layout.length; number += 1) {
    if (positionDistance(positions.get(number), positions.get(number + 1), size) <= 1) {
      adjacentPairs += 1;
    }
  }

  for (let number = 1; number <= layout.length - 2; number += 1) {
    const indexes = [positions.get(number), positions.get(number + 1), positions.get(number + 2)];
    const rows = indexes.map((index) => Math.floor(index / size));
    const columns = indexes.map((index) => index % size);
    if (rows.every((row) => row === rows[0])) sameRowRuns += 1;
    if (columns.every((column) => column === columns[0])) sameColumnRuns += 1;
  }

  const naturalPositions = layout.reduce((total, number, index) => {
    return total + Math.abs(number - 1 - index);
  }, 0);

  return (
    adjacentPairs <= Math.max(2, Math.floor(layout.length * 0.24)) &&
    sameRowRuns === 0 &&
    sameColumnRuns === 0 &&
    naturalPositions >= layout.length * 1.4
  );
}

function generateLayout(date, size) {
  const values = Array.from({ length: size * size }, (_, index) => index + 1);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const random = createRandom(hashSeed(`${date}:${size}:${RULES_VERSION}:${attempt}`));
    const layout = shuffle(values, random);
    if (passesQuality(layout, size)) return layout;
  }
  throw new Error(`无法为 ${date} 的 ${size}x${size} 生成合格布局`);
}

function createLevel(date) {
  return {
    date,
    id: date.replaceAll('-', ''),
    rulesVersion: RULES_VERSION,
    stages: [
      ...SIZES.map((size) => ({ type: 'classic', size, layout: generateLayout(date, size) })),
      {
        type: 'fifty',
        size: 5,
        layout: generateLayout(`${date}:fifty:front`, 5),
        hiddenLayout: generateLayout(`${date}:fifty:hidden`, 5).map((value) => value + 25)
      }
    ]
  };
}

function addDays(date, offset) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + offset));
  return value.toISOString().slice(0, 10);
}

module.exports = { RULES_VERSION, SIZES, addDays, createLevel, generateLayout, passesQuality };
