// ---------- Видео: отслеживание грифа, траектория и блины поверх видео ----------
// Обычный скрипт, подключается после основного: использует state, ui, render, toast, esc, IC, fmtW, loadPlates, barDrawing.

const VS = {
  url:null, el:null, overlay:null, vw:0, vh:0, dur:0, name:'',
  center:null, radius:0,          // центр и радиус блина (по высоте) на первом кадре, в пикселях видео
  angle:0, side:1,                // угол съёмки от оси грифа, градусы; side 1 — гриф уходит влево, -1 — вправо
  track:null, t0:0,               // [{t, x, y}] — сглаженная траектория
  tracking:false, progress:0, cancel:false,
  showPath:true, showPlates:true, weight:100,
  plateHide:5, plateForever:false, // через сколько секунд от начала подхода убрать картинку
  pic:{x:.04, y:.04, w:.5, alpha:.7}, drag:null, // картинка с весом: стоит на месте, двигается пальцем; доли кадра
  sprite:null, spriteKey:'', raf:0, exporting:false
};
const PLATE_MM = 450;              // диаметр блина 25/20 кг — по нему переводим пиксели в миллиметры

// ---------- разметка вкладки ----------
function renderVideoView(){
  if (!VS.url) return `
    <h1 class="page-title">Видео</h1>
    <div class="card stack">
      <div class="muted small">Снимите подход сбоку или наискосок, камера неподвижно, блин виден целиком. Приложение отследит гриф, нарисует траекторию, посчитает скорость и наложит блины на видео.</div>
      <label class="btn file-btn">Выбрать видео<input type="file" accept="video/*" id="vfile"></label>
    </div>
    <div class="section-title">Как это работает</div>
    <div class="card" style="padding:4px 16px">
      ${['Выберите видео подхода из галереи','Поставьте на начало подхода и нажмите на центр блина','Подгоните размер, угол съёмки и сторону — эллипс по краю блина','Нажмите «Отследить» и сохраните видео с траекторией и блинами']
        .map((t,i)=>`<div class="check-row"><b class="vstep">${i+1}</b><span>${t}</span></div>`).join('')}
    </div>`;

  const tracked = !!VS.track;
  const st = tracked ? videoStats() : null;
  let panel = '';
  if (VS.tracking) {
    panel = `<div class="card stack">
      <div class="kicker">Отслеживаю гриф…</div>
      <div class="vprog"><i id="vprog" style="width:${Math.round(VS.progress*100)}%"></i></div>
      <button class="btn ghost" data-act="vcancel">Остановить</button></div>`;
  } else if (!VS.center) {
    panel = `<div class="card"><div class="vhint"><b class="vstep">1</b>Перемотайте на начало подхода и нажмите пальцем на <b>центр блина</b> (торец грифа).</div></div>`;
  } else if (!tracked) {
    panel = `<div class="card stack">
      <div class="vhint"><b class="vstep">2</b>Подгоните эллипс под край блина: по высоте блина считаются сантиметры.</div>
      <label class="vlabel">Размер блина<input type="range" id="vrad" min="${Math.max(3, Math.round(VS.vh*.006))}" max="${Math.round(VS.vh*.45)}" step="1" value="${Math.round(VS.radius)}"></label>
      <label class="vlabel">Угол съёмки <b id="vangv">${VS.angle}°</b><span class="muted small">0° — строго сбоку</span>
        <input type="range" id="vang" min="0" max="75" step="1" value="${VS.angle}"></label>
      <div class="opts">${[[1,'Гриф уходит влево'],[-1,'Гриф уходит вправо']].map(([v,l])=>`<button class="${VS.side===v?'on':''}" data-act="vside" data-v="${v}">${l}</button>`).join('')}</div>
      <button class="btn" data-act="vtrack">Отследить гриф</button>
      <button class="btn ghost" data-act="vremark">Отметить заново</button></div>`;
  } else {
    panel = `
      <div class="vstats">
        <div><b>${st.count || '—'}</b><span>повторов<br>&nbsp;</span></div>
        <div><b>${st.vel}</b><span>скорость<br>м/с</span></div>
        <div><b>${st.drift}</b><span>уход<br>см</span></div>
      </div>
      ${st.reps.length ? `<div class="card vreps">
        <div class="vrep head"><span>№</span><span>Подъём<br>с</span><span>Скорость<br>м/с</span><span>Пик<br>м/с</span></div>
        ${st.reps.map(r => `<div class="vrep"><b>${r.n}</b><span>${r.time}</span><span>${r.vel}</span><span>${r.peak}</span></div>`).join('')}
        ${st.drop !== null ? `<div class="muted small" style="margin-top:8px">Скорость с 1-го по ${st.reps.length}-й повтор ${st.drop > 0 ? 'упала на ' + st.drop : 'выросла на ' + (-st.drop)}%</div>` : ''}
        <div class="vnote">Точность: время ±${st.err.time} с · скорость ±${st.err.vel}% · уход ±${st.err.drift} см.
          Цифры примерные: зависят от частоты кадров видео (${st.err.fps} к/с) и от того, насколько точно круг совпал с краем блина (он должен быть 45 см).</div>
      </div>` : `<div class="card muted small">Не нашёл подъёмов штанги. Проверьте, что круг совпадает с размером блина, и отметьте центр заново.</div>`}
      <div class="card" style="padding:2px 16px">
        <div class="set-row"><span>Траектория</span>
          <button class="switch ${VS.showPath?'on':''}" data-act="vtoggle" data-k="showPath" role="switch" aria-checked="${VS.showPath}" aria-label="Траектория"></button></div>
        <div class="set-row"><span>Картинка с весом<br><span class="muted small">перетащите её пальцем по видео</span></span>
          <button class="switch ${VS.showPlates?'on':''}" data-act="vtoggle" data-k="showPlates" role="switch" aria-checked="${VS.showPlates}" aria-label="Картинка с весом"></button></div>
        <div class="set-row ${VS.showPlates?'':'off'}"><span>Вес, кг<br><span class="muted small">${state.settings.plateStyle==='chrome'?'хромированные':'цветные'} блины — вид в настройках</span></span>
          <input id="vweight" class="vweight" type="text" inputmode="decimal" enterkeyhint="done" value="${fmtW(VS.weight)}" aria-label="Вес на штанге, кг"></div>
        <div class="set-row ${VS.showPlates?'':'off'}" style="display:block"><span>Шрифт подписи</span>
          <div class="opts" style="margin-top:8px">${[['sys','Обычный','700 15px system-ui,Roboto,sans-serif'],['narrow','Узкий','600 16px Oswald,sans-serif'],['italic','Курсив','italic 800 15px system-ui,Roboto,sans-serif']]
            .map(([v,l,fnt])=>`<button class="${state.settings.capFont===v?'on':''}" data-act="vfont" data-v="${v}" style="font:${fnt};text-transform:none;letter-spacing:0">${l}</button>`).join('')}</div></div>
        <label class="set-row vlabel ${VS.showPlates?'':'off'}" style="display:block">Размер
          <input type="range" id="vpicw" min="6" max="95" step="1" value="${Math.round(VS.pic.w * 100)}"></label>
        <label class="set-row vlabel ${VS.showPlates?'':'off'}" style="display:block">Прозрачность
          <input type="range" id="vpica" min="15" max="100" step="1" value="${Math.round(VS.pic.alpha * 100)}"></label>
        <div class="set-row ${VS.showPlates?'':'off'}"><span>Не убирать<br><span class="muted small">показывать всё видео</span></span>
          <button class="switch ${VS.plateForever?'on':''}" data-act="vtoggle" data-k="plateForever" role="switch" aria-checked="${VS.plateForever}" aria-label="Не убирать картинку"></button></div>
        <div class="set-row ${VS.showPlates && !VS.plateForever?'':'off'}"><span>Убрать через<br><span class="muted small">секунд от начала подхода</span></span>
          <div class="stepper"><button data-act="vhide" data-d="-0.5" aria-label="Раньше">−</button><b>${fmtW(VS.plateHide)}</b><button data-act="vhide" data-d="0.5" aria-label="Позже">+</button></div></div>
      </div>
      <div class="card stack">
        ${VS.exportError ? `<div class="warn">${esc(VS.exportError)}</div>` : ''}
        ${VS.exported ? exportedCard() : ''}
        <button class="btn ${VS.exported?'ghost':''}" data-act="vexport" ${VS.exporting?'disabled':''}>${VS.exporting?'Сохраняю видео…':VS.exported?'Записать заново':'Сохранить видео'}</button>
        ${VS.exporting?'<div class="vprog"><i id="vexp" style="width:0%"></i></div>':''}
        <button class="btn ghost" data-act="vremark">Отметить заново</button>
      </div>`;
  }
  return `
    <div class="row" style="justify-content:space-between;align-items:center;margin:6px 0 10px">
      <h1 class="page-title" style="margin:0">Видео</h1>
      <button class="btn ghost" style="width:auto;min-height:40px;font-size:12px" data-act="vreset">Другое видео</button>
    </div>
    <div class="vstage" style="aspect-ratio:${VS.vw}/${VS.vh};width:min(100%, calc(62vh * ${(VS.vw / VS.vh).toFixed(4)}))"><div id="vslot"></div></div>
    <div class="vctrl">
      <button class="icon-btn" data-act="vplay" aria-label="Пуск/пауза" id="vplay">${IC.play}</button>
      <input type="range" id="vseek" min="0" max="${VS.dur}" step="0.01" value="${VS.el ? VS.el.currentTime : 0}">
      <span class="muted small" id="vtime">0:00</span>
    </div>
    ${panel}`;
}

