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

  const els = {
    startCard: $("#quiz-start"),
    playCard: $("#quiz-play"),
    resultCard: $("#quiz-result"),
    startBtn: $("#start-btn"),
    nextBtn: $("#next-btn"),
    restartBtn: $("#restart-btn"),
    quizCount: $("#quiz-count"),
    quizType: $("#quiz-type"),
    qIndex: $("#q-index"),
    qTotal: $("#q-total"),
    qTypeBadge: $("#q-type-badge"),
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
    let all = getAllQuestions();
    if (typeFilter !== "all") all = all.filter((q) => q.type === typeFilter);
    all = shuffle(all);
    pool = count > 0 ? all.slice(0, count) : all;
    if (pool.length === 0) {
      alert("선택한 유형의 문제가 없습니다.");
      return;
    }
    idx = 0;
    score = 0;
    els.startCard.classList.add("hidden");
    els.resultCard.classList.add("hidden");
    els.playCard.classList.remove("hidden");
    renderQuestion();
  }

  function renderQuestion() {
    answered = false;
    hintLevel = 0;
    els.nextBtn.disabled = true;
    els.qFeedback.textContent = "";
    els.qFeedback.className = "feedback";
    els.qHint.textContent = "";
    els.hintLabel.textContent = "(0/3)";

    const q = pool[idx];
    els.qIndex.textContent = String(idx + 1);
    els.qTotal.textContent = String(pool.length);

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
      // Enter key submits from any blank
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
    answered = true;
    const items = els.qOptions.children;
    for (const item of items) item.classList.add("disabled");
    if (chosen === correct) {
      li.classList.add("correct");
      markCorrect("정답!");
    } else {
      li.classList.add("wrong");
      if (items[correct]) items[correct].classList.add("correct");
      markWrong(`오답 (정답: ${items[correct]?.textContent ?? ""})`);
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
    answered = true;
    inputs.forEach((inp) => (inp.disabled = true));
    els.submitBtn.disabled = true;
    els.hintBtn.disabled = true;

    const expected = String(q.answer).split(/\s*\/\s*/);
    let allCorrect = false;

    if (expected.length === inputs.length) {
      // per-blank compare
      allCorrect = true;
      inputs.forEach((inp, i) => {
        const ok = equalAnswer(userValues[i], expected[i]);
        inp.classList.add(ok ? "correct" : "wrong");
        if (!ok) {
          inp.title = `정답: ${expected[i]}`;
          allCorrect = false;
        }
      });
    } else {
      // count mismatch — compare concatenated
      const userJoined = userValues.map((v) => v.trim()).filter(Boolean).join(" / ");
      allCorrect = equalAnswer(userJoined, q.answer);
      inputs.forEach((inp) => inp.classList.add(allCorrect ? "correct" : "wrong"));
    }

    if (allCorrect) {
      markCorrect("정답!");
    } else {
      markWrong(`오답 (정답: ${q.answer})`);
    }
  }

  function markCorrect(msg) {
    els.qFeedback.textContent = msg;
    els.qFeedback.classList.add("correct");
    score++;
    els.nextBtn.disabled = false;
  }
  function markWrong(msg) {
    els.qFeedback.textContent = msg;
    els.qFeedback.classList.add("wrong");
    els.nextBtn.disabled = false;
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
      inputs.forEach((inp, i) => {
        inp.placeholder = hintFor(expected[i], hintLevel);
      });
      els.qHint.textContent = "";
    } else {
      // fallback: count mismatch — show a single combined hint below
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
    getAllQuestions().forEach((q, i) => {
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
          <span class="type-badge ${q.type}">${typeLabel}</span>
          <span class="q-body">${escapeHtml(q.q)}</span>
        </div>
        ${optionsHtml}
        <div class="answer-row"><span class="answer">정답: ${escapeHtml(ans)}</span>${q.ref ? `<span class="ref">${escapeHtml(q.ref)}</span>` : ""}</div>
      `;
      ol.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }

  search.addEventListener("input", renderList);
  browseType.addEventListener("change", renderList);
  renderList();
})();
