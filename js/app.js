// 화면 담당 파일
let data = Store.load();
if (!data.activeSession) data.timer = null; // 운동 중이 아니면 남은 타이머 정리

const ui = { tab: 'home', routineId: null };
const main = document.getElementById('main');
const tabbar = document.getElementById('tabbar');

// 휴식 타이머 바(화면 아래, 탭 위에 떠 있음)
const timerbar = document.createElement('div');
timerbar.id = 'timerbar';
document.body.insertBefore(timerbar, tabbar);

let wakeLock = null;
let wakePending = false;
let wakeStatus = '확인 전';
let audioCtx = null;

const TABS = [
  { id: 'home', label: '홈' },
  { id: 'workout', label: '운동' },
  { id: 'routines', label: '루틴' },
  { id: 'history', label: '기록' }
];

/* ---------- 도우미 ---------- */

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function persist() {
  if (!Store.save(data)) {
    alert('저장에 실패했어요. 저장 공간이나 브라우저 설정을 확인해 주세요.');
  }
}

function currentRoutine() {
  return data.routines.find(function (r) { return r.id === ui.routineId; });
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function newSet(weight, reps) {
  return { id: Store.newId(), weight: weight, reps: reps, done: false };
}

function findEx(s, exId) {
  return s.exercises.find(function (x) { return x.id === exId; });
}

function findSet(s, exId, setId) {
  const ex = findEx(s, exId);
  if (!ex) return null;
  return ex.sets.find(function (x) { return x.id === setId; }) || null;
}

function countDone(s) {
  let n = 0;
  s.exercises.forEach(function (ex) {
    ex.sets.forEach(function (st) { if (st.done) n++; });
  });
  return n;
}

/* ---------- 소리 ---------- */

// 아이폰은 화면을 한 번 눌러야 소리를 낼 수 있어서, 버튼을 누를 때마다 준비해 둔다
function unlockAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}

function beep() {
  if (audioCtx) {
    try {
      for (let i = 0; i < 3; i++) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = 880;
        o.connect(g);
        g.connect(audioCtx.destination);
        const t0 = audioCtx.currentTime + i * 0.4;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.start(t0);
        o.stop(t0 + 0.32);
      }
    } catch (e) {}
  }
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
}

/* ---------- 화면 켜짐 유지 ---------- */

function setWakeStatus(t) {
  wakeStatus = t;
  const el = document.getElementById('wake-status');
  if (el) el.textContent = t;
}

async function updateWakeLock() {
  if (!('wakeLock' in navigator)) { setWakeStatus('이 기기에서 지원 안 됨'); return; }
  if (wakePending) return;
  const need = !!data.activeSession && document.visibilityState === 'visible';
  wakePending = true;
  try {
    if (need && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', function () { wakeLock = null; });
      setWakeStatus('켜짐');
    } else if (!need && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
      setWakeStatus('꺼짐');
    }
  } catch (e) {
    wakeLock = null;
    setWakeStatus('실패: ' + (e && e.name ? e.name : '오류'));
  }
  wakePending = false;
}

/* ---------- 휴식 타이머 ---------- */
// data.timer = { label, total, endAt, remainMs(일시정지 중일 때만 값 있음), finished }

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + pad(s % 60);
}

function timerRemaining(t) {
  return t.remainMs !== null ? t.remainMs : t.endAt - Date.now();
}

function startTimer(label, sec) {
  if (!sec || sec <= 0) {
    data.timer = null;
  } else {
    data.timer = {
      label: label,
      total: sec * 1000,
      endAt: Date.now() + sec * 1000,
      remainMs: null,
      finished: false
    };
  }
  persist();
  renderTimerBar();
}

function adjustTimer(deltaSec) {
  const t = data.timer;
  if (!t || t.finished) return;
  if (t.remainMs !== null) {
    t.remainMs = Math.max(1000, t.remainMs + deltaSec * 1000);
  } else {
    t.endAt = Math.max(Date.now() + 1000, t.endAt + deltaSec * 1000);
  }
  persist();
  renderTimerBar();
}