// ---------- видео и холст живут между перерисовками ----------
function mountVideo(){
  const slot = document.getElementById('vslot');
  if (!slot || !VS.el) return;
  slot.appendChild(VS.el);
  slot.appendChild(VS.overlay);
  VS.acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#D22B1F';
  startOverlayLoop();
  if (VS.showPlates && VS.track) ensureSprite();
}
function startOverlayLoop(){
  cancelAnimationFrame(VS.raf);
  const loop = () => {
    if (view !== 'video' || !VS.el) return;
    // пока идёт отслеживание или запись — слой не перерисовываем, чтобы не тормозить
    if (!VS.tracking && !VS.exporting) drawOverlay(VS.overlay.getContext('2d'), VS.os || 1, VS.el.currentTime, false);
    else if (!VS.cleared) { VS.overlay.getContext('2d').clearRect(0, 0, VS.overlay.width, VS.overlay.height); }
    VS.cleared = VS.tracking || VS.exporting;
    const seek = document.getElementById('vseek'), tm = document.getElementById('vtime'), pb = document.getElementById('vplay');
    if (seek && document.activeElement !== seek) seek.value = VS.el.currentTime;
    if (tm) tm.textContent = fmtClock(VS.el.currentTime) + ' / ' + fmtClock(VS.dur);
    if (pb) pb.innerHTML = VS.el.paused ? IC.play : IC.pause;
    VS.raf = requestAnimationFrame(loop);
  };
  VS.raf = requestAnimationFrame(loop);
}
const fmtClock = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

