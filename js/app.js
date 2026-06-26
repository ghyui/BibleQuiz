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
    qOptions: $("#q-options"),
    qSa: $("#q-sa"),
    qInput: $("#q-answer-input"),
    submitBtn: $("#submit-btn"),
    hintBtn: $("#hint-btn"),
    hintLabel: $("#hint-level"),
    qHint: $("#q-hint"),
    qFeedback: $("#q-feedback"),
    score: $("#score"),
    scoreTotal: $("#score-total"),
  };

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
    els.qText.textContent = q.q;

    if (q.type === "sa") {
      els.qTypeBadge.textContent = "주관식";
      els.qTypeBadge.className = "type-badge sa";
      els.qOptions.classList.add("hidden");
      els.qSa.classList.remove("hidden");
      els.qInput.value = "";
      els.qInput.disabled = false;
      els.submitBtn.disabled = false;
      els.hintBtn.disabled = false;
      els.qInput.focus();
    } else {
      els.qTypeBadge.textContent = "객관식";
      els.qTypeBadge.className = "type-badge mc";
      els.qSa.classList.add("hidden");
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
    const user = els.qInput.value;
    if (!user.trim()) {
      els.qInput.focus();
      return;
    }
    answered = true;
    els.qInput.disabled = true;
    els.submitBtn.disabled = true;
    els.hintBtn.disabled = true;
    if (equalAnswer(user, q.answer)) {
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

  function showHint() {
    if (answered) return;
    const q = pool[idx];
    if (q.type !== "sa") return;
    if (hintLevel >= 3) return;
    hintLevel++;
    els.hintLabel.textContent = `(${hintLevel}/3)`;
    const ans = String(q.answer);
    if (hintLevel === 1) {
      els.qHint.textContent = `힌트(글자수): ${maskAll(ans)} — ${Array.from(ans).filter((c) => !/\s/.test(c)).length}글자`;
    } else if (hintLevel === 2) {
      els.qHint.textContent = `힌트(초성): ${toChosung(ans)}`;
    } else if (hintLevel === 3) {
      els.qHint.textContent = `힌트(첫 글자): ${maskExceptFirst(ans)}`;
      els.hintBtn.disabled = true;
    }
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
  els.qInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitSA(); }
  });

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