function togglePause() {
  const t = data.timer;
  if (!t || t.finished) return;
  if (t.remainMs === null) {
    t.remainMs = Math.max(0, t.endAt - Date.now());
  } else {
    t.endAt = Date.now() + t.remainMs;
    t.remainMs = null;
  }
  persist();
  renderTimerBar();
}

function finishTimer(t) {
  t.finished = true;
  persist();
  // 끝난 지 얼마 안 됐을 때만 소리를 낸다 (다른 앱에 갔다 온 뒤 뒤늦게 울리지 않도록)
  if (Date.now() - t.endAt < 3000) beep();
  renderTimerBar();
}

function tickTimer() {
  const t = data.timer;
  if (!t) return;
  const el = document.getElementById('tb-time');
  if (t.finished) {
    if (el) el.textContent = '0:00';
    return;
  }
  const rem = timerRemaining(t);
  if (rem <= 0 && t.remainMs === null) {
    finishTimer(t);
    return;
  }
  if (el) el.textContent = fmt(rem);
}

function positionTimerBar() {
  timerbar.style.bottom = tabbar.offsetHeight + 'px';
}

function renderTimerBar() {
  const t = data.timer;
  document.body.classList.toggle('has-timer', !!t);
  if (!t) {
    timerbar.style.display = 'none';
    timerbar.innerHTML = '';
    return;
  }
  timerbar.style.display = 'block';
  positionTimerBar();
  const paused = t.remainMs !== null;
  let btns;
  if (t.finished) {
    btns = '<button class="primary" data-t="close">휴식 끝 · 닫기</button>';
  } else {
    btns = '<button data-t="m15">-15</button>' +
      '<button data-t="pause">' + (paused ? '재개' : '일시정지') + '</button>' +
      '<button data-t="p15">+15</button>' +
      '<button data-t="clock">시계앱</button>' +
      '<button class="danger" data-t="close">건너뛰기</button>';
  }
  timerbar.innerHTML =
    '<div class="tb-top"><span class="tb-label">' + esc(t.label) + '</span>' +
    '<span id="tb-time" class="tb-time"></span></div>' +
    '<div class="tb-btns">' + btns + '</div>';
  tickTimer();
}

/* ---------- 운동 세션(오늘 운동) ---------- */

// 루틴을 "복사"해서 오늘 운동을 만든다. 루틴 자체는 바뀌지 않는다.
function startSession(routine) {
  const s = {
    id: Store.newId(),
    routineId: routine ? routine.id : null,
    routineName: routine ? routine.name : '자유 운동',
    date: todayStr(),
    startedAt: Date.now(),
    exercises: []
  };
  if (routine) {
    routine.exercises.forEach(function (ex) {
      const sets = [];
      for (let i = 0; i < ex.sets; i++) sets.push(newSet(ex.weight, ex.reps));
      s.exercises.push({ id: Store.newId(), name: ex.name, rest: ex.rest, note: '', sets: sets });
    });
  }
  data.activeSession = s;
  persist();
}

// 종료: 체크한 세트만 기록으로 저장한다. 저장했으면 true.
function finishSession() {
  const s = data.activeSession;
  if (!s) return false;

  let done = 0, notDone = 0;
  s.exercises.forEach(function (ex) {
    ex.sets.forEach(function (st) { if (st.done) done++; else notDone++; });
  });

  if (done === 0) {
    if (!confirm('완료한 세트가 없어요. 기록하지 않고 운동을 끝낼까요?')) return false;
    data.activeSession = null;
    data.timer = null;
    persist();
    return true;
  }

  let msg = '운동을 종료하고 기록할까요?';
  if (notDone > 0) msg += '\n체크하지 않은 세트 ' + notDone + '개는 기록에서 제외돼요.';
  if (!confirm(msg)) return false;

  s.endedAt = Date.now();
  s.exercises = s.exercises.map(function (ex) {
    return {
      id: ex.id,
      name: ex.name.trim() || '이름 없는 운동',
      rest: ex.rest,
      note: ex.note,
      sets: ex.sets.filter(function (st) { return st.done; })
    };
  }).filter(function (ex) {
    return ex.sets.length > 0 || ex.note.trim() !== '';
  });

  data.sessions.push(s);
  data.activeSession = null;
  data.timer = null;
  persist();
  return true;
}

