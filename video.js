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
      <label class="vlabel">Размер блина<input type="range" id="vrad" min="${Math.round(VS.vh*.04)}" max="${Math.round(VS.vh*.45)}" step="1" value="${Math.round(VS.radius)}"></label>
      <label class="vlabel">Угол съёмки <b id="vangv">${VS.angle}°</b><span class="muted small">0° — строго сбоку</span>
        <input type="range" id="vang" min="0" max="75" step="1" value="${VS.angle}"></label>
      <div class="opts">${[[1,'Гриф уходит влево'],[-1,'Гриф уходит вправо']].map(([v,l])=>`<button class="${VS.side===v?'on':''}" data-act="vside" data-v="${v}">${l}</button>`).join('')}</div>
      <button class="btn" data-act="vtrack">Отследить гриф</button>
      <button class="btn ghost" data-act="vremark">Отметить заново</button></div>`;
  } else {
    panel = `
      <div class="vstats">
        <div><b>${st.drift}</b><span>уход<br>см</span></div>
        <div><b>${st.vel}</b><span>скорость<br>м/с</span></div>
        <div><b>${st.time}</b><span>подъём<br>с</span></div>
      </div>
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
          <input type="range" id="vpicw" min="20" max="95" step="1" value="${Math.round(VS.pic.w * 100)}"></label>
        <label class="set-row vlabel ${VS.showPlates?'':'off'}" style="display:block">Прозрачность
          <input type="range" id="vpica" min="15" max="100" step="1" value="${Math.round(VS.pic.alpha * 100)}"></label>
        <div class="set-row ${VS.showPlates?'':'off'}"><span>Не убирать<br><span class="muted small">показывать всё видео</span></span>
          <button class="switch ${VS.plateForever?'on':''}" data-act="vtoggle" data-k="plateForever" role="switch" aria-checked="${VS.plateForever}" aria-label="Не убирать картинку"></button></div>
        <div class="set-row ${VS.showPlates && !VS.plateForever?'':'off'}"><span>Убрать через<br><span class="muted small">секунд от начала подхода</span></span>
          <div class="stepper"><button data-act="vhide" data-d="-0.5" aria-label="Раньше">−</button><b>${fmtW(VS.plateHide)}</b><button data-act="vhide" data-d="0.5" aria-label="Позже">+</button></div></div>
      </div>
      <div class="card stack">
        ${VS.exported ? `<button class="btn" data-act="vshare">Сохранить в Фото / поделиться</button>` : ''}
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
  startOverlayLoop();
  if (VS.showPlates && VS.track) ensureSprite();
}
function startOverlayLoop(){
  cancelAnimationFrame(VS.raf);
  const loop = () => {
    if (view !== 'video' || !VS.el) return;
    drawOverlay(VS.overlay.getContext('2d'), 1, VS.el.currentTime, false);
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
    c.width = VS.vw; c.height = VS.vh;
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
  Object.assign(VS, {url:null, el:null, overlay:null, vw:0, vh:0, dur:0, center:null, radius:0, track:null, tracking:false, progress:0, exporting:false, exported:null});
  if (rerender) render();
}

// ---------- отслеживание: сопоставление шаблона вокруг центра блина кадр за кадром ----------
async function runTracking(){
  const v = VS.el;
  VS.tracking = true; VS.cancel = false; VS.progress = 0; render();
  const W = 320, s = W / VS.vw, H = Math.max(1, Math.round(VS.vh * s));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', {willReadFrequently:true});
  const hs = Math.max(6, Math.min(18, Math.round(VS.radius * Math.max(.4, Math.cos(VS.angle * Math.PI / 180)) * s * .38)));   // половина размера шаблона
  const sr = Math.max(10, Math.round(hs * 1.5));                           // радиус поиска за кадр
  const n = 2 * hs + 1;
  const gray = () => {
    cx.drawImage(v, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114;
    return g;
  };
  const patch = (g, x, y) => {
    const p = new Float32Array(n * n); let k = 0, m = 0;
    for (let dy = -hs; dy <= hs; dy++) for (let dx = -hs; dx <= hs; dx++) {
      const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy));
      const val = g[yy * W + xx]; p[k++] = val; m += val;
    }
    m /= k; for (let i = 0; i < k; i++) p[i] -= m;
    return p;
  };
  const cost = (g, tm, x, y, limit) => {
    let m = 0;
    for (let dy = -hs; dy <= hs; dy += 2) { const row = (y + dy) * W; for (let dx = -hs; dx <= hs; dx += 2) m += g[row + x + dx]; }
    m /= Math.ceil(n / 2) ** 2;
    let sad = 0, k = 0;
    for (let dy = -hs; dy <= hs; dy++) {
      const row = (y + dy) * W;
      for (let dx = -hs; dx <= hs; dx++) { sad += Math.abs(g[row + x + dx] - m - tm[k++]); }
      if (sad > limit) return sad;
    }
    return sad;
  };
  const search = (g, tm, px, py) => {
    let best = Infinity, bx = px, by = py;
    const tryAt = (x, y) => {
      if (x - hs < 0 || y - hs < 0 || x + hs >= W || y + hs >= H) return;
      const c = cost(g, tm, x, y, best);
      if (c < best) { best = c; bx = x; by = y; }
    };
    for (let oy = -sr; oy <= sr; oy += 2) for (let ox = -sr; ox <= sr; ox += 2) tryAt(px + ox, py + oy);
    const cx0 = bx, cy0 = by;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) tryAt(cx0 + ox, cy0 + oy);
    return {x:bx, y:by};
  };

  v.pause(); v.playbackRate = 1;
  v.currentTime = VS.t0;
  await new Promise(r => v.addEventListener('seeked', r, {once:true}));
  let px = Math.round(VS.center.x * s), py = Math.round(VS.center.y * s);
  let tm = patch(gray(), px, py);
  const raw = [{t:VS.t0, x:px / s, y:py / s}];

  // один кадр: найти блин рядом с прошлым положением и записать точку
  const processFrame = (t) => {
    const g = gray();
    const p = search(g, tm, px, py);
    px = p.x; py = p.y;
    const cur = patch(g, px, py);
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

// ---------- цифры подхода ----------
function videoStats(){
  const tr = VS.track, mmPerPx = PLATE_MM / (VS.radius * 2);
  let low = 0;
  tr.forEach((p, i) => { if (p.y > tr[low].y) low = i; });         // самая нижняя точка (ось Y вниз)
  let top = low;
  for (let i = low; i < tr.length; i++) if (tr[i].y < tr[top].y) top = i; // верх после подъёма
  const rise = (tr[low].y - tr[top].y) * mmPerPx;                     // мм
  const dt = tr[top].t - tr[low].t;
  const x0 = tr[0].x;
  // под углом движение вперёд-назад выглядит короче в cos(угла) раз
  const drift = Math.max(...tr.map(p => Math.abs(p.x - x0))) * mmPerPx / Math.max(.26, Math.cos(VS.angle * Math.PI / 180));
  const rom = (Math.max(...tr.map(p => p.y)) - Math.min(...tr.map(p => p.y))) * mmPerPx;
  const f1 = v => v.toFixed(1).replace('.', ',');
  return {
    rom: f1(rom / 10), drift: f1(drift / 10),
    vel: dt > .05 && rise > 20 ? (rise / 1000 / dt).toFixed(2).replace('.', ',') : '—',
    time: dt > .05 && rise > 20 ? f1(dt) : '—'
  };
}

// ---------- слой поверх видео: траектория и блины ----------
function drawOverlay(ctx, k, t, exporting){
  const W = VS.vw * k, H = VS.vh * k;
  if (!exporting) ctx.clearRect(0, 0, W, H);
  const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#D22B1F';
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
async function exportVideo(){
  if (VS.exporting) return;
  if (typeof MediaRecorder === 'undefined') { toast('Запись видео не поддерживается'); return; }
  VS.exporting = true; render();
  if (VS.showPlates) { await ensureSprite(); while (VS.spriteBusy) await new Promise(r => setTimeout(r, 50)); }
  const v = VS.el;
  const k = Math.min(1, 1280 / Math.max(VS.vw, VS.vh));
  const out = document.createElement('canvas');
  out.width = Math.round(VS.vw * k / 2) * 2; out.height = Math.round(VS.vh * k / 2) * 2;
  const ctx = out.getContext('2d');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || 'video/webm';
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const rec = new MediaRecorder(out.captureStream(30), {mimeType:mime, videoBitsPerSecond:8e6});
  const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => rec.onstop = r);
  v.pause(); v.currentTime = 0;
  await new Promise(r => v.addEventListener('seeked', r, {once:true}));
  rec.start(500);
  await new Promise(resolve => {
    const frame = (now, meta) => {
      const t = meta ? meta.mediaTime : v.currentTime;
      ctx.drawImage(v, 0, 0, out.width, out.height);
      drawOverlay(ctx, out.width / VS.vw, t, true);
      const bar = document.getElementById('vexp'); if (bar) bar.style.width = Math.round(t / VS.dur * 100) + '%';
      if (v.ended || t >= VS.dur - .03) return resolve();
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(frame); else requestAnimationFrame(() => frame(0, null));
    };
    v.addEventListener('ended', () => resolve(), {once:true});
    v.play().then(() => { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(frame); else frame(0, null); }).catch(resolve);
  });
  v.pause();
  rec.stop(); await stopped;
  const blob = new Blob(chunks, {type:mime.split(';')[0]});
  const fname = `${VS.name || 'podhod'}-traektoriya.${ext}`;
  await saveBlob(blob, fname);
  VS.exporting = false; render();
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
  // меню «Поделиться» можно открыть только по нажатию — после долгой записи показываем кнопку
  const probe = new File([blob], fname, {type:blob.type});
  if (navigator.canShare && navigator.canShare({files:[probe]})) {
    VS.exported = {blob, fname};
    toast('Видео готово — нажмите «Сохранить в Фото»');
    return;
  }
  await shareOrDownload(blob, fname);
  toast('Видео сохранено');
}

// ---------- события вкладки ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'vplay' && VS.el) { if (VS.el.paused) VS.el.play().catch(()=>{}); else VS.el.pause(); }
  else if (act === 'vtrack') runTracking();
  else if (act === 'vcancel') VS.cancel = true;
  else if (act === 'vremark') { VS.track = null; VS.center = null; if (VS.el) VS.el.pause(); render(); }
  else if (act === 'vreset') resetVideo(true);
  else if (act === 'vtoggle') { VS[b.dataset.k] = !VS[b.dataset.k]; if (VS.showPlates) ensureSprite(); render(); }
  else if (act === 'vexport') { VS.exported = null; exportVideo(); }
  else if (act === 'vshare' && VS.exported) {
    shareOrDownload(VS.exported.blob, VS.exported.fname).then(r => { if (r !== 'cancelled') toast('Готово'); });
  }
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
