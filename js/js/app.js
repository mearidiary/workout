// 화면 담당 파일
let data = Store.load();
const ui = { tab: 'home', routineId: null };
const main = document.getElementById('main');
const tabbar = document.getElementById('tabbar');

const TABS = [
  { id: 'home', label: '홈' },
  { id: 'workout', label: '운동' },
  { id: 'routines', label: '루틴' },
  { id: 'history', label: '기록' }
];

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

/* ---------- 화면 그리기 ---------- */

function renderTabbar() {
  tabbar.innerHTML = TABS.map(function (t) {
    return '<button data-tab="' + t.id + '" class="' + (ui.tab === t.id ? 'active' : '') + '">' + t.label + '</button>';
  }).join('');
}

function renderHome() {
  main.innerHTML =
    '<h1>홈</h1>' +
    '<div class="card">저장된 루틴 ' + data.routines.length + '개</div>' +
    '<p class="muted">운동 시작 기능은 다음 단계에서 추가됩니다.</p>';
}

function renderWorkout() {
  main.innerHTML = '<h1>운동</h1><p class="muted">준비 중입니다.</p>';
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
}

/* ---------- 버튼 누를 때 ---------- */

tabbar.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  ui.tab = btn.dataset.tab;
  ui.routineId = null;
  render();
});

main.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const r = currentRoutine();

  if (action === 'new-routine') {
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
  } else if ((action === 'move-up' || action === 'move-down') && r) {
    const i = r.exercises.findIndex(function (x) { return x.id === btn.dataset.ex; });
    const j = action === 'move-up' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < r.exercises.length) {
      const tmp = r.exercises[i];
      r.exercises[i] = r.exercises[j];
      r.exercises[j] = tmp;
      persist();
    }
  } else if (action === 'del-exercise' && r) {
    r.exercises = r.exercises.filter(function (x) { return x.id !== btn.dataset.ex; });
    persist();
  } else if (action === 'del-routine' && r) {
    if (confirm('이 루틴을 삭제할까요?')) {
      data.routines = data.routines.filter(function (x) { return x.id !== r.id; });
      persist();
      ui.routineId = null;
    }
  }
  render();
});

/* ---------- 입력칸 값이 바뀔 때 ---------- */

main.addEventListener('change', function (e) {
  const t = e.target;
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

render();