/* ---------- 화면 그리기 ---------- */

function renderTabbar() {
  tabbar.innerHTML = TABS.map(function (t) {
    return '<button data-tab="' + t.id + '" class="' + (ui.tab === t.id ? 'active' : '') + '">' + t.label + '</button>';
  }).join('');
}

function renderHome() {
  let html = '<h1>홈</h1>';
  const a = data.activeSession;

  if (a) {
    html += '<div class="card"><b>진행 중인 운동</b><br>' +
      '<span class="muted">' + esc(a.routineName) + ' · 완료 ' + countDone(a) + '세트</span>' +
      '<p><button class="primary wide" data-action="resume">이어서 하기</button></p></div>';
  } else {
    html += '<h2>오늘 운동 시작</h2>';
    if (data.routines.length === 0) {
      html += '<p class="muted">루틴 탭에서 루틴을 먼저 만들 수 있어요.</p>';
    }
    data.routines.forEach(function (r) {
      html += '<button class="card item" data-action="start-routine" data-id="' + r.id + '">' +
        '<b>' + esc(r.name) + '</b><br><span class="muted">운동 ' + r.exercises.length + '개 · 눌러서 시작</span></button>';
    });
    html += '<button class="wide" data-action="start-empty">루틴 없이 시작</button>';
  }

  html += '<h2>최근 기록</h2>';
  if (data.sessions.length === 0) {
    html += '<p class="muted">아직 기록이 없어요.</p>';
  } else {
    data.sessions.slice(-3).reverse().forEach(function (s) {
      let n = 0;
      s.exercises.forEach(function (ex) { n += ex.sets.length; });
      html += '<div class="card"><b>' + esc(s.date) + '</b> · ' + esc(s.routineName) +
        '<br><span class="muted">운동 ' + s.exercises.length + '개 · ' + n + '세트</span></div>';
    });
  }
  main.innerHTML = html;
}