function openVideo(file){
  resetVideo(false);
  VS.url = URL.createObjectURL(file);
  VS.name = (file.name || 'video').replace(/\.[^.]+$/, '');
  const v = document.createElement('video');
  v.src = VS.url; v.playsInline = true; v.muted = true; v.preload = 'auto';
  v.setAttribute('playsinline', ''); v.className = 'vvideo';
  const c = document.createElement('canvas'); c.className = 'voverlay';
  VS.el = v; VS.overlay = c;
  v.addEventListener('loadedmetadata', () => {
    VS.vw = v.videoWidth; VS.vh = v.videoHeight; VS.dur = v.duration || 0;
    // слой рисуется не в полном разрешении ролика (бывает 4K), а примерно как экран — так легче телефону
    VS.os = Math.min(1, 1000 / Math.max(VS.vw, VS.vh));
    c.width = Math.round(VS.vw * VS.os); c.height = Math.round(VS.vh * VS.os);
    render();
  }, {once:true});
  v.addEventListener('error', () => { toast('Это видео не открывается'); resetVideo(true); }, {once:true});
  const toVideo = e => { const r = c.getBoundingClientRect(); return {x:(e.clientX - r.left) / r.width * VS.vw, y:(e.clientY - r.top) / r.height * VS.vh}; };
  c.addEventListener('pointerdown', e => {
    if (VS.track && VS.showPlates && VS.sprite) {
      const q = toVideo(e), b = picRect(1);
      if (q.x >= b.x && q.x <= b.x + b.w && q.y >= b.y && q.y <= b.y + b.h) {
        VS.drag = {dx:q.x - b.x, dy:q.y - b.y};
        c.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (VS.track || VS.tracking) return;
    const r = c.getBoundingClientRect();
    VS.center = {x:(e.clientX - r.left) / r.width * VS.vw, y:(e.clientY - r.top) / r.height * VS.vh};
    if (!VS.radius) VS.radius = VS.vh * .16;
    VS.t0 = v.currentTime;
    v.pause(); buzz(); render();
  });
  c.addEventListener('pointermove', e => {
    if (!VS.drag) return;
    const q = toVideo(e), b = picRect(1);
    VS.pic.x = Math.min(1 - b.w / VS.vw, Math.max(0, (q.x - VS.drag.dx) / VS.vw));
    VS.pic.y = Math.min(1 - b.h / VS.vh, Math.max(0, (q.y - VS.drag.dy) / VS.vh));
  });
  const endDrag = () => { VS.drag = null; };
  c.addEventListener('pointerup', endDrag);
  c.addEventListener('pointercancel', endDrag);
}
// где стоит картинка с весом (в пикселях видео, k — масштаб)
function picRect(k){
  const w = VS.pic.w * VS.vw;
  const h = VS.sprite ? w * VS.sprite.canvas.height / VS.sprite.canvas.width : w;
  return {x:VS.pic.x * VS.vw * k, y:VS.pic.y * VS.vh * k, w:w * k, h:h * k};
}
function resetVideo(rerender){
  cancelAnimationFrame(VS.raf);
  if (VS.el) { VS.el.pause(); VS.el.removeAttribute('src'); VS.el.load(); }
  if (VS.url) URL.revokeObjectURL(VS.url);
  Object.assign(VS, {url:null, el:null, overlay:null, vw:0, vh:0, dur:0, center:null, radius:0, track:null, reps:null, tracking:false, progress:0, exporting:false, exported:null, exportError:''});
  if (rerender) render();
}

// ---------- отслеживание: сопоставление шаблона вокруг центра блина кадр за кадром ----------
// Каждый кадр копируется не целиком, а только небольшое окно вокруг прошлого положения блина:
// так в десятки раз меньше данных за кадр и телефон не тормозит.
async function runTracking(){
  const v = VS.el;
  VS.tracking = true; VS.cancel = false; VS.progress = 0; render();
  const s = Math.min(1, 360 / Math.max(1, VS.vw));                         // рабочий масштаб: ширина ~360 px
  VS.wscale = s;
  const FW = Math.round(VS.vw * s), FH = Math.round(VS.vh * s);
  const hs = Math.max(5, Math.min(18, Math.round(VS.radius * Math.max(.4, Math.cos(VS.angle * Math.PI / 180)) * s * .38)));   // половина шаблона
  const sr = Math.max(8, Math.round(hs * 1.5));                            // радиус поиска за кадр
  const n = 2 * hs + 1, R = sr + hs + 3, WN = 2 * R + 1;                   // окно WN×WN
  const cv = document.createElement('canvas'); cv.width = cv.height = WN;
  const cx = cv.getContext('2d', {willReadFrequently:true});
  const grab = (px, py) => {
    const ox = Math.round(px) - R, oy = Math.round(py) - R;
    cx.clearRect(0, 0, WN, WN);
    cx.drawImage(v, ox / s, oy / s, WN / s, WN / s, 0, 0, WN, WN);
    const d = cx.getImageData(0, 0, WN, WN).data, g = new Float32Array(WN * WN);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114;
    return {g, ox, oy};
  };
  const patch = (g, x, y) => {
    const p = new Float32Array(n * n); let k = 0, m = 0;
    for (let dy = -hs; dy <= hs; dy++) for (let dx = -hs; dx <= hs; dx++) {
      const val = g[Math.min(WN - 1, Math.max(0, y + dy)) * WN + Math.min(WN - 1, Math.max(0, x + dx))];
      p[k++] = val; m += val;
    }
    m /= k; for (let i = 0; i < k; i++) p[i] -= m;
    return p;
  };
  const cost = (g, tm, x, y, limit) => {
    let m = 0;
    for (let dy = -hs; dy <= hs; dy += 2) { const row = (y + dy) * WN; for (let dx = -hs; dx <= hs; dx += 2) m += g[row + x + dx]; }
    m /= Math.ceil(n / 2) ** 2;
    let sad = 0, k = 0;
    for (let dy = -hs; dy <= hs; dy++) {
      const row = (y + dy) * WN;
      for (let dx = -hs; dx <= hs; dx++) sad += Math.abs(g[row + x + dx] - m - tm[k++]);
      if (sad > limit) return sad;
    }
    return sad;
  };
  const search = (g, tm) => {
    let best = Infinity, bx = R, by = R;
    const tryAt = (x, y) => {
      if (x - hs < 0 || y - hs < 0 || x + hs >= WN || y + hs >= WN) return;
      const c = cost(g, tm, x, y, best);
      if (c < best) { best = c; bx = x; by = y; }
    };
    for (let oy = -sr; oy <= sr; oy += 2) for (let ox = -sr; ox <= sr; ox += 2) tryAt(R + ox, R + oy);
    const x0 = bx, y0 = by;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) tryAt(x0 + ox, y0 + oy);
    return {x:bx, y:by};
  };

  v.pause(); v.playbackRate = 1;
  await new Promise(r => { v.addEventListener('seeked', r, {once:true}); v.currentTime = VS.t0; });
  let px = VS.center.x * s, py = VS.center.y * s;
  let w0 = grab(px, py), tm = patch(w0.g, R, R);
  const raw = [{t:VS.t0, x:px / s, y:py / s}];

  // один кадр: найти блин рядом с прошлым положением и записать точку
  const processFrame = (t) => {
    const w = grab(px, py);
    const p = search(w.g, tm);
    px = Math.min(FW - 1, Math.max(0, w.ox + p.x)); py = Math.min(FH - 1, Math.max(0, w.oy + p.y));
    const cur = patch(w.g, p.x, p.y);
    for (let i = 0; i < tm.length; i++) tm[i] = tm[i] * .82 + cur[i] * .18;   // шаблон понемногу обновляется
    if (t > raw[raw.length - 1].t) raw.push({t, x:px / s, y:py / s});
    VS.progress = Math.min(1, (t - VS.t0) / Math.max(.01, VS.dur - VS.t0));
    const bar = document.getElementById('vprog'); if (bar) bar.style.width = Math.round(VS.progress * 100) + '%';
  };

  // основной способ: проигрываем видео на половинной скорости и обрабатываем каждый показанный кадр
  let played = true;
  await new Promise(resolve => {
    const step = (now, meta) => {
      const t = meta ? meta.mediaTime : v.currentTime;
      processFrame(t);
      if (VS.cancel || v.ended || t >= VS.dur - .03) return resolve();
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else setTimeout(() => step(0, null), 33);
    };
    v.addEventListener('ended', () => resolve(), {once:true});
    v.playbackRate = .5;
    v.play().then(() => { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else step(0, null); })
      .catch(() => { played = false; resolve(); });
  });
  v.pause(); v.playbackRate = 1;
  // запасной способ: если телефон не дал проиграть видео — перебираем кадры перемоткой
  if (!played && !VS.cancel) {
    const seekTo = t => new Promise(r => { v.addEventListener('seeked', r, {once:true}); v.currentTime = t; });
    for (let t = VS.t0 + 1 / 30; t < VS.dur - .02 && !VS.cancel; t += 1 / 30) {
      await seekTo(t);
      processFrame(t);
    }
  }
  VS.tracking = false;
  if (raw.length < 5) { toast('Не получилось отследить: видео не проигрывается или подход слишком короткий'); render(); return; }
  // сглаживание скользящим средним
  VS.track = raw.map((p, i) => {
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(raw.length - 1, i + 2); j++) { sx += raw[j].x; sy += raw[j].y; c++; }
    return {t:p.t, x:sx / c, y:sy / c};
  });
  VS.reps = null;
  v.currentTime = VS.t0;
  toast(VS.cancel ? 'Остановлено' : 'Готово');
  render();
}

