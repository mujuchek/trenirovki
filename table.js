// ---------- Импорт плана из Excel (.xlsx) и CSV — без библиотек, работает офлайн ----------
// Обычный скрипт после основного: использует ui, render, toast, esc, parsePlanText.
// Таблица превращается в текст плана, который можно проверить и поправить перед сохранением.

async function readTableFile(file){
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xls')) throw new Error('xls');
  if (name.endsWith('.csv') || name.endsWith('.txt') || /csv|text\/plain/.test(file.type)) {
    return [{name:'CSV', rows:parseCsv(await file.text())}];
  }
  return readXlsx(await file.arrayBuffer());
}

// CSV: разделитель «;», табуляция или «,» — по первой непустой строке (русский Excel пишет «;»)
function parseCsv(text){
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const sep = [';', '\t', ','].reduce((best, s) => first.split(s).length > first.split(best).length ? s : best, ';');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(r => r.map(c => c.trim()));
}

// .xlsx — это zip с XML внутри: читаем оглавление архива и распаковываем нужные файлы
async function readXlsx(buf){
  const u8 = new Uint8Array(buf), dv = new DataView(buf), dec = new TextDecoder();
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not-zip');
  const entries = {};
  let off = dv.getUint32(eocd + 16, true);
  for (let k = dv.getUint16(eocd + 10, true); k > 0; k--) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    entries[dec.decode(u8.subarray(off + 46, off + 46 + nlen))] =
      {method:dv.getUint16(off + 10, true), size:dv.getUint32(off + 20, true), at:dv.getUint32(off + 42, true)};
    off += 46 + nlen + xlen + clen;
  }
  const read = async path => {
    const f = entries[path]; if (!f) return null;
    const start = f.at + 30 + dv.getUint16(f.at + 26, true) + dv.getUint16(f.at + 28, true);
    const data = u8.subarray(start, start + f.size);
    if (f.method === 0) return dec.decode(data);
    if (f.method !== 8) throw new Error('zip-method');
    const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return dec.decode(out);
  };
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const wbText = await read('xl/workbook.xml');
  if (!wbText) throw new Error('not-xlsx');
  const rels = {};
  const relsText = await read('xl/_rels/workbook.xml.rels');
  if (relsText) for (const r of xml(relsText).getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const ssText = await read('xl/sharedStrings.xml');
  const shared = ssText ? [...xml(ssText).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  const colIndex = letters => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const num = v => String(Math.round(v * 1000) / 1000);            // 142.49999999 → 142.5
  const sheets = [];
  for (const sh of xml(wbText).getElementsByTagName('sheet')) {
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = rels[rid]; if (!target) continue;
    target = target.replace(/^\/+/, '');
    const text = await read(target.startsWith('xl/') ? target : 'xl/' + target);
    if (!text) continue;
    const rows = [];
    for (const r of xml(text).getElementsByTagName('row')) {
      const ri = (parseInt(r.getAttribute('r'), 10) || rows.length + 1) - 1;
      const cells = [];
      for (const c of r.getElementsByTagName('c')) {
        const col = colIndex((c.getAttribute('r') || '').replace(/\d+/g, '')) ;
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        let val = '';
        if (t === 's') val = v ? (shared[+v.textContent] || '') : '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (v) val = (t === 'str' || t === 'b' || t === 'e' || isNaN(+v.textContent)) ? v.textContent : num(+v.textContent);
        cells[col >= 0 ? col : cells.length] = val;
      }
      rows[ri] = Array.from(cells, x => x ?? '');
    }
    sheets.push({name:sh.getAttribute('name') || 'Лист ' + (sheets.length + 1), rows:Array.from(rows, r => r || [])});
  }
  if (!sheets.length) throw new Error('empty');
  return sheets;
}

// строки таблицы → текст плана, который понимает parsePlanText
function rowsToPlanText(rows){
  const lines = [];
  let map = null;
  const isNum = s => /^\d+([.,]\d+)?$/.test(s);
  for (const raw of rows) {
    const cells = (raw || []).map(c => String(c ?? '').trim());
    const filled = cells.filter(Boolean);
    if (!filled.length) { lines.push(''); continue; }
    const low = cells.map(c => c.toLowerCase());
    const find = re => low.findIndex(c => re.test(c));
    // строка с заголовками колонок: «Упражнение | Вес | Подходы | Повторы | Комментарий»
    const iName = find(/упражн|exercise|название/), iSets = find(/подход|^sets?$/), iReps = find(/повтор|^reps?$/);
    if (iName >= 0 && (iSets >= 0 || iReps >= 0)) {
      map = {name:iName, weight:find(/вес|^кг$|weight|^kg$/), sets:iSets, reps:iReps, note:find(/коммент|примеч|заметк|^note/)};
      continue;
    }
    if (map) {
      const g = i => i >= 0 ? (cells[i] || '') : '';
      const s = g(map.sets), r = g(map.reps);
      if (isNum(s) && isNum(r)) { lines.push([g(map.name), g(map.weight), `${s}x${r}`, g(map.note)].filter(Boolean).join(' ')); continue; }
      if (/\d\s*[xх×*]\s*\d/i.test(s)) { lines.push([g(map.name), g(map.weight), s, g(map.note)].filter(Boolean).join(' ')); continue; }
    }
    const joined = filled.join(' ');
    // уже в виде «присед 130 4х5», или строка без цифр — название тренировки
    if (/\d\s*[xх×*]\s*\d/i.test(joined) || !/\d/.test(joined) || isDayTitle(joined)) { lines.push(joined); continue; }
    // «присед | 130 | 4 | 5» без заголовков: последние два числа — подходы и повторы, перед ними вес
    const nums = filled.filter(isNum), texts = filled.filter(c => !isNum(c));
    if (texts.length && nums.length >= 2) {
      const reps = nums[nums.length - 1], sets = nums[nums.length - 2], w = nums.length >= 3 ? nums[nums.length - 3] : '';
      lines.push([texts[0], w, `${sets}x${reps}`, ...texts.slice(1)].filter(Boolean).join(' '));
    } else lines.push(joined);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- импорт: выбор файла и листа ----------
function applySheet(){
  const sh = ui.sheets && ui.sheets[ui.sheetIdx];
  if (!sh) return;
  ui.importText = rowsToPlanText(sh.rows);
  const res = parsePlanText(ui.importText);
  ui.pending = res.sessions.length ? res : null;
  if (!res.sessions.length) toast('В таблице не нашлось упражнений — проверьте текст ниже');
  render();
}
document.addEventListener('change', async e => {
  if (e.target.id === 'tableFile' && e.target.files[0]) {
    const file = e.target.files[0];
    try {
      ui.sheets = await readTableFile(file);
      ui.sheetIdx = 0;
      // название плана — из имени файла, если вы не вводили его сами
      if (!ui.importName.trim() || ui.importName === ui.importNameAuto) ui.importName = ui.importNameAuto = (file.name || '').replace(/\.[^.]+$/, '');
      applySheet();
    } catch(err) {
      toast(err.message === 'xls' ? 'Старый формат .xls не читается — сохраните таблицу как .xlsx' : 'Не получилось прочитать таблицу');
    }
    e.target.value = '';
  }
  if (e.target.id === 'sheetSel') { ui.sheetIdx = +e.target.value; applySheet(); }
});
