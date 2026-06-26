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
  function normalize(s) { return (s || "").trim().replace(/\s+/g, " "); }
  function equalAnswer(a, b) { return normalize(a) === normalize(b); }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }

  // ---------- Storage ----------
  const LS_USER = "bq_currentUser";
  const LS_USERS = "bq_users";
  const MAX_HISTORY = 10;

  function getCurrentUser() { return localStorage.getItem(LS_USER) || ""; }
  function setCurrentUser(name) {
    localStorage.setItem(LS_USER, name);
    const users = getKnownUsers();
    if (!users.includes(name)) {
      users.push(name);
      localStorage.setItem(LS_USERS, JSON.stringify(users));
    }
  }
  function getKnownUsers() {
    try { return JSON.parse(localStorage.getItem(LS_USERS) || "[]"); } catch { return []; }
  }
  function loadUserData(name) {
    try {
      const raw = localStorage.getItem("bq_user_" + name);
      const obj = raw ? JSON.parse(raw) : {};
      if (!obj.history) obj.history = {};
      if (!obj.wrong) obj.wrong = [];
      return obj;
    } catch { return { history: {}, wrong: [] }; }
  }
  function saveUserData(name, data) {
    localStorage.setItem("bq_user_" + name, JSON.stringify(data));
  }
  function qid(q) {
    let h = 5381;
    const s = q.q;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function recordAnswer(q, correct) {
    const name = getCurrentUser();
    if (!name) return;
    const data = loadUserData(name);
    const id = qid(q);
    if (!data.history[id]) data.history[id] = [];
    data.history[id].push(correct ? "O" : "X");
    if (data.history[id].length > MAX_HISTORY) data.history[id] = data.history[id].slice(-MAX_HISTORY);
    const wrongSet = new Set(data.wrong);
    if (correct) wrongSet.delete(id);
    else wrongSet.add(id);
    data.wrong = Array.from(wrongSet);
    saveUserData(name, data);
  }
  function getWrongIds() {
    const name = getCurrentUser();
    if (!name) return new Set();
    return new Set(loadUserData(name).wrong || []);
  }
  function getHistoryFor(q) {
    const name = getCurrentUser();
    if (!name) return [];
    return loadUserData(name).history[qid(q)] || [];
  }
  function getWrongCount() {
    const name = getCurrentUser();
    if (!name) return 0;
    return (loadUserData(name).wrong || []).length;
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
  function submitUserName() {
    const name = els.userNameInput.value.trim();
    if (!name) { els.userNameInput.focus(); return; }
    setCurrentUser(name);
    hideUserModal();
    updateUserUI();
  }
  function updateUserUI() {
    const name = getCurrentUser();
    if (name) {
      els.userLabel.textContent = `사용자: ${name}`;
      els.userLabel.classList.remove("hidden");
      els.userChangeBtn.classList.remove("hidden");
    } else {
      els.userLabel.classList.add("hidden");
      els.userChangeBtn.classList.add("hidden");
    }
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

  // ---------- Tabs ----------
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });

  // ---------- Quiz state ----------
  let pool = [];
  let idx = 0;
  let score = 0;
  let answered = false;
  let hintLevel = 0;
  let attempts = 0; // 0 = no submit yet, 1 = first wrong (retry chance), 2 = final
  const MAX_ATTEMPTS = 2;

  const BLANK_RE = /\(\s+\)/g;
  function splitExpected(answer) {
    return String(answer).split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
  }
  function visibleLen(s) {
    return Array.from(String(s)).filter((c) => !/\s/.test(c)).length;
  }
  function makeBlankInput(idx, expectedPart) {
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
    return input;
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
    score = 0;
    els.startCard.classList.add("hidden");
    els.resultCard.classList.add("hidden");
    els.playCard.classList.remove("hidden");
    renderQuestion();
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
      const firstInput = els.qSaQuestion.querySelector(".blank-input");
      firstInput?.focus();
      els.qSaQuestion.querySelectorAll(".blank-input").forEach((inp) => {
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); submitSA(); }
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
      recordAnswer(q, false);
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
    score++;
    els.nextBtn.disabled = false;
  }
  function markWrong(msg) {
    els.qFeedback.textContent = msg;
    els.qFeedback.className = "feedback wrong";
    els.nextBtn.disabled = false;
  }
  function markRetry(msg) {
    els.qFeedback.textContent = msg;
    els.qFeedback.className = "feedback retry";
    els.nextBtn.disabled = true; // can't proceed until retry resolves
  }

  function hintFor(answerPart, level) {
    if (level === 1) return maskAll(answerPart);
    if (level === 2) return toChosung(answerPart);
    if (level === 3) return maskExceptFirst(answerPart);
    return "";
  }
  function showHint() {
    if (answered) return;
    const q = pool[idx];
    if (q.type !== "sa") return;
    if (hintLevel >= 3) return;
    hintLevel++;
    const labels = { 1: "글자수", 2: "초성", 3: "첫 글자" };
    els.hintLabel.textContent = `(${hintLevel}/3 · ${labels[hintLevel]})`;
    const inputs = Array.from(els.qSaQuestion.querySelectorAll(".blank-input"));
    const expected = splitExpected(q.answer);
    if (expected.length === inputs.length) {
      inputs.forEach((inp, i) => { inp.placeholder = hintFor(expected[i], hintLevel); });
      els.qHint.textContent = "";
    } else {
      els.qHint.textContent = `힌트(${labels[hintLevel]}): ${hintFor(q.answer, hintLevel)}`;
    }
    if (hintLevel === 3) els.hintBtn.disabled = true;
  }

  function nextQuestion() {
    idx++;
    if (idx >= pool.length) showResult();
    else renderQuestion();
  }
  function showResult() {
    els.playCard.classList.add("hidden");
    els.resultCard.classList.remove("hidden");
    els.score.textContent = String(score);
    els.scoreTotal.textContent = String(pool.length);
    updateModeLabel();
  }
  function restart() {
    els.resultCard.classList.add("hidden");
    els.startCard.classList.remove("hidden");
  }

  els.startBtn.addEventListener("click", startQuiz);
  els.nextBtn.addEventListener("click", nextQuestion);
  els.restartBtn.addEventListener("click", restart);
  els.submitBtn.addEventListener("click", submitSA);
  els.hintBtn.addEventListener("click", showHint);

  // ---------- Browse ----------
  const browseType = $("#browse-type");
  const search = $("#search");
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
      const optionsHtml = q.type === "mc" && Array.isArray(q.options)
        ? `<ul class="mini-options">${q.options.map((o, oi) => `<li${oi === q.answer ? ' class="is-answer"' : ""}>${escapeHtml(o)}</li>`).join("")}</ul>`
        : "";
      li.innerHTML = `
        <div class="q-row">
          <span class="type-badge ${q.type}">${typeLabel}</span><span class="q-body">${escapeHtml(q.q)}</span>
        </div>
        ${optionsHtml}
        <div class="answer-row"><span class="answer">정답: ${escapeHtml(ans)}</span>${q.ref ? `<span class="ref">${escapeHtml(q.ref)}</span>` : ""}</div>
      `;
      ol.appendChild(li);
    });
  }
  search.addEventListener("input", renderList);
  browseType.addEventListener("change", renderList);
  renderList();

  // ---------- Init ----------
  if (!getCurrentUser()) {
    showUserModal();
  } else {
    updateUserUI();
  }
})();