function renderWorkout() {
  const s = data.activeSession;
  if (!s) {
    main.innerHTML = '<h1>운동</h1><p class="muted">진행 중인 운동이 없어요. 홈에서 시작해 보세요.</p>';
    return;
  }

  let html = '<h1>' + esc(s.routineName) + '</h1>' +
    '<p class="muted">' + esc(s.date) + ' · 완료 ' + countDone(s) + '세트</p>' +
    '<p class="muted">화면 켜짐 유지: <span id="wake-status">' + esc(wakeStatus) + '</span></p>';

  s.exercises.forEach(function (ex) {
    html += '<div class="card">' +
      '<input data-sx="' + ex.id + '" data-sf="name" value="' + esc(ex.name) + '" placeholder="운동 이름">' +
      '<div class="setrow head"><span>세트</span><span>kg</span><span>회</span><span>완료</span><span></span></div>';

    ex.sets.forEach(function (st, i) {
      html += '<div class="setrow' + (st.done ? ' done' : '') + '">' +
        '<span class="setno">' + (i + 1) + '</span>' +
        '<input type="number" inputmode="decimal" step="0.5" min="0" data-sx="' + ex.id + '" data-ss="' + st.id + '" data-sf="weight" value="' + st.weight + '">' +
        '<input type="number" inputmode="numeric" step="1" min="0" data-sx="' + ex.id + '" data-ss="' + st.id + '" data-sf="reps" value="' + st.reps + '">' +
        '<button class="check' + (st.done ? ' on' : '') + '" data-action="toggle-set" data-sx="' + ex.id + '" data-ss="' + st.id + '">' + (st.done ? '✓' : '') + '</button>' +
        '<button class="danger small" data-action="del-set" data-sx="' + ex.id + '" data-ss="' + st.id + '">✕</button>' +
        '</div>';
    });

    html += '<div class="row" style="margin-top:10px">' +
        '<button data-action="add-set" data-sx="' + ex.id + '">+ 세트</button>' +
        '<span class="spacer"></span>' +
        '<button class="danger" data-action="del-sex" data-sx="' + ex.id + '">운동 삭제</button>' +
      '</div>' +
      '<div class="row" style="margin-top:10px">' +
        '<label style="margin:0;white-space:nowrap">휴식(초)</label>' +
        '<input type="number" inputmode="numeric" min="0" step="5" data-sx="' + ex.id + '" data-sf="rest" value="' + ex.rest + '" style="width:90px;text-align:center">' +
      '</div>' +
      '<label style="margin-top:10px">메모</label>' +
      '<textarea data-sx="' + ex.id + '" data-sf="note" rows="2" placeholder="메모 (예: 기구 사용 불가로 대체)">' + esc(ex.note) + '</textarea>' +
      '</div>';
  });

  html += '<button class="wide" data-action="add-sex">+ 운동 추가</button>';
  html += '<p><button class="primary wide" data-action="finish">운동 종료</button></p>';
  main.innerHTML = html;
}

function renderHistory() {
  main.innerHTML = '<h1>기록</h1><p class="muted">준비 중입니다.</p>';
}

function renderRoutines() {
  if (ui.routineId) { renderRoutineDetail(); return; }
  let html = '<h1>루틴</h1>';
  if (data.routines.length === 0) {
    html += '<p class="muted">아직 루틴이 없어요. 아래 버튼으로 만들어 보세요.</p>';
  }
  data.routines.forEach(function (r) {
    html += '<button class="card item" data-action="open-routine" data-id="' + r.id + '">' +
      '<b>' + esc(r.name) + '</b><br><span class="muted">운동 ' + r.exercises.length + '개</span></button>';
  });
  html += '<button class="primary wide" data-action="new-routine">+ 새 루틴</button>';
  main.innerHTML = html;
}

function numInput(ex, field, label, mode, step) {
  return '<div><label>' + label + '</label>' +
    '<input type="number" inputmode="' + mode + '" step="' + step + '" min="0" ' +
    'data-ex="' + ex.id + '" data-field="' + field + '" value="' + ex[field] + '"></div>';
}

function renderRoutineDetail() {
  const r = currentRoutine();
  if (!r) { ui.routineId = null; renderRoutines(); return; }

  let html = '<div class="row"><button data-action="back-routines">← 목록</button></div>';
  html += '<h1>루틴 편집</h1>';
  html += '<div class="card"><label>루틴 이름</label>' +
    '<input id="routine-name" value="' + esc(r.name) + '"></div>';

  r.exercises.forEach(function (ex, i) {
    html += '<div class="card">' +
      '<label>운동 ' + (i + 1) + '</label>' +
      '<input data-ex="' + ex.id + '" data-field="name" value="' + esc(ex.name) + '" placeholder="운동 이름 (예: 벤치프레스)">' +
      '<div class="grid4">' +
        numInput(ex, 'sets', '세트', 'numeric', 1) +
        numInput(ex, 'weight', '중량(kg)', 'decimal', 0.5) +
        numInput(ex, 'reps', '반복', 'numeric', 1) +
        numInput(ex, 'rest', '휴식(초)', 'numeric', 5) +
      '</div>' +
      '<div class="row">' +
        '<button data-action="move-up" data-ex="' + ex.id + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button data-action="move-down" data-ex="' + ex.id + '"' + (i === r.exercises.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<span class="spacer"></span>' +
        '<button class="danger" data-action="del-exercise" data-ex="' + ex.id + '">삭제</button>' +
      '</div></div>';
  });

  html += '<button class="primary wide" data-action="add-exercise">+ 운동 추가</button>';
  html += '<p><button class="danger wide" data-action="del-routine">이 루틴 삭제</button></p>';
  main.innerHTML = html;
}

