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
      ${['Выберите видео подхода из галереи','Поставьте на начало подхода и нажмите на центр блина','В режиме «Агент» эллипс встанет по краю блина сам, в ручном — подгоните размер. Укажите угол съёмки и сторону','Нажмите «Отследить» и сохраните видео с траекторией и блинами']
        .map((t,i)=>`<div class="check-row"><b class="vstep">${i+1}</b><span>${t}</span></div>`).join('')}
    </div>`;

  const tracked = !!VS.track, agent = plateMode() === 'agent';
  const modeSwitch = `<div class="opts" role="group" aria-label="Как ставить эллипс">${[['manual','Ручной'],['agent','Агент']]
    .map(([v,l])=>`<button class="${plateMode()===v?'on':''}" data-act="vmode" data-v="${v}" aria-pressed="${plateMode()===v}">${l}</button>`).join('')}</div>`;
  const st = tracked ? videoStats() : null;
  let panel = '';
  if (VS.tracking) {
    panel = `<div class="card stack">
      <div class="kicker">Отслеживаю гриф…</div>
      <div class="vprog"><i id="vprog" style="width:${Math.round(VS.progress*100)}%"></i></div>
      <button class="btn ghost" data-act="vcancel">Остановить</button></div>`;
  } else if (!VS.center) {
    panel = `<div class="card stack">${modeSwitch}
      <div class="vhint"><b class="vstep">1</b><span>Перемотайте на начало подхода и нажмите пальцем на <b>центр блина</b> (торец грифа).${agent ? ' Агент сам найдёт край блина.' : ''}</span></div></div>`;
  } else if (!tracked) {
    panel = `<div class="card stack">
      ${modeSwitch}
      <div class="vhint"><b class="vstep">2</b><span>${!agent ? 'Подгоните эллипс под край блина: по высоте блина считаются сантиметры.'
        : VS.autoOk ? 'Агент поставил эллипс по краю блина и определил угол. Проверьте: если промахнулся — подправьте размер и угол.'
        : 'Агент не нашёл край блина — подгоните эллипс вручную. По высоте блина считаются сантиметры.'}</span></div>
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
    VS.tap = {x:(e.clientX - r.left) / r.width * VS.vw, y:(e.clientY - r.top) / r.height * VS.vh};
    VS.t0 = v.currentTime;
    v.pause(); buzz();
    VS.center = {...VS.tap}; VS.autoOk = false; if (!VS.radius) VS.radius = VS.vh * .16;
    if (plateMode() === 'agent') autoPlate();
    render();
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
  Object.assign(VS, {url:null, el:null, overlay:null, vw:0, vh:0, dur:0, center:null, tap:null, autoOk:false, radius:0, track:null, reps:null, tracking:false, progress:0, exporting:false, exported:null, exportError:''});
  if (rerender) render();
}

