// 저장 담당 파일: 데이터를 기기(localStorage)에 읽고 쓴다
const Store = (function () {
  const KEY = 'workoutAppData';

  function empty() {
    return { version: 1, routines: [], sessions: [], activeSession: null };
  }

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const d = JSON.parse(raw);
      if (!Array.isArray(d.routines)) d.routines = [];
      if (!Array.isArray(d.sessions)) d.sessions = [];
      if (d.activeSession === undefined) d.activeSession = null;
      return d;
    } catch (e) {
      console.error(e);
      // 읽기에 실패하면 원본을 따로 보관해 둔다
      try { if (raw) localStorage.setItem(KEY + '_broken', raw); } catch (e2) {}
      return empty();
    }
  }

  function save(d) {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  return { load: load, save: save, newId: newId };
})();
