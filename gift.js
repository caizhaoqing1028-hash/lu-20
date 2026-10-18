'use strict';
(() => {
// 放在 iPhone 外框里预览时，底部给横条留出位置
try { if (window.self !== window.top) document.documentElement.classList.add('in-frame'); } catch { document.documentElement.classList.add('in-frame'); }
const $ = id => document.getElementById(id);
const body = document.body;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const LATIN = '-apple-system, "SF Pro Display", "PingFang SC", "Lu Sans", "Helvetica Neue", sans-serif';

/* ---------- 动画管理：页面隐藏、离开舞台或读信时暂停 ---------- */
let pageSuspended = false;
const isAway = () => document.hidden || pageSuspended;
const live = {open: new Set(), scene: new Set()};
const canPlay = group => group === 'scene' ? stageActive() : !isAway();
function run(group, el, frames, options) {
  if (reduced.matches) return Promise.resolve(true);
  const animation = el.animate(frames, {fill: 'both', ...options});
  live[group].add(animation);
  if (!canPlay(group)) animation.pause();
  return animation.finished.then(() => true, () => false);
}
function cancelGroup(group) { for (const a of live[group]) a.cancel(); live[group].clear(); }
function makeLoop(step, allowed) {
  let raf = 0, last = 0;
  const frame = now => {
    raf = 0;
    if (!allowed()) { last = 0; return; }
    const dt = last ? Math.min(now - last, 64) : 16; last = now;
    if (step(dt, now) !== false && allowed()) raf = requestAnimationFrame(frame); else last = 0;
  };
  return {start() { if (!raf && allowed()) raf = requestAnimationFrame(frame); }, stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }};
}

/* ---------- 文字慢慢浮现（约 1.1 秒，多行错开） ---------- */
function setCopy(el, text) {
  el.classList.remove('copy-lines', 'copy-arrive'); delete el.dataset.split;
  if (!text.includes('\n')) { el.textContent = text; return; }
  el.textContent = '';
  text.split('\n').forEach((line, i) => { const s = document.createElement('span'); s.className = 'copy-line'; s.style.setProperty('--line-index', i); s.textContent = line; el.appendChild(s); });
  el.dataset.split = '1'; el.classList.add('copy-lines');
}
function revealCopy(el, delay = 0) {
  if (!el) return;
  if (!el.dataset.split && el.querySelector('br')) {
    const lines = el.innerHTML.split(/<br\s*\/?>/i); el.textContent = '';
    lines.forEach((html, i) => { const s = document.createElement('span'); s.className = 'copy-line'; s.style.setProperty('--line-index', i); s.innerHTML = html; el.appendChild(s); });
    el.dataset.split = '1'; el.classList.add('copy-lines');
  }
  el.classList.remove('copy-arrive'); el.style.setProperty('--copy-delay', delay + 'ms');
  void el.offsetWidth; el.classList.add('copy-arrive');
}

/* ================= 1. 滑动拆信 ================= */
const entrance = $('entrance'), gift = $('gift'), slider = $('slider');
const track = slider.querySelector('.switch-track'), knob = slider.querySelector('.switch-knob');
const postcard = $('postcard'), postcardWrap = $('postcardWrap'), envelopeCard = $('envelopeCard');
// 信封高清图到了再替换模糊占位
{ const closed = entrance.querySelector('.env-closed'), done = () => closed.closest('.envelope').classList.add('loaded');
  if (closed.complete && closed.naturalWidth) done(); else closed.addEventListener('load', done, {once: true}); }
let slide = 0, drag = null, locked = false, travel = 0, opening = false, openGen = 0, openSize = null;

function measureSlide() { travel = Math.max(0, track.clientWidth - knob.offsetWidth - 2 * knob.offsetLeft); slider.style.setProperty('--travel', travel + 'px'); }
function setSlide(value, returning = false) {
  slide = clamp(value);
  slider.classList.toggle('returning', returning);
  slider.classList.toggle('ready', slide >= .9 && !locked);
  slider.style.setProperty('--slide', slide);
  slider.setAttribute('aria-valuenow', String(Math.round(slide * 100)));
  slider.setAttribute('aria-valuetext', locked ? '惊喜已拆开' : `已滑动 ${Math.round(slide * 100)}%，滑到最右侧拆开惊喜`);
  $('slideTitle').textContent = locked ? '惊喜已开启' : '拆开惊喜';
  $('slideHint').textContent = locked ? '小猫正在送来祝福' : slide >= .9 ? '松手，拆开惊喜' : '向右滑动白色圆点';
}
function resetSlide() { drag = null; knob.style.scale = ''; slider.classList.remove('dragging'); if (!locked) setSlide(0, true); }
function restorePostcard() { if (postcard.parentElement !== postcardWrap) postcardWrap.appendChild(postcard); postcardWrap.classList.remove('travelling'); }

function showEntrance(focus = true) {
  ++openGen; opening = false; openSize = null; cancelGroup('open'); restorePostcard();
  locked = false; drag = null; slider.classList.remove('locked', 'dragging'); slider.removeAttribute('aria-disabled'); slider.tabIndex = 0; setSlide(0);
  entrance.hidden = false; entrance.classList.remove('opening'); entrance.removeAttribute('aria-busy'); entrance.scrollTop = 0; $('entranceStatus').textContent = '';
  gift.hidden = true; gift.inert = true; body.classList.add('entry-active');
  measureSlide(); syncActivity();
  if (focus) slider.focus({preventScroll: true});
}
function finishEntrance() {
  ++openGen; opening = false; openSize = null; locked = true; drag = null;
  cancelGroup('open'); restorePostcard();
  slider.classList.add('locked'); slider.setAttribute('aria-disabled', 'true'); slider.tabIndex = -1;
  entrance.hidden = true; entrance.classList.remove('opening'); entrance.removeAttribute('aria-busy');
  gift.hidden = false; gift.inert = false; body.classList.remove('entry-active');
  scrollTo(0, 0); $('giftTitle').focus({preventScroll: true}); syncActivity();
}
async function openGift() {
  if (opening || locked || entrance.hidden) return; // 只触发一次
  locked = true; slider.classList.add('locked'); setSlide(1, true); slider.setAttribute('aria-disabled', 'true'); slider.tabIndex = -1;
  $('entranceStatus').textContent = '信封打开了，小猫正在送来祝福。';
  startMusic();
  if (reduced.matches) { finishEntrance(); return; }
  const gen = ++openGen; opening = true; openSize = [innerWidth, innerHeight]; entrance.setAttribute('aria-busy', 'true');
  const alive = () => opening && gen === openGen;

  if (!await run('open', knob, [{scale: '1'}, {scale: '1.08 .93', offset: .35}, {scale: '1'}], {duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)'}) || !alive()) return;

  envelopeCard.appendChild(postcard); entrance.classList.add('opening');
  for (const el of entrance.querySelectorAll('.entrance-copy,.entrance-actions,.entrance>.topbar')) run('open', el, [{opacity: 1, translate: '0 0'}, {opacity: 0, translate: '0 -10px'}], {duration: 460, easing: 'ease'});
  run('open', entrance.querySelector('.env-closed'), [{opacity: 1}, {opacity: 0}], {duration: 220, easing: 'ease-out'});
  for (const el of entrance.querySelectorAll('.env-open')) run('open', el, [{opacity: 0, translate: '0 0'}, {opacity: 1, translate: '0 4%'}], {duration: 240, easing: 'ease-out'});
  const [photo, ticket] = entrance.querySelectorAll('.envelope-extra');
  run('open', photo, [{opacity: 0, transform: 'translate(0,20%) rotate(0deg)'}, {opacity: 1, offset: .3}, {opacity: 1, transform: 'translate(-92%,-104%) rotate(-16deg)'}], {duration: 820, delay: 300, easing: 'cubic-bezier(.2,.8,.2,1.1)'});
  run('open', ticket, [{opacity: 0, transform: 'translate(0,40%) rotate(0deg)'}, {opacity: 1, offset: .3}, {opacity: 1, transform: 'translate(-30%,-372%) rotate(-7deg)'}], {duration: 820, delay: 420, easing: 'cubic-bezier(.2,.8,.2,1.1)'});
  const lifted = await run('open', envelopeCard, [
    {opacity: 0, transform: 'translateY(16%) rotate(5deg) scale(.82)'},
    {opacity: 1, offset: .3},
    {opacity: 1, transform: 'translateY(-54%) rotate(0deg) scale(1)'}
  ], {duration: 720, delay: 230, easing: 'cubic-bezier(.2,.7,.2,1)'});
  if (!lifted || !alive()) return;

  // 同一张明信片从信封移动到礼物页的位置
  const from = postcard.getBoundingClientRect(), fromW = postcard.offsetWidth;
  gift.hidden = false; gift.inert = true; scrollTo(0, 0);
  postcardWrap.appendChild(postcard); postcardWrap.classList.add('travelling');
  const to = postcard.getBoundingClientRect(), toW = postcard.offsetWidth;
  if (!fromW || !toW) { finishEntrance(); return; }
  const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const flight = run('open', postcardWrap, [{transform: `translate(${dx}px,${dy}px) scale(${fromW / toW})`}, {transform: 'none'}], {duration: 760, easing: 'cubic-bezier(.22,.8,.2,1)'});
  [...gift.querySelectorAll('.topbar,.greeting>:not(.postcard-wrap),.step-panel,.extras,.reopen')].forEach((el, i) =>
    run('open', el, [{opacity: 0, translate: '0 10px'}, {opacity: 1, translate: '0 0'}], {duration: 800, delay: 260 + i * 60, easing: 'cubic-bezier(.2,.65,.3,1)'}));
  run('open', entrance, [{opacity: 1}, {opacity: 0}], {duration: 460, easing: 'ease'});
  if (await flight && alive()) finishEntrance();
}

knob.addEventListener('pointerdown', e => {
  if (locked || opening || !e.isPrimary || e.button !== 0) return;
  e.preventDefault(); measureSlide();
  const scale = track.getBoundingClientRect().width / track.clientWidth || 1;
  drag = {id: e.pointerId, x: e.clientX, start: slide, moved: false, px: Math.max(1, travel * scale)};
  slider.setPointerCapture(e.pointerId);
  slider.classList.remove('returning'); slider.classList.add('dragging');
});
slider.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true;
  setSlide(drag.start + dx / drag.px);
  if (!reduced.matches) {
    const v = drag.lastT ? (e.clientX - drag.lastX) / Math.max(8, e.timeStamp - drag.lastT) : 0;
    drag.v = (drag.v || 0) * .6 + v * .4; drag.lastX = e.clientX; drag.lastT = e.timeStamp;
    const k = Math.min(.22, Math.abs(drag.v) * .35);
    knob.style.scale = `${(1.22 + k).toFixed(3)} ${(1.1 - k * .45).toFixed(3)}`;
  }
});
slider.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null; knob.style.scale = ''; slider.classList.remove('dragging');
  if (!d.moved) { setSlide(0, true); return; } // 单击不拆信
  setSlide(d.start + (e.clientX - d.x) / d.px);
  if (slide >= .9) openGift(); else setSlide(0, true);
});
slider.addEventListener('pointercancel', resetSlide);
slider.addEventListener('lostpointercapture', () => { if (drag) resetSlide(); });
slider.addEventListener('keydown', e => {
  if (locked || opening) return;
  const keys = ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Home', 'End', 'Enter', ' '];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  if (e.key === 'End' || e.key === 'Enter' || e.key === ' ') { setSlide(1); openGift(); return; }
  setSlide(e.key === 'Home' ? 0 : slide + (['ArrowRight', 'ArrowUp'].includes(e.key) ? .1 : -.1));
  if (slide >= .999) openGift();
});
$('skipEntrance').addEventListener('click', () => { startMusic(); finishEntrance(); });
$('reopenEntrance').addEventListener('click', () => showEntrance());
addEventListener('blur', () => { if (drag) resetSlide(); });