function render() {
  renderTabbar();
  if (ui.tab === 'home') renderHome();
  else if (ui.tab === 'workout') renderWorkout();
  else if (ui.tab === 'routines') renderRoutines();
  else renderHistory();
  renderTimerBar();
  updateWakeLock();
}

/* ---------- 버튼 누를 때 ---------- */

tabbar.addEventListener('click', function (e) {
  unlockAudio();
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  ui.tab = btn.dataset.tab;
  ui.routineId = null;
  render();
  window.scrollTo(0, 0);
});

timerbar.addEventListener('click', function (e) {
  unlockAudio();
  const b = e.target.closest('[data-t]');
  if (!b) return;
  const a = b.dataset.t;
  if (a === 'm15') adjustTimer(-15);
  else if (a === 'p15') adjustTimer(15);
  else if (a === 'pause') togglePause();
  else if (a === 'close') { data.timer = null; persist(); renderTimerBar(); }
  else if (a === 'clock') {
    const t = data.timer;
    if (t) {
      const sec = Math.max(1, Math.ceil(timerRemaining(t) / 1000));
      location.href = 'shortcuts://run-shortcut?name=' +
        encodeURIComponent('휴식타이머') + '&input=text&text=' + sec;
    }
  }
});

main.addEventListener('click', function (e) {
  unlockAudio();
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  // 입력 중이던 칸이 있으면 먼저 확정한다 (값이 사라지는 것을 막기 위해)
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }

  const action = btn.dataset.action;
  const r = currentRoutine();
  const s = data.activeSession;
  let keep = false; // true면 화면 스크롤 위치를 유지한다

  /* --- 운동 시작·진행 --- */
  if (action === 'start-routine') {
    const rt = data.routines.find(function (x) { return x.id === btn.dataset.id; });
    if (rt && !s) { startSession(rt); ui.tab = 'workout'; }
  } else if (action === 'start-empty') {
    if (!s) { startSession(null); ui.tab = 'workout'; }
  } else if (action === 'resume') {
    ui.tab = 'workout';
  } else if (action === 'toggle-set' && s) {
    const ex = findEx(s, btn.dataset.sx);
    const st = findSet(s, btn.dataset.sx, btn.dataset.ss);
    if (ex && st) {
      st.done = !st.done;
      persist();
      // 체크했을 때만 휴식 타이머 시작
      if (st.done) startTimer((ex.name.trim() || '휴식') + ' 휴식', ex.rest);
    }
    keep = true;
  } else if (action === 'add-set' && s) {
    const ex = findEx(s, btn.dataset.sx);
    if (ex) {
      const last = ex.sets[ex.sets.length - 1];
      ex.sets.push(newSet(last ? last.weight : 0, last ? last.reps : 10));
      persist();
    }
    keep = true;
  } else if (action === 'del-set' && s) {
    const ex = findEx(s, btn.dataset.sx);
    if (ex) {
      ex.sets = ex.sets.filter(function (x) { return x.id !== btn.dataset.ss; });
      persist();
    }
    keep = true;
  } else if (action === 'del-sex' && s) {
    if (confirm('오늘 운동에서 이 운동을 삭제할까요?\n(저장된 루틴은 바뀌지 않아요)')) {
      s.exercises = s.exercises.filter(function (x) { return x.id !== btn.dataset.sx; });
      persist();
    }
    keep = true;
  } else if (action === 'add-sex' && s) {
    s.exercises.push({ id: Store.newId(), name: '', rest: 90, note: '', sets: [newSet(0, 10)] });
    persist();
    keep = true;
  } else if (action === 'finish') {
    if (finishSession()) ui.tab = 'home';

  /* --- 루틴 편집 --- */
  } else if (action === 'new-routine') {
    const nr = { id: Store.newId(), name: '새 루틴', exercises: [] };
    data.routines.push(nr);
    persist();
    ui.routineId = nr.id;
  } else if (action === 'open-routine') {
    ui.routineId = btn.dataset.id;
  } else if (action === 'back-routines') {
    ui.routineId = null;
  } else if (action === 'add-exercise' && r) {
    r.exercises.push({ id: Store.newId(), name: '', sets: 3, weight: 0, reps: 10, rest: 90 });
    persist();
    keep = true;
  } else if ((action === 'move-up' || action === 'move-down') && r) {
    const i = r.exercises.findIndex(function (x) { return x.id === btn.dataset.ex; });
    const j = action === 'move-up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < r.exercises.length) {
      const tmp = r.exercises[i];
      r.exercises[i] = r.exercises[j];
      r.exercises[j] = tmp;
      persist();
    }
    keep = true;
  } else if (action === 'del-exercise' && r) {
    r.exercises = r.exercises.filter(function (x) { return x.id !== btn.dataset.ex; });
    persist();
    keep = true;
  } else if (action === 'del-routine' && r) {
    if (confirm('이 루틴을 삭제할까요?')) {
      data.routines = data.routines.filter(function (x) { return x.id !== r.id; });
      persist();
      ui.routineId = null;
    }
  }

  const y = window.scrollY;
  render();
  window.scrollTo(0, keep ? y : 0);
});

