import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildMaterialCatalog, readWorkbook } from '../scripts/import-material-prices.mjs';

const raw = readFileSync(new URL('../public/downloads/material-prices-2569.xlsx', import.meta.url));
const catalog = JSON.parse(readFileSync(new URL('../public/material-catalog.json', import.meta.url), 'utf8'));
const at = (sheet, row, column = 'D') => catalog.items.find(item => item.data.sourceSheet === sheet && item.data.sourceRow === row && item.data.sourceColumn === column);

test('published catalog is reproducible from the downloadable original and preserves its provenance', () => {
  assert.deepEqual(buildMaterialCatalog(raw), catalog);
  assert.equal(createHash('sha256').update(raw).digest('hex'), catalog.sources[0].sha256);
  assert.equal(catalog.items.length, 790);
  assert.equal(catalog.unpricedItems.length, 21);
  assert.equal(catalog.items.filter(item => item.data.category === 'เครื่องเขียน').length, 716);
  assert.equal(catalog.items.filter(item => item.data.category === 'ราคาหมึก').length, 74);
  const all = [...catalog.items, ...catalog.unpricedItems];
  assert.equal(new Set(all.map(item => item.id)).size, all.length);
  assert.equal(new Set(all.map(item => `${item.data.sourceSheet}:${item.data.sourceRow}`)).size, 774);
  for (const item of all) {
    assert.equal(item.kind, 'price');
    assert.equal(item.data.sourceHash, catalog.sources[0].sha256);
    assert.equal(item.data.source, '', 'The supplier must not become the budget funding source');
    assert.equal(item.data.priceDate, '', 'The workbook does not state an exact price date');
  }
});

test('prices are exact satang and genuine/equivalent ink remain separate selectable choices', () => {
  assert.equal(at('เครื่องเขียน', 5).name, 'กบเหลาดินสอ Masterart');
  assert.equal(at('เครื่องเขียน', 5).data.unitPrice, 600);
  assert.equal(at('เครื่องเขียน', 18).data.unitPrice, 175000);
  assert.equal(at('ราคาหมึก', 7, 'D').data.unitPrice, 120000);
  assert.equal(at('ราคาหมึก', 7, 'E').data.unitPrice, 250000);
  assert.match(at('ราคาหมึก', 7, 'D').name, /หมึกเทียบเท่า/);
  assert.match(at('ราคาหมึก', 7, 'E').name, /หมึกแท้/);
  // Source contains two rows named 35A at different genuine prices; do not collapse them by name.
  assert.equal(at('ราคาหมึก', 8, 'E').data.unitPrice, 250000);
  assert.equal(at('ราคาหมึก', 10, 'E').data.unitPrice, 245000);
  for (const item of catalog.items) assert.ok(Number.isSafeInteger(item.data.unitPrice) && item.data.unitPrice > 0);
});

test('all direct cell-reference formulas resolve to their referenced price, including genuine Canon ink', () => {
  const sheets = readWorkbook(raw);
  let checked = 0;
  for (const sheet of sheets) for (const [coordinate, cell] of sheet.cells) {
    if (!cell.formula) continue;
    const price = at(sheet.name, Number(coordinate.slice(1)), coordinate[0]);
    assert.ok(price, `${sheet.name}!${coordinate} must have a price option`);
    assert.equal(price.data.unitPrice, sheet.cells.get(cell.formula).value * 100);
    checked++;
  }
  assert.equal(checked, 22);
  assert.equal(at('ราคาหมึก', 40, 'E').data.unitPrice, 12000);
});

test('ambiguous source prices are retained verbatim without inventing zero or a chosen rate', () => {
  const glue = catalog.unpricedItems.find(item => item.data.sourceRow === 123);
  assert.equal(glue.data.rawPriceText, '75-95-115');
  assert.equal(glue.data.unitPrice, null);
  const pins = catalog.unpricedItems.find(item => item.data.sourceRow === 139);
  assert.equal(pins.data.rawPriceText, '3,4,6,9,10');
  assert.equal(catalog.issues.length, catalog.unpricedItems.length);
  for (const item of catalog.unpricedItems) {
    assert.equal(item.data.unitPrice, null);
    assert.ok(catalog.issues.some(issue => issue.itemId === item.id && issue.code === 'price-selection-required'));
    assert.ok(!catalog.items.some(priced => priced.id === item.id));
  }
});

test('unsupported input fails instead of producing an empty or fabricated price catalog', () => {
  assert.throws(() => buildMaterialCatalog(Buffer.from('This is not an Excel workbook')));
});