function posAt(t){
  const tr = VS.track; if (!tr) return VS.center;
  if (t <= tr[0].t) return tr[0];
  if (t >= tr[tr.length - 1].t) return tr[tr.length - 1];
  let lo = 0, hi = tr.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tr[mid].t <= t) lo = mid; else hi = mid; }
  const a = tr[lo], b = tr[hi], k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return {t, x:a.x + (b.x - a.x) * k, y:a.y + (b.y - a.y) * k};
}

// ---------- цифры подхода: разбор на повторы ----------
// Ищем развороты штанги по вертикали (зигзаг с порогом 6 см). Каждый отрезок «снизу вверх» — подъём
// одного повтора. Время подъёма — от момента, когда штанга пошла вверх (3% пути), до 97% пути.
function videoReps(){
  if (VS.reps) return VS.reps;
  const tr = VS.track, mmPerPx = PLATE_MM / (VS.radius * 2);
  const H = 60 / mmPerPx;
  const piv = [0]; let dir = 0, ext = 0;
  for (let i = 1; i < tr.length; i++) {
    const y = tr[i].y;
    if (dir === 0) {
      if (y - tr[0].y >= H) { dir = 1; ext = i; }
      else if (tr[0].y - y >= H) { dir = -1; ext = i; }
    } else if (dir === 1) {                       // вниз (ось Y вниз): ищем нижнюю точку
      if (y > tr[ext].y) ext = i;
      else if (tr[ext].y - y >= H) { piv.push(ext); dir = -1; ext = i; }
    } else {                                      // вверх: ищем верхнюю точку
      if (y < tr[ext].y) ext = i;
      else if (y - tr[ext].y >= H) { piv.push(ext); dir = 1; ext = i; }
    }
  }
  if (dir !== 0) piv.push(ext);
  const reps = [];
  for (let k = 0; k + 1 < piv.length; k++) {
    const a = piv[k], b = piv[k + 1];
    const range = tr[a].y - tr[b].y;              // > 0 — подъём
    if (range < H) continue;
    let s = a, e = b;
    for (let i = a; i <= b; i++) if (tr[a].y - tr[i].y >= range * .03) { s = i; break; }
    for (let i = s; i <= b; i++) if (tr[a].y - tr[i].y >= range * .97) { e = i; break; }
    const dt = tr[e].t - tr[s].t;
    if (dt < .1) continue;
    const dist = (tr[s].y - tr[e].y) * mmPerPx / 1000;          // м
    let peak = 0;
    for (let i = s + 2; i <= e - 2; i++) peak = Math.max(peak, (tr[i - 2].y - tr[i + 2].y) * mmPerPx / 1000 / Math.max(1e-3, tr[i + 2].t - tr[i - 2].t));
    reps.push({time:dt, vel:dist / dt, peak:Math.max(peak, dist / dt), rise:dist * 100});
  }
  return (VS.reps = reps);
}
function videoStats(){
  const tr = VS.track, mmPerPx = PLATE_MM / (VS.radius * 2);
  const x0 = tr[0].x;
  // под углом движение вперёд-назад выглядит короче в cos(угла) раз
  const drift = Math.max(...tr.map(p => Math.abs(p.x - x0))) * mmPerPx / Math.max(.26, Math.cos(VS.angle * Math.PI / 180));
  const reps = videoReps();
  const f1 = v => v.toFixed(1).replace('.', ','), f2 = v => v.toFixed(2).replace('.', ',');
  const avg = reps.length ? reps.reduce((a, r) => a + r.vel, 0) / reps.length : 0;
  const drop = reps.length >= 2 ? Math.round((1 - reps[reps.length - 1].vel / reps[0].vel) * 100) : null;
  // погрешность: время — ±2 кадра (начало и конец подъёма), масштаб — круг по блину на глаз ±4%,
  // отслеживание — ±1,5 точки рабочего кадра
  const dts = tr.slice(1).map((p, i) => p.t - tr[i].t).filter(d => d > 0).sort((a, b) => a - b);
  const frame = dts.length ? dts[dts.length >> 1] : 1 / 30;
  const posMm = 1.5 / (VS.wscale || .5) * mmPerPx, scale = .04;
  const tErr = 2 * frame;
  const vRel = reps.length ? reps.reduce((a, r) => a + Math.sqrt(scale ** 2 + (tErr / r.time) ** 2 + (2 * posMm / Math.max(1, r.rise * 10)) ** 2), 0) / reps.length : 0;
  const dErr = (2 * posMm + drift * scale) / Math.max(.26, Math.cos(VS.angle * Math.PI / 180)) / 10;
  return {
    err:{time:f2(tErr), vel:Math.max(1, Math.round(vRel * 100)), drift:f1(Math.max(.1, dErr)), fps:Math.round(1 / frame)},
    drift:f1(drift / 10), count:reps.length,
    vel:reps.length ? f2(avg) : '—',
    time:reps.length ? f1(reps.reduce((a, r) => a + r.time, 0) / reps.length) : '—',
    drop, reps:reps.map((r, i) => ({n:i + 1, time:f2(r.time), vel:f2(r.vel), peak:f2(r.peak), rise:Math.round(r.rise)}))
  };
}