/* ---------- 입력칸 값이 바뀔 때 ---------- */

// 오늘 운동 화면: 글자를 칠 때마다 바로 저장한다
main.addEventListener('input', function (e) {
  const t = e.target;
  if (!t.dataset.sf) return;
  const s = data.activeSession;
  if (!s) return;
  const ex = findEx(s, t.dataset.sx);
  if (!ex) return;
  const f = t.dataset.sf;

  if (f === 'name') {
    ex.name = t.value;
  } else if (f === 'note') {
    ex.note = t.value;
  } else if (f === 'rest') {
    let v = parseFloat(t.value);
    if (isNaN(v) || v < 0) v = 0;
    ex.rest = Math.round(v);
  } else {
    const st = findSet(s, t.dataset.sx, t.dataset.ss);
    if (!st) return;
    let v = parseFloat(t.value);
    if (isNaN(v) || v < 0) v = 0;
    if (f === 'reps') v = Math.round(v);
    st[f] = v;
  }
  persist();
});

// 루틴 편집 화면
main.addEventListener('change', function (e) {
  const t = e.target;
  if (t.dataset.sf) return; // 오늘 운동 입력칸은 위에서 처리함
  const r = currentRoutine();
  if (!r) return;

  if (t.id === 'routine-name') {
    r.name = t.value.trim() || '이름 없는 루틴';
    t.value = r.name;
    persist();
    return;
  }

  const exId = t.dataset.ex;
  const field = t.dataset.field;
  if (!exId || !field) return;
  const ex = r.exercises.find(function (x) { return x.id === exId; });
  if (!ex) return;

  if (field === 'name') {
    ex.name = t.value;
  } else {
    let v = parseFloat(t.value);
    if (isNaN(v) || v < 0) v = 0;
    if (field === 'sets' || field === 'reps' || field === 'rest') v = Math.round(v);
    if (field === 'sets' && v < 1) v = 1;
    ex[field] = v;
    t.value = v;
  }
  persist();
});

/* ---------- 시작 ---------- */

setInterval(tickTimer, 250);
window.addEventListener('resize', positionTimerBar);
document.addEventListener('visibilitychange', function () {
  tickTimer();
  updateWakeLock();
});

render();