// ---------- режим «Агент»: край блина находится сам ----------
// От точки тапа идут лучи во все стороны, на каждом отмечаются перепады яркости. Среди этих точек ищем овал
// (блин под углом виден овалом; по соотношению сторон агент сам определяет угол съёмки). Каждый луч
// пересекает край блина, даже если палец попал не в центр. В зале много контрастного, и большой овал
// случайно «совпадает» со многими точками — это ожидаемое число совпадений вычитается из оценки.
// Возвращает {x, y, r, angle, conf} в пикселях кадра или null, если блин не нашёлся.
function detectPlate(src, sw, sh, c0, moved){
  const s = Math.min(1, 960 / Math.max(sw, sh));
  const W = Math.round(sw * s), H = Math.round(sh * s);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx2 = cv.getContext('2d', {willReadFrequently:true});
  cx2.drawImage(src, 0, 0, W, H);
  const d = cx2.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114;
  const at = (x, y) => {
    if (x < 0 || y < 0 || x > W - 2 || y > H - 2) return NaN;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + W] * (1 - fx) + g[i + W + 1] * fx) * fy;
  };
  // второй кадр, где штанга сдвинулась: карта перепадов яркости, чтобы отличить блин (двигается) от зала (стоит)
  let G2 = null, mdx = 0, mdy = 0;
  if (moved) {
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const x2 = c2.getContext('2d', {willReadFrequently:true}); x2.drawImage(moved.src, 0, 0, W, H);
    const d2 = x2.getImageData(0, 0, W, H).data, q = new Float32Array(W * H);
    for (let i = 0, j = 0; i < q.length; i++, j += 4) q[i] = d2[j] * .299 + d2[j + 1] * .587 + d2[j + 2] * .114;
    G2 = new Float32Array(W * H);
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      const i = y * W + x; G2[i] = Math.hypot(q[i + 2] - q[i - 2], q[i + 2 * W] - q[i - 2 * W]) * .75;
    }
    mdx = moved.dx * s; mdy = moved.dy * s;
  }
  const movedEdge = (x, y) => {                              // самый сильный перепад во втором кадре рядом с точкой
    const xi = Math.round(x), yi = Math.round(y); let m = 0;
    if (xi < 3 || yi < 3 || xi > W - 4 || yi > H - 4) return 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m = Math.max(m, G2[(yi + dy) * W + xi + dx]);
    return m;
  };
  const bMin = Math.max(6, H * .025), bMax = H * .2, N = 120, L = Math.round(bMax * 1.9);
  const cx = c0.x * s, cy = c0.y * s, pts = [], dens = new Float32Array(N);
  let rays = 0;
  for (let k = 0; k < N; k++) {
    const th = k / N * Math.PI * 2, ux = Math.cos(th), uy = Math.sin(th);
    const prof = [];
    for (let r = 0; r <= L; r++) { const v = at(cx + ux * r, cy + uy * r); if (Number.isNaN(v)) break; prof.push(v); }
    const e = new Float32Array(prof.length); let mx = 0;
    for (let r = 2; r + 2 < prof.length; r++) { e[r] = Math.abs((prof[r + 1] + prof[r + 2]) / 2 - (prof[r - 2] + prof[r - 1]) / 2); if (e[r] > mx) mx = e[r]; }
    if (mx < 8) continue;
    rays++;
    let np = 0;
    for (let r = 3; r + 3 < prof.length; r++)
      if (e[r] >= 10 && e[r] >= mx * .12 && e[r] >= e[r - 1] && e[r] > e[r + 1]) {
        // край зала остаётся на месте, край блина уезжает вместе со штангой — оставляем только такие
        if (G2) { const x = cx + ux * r, y = cy + uy * r; if (movedEdge(x + mdx, y + mdy) < Math.max(8, e[r] * .35)) continue; }
        pts.push({x:ux * r, y:uy * r, k}); np++;
      }
    dens[k] = np / Math.max(1, prof.length);                // перепадов на пиксель луча — «шум» этого луча
  }
  if (rays < N * .4 || pts.length < 30) return null;
  const P = pts.length, PX = new Float32Array(P), PY = new Float32Array(P), PK = new Int16Array(P);
  pts.forEach((p, i) => { PX[i] = p.x; PY[i] = p.y; PK[i] = p.k; });
  let D = 0; for (let k = 0; k < N; k++) D += dens[k];          // ожидаемые случайные совпадения на пиксель ширины кольца
  const tolOf = b => Math.max(1.5, b * .03);
  // овал с осями по горизонтали и вертикали: A·x² + y² + D·x + E·y + F = 0 (наименьшие квадраты)
  const fit = idx => {
    const M = [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]];
    for (const i of idx) { const x = PX[i], y = PY[i], v = [x * x, x, y, 1], rhs = -y * y;
      for (let a = 0; a < 4; a++) { for (let c = 0; c < 4; c++) M[a][c] += v[a] * v[c]; M[a][4] += v[a] * rhs; } }
    for (let i = 0; i < 4; i++) {
      let q = i; for (let j = i + 1; j < 4; j++) if (Math.abs(M[j][i]) > Math.abs(M[q][i])) q = j;
      [M[i], M[q]] = [M[q], M[i]];
      if (Math.abs(M[i][i]) < 1e-12) return null;
      for (let j = 0; j < 4; j++) if (j !== i) { const f = M[j][i] / M[i][i]; for (let k = i; k < 5; k++) M[j][k] -= f * M[i][k]; }
    }
    const A = M[0][4] / M[0][0], Dx = M[1][4] / M[1][1], E = M[2][4] / M[2][2], F = M[3][4] / M[3][3];
    if (!(A > 0)) return null;
    const x0 = -Dx / (2 * A), y0 = -E / 2, rhs = A * x0 * x0 + y0 * y0 - F;
    if (!(rhs > 0)) return null;
    const b = Math.sqrt(rhs), a = Math.sqrt(rhs / A);
    return {x0, y0, b, q:a / b};
  };
  const ok = e => e && e.b >= bMin && e.b <= bMax && e.q >= .2 && e.q <= 1.1 &&
    Math.abs(e.y0) <= e.b * .3 + 2 && Math.abs(e.x0) <= e.b * .75 + 2;  // центр по высоте — у пальца; вбок — торец грифа торчит под углом
  const inliers = e => {
    const tol = tolOf(e.b), out = [];
    for (let i = 0; i < P; i++) { const r = Math.hypot((PX[i] - e.x0) / e.q, PY[i] - e.y0); if (Math.abs(r - e.b) < tol) out.push(i); }
    return out;
  };
  // край блина виден по всей окружности (12 секторов); «овал» из двух стоек или линий помоста — только по бокам
  const score = e => {
    const inl = inliers(e), hit = new Uint8Array(N), sec = new Uint8Array(12); let n = 0;
    // сколько перепадов приходится на пиксель рядом с контуром (0,7–1,4 размера, без самого контура) — фон вокруг
    const t = tolOf(e.b); let wide = 0, near2 = 0;
    for (let i = 0; i < P; i++) { const r = Math.hypot((PX[i] - e.x0) / e.q, PY[i] - e.y0);
      if (r > e.b * .7 && r < e.b * 1.4) { wide++; if (Math.abs(r - e.b) < 2 * t) near2++; } }
    const rate = (wide - near2) / Math.max(1, e.b * .7 - 4 * t);
    for (const i of inl) {
      if (!hit[PK[i]]) { hit[PK[i]] = 1; n++; }
      const ph = Math.atan2(PY[i] - e.y0, (PX[i] - e.x0) / e.q);
      sec[Math.min(11, Math.floor((ph + Math.PI) / (Math.PI * 2) * 12))] = 1;
    }
    let cover = 0; for (const v of sec) cover += v;
    return {n, sig:n - rate * 2 * t, inl, cover};
  };
  // перебор: форма овала × центр рядом с пальцем; для каждого — «радиус», на котором сходится больше всего лучей
  const nb = Math.ceil(bMax * 1.45) + 3, hist = new Float32Array(nb), cum = new Float32Array(nb + 1), cand = [];
  const step = Math.max(2, H * .01), YR = H * .075, XR = H * .19;
  for (const q of [1, .9, .8, .7, .6, .5, .4, .3]) {
    for (let y0 = -YR; y0 <= YR; y0 += step) for (let x0 = -XR; x0 <= XR; x0 += step) {
      hist.fill(0);
      for (let i = 0; i < P; i++) { const dx = (PX[i] - x0) / q, dy = PY[i] - y0, r = Math.sqrt(dx * dx + dy * dy); if (r < nb - 1) hist[r | 0] += 1; }
      for (let j = 0; j < nb; j++) cum[j + 1] = cum[j] + hist[j];
      let best = null;
      for (let b = Math.ceil(bMin); b <= bMax; b++) {
        const t = Math.round(tolOf(b));
        const v = cum[Math.min(nb, b + t + 1)] - cum[Math.max(0, b - t)];
        const wide = cum[Math.min(nb, Math.round(b * 1.4))] - cum[Math.round(b * .7)];
        const near2 = cum[Math.min(nb, b + 2 * t + 1)] - cum[Math.max(0, b - 2 * t)];
        const sig = v - (wide - near2) / Math.max(1, b * .7 - 4 * t) * 2 * t;   // кольцо против его окружения
        if (sig > (best ? best.sig : N * .2) && Math.abs(y0) <= b * .3 + 2 && Math.abs(x0) <= b * .75 + 2) best = {x0, y0, q, b, sig};
      }
      if (best) cand.push(best);
    }
  }
  if (!cand.length) return null;
  cand.sort((a, b) => b.sig - a.sig);
  // уточняем лучшие варианты по их точкам и убираем дубли — остаются разные контуры
  const found = [];
  for (const c of cand.slice(0, 200)) {
    let e = c;
    for (let i = 0; i < 3; i++) { const inl = inliers(e); const e2 = inl.length >= 8 ? fit(inl) : null; if (!ok(e2)) break; e = e2; }
    const sc = score(e);
    if (sc.cover < 10) continue;
    const set = new Set(sc.inl);
    // контур, точки которого почти все уже объяснены более сильным контуром, — его же вариант
    if (found.some(f => { let o = 0; for (const i of sc.inl) if (f.set.has(i)) o++; return o > sc.inl.length * .5; })) continue;
    found.push({...e, n:sc.n, sig:sc.sig, set});
    if (found.length >= 8) break;
  }
  if (!found.length) return null;
  const top = found.reduce((a, b) => b.sig > a.sig ? b : a);
  if (top.sig < N * .35) return null;
  // рядом есть почти такой же сильный, но другой контур — агент не уверен, лучше честно отдать ручной подгонке
  const rival = found.find(f => f !== top && f.sig > top.sig * .85 &&
    !(Math.abs(f.q - top.q) < .15 && Math.hypot(f.x0 - top.x0, f.y0 - top.y0) < Math.max(f.b, top.b) * .1));
  if (rival) return null;
  // край блина — самый большой контур той же формы и с тем же центром (ступица, кольца, обод — внутри)
  const pick = found.filter(f => f.sig >= top.sig * .6 && Math.abs(f.q - top.q) < .15 &&
      Math.hypot(f.x0 - top.x0, f.y0 - top.y0) < Math.max(3, Math.max(f.b, top.b) * .1))
    .sort((a, b) => b.b - a.b)[0];
  const angle = pick.q >= .9 ? 0 : Math.round(Math.acos(pick.q) * 180 / Math.PI);   // почти круг — снято сбоку
  return {x:(cx + pick.x0) / s, y:(cy + pick.y0) / s, r:pick.b / s, angle, conf:pick.n / N};
}
// Где штанга заметно сдвинулась: листаем видео вперёд от тапа и следим за кусочком кадра вокруг пальца.
// Возвращает {src: кадр, dx, dy} (сдвиг в пикселях кадра) или null, если штанга не двигалась.
async function findMotion(v, tap, t0){
  const s = Math.min(1, 480 / Math.max(VS.vw, VS.vh)), W = Math.round(VS.vw * s), H = Math.round(VS.vh * s);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', {willReadFrequently:true});
  const gray = () => { cx.drawImage(v, 0, 0, W, H); const d = cx.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114; return g; };
  const seek = t => new Promise(r => { const done = () => r(); v.addEventListener('seeked', done, {once:true}); v.currentTime = t; setTimeout(done, 1500); });
  const hs = Math.max(6, Math.round(H * .025)), px = Math.round(tap.x * s), py = Math.round(tap.y * s);
  if (px - hs < 0 || py - hs < 0 || px + hs >= W || py + hs >= H) return null;
  const g0 = gray(), tpl = [];
  for (let dy = -hs; dy <= hs; dy++) for (let dx = -hs; dx <= hs; dx++) tpl.push(g0[(py + dy) * W + px + dx]);
  let best = null, x = px, y = py;
  const sr = Math.round(H * .12);
  for (let t = t0 + .25; t < Math.min(VS.dur - .05, t0 + 6); t += .25) {
    await seek(t);
    const g = gray(); let bs = Infinity, bx = x, by = y;
    for (let yy = Math.max(hs, y - sr); yy <= Math.min(H - hs - 1, y + sr); yy += 1) for (let xx = Math.max(hs, x - sr * .5); xx <= Math.min(W - hs - 1, x + sr * .5); xx += 1) {
      let sad = 0, k = 0;
      for (let dy = -hs; dy <= hs; dy += 2) for (let dx = -hs; dx <= hs; dx += 2) { sad += Math.abs(g[(yy + dy) * W + xx + dx] - tpl[(dy + hs) * (2 * hs + 1) + dx + hs]); k++; }
      if (sad / k < bs) { bs = sad / k; bx = xx; by = yy; }
    }
    if (bs > 40) break;                                       // потеряли точку — дальше не ищем
    x = bx; y = by;
    const dist = Math.hypot(x - px, y - py);
    if (!best || dist > best.dist) {
      const keep = document.createElement('canvas'); keep.width = VS.vw; keep.height = VS.vh;
      keep.getContext('2d').drawImage(v, 0, 0, VS.vw, VS.vh);
      best = {src:keep, dx:(x - px) / s, dy:(y - py) / s, dist};
    }
    if (dist > H * .08) break;                                // штанга уехала достаточно далеко
  }
  return best && best.dist > H * .02 ? best : null;
}
// найти блин от точки тапа и поставить эллипс; при неудаче — эллипс по умолчанию и ручная подстройка
async function autoPlate(){
  if (!VS.tap || !VS.el || VS.agentBusy) return;
  VS.agentBusy = true; toast('Агент ищет блин…');
  const v = VS.el, t0 = VS.t0;
  let res = null, moved = null;
  try { moved = await findMotion(v, VS.tap, t0); } catch(err) { moved = null; }
  await new Promise(r => { v.addEventListener('seeked', r, {once:true}); v.currentTime = t0; setTimeout(r, 1500); });
  try { res = detectPlate(v, VS.vw, VS.vh, VS.tap, moved); } catch(err) { res = null; }
  VS.agentBusy = false;
  if (VS.track || !VS.tap) return;                          // пока искали, пользователь уже ушёл дальше
  VS.autoOk = !!res;
  if (res) { VS.center = {x:res.x, y:res.y}; VS.radius = res.r; VS.angle = res.angle; }
  else { VS.center = {...VS.tap}; if (!VS.radius) VS.radius = VS.vh * .16; }
  toast(res ? `Агент нашёл блин · угол ${res.angle}°` : 'Агент не нашёл блин — подгоните размер и угол вручную');
  render();
}
const plateMode = () => state.settings.plateMode || 'agent';

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
  // скорость вверх (м/с) в точке i по соседним кадрам
  const velAt = i => {
    const i0 = Math.max(0, i - 2), i1 = Math.min(tr.length - 1, i + 2);
    return (tr[i0].y - tr[i1].y) * mmPerPx / 1000 / Math.max(1e-3, tr[i1].t - tr[i0].t);
  };
  const ups = [];
  for (let k = 0; k + 1 < piv.length; k++) {
    const a = piv[k], b = piv[k + 1];
    if (tr[a].y - tr[b].y >= H) ups.push([a, b]);   // > 0 — подъём
  }
  // отскок блинов от пола или дёрганье штанги — не повтор: подъём должен быть не меньше 45% самого большого
  const full = Math.max(0, ...ups.map(([a, b]) => tr[a].y - tr[b].y));
  const reps = [];
  for (const [a, b] of ups) {
    const range = tr[a].y - tr[b].y;
    if (range < full * .45) continue;
    let ip = a, peak = 0;
    for (let i = a; i <= b; i++) { const v = velAt(i); if (v > peak) { peak = v; ip = i; } }
    // начало — где штанга реально пошла вверх: скорость выше 8% пиковой (пауза на полу или на груди не считается)
    let s = ip;
    while (s > a && velAt(s - 1) > Math.max(.02, peak * .08)) s--;
    for (let i = a; i <= ip; i++) if (tr[a].y - tr[i].y >= range * .03) { s = Math.max(s, i); break; }
    let e = b;
    for (let i = s; i <= b; i++) if (tr[a].y - tr[i].y >= range * .97) { e = i; break; }
    const dt = tr[e].t - tr[s].t;
    if (dt < .15) continue;
    const dist = (tr[s].y - tr[e].y) * mmPerPx / 1000;          // м
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
  // Safari отдаёт кадры с холста для записи, только если холст есть на странице — держим его невидимым
  out.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1';
  document.body.appendChild(out);
  const ctx = out.getContext('2d');
  const why = [];
  const msg = e => (e && (e.message || e.name)) || String(e);
  let res = null;
  try { res = await encodeMp4(out, ctx); } catch(e) { why.push('MP4: ' + msg(e)); }
  if (!res) { try { res = await encodeRecorder(out, ctx); } catch(e) { why.push('запись: ' + msg(e)); } }
  out.remove();
  VS.exportError = '';
  if (res) await saveBlob(res.blob, `${(VS.name || 'podhod').replace(/[^\w.-]+/g, '_')}-traektoriya.${res.ext}`);
  else VS.exportError = 'Не получилось записать видео. ' + (why.join('; ') || 'причина неизвестна') + '. Пришлите, пожалуйста, скриншот этого сообщения.';
  VS.exporting = false; render();
}
// Кадр видео на холст для записи. Телефон иногда не успевает отдать кадр во время проигрывания:
// рисование молча ничего не делает или даёт чёрный кадр. Раньше на холсте тогда оставался прошлый кадр
// с траекторией и картинкой, и полупрозрачное накладывалось второй раз — видео мигало.
// Теперь холст очищается, а пустой или резко потемневший кадр заменяется последним нормальным.
function videoFramePainter(out, ctx){
  const W = out.width, H = out.height;
  const probe = document.createElement('canvas'); probe.width = probe.height = 24;
  const pc = probe.getContext('2d', {willReadFrequently:true});
  const keep = document.createElement('canvas'); keep.width = W; keep.height = H;
  const kc = keep.getContext('2d');
  let base = null, have = false;
  const painter = () => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    try { ctx.drawImage(VS.el, 0, 0, W, H); } catch(e) {}
    pc.clearRect(0, 0, 24, 24); pc.drawImage(out, 0, 0, 24, 24);
    const d = pc.getImageData(0, 0, 24, 24).data; let y = 0;
    for (let i = 0; i < d.length; i += 4) y += d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
    y /= 576;
    if (have && base > 10 && y < base * .4) { ctx.drawImage(keep, 0, 0); painter.bad++; return; }
    base = base === null ? y : base * .85 + y * .15;
    kc.drawImage(out, 0, 0); have = true;
  };
  painter.bad = 0;
  return painter;
}
// проиграть видео с начала и вызвать onFrame(t) для каждого показанного кадра;
// если onFrame вернёт false — остановиться
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
      let go = true;
      try { go = onFrame(t) !== false; } catch(e) { go = false; }
      const bar = document.getElementById('vexp'); if (bar) bar.style.width = Math.round(t / VS.dur * 100) + '%';
      if (!go || v.ended || t >= VS.dur - .03) return finish();
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else requestAnimationFrame(() => step(0, null));
    };
    v.addEventListener('ended', finish, {once:true});
    v.playbackRate = rate;
    v.play().then(() => { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step); else step(0, null); }).catch(finish);
  });
}
// MP4 кадр за кадром (WebCodecs + mp4-muxer). Ошибку бросает с понятной причиной.
async function encodeMp4(out, ctx){
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('браузер не умеет кодировать видео (нет WebCodecs)');
  if (typeof Mp4Muxer === 'undefined') throw new Error('не загрузился модуль MP4');
  const W = out.width, H = out.height, k = W / VS.vw;
  let cfg = null, codec = null;
  for (const [c, str] of [['avc', 'avc1.640028'], ['avc', 'avc1.4d0028'], ['avc', 'avc1.42001f'], ['avc', 'avc1.42002a'], ['vp9', 'vp09.00.40.08']]) {
    const conf = {codec:str, width:W, height:H, bitrate:6e6, framerate:30};
    if (c === 'avc') conf.avc = {format:'avc'};
    try { const r = await VideoEncoder.isConfigSupported(conf); if (r.supported) { cfg = r.config; codec = c; break; } } catch(e) {}
  }
  if (!cfg) throw new Error(`кодек H.264 не поддерживается для ${W}×${H}`);
  const muxer = new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(), video:{codec, width:W, height:H},
    fastStart:'in-memory', firstTimestampBehavior:'offset'});
  let err = null, n = 0, last = -1, mode = 'canvas';
  const enc = new VideoEncoder({output:(chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch(e) { err = err || e; } }, error:e => { err = err || e; }});
  enc.configure(cfg);
  // кадр для кодировщика: прямо из холста, а если браузер так не умеет (бывает в Safari) — из пикселей
  const makeFrame = ts => {
    if (mode === 'canvas') {
      try { return new VideoFrame(out, {timestamp:ts}); } catch(e) { mode = 'rgba'; }
    }
    const img = ctx.getImageData(0, 0, W, H);
    return new VideoFrame(img.data, {format:'RGBA', codedWidth:W, codedHeight:H, timestamp:ts});
  };
  const paint = videoFramePainter(out, ctx);
  await playFrames(t => {
    if (err) return false;
    if (t <= last) return true;
    last = t;
    try {
      paint();
      drawOverlay(ctx, k, t, true);
      const vf = makeFrame(Math.round(t * 1e6));
      enc.encode(vf, {keyFrame:n % 60 === 0});
      vf.close(); n++;
    } catch(e) { err = e; return false; }
    return true;
  }, .5);
  if (!err) { try { await enc.flush(); } catch(e) { err = e; } }
  try { enc.close(); } catch(e) {}
  if (err) throw new Error((err.message || err.name) + ` (кадров: ${n})`);
  if (n < 2) throw new Error('видео не проигралось при записи');
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], {type:'video/mp4'});
  if (blob.size < 1000) throw new Error('получился пустой файл');
  VS.badFrames = paint.bad;
  return {blob, ext:'mp4'};
}
// запасной способ: запись холста (MediaRecorder)
async function encodeRecorder(out, ctx){
  if (typeof MediaRecorder === 'undefined') throw new Error('нет MediaRecorder');
  if (!out.captureStream) throw new Error('браузер не умеет записывать холст');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error('нет подходящего формата записи');
  const k = out.width / VS.vw;
  ctx.drawImage(VS.el, 0, 0, out.width, out.height);          // первый кадр — до старта записи
  const rec = new MediaRecorder(out.captureStream(30), {mimeType:mime, videoBitsPerSecond:8e6});
  const chunks = [];
  let recErr = null;
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onerror = e => { recErr = e.error || e; };
  const stopped = new Promise(r => rec.onstop = r);
  let started = false, n = 0;
  const paint = videoFramePainter(out, ctx);
  await playFrames(t => {
    if (!started) { rec.start(500); started = true; }
    paint();
    drawOverlay(ctx, k, t, true);
    n++;
    return !recErr;
  }, 1);
  if (!started) throw new Error('видео не проигралось при записи');
  rec.stop(); await stopped;
  VS.badFrames = paint.bad;
  if (recErr) throw new Error(recErr.message || recErr.name || 'ошибка записи');
  let blob = new Blob(chunks, {type:mime.split(';')[0]});
  if (blob.size < 1000) throw new Error(`получился пустой файл (${blob.size} байт, кадров ${n})`);
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
  if (VS.exportedUrl && VS.exportedUrl.startsWith('blob:')) URL.revokeObjectURL(VS.exportedUrl);
  // обычная ссылка сайта (через офлайн-модуль) скачивается там, где ссылки blob: не работают
  const swUrl = await swFileUrl(blob, fname);
  VS.exportedUrl = swUrl || URL.createObjectURL(blob);
  VS.exportedView = swUrl ? swUrl + '?view' : VS.exportedUrl;
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
  // ссылка сайта скачивается переходом (имя файла отдаёт офлайн-модуль); у blob: нужен атрибут download
  const dlAttr = VS.exportedUrl.startsWith('blob:') ? `download="${esc(x.fname)}"` : '';
  const btns = IS_IOS
    ? (share ? `<button class="btn" data-act="vshare">Сохранить в Фото</button>` : '') +
      `<a class="btn ghost" href="${VS.exportedUrl}" ${dlAttr} data-act="vdl">Скачать в Файлы</a>
       <a class="btn ghost" href="${VS.exportedView}" target="_blank" rel="noopener">Открыть видео</a>`
    : `<a class="btn" href="${VS.exportedUrl}" ${dlAttr} data-act="vdl">Скачать видео</a>` +
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
  else if (act === 'vremark') { VS.track = null; VS.reps = null; VS.center = null; VS.tap = null; if (VS.el) VS.el.pause(); render(); }
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
  else if (act === 'vmode') {
    state.settings.plateMode = b.dataset.v; save();
    if (b.dataset.v === 'agent' && VS.tap && !VS.track && !VS.tracking) autoPlate();
    render();
  }
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
