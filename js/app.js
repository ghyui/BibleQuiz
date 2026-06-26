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
    // - Add on any wrong answer
    // - Remove ONLY when the last 5 history entries are all "O"
    const wrongSet = new Set(currentData.wrong);
    if (correct) {
      const last5 = currentData.history[id].slice(-5);
      if (last5.length >= 5 && last5.every((r) => r === "O")) {
        wrongSet.delete(id);
      }
    } else {
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
  function getWrongCount() {
    return (currentData.wrong || []).length;
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
    quizCount: $("#quiz-count"),
    quizType: $("#quiz-type"),
    quizMode: $("#quiz-mode"),
    qIndex: $("#q-index"),
    qTotal: $("#q-total"),
    qTypeBadge: $("#q-type-badge"),
    qHistory: $("#q-history"),
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
    const opt = els.quizMode.querySelector('option[value="wrong"]');
    if (opt) opt.textContent = `오답노트만 (${getWrongCount()})`;
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

  function startQuiz() {
    const count = parseInt(els.quizCount.value, 10);
    const typeFilter = els.quizType.value;
    const mode = els.quizMode.value;
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
    pool = count > 0 ? all.slice(0, count) : all;
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
    const s = {
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
    const prev = stateByIdx.get(idx);
    if (prev && prev.correct !== undefined) s.correct = prev.correct;
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
  function calcScore() {
    let n = 0;
    stateByIdx.forEach((s) => { if (s.correct === true) n++; });
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
    els.qIndex.textContent = String(idx + 1);
    els.qTotal.textContent = String(pool.length);
    renderHistory(q);

    if (q.type === "sa") {
      els.qTypeBadge.textContent = "주관식";
      els.qTypeBadge.className = "type-badge sa";
      els.qText.classList.add("hidden");
      els.qOptions.classList.add("hidden");
      els.qSaQuestion.classList.remove("hidden");
      els.qSa.classList.remove("hidden");
      renderSAWithBlanks(q.q, q.answer, els.qSaQuestion);
      els.submitBtn.disabled = false;
      els.hintBtn.disabled = false;
      els.qSaQuestion.querySelectorAll(".blank-input").forEach((inp) => {
        inp.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
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

    // Focus appropriately
    if (q.type === "sa" && !answered) {
      const firstEditable = els.qSaQuestion.querySelector(".blank-input:not([disabled])");
      firstEditable?.focus();
    }

    // Nav buttons
    els.prevBtn.disabled = idx === 0;
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
      recordAnswer(q, true);
      updateModeLabel();
      return;
    }

    // wrong pick
    attempts++;
    li.classList.add("wrong", "disabled");
    if (attempts < MAX_ATTEMPTS) {
      markRetry("오답 — 한 번 더 골라보세요!");
    } else {
      answered = true;
      if (items[correct]) items[correct].classList.add("correct");
      for (const item of items) item.classList.add("disabled");
      markWrong(`오답 (정답: ${items[correct]?.textContent ?? ""})`);
      const wrongPicked = li.textContent || "";
      recordAnswer(q, false, wrongPicked);
      updateModeLabel();
    }
  }

  function submitSA() {
    if (answered) return;
    const q = pool[idx];
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

    if (allCorrect) {
      answered = true;
      inputs.forEach((inp) => (inp.disabled = true));
      els.submitBtn.disabled = true;
      els.hintBtn.disabled = true;
      markCorrect(attempts === 0 ? "정답!" : "정답! (재시도 성공)");
      els.qHint.innerHTML = "";
      recordAnswer(q, true);
      updateModeLabel();
      return;
    }

    // wrong
    attempts++;
    showCharDiffs(blankResults);

    if (attempts < MAX_ATTEMPTS) {
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
      recordAnswer(q, false);
      updateModeLabel();
    }
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
  }
  function markWrong(msg) {
    els.qFeedback.textContent = msg;
    els.qFeedback.className = "feedback wrong";
    els.nextBtn.disabled = false;
    setResult(false);
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
  function showHint() {
    if (answered) return;
    const q = pool[idx];
    if (q.type !== "sa") return;
    if (hintLevel >= 3) return;
    hintLevel++;
    // Record hint usage per question (max level reached, total clicks)
    const id = qid(q);
    if (!currentData.hints) currentData.hints = {};
    if (!currentData.hints[id]) currentData.hints[id] = { maxLevel: 0, clicks: 0 };
    currentData.hints[id].clicks++;
    if (hintLevel > currentData.hints[id].maxLevel) {
      currentData.hints[id].maxLevel = hintLevel;
    }
    persistCurrentUserData();
    const labels = { 1: "글자수", 2: "초성", 3: "첫 글자" };
    els.hintLabel.textContent = `(${hintLevel}/3 · ${labels[hintLevel]})`;

    const inputs = Array.from(els.qSaQuestion.querySelectorAll(".blank-input"));
    const expected = splitExpected(q.answer);

    // Append a new row instead of clearing — previous levels stay visible
    const row = document.createElement("div");
    row.className = "hint-row-line";
    const head = document.createElement("span");
    head.className = "hint-head";
    head.textContent = `힌트(${labels[hintLevel]}): `;
    row.appendChild(head);

    if (expected.length === inputs.length) {
      expected.forEach((part, i) => {
        const tag = document.createElement("span");
        tag.className = "hint-tag";
        tag.textContent = inputs.length > 1
          ? `${i + 1}) ${hintFor(part, hintLevel)}`
          : hintFor(part, hintLevel);
        row.appendChild(tag);
      });
    } else {
      const tag = document.createElement("span");
      tag.className = "hint-tag";
      tag.textContent = hintFor(q.answer, hintLevel);
      row.appendChild(tag);
    }
    els.qHint.appendChild(row);
    if (hintLevel === 3) els.hintBtn.disabled = true;
  }

  function prevQuestion() {
    if (idx === 0) return;
    captureCurrentState();
    idx--;
    renderQuestion();
  }
  function nextQuestion() {
    captureCurrentState();
    if (idx + 1 >= pool.length) showResult();
    else { idx++; renderQuestion(); }
  }
  function showResult() {
    els.playCard.classList.add("hidden");
    els.resultCard.classList.remove("hidden");
    els.score.textContent = String(calcScore());
    els.scoreTotal.textContent = String(pool.length);
    updateModeLabel();
  }
  function restart() {
    els.resultCard.classList.add("hidden");
    els.startCard.classList.remove("hidden");
  }

  els.startBtn.addEventListener("click", startQuiz);
  els.prevBtn.addEventListener("click", prevQuestion);
  els.nextBtn.addEventListener("click", nextQuestion);
  els.restartBtn.addEventListener("click", restart);
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
          <div><span class="stat-key">푼 문제</span> ${distinct} / ${(window.QUESTIONS || []).length}개 · <span class="stat-key">오답노트</span> ${wrongCount}개 · <span class="stat-key">힌트</span> ${hintClicks}회 (${hintQuestions}개 문제)</div>
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
    const typeLabel = q.type === "sa" ? "주관식" : "객관식";
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
          <span class="type-badge ${q.type}">${typeLabel}</span><span class="q-body">${qHtml}</span>
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
    const sorted = [...(window.QUESTIONS || [])].sort((a, b) => {
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
      `푼 문제 <b>${distinct}</b> / ${(window.QUESTIONS||[]).length}개 · 총 시도 <b>${totT}</b>회 · 정답 <b>${totC}</b>회 (${rate}%) · 오답노트 <b>${wrongCount}</b>개 · 힌트 <b>${hintClicks}</b>회`;
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