// ---------- слой поверх видео: траектория и блины ----------
function drawOverlay(ctx, k, t, exporting){
  const W = VS.vw * k, H = VS.vh * k;
  if (!exporting) ctx.clearRect(0, 0, W, H);
  const acc = VS.acc || '#D22B1F';
  const lw = Math.max(2, VS.vw * .007) * k;
  if (!VS.track) {
    if (!VS.center || exporting) return;
    // настройка: эллипс по краю блина, перекрестие в центре, направление грифа
    const cosA = Math.cos(VS.angle * Math.PI / 180), sinA = Math.sin(VS.angle * Math.PI / 180);
    ctx.save();
    ctx.lineWidth = lw; ctx.strokeStyle = acc; ctx.setLineDash([lw * 3, lw * 2]);
    ctx.beginPath(); ctx.ellipse(VS.center.x * k, VS.center.y * k, Math.max(1, VS.radius * cosA * k), VS.radius * k, 0, 0, Math.PI * 2); ctx.stroke();
    if (sinA > .05) {
      // куда уходит гриф (к спортсмену)
      ctx.beginPath(); ctx.moveTo(VS.center.x * k, VS.center.y * k);
      ctx.lineTo(VS.center.x * k - VS.side * VS.radius * 1.3 * sinA * k, VS.center.y * k); ctx.stroke();
    }
    ctx.setLineDash([]);
    const c = VS.radius * .18 * k;
    ctx.beginPath(); ctx.moveTo(VS.center.x * k - c, VS.center.y * k); ctx.lineTo(VS.center.x * k + c, VS.center.y * k);
    ctx.moveTo(VS.center.x * k, VS.center.y * k - c); ctx.lineTo(VS.center.x * k, VS.center.y * k + c); ctx.stroke();
    ctx.restore();
    return;
  }
  const p = posAt(t);
  if (VS.showPath) {
    ctx.save();
    ctx.globalAlpha = .72;  // траектория полупрозрачная, но хорошо заметная
    // вертикаль от стартовой точки
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = lw * .5; ctx.setLineDash([lw * 2.5, lw * 2]);
    ctx.beginPath(); ctx.moveTo(VS.track[0].x * k, 0); ctx.lineTo(VS.track[0].x * k, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = lw;
    ctx.strokeStyle = acc; ctx.lineWidth = lw;
    ctx.beginPath();
    let first = true;
    for (const q of VS.track) {
      if (q.t > t) break;
      if (first) { ctx.moveTo(q.x * k, q.y * k); first = false; } else ctx.lineTo(q.x * k, q.y * k);
    }
    ctx.lineTo(p.x * k, p.y * k);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(p.x * k, p.y * k, lw * 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = lw * .6; ctx.strokeStyle = acc; ctx.stroke();
    ctx.restore();
  }
  // картинка с весом: стоит на месте, полупрозрачная, гаснет через заданное время от начала подхода
  if (VS.showPlates) {
    if (!VS.sprite || VS.spriteKey !== spriteKey()) ensureSprite();
    if (VS.sprite) {
      const since = t - VS.t0;
      const fade = VS.plateForever ? 1 : since <= VS.plateHide ? 1 : Math.max(0, 1 - (since - VS.plateHide) / .4);
      // пока тащите пальцем — видна всегда, чтобы было понятно, куда ставите
      const alpha = (VS.drag ? 1 : fade) * VS.pic.alpha;
      if (alpha > 0) {
        const b = picRect(k);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.drawImage(VS.sprite.canvas, b.x, b.y, b.w, b.h);
        ctx.restore();
      }
    }
  }
}

// картинка для видео: тот же рисунок грифа с блинами, что в калькуляторе, и подпись веса
async function ensureSprite(){
  const key = spriteKey();
  if (VS.spriteKey === key && (VS.sprite || VS.spriteBusy)) return;
  VS.spriteKey = key; VS.spriteBusy = true;
  let canvas = null;
  try { canvas = await weightPicture(); } catch(e) { canvas = null; }
  VS.spriteBusy = false;
  if (VS.spriteKey !== key) return ensureSprite();   // пока рисовали, вес или вид уже поменяли
  if (canvas) VS.sprite = {canvas};
}
function spriteKey(){
  const s = state.settings;
  return `${VS.weight}|${s.plateStyle}|${s.plateBrand}|${s.bar}|${s.collars}|${s.capFont}`;
}
async function weightPicture(){
  const s = state.settings, r = loadPlates(VS.weight);
  let svg = barDrawing(r.under ? [] : r.plates, s.collars);
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const vw = +vb[1], vh = +vb[2], W = 900, H = Math.round(W * vh / vw);
  // для картинки: свои размеры, пространство имён, обводка (в приложении она в CSS)
  // и шрифт приложения — иначе телефон подставит свой и надписи на блинах будут другими
  svg = svg.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" `)
           .replace('<defs>', `<style>${appFontFaces()}.edge{stroke:rgba(0,0,0,.45);stroke-width:1}</style><defs>`);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const cap = 230;                                   // место под подпись веса
  const c = document.createElement('canvas');
  c.width = W; c.height = H + cap;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, W, H);
  // подпись веса на тёмной полупрозрачной плашке, шрифт — на выбор
  const f = CAPTION_FONTS[s.capFont] || CAPTION_FONTS.sys;
  const num = fmtW(VS.weight), unit = ' кг';
  g.textBaseline = 'alphabetic';
  g.font = f(150); const wn = g.measureText(num).width;
  g.font = f(84);  const wu = g.measureText(unit).width;
  const pw = wn + wu + 110, ph = 196, px = (W - pw) / 2, py = H + (cap - ph) / 2;
  g.fillStyle = 'rgba(12,13,15,.62)';
  g.beginPath();
  if (g.roundRect) g.roundRect(px, py, pw, ph, 28); else g.rect(px, py, pw, ph);
  g.fill();
  const base = py + ph / 2 + 52;
  g.fillStyle = '#fff'; g.textAlign = 'left';
  g.font = f(150); g.fillText(num, px + 55, base);
  g.fillStyle = 'rgba(255,255,255,.8)';
  g.font = f(84);  g.fillText(unit, px + 55 + wn, base);
  return c;
}
// шрифты подписи веса на видео
const CAPTION_FONTS = {
  sys:    px => `700 ${px}px system-ui, Roboto, "Segoe UI", sans-serif`,
  narrow: px => `600 ${px}px Oswald, "Roboto Condensed", sans-serif`,
  italic: px => `italic 800 ${px}px system-ui, Roboto, "Segoe UI", sans-serif`
};
// @font-face приложения (Oswald, встроен в страницу) — чтобы картинка рисовалась тем же шрифтом
let fontFacesCache = null;
function appFontFaces(){
  if (fontFacesCache === null) {
    const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\n');
    fontFacesCache = (css.match(/@font-face\{[^}]*\}/g) || []).join('');
  }
  return fontFacesCache;
}

