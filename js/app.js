(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // Tabs
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });

  // Quiz state
  let pool = [];
  let idx = 0;
  let score = 0;
  let answered = false;

  const startBtn = $("#start-btn");
  const nextBtn = $("#next-btn");
  const restartBtn = $("#restart-btn");
  const startCard = $("#quiz-start");
  const playCard = $("#quiz-play");
  const resultCard = $("#quiz-result");

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startQuiz() {
    const count = parseInt($("#quiz-count").value, 10);
    const all = shuffle(window.QUESTIONS || []);
    pool = count > 0 ? all.slice(0, count) : all;
    idx = 0;
    score = 0;
    startCard.classList.add("hidden");
    resultCard.classList.add("hidden");
    playCard.classList.remove("hidden");
    renderQuestion();
  }

  function renderQuestion() {
    answered = false;
    nextBtn.disabled = true;
    $("#q-feedback").textContent = "";
    $("#q-feedback").className = "feedback";

    const q = pool[idx];
    $("#q-index").textContent = String(idx + 1);
    $("#q-total").textContent = String(pool.length);
    $("#q-text").textContent = q.q;

    const ul = $("#q-options");
    ul.innerHTML = "";
    q.options.forEach((opt, i) => {
      const li = document.createElement("li");
      li.textContent = opt;
      li.addEventListener("click", () => selectOption(li, i, q.answer));
      ul.appendChild(li);
    });
  }

  function selectOption(li, chosen, correct) {
    if (answered) return;
    answered = true;
    const items = $("#q-options").children;
    for (const item of items) item.classList.add("disabled");

    if (chosen === correct) {
      li.classList.add("correct");
      $("#q-feedback").textContent = "정답!";
      $("#q-feedback").classList.add("correct");
      score++;
    } else {
      li.classList.add("wrong");
      items[correct].classList.add("correct");
      $("#q-feedback").textContent = "오답";
      $("#q-feedback").classList.add("wrong");
    }
    nextBtn.disabled = false;
  }

  function nextQuestion() {
    idx++;
    if (idx >= pool.length) {
      showResult();
    } else {
      renderQuestion();
    }
  }

  function showResult() {
    playCard.classList.add("hidden");
    resultCard.classList.remove("hidden");
    $("#score").textContent = String(score);
    $("#score-total").textContent = String(pool.length);
  }

  function restart() {
    resultCard.classList.add("hidden");
    startCard.classList.remove("hidden");
  }

  startBtn.addEventListener("click", startQuiz);
  nextBtn.addEventListener("click", nextQuestion);
  restartBtn.addEventListener("click", restart);

  // Browse
  function renderList(filter = "") {
    const ol = $("#question-list");
    ol.innerHTML = "";
    const f = filter.trim().toLowerCase();
    (window.QUESTIONS || []).forEach((q) => {
      const ans = q.options[q.answer];
      const text = (q.q + " " + ans).toLowerCase();
      if (f && !text.includes(f)) return;
      const li = document.createElement("li");
      li.innerHTML = `<div>${q.q}</div>
        <div><span class="answer">→ ${ans}</span>${q.ref ? `<span class="ref">${q.ref}</span>` : ""}</div>`;
      ol.appendChild(li);
    });
  }

  $("#search").addEventListener("input", (e) => renderList(e.target.value));
  renderList();
})();