/* ================= 2. 小猫明信片 ================= */
const steps = [
  {title: '生日快递，待签收。', desc: '', label: '先收下小猫的祝福'},
  {title: '第一份礼物，是好心情。', desc: '小猫把蛋糕送来啦。\n点亮蜡烛，许个生日愿望吧。', label: '点亮生日蜡烛'},
  {title: '蜡烛亮了，许个愿吧。', desc: '把愿望悄悄放在心里，\n还有几份惊喜，等你亲手点亮。', label: '开启生日惊喜'}
];
let step = 0, stepBusy = false, stageVisited = false, toastTimer, confettiTimer;
function pet(cat) {
  clearTimeout(cat._petTimer); cat.classList.remove('pet'); void cat.offsetWidth; cat.classList.add('pet');
  cat._petTimer = setTimeout(() => cat.classList.remove('pet'), 1300);
}
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('show'); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2400); }
// 苹果风格的点阵烟花：画在页面内容后面，透过玻璃按钮能看到
const fw = {canvas: $('confettiLayer'), ctx: null, parts: [], raf: 0, last: 0, w: 0, h: 0};
try { fw.ctx = fw.canvas.getContext('2d'); } catch { fw.ctx = null; }
function fwSize() { const r = Math.min(devicePixelRatio || 1, 2); fw.w = innerWidth; fw.h = innerHeight; fw.canvas.width = Math.round(fw.w * r); fw.canvas.height = Math.round(fw.h * r); fw.ctx?.setTransform(r, 0, 0, r, 0, 0); }
const FW_PALETTES = [['#ff5d8f', '#ff9ab8'], ['#ff7a2e', '#ffc062'], ['#2fbf8f', '#8fe0c3'], ['#ffb400', '#ffd96a'], ['#ff4d6d', '#ff8a3d'], ['#8c7bff', '#c4b8ff']];
function fwBurst(x, y, size = 1) {
  if (!fw.ctx || reduced.matches) return;
  if (!fw.w) fwSize();
  const [c1, c2] = FW_PALETTES[Math.floor(Math.random() * FW_PALETTES.length)], n = Math.round(120 * size);
  for (let i = 0; i < n; i++) {
    // 球面上均匀取点，投影到平面：边缘更密，像一团立体的点阵
    const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), speed = (3.4 + Math.random() * .7) * size;
    fw.parts.push({x, y, vx: Math.cos(a) * r * speed, vy: Math.sin(a) * r * speed, life: 0, max: 1300 + Math.random() * 700, s: 1.8 + Math.random() * 1.8, c: i % 3 ? c1 : c2, tw: Math.random() * 6});
  }
  if (!fw.raf) { fw.last = 0; fw.raf = requestAnimationFrame(fwFrame); }
}
function fwFrame(now) {
  fw.raf = 0;
  const dt = fw.last ? Math.min(now - fw.last, 48) : 16; fw.last = now;
  if (isAway()) { fw.raf = requestAnimationFrame(fwFrame); return; }
  const c = fw.ctx; c.clearRect(0, 0, fw.w, fw.h);
  const k = dt / 16, drag = Math.pow(.955, k);
  fw.parts = fw.parts.filter(p => (p.life += dt) < p.max);
  for (const p of fw.parts) {
    p.vx *= drag; p.vy = p.vy * drag + .018 * k; p.x += p.vx * k; p.y += p.vy * k;
    const t = p.life / p.max, fade = t < .1 ? t / .1 : 1 - Math.pow((t - .1) / .9, 1.6);
    c.globalAlpha = Math.max(0, fade) * (.75 + .25 * Math.sin(p.life * .02 + p.tw));
    c.fillStyle = p.c; c.beginPath(); c.arc(p.x, p.y, p.s * (1 - t * .35), 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;
  if (fw.parts.length) fw.raf = requestAnimationFrame(fwFrame); else c.clearRect(0, 0, fw.w, fw.h);
}
function confetti(count = 5) {
  if (reduced.matches) return;
  fwSize();
  for (let i = 0; i < count; i++) setTimeout(() => fwBurst(fw.w * (.18 + Math.random() * .64), fw.h * (.08 + Math.random() * .36), .85 + Math.random() * .45), i * 260 + Math.random() * 120);
}
addEventListener('resize', () => { if (fw.parts.length) fwSize(); });
function renderStepper() {
  document.querySelectorAll('.stepper li').forEach((li, i) => {
    li.classList.toggle('current', i === step); li.classList.toggle('done', i < step);
    if (i === step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}
document.querySelectorAll('#postcard .cat').forEach(cat => cat.addEventListener('click', () => {
  pet(cat); setCopy($('petHint'), cat.classList.contains('orange') ? '橘猫：今天的好运，全部送给璐。' : '白猫：喵，生日快乐呀！'); revealCopy($('petHint'));
}));
$('confettiButton').addEventListener('click', () => { confetti(); toast('生日快乐，璐！'); });
$('nextButton').addEventListener('click', () => {
  if (stepBusy) return;
  if (step === 2) { openExperience(); return; }
  stepBusy = true; step++;
  const s = steps[step];
  setCopy($('stepTitle'), s.title); setCopy($('stepDescription'), s.desc); $('stepDescription').hidden = !s.desc;
  $('nextLabel').textContent = s.label; postcard.dataset.step = String(step);
  renderStepper();
  if (!reduced.matches) {
    const box = postcard.querySelector('.gift-box'), cake = postcard.querySelector(step === 1 ? '.cake:not(.lit)' : '.cake.lit'), br = box.getBoundingClientRect();
    if (step === 1) {
      box.animate([{transform: 'none', opacity: 1}, {transform: 'translateY(4%) scale(1.1,.88)', opacity: 1, offset: .25}, {transform: 'translateY(-34%) scale(.55) rotate(-8deg)', opacity: 0}], {duration: 560, easing: 'cubic-bezier(.3,0,.3,1)'});
      cake.animate([{transform: 'translateY(26%) scale(.5)', opacity: 0}, {opacity: 1, offset: .3}, {transform: 'none', opacity: 1}], {duration: 760, delay: 240, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'backwards'});
      setTimeout(() => fwBurst(br.left + br.width / 2, br.top + br.height * .3, .45), 300);
    } else {
      cake.animate([{filter: 'brightness(1)'}, {filter: 'brightness(1.25)', offset: .3}, {filter: 'brightness(1)'}], {duration: 900, easing: 'ease-out'});
    }
  }
  confetti(step === 2 ? 6 : 4);
  revealCopy($('stepTitle')); revealCopy($('stepDescription'), 160);
  setTimeout(() => { stepBusy = false; }, 500); // 快速连点不会跳过祝福
});

/* ================= 3. 四段互动舞台 ================= */
const experience = $('experience'), letter = $('letter'), stageScroll = experience.querySelector('.stage-scroll');
const sceneIds = ['joyScene', 'wishScene', 'starsScene', 'finalScene'];
const SCENES = [
  {chapter: '第一份 · 好心情', display: 'Joy', title: '今天，快乐多一点。', ask: '把橙色圆点，慢慢拖到曲线的另一端。', done: '好心情 +20%，给新的一岁加点甜。', status: ''},
  {chapter: '第二份 · 新一岁的祝福', display: 'Wish', title: '把喜欢的，带进新一岁。', ask: '轻轻拨动圆环，再选一份喜欢的祝福。', done: '把喜欢的，放在离自己近一点的地方。', status: ''},
  {chapter: '第三份 · 点亮二十岁', display: 'Twenty', title: '一起点亮，二十岁。', ask: '点亮三颗主星，让它们变成你的二十岁。', done: '愿你把每一天，都过成喜欢的样子。', status: ''},
  {chapter: '第四份 · 小猫贺卡', display: 'For you', title: '最后一份，来自小猫。', ask: '摸摸它们，还有一封信想交给你。', done: '小猫的祝福已送达，最后一封信也准备好了。', status: ''}
];
const freshState = () => ({scene: 0, done: [false, false, false, false], joy: 0, wish: null, rotation: 0, stars: [false, false, false], pet: false});
let state = freshState(), sceneGen = 0, sceneBusy = false, letterTrigger = null;
function stageActive() { return experience.open && !letter.open && !isAway(); }

function cancelScene() {
  ++sceneGen; sceneBusy = false; joyDrag = null; orbitDrag = null; spin = 0;
  cancelGroup('scene'); spinLoop.stop(); starLoop.stop(); depthLoop.stop(); depthTime = null; $('depthCanvas').hidden = true;
  orbit.classList.remove('dragging'); joyDot.classList.remove('grabbing');
  document.querySelectorAll('.final-cat.pet').forEach(c => { clearTimeout(c._petTimer); c.classList.remove('pet'); });
}
function updateControls() {
  const i = state.scene;
  const ready = state.done[i] && !sceneBusy, next = $('stageNext');
  next.classList.toggle('waiting', !ready); next.setAttribute('aria-disabled', String(!ready));
  $('stageNextLabel').textContent = ready ? (i === 3 ? '打开最后一封信' : '继续') : sceneBusy ? '稍等一下' : ['拖到终点', '选一个祝福', '点亮三颗星', '先摸摸小猫'][i];
  $('finalScene').classList.toggle('awaiting', i === 3 && !state.pet);
  $('stageBack').setAttribute('aria-label', i === 0 ? '返回明信片' : '返回上一段');
  $('stageProgress').textContent = `${i + 1} / 4`;
  experience.querySelectorAll('.stage-dots i').forEach((dot, k) => { dot.classList.toggle('current', k === i); dot.classList.toggle('done', k !== i && state.done[k]); });
}
function finishSceneCopy(status) {
  if (status) $('stageStatus').textContent = status;
  setCopy($('stageInstruction'), SCENES[state.scene].done); revealCopy($('stageInstruction'), 80);
}
function renderScene(focus = true, dir = 0) {
  cancelScene();
  const i = state.scene, S = SCENES[i];
  experience.dataset.scene = String(i);
  sceneIds.forEach((id, k) => { $(id).hidden = k !== i; });
  $('stageChapter').textContent = S.chapter;
  const display = $('stageDisplay'), period = document.createElement('span');
  display.textContent = S.display; period.textContent = '.'; display.appendChild(period);
  setCopy($('stageTitle'), S.title); setCopy($('stageInstruction'), state.done[i] ? S.done : S.ask);
  $('stageStatus').textContent = S.status; stageScroll.scrollTop = 0;
  [enterJoy, enterWish, enterStars, enterFinal][i]();
  updateControls();
  run('scene', $(sceneIds[i]), [{opacity: 0, transform: dir ? `translateX(${dir * 36}px)` : 'translateY(16px)'}, {opacity: 1, transform: 'none'}], {duration: dir ? 760 : 900, delay: dir ? 120 : 220, easing: 'cubic-bezier(.2,.75,.25,1)'});
  if (dir) run('scene', experience.querySelector('.stage-heading'), [{opacity: .2, transform: `translateX(${dir * 20}px)`}, {opacity: 1, transform: 'none'}], {duration: 700, easing: 'cubic-bezier(.2,.75,.25,1)'});
  [$('stageChapter'), display, $('stageTitle'), $('stageInstruction')].forEach((el, k) => revealCopy(el, k * 130));
  syncActivity();
  if (focus) $('stageTitle').focus({preventScroll: true});
}
const morphLayer = experience.querySelector('.stage-morph');
function buttonInset() {
  const r = $('nextButton').getBoundingClientRect(), W = innerWidth, H = innerHeight;
  return r.width ? `inset(${r.top}px ${W - r.right}px ${H - r.bottom}px ${r.left}px round ${r.height / 2}px)` : null;
}
function openExperience() {
  if (experience.open) return;
  const from = reduced.matches ? null : buttonInset();
  experience.showModal(); stageVisited = true; syncDialogs(); renderScene();
  if (!from) return;
  experience.animate([{clipPath: from}, {clipPath: 'inset(0px 0px 0px 0px round 0px)'}], {duration: 720, easing: 'cubic-bezier(.32,.0,.12,1)'});
  morphLayer.animate([{opacity: 1}, {opacity: 1, offset: .25}, {opacity: 0}], {duration: 780, easing: 'ease-out'});
}
let closingStage = false;
function closeExperience() {
  if (!experience.open || closingStage) return;
  const to = reduced.matches ? null : buttonInset();
  if (!to) { experience.close(); return; }
  closingStage = true;
  morphLayer.animate([{opacity: 0}, {opacity: 1, offset: .6}, {opacity: 1}], {duration: 520, easing: 'ease-in'});
  const a = experience.animate([{clipPath: 'inset(0px 0px 0px 0px round 0px)'}, {clipPath: to}], {duration: 560, easing: 'cubic-bezier(.5,0,.6,1)'});
  a.finished.catch(() => {}).then(() => { closingStage = false; experience.close(); });
}
experience.addEventListener('close', () => {
  cancelScene(); syncDialogs();
  if (stageVisited && step === 2) $('nextLabel').textContent = '继续生日惊喜';
  $('nextButton').focus({preventScroll: true});
});
experience.addEventListener('cancel', e => { e.preventDefault(); closeExperience(); });
$('closeExperience').addEventListener('click', closeExperience);
$('stageBack').addEventListener('click', () => { if (state.scene === 0) closeExperience(); else { state.scene--; renderScene(true, -1); } });
function nudgeScene() {
  const i = state.scene, wiggle = [{transform: 'none'}, {transform: 'translateY(-6px) rotate(-4deg)', offset: .3}, {transform: 'translateY(-2px) rotate(3deg)', offset: .65}, {transform: 'none'}];
  const tips = ['把橙色圆点拖到最右边就好啦。', '转一转圆环，点一个喜欢的词。', '还有星星没点亮哦。', '轻点贺卡上的橘猫或白猫。'];
  $('stageStatus').textContent = tips[i]; revealCopy($('stageStatus'));
  if (i === 0) run('scene', joyDot.firstElementChild, [{scale: '1'}, {scale: '1.35'}, {scale: '1'}], {duration: 600, easing: 'cubic-bezier(.3,1.5,.5,1)'});
  if (i === 1 && !state.wish) run('scene', orbit, [{rotate: '0deg'}, {rotate: '10deg', offset: .35}, {rotate: '-6deg', offset: .7}, {rotate: '0deg'}], {duration: 800, easing: 'ease-in-out'});
  if (i === 2) starButtons.filter((_, k) => !state.stars[k]).forEach(b => run('scene', b.firstElementChild, [{scale: '1'}, {scale: '1.6'}, {scale: '1'}], {duration: 700, easing: 'cubic-bezier(.3,1.5,.5,1)'}));
  if (i === 3) document.querySelectorAll('.final-cat').forEach((cat, k) => run('scene', cat, wiggle, {duration: 800, delay: k * 120, easing: 'ease-in-out'}));
}
function centerOf(el) { const r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width}; }
function flyToken(from, toEl, look, landScale) {
  if (reduced.matches || !from || !toEl) return;
  requestAnimationFrame(() => {
    const to = centerOf(toEl); if (!to.w) return;
    const dot = document.createElement('i'); dot.className = 'stage-token'; Object.assign(dot.style, look); experience.appendChild(dot);
    const dx = to.x - from.x, dy = to.y - from.y, s0 = Math.max(.6, from.w / 28), s1 = landScale ?? .5;
    dot.animate([
      {transform: `translate(${from.x}px,${from.y}px) scale(${s0})`, opacity: 1},
      {transform: `translate(${from.x + dx * .5 - dy * .18}px,${from.y + dy * .5 - Math.abs(dx) * .25 - 40}px) scale(${(s0 + s1) / 2 * .8})`, opacity: 1, offset: .5},
      {transform: `translate(${to.x}px,${to.y}px) scale(${s1})`, opacity: .2}
    ], {duration: 820, easing: 'cubic-bezier(.45,0,.2,1)'}).finished.catch(() => {}).then(() => {
      dot.remove();
      toEl.animate([{transform: 'scale(1)'}, {transform: 'scale(1.08)', offset: .35}, {transform: 'scale(1)'}], {duration: 520, easing: 'cubic-bezier(.3,1.5,.5,1)'});
    });
  });
}
const TOKEN_LOOKS = [
  {background: 'radial-gradient(circle at 35% 30%,#ffb27a,#ff6a2b 60%,#ff4d6d)', boxShadow: '0 0 24px rgba(255,106,43,.6)'},
  {background: 'radial-gradient(circle,#fff6d8,#ffd27a 45%,#ff9a5a)', boxShadow: '0 0 30px rgba(255,210,122,.9)'},
  {background: 'radial-gradient(circle,#fffaf0,#ffe2a8 40%,rgba(255,180,90,.2) 75%,transparent)', boxShadow: '0 0 40px rgba(255,214,140,.9)'}
];
$('stageNext').addEventListener('click', () => {
  const i = state.scene; if (sceneBusy) return;
  if (!state.done[i]) { nudgeScene(); return; }
  if (i < 3) {
    const source = [joyDot.firstElementChild, $('wishReveal').querySelector('.sun'), starCanvas][i];
    const from = source && !source.closest('[hidden]') ? centerOf(source) : null;
    if (i === 2 && from) from.w = 60;
    state.scene++; renderScene(true, 1); if (state.scene === 2) beginDepth();
    const target = [null, orbit.querySelector('.orbit-core b'), starButtons[1], finalCard][state.scene];
    flyToken(from, target, TOKEN_LOOKS[i], [5, .7, 9][i]);
  }
  else showLetter($('stageNext'));
});

/* --- 第一段：好心情曲线 --- */
const joyDot = $('joyDot'), joyGraph = $('joyGraph');
let joyDrag = null;
function spring(t) { const w = 8.65, z = .52, wd = w * Math.sqrt(1 - z * z); return t <= 0 ? 0 : 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)); }
const graphPoint = p => [25 + 290 * p, 175 - 115 * spring(p * 1.7)];
const pathOf = points => points.map((v, i) => (i ? 'L' : 'M') + v[0].toFixed(2) + ' ' + v[1].toFixed(2)).join('');
function curvePoints(p) { const n = Math.max(1, Math.ceil(p * 140)), pts = []; for (let k = 0; k <= n; k++) pts.push(graphPoint(p * k / n)); return pts; }
$('joyGhost').setAttribute('d', pathOf(curvePoints(1)));
function renderJoy() {
  const p = state.joy, pts = curvePoints(p), line = pathOf(pts), end = pts[pts.length - 1];
  $('joyCurve').setAttribute('d', line);
  $('joyArea').setAttribute('d', p > .005 ? `${line}L${end[0].toFixed(2)} 190L25 190Z` : '');
  const [x, y] = graphPoint(p);
  joyDot.style.left = (x / 340 * 100) + '%'; joyDot.style.top = (y / 210 * 100) + '%';
  const value = Math.round(p * 20);
  $('joyValue').textContent = '+' + value;
  joyDot.setAttribute('aria-valuenow', String(Math.round(p * 100))); joyDot.setAttribute('aria-valuetext', `好心情增加 ${value}%`);
}
function setJoy(value) { state.joy = clamp(value); renderJoy(); }
function enterJoy() {
  renderJoy();
  $('joyScene').classList.toggle('complete', state.done[0]);
  $('joyScene').classList.toggle('idle', state.joy === 0 && !state.done[0]);
  revealCopy($('joyCaption'), 520);
  if (state.done[0]) $('stageStatus').textContent = '好心情 +20%，已签收。';
  else if (state.joy >= 1) completeJoy();
}
async function completeJoy() {
  if (sceneBusy || state.done[0] || state.scene !== 0 || !experience.open) return;
  const gen = sceneGen; sceneBusy = true; updateControls();
  const ok = await run('scene', joyDot.firstElementChild, [{scale: '1'}, {scale: '1.4', offset: .38}, {scale: '.94', offset: .7}, {scale: '1'}], {duration: 650, easing: 'cubic-bezier(.22,1,.36,1)'});
  if (!ok || gen !== sceneGen) return;
  state.done[0] = true; sceneBusy = false; $('joyScene').classList.add('complete');
  finishSceneCopy('好心情 +20%，已签收。'); updateControls();
}
joyDot.addEventListener('pointerdown', e => {
  if (sceneBusy || state.done[0] || e.button !== 0 || !e.isPrimary) return;
  e.preventDefault(); joyDrag = {id: e.pointerId}; joyDot.setPointerCapture(e.pointerId);
  joyDot.classList.add('grabbing'); $('joyScene').classList.remove('idle');
});
function moveJoy(e) { const r = joyGraph.getBoundingClientRect(); setJoy(((e.clientX - r.left) / r.width * 340 - 25) / 290); }
joyDot.addEventListener('pointermove', e => { if (joyDrag && e.pointerId === joyDrag.id) moveJoy(e); });
joyDot.addEventListener('pointerup', e => {
  if (!joyDrag || e.pointerId !== joyDrag.id) return;
  moveJoy(e); joyDrag = null; joyDot.classList.remove('grabbing');
  if (state.joy >= .98) { setJoy(1); completeJoy(); }
});
const endJoyDrag = () => { joyDrag = null; joyDot.classList.remove('grabbing'); };
joyDot.addEventListener('pointercancel', endJoyDrag); joyDot.addEventListener('lostpointercapture', endJoyDrag);
joyDot.addEventListener('keydown', e => {
  if (sceneBusy || state.done[0] || !['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); $('joyScene').classList.remove('idle');
  setJoy(e.key === 'End' ? 1 : e.key === 'Home' ? 0 : state.joy + (['ArrowRight', 'ArrowUp'].includes(e.key) ? .1 : -.1));
  if (state.joy >= .999) { setJoy(1); completeJoy(); }
});

/* --- 第二段：祝福圆环 --- */
const orbit = $('wishOrbit'), words = [...orbit.querySelectorAll('.wish-word')], ring = orbit.querySelector('.orbit-ring');
const dialTicks = orbit.querySelector('.dial-ticks'), dialText = orbit.querySelector('.dial-text');
// 祝福词前的小图标
const WISH_ICONS = {
  快乐: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.6v.1M15 9.6v.1"/>',
  勇气: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.6 1 2.4 2 3 0-3 .5-5.5.5-8Z"/>',
  自由: '<path d="M20 4C11 4 6 9 5 20M20 4c0 7-4.2 11-10.5 11M14.5 9.5H9.5"/>',
  好运: '<path d="M12 12c-3.2-.6-5.3-2.6-4-4.7s4-.4 4 1.7c0-2.1 2.7-3.8 4-1.7s-.8 4.1-4 4.7Zm0 0c-3.2.6-5.3 2.6-4 4.7s4 .4 4-1.7c0 2.1 2.7 3.8 4 1.7s-.8-4.1-4-4.7Zm0 0c.6-3.2 2.6-5.3 4.7-4M12 12c-.6 3.2.6 6.5 3 8"/>',
  小猫: '<path d="M5 9 4.5 4l4 3h7l4-3-.5 5c1 1.3 1.5 2.7 1.5 4.2C20.5 17 16.9 20 12 20s-8.5-3-8.5-6.8C3.5 11.7 4 10.3 5 9Z"/><path d="M9.5 13v.1M14.5 13v.1"/>',
  热爱: '<path d="M12 20s-7-4.4-8.6-8.7C2.2 8 4.2 4.8 7.4 4.8c1.9 0 3.3 1 4.6 2.7 1.3-1.7 2.7-2.7 4.6-2.7 3.2 0 5.2 3.2 4 6.5C19 15.6 12 20 12 20Z"/>'
};
words.forEach(b => b.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 24 24" aria-hidden="true">${WISH_ICONS[b.dataset.wish]}</svg>`));
let orbitDrag = null, spin = 0;
function layoutOrbit() {
  const scene = $('wishScene'), w = scene.clientWidth, h = scene.clientHeight;
  if (!w) return;
  const size = Math.round(Math.max(220, Math.min(w, h - 6, 330)));
  orbit.style.setProperty('--orbit', size + 'px'); $('wishScene').style.setProperty('--art', Math.max(180, Math.min(300, h - 160)) + 'px');
  const radius = size / 2 - 32;
  words.forEach((button, i) => {
    const a = (-90 + i * 60 + state.rotation) * Math.PI / 180;
    button.style.left = (size / 2 + radius * Math.cos(a)) + 'px'; button.style.top = (size / 2 + radius * Math.sin(a)) + 'px';
    button.setAttribute('aria-pressed', String(state.wish === button.dataset.wish));
  });
  ring.style.rotate = state.rotation + 'deg';
  dialTicks.style.transform = `rotate(${state.rotation}deg)`; dialText.style.transform = `rotate(${-state.rotation * .5}deg)`;
  // 转到顶部指示点下的祝福微微高亮
  let best = null, bestGap = 99;
  words.forEach((b, i) => { const gap = Math.abs((((i * 60 + state.rotation) % 360) + 540) % 360 - 180); if (gap < bestGap) { bestGap = gap; best = b; } });
  words.forEach(b => b.classList.toggle('active', b === best && !state.wish));
}
const spinLoop = makeLoop(dt => {
  state.rotation += spin * dt; spin *= Math.pow(.93, dt / 16); layoutOrbit();
  return Math.abs(spin) > .003;
}, () => stageActive() && state.scene === 1 && !state.wish && !orbitDrag);
function orbitAngle(e) { const r = orbit.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2); }
orbit.addEventListener('pointerdown', e => {
  if (sceneBusy || state.wish || e.button !== 0 || !e.isPrimary) return;
  spin = 0; spinLoop.stop();
  orbitDrag = {id: e.pointerId, angle: orbitAngle(e), x: e.clientX, y: e.clientY, moved: 0, t: e.timeStamp, wish: e.target.closest('.wish-word')?.dataset.wish};
  orbit.setPointerCapture(e.pointerId); orbit.classList.add('dragging');
});
orbit.addEventListener('pointermove', e => {
  if (!orbitDrag || e.pointerId !== orbitDrag.id) return;
  const angle = orbitAngle(e); let delta = angle - orbitDrag.angle;
  if (delta > Math.PI) delta -= Math.PI * 2; if (delta < -Math.PI) delta += Math.PI * 2;
  const deg = delta * 180 / Math.PI, dt = Math.max(8, e.timeStamp - orbitDrag.t);
  state.rotation += deg; spin = spin * .4 + (deg / dt) * .6;
  orbitDrag.moved += Math.hypot(e.clientX - orbitDrag.x, e.clientY - orbitDrag.y);
  Object.assign(orbitDrag, {x: e.clientX, y: e.clientY, angle, t: e.timeStamp});
  layoutOrbit();
});
function endOrbit(e, chosen) {
  if (!orbitDrag || (e && e.pointerId !== orbitDrag.id)) return;
  const d = orbitDrag; orbitDrag = null; orbit.classList.remove('dragging');
  if (chosen && d.moved < 8 && d.wish) { chooseWish(d.wish); return; }
  if (e && e.timeStamp - d.t > 90) spin = 0;
  spin = clamp(spin, -1.2, 1.2);
  if (!reduced.matches && Math.abs(spin) > .01) spinLoop.start();
}
orbit.addEventListener('pointerup', e => endOrbit(e, true));
orbit.addEventListener('pointercancel', e => endOrbit(e, false));
orbit.addEventListener('lostpointercapture', () => { if (orbitDrag) { orbitDrag = null; orbit.classList.remove('dragging'); } });
words.forEach(button => {
  button.addEventListener('click', e => { if (e.detail === 0) chooseWish(button.dataset.wish); }); // 键盘
  button.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); state.rotation += e.key === 'ArrowRight' ? 15 : -15; layoutOrbit(); } });
});
const revealParts = () => { const art = $('wishReveal').querySelector('.wish-art'); return [art.querySelector('.sun'), ...art.querySelectorAll('img'), $('wishReveal').querySelector('h3'), $('chosenWish'), $('wishTag')]; };
function enterWish() {
  $('wishOrbit').hidden = !!state.wish; $('wishReveal').hidden = !state.wish; $('dotReveal').replaceChildren();
  words.forEach(w => w.classList.remove('chosen')); revealParts().forEach(el => { el.style.opacity = ''; });
  layoutOrbit();
  if (!state.wish) return;
  setCopy($('chosenWish'), `把「${state.wish}」，放进新的这一岁。`); $('wishTag').textContent = state.wish;
  if (state.done[1]) { $('stageStatus').textContent = `这份${state.wish}，全部送给璐。`; revealCopy($('chosenWish'), 520); }
  else revealWish(false);
}
function chooseWish(value) { if (sceneBusy || state.wish || state.scene !== 1) return; spinLoop.stop(); spin = 0; state.wish = value; revealWish(true); }
// 星屑与冲击波：从 (x, y) 向外绽放
function burst(x, y, size, count = 30) {
  const fx = $('dotReveal'), colors = ['#ff8a3d', '#ff4d6d', '#ffd27a', '#ffb15e', '#ffffff', '#ff6a2b'], runs = [];
  const shock = document.createElement('i'); shock.className = 'shock';
  Object.assign(shock.style, {width: '40px', height: '40px', left: x - 20 + 'px', top: y - 20 + 'px'}); fx.appendChild(shock);
  runs.push(run('scene', shock, [{transform: 'scale(.4)', opacity: 1}, {transform: `scale(${size / 40 * 1.1})`, opacity: 0}], {duration: 760, easing: 'cubic-bezier(.1,.6,.3,1)'}));
  for (let k = 0; k < count; k++) {
    const a = k / count * Math.PI * 2 + Math.random() * .4, d = size * (.22 + Math.random() * .38), r = 3 + Math.random() * 6;
    const dot = document.createElement('i');
    Object.assign(dot.style, {width: r * 2 + 'px', height: r * 2 + 'px', left: x - r + 'px', top: y - r + 'px', background: colors[k % colors.length], boxShadow: `0 0 ${r * 2}px ${colors[k % colors.length]}`});
    fx.appendChild(dot);
    runs.push(run('scene', dot, [{transform: 'translate(0,0) scale(.3)', opacity: 1}, {transform: `translate(${Math.cos(a) * d * .7}px,${Math.sin(a) * d * .7}px) scale(1)`, opacity: 1, offset: .45}, {transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 18}px) scale(0)`, opacity: 0}],
      {duration: 800 + Math.random() * 400, easing: 'cubic-bezier(.1,.7,.3,1)'}));
  }
  return runs;
}
async function revealWish(fromOrbit) {
  const gen = sceneGen, scene = $('wishScene'), reveal = $('wishReveal'), fx = $('dotReveal'), tag = $('wishTag');
  const parts = revealParts(), sun = parts[0], imgs = parts.slice(1, 4), texts = parts.slice(4, 6);
  sceneBusy = true; updateControls();
  setCopy($('chosenWish'), `把「${state.wish}」，放进新的这一岁。`); tag.textContent = state.wish;
  const finish = () => {
    fx.replaceChildren(); state.done[1] = true; sceneBusy = false;
    finishSceneCopy(`这份${state.wish}，全部送给璐。`); updateControls();
  };
  if (reduced.matches) { $('wishOrbit').hidden = true; reveal.hidden = false; layoutOrbit(); finish(); return; }
  reveal.hidden = false; layoutOrbit(); parts.forEach(el => { el.style.opacity = '0'; });
  const scr = scene.getBoundingClientRect(), tr = tag.getBoundingClientRect(), sr = sun.getBoundingClientRect();
  const chip = words.find(b => b.dataset.wish === state.wish), runs = [];
  if (fromOrbit && chip && !$('wishOrbit').hidden) {
    const or = orbit.getBoundingClientRect(), ox = or.left + or.width / 2, oy = or.top + or.height / 2, core = orbit.querySelector('.orbit-core');
    chip.classList.add('chosen');
    // 1. 许愿：其余祝福沿弧线被吸进圆心，圆环旋转收拢，圆心像水滴一样鼓动
    words.filter(w => w !== chip).forEach((w, k) => {
      const r = w.getBoundingClientRect(), dx = ox - r.left - r.width / 2, dy = oy - r.top - r.height / 2;
      run('scene', w, [{transform: 'none', opacity: 1}, {transform: `translate(${dx * .45 - dy * .32}px,${dy * .45 + dx * .32}px) scale(.8) rotate(16deg)`, opacity: 1, offset: .55}, {transform: `translate(${dx}px,${dy}px) scale(.12) rotate(36deg)`, opacity: 0}],
        {duration: 640, delay: k * 60, easing: 'cubic-bezier(.55,0,.35,1)'});
    });
    run('scene', ring, [{transform: 'rotate(0deg) scale(1)', opacity: 1}, {transform: 'rotate(140deg) scale(.5)', opacity: 0}], {duration: 900, easing: 'cubic-bezier(.5,0,.3,1)'});
    run('scene', orbit.querySelector('.orbit-dial'), [{transform: 'rotate(0deg) scale(1)', opacity: 1}, {transform: 'rotate(-90deg) scale(.6)', opacity: 0}], {duration: 900, easing: 'cubic-bezier(.5,0,.3,1)'});
    run('scene', orbit.querySelector('.orbit-glow'), [{transform: 'scale(1)', opacity: .62}, {transform: 'scale(1.5)', opacity: .9, offset: .7}, {transform: 'scale(.3)', opacity: 0}], {duration: 1050, easing: 'ease-in-out'});
    run('scene', orbit.querySelector('.orbit-notch'), [{opacity: 1}, {opacity: 0}], {duration: 300});
    words.forEach(w => w.classList.remove('active'));
    run('scene', chip, [{transform: 'none'}, {transform: 'scale(1.2)', offset: .4}, {transform: 'scale(1.1)'}], {duration: 700, easing: 'cubic-bezier(.3,1.4,.5,1)'});
    const absorbed = await run('scene', core, [{transform: 'scale(1)'}, {transform: 'scale(1.07)', offset: .3}, {transform: 'scale(.93)', offset: .55}, {transform: 'scale(1.16)', offset: .85}, {transform: 'scale(1.12)'}], {duration: 880, easing: 'ease-in-out'});
    if (!absorbed || gen !== sceneGen) return;
    // 2. 绽放：圆心炸开，冲击波与星屑；选中的祝福飞成下方的小标签
    run('scene', core, [{transform: 'scale(1.12)', opacity: 1}, {transform: 'scale(1.7)', opacity: 0}], {duration: 380, easing: 'ease-out'});
    runs.push(...burst(ox - scr.left, oy - scr.top, Math.min(scr.width, scr.height)));
    const cr = chip.getBoundingClientRect();
    const flight = run('scene', chip, [{transform: 'scale(1.1)'}, {transform: `translate(${tr.left + tr.width / 2 - cr.left - cr.width / 2}px,${tr.top + tr.height / 2 - cr.top - cr.height / 2}px) scale(${(tr.height / chip.offsetHeight).toFixed(3)})`}],
      {duration: 620, delay: 80, easing: 'cubic-bezier(.5,0,.2,1)'});
    // 标签还在飞，太阳就开始打开；落地时标签轻轻弹开
    runs.push(flight.then(ok => {
      if (!ok || gen !== sceneGen) return false;
      $('wishOrbit').hidden = true; tag.style.opacity = '';
      return run('scene', tag, [{transform: 'scale(.7)', filter: 'brightness(1.3)'}, {transform: 'scale(1.08)', offset: .55}, {transform: 'none', filter: 'none'}], {duration: 560, easing: 'cubic-bezier(.3,1.4,.5,1)'});
    }));
    await new Promise(r => setTimeout(r, 300));
    if (gen !== sceneGen) return;
    parts.forEach(el => { if (el !== tag) el.style.opacity = ''; });
  } else {
    $('wishOrbit').hidden = true; parts.forEach(el => { el.style.opacity = ''; });
    runs.push(run('scene', tag, [{opacity: 0}, {opacity: 1}], {duration: 500}));
  }
  // 3. 揭幕：太阳像光圈一样从中心打开，小猫从两侧弹进来，蛋糕升起
  runs.push(run('scene', sun, [{clipPath: 'circle(0% at 50% 50%)', transform: 'scale(.86) rotate(-24deg)'}, {clipPath: 'circle(71% at 50% 50%)', transform: 'none'}], {duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)'}));
  const enter = [['translate(-46px,24px) rotate(-20deg) scale(.55)', 260], ['translate(46px,24px) rotate(20deg) scale(.55)', 380], ['translateY(36px) scale(.7)', 520]];
  imgs.forEach((img, k) => runs.push(run('scene', img, [{opacity: 0, transform: enter[k][0]}, {opacity: 1, offset: .35}, {opacity: 1, transform: 'none'}], {duration: 820, delay: enter[k][1], easing: 'cubic-bezier(.3,1.45,.5,1)'})));
  setTimeout(() => { if (gen === sceneGen && !$('wishReveal').hidden) runs.push(...burst(sr.left + sr.width / 2 - scr.left, sr.top + sr.height * .62 - scr.top, sr.width * 1.15, 16)); }, 640);
  revealCopy(texts[0], 760); revealCopy(texts[1], 920);
  const ok = await Promise.all(runs);
  await new Promise(r => setTimeout(r, 650));
  if (gen !== sceneGen || ok.includes(false)) return;
  finish();
}

/* --- 第三段：点亮二十岁（实时 Canvas 粒子） --- */
const starCanvas = $('starCanvas'), starButtons = [...document.querySelectorAll('.main-star')];
let sctx = null; try { sctx = starCanvas.getContext('2d'); } catch { sctx = null; }
let sw = 0, sh = 0, sClock = 0, fullTime = 0, starPos = [[0, 0], [0, 0], [0, 0]], glyph = null;
const groups = [0, 0, 0]; // 每颗主星带来的粒子汇聚进度
const repel = {x: 0, y: 0, k: 0, on: false};
function seeded(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeSprite(inner, mid) {
  const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'), grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, inner); grad.addColorStop(.3, mid); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(0, 0, 32, 32); return c;
}
let goldSprite = null, emberSprite = null;
function buildGlyph() {
  if (glyph || !sctx) return glyph;
  try {
    const W = 420, H = 280, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `italic 700 250px Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif`; g.fillText('20', W / 2, H / 2 + 6);
    const data = g.getImageData(0, 0, W, H).data, rand = seeded(20061023), pts = [];
    for (let y = 2; y < H; y += 4) for (let x = 2; x < W; x += 4) if (data[(y * W + x) * 4 + 3] > 140) pts.push([x + (rand() - .5) * 2.4, y + (rand() - .5) * 2.4]);
    if (pts.length < 50) return null;
    const xs = pts.map(p => p[0]).sort((a, b) => a - b), cut1 = xs[Math.floor(xs.length / 3)], cut2 = xs[Math.floor(xs.length * 2 / 3)];
    const parts = pts.map(([x, y], i) => {
      const a = rand() * Math.PI * 2, r = 6 + Math.pow(rand(), 1.4) * 38;
      return {hx: x, hy: y, g: x < cut1 ? 0 : x < cut2 ? 1 : 2, ox: Math.cos(a) * r, oy: Math.sin(a) * r * .8, delay: rand(), size: 1.3 + rand() * 2.2, phase: rand() * 6.28, bend: (rand() - .5) * 2, ember: i % 11 === 0};
    });
    const dust = Array.from({length: 90}, () => ({x: rand(), y: rand(), s: rand() < .85 ? .8 : 1.5, a: .15 + rand() * .45, p: rand() * 6.28}));
    goldSprite = makeSprite('rgba(255,247,222,1)', 'rgba(248,212,140,.55)'); emberSprite = makeSprite('rgba(255,226,196,1)', 'rgba(255,130,70,.55)');
    glyph = {W, H, parts, dust};
  } catch { glyph = null; }
  return glyph;
}
function resizeStars() {
  if (state.scene !== 2 || !experience.open) return;
  const scene = $('starsScene'); sw = scene.clientWidth; sh = scene.clientHeight;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  starCanvas.width = Math.round(sw * ratio); starCanvas.height = Math.round(sh * ratio); sctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  const sr = scene.getBoundingClientRect();
  starPos = starButtons.map(b => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2 - sr.left, r.top + r.height / 2 - sr.top]; });
  drawStars();
}
function glyphFrame() {
  const fieldH = sh - 104, s = Math.min(sw * .92 / glyph.W, fieldH * .78 / glyph.H);
  return {s, x0: sw / 2 - glyph.W * s / 2, y0: fieldH * .6 - glyph.H * s / 2};
}
function drawStars() {
  if (!sctx || !sw || !glyph) return;
  const c = sctx, t = sClock, still = reduced.matches, lit = state.stars, f = glyphFrame();
  c.clearRect(0, 0, sw, sh);
  for (const d of glyph.dust) { c.globalAlpha = d.a * (still ? 1 : .55 + .45 * Math.sin(t * .0011 + d.p)); c.fillStyle = '#f5e8cc'; c.fillRect(d.x * sw, d.y * (sh - 40), d.s, d.s); }
  // 星轨
  const cx = sw / 2, cy = f.y0 + glyph.H * f.s / 2, rx = glyph.W * f.s * .62, ry = glyph.H * f.s * .26;
  c.globalAlpha = 1; c.lineWidth = .8;
  for (let k = 0; k < 2; k++) { c.strokeStyle = `rgba(242,205,140,${state.done[2] ? .16 : .07})`; c.beginPath(); c.ellipse(cx, cy, rx * (1 + k * .13), ry * (1 + k * .3), -.18, 0, Math.PI * 2); c.stroke(); }
  // 已点亮的星连线
  const litPos = starPos.filter((_, i) => lit[i]);
  if (litPos.length > 1) { c.strokeStyle = 'rgba(246,219,160,.22)'; c.setLineDash([2, 5]); c.beginPath(); litPos.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); c.setLineDash([]); }
  // 粒子
  c.globalCompositeOperation = 'lighter';
  for (const p of glyph.parts) {
    const gp = still ? (lit[p.g] ? 1 : 0) : groups[p.g];
    const e = still ? gp : easeInOut(clamp((gp - p.delay * .38) / .62));
    const [sx0, sy0] = starPos[p.g];
    const wob = still ? 0 : Math.sin(t * .0009 + p.phase) * 3;
    const sx = sx0 + p.ox + wob, sy = sy0 + p.oy + Math.cos(t * .0008 + p.phase) * 2.4;
    const hx = f.x0 + p.hx * f.s, hy = f.y0 + p.hy * f.s + (still ? 0 : Math.sin(t * .0007 + p.hx * .05) * .8 * e);
    const mx = (sx + hx) / 2 - (hy - sy) * .25 * p.bend, my = (sy + hy) / 2 + (hx - sx) * .25 * p.bend;
    const u = 1 - e;
    let x = u * u * sx + 2 * u * e * mx + e * e * hx, y = u * u * sy + 2 * u * e * my + e * e * hy;
    if (repel.k > .01) {
      const dx = x - repel.x, dy = y - repel.y, d = Math.hypot(dx, dy) || 1, R = 78;
      if (d < R) { const push = Math.pow(1 - d / R, 3) * 34 * repel.k; x += dx / d * push; y += dy / d * push; }
    }
    const twinkle = still ? .85 : .6 + .4 * Math.sin(t * .0024 + p.phase);
    c.globalAlpha = (lit[p.g] ? .5 + .5 * e : .12) * twinkle;
    const r = p.size * (lit[p.g] ? 1 + .9 * Math.sin(e * Math.PI) : .6);
    c.drawImage(p.ember ? emberSprite : goldSprite, x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
  }
  // 绕着 20 的流星
  if (state.done[2] && !still) {
    for (let k = 0; k < 2; k++) {
      const base = t * (k ? .00042 : .00055) + k * Math.PI;
      for (let j = 0; j < 18; j++) {
        const a = base - j * .03, ex = rx * (1 + k * .13), ey = ry * (1 + k * .3);
        const x = cx + ex * Math.cos(a) * Math.cos(-.18) - ey * Math.sin(a) * Math.sin(-.18), y = cy + ex * Math.cos(a) * Math.sin(-.18) + ey * Math.sin(a) * Math.cos(-.18);
        c.globalAlpha = (1 - j / 18) * .8; const r = 3.6 * (1 - j / 22);
        c.drawImage(goldSprite, x - r, y - r, r * 2, r * 2);
      }
    }
  }
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
}
const starLoop = makeLoop(dt => {
  sClock += dt;
  repel.k += ((repel.on ? 1 : 0) - repel.k) * Math.min(1, dt / (repel.on ? 90 : 420));
  state.stars.forEach((on, i) => { if (on) groups[i] = Math.min(1, groups[i] + dt / 1500); });
  if (state.stars.every(Boolean) && groups.every(v => v >= 1) && !state.done[2]) { fullTime += dt; if (fullTime >= 700) completeStars(); }
  drawStars();
}, () => stageActive() && state.scene === 2);
function renderStarButtons() {
  starButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(state.stars[i])));
  const count = state.stars.filter(Boolean).length;
  $('starCount').textContent = count === 3 ? '二十岁，是一个很好的开始。' : `还有 ${3 - count} 颗星，等你点亮。`;
  $('starsScene').classList.toggle('formed', state.done[2]);
  $('starFallback').hidden = !!glyph || count !== 3;
}
function enterStars() {
  buildGlyph(); renderStarButtons(); resizeStars();
  if (state.done[2]) { $('stageStatus').textContent = '这一片星光属于你，用手指拨一拨。'; revealCopy($('starBlessing'), 520); }
  else checkStarsStill();
}
function checkStarsStill() {
  // 没有 Canvas 或减少动态：直接给出静态结果
  if ((!glyph || reduced.matches) && state.stars.every(Boolean)) completeStars();
  else if (reduced.matches) drawStars();
}
function completeStars() {
  if (state.done[2]) return;
  state.done[2] = true; groups.fill(1); renderStarButtons(); drawStars();
  revealCopy($('starCount')); revealCopy($('starBlessing'), 200);
  finishSceneCopy('这一片星光属于你，用手指拨一拨。'); updateControls();
}
const starsScene = $('starsScene');
function moveRepel(e) {
  if (reduced.matches || (e.pointerType !== 'mouse' && e.buttons === 0 && e.type === 'pointermove')) return;
  const r = starsScene.getBoundingClientRect(); repel.x = e.clientX - r.left; repel.y = e.clientY - r.top; repel.on = true;
}
starsScene.addEventListener('pointermove', moveRepel);
starsScene.addEventListener('pointerdown', moveRepel);
for (const type of ['pointerleave', 'pointerup', 'pointercancel']) starsScene.addEventListener(type, e => { if (type !== 'pointerup' || e.pointerType !== 'mouse') repel.on = false; });
starButtons.forEach((button, i) => button.addEventListener('click', () => {
  if (state.stars[i] || state.scene !== 2) return;
  state.stars[i] = true; renderStarButtons(); revealCopy($('starCount'));
  starLoop.start(); checkStarsStill();
}));

/* --- 进入第三段：短暂的透视线框过渡 --- */
const depthCanvas = $('depthCanvas');
let dctx = null; try { dctx = depthCanvas.getContext('2d'); } catch { dctx = null; }
let depthTime = null, dw = 0, dh = 0;
function sizeDepth() {
  const ratio = Math.min(devicePixelRatio || 1, 2); dw = depthCanvas.clientWidth; dh = depthCanvas.clientHeight;
  depthCanvas.width = Math.round(dw * ratio); depthCanvas.height = Math.round(dh * ratio); dctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
function drawDepth() {
  if (!dctx || depthTime === null || !dw) return;
  const c = dctx, t = clamp(depthTime / 900), fade = 1 - clamp((t - .45) / .55);
  c.clearRect(0, 0, dw, dh); c.fillStyle = `rgba(19,16,27,${fade * .96})`; c.fillRect(0, 0, dw, dh);
  c.save(); c.translate(dw / 2, dh * .46);
  for (let i = 0; i < 16; i++) {
    const z = (i / 16 + t * .8) % 1, size = 16 / Math.pow(1 - z, 1.45);
    c.save(); c.rotate((1 - z) * -.22 + t * .1);
    c.strokeStyle = i % 4 === 0 ? `rgba(255,128,70,${fade * .65})` : `rgba(242,214,160,${fade * .32})`; c.lineWidth = .8;
    c.strokeRect(-size, -size * 1.3, size * 2, size * 2.6); c.restore();
  }
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 ${Math.round(110 + t * 40)}px ${LATIN}`;
  c.lineWidth = .8; c.strokeStyle = `rgba(246,224,180,${fade * .55})`; c.strokeText('20', 0, 0); c.restore();
}
const depthLoop = makeLoop(dt => {
  depthTime += dt; drawDepth();
  if (depthTime >= 900) { depthTime = null; depthCanvas.hidden = true; return false; }
}, () => stageActive() && depthTime !== null);
function beginDepth() {
  if (reduced.matches || !dctx) return;
  depthTime = 0; depthCanvas.hidden = false; sizeDepth(); drawDepth(); depthLoop.start();
}

/* --- 第四段：最后的小猫贺卡 --- */
const finalCard = $('finalCard');
function enterFinal() {
  if (!state.pet) $('finalCatMessage').textContent = '';
  if (state.pet) $('stageStatus').textContent = '最后一封信，等你拆开。';
  [$('finalCatMessage'), finalCard.closest('.final-scene').querySelector('.final-title'), finalCard.closest('.final-scene').querySelector('.final-blessing')].forEach((el, k) => revealCopy(el, 520 + k * 140));
}
document.querySelectorAll('.final-cat').forEach(cat => cat.addEventListener('click', () => {
  pet(cat); state.pet = true;
  setCopy($('finalCatMessage'), cat.classList.contains('final-orange') ? '橘猫：今天的好运，全部送给璐。' : '白猫：愿你一直被温柔对待。'); revealCopy($('finalCatMessage'));
  if (!state.done[3]) { state.done[3] = true; finishSceneCopy('最后一封信，等你拆开。'); updateControls(); }
}));
let tiltPointer = null;
function tiltCard(e) {
  const r = finalCard.getBoundingClientRect(), x = clamp((e.clientX - r.left) / r.width), y = clamp((e.clientY - r.top) / r.height);
  finalCard.classList.add('tilting');
  finalCard.style.setProperty('--ry', ((x * 2 - 1) * 9).toFixed(2) + 'deg'); finalCard.style.setProperty('--rx', ((1 - y * 2) * 7).toFixed(2) + 'deg');
  finalCard.style.setProperty('--hx', (x * 100).toFixed(1) + '%'); finalCard.style.setProperty('--hy', (y * 100).toFixed(1) + '%');
  finalCard.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); finalCard.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
}
function untiltCard() { tiltPointer = null; finalCard.classList.remove('tilting'); for (const k of ['--rx', '--ry', '--hx', '--hy', '--gx', '--gy']) finalCard.style.removeProperty(k); }
finalCard.addEventListener('pointerdown', e => { if (reduced.matches || e.pointerType === 'mouse') return; tiltPointer = e.pointerId; tiltCard(e); });
finalCard.addEventListener('pointermove', e => {
  if (reduced.matches || (e.pointerType !== 'mouse' && e.pointerId !== tiltPointer)) return;
  tiltCard(e);
});
finalCard.addEventListener('pointerleave', untiltCard);
finalCard.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') untiltCard(); });
finalCard.addEventListener('pointercancel', untiltCard);
$('restartExperience').addEventListener('click', () => {
  state = freshState(); groups.fill(0); fullTime = 0;
  setCopy($('finalCatMessage'), ''); renderScene();
});

/* ================= 4. 最后一封信 ================= */
function showLetter(trigger) {
  letterTrigger = trigger; if (letter.open) return;
  letter.showModal(); $('letterBody').scrollTop = 0; syncDialogs(); $('closeLetter').focus({preventScroll: true});
  $('letterBody').querySelectorAll('p').forEach((p, i) => revealCopy(p, Math.min(120 + i * 110, 900)));
}
function closeLetter() { if (letter.open) letter.close(); }
letter.addEventListener('close', () => { syncDialogs(); if (letterTrigger?.isConnected && !letterTrigger.closest('[hidden],[inert]')) letterTrigger.focus({preventScroll: true}); });
letter.addEventListener('cancel', e => { e.preventDefault(); closeLetter(); });
letter.addEventListener('click', e => {
  if (e.target !== letter) return;
  const r = letter.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeLetter();
});
$('letterButton').addEventListener('click', () => showLetter($('letterButton')));
$('closeLetter').addEventListener('click', closeLetter);

/* ================= 液态玻璃：高光跟随指尖 ================= */
const GLASS = '.glass,.primary,.control-next';
function lightGlass(e) {
  if (reduced.matches) return;
  const el = e.target instanceof Element ? e.target.closest(GLASS) : null;
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.classList.add('lit');
  el.style.setProperty('--mx', clamp((e.clientX - r.left) / r.width, -.2, 1.2) * 100 + '%');
  el.style.setProperty('--my', clamp((e.clientY - r.top) / r.height, -.4, 1.4) * 100 - 30 + '%');
}
function dimGlass(e) {
  const el = e.target instanceof Element ? e.target.closest(GLASS) : null;
  if (!el || (e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) return;
  el.classList.remove('lit'); el.style.removeProperty('--mx'); el.style.removeProperty('--my');
}
document.addEventListener('pointermove', lightGlass, {passive: true});
document.addEventListener('pointerdown', lightGlass, {passive: true});
document.addEventListener('pointerout', dimGlass, {passive: true});
document.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') dimGlass({target: e.target, relatedTarget: null}); }, {passive: true});

/* ================= 背景音乐：拆信时开始 ================= */
// 用普通的 <audio> 媒体播放：iPhone 的静音开关不会把它静音（Web Audio 会）。
// iPhone 不允许网页改 audio.volume，所以音量已经直接调进音频文件里（约 -10 dB）。
const music = {el: null, on: true, started: false};
const musicButtons = [...document.querySelectorAll('.music-toggle')];
function musicEl() {
  if (!music.el) {
    const a = new Audio();
    a.src = 'assets/music.mp3'; a.loop = true; a.preload = 'auto'; a.setAttribute('playsinline', ''); a.setAttribute('webkit-playsinline', '');
    for (const type of ['playing', 'pause', 'waiting']) a.addEventListener(type, renderMusicButtons);
    music.el = a;
  }
  return music.el;
}
function renderMusicButtons() {
  const playing = music.on && !!music.el && !music.el.paused && !isAway();
  musicButtons.forEach(b => { b.setAttribute('aria-pressed', String(music.on)); b.setAttribute('aria-label', music.on ? '背景音乐：开，点一下静音' : '背景音乐：关，点一下播放'); b.classList.toggle('playing', playing); });
}
// 页面打开后先在后台把音乐下载好（只下载、不播放）
addEventListener('load', () => setTimeout(() => { try { musicEl().load(); } catch {} }, 1000), {once: true});
function startMusic() { // 必须在用户的点击、滑动里同步调用
  if (music.started || !music.on) return;
  music.started = true; syncMusic();
}
function syncMusic() {
  renderMusicButtons();
  if (!music.started) return;
  const a = musicEl();
  if (music.on && !isAway()) {
    const playing = a.play();
    if (playing) playing.catch(() => { music.started = false; renderMusicButtons(); }); // 没被允许时，下一次点击再试
  } else a.pause();
}
musicButtons.forEach(b => b.addEventListener('click', () => {
  music.on = !music.on;
  if (music.on) { music.started = true; syncMusic(); } else syncMusic();
}));
// 兜底：若拆信那一下没能出声（或直接从 #gift 进入），之后任何一次触摸、点击都会把音乐接上
for (const type of ['touchend', 'click']) document.addEventListener(type, e => {
  if (music.on && (entrance.hidden || locked) && (!music.el || music.el.paused) && !isAway() && !(e.target instanceof Element && e.target.closest('.music-toggle'))) { music.started = true; syncMusic(); }
}, true);

/* ================= 全局状态同步 ================= */
function syncDialogs() { body.classList.toggle('dialog-open', experience.open || letter.open); syncActivity(); }
function syncActivity() {
  if (typeof syncMusic === 'function' && music.started) syncMusic();
  body.classList.toggle('is-hidden', isAway());
  experience.classList.toggle('paused', !stageActive());
  for (const group in live) for (const a of live[group]) {
    if (a.playState === 'finished' || a.playState === 'idle') continue;
    if (canPlay(group)) a.play(); else a.pause();
  }
  if (stageActive()) {
    if (state.scene === 2 && !reduced.matches) starLoop.start();
    if (depthTime !== null) depthLoop.start();
    if (state.scene === 1 && Math.abs(spin) > .01) spinLoop.start();
  } else { starLoop.stop(); depthLoop.stop(); spinLoop.stop(); }
}
function onResize() {
  measureSlide();
  if (opening && openSize && (innerWidth !== openSize[0] || innerHeight !== openSize[1])) finishEntrance();
  if (experience.open) { renderJoy(); layoutOrbit(); resizeStars(); if (depthTime !== null) { sizeDepth(); drawDepth(); } }
}
addEventListener('resize', onResize);
document.addEventListener('visibilitychange', syncActivity);
addEventListener('pagehide', e => { pageSuspended = true; syncActivity(); if (!e.persisted) { clearTimeout(toastTimer); clearTimeout(confettiTimer); } });
addEventListener('pageshow', () => { pageSuspended = false; syncActivity(); });
reduced.addEventListener('change', () => {
  if (reduced.matches) { if (opening) finishEntrance(); fw.parts.length = 0; }
  if (experience.open) renderScene(false);
});
addEventListener('hashchange', () => { if (location.hash === '#gift' && !entrance.hidden) finishEntrance(); });

document.fonts?.ready.then(measureSlide);
if (location.hash === '#gift') finishEntrance(); else showEntrance(false);
})();