// ---------- сохранение готового видео ----------
// Основной способ: каждый кадр видео с траекторией кодируется в H.264 и складывается в MP4 со своим
// временем (WebCodecs + mp4-muxer). Ролик получается плавным и с правильной длительностью,
// даже если телефон во время сохранения притормаживает. Запасной способ — запись холста (MediaRecorder).
async function exportVideo(){
  if (VS.exporting) return;
  VS.exporting = true; VS.exported = null; render();
  if (VS.showPlates) { await ensureSprite(); while (VS.spriteBusy) await new Promise(r => setTimeout(r, 50)); }
  const k = Math.min(1, 1280 / Math.max(VS.vw, VS.vh));
  const out = document.createElement('canvas');
  out.width = Math.round(VS.vw * k / 2) * 2; out.height = Math.round(VS.vh * k / 2) * 2;
  const ctx = out.getContext('2d');
  let res = null, why = '';
  try { res = await encodeMp4(out, ctx); } catch(e) { res = null; why = e.message || e.name; }
  if (!res) { try { res = await encodeRecorder(out, ctx); } catch(e) { res = null; why = e.message || e.name || why; } }
  VS.exportError = '';
  if (res && res.blob.size > 1000) await saveBlob(res.blob, `${(VS.name || 'podhod').replace(/[^\w.-]+/g, '_')}-traektoriya.${res.ext}`);
  else VS.exportError = 'Не получилось записать видео' + (why ? ': ' + why : '') + '. Напишите, какой у вас телефон и версия системы.';
  VS.exporting = false; render();
}
// проиграть видео с начала и вызвать onFrame(t) для каждого показанного кадра
function playFrames(onFrame, rate){
  const v = VS.el;
  return new Promise(async resolve => {
    v.pause();
    await new Promise(r => { v.addEventListener('seeked', r, {once:true}); v.currentTime = 0; });
    let done = false;
    const finish = () => { if (done) return; done = true; v.pause(); v.playbackRate = 1; resolve(); };
    const step = (now, meta) => {
      if (done) return;
      const t = meta ? meta.mediaTime : v.currentTime;
      onFrame(t);
      const bar = document.getElementById('vexp'); if (bar) bar.style.width = Math.round(t / VS.dur * 100) + '%';
      if (v.ended || t >= VS.dur - .03) return finish();
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else requestAnimationFrame(() => step(0, null));
    };
    v.addEventListener('ended', finish, {once:true});
    v.playbackRate = rate;
    v.play().then(() => { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else step(0, null); }).catch(finish);
  });
}
async function encodeMp4(out, ctx){
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined' || typeof Mp4Muxer === 'undefined') return null;
  const W = out.width, H = out.height, k = W / VS.vw;
  let cfg = null, codec = null;
  for (const [c, str] of [['avc', 'avc1.640028'], ['avc', 'avc1.4d0028'], ['avc', 'avc1.42001f'], ['avc', 'avc1.42002a'], ['vp9', 'vp09.00.40.08']]) {
    const conf = {codec:str, width:W, height:H, bitrate:6e6, framerate:30};
    if (c === 'avc') conf.avc = {format:'avc'};
    try { const r = await VideoEncoder.isConfigSupported(conf); if (r.supported) { cfg = r.config; codec = c; break; } } catch(e) {}
  }
  if (!cfg) return null;
  const muxer = new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(), video:{codec, width:W, height:H},
    fastStart:'in-memory', firstTimestampBehavior:'offset'});
  let err = null, n = 0, last = -1;
  const enc = new VideoEncoder({output:(chunk, meta) => muxer.addVideoChunk(chunk, meta), error:e => { err = e; }});
  enc.configure(cfg);
  await playFrames(t => {
    if (err || t <= last) return;
    last = t;
    ctx.drawImage(VS.el, 0, 0, W, H);
    drawOverlay(ctx, k, t, true);
    const vf = new VideoFrame(out, {timestamp:Math.round(t * 1e6)});
    enc.encode(vf, {keyFrame:n % 60 === 0});
    vf.close(); n++;
  }, .5);
  if (err || n < 2) { try { enc.close(); } catch(e) {} return null; }
  await enc.flush(); enc.close();
  muxer.finalize();
  return {blob:new Blob([muxer.target.buffer], {type:'video/mp4'}), ext:'mp4'};
}
async function encodeRecorder(out, ctx){
  if (typeof MediaRecorder === 'undefined') return null;
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || 'video/webm';
  const rec = new MediaRecorder(out.captureStream(30), {mimeType:mime, videoBitsPerSecond:8e6});
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => rec.onstop = r);
  const k = out.width / VS.vw;
  let started = false;
  await playFrames(t => {
    if (!started) { rec.start(500); started = true; }
    ctx.drawImage(VS.el, 0, 0, out.width, out.height);
    drawOverlay(ctx, k, t, true);
  }, 1);
  if (!started) return null;
  rec.stop(); await stopped;
  let blob = new Blob(chunks, {type:mime.split(';')[0]});
  // в WebM от MediaRecorder нет длительности — галерея показывает 0:00; дописываем её
  if (blob.type === 'video/webm') blob = await fixWebmDuration(blob, VS.dur * 1000);
  return {blob, ext:blob.type === 'video/mp4' ? 'mp4' : 'webm'};
}
// вставить Duration в заголовок WebM (секция Segment → Info)
async function fixWebmDuration(blob, ms){
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const vint = p => {
      let len = 1, mask = 0x80; while (len <= 8 && !(buf[p] & mask)) { len++; mask >>= 1; }
      let v = buf[p] & (mask - 1); for (let i = 1; i < len; i++) v = v * 256 + buf[p + i];
      return {len, v, unknown:v === Math.pow(2, 7 * len) - 1};
    };
    const eid = p => { let len = 1, mask = 0x80; while (len <= 4 && !(buf[p] & mask)) { len++; mask >>= 1; } let id = 0; for (let i = 0; i < len; i++) id = id * 256 + buf[p + i]; return {len, id}; };
    const enc = (val, len) => { const b = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { b[i] = val % 256; val = Math.floor(val / 256); } b[0] |= 1 << (8 - len); return b; };
    let p = 0, id = eid(p); if (id.id !== 0x1A45DFA3) return blob;
    let sz = vint(p + id.len); p += id.len + sz.len + sz.v;
    id = eid(p); if (id.id !== 0x18538067) return blob;                       // Segment
    const segSize = vint(p + id.len), segHead = p + id.len;
    let q = segHead + segSize.len;
    while (q < buf.length) {
      const cid = eid(q), csz = vint(q + cid.len), body = q + cid.len + csz.len;
      if (cid.id === 0x1549A966) {                                             // Info
        let r = body, scale = 1e6;
        while (r < body + csz.v) {
          const e = eid(r), es = vint(r + e.len), eb = r + e.len + es.len;
          if (e.id === 0x4489) return blob;                                    // длительность уже есть
          if (e.id === 0x2AD7B1) { scale = 0; for (let i = 0; i < es.v; i++) scale = scale * 256 + buf[eb + i]; }
          r = eb + es.v;
        }
        const dur = new Uint8Array(11); dur.set([0x44, 0x89, 0x88]);
        new DataView(dur.buffer).setFloat64(3, ms * 1e6 / scale);
        const head = buf.slice(0, q + cid.len);
        if (!segSize.unknown) head.set(enc(segSize.v + (8 - csz.len) + 11, segSize.len), segHead);
        return new Blob([head, enc(csz.v + 11, 8), dur, buf.subarray(body)], {type:blob.type});
      }
      if (csz.unknown) break;
      q = body + csz.v;
    }
  } catch(e) {}
  return blob;
}
async function saveBlob(blob, fname){
  // в APK — через системное окно «Сохранить как», кусками через мост
  if (window.AndroidBridge && AndroidBridge.beginFile) {
    if (!AndroidBridge.beginFile(fname, blob.type)) { toast('Не удалось сохранить'); return; }
    const CH = 512 * 1024;
    for (let i = 0; i < blob.size; i += CH) {
      const b = new Uint8Array(await blob.slice(i, i + CH).arrayBuffer());
      let s = ''; for (let j = 0; j < b.length; j += 8192) s += String.fromCharCode.apply(null, b.subarray(j, j + 8192));
      if (!AndroidBridge.appendFile(btoa(s))) { toast('Не удалось сохранить'); return; }
    }
    AndroidBridge.finishFile();
    return;
  }
  // в браузере: показываем карточку с кнопками — «Поделиться» и скачивание работают только по нажатию
  if (VS.exportedUrl) URL.revokeObjectURL(VS.exportedUrl);
  VS.exportedUrl = URL.createObjectURL(blob);
  VS.exported = {blob, fname};
  toast('Видео готово');
}
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function canShareFile(){
  try { return !!(VS.exported && navigator.canShare && navigator.canShare({files:[new File([VS.exported.blob], VS.exported.fname, {type:VS.exported.blob.type})]})); }
  catch(e) { return false; }
}
function exportedCard(){
  const x = VS.exported, mb = (x.blob.size / 1048576).toFixed(1).replace('.', ',');
  const kind = x.blob.type === 'video/mp4' ? 'MP4' : 'WebM';
  const share = canShareFile();
  const btns = IS_IOS
    ? (share ? `<button class="btn" data-act="vshare">Сохранить в Фото</button>` : '') +
      `<a class="btn ghost" href="${VS.exportedUrl}" download="${esc(x.fname)}" data-act="vdl">Скачать в Файлы</a>
       <a class="btn ghost" href="${VS.exportedUrl}" target="_blank" rel="noopener">Открыть видео</a>`
    : `<a class="btn" href="${VS.exportedUrl}" download="${esc(x.fname)}" data-act="vdl">Скачать видео</a>` +
      (share ? `<button class="btn ghost" data-act="vshare">Поделиться</button>` : '');
  return `<div class="vdone"><b>Видео готово</b><span class="muted small">${fmtClock(VS.dur)} · ${mb} МБ · ${kind}</span></div>${btns}
    ${IS_IOS ? '<div class="muted small">Если «Сохранить в Фото» не сработало: «Открыть видео» → значок «Поделиться» → «Сохранить видео».</div>' : ''}`;
}

