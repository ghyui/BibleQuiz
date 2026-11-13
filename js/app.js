// Propagate cache-bust version (from app.js?v=...) to firebase.js import
const __bqVer = new URL(import.meta.url).searchParams.get("v") || "";
const __fbUrl = "./firebase.js" + (__bqVer ? "?v=" + __bqVer : "");
const { fetchUserData, pushUserData, touchUserLogin, fetchAllUsers } = await import(__fbUrl);

(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ---------- Korean helpers ----------
  const CHOSUNG = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
  function isHangulSyllable(code) { return code >= 0xAC00 && code <= 0xD7A3; }
  function toChosung(s) {
    return Array.from(s).map((ch) => {
      const c = ch.charCodeAt(0);
      if (isHangulSyllable(c)) return CHOSUNG[Math.floor((c - 0xAC00) / 588)];
      return ch;
    }).join("");
  }
  function maskAll(s) {
    return Array.from(s).map((ch) => (/\s/.test(ch) ? " " : "○")).join("");
  }
  function maskExceptFirst(s) {
    const arr = Array.from(s);
    return arr.map((ch, i) => (i === 0 ? ch : (/\s/.test(ch) ? " " : "○"))).join("");
  }
  // Level-3 hint: first char as-is, rest as chosung (cumulative reveal over 초성)
  function firstCharPlusChosung(s) {
    const arr = Array.from(s);
    return arr.map((ch, i) => {
      if (i === 0) return ch;
      if (/\s/.test(ch)) return " ";
      const code = ch.charCodeAt(0);
      if (isHangulSyllable(code)) return CHOSUNG[Math.floor((code - 0xAC00) / 588)];
      return ch;
    }).join("");
  }
  function normalize(s) { return (s || "").trim().replace(/\s+/g, " "); }
  function equalAnswer(a, b) { return normalize(a) === normalize(b); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }

  // ---------- 암송 구절 데이터 (js/questions.js 의 window.MEMORY_VERSE) ----------
  // 기록은 일반 문제와 같은 history/attempts/wrong 맵에 "<key>_" 접두어 id로 저장한다.
  const VERSE = window.MEMORY_VERSE || null;
  const VERSE_PREFIX = VERSE ? VERSE.key + "_" : "\u0000";
  function isVerseId(id) { return String(id).startsWith(VERSE_PREFIX); }
  // 빈칸 채우기 단위: 절(또는 긴 절의 한 부분) 하나가 한 문제
  const VERSE_UNITS = [];
  if (VERSE) {
    VERSE.verses.forEach((v) => {
      v.parts.forEach((text, i) => {
        const multi = v.parts.length > 1;
        VERSE_UNITS.push({
          id: VERSE_PREFIX + v.n + (multi ? "abcdefgh"[i] : ""),
          n: v.n,
          partIdx: i,
          partCount: v.parts.length,
          text,
          label: VERSE.refPrefix + v.n + (multi ? ` (${i + 1}/${v.parts.length})` : ""),
        });
      });
    });
  }
  const VERSE_UNIT_IDS = new Set(VERSE_UNITS.map((u) => u.id));
  function verseFullId(n) { return VERSE_PREFIX + "v" + n; }
  function verseFullText(v) { return v.parts.join(" "); }
  // 히스토리/관리자 화면에 보여 줄 암송 항목 (빈칸 채우기 단위 + 절별 전체 쓰기)
  function verseTrackables() {
    if (!VERSE) return [];
    const ref = `${VERSE.title} (${VERSE.version})`;
    const units = VERSE_UNITS.map((u) => ({
      type: "sa", id: u.id, badge: "암송", verse: true,
      q: `${u.label} 빈칸 채우기`, answer: u.text, ref,
    }));
    const fulls = VERSE.verses.map((v) => ({
      type: "sa", id: verseFullId(v.n), badge: "전체 쓰기", verse: true,
      q: `${VERSE.refPrefix}${v.n} 전체 쓰기`, answer: verseFullText(v), ref,
    }));
    return [...units, ...fulls];
  }
  function getTrackables() {
    return [...(window.QUESTIONS || []), ...verseTrackables()];
  }

  // ---------- Storage (Firestore + localStorage cache for UX bits) ----------
  const LS_USER = "bq_currentUser";   // last-logged-in name on THIS browser
  const LS_USERS = "bq_users";        // chip list for THIS browser (UX only)
  const MAX_HISTORY = 10;

  // In-memory cache of current user's data; synced to Firestore
  let currentData = { history: {}, wrong: [] };
  let dataReady = false;
  let savePending = false;
  let saveQueued = false;

  function getCurrentUser() { return localStorage.getItem(LS_USER) || ""; }
  function setCurrentUser(name) {
    localStorage.setItem(LS_USER, name);
    if (name !== ADMIN_NAME) setAdminUnlocked(false);
    const users = getKnownUsers();
    if (!users.includes(name)) {
      users.push(name);
      localStorage.setItem(LS_USERS, JSON.stringify(users));
    }
  }
  function getKnownUsers() {
    try { return JSON.parse(localStorage.getItem(LS_USERS) || "[]"); } catch { return []; }
  }
  function qid(q) {
    if (q.id) return q.id; // 암송 구절처럼 문제 문장이 매번 바뀌는 항목은 고정 id 사용
    let h = 5381;
    const s = q.q;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function effectiveAttempts(history, attempts) {
    history = history || {};
    attempts = attempts || {};
    const out = {};
    const ids = new Set([...Object.keys(history), ...Object.keys(attempts)]);
    ids.forEach((id) => {
      const s = attempts[id];
      if (s && (s.total || 0) > 0) {
        out[id] = s;
      } else {
        const h = history[id] || [];
        out[id] = {
          total: h.length,
          correct: h.filter((r) => r === "O").length,
        };
      }
    });
    return out;
  }

  async function loadCurrentUserData() {
    const name = getCurrentUser();
    if (!name) { currentData = { history: {}, wrong: [] }; dataReady = false; return; }
    dataReady = false;
    try {
      currentData = await fetchUserData(name);
      if (!currentData.attempts) currentData.attempts = {};
      if (!currentData.hints) currentData.hints = {};
      if (!currentData.lastAt) currentData.lastAt = {};
      if (!currentData.wrongAnswers) currentData.wrongAnswers = {};
      // One-time backfill: history exists but attempts missing for that qid
      let backfilled = false;
      for (const [id, hist] of Object.entries(currentData.history || {})) {
        if (!currentData.attempts[id]) {
          currentData.attempts[id] = {
            total: hist.length,
            correct: hist.filter((r) => r === "O").length,
          };
          backfilled = true;
        }
      }
      if (backfilled) persistCurrentUserData(); // fire-and-forget
      dataReady = true;
    } catch (e) {
      console.error("Firestore load failed:", e);
      currentData = { history: {}, wrong: [], attempts: {} };
      dataReady = false;
    }
  }

  async function persistCurrentUserData() {
    const name = getCurrentUser();
    if (!name) return;
    if (savePending) { saveQueued = true; return; }
    savePending = true;
    try {
      await pushUserData(name, currentData);
    } catch (e) {
      console.error("Firestore save failed:", e);
    } finally {
      savePending = false;
      if (saveQueued) { saveQueued = false; persistCurrentUserData(); }
    }
  }

  function recordAnswer(q, correct, userAnswer) {
    if (practiceMode) practiceTotalAttempts++;
    if (q && q.noTrack) return; // 주기도문 등 메타 문제는 사용자 기록에 누적하지 않음
    if (!getCurrentUser()) return;
    const id = qid(q);
    if (!currentData.attempts) currentData.attempts = {};
    if (!currentData.attempts[id]) {
      // Seed from history so existing pre-update activity isn't lost
      const prev = currentData.history?.[id] || [];
      currentData.attempts[id] = {
        total: prev.length,
        correct: prev.filter((r) => r === "O").length,
      };
    }
    currentData.attempts[id].total++;
    if (correct) currentData.attempts[id].correct++;
    if (!currentData.lastAt) currentData.lastAt = {};
    currentData.lastAt[id] = Date.now();
    if (!currentData.history[id]) currentData.history[id] = [];
    currentData.history[id].push(correct ? "O" : "X");
    if (currentData.history[id].length > MAX_HISTORY) {
      currentData.history[id] = currentData.history[id].slice(-MAX_HISTORY);
    }
    // Track wrong answers (what user typed/picked) — keep last 5
    if (!correct && userAnswer != null && String(userAnswer).trim() !== "") {
      if (!currentData.wrongAnswers) currentData.wrongAnswers = {};
      if (!currentData.wrongAnswers[id]) currentData.wrongAnswers[id] = [];
      currentData.wrongAnswers[id].push(String(userAnswer));
      if (currentData.wrongAnswers[id].length > 5) {
        currentData.wrongAnswers[id] = currentData.wrongAnswers[id].slice(-5);
      }
    }
    // Wrong-notebook rules:
    // - Add on any wrong answer (unless the item opts out with noWrongNote)
    // - Remove ONLY when the last N history entries are all "O"
    //   (N = 5 by default, q.wrongClearStreak overrides — 암송 구절은 3)
    const wrongSet = new Set(currentData.wrong);
    const streak = q.wrongClearStreak || 5;
    if (correct) {
      const lastN = currentData.history[id].slice(-streak);
      if (lastN.length >= streak && lastN.every((r) => r === "O")) {
        wrongSet.delete(id);
      }
    } else if (!q.noWrongNote) {
      wrongSet.add(id);
    }
    currentData.wrong = Array.from(wrongSet);
    persistCurrentUserData(); // fire-and-forget
  }
  function getWrongIds() {
    return new Set(currentData.wrong || []);
  }
  function getHistoryFor(q) {
    return currentData.history[qid(q)] || [];
  }
  // 일반 퀴즈 오답노트 개수 (암송 구절은 따로 센다)
  function getWrongCount() {
    return (currentData.wrong || []).filter((id) => !isVerseId(id)).length;
  }
  function getVerseWrongCount() {
    return (currentData.wrong || []).filter((id) => VERSE_UNIT_IDS.has(id)).length;
  }

  // ---------- Element refs ----------
  const els = {
    // user
    userLabel: $("#user-label"),
    userChangeBtn: $("#user-change-btn"),
    userModal: $("#user-modal"),
    userNameInput: $("#user-name-input"),
    userNameSubmit: $("#user-name-submit"),
    userList: $("#user-list"),
    userListLabel: $("#user-list-label"),
    // quiz
    startCard: $("#quiz-start"),
    playCard: $("#quiz-play"),
    resultCard: $("#quiz-result"),
    startBtn: $("#start-btn"),
    prevBtn: $("#prev-btn"),
    nextBtn: $("#next-btn"),
    restartBtn: $("#restart-btn"),
    resultReport: $("#result-report"),
    quizCount: $("#quiz-count"),
    quizType: $("#quiz-type"),
    quizMode: $("#quiz-mode"),
    qIndex: $("#q-index"),
    qTotal: $("#q-total"),
    qTypeBadge: $("#q-type-badge"),
    qHistory: $("#q-history"),
    qLabel: $("#q-label"),
    resultNote: $("#result-note"),
    resultVerseBtn: $("#result-verse-btn"),
    qText: $("#q-text"),
    qSaQuestion: $("#q-sa-question"),
    qOptions: $("#q-options"),
    qSa: $("#q-sa"),
    submitBtn: $("#submit-btn"),
    hintBtn: $("#hint-btn"),
    hintLabel: $("#hint-level"),
    qHint: $("#q-hint"),
    qFeedback: $("#q-feedback"),
    score: $("#score"),
    scoreTotal: $("#score-total"),
  };

  // ---------- User UI ----------
  function showUserModal(prefill) {
    els.userModal.classList.remove("hidden");
    els.userNameInput.value = prefill || getCurrentUser() || "";
    renderUserList();
    setTimeout(() => els.userNameInput.focus(), 0);
  }
  function hideUserModal() { els.userModal.classList.add("hidden"); }
  function renderUserList() {
    const users = getKnownUsers();
    const current = getCurrentUser();
    if (users.length === 0) {
      els.userListLabel.classList.add("hidden");
      els.userList.innerHTML = "";
      return;
    }
    els.userListLabel.classList.remove("hidden");
    els.userList.innerHTML = "";
    users.forEach((u) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "user-chip" + (u === current ? " is-current" : "");
      chip.textContent = u;
      chip.addEventListener("click", () => {
        els.userNameInput.value = u;
        submitUserName();
      });
      els.userList.appendChild(chip);
    });
  }
  async function submitUserName() {
    const name = els.userNameInput.value.trim();
    if (!name) { els.userNameInput.focus(); return; }
    setCurrentUser(name);
    hideUserModal();
    updateUserUI(true);
    await loadCurrentUserData();
    touchUserLogin(name).catch((e) => console.error("touchUserLogin failed:", e));
    updateUserUI(false);
  }
  const ADMIN_NAME = "전병혁";
  const ADMIN_PW_HASH = "54dad573aa8e8a5576ab37d9d72126181b74e4f4c5d925b78a26a74567a62faa"; // SHA-256
  const ADMIN_UNLOCK_KEY = "bq_adminUnlocked";
  function isAdmin() { return getCurrentUser() === ADMIN_NAME; }
  function adminUnlocked() { return sessionStorage.getItem(ADMIN_UNLOCK_KEY) === "1"; }
  function setAdminUnlocked(v) {
    if (v) sessionStorage.setItem(ADMIN_UNLOCK_KEY, "1");
    else sessionStorage.removeItem(ADMIN_UNLOCK_KEY);
  }
  async function sha256Hex(s) {
    const buf = new TextEncoder().encode(s);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function updateUserUI(loading) {
    const name = getCurrentUser();
    if (name) {
      els.userLabel.textContent = loading ? `사용자: ${name} (불러오는 중…)` : `사용자: ${name}`;
      els.userLabel.classList.remove("hidden");
      els.userChangeBtn.classList.remove("hidden");
    } else {
      els.userLabel.classList.add("hidden");
      els.userChangeBtn.classList.add("hidden");
    }
    // Toggle admin tab visibility
    $$(".admin-only").forEach((el) => {
      el.classList.toggle("hidden", !isAdmin());
    });
    updateModeLabel();
  }
  function updateModeLabel() {
    const label = $("#wrong-count-label");
    if (label) label.textContent = `(${getWrongCount()})`;
    const verseLabel = $("#verse-wrong-count-label");
    if (verseLabel) verseLabel.textContent = `(${getVerseWrongCount()})`;
  }
  els.userNameSubmit.addEventListener("click", submitUserName);
  els.userNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitUserName(); }
  });
  els.userChangeBtn.addEventListener("click", () => showUserModal());

  // ---------- Tabs (overridden later by admin-gated handler) ----------

  // ---------- Quiz state ----------
  let pool = [];
  let idx = 0;
  let answered = false;
  let hintLevel = 0;
  let attempts = 0; // 0 = no submit yet, 1 = first wrong (retry chance), 2 = final
  const MAX_ATTEMPTS = 2;
  const stateByIdx = new Map(); // per-question saved state for back/forward nav
  let practiceMode = false;
  let examMode = false;
  let practiceTarget = 0;   // initial question count
  let practiceTotalAttempts = 0;
  let verseMode = null;     // null | "practice" | "exam" | "wrong" | "full" (암송 구절 모드)

  const BLANK_RE = /\(\s+\)/g;
  function splitExpected(answer) {
    return String(answer).split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  }
  function visibleLen(s) {
    return Array.from(String(s)).filter((c) => !/\s/.test(c)).length;
  }
  function makeBlankInput(idx, expectedPart) {
    const wrap = document.createElement("span");
    wrap.className = "blank-wrap";
    const badge = document.createElement("span");
    badge.className = "blank-hint hidden";
    wrap.appendChild(badge);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "blank-input";
    input.dataset.idx = String(idx);
    input.autocomplete = "off";
    input.spellcheck = false;
    if (expectedPart) {
      const n = Math.max(visibleLen(expectedPart), 2);
      input.style.width = (n * 1.15 + 0.8) + "em";
      input.dataset.expectedLen = String(visibleLen(expectedPart));
    } else {
      input.style.width = "6em";
    }
    wrap.appendChild(input);
    return wrap;
  }
  function renderSAWithBlanks(qText, qAnswer, container) {
    container.innerHTML = "";
    const expected = splitExpected(qAnswer);
    const matches = [...qText.matchAll(BLANK_RE)];
    if (matches.length === 0) {
      container.appendChild(document.createTextNode(qText + " "));
      container.appendChild(makeBlankInput(0, qAnswer));
      return 1;
    }
    let lastIdx = 0;
    matches.forEach((m, i) => {
      const before = qText.slice(lastIdx, m.index);
      if (before) container.appendChild(document.createTextNode(before));
      const ep = expected.length === matches.length ? expected[i] : null;
      container.appendChild(makeBlankInput(i, ep));
      lastIdx = m.index + m[0].length;
    });
    const after = qText.slice(lastIdx);
    if (after) container.appendChild(document.createTextNode(after));
    return matches.length;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function getAllQuestions() {
    return (window.QUESTIONS || []).map((q) => ({ type: q.type || "mc", ...q }));
  }

  const PRESETS = {
    practice:    { count: 0,  mode: "practice",    type: "all" },
    exam:        { count: 10, mode: "exam",        type: "all" },
    wrong:       { count: 0,  mode: "wrong",       type: "all" },
    lordsprayer: { count: 0,  mode: "lordsprayer", type: "all" },
  };

  // 주기도문 (마태복음 6:9-13, 개역개정) — 송영(영광송) 포함
  const LORDS_PRAYER = "하늘에 계신 우리 아버지여 이름이 거룩히 여김을 받으시오며 나라가 임하시오며 뜻이 하늘에서 이루어진 것 같이 땅에서도 이루어지이다 오늘 우리에게 일용할 양식을 주시옵고 우리가 우리에게 죄 지은 자를 사하여 준 것 같이 우리 죄를 사하여 주시옵고 우리를 시험에 들게 하지 마시옵고 다만 악에서 구하시옵소서 나라와 권세와 영광이 아버지께 영원히 있사옵나이다 아멘";

  function makeLordsPrayerQuestion(blanks = 10) {
    const words = LORDS_PRAYER.split(" ");
    const n = Math.min(blanks, words.length);
    const picked = new Set();
    while (picked.size < n) picked.add(Math.floor(Math.random() * words.length));
    const sorted = Array.from(picked).sort((a, b) => a - b);
    const answers = sorted.map((i) => words[i]);
    const blanked = words.map((w, i) => (picked.has(i) ? "(   )" : w));
    return {
      type: "sa",
      q: blanked.join(" "),
      answer: answers.join(" / "),
      ref: "주기도문 · 마태복음 6:9-13 (개역개정)",
      noTrack: true,
      partialScoring: true,
    };
  }
  function startQuiz(presetName) {
    const preset = PRESETS[presetName] || PRESETS.quick10;
    const count = preset.count;
    const typeFilter = preset.type;
    const mode = preset.mode;
    let all = getAllQuestions();
    if (mode === "wrong") {
      const wrongIds = getWrongIds();
      all = all.filter((q) => wrongIds.has(qid(q)));
      if (all.length === 0) {
        alert("오답노트가 비어 있습니다. 문제를 풀어 틀린 문제가 모이면 여기서 다시 풀 수 있어요.");
        return;
      }
    }
    if (typeFilter !== "all") all = all.filter((q) => q.type === typeFilter);
    all = shuffle(all);

    verseMode = null;
    practiceMode = (mode === "practice");
    examMode = (mode === "exam");
    if (mode === "lordsprayer") {
      pool = [makeLordsPrayerQuestion(10)];
    } else if (practiceMode) {
      pool = all;
      practiceTarget = pool.length;
      practiceTotalAttempts = 0;
    } else {
      pool = count > 0 ? all.slice(0, count) : all;
    }
    if (pool.length === 0) {
      alert("선택한 조건의 문제가 없습니다.");
      return;
    }
    idx = 0;
    stateByIdx.clear();
    els.startCard.classList.add("hidden");
    els.resultCard.classList.add("hidden");
    els.playCard.classList.remove("hidden");
    renderQuestion();
  }

  function captureCurrentState() {
    const q = pool[idx];
    const prev = stateByIdx.get(idx) || {};
    const s = {
      // Preserve result-related fields written by setResult / setUserAnswerStr / submitSA
      ...(prev.correct !== undefined ? { correct: prev.correct } : {}),
      ...(prev.partialScore ? { partialScore: prev.partialScore } : {}),
      ...(prev.userAnswerStr != null ? { userAnswerStr: prev.userAnswerStr } : {}),
      type: q.type,
      answered,
      attempts,
      hintLevel,
      feedbackText: els.qFeedback.textContent,
      feedbackClass: els.qFeedback.className,
      hintHTML: els.qHint.innerHTML,
      hintLabel: els.hintLabel.textContent,
      submitText: els.submitBtn.textContent,
      submitDisabled: els.submitBtn.disabled,
      hintDisabled: els.hintBtn.disabled,
      nextDisabled: els.nextBtn.disabled,
    };
    if (q.type === "sa") {
      const inputs = Array.from(els.qSaQuestion.querySelectorAll(".blank-input"));
      s.saInputs = inputs.map((inp) => ({
        value: inp.value,
        disabled: inp.disabled,
        classList: inp.className,
        title: inp.title || "",
      }));
    } else {
      const items = Array.from(els.qOptions.children);
      s.mcOptions = items.map((li) => ({ classList: li.className }));
    }
    stateByIdx.set(idx, s);
  }

  function restoreQuestionState(s) {
    answered = !!s.answered;
    attempts = s.attempts || 0;
    hintLevel = s.hintLevel || 0;
    els.qFeedback.textContent = s.feedbackText || "";
    els.qFeedback.className = s.feedbackClass || "feedback";
    els.qHint.innerHTML = s.hintHTML || "";
    els.hintLabel.textContent = s.hintLabel || "(0/3)";
    els.submitBtn.textContent = s.submitText || "제출";
    els.submitBtn.disabled = !!s.submitDisabled;
    els.hintBtn.disabled = !!s.hintDisabled;
    els.nextBtn.disabled = !!s.nextDisabled;
    if (s.type === "sa" && s.saInputs) {
      const inputs = Array.from(els.qSaQuestion.querySelectorAll(".blank-input"));
      s.saInputs.forEach((saved, i) => {
        const inp = inputs[i]; if (!inp) return;
        inp.value = saved.value || "";
        inp.disabled = !!saved.disabled;
        inp.className = saved.classList || "blank-input";
        inp.title = saved.title || "";
      });
      // Restore per-blank hint chips if hint level > 0
      if ((s.hintLevel || 0) > 0) {
        const q = pool[idx];
        const expected = splitExpected(q.answer);
        if (expected.length === inputs.length) {
          inputs.forEach((inp, i) => {
            const badge = inp.parentElement?.querySelector(".blank-hint");
            if (!badge) return;
            badge.textContent = hintFor(expected[i], s.hintLevel);
            badge.classList.remove("hidden");
          });
        }
      }
      // If question was finalized, restore reveal chips for wrong blanks
      if (s.answered) {
        const q = pool[idx];
        const expected = splitExpected(q.answer);
        if (expected.length === inputs.length) {
          inputs.forEach((inp, i) => {
            if (!inp.classList.contains("wrong")) return;
            const wrap = inp.parentElement;
            if (!wrap || wrap.querySelector(".blank-reveal")) return;
            const reveal = document.createElement("span");
            reveal.className = "blank-reveal";
            reveal.textContent = expected[i] || "";
            wrap.appendChild(reveal);
          });
        }
      }
    } else if (s.type === "mc" && s.mcOptions) {
      const items = Array.from(els.qOptions.children);
      s.mcOptions.forEach((saved, i) => {
        const li = items[i]; if (!li) return;
        li.className = saved.classList || "";
      });
    }
  }

  function setResult(correct) {
    const s = stateByIdx.get(idx) || {};
    s.correct = correct;
    stateByIdx.set(idx, s);
  }
  function setUserAnswerStr(text) {
    const s = stateByIdx.get(idx) || {};
    s.userAnswerStr = text;
    stateByIdx.set(idx, s);
  }
  function calcScore() {
    let n = 0;
    stateByIdx.forEach((s) => {
      if (s.partialScore) n += s.partialScore.correct || 0;
      else if (s.correct === true) n++;
    });
    return n;
  }
  function calcMaxScore() {
    let n = 0;
    pool.forEach((q, i) => {
      const s = stateByIdx.get(i);
      if (s && s.partialScore) n += s.partialScore.total || 1;
      else n += 1;
    });
    return n;
  }

  function renderHistory(q) {
    const hist = getHistoryFor(q);
    els.qHistory.innerHTML = "";
    if (hist.length === 0) {
      const muted = document.createElement("span");
      muted.className = "muted-text small";
      muted.textContent = "최근 기록 없음";
      els.qHistory.appendChild(muted);
      return;
    }
    const label = document.createElement("span");
    label.className = "history-label";
    label.textContent = "최근: ";
    els.qHistory.appendChild(label);
    hist.forEach((r) => {
      const pip = document.createElement("span");
      pip.className = `pip pip-${r === "O" ? "o" : "x"}`;
      pip.textContent = r;
      els.qHistory.appendChild(pip);
    });
  }

  function renderQuestion() {
    answered = false;
    hintLevel = 0;
    attempts = 0;
    els.nextBtn.disabled = true;
    els.qFeedback.textContent = "";
    els.qFeedback.className = "feedback";
    els.qHint.innerHTML = "";
    els.hintLabel.textContent = "(0/3)";
    els.submitBtn.textContent = "제출";

    const q = pool[idx];
    if (practiceMode) {
      const done = practiceTarget - pool.length;
      els.qIndex.textContent = `남은 ${pool.length}`;
      els.qTotal.textContent = `${practiceTarget} (완료 ${done})`;
    } else {
      els.qIndex.textContent = String(idx + 1);
      els.qTotal.textContent = String(pool.length);
    }
    renderHistory(q);
    els.qLabel.textContent = q.label || "";
    els.qLabel.classList.toggle("hidden", !q.label);
    // 한 번에 채점하는 실전(암송)에서는 마지막 문제의 버튼이 채점 버튼이 된다
    els.nextBtn.textContent = (q.deferGrade && idx === pool.length - 1) ? "채점하기" : "다음";

    if (q.type === "sa") {
      els.qTypeBadge.textContent = q.badge || "주관식";
      els.qTypeBadge.className = "type-badge " + (q.verse ? "verse" : "sa");
      els.qText.classList.add("hidden");
      els.qOptions.classList.add("hidden");
      els.qSaQuestion.classList.remove("hidden");
      els.qSa.classList.remove("hidden");
      renderSAWithBlanks(q.q, q.answer, els.qSaQuestion);
      els.submitBtn.disabled = false;
      els.hintBtn.disabled = false;
      els.submitBtn.classList.toggle("hidden", !!q.deferGrade);
      els.hintBtn.classList.toggle("hidden", examMode || !!q.deferGrade);
      els.qSaQuestion.querySelectorAll(".blank-input").forEach((inp) => {
        if (q.instantCheck) {
          // 연습: 빈칸을 벗어나면(change) 그 빈칸만 바로 채점
          inp.addEventListener("change", () => instantCheckBlank(inp, false));
          inp.addEventListener("input", () => inp.classList.remove("wrong"));
        }
        inp.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (q.instantCheck) {
            // 한글 조합이 끝난 뒤 값을 읽도록 한 틱 미룬다
            setTimeout(() => instantCheckBlank(inp, true), 0);
            return;
          }
          if (q.deferGrade) {
            const all = Array.from(els.qSaQuestion.querySelectorAll(".blank-input"));
            const nextEmpty = all.find((i2) => i2 !== inp && i2.value.trim() === "");
            if (nextEmpty) nextEmpty.focus();
            else els.nextBtn.focus();
            return;
          }
          if (answered) { submitSA(); return; }
          const editable = Array.from(els.qSaQuestion.querySelectorAll(".blank-input:not([disabled])"));
          const empty = editable.find((i2) => i2.value.trim() === "");
          if (empty) {
            empty.focus();
            try { empty.setSelectionRange(empty.value.length, empty.value.length); } catch {}
          } else {
            submitSA();
          }
        });
      });
    } else {
      els.qTypeBadge.textContent = "객관식";
      els.qTypeBadge.className = "type-badge mc";
      els.qSa.classList.add("hidden");
      els.qSaQuestion.classList.add("hidden");
      els.qText.classList.remove("hidden");
      els.qText.textContent = q.q;
      els.qOptions.classList.remove("hidden");
      els.qOptions.innerHTML = "";
      (q.options || []).forEach((opt, i) => {
        const li = document.createElement("li");
        li.textContent = opt;
        li.addEventListener("click", () => selectMC(li, i, q.answer));
        els.qOptions.appendChild(li);
      });
    }

    // Restore previously visited state (back/forward nav)
    const saved = stateByIdx.get(idx);
    if (saved) restoreQuestionState(saved);
    if (q.deferGrade) els.nextBtn.disabled = false; // 채점 전에는 자유롭게 이동

    // Focus appropriately
    if (q.type === "sa" && !answered) {
      const firstEditable = els.qSaQuestion.querySelector(".blank-input:not([disabled])");
      firstEditable?.focus();
    }

    // Nav buttons
    els.prevBtn.disabled = practiceMode || idx === 0;
  }

  function selectMC(li, chosen, correct) {
    if (answered) return;
    if (li.classList.contains("disabled")) return;
    const items = els.qOptions.children;
    const q = pool[idx];

    if (chosen === correct) {
      answered = true;
      li.classList.add("correct");
      for (const item of items) item.classList.add("disabled");
      markCorrect(attempts === 0 ? "정답!" : "정답! (재시도 성공)");
      setUserAnswerStr(li.textContent || "");
      recordAnswer(q, true);
      updateModeLabel();
      return;
    }

    // wrong pick
    attempts++;
    li.classList.add("wrong", "disabled");
    const maxAttemptsMC = examMode ? 1 : MAX_ATTEMPTS;
    if (attempts < maxAttemptsMC) {
      markRetry("오답 — 한 번 더 골라보세요!");
    } else {
      answered = true;
      if (items[correct]) items[correct].classList.add("correct");
      for (const item of items) item.classList.add("disabled");
      markWrong(`오답 (정답: ${items[correct]?.textContent ?? ""})`);
      const wrongPicked = li.textContent || "";
      setUserAnswerStr(wrongPicked);
      recordAnswer(q, false, wrongPicked);
      updateModeLabel();
    }
  }

  function submitSA() {
    if (answered) return;
    const q = pool[idx];
    if (q.deferGrade) return;                     // 실전(암송)은 마지막에 한 번에 채점
    if (q.instantCheck) { submitInstant(); return; }
    const inputs = Array.from(els.qSaQuestion.querySelectorAll(".blank-input"));
    if (inputs.length === 0) return;
    const userValues = inputs.map((inp) => inp.value);
    if (userValues.every((v) => !v.trim())) {
      inputs[0].focus();
      return;
    }

    const expected = splitExpected(q.answer);
    const perBlank = (expected.length === inputs.length);
    const blankResults = inputs.map((inp, i) => {
      const exp = perBlank ? expected[i] : null;
      const ok = perBlank ? equalAnswer(userValues[i], exp) : false;
      return { input: inp, user: userValues[i], expected: exp, ok };
    });

    let allCorrect;
    if (perBlank) {
      allCorrect = blankResults.every((r) => r.ok);
    } else {
      const userJoined = userValues.map((v) => v.trim()).filter(Boolean).join(" / ");
      allCorrect = equalAnswer(userJoined, q.answer);
    }

    // Apply per-blank visuals
    inputs.forEach((inp) => inp.classList.remove("correct", "wrong"));
    if (perBlank) {
      blankResults.forEach((r) => {
        r.input.classList.add(r.ok ? "correct" : "wrong");
        if (r.ok) r.input.disabled = true;
      });
    } else {
      inputs.forEach((inp) => inp.classList.add(allCorrect ? "correct" : "wrong"));
    }

    // Partial-scoring mode (e.g. 주기도문): single submission, per-blank scoring
    if (q.partialScoring && perBlank) {
      const correctCount = blankResults.filter((r) => r.ok).length;
      const total = blankResults.length;
      answered = true;
      inputs.forEach((inp) => (inp.disabled = true));
      els.submitBtn.disabled = true;
      els.hintBtn.disabled = true;
      blankResults.forEach((r) => {
        r.input.classList.remove("correct", "wrong");
        r.input.classList.add(r.ok ? "correct" : "wrong");
      });
      revealWrongBlanks(blankResults);
      showCharDiffs(blankResults);
      const partialMsg = correctCount === total
        ? "완벽! 모두 정답!"
        : `${correctCount} / ${total} 정답`;
      if (correctCount === total) markCorrect(partialMsg);
      else markWrong(partialMsg);
      const st = stateByIdx.get(idx) || {};
      st.partialScore = { correct: correctCount, total };
      stateByIdx.set(idx, st);
      setUserAnswerStr(userValues.map((v) => v.trim()).join(" / "));
      recordAnswer(q, correctCount === total, userValues.map((v) => v.trim()).join(" / "));
      updateModeLabel();
      return;
    }

    if (allCorrect) {
      answered = true;
      inputs.forEach((inp) => (inp.disabled = true));
      els.submitBtn.disabled = true;
      els.hintBtn.disabled = true;
      markCorrect(attempts === 0 ? "정답!" : "정답! (재시도 성공)");
      els.qHint.innerHTML = "";
      setUserAnswerStr(userValues.map((v) => v.trim()).join(" / "));
      recordAnswer(q, true);
      updateModeLabel();
      return;
    }

    // wrong
    attempts++;
    showCharDiffs(blankResults);

    const maxAttemptsSA = examMode ? 1 : MAX_ATTEMPTS;
    if (attempts < maxAttemptsSA) {
      markRetry("오답 — 한 번 더 시도해 보세요!");
      els.submitBtn.textContent = "재시도";
      const firstWrong = blankResults.find((r) => !r.ok);
      if (firstWrong) { firstWrong.input.focus(); firstWrong.input.select(); }
    } else {
      answered = true;
      inputs.forEach((inp) => (inp.disabled = true));
      els.submitBtn.disabled = true;
      els.hintBtn.disabled = true;
      markWrong(`오답 (정답: ${q.answer})`);
      revealWrongBlanks(blankResults);
      const userAnswerStr = userValues.map((v) => v.trim()).join(" / ");
      setUserAnswerStr(userAnswerStr);
      recordAnswer(q, false, userAnswerStr);
      updateModeLabel();
    }
  }

  function revealWrongBlanks(blankResults) {
    blankResults.forEach((r) => {
      if (r.ok) return;
      const wrap = r.input.parentElement;
      if (!wrap || wrap.querySelector(".blank-reveal")) return;
      const reveal = document.createElement("span");
      reveal.className = "blank-reveal";
      reveal.textContent = r.expected || "";
      wrap.appendChild(reveal);
      r.input.title = `정답: ${r.expected || ""}`;
    });
  }

  function showCharDiffs(blankResults) {
    els.qHint.innerHTML = "";
    blankResults.forEach((r, i) => {
      if (r.ok) return;
      const row = document.createElement("div");
      row.className = "retry-hint-row";
      const label = document.createElement("span");
      label.className = "muted-text small";
      label.textContent = blankResults.length > 1 ? `${i + 1}번 빈칸 — ` : "내가 쓴 답 — ";
      row.appendChild(label);
      const diff = renderCharDiff(r.user, r.expected || "");
      row.appendChild(diff);
      els.qHint.appendChild(row);
    });
  }
  function renderCharDiff(userText, correctText) {
    const wrap = document.createElement("span");
    wrap.className = "char-diff";
    const userChars = Array.from(userText);
    const correctChars = Array.from(correctText);
    if (userChars.length === 0) {
      const s = document.createElement("span");
      s.className = "muted-text";
      s.textContent = "(빈칸)";
      wrap.appendChild(s);
      return wrap;
    }
    userChars.forEach((ch, i) => {
      const s = document.createElement("span");
      s.textContent = ch;
      s.className = (ch === correctChars[i]) ? "char-ok" : "char-bad";
      wrap.appendChild(s);
    });
    return wrap;
  }

  function markCorrect(msg) {
    els.qFeedback.textContent = msg;
    els.qFeedback.className = "feedback correct";
    els.nextBtn.disabled = false;
    setResult(true);
    focusNextBtnSoon();
  }
  function markWrong(msg) {
    els.qFeedback.textContent = msg;
    els.qFeedback.className = "feedback wrong";
    els.nextBtn.disabled = false;
    setResult(false);
    focusNextBtnSoon();
  }
  function focusNextBtnSoon() {
    setTimeout(() => { try { els.nextBtn.focus(); } catch {} }, 0);
  }
  function markRetry(msg) {
    els.qFeedback.textContent = msg;
    els.qFeedback.className = "feedback retry";
    els.nextBtn.disabled = true; // can't proceed until retry resolves
  }

  function hintFor(answerPart, level) {
    if (level === 1) return maskAll(answerPart);
    if (level === 2) return toChosung(answerPart);
    if (level === 3) return firstCharPlusChosung(answerPart);
    return "";
  }
  // Record hint usage per question (max level reached, total clicks)
  function recordHintUse(id, level) {
    if (!getCurrentUser()) return;
    if (!currentData.hints) currentData.hints = {};
    if (!currentData.hints[id]) currentData.hints[id] = { maxLevel: 0, clicks: 0 };
    currentData.hints[id].clicks++;
    if (level > currentData.hints[id].maxLevel) {
      currentData.hints[id].maxLevel = level;
    }
    persistCurrentUserData();
  }
  function showHint() {
    if (answered) return;
    const q = pool[idx];
    if (q.type !== "sa") return;
    if (hintLevel >= 3) return;
    hintLevel++;
    recordHintUse(qid(q), hintLevel);
    const labels = { 1: "글자수", 2: "초성", 3: "첫 글자" };
    els.hintLabel.textContent = `(${hintLevel}/3 · ${labels[hintLevel]})`;

    const inputs = Array.from(els.qSaQuestion.querySelectorAll(".blank-input"));
    const expected = splitExpected(q.answer);

    if (expected.length === inputs.length) {
      // Place per-blank hint chip ABOVE each input (replaces previous level chip)
      inputs.forEach((inp, i) => {
        const badge = inp.parentElement?.querySelector(".blank-hint");
        if (!badge) return;
        if (q.instantCheck) { updateBlankHint(inp, expected[i]); return; }
        badge.textContent = hintFor(expected[i], hintLevel);
        badge.classList.remove("hidden");
      });
      els.qHint.innerHTML = "";
      if (q.instantCheck) renderHintLegend();
    } else {
      // Count mismatch fallback — show single hint in the bottom area
      els.qHint.innerHTML = "";
      const row = document.createElement("div");
      row.className = "hint-row-line";
      const head = document.createElement("span");
      head.className = "hint-head";
      head.textContent = `힌트(${labels[hintLevel]}): `;
      row.appendChild(head);
      const tag = document.createElement("span");
      tag.className = "hint-tag";
      tag.textContent = hintFor(q.answer, hintLevel);
      row.appendChild(tag);
      els.qHint.appendChild(row);
    }
    if (hintLevel === 3) els.hintBtn.disabled = true;
  }

  function prevQuestion() {
    if (practiceMode) return;
    if (idx === 0) return;
    captureCurrentState();
    idx--;
    renderQuestion();
  }
  function nextQuestion() {
    if (practiceMode) { nextPractice(); return; }
    captureCurrentState();
    if (idx + 1 >= pool.length) {
      if (pool[idx].deferGrade && !gradeDeferredExam()) return; // 채점 취소 → 계속 풀기
      showResult();
    } else { idx++; renderQuestion(); }
  }
  function nextPractice() {
    const wasCorrect = stateByIdx.get(idx)?.correct === true;
    if (wasCorrect) {
      // remove this question from the practice pool
      pool.splice(idx, 1);
    } else {
      // keep in pool but move to end so it doesn't immediately reappear
      const cur = pool.splice(idx, 1)[0];
      // 암송 구절은 다시 나올 때 빈칸 위치를 새로 뽑는다
      pool.push(cur.unit ? makeVerseQuestion(cur.unit, verseLevel, { instantCheck: true }) : cur);
    }
    if (pool.length === 0) {
      showResult();
      return;
    }
    if (!verseMode) pool = shuffle(pool); // 암송은 말씀 순서를 유지
    idx = 0;
    stateByIdx.clear();
    renderQuestion();
  }
  function showResult() {
    els.playCard.classList.add("hidden");
    els.resultCard.classList.remove("hidden");
    els.resultNote.classList.add("hidden");
    els.resultNote.textContent = "";
    if (practiceMode) {
      els.score.textContent = String(practiceTarget);
      els.scoreTotal.textContent = `${practiceTarget} · 총 시도 ${practiceTotalAttempts}회`;
      els.resultReport.classList.add("hidden");
      els.resultReport.innerHTML = "";
    } else {
      els.score.textContent = String(calcScore());
      els.scoreTotal.textContent = String(calcMaxScore());
      if (verseMode === "exam") renderVerseExamReport();
      else if (examMode) renderExamReport();
      else { els.resultReport.classList.add("hidden"); els.resultReport.innerHTML = ""; }
    }
    updateModeLabel();
    updateResultVerseBtn();
  }
  // 암송 모드가 끝나면 다음 단계(오답노트 → 전체 쓰기)로 바로 갈 수 있는 버튼을 보여 준다
  function updateResultVerseBtn() {
    const btn = els.resultVerseBtn;
    if (!verseMode) { btn.classList.add("hidden"); return; }
    const wrongCount = getVerseWrongCount();
    btn.dataset.verseMode = wrongCount > 0 ? "wrong" : "full";
    btn.textContent = wrongCount > 0 ? `암송 오답노트 풀기 (${wrongCount})` : "전체 쓰기 도전";
    btn.classList.remove("hidden");
  }

  function renderExamReport() {
    els.resultReport.classList.remove("hidden");
    const cards = pool.map((q, i) => {
      const s = stateByIdx.get(i) || {};
      const correct = s.correct === true;
      const userStr = (s.userAnswerStr && s.userAnswerStr.trim()) || "(미응답)";
      const correctAns = q.type === "mc" ? (q.options?.[q.answer] ?? "") : String(q.answer);
      const resultIcon = correct
        ? '<span class="pip pip-o">O</span>'
        : '<span class="pip pip-x">X</span>';
      const userChip = correct
        ? `<span class="user-ans-correct">${escapeHtml(userStr)}</span>`
        : `<span class="user-ans-wrong">${escapeHtml(userStr)}</span>`;
      const wrongHint = !correct
        ? ` · <span class="muted-text">정답:</span> <b>${escapeHtml(correctAns)}</b>`
        : "";
      const stats = `<div class="q-stats-main">${resultIcon} 내 답: ${userChip}${wrongHint}</div>`;
      return questionCardHtml(q, stats);
    });
    els.resultReport.innerHTML = `<h3 class="report-title">상세 리포트</h3>${cards.join("")}`;
  }
  // 퀴즈 도중 나가기: 이미 채점된 문제의 기록은 남고, 풀던 문제는 버린다
  function quitQuiz() {
    const q = pool[idx];
    const msg = q && q.deferGrade
      ? "지금 나가면 채점하지 않은 답은 사라져요. 그래도 나갈까요?"
      : "퀴즈를 그만하고 처음 화면으로 나갈까요?";
    if (!confirm(msg)) return;
    els.playCard.classList.add("hidden");
    restart();
  }
  function restart() {
    verseMode = null;
    els.resultCard.classList.add("hidden");
    vfEls.card.classList.add("hidden");
    els.startCard.classList.remove("hidden");
    updateModeLabel();
  }

  // ---------- 암송 구절 (시편 23편): 빈칸 채우기 연습/실전/오답노트 + 전체 쓰기 ----------
  const LS_VERSE_LEVEL = "bq_verseLevel";
  const VERSE_LEVELS = {
    easy:   { label: "쉬움",   ratio: 0.3,  desc: "빈칸 조금 — 단어 10개 중 3개쯤" },
    normal: { label: "보통",   ratio: 0.55, desc: "절반 정도가 빈칸" },
    hard:   { label: "어려움", ratio: 0.85, desc: "거의 모든 단어가 빈칸" },
  };
  let verseLevel = localStorage.getItem(LS_VERSE_LEVEL);
  if (!VERSE_LEVELS[verseLevel]) verseLevel = "easy";

  function verseBlankCount(wordCount, level) {
    const k = Math.round(wordCount * VERSE_LEVELS[level].ratio);
    return Math.max(1, Math.min(wordCount, k));
  }
  // 한 단위(절/부분)에서 난이도만큼 단어를 무작위로 비워 주관식 문제를 만든다
  function makeVerseQuestion(unit, level, opts = {}) {
    const words = unit.text.split(" ");
    const picked = new Set(shuffle(words.map((_, i) => i)).slice(0, verseBlankCount(words.length, level)));
    const body = words.map((w, i) => (picked.has(i) ? "(   )" : w)).join(" ");
    const lead = unit.partIdx > 0 ? "… " : "";
    const tail = unit.partIdx < unit.partCount - 1 ? " …" : "";
    return {
      type: "sa",
      id: unit.id,
      unit,
      verse: true,
      badge: `암송 · ${VERSE_LEVELS[level].label}`,
      label: unit.label,
      q: lead + body + tail,
      answer: words.filter((_, i) => picked.has(i)).join(" / "),
      ref: `${VERSE.title} (${VERSE.version})`,
      wrongClearStreak: 3,
      ...opts,
    };
  }

  function startVerse(mode) {
    if (!VERSE) return;
    if (mode === "full") { startVerseFull(); return; }
    let units = VERSE_UNITS;
    if (mode === "wrong") {
      const wrongIds = getWrongIds();
      units = units.filter((u) => wrongIds.has(u.id));
      if (units.length === 0) {
        alert("암송 오답노트가 비어 있어요. 연습이나 실전에서 틀린 구절이 여기에 모여요.");
        return;
      }
    }
    verseMode = mode;
    examMode = false;
    practiceMode = (mode !== "exam"); // 연습·오답노트: 모두 맞출 때까지 반복
    const opts = mode === "exam" ? { deferGrade: true } : { instantCheck: true };
    pool = units.map((u) => makeVerseQuestion(u, verseLevel, opts));
    practiceTarget = pool.length;
    practiceTotalAttempts = 0;
    idx = 0;
    stateByIdx.clear();
    els.startCard.classList.add("hidden");
    els.resultCard.classList.add("hidden");
    vfEls.card.classList.add("hidden");
    els.playCard.classList.remove("hidden");
    renderQuestion();
  }

  // --- 연습/오답노트: 빈칸 하나를 쓰자마자 채점, 틀리면 그 칸에 힌트가 자동으로 붙는다 ---
  function setFeedback(msg, cls) {
    els.qFeedback.textContent = msg;
    els.qFeedback.className = "feedback" + (cls ? " " + cls : "");
  }
  function allBlanks() { return Array.from(els.qSaQuestion.querySelectorAll(".blank-input")); }
  function openBlanks() { return allBlanks().filter((inp) => !inp.disabled); }
  function focusNextOpenBlank(from) {
    const open = openBlanks();
    if (open.length === 0) return;
    const all = allBlanks();
    const start = all.indexOf(from);
    const target = open.find((i2) => all.indexOf(i2) > start && i2.value.trim() === "")
      || open.find((i2) => i2.value.trim() === "")
      || open.find((i2) => i2 !== from)
      || open[0];
    target.focus();
    try { target.select(); } catch {}
  }
  // 빈칸 위 힌트 칩 (연습): 이미 맞힌 자리는 글자를 그대로 보여 주고,
  // 아직 틀린 자리만 단계별 힌트로 보여 준다 — 1 ○(글자수), 2 초성, 3 이상은 앞에서부터 한 글자씩 공개.
  function knownPositions(inp) {
    return new Set((inp.dataset.known || "").split(",").filter(Boolean).map(Number));
  }
  function blankHintParts(expected, level, known) {
    let toReveal = Math.max(0, level - 2);
    return Array.from(expected).map((ch, i) => {
      if (known.has(i)) return { ch, known: true };
      if (level <= 1) return { ch: "○" };
      if (toReveal > 0) { toReveal--; return { ch }; }
      return { ch: toChosung(ch) };
    });
  }
  // 단계 = 힌트 버튼 단계와 그 칸에서 틀린 횟수 중 더 높은 쪽
  function updateBlankHint(inp, expected) {
    const badge = inp.parentElement?.querySelector(".blank-hint");
    if (!badge) return "";
    const level = Math.max(hintLevel, Number(inp.dataset.misses || 0));
    if (level <= 0) return "";
    const parts = blankHintParts(expected, level, knownPositions(inp));
    badge.innerHTML = parts
      .map((p) => (p.known ? `<span class="hint-known">${escapeHtml(p.ch)}</span>` : escapeHtml(p.ch)))
      .join("");
    badge.classList.remove("hidden");
    return parts.map((p) => p.ch).join("");
  }
  function renderHintLegend() {
    els.qHint.innerHTML = els.qSaQuestion.querySelector(".blank-input[data-misses]")
      ? '<span class="diff-legend">빈칸 위 힌트 — <span class="hint-known">초록 글자</span>는 맞은 자리, ○·초성은 다시 써야 할 자리</span>'
      : "";
  }
  function instantCheckBlank(inp, advance) {
    const q = pool[idx];
    if (answered || !q || !q.instantCheck) return;
    if (!inp.isConnected || inp.disabled) return; // 이미 넘어간 문제의 늦은 이벤트
    const val = inp.value;
    if (!val.trim()) return;
    if (inp.dataset.checked === val) return;      // 같은 답을 또 확인하면 횟수를 깎지 않는다
    inp.dataset.checked = val;
    const expected = splitExpected(q.answer)[Number(inp.dataset.idx)] || "";
    if (equalAnswer(val, expected)) {
      inp.classList.remove("wrong");
      inp.classList.add("correct");
      inp.disabled = true;
      setFeedback("맞았어요!", "correct");
    } else {
      // 틀릴 때마다 그 칸의 힌트가 한 단계씩 올라간다 (1 글자수 → 2 초성 → 3부터 한 글자씩).
      // 글자 수가 맞으면 자리별로 비교해서, 맞은 글자는 힌트에 그대로 남기고 틀린 자리만 힌트로 보여 준다.
      const misses = Number(inp.dataset.misses || 0) + 1;
      inp.dataset.misses = String(misses);
      inp.dataset.lastWrong = val.trim();
      inp.classList.remove("correct");
      inp.classList.add("wrong");
      const userChars = Array.from(normalize(val));
      const expChars = Array.from(expected);
      const lenOk = userChars.length === expChars.length;
      if (lenOk) {
        const known = knownPositions(inp);
        expChars.forEach((ch, i) => { if (userChars[i] === ch) known.add(i); });
        inp.dataset.known = Array.from(known).join(",");
      }
      const shown = updateBlankHint(inp, expected);
      renderHintLegend();
      const head = lenOk ? "글자 수는 맞아요" : `글자 수가 달라요 (${expChars.length}글자)`;
      const tail = misses === 1 ? (lenOk ? "○ 자리만 다시 써 보세요" : "다시 써 보세요")
        : misses === 2 ? "틀린 자리의 초성 힌트를 보세요"
        : "틀린 자리를 한 글자 더 알려 줄게요";
      setFeedback(shown === expected ? "정답을 보고 그대로 따라 써 보세요" : `${head} — ${tail}`, "retry");
      inp.classList.remove("shake");
      void inp.offsetWidth; // restart animation
      inp.classList.add("shake");
      if (advance) { inp.focus(); try { inp.select(); } catch {} }
      return;
    }
    if (openBlanks().length === 0) finalizeInstant();
    else if (advance) focusNextOpenBlank(inp);
  }
  function submitInstant() {
    const open = openBlanks();
    const filled = open.filter((inp) => inp.value.trim() !== "");
    if (filled.length === 0) { open[0]?.focus(); return; }
    filled.forEach((inp) => instantCheckBlank(inp, false));
    if (answered) return;
    const rest = openBlanks();
    const target = rest.find((inp) => inp.classList.contains("wrong"))
      || rest.find((inp) => inp.value.trim() === "")
      || rest[0];
    if (target) { target.focus(); try { target.select(); } catch {} }
  }
  function finalizeInstant() {
    const q = pool[idx];
    const inputs = allBlanks();
    const missesOf = (inp) => Number(inp.dataset.misses || 0);
    const hadMiss = inputs.some((inp) => missesOf(inp) > 0);
    // 한 칸을 2번 이상 틀렸으면(초성 힌트까지 받았으면) 오답으로 기록 → 오답노트 + 뒤에 다시 출제
    const struggled = inputs.filter((inp) => missesOf(inp) >= MAX_ATTEMPTS).length;
    answered = true;
    els.submitBtn.disabled = true;
    els.hintBtn.disabled = true;
    // 기록에는 여러 번 틀린 칸의 마지막 오답을 남긴다
    const userStr = inputs
      .map((inp) => (missesOf(inp) >= MAX_ATTEMPTS ? inp.dataset.lastWrong || "" : inp.value.trim()) || "(빈칸)")
      .join(" / ");
    setUserAnswerStr(userStr);
    if (struggled === 0) {
      markCorrect(hadMiss ? "정답! (재시도 성공)" : "정답!");
      recordAnswer(q, true);
    } else {
      markWrong(`다 채웠어요! 여러 번 틀린 칸이 ${struggled}개 있어서 조금 뒤에 다시 나와요`);
      recordAnswer(q, false, userStr);
    }
    updateModeLabel();
  }

  // --- 실전: 끝까지 푼 뒤 한 번에 채점 ---
  function gradeDeferredExam() {
    let empty = 0;
    const graded = pool.map((q, i) => {
      const s = stateByIdx.get(i) || {};
      const blanks = splitExpected(q.answer).map((exp, k) => {
        const user = (s.saInputs?.[k]?.value || "").trim();
        if (!user) empty++;
        return { user, expected: exp, ok: equalAnswer(user, exp) };
      });
      return { i, q, s, blanks };
    });
    if (empty > 0 && !confirm(`아직 안 쓴 빈칸이 ${empty}개 있어요. 그래도 채점할까요?`)) return false;
    graded.forEach(({ i, q, s, blanks }) => {
      const ok = blanks.every((b) => b.ok);
      s.type = "sa";
      s.answered = true;
      s.correct = ok;
      s.blankResults = blanks;
      s.userAnswerStr = blanks.some((b) => b.user)
        ? blanks.map((b) => b.user || "(빈칸)").join(" / ")
        : "";
      stateByIdx.set(i, s);
      recordAnswer(q, ok, s.userAnswerStr);
    });
    return true;
  }
  function renderVerseExamReport() {
    let blankOk = 0, blankTotal = 0, wrongQ = 0;
    const cards = pool.map((q, i) => {
      const s = stateByIdx.get(i) || {};
      const blanks = s.blankResults || [];
      if (s.correct !== true) wrongQ++;
      let k = 0, last = 0, body = "";
      for (const m of q.q.matchAll(BLANK_RE)) {
        body += escapeHtml(q.q.slice(last, m.index));
        const b = blanks[k++] || { user: "", expected: "", ok: false };
        blankTotal++;
        if (b.ok) {
          blankOk++;
          body += `<span class="rb rb-ok">${escapeHtml(b.expected)}</span>`;
        } else {
          body += `<span class="rb rb-bad">${escapeHtml(b.user || "빈칸")}</span><span class="rb rb-ans">${escapeHtml(b.expected)}</span>`;
        }
        last = m.index + m[0].length;
      }
      body += escapeHtml(q.q.slice(last));
      const pip = s.correct === true ? '<span class="pip pip-o">O</span>' : '<span class="pip pip-x">X</span>';
      return `
        <div class="q-stat-card">
          <div class="q-row">${pip} <span class="type-badge verse">${escapeHtml(q.label)}</span></div>
          <div class="verse-report-body">${body}</div>
        </div>`;
    });
    els.resultNote.textContent = `빈칸 ${blankOk} / ${blankTotal}개 정답`
      + (wrongQ > 0 ? ` · 틀린 ${wrongQ}문제는 암송 오답노트에 담았어요.` : " · 모두 맞았어요! 이제 전체 쓰기에 도전해 보세요.");
    els.resultNote.classList.remove("hidden");
    els.resultReport.classList.remove("hidden");
    els.resultReport.innerHTML = `<h3 class="report-title">상세 리포트 — <span class="rb rb-bad">내가 쓴 답</span><span class="rb rb-ans">정답</span></h3>${cards.join("")}`;
  }

  // --- 최종: 모든 구절 전체 쓰기 ---
  const vfEls = {
    card: $("#verse-full"),
    title: $("#vf-title"),
    list: $("#vf-list"),
    feedback: $("#vf-feedback"),
    quitBtn: $("#vf-quit-btn"),
    retryBtn: $("#vf-retry-btn"),
    submitBtn: $("#vf-submit-btn"),
  };
  let vfGraded = false;
  let vfWrongVerses = [];
  // 띄어쓰기·문장부호를 뺀 글자만 비교
  function stripForCompare(s) {
    return String(s || "").replace(/[\s.,!?·'"“”‘’~\-]/g, "");
  }
  // 최장 공통 부분열로 맞은 글자를 표시 (공백은 비교에서 제외)
  function lcsMarks(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ma = new Array(n).fill(false), mb = new Array(m).fill(false);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ma[i] = true; mb[j] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return [ma, mb];
  }
  function verseDiffHtml(userText, correctText) {
    const uChars = Array.from(userText.trim().replace(/\s+/g, " "));
    const cChars = Array.from(correctText);
    const keep = (ch) => stripForCompare(ch) !== "";
    const [mu, mc] = lcsMarks(uChars.filter(keep), cChars.filter(keep));
    const paint = (chars, marks, okCls, badCls) => {
      let k = 0;
      return chars.map((ch) => {
        if (!keep(ch)) return escapeHtml(ch);
        const cls = marks[k++] ? okCls : badCls;
        return cls ? `<span class="${cls}">${escapeHtml(ch)}</span>` : escapeHtml(ch);
      }).join("");
    };
    return {
      user: uChars.length ? paint(uChars, mu, "char-ok", "char-bad") : '<span class="muted-text">(안 씀)</span>',
      correct: paint(cChars, mc, "", "char-miss"),
    };
  }
  function verseFullHint(text, level) {
    if (level === 3) return text.split(" ").map(firstCharPlusChosung).join(" "); // 단어마다 첫 글자
    return hintFor(text, level);
  }
  function startVerseFull(onlyVerses) {
    if (!VERSE) return;
    verseMode = "full";
    practiceMode = false;
    examMode = false;
    vfGraded = false;
    vfWrongVerses = [];
    const verses = VERSE.verses.filter((v) => !onlyVerses || onlyVerses.includes(v.n));
    vfEls.title.textContent = `${VERSE.title} 전체 쓰기` + (onlyVerses ? " — 틀린 절 다시" : "");
    vfEls.list.innerHTML = "";
    const hintLabels = { 1: "글자수", 2: "초성", 3: "첫 글자" };
    verses.forEach((v) => {
      const row = document.createElement("div");
      row.className = "vf-row";
      row.dataset.n = String(v.n);
      row.innerHTML = `
        <div class="vf-head">
          <span class="vf-num">${v.n}절</span>
          <button class="secondary vf-hint-btn" type="button">힌트 보기 (0/3)</button>
        </div>
        <div class="vf-hint hidden"></div>
        <textarea class="vf-input" rows="2" autocomplete="off" spellcheck="false" placeholder="${v.n}절을 써 보세요"></textarea>
        <div class="vf-result"></div>`;
      const ta = row.querySelector(".vf-input");
      const hintBtn = row.querySelector(".vf-hint-btn");
      const hintBox = row.querySelector(".vf-hint");
      let level = 0;
      hintBtn.addEventListener("click", () => {
        if (vfGraded || level >= 3) return;
        level++;
        recordHintUse(verseFullId(v.n), level);
        hintBox.textContent = verseFullHint(verseFullText(v), level);
        hintBox.classList.remove("hidden");
        hintBtn.textContent = `힌트 보기 (${level}/3 · ${hintLabels[level]})`;
        if (level === 3) hintBtn.disabled = true;
        ta.focus();
      });
      ta.addEventListener("input", () => {
        ta.style.height = "auto";
        ta.style.height = ta.scrollHeight + 2 + "px";
      });
      ta.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault(); // 한 절은 한 줄 — Enter는 다음 절로 이동
        const all = Array.from(vfEls.list.querySelectorAll(".vf-input"));
        const next = all[all.indexOf(ta) + 1];
        if (next) next.focus();
        else vfEls.submitBtn.focus();
      });
      vfEls.list.appendChild(row);
    });
    vfEls.feedback.textContent = "";
    vfEls.feedback.className = "feedback";
    vfEls.submitBtn.classList.remove("hidden");
    vfEls.retryBtn.classList.add("hidden");
    vfEls.quitBtn.textContent = "그만하기";
    els.startCard.classList.add("hidden");
    els.playCard.classList.add("hidden");
    els.resultCard.classList.add("hidden");
    vfEls.card.classList.remove("hidden");
    vfEls.list.querySelector(".vf-input")?.focus();
  }
  function gradeVerseFull() {
    if (vfGraded) return;
    const rows = Array.from(vfEls.list.querySelectorAll(".vf-row"));
    const emptyCount = rows.filter((row) => !row.querySelector(".vf-input").value.trim()).length;
    if (emptyCount === rows.length) { rows[0]?.querySelector(".vf-input").focus(); return; }
    if (emptyCount > 0 && !confirm(`아직 안 쓴 절이 ${emptyCount}개 있어요. 그래도 채점할까요?`)) return;
    vfGraded = true;
    vfWrongVerses = [];
    rows.forEach((row) => {
      const n = Number(row.dataset.n);
      const v = VERSE.verses.find((x) => x.n === n);
      const correctText = verseFullText(v);
      const ta = row.querySelector(".vf-input");
      const userText = ta.value;
      const ok = stripForCompare(userText) === stripForCompare(correctText);
      ta.disabled = true;
      ta.classList.add(ok ? "correct" : "wrong");
      row.querySelector(".vf-hint-btn").disabled = true;
      const result = row.querySelector(".vf-result");
      if (ok) {
        result.innerHTML = '<span class="pip pip-o">O</span> 정확해요!';
      } else {
        vfWrongVerses.push(n);
        const diff = verseDiffHtml(userText, correctText);
        result.innerHTML = `
          <div><span class="pip pip-x">X</span> <span class="vf-line-label">내가 쓴 것</span>${diff.user}</div>
          <div><span class="vf-line-label">정답</span>${diff.correct}</div>`;
      }
      recordAnswer(
        { id: verseFullId(n), q: `${VERSE.refPrefix}${n} 전체 쓰기`, noWrongNote: true },
        ok,
        userText.trim().replace(/\s+/g, " ")
      );
    });
    const okCount = rows.length - vfWrongVerses.length;
    if (vfWrongVerses.length === 0) {
      vfEls.feedback.textContent = rows.length === VERSE.verses.length
        ? `완벽해요! ${VERSE.title}을 모두 외웠어요!`
        : "다시 쓴 절을 모두 맞혔어요!";
      vfEls.feedback.className = "feedback correct";
    } else {
      vfEls.feedback.textContent = `${okCount} / ${rows.length}절 정답 — 노란 글자가 빠뜨리거나 틀린 부분이에요`;
      vfEls.feedback.className = "feedback wrong";
    }
    vfEls.submitBtn.classList.add("hidden");
    vfEls.retryBtn.classList.toggle("hidden", vfWrongVerses.length === 0);
    vfEls.quitBtn.textContent = "처음으로";
    (vfWrongVerses.length ? vfEls.retryBtn : vfEls.quitBtn).focus();
  }

  // --- 시작 화면: 난이도 선택 + 말씀 보기 ---
  function renderVerseLevel() {
    $$(".level-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.level === verseLevel));
    const desc = $("#level-desc");
    if (desc) desc.textContent = VERSE_LEVELS[verseLevel].desc;
  }
  if (VERSE) {
    $("#verse-card").classList.remove("hidden");
    $("#verse-title").textContent = VERSE.title;
    $("#verse-version").textContent = `(${VERSE.version})`;
    $("#verse-exam-count").textContent = String(VERSE_UNITS.length);
    $("#verse-text-list").innerHTML = VERSE.verses
      .map((v) => `<li value="${v.n}">${escapeHtml(verseFullText(v))}</li>`).join("");
    renderVerseLevel();
    $$(".level-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        verseLevel = btn.dataset.level;
        localStorage.setItem(LS_VERSE_LEVEL, verseLevel);
        renderVerseLevel();
      });
    });
    $$("[data-verse-mode]").forEach((btn) => {
      btn.addEventListener("click", () => startVerse(btn.dataset.verseMode));
    });
    vfEls.submitBtn.addEventListener("click", gradeVerseFull);
    vfEls.retryBtn.addEventListener("click", () => startVerseFull(vfWrongVerses.slice()));
    vfEls.quitBtn.addEventListener("click", restart);
    els.resultVerseBtn.addEventListener("click", () => startVerse(els.resultVerseBtn.dataset.verseMode));
  }

  $$(".mode-btn[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => startQuiz(btn.dataset.preset));
  });
  els.prevBtn.addEventListener("click", prevQuestion);
  els.nextBtn.addEventListener("click", nextQuestion);
  els.restartBtn.addEventListener("click", restart);
  $("#quit-btn").addEventListener("click", quitQuiz);
  els.submitBtn.addEventListener("click", submitSA);
  els.hintBtn.addEventListener("click", showHint);

  // ---------- Browse ----------
  const browseType = $("#browse-type");
  const search = $("#search");
  function saQuestionHtml(q) {
    const expected = splitExpected(q.answer);
    const text = q.q;
    const matches = [...text.matchAll(BLANK_RE)];
    if (matches.length === 0) {
      return `${escapeHtml(text)} <span class="answer-box">${escapeHtml(q.answer)}</span>`;
    }
    let html = "";
    let last = 0;
    matches.forEach((m, i) => {
      html += escapeHtml(text.slice(last, m.index));
      const part = expected.length === matches.length ? expected[i] : "";
      html += `<span class="answer-box">${escapeHtml(part)}</span>`;
      last = m.index + m[0].length;
    });
    html += escapeHtml(text.slice(last));
    return html;
  }

  function renderList() {
    const ol = $("#question-list");
    ol.innerHTML = "";
    const f = normalize(search.value).toLowerCase();
    const tf = browseType.value;
    getAllQuestions().forEach((q) => {
      if (tf !== "all" && q.type !== tf) return;
      const ans = q.type === "mc" ? (q.options?.[q.answer] ?? "") : String(q.answer);
      const text = (q.q + " " + ans).toLowerCase();
      if (f && !text.includes(f)) return;
      const li = document.createElement("li");
      const typeLabel = q.type === "sa" ? "주관식" : "객관식";
      const qHtml = q.type === "sa" ? saQuestionHtml(q) : escapeHtml(q.q);
      const optionsHtml = q.type === "mc" && Array.isArray(q.options)
        ? `<ul class="mini-options">${q.options.map((o, oi) => `<li${oi === q.answer ? ' class="is-answer"' : ""}>${escapeHtml(o)}</li>`).join("")}</ul>`
        : "";
      const answerRow = q.type === "mc"
        ? `<div class="answer-row"><span class="answer">정답: ${escapeHtml(ans)}</span>${q.ref ? `<span class="ref">${escapeHtml(q.ref)}</span>` : ""}</div>`
        : (q.ref ? `<div class="answer-row"><span class="ref">${escapeHtml(q.ref)}</span></div>` : "");
      li.innerHTML = `
        <div class="q-row">
          <span class="type-badge ${q.type}">${typeLabel}</span><span class="q-body">${qHtml}</span>
        </div>
        ${optionsHtml}
        ${answerRow}
      `;
      ol.appendChild(li);
    });
  }
  search.addEventListener("input", renderList);
  browseType.addEventListener("change", renderList);
  renderList();

  // ---------- Admin ----------
  const adminEls = {
    refreshBtn: $("#admin-refresh-btn"),
    summary: $("#admin-summary"),
    users: $("#admin-users"),
  };

  function fmtDate(ts) {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString("ko-KR", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return "—"; }
  }

  async function renderAdmin() {
    if (!isAdmin()) return;
    adminEls.users.innerHTML = '<div class="muted-text">불러오는 중…</div>';
    adminEls.summary.textContent = "";
    try {
      const users = await fetchAllUsers();
      drawAdminUsers(users);
    } catch (e) {
      console.error("fetchAllUsers failed:", e);
      adminEls.users.innerHTML = `<div class="error">로드 실패: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }

  function drawAdminUsers(users) {
    let totT = 0, totC = 0;
    users.forEach((u) => {
      const eff = effectiveAttempts(u.history, u.attempts);
      Object.values(eff).forEach((a) => {
        totT += a.total || 0;
        totC += a.correct || 0;
      });
    });
    adminEls.summary.textContent = `사용자 ${users.length}명 · 전체 시도 ${totT}회 (정답 ${totC}회)`;

    users.sort((a, b) => (b.updatedAt || b.lastLoginAt || 0) - (a.updatedAt || a.lastLoginAt || 0));
    adminEls.users.innerHTML = "";
    users.forEach((u) => {
      const attempts = effectiveAttempts(u.history, u.attempts);
      const userTot = Object.values(attempts).reduce((s, a) => s + (a.total || 0), 0);
      const userCorrect = Object.values(attempts).reduce((s, a) => s + (a.correct || 0), 0);
      const distinct = Object.keys(attempts).length;
      const wrongCount = (u.wrong || []).length;
      const hintClicks = Object.values(u.hints || {}).reduce((s, h) => s + (h.clicks || 0), 0);
      const hintQuestions = Object.values(u.hints || {}).filter((h) => (h.clicks || 0) > 0).length;

      const card = document.createElement("div");
      card.className = "admin-user-card";
      card.innerHTML = `
        <div class="admin-user-head">
          <span class="admin-user-name">${escapeHtml(u.id)}</span>
          <button class="link-btn admin-toggle" type="button">상세 ▾</button>
        </div>
        <div class="admin-user-stats">
          <div><span class="stat-key">첫 접속</span> ${fmtDate(u.firstSeenAt)}</div>
          <div><span class="stat-key">마지막 접속</span> ${fmtDate(u.lastLoginAt)}</div>
          <div><span class="stat-key">마지막 활동</span> ${fmtDate(u.updatedAt)}</div>
          <div><span class="stat-key">총 시도</span> ${userTot}회 · <span class="stat-key">정답</span> ${userCorrect}회 · <span class="stat-key">정답률</span> ${userTot ? Math.round((userCorrect / userTot) * 100) : 0}%</div>
          <div><span class="stat-key">푼 문제</span> ${distinct} / ${getTrackables().length}개 · <span class="stat-key">오답노트</span> ${wrongCount}개 · <span class="stat-key">힌트</span> ${hintClicks}회 (${hintQuestions}개 문제)</div>
        </div>
        <div class="admin-user-detail hidden"></div>
      `;
      adminEls.users.appendChild(card);
      const toggle = card.querySelector(".admin-toggle");
      const detail = card.querySelector(".admin-user-detail");
      toggle.addEventListener("click", () => {
        if (detail.classList.contains("hidden")) {
          detail.innerHTML = renderUserDetail(u);
          detail.classList.remove("hidden");
          toggle.textContent = "상세 ▴";
        } else {
          detail.classList.add("hidden");
          toggle.textContent = "상세 ▾";
        }
      });
    });

    if (users.length === 0) {
      adminEls.users.innerHTML = '<div class="muted-text">사용자가 없습니다.</div>';
    }
  }

  function questionStatsHtml(q, attempts, history, hints, wrongSet, wrongAnswers) {
    const id = qid(q);
    const a = attempts[id] || { total: 0, correct: 0 };
    const h = history[id] || [];
    const inWrong = wrongSet.has(id);
    const hi = hints?.[id];
    const wa = (wrongAnswers && wrongAnswers[id]) || [];
    if (a.total === 0 && !inWrong && !hi && wa.length === 0) return null;
    const pips = h.map((r) => `<span class="pip pip-${r === "O" ? "o" : "x"}">${r}</span>`).join("");
    const rate = a.total > 0 ? Math.round((a.correct / a.total) * 100) : 0;
    const hintLabels = { 0: "—", 1: "글자수", 2: "초성", 3: "첫 글자" };
    const hintInfo = hi && hi.maxLevel > 0
      ? ` · <span class="hint-info">힌트 ${hi.maxLevel}단계(${hintLabels[hi.maxLevel]}) · ${hi.clicks}회</span>`
      : "";
    const wrongBadge = inWrong ? ' <span class="badge-wrong">오답노트</span>' : "";
    const wrongAnswersLine = wa.length > 0
      ? `<div class="wrong-answers"><span class="wa-label">오답 입력:</span> ${wa.map((x) => `<span class="wrong-answer-chip">${escapeHtml(x)}</span>`).join(" ")}</div>`
      : "";
    return `<div class="q-stats-main">시도 <b>${a.total}</b> · 정답 <b>${a.correct}</b> (정답률 <b>${rate}%</b>) · 최근 ${pips || '<span class="muted-text">—</span>'}${hintInfo}${wrongBadge}</div>${wrongAnswersLine}`;
  }

  function questionCardHtml(q, statsHtml) {
    const typeLabel = q.badge || (q.type === "sa" ? "주관식" : "객관식");
    const typeClass = q.verse ? "verse" : q.type;
    const qHtml = q.type === "sa" ? saQuestionHtml(q) : escapeHtml(q.q);
    const optionsHtml = q.type === "mc" && Array.isArray(q.options)
      ? `<ul class="mini-options">${q.options.map((o, oi) => `<li${oi === q.answer ? ' class="is-answer"' : ""}>${escapeHtml(o)}</li>`).join("")}</ul>`
      : "";
    const ans = q.type === "mc" ? (q.options?.[q.answer] ?? "") : String(q.answer);
    const answerRow = q.type === "mc"
      ? `<div class="answer-row"><span class="answer">정답: ${escapeHtml(ans)}</span>${q.ref ? `<span class="ref">${escapeHtml(q.ref)}</span>` : ""}</div>`
      : (q.ref ? `<div class="answer-row"><span class="ref">${escapeHtml(q.ref)}</span></div>` : "");
    return `
      <div class="q-stat-card">
        <div class="q-row">
          <span class="type-badge ${typeClass}">${typeLabel}</span><span class="q-body">${qHtml}</span>
        </div>
        ${optionsHtml}
        ${answerRow}
        ${statsHtml ? `<div class="q-stats">${statsHtml}</div>` : ""}
      </div>
    `;
  }

  function renderUserDetail(u) {
    const attempts = effectiveAttempts(u.history, u.attempts);
    const history = u.history || {};
    const hints = u.hints || {};
    const lastAt = u.lastAt || {};
    const wrongAnswers = u.wrongAnswers || {};
    const wrongSet = new Set(u.wrong || []);
    const sorted = getTrackables().sort((a, b) => {
      const ta = lastAt[qid(a)] || 0;
      const tb = lastAt[qid(b)] || 0;
      return tb - ta; // most recent first
    });
    const rows = sorted.map((q) => {
      const stats = questionStatsHtml(q, attempts, history, hints, wrongSet, wrongAnswers);
      if (!stats) return "";
      return questionCardHtml(q, stats);
    }).filter(Boolean).join("");
    return rows || '<div class="muted-text">아직 푼 문제가 없어요.</div>';
  }

  adminEls.refreshBtn.addEventListener("click", renderAdmin);

  // ---------- History tab ----------
  const historyEls = {
    summary: $("#history-summary"),
    detail: $("#history-detail"),
  };
  function renderHistory() {
    if (!getCurrentUser()) {
      historyEls.summary.textContent = "이름을 먼저 입력해 주세요.";
      historyEls.detail.innerHTML = "";
      return;
    }
    const u = {
      history: currentData.history || {},
      attempts: currentData.attempts || {},
      hints: currentData.hints || {},
      lastAt: currentData.lastAt || {},
      wrongAnswers: currentData.wrongAnswers || {},
      wrong: currentData.wrong || [],
    };
    const eff = effectiveAttempts(u.history, u.attempts);
    const totT = Object.values(eff).reduce((s, a) => s + (a.total || 0), 0);
    const totC = Object.values(eff).reduce((s, a) => s + (a.correct || 0), 0);
    const distinct = Object.keys(eff).length;
    const rate = totT ? Math.round((totC / totT) * 100) : 0;
    const wrongCount = u.wrong.length;
    const hintClicks = Object.values(u.hints).reduce((s, h) => s + (h.clicks || 0), 0);
    historyEls.summary.innerHTML =
      `푼 문제 <b>${distinct}</b> / ${getTrackables().length}개 · 총 시도 <b>${totT}</b>회 · 정답 <b>${totC}</b>회 (${rate}%) · 오답노트 <b>${wrongCount}</b>개 · 힌트 <b>${hintClicks}</b>회`;
    historyEls.detail.innerHTML = renderUserDetail(u);
  }

  // ---------- Admin password modal ----------
  const adminModal = $("#admin-modal");
  const adminPwInput = $("#admin-pw-input");
  const adminPwError = $("#admin-pw-error");
  const adminPwSubmit = $("#admin-pw-submit");
  const adminPwCancel = $("#admin-pw-cancel");
  let pendingAdminBtn = null;

  function showAdminModal(triggerBtn) {
    pendingAdminBtn = triggerBtn;
    adminPwError.classList.add("hidden");
    adminPwInput.value = "";
    adminModal.classList.remove("hidden");
    setTimeout(() => adminPwInput.focus(), 0);
  }
  function hideAdminModal() {
    adminModal.classList.add("hidden");
    pendingAdminBtn = null;
  }
  async function submitAdminPw() {
    const entered = adminPwInput.value;
    if (!entered) { adminPwInput.focus(); return; }
    const h = await sha256Hex(entered);
    if (h === ADMIN_PW_HASH) {
      setAdminUnlocked(true);
      hideAdminModal();
      if (pendingAdminBtn) activateTab(pendingAdminBtn);
    } else {
      adminPwError.classList.remove("hidden");
      adminPwInput.value = "";
      adminPwInput.focus();
    }
  }
  adminPwSubmit.addEventListener("click", submitAdminPw);
  adminPwCancel.addEventListener("click", hideAdminModal);
  adminPwInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitAdminPw(); }
    if (e.key === "Escape") { e.preventDefault(); hideAdminModal(); }
  });

  // Tab activation with admin gate
  function activateTab(btn) {
    $$(".tab-btn").forEach((b) => b.classList.remove("active"));
    $$(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "admin" && isAdmin() && adminUnlocked()) {
      renderAdmin();
    } else if (btn.dataset.tab === "history") {
      renderHistory();
    }
  }
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (btn.dataset.tab === "admin" && isAdmin() && !adminUnlocked()) {
        e.preventDefault();
        showAdminModal(btn);
        return;
      }
      activateTab(btn);
    }, true);
  });

  // ---------- Init ----------
  (async () => {
    if (!getCurrentUser()) {
      showUserModal();
    } else {
      updateUserUI(true);
      await loadCurrentUserData();
      touchUserLogin(getCurrentUser()).catch((e) => console.error("touchUserLogin failed:", e));
      updateUserUI(false);
    }
  })();
})();
