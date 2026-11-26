/** Import the school's price workbook without editing it or requiring Excel. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const decodeXml = value => String(value ?? '').replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi, (_, hex, decimal, name) => hex ? String.fromCodePoint(parseInt(hex, 16)) : decimal ? String.fromCodePoint(Number(decimal)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name.toLowerCase()]);
const attr = (tag, name) => decodeXml(tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] || '');
const textRuns = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(match => decodeXml(match[1])).join('');

// Read the central directory, which also works when ZIP entries use data descriptors.
function unzipXml(raw) {
  let end = raw.length - 22;
  while (end >= Math.max(0, raw.length - 65557) && raw.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || raw.readUInt32LE(end) !== 0x06054b50) throw new Error('ไม่พบโครงสร้าง XLSX');
  const entries = raw.readUInt16LE(end + 10), files = new Map();
  let cursor = raw.readUInt32LE(end + 16), totalSize = 0;
  for (let i = 0; i < entries; i++) {
    if (raw.readUInt32LE(cursor) !== 0x02014b50) throw new Error('โครงสร้าง ZIP ไม่ถูกต้อง');
    const flags = raw.readUInt16LE(cursor + 8), compression = raw.readUInt16LE(cursor + 10);
    const packed = raw.readUInt32LE(cursor + 20), unpacked = raw.readUInt32LE(cursor + 24);
    const nameSize = raw.readUInt16LE(cursor + 28), extraSize = raw.readUInt16LE(cursor + 30), commentSize = raw.readUInt16LE(cursor + 32);
    const local = raw.readUInt32LE(cursor + 42), name = raw.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8');
    cursor += 46 + nameSize + extraSize + commentSize;
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    totalSize += unpacked;
    if (flags & 1 || unpacked > 20_000_000 || totalSize > 50_000_000) throw new Error('ไฟล์เข้ารหัสหรือมีขนาดใหญ่เกินกำหนด');
    if (raw.readUInt32LE(local) !== 0x04034b50) throw new Error('โครงสร้างรายการ ZIP ไม่ถูกต้อง');
    const start = local + 30 + raw.readUInt16LE(local + 26) + raw.readUInt16LE(local + 28);
    const bytes = raw.subarray(start, start + packed);
    const contents = compression === 0 ? bytes : compression === 8 ? inflateRawSync(bytes, { maxOutputLength: 20_000_000 }) : null;
    if (!contents || contents.length !== unpacked) throw new Error('อ่านข้อมูล XLSX ไม่สำเร็จ');
    files.set(name, contents.toString('utf8'));
  }
  return files;
}

export function readWorkbook(raw) {
  const files = unzipXml(raw), workbook = files.get('xl/workbook.xml') || '';
  if (!workbook.includes(mainNs)) throw new Error('ไม่พบ workbook ของ Excel');
  const strings = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(match => textRuns(match[1]));
  const links = new Map([...(files.get('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\s([^>]+)\/?\s*>/g)].map(match => [attr(match[1], 'Id'), attr(match[1], 'Target')]));
  return [...workbook.matchAll(/<sheet\s([^>]+)\/?\s*>/g)].map(match => {
    const name = attr(match[1], 'name'), target = links.get(attr(match[1], 'r:id'));
    if (!target) throw new Error(`ไม่พบข้อมูลชีต ${name}`);
    const path = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join('xl', target));
    const xml = files.get(path);
    if (!xml) throw new Error(`อ่านชีต ${name} ไม่ได้`);
    const cells = new Map(), sharedFormulas = new Map();
    for (const cell of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const coordinate = attr(cell[1], 'r'), type = attr(cell[1], 't'), body = cell[2] || '';
      const value = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
      const formulaTag = body.match(/<f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
      const formula = formulaTag?.[2] ? decodeXml(formulaTag[2]) : '';
      const sharedId = formulaTag && attr(formulaTag[1], 't') === 'shared' ? attr(formulaTag[1], 'si') : null;
      if (value === undefined && type !== 'inlineStr' && !formulaTag) continue;
      const parsed = type === 's' ? strings[Number(value)] : type === 'inlineStr' ? textRuns(body) : type === 'str' ? decodeXml(value) : value === undefined ? null : Number(value);
      cells.set(coordinate, { value: parsed, ...(formula ? { formula } : {}), ...(sharedId !== null ? { sharedId } : {}) });
      if (sharedId !== null && formula) sharedFormulas.set(sharedId, { coordinate, formula });
    }
    for (const [coordinate, cell] of cells) {
      if (cell.sharedId === undefined || cell.formula) continue;
      const master = sharedFormulas.get(cell.sharedId);
      if (!master || !/^\$?[A-Z]+\$?[1-9]\d*$/.test(master.formula)) throw new Error(`ไม่รองรับสูตรร่วม ${name}!${coordinate}`);
      const split = address => address.match(/^(\$?)([A-Z]+)(\$?)([1-9]\d*)$/);
      const columnNumber = label => [...label].reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0);
      const columnLabel = number => { let result = ''; while (number > 0) { number--; result = String.fromCharCode(65 + number % 26) + result; number = Math.floor(number / 26); } return result; };
      const target = split(coordinate), origin = split(master.coordinate), reference = split(master.formula);
      const column = columnNumber(reference[2]) + (reference[1] ? 0 : columnNumber(target[2]) - columnNumber(origin[2]));
      const row = Number(reference[4]) + (reference[3] ? 0 : Number(target[4]) - Number(origin[4]));
      if (column < 1 || row < 1) throw new Error(`สูตรร่วมอ้างอิงผิด ${name}!${coordinate}`);
      cell.formula = `${reference[1]}${columnLabel(column)}${reference[3]}${row}`;
    }
    return { name, cells };
  });
}

function cellValue(sheet, coordinate, seen = new Set()) {
  const cell = sheet.cells.get(coordinate);
  if (!cell) return null;
  if (!cell.formula) return cell.value;
  if (seen.has(coordinate)) throw new Error(`สูตรวนซ้ำ ${sheet.name}!${coordinate}`);
  if (!/^\$?[A-Z]+\$?[1-9]\d*$/.test(cell.formula)) throw new Error(`ยังไม่รองรับสูตร ${sheet.name}!${coordinate}: ${cell.formula}`);
  seen.add(coordinate);
  const computed = cellValue(sheet, cell.formula.replaceAll('$', ''), seen);
  if (cell.value !== null && computed !== cell.value) throw new Error(`ผลสูตรไม่ตรงกับค่าที่บันทึก ${sheet.name}!${coordinate}`);
  return computed;
}

export function buildMaterialCatalog(raw, { sourceFile = 'ราคาเครื่องเขียน 2569 (2).xlsx', edition = '2569', downloadUrl = 'downloads/material-prices-2569.xlsx' } = {}) {
  const sheets = readWorkbook(raw), sha256 = createHash('sha256').update(raw).digest('hex');
  const version = `materials-${edition}-${sha256.slice(0, 16)}`, items = [], unpricedItems = [], issues = [];
  const expected = ['เครื่องเขียน', 'ราคาหมึก'];
  for (const name of expected) if (!sheets.some(sheet => sheet.name === name)) throw new Error(`ไม่พบชีตที่ต้องใช้: ${name}`);
  for (const sheet of sheets.filter(sheet => expected.includes(sheet.name))) {
    const headerRow = sheet.name === 'เครื่องเขียน' ? 4 : 6;
    if (cellValue(sheet, `B${headerRow}`) !== 'รายการ' || cellValue(sheet, `C${headerRow}`) !== 'หน่วยนับ') throw new Error(`หัวตารางชีต ${sheet.name} เปลี่ยนแปลง กรุณาตรวจคอลัมน์ก่อนนำเข้า`);
    const rows = [...new Set([...sheet.cells.keys()].map(key => Number(key.replace(/[A-Z]+/, ''))))].filter(row => row > headerRow).sort((a, b) => a - b);
    for (const row of rows) {
      const sequence = cellValue(sheet, `A${row}`), name = String(cellValue(sheet, `B${row}`) ?? '').trim(), unit = String(cellValue(sheet, `C${row}`) ?? '').trim();
      if (!name && sequence === null) continue;
      if (!Number.isSafeInteger(sequence) || !name || !unit) throw new Error(`ข้อมูลวัสดุไม่ครบ ${sheet.name} แถว ${row}`);
      const columns = sheet.name === 'ราคาหมึก' ? [['D', 'หมึกเทียบเท่า'], ['E', 'หมึกแท้']] : [['D', '']];
      for (const [column, variant] of columns) {
        const value = cellValue(sheet, `${column}${row}`), cents = typeof value === 'number' ? Math.round(value * 100) : null;
        const numeric = Number.isSafeInteger(cents) && cents >= 0 && Math.abs(value * 100 - cents) < 0.00001;
        const item = {
          id: `material:${sha256.slice(0, 16)}:${sheet.name === 'เครื่องเขียน' ? 'stationery' : 'ink'}:${row}:${column}`,
          kind: 'price', code: `${sheet.name === 'เครื่องเขียน' ? 'ST' : 'INK'}-${sequence}${variant ? `-${column}` : ''}`,
          name: variant ? `${name} (${variant})` : name,
          origin: `${sourceFile} · ${sheet.name} · ${column}${row}`, edition, isDemo: false, version: 1,
          data: { spec: variant, brand: '', unit, unitPrice: numeric ? cents : null, source: '', priceVersion: edition, priceDate: '', category: sheet.name, variant, sourceFile, sourceSheet: sheet.name, sourceRow: row, sourceColumn: column, sourceHash: sha256, rawName: name, rawPriceText: String(value ?? '') },
        };
        if (numeric) items.push(item);
        else {
          unpricedItems.push(item);
          issues.push({ code: 'price-selection-required', sourceFile, sourceSheet: sheet.name, sourceRow: row, sourceCell: `${column}${row}`, itemId: item.id, message: `ต้นฉบับระบุราคา "${value ?? ''}" กรุณาตรวจรุ่นและระบุราคาต่อหน่วยก่อนใช้` });
        }
      }
    }
  }
  return {
    schemaVersion: 1, version, currency: 'THB', priceUnit: 'satang', title: `บัญชีราคาวัสดุ ปี ${edition}`,
    description: 'ราคาตามไฟล์ต้นฉบับของโรงเรียน แยกหมึกแท้และหมึกเทียบเท่าตามหัวคอลัมน์ รายการที่ต้นฉบับระบุหลายราคาเก็บไว้ให้ตรวจรุ่นและระบุราคาเอง',
    sources: [{ file: sourceFile, sha256, sheets: expected, downloadUrl }],
    items, unpricedItems, issues,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const input = resolve(process.argv[2] || `${root}/references/ราคาเครื่องเขียน 2569 (2).xlsx`);
  const output = resolve(process.argv[3] || `${root}/public/material-catalog.json`);
  const catalog = buildMaterialCatalog(readFileSync(input), { sourceFile: basename(input) });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(catalog, null, 2) + '\n');
  console.log(JSON.stringify({ output, pricedItems: catalog.items.length, requirePrice: catalog.unpricedItems.length, version: catalog.version }));
}