// ---------- события вкладки ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'vplay' && VS.el) { if (VS.el.paused) VS.el.play().catch(()=>{}); else VS.el.pause(); }
  else if (act === 'vtrack') runTracking();
  else if (act === 'vcancel') VS.cancel = true;
  else if (act === 'vremark') { VS.track = null; VS.reps = null; VS.center = null; if (VS.el) VS.el.pause(); render(); }
  else if (act === 'vreset') resetVideo(true);
  else if (act === 'vtoggle') { VS[b.dataset.k] = !VS[b.dataset.k]; if (VS.showPlates) ensureSprite(); render(); }
  else if (act === 'vexport') { VS.exported = null; VS.exportError = ''; exportVideo(); }
  else if (act === 'vshare' && VS.exported) {
    // «Поделиться» вызываем сразу в обработчике нажатия — иначе браузер его не откроет
    try {
      const f = new File([VS.exported.blob], VS.exported.fname, {type:VS.exported.blob.type});
      navigator.share({files:[f], title:VS.exported.fname})
        .then(() => toast('Готово'))
        .catch(err => { if (err && err.name !== 'AbortError') { VS.exportError = 'Не открылось «Поделиться»: ' + (err.message || err.name) + '. Попробуйте «Скачать» или «Открыть видео».'; render(); } });
    } catch(err) { VS.exportError = 'Не открылось «Поделиться»: ' + (err.message || err.name); render(); }
  }
  else if (act === 'vdl') toast(IS_IOS ? 'Видео в приложении «Файлы» → Загрузки' : 'Видео сохраняется в «Загрузки»');
  else if (act === 'vside') { VS.side = +b.dataset.v; render(); }
  else if (act === 'vfont') { state.settings.capFont = b.dataset.v; save(); ensureSprite(); render(); }
  else if (act === 'vhide') { VS.plateHide = Math.min(60, Math.max(.5, Math.round((VS.plateHide + (+b.dataset.d)) * 10) / 10)); render(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'vfile' && e.target.files[0]) openVideo(e.target.files[0]);
  if (e.target.id === 'vweight') e.target.value = fmtW(VS.weight);
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'vweight') e.target.blur(); });
document.addEventListener('input', e => {
  if (e.target.id === 'vseek' && VS.el) VS.el.currentTime = +e.target.value;
  if (e.target.id === 'vrad') VS.radius = +e.target.value;
  if (e.target.id === 'vweight') {
    // вес набирается с клавиатуры: «142,5» или «142.5»; картинка обновляется сразу
    const w = parseFloat(e.target.value.replace(',', '.'));
    if (w >= 1 && w <= 600) { VS.weight = Math.round(w * 100) / 100; ensureSprite(); }
  }
  if (e.target.id === 'vpicw') VS.pic.w = +e.target.value / 100;
  if (e.target.id === 'vpica') VS.pic.alpha = +e.target.value / 100;
  if (e.target.id === 'vang') {
    VS.angle = +e.target.value;
    const lbl = document.getElementById('vangv'); if (lbl) lbl.textContent = VS.angle + '°';
    ensureSprite();
  }
});
