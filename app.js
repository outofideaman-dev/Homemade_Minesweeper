// Minesweeper-like Web Game — Two teams (White/Black), no global timer, no leaderboard
const SIZE = 16;
const MINE_COUNT = 40;
const DEFUSE_SECONDS = 30;

// ----- DOM -----
const boardEl = document.getElementById("board");
const mineTotalEl = document.getElementById("mine-total");
const teamWhiteBox = document.querySelector('.team-white');
const teamBlackBox = document.querySelector('.team-black');


// Scoreboard 2 đội
const scoreWhiteEl = document.getElementById("score-white");
const scoreBlackEl = document.getElementById("score-black");
const turnTeamEl   = document.getElementById("turn-team");

// Tọa độ
const coordTopEl   = document.getElementById("coord-top");
const coordLeftEl  = document.getElementById("coord-left");

// Counters
const defusedEl = document.getElementById("defused-count");
const mineCountEl = document.getElementById("mine-count");

// Controls
const btnStart = document.getElementById("btn-start");
const btnNewBoard = document.getElementById("btn-new-board");
const modeOpenBtn = document.getElementById("mode-open");
const modeFlagBtn = document.getElementById("mode-flag");
const modeUnflagBtn = document.getElementById("mode-unflag");

// Questions / Quiz
const fileQuestions  = document.getElementById("file-questions");
const btnReloadQuestions = document.getElementById("btn-reload-questions");
const quizBackdrop   = document.getElementById("quiz-backdrop");
const quizContent    = document.getElementById("quiz-content");
const quizAnswers    = document.getElementById("quiz-answers");
const quizExplainEl  = document.getElementById("quiz-explanation");
const quizTimerEl    = document.getElementById("quiz-timer");
const quizCloseBtn   = document.getElementById("quiz-close-btn");
quizCloseBtn.onclick = () => {
  quizBackdrop.style.display = "none";
  inQuiz = false;
  if (endGamePending) {
    endGamePending = false;
    endGame();                // CHỈ lúc này mới công bố đội thắng
  }
};


// ----- State -----
let mode = "open";
let running = false;

let board = null;
let defusedCount = 0;
let endGamePending = false; // bật khi vừa xử lý xong câu hỏi cuối


let questions = [];
let inQuiz = false;
let quizTimer = null;
let pendingCell = null;

let team = "white";       // 'white' | 'black' ; Trắng đi trước
let scoreWhite = 0;
let scoreBlack = 0;
let qIndex = 0; // hỏi lần lượt: 0,1,2,...


// ----- Helpers -----
function randint(n) { return Math.floor(Math.random() * n); }
function neighbors(x, y) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (dx === 0 && dy === 0) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE) out.push([nx, ny]);
  }
  return out;
}

function updateTurnUI() {
  // Cập nhật điểm
  scoreWhiteEl.textContent = String(scoreWhite);
  scoreBlackEl.textContent = String(scoreBlack);

  // (Giữ lại nếu bạn chưa ẩn badge "Lượt")
  turnTeamEl.textContent = (team === "white" ? "Trắng" : "Đen");

  // Tô xám ô của đội đang đến lượt
  teamWhiteBox.classList.toggle('active', team === 'white');
  teamBlackBox.classList.toggle('active', team === 'black');
}

function switchTeam() { team = (team === "white" ? "black" : "white"); updateTurnUI(); }

function renderCoords() {
  const letters = Array.from({length: SIZE}, (_,i)=> String.fromCharCode(65+i)); // A..P
  coordTopEl.innerHTML  = letters.map(l => `<div class="coord-cell">${l}</div>`).join("");
  coordLeftEl.innerHTML = Array.from({length: SIZE}, (_,i)=> `<div class="coord-cell">${i+1}</div>`).join("");
}

function endGame() {
  running = false;
  inQuiz = false;
  quizBackdrop.style.display = "none";

  let msg;
  if (scoreWhite === scoreBlack) msg = `Hết câu hỏi!\nHòa ${scoreWhite} – ${scoreBlack}.`;
  else if (scoreWhite > scoreBlack) msg = `Hết câu hỏi!\nĐội Trắng thắng ${scoreWhite} – ${scoreBlack}.`;
  else msg = `Hết câu hỏi!\nĐội Đen thắng ${scoreBlack} – ${scoreWhite}.`;

  alert(msg);
}


// ----- Questions -----
async function loadDefaultQuestions() {
  const res = await fetch("./assets/questions.txt");
  if (!res.ok) throw new Error("Không tải được ./assets/questions.txt");
  const text = await res.text();
  questions = parseQuestions(text);
}

fileQuestions.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  questions = parseQuestions(text);
  alert(`Đã nạp ${questions.length} câu hỏi từ file.`);
});
btnReloadQuestions.addEventListener("click", loadDefaultQuestions);

function parseQuestions(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const qs = [];
  let i = 0;
  const isBlank = s => !s || s.trim() === "";

  while (i < lines.length) {
    while (i < lines.length && isBlank(lines[i])) i++;
    if (i >= lines.length) break;

    // optional id
    let idLine = lines[i].trim();
    let qid = null;
    if (/^\d+\s*$/.test(idLine)) { qid = idLine.trim(); i++; }

    // question content (until A/B/C/D)
    const contentLines = [];
    while (i < lines.length && !/^[A-D][\.\)\s]\s*/i.test(lines[i])) {
      if (!isBlank(lines[i])) contentLines.push(lines[i]);
      i++;
    }
    const content = contentLines.join("\n").trim();

    // options (0..4)
    const opts = {};
    const letterRegex = /^[A-D][\.\)\s]\s*/i;
    while (i < lines.length && letterRegex.test(lines[i])) {
      const letter = lines[i].trim().charAt(0).toUpperCase();
      const opt = lines[i].replace(letterRegex, "").trim();
      opts[letter] = opt;
      i++;
    }
    for (const L of ["A","B","C","D"]) if (!opts[L]) opts[L] = "";

    // answer
    let answer = null;
    if (i < lines.length && !isBlank(lines[i])) {
      const line = lines[i].trim();
      const m = line.match(/^(ANS|ANSWER|ĐÁP\s*ÁN)\s*[:：]\s*([A-D])$/i);
      if (m) { answer = m[2].toUpperCase(); i++; }
      else if (/^[A-D]$/i.test(line)) { answer = line.toUpperCase(); i++; }
    }
    if (!answer) { console.warn("Question missing answer; default A:", content); answer = "A"; }

    // explanation
    let explanation = "";
    if (i < lines.length && lines[i].trim().startsWith("#")) {
      explanation = lines[i].replace(/^#\s*/, "").trim(); i++;
    }

    qs.push({ id: qid || String(qs.length + 1), content, options: opts, answer, explanation });

    while (i < lines.length && isBlank(lines[i])) i++;
  }
  return qs;
}

// ----- Board -----
function newBoard() {
  board = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ({
    mine: false, opened: false, flagged: false, defused: false, adjacent: 0
  })));

  defusedCount = 0;
  defusedEl.textContent = "0";
  mineCountEl.textContent = String(MINE_COUNT);

  // place mines
  let placed = 0;
  while (placed < MINE_COUNT) {
    const x = randint(SIZE), y = randint(SIZE);
    if (!board[y][x].mine) { board[y][x].mine = true; placed++; }
  }
  // adjacent counts
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (board[y][x].mine) { board[y][x].adjacent = -1; continue; }
    let c = 0; for (const [nx, ny] of neighbors(x, y)) if (board[ny][nx].mine) c++;
    board[y][x].adjacent = c;
  }

  renderCoords();
  renderBoard();
}

function renderBoard() {
  boardEl.innerHTML = "";
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const tile = document.createElement("div");
    tile.className = "tile"; tile.dataset.x = x; tile.dataset.y = y;
    const cell = board[y][x];

    if (cell.opened) tile.classList.add("open");
    if (cell.flagged) tile.classList.add("flag");
    if (cell.mine && cell.defused) tile.classList.add("mine", "defused");
    if (cell.opened && cell.mine && !cell.defused) tile.classList.add("mine", "failed");

    if (cell.opened) {
      if (cell.mine) tile.textContent = cell.defused ? "✓" : "💥";
      else if (cell.adjacent > 0) tile.textContent = cell.adjacent;
    } else if (cell.flagged) {
      tile.textContent = "⚑";
    }

    tile.addEventListener("click", onTileClick);
    tile.addEventListener("contextmenu", (e) => { e.preventDefault(); toggleFlag(tile); });
    boardEl.appendChild(tile);
  }
}

function onTileClick(e) {
  if (!running || inQuiz) return;
  const x = parseInt(e.currentTarget.dataset.x, 10);
  const y = parseInt(e.currentTarget.dataset.y, 10);
  if (mode === "open") openCell(x, y);
  else if (mode === "flag") setFlag(x, y, true);
  else if (mode === "unflag") setFlag(x, y, false);
  renderBoard();
}

function toggleFlag(tileEl) {
  if (!running || inQuiz) return;
  const x = parseInt(tileEl.dataset.x, 10), y = parseInt(tileEl.dataset.y, 10);
  const cell = board[y][x]; if (cell.opened) return; cell.flagged = !cell.flagged; renderBoard();
}
function setFlag(x, y, val) { const cell = board[y][x]; if (cell.opened) return; cell.flagged = val; }

function openCell(x, y) {
  const cell = board[y][x];
  if (cell.opened || cell.flagged) return;
  if (cell.mine) { if (cell.defused) { cell.opened = true; return; } startQuiz(x, y); return; }
  floodOpen(x, y);
}

function floodOpen(x, y) {
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    const cell = board[cy][cx];
    if (cell.opened || cell.flagged) continue;
    if (cell.mine && !cell.defused) continue;
    cell.opened = true;
    if (cell.adjacent === 0) {
      for (const [nx, ny] of neighbors(cx, cy)) {
        const ncell = board[ny][nx];
        if (!ncell.opened && !ncell.flagged && !(ncell.mine && !ncell.defused)) stack.push([nx, ny]);
      }
    }
  }
}

function checkBoardCleared() {
  if (defusedCount >= MINE_COUNT) {
    alert("Chúc mừng! Đã gỡ hết mìn. Tạo bàn mới.");
    newBoard();
    // Không đổi lượt ở đây (đã đổi lượt khi defuse xong quả mìn).
  }
}

// ----- Quiz (Defuse) -----
function startQuiz(x, y) {
  if (!questions.length) { alert("Chưa có bộ câu hỏi. Hãy tải file .txt hoặc dùng mặc định."); return; }
  // Hết câu hỏi → kết thúc game luôn (phòng khi click mìn sau câu cuối)
  if (qIndex >= questions.length) { endGame(); return; }

  inQuiz = true;
  pendingCell = { x, y };

  const q = questions[qIndex];              // <-- lấy theo thứ tự
  const letters = ["A","B","C","D"];
  const optsArr = letters
    .map(L => ({ label: L, text: (q.options?.[L] || "").trim(), correct: (L === q.answer) }))
    .filter(o => o.text.length > 0);

  // (giữ shuffle vị trí lựa chọn nếu bạn muốn) 
  for (let i = optsArr.length - 1; i > 0; i--) {
    const j = randint(i + 1);
    [optsArr[i], optsArr[j]] = [optsArr[j], optsArr[i]];
  }

  // UI
  quizContent.textContent = q.content;
  quizAnswers.innerHTML = "";
  quizExplainEl.textContent = "";

  let answered = false;
  let resultKnown = false;

  optsArr.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.textContent = `${String.fromCharCode(65 + idx)}. ${opt.text}`;
    btn.dataset.correct = opt.correct ? "1" : "0";
    btn.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      [...quizAnswers.children].forEach(b => b.disabled = true);
      const current = btn.textContent.replace(/^[XO]\s+/, '');
      btn.textContent = (btn.dataset.correct === "1" ? `O ${current}` : `X ${current}`);
      resultKnown = true;
      finishQuiz(btn.dataset.correct === "1", q.explanation, /*keepOpen*/ true);
    });
    quizAnswers.appendChild(btn);
  });

  quizBackdrop.style.display = "flex";

  // timer
  let left = DEFUSE_SECONDS;
  quizTimerEl.textContent = left;
  if (quizTimer) clearInterval(quizTimer);
  const t0 = Date.now();
  quizTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - t0) / 1000);
    left = Math.max(0, DEFUSE_SECONDS - elapsed);
    quizTimerEl.textContent = left;
    if (left <= 0) {
      clearInterval(quizTimer);
      if (!resultKnown) {
        resultKnown = true;
        finishQuiz(false, questions[qIndex].explanation, /*keepOpen*/ true);
      }
    }
  }, 200);
}


function finishQuiz(success, explanation, keepOpen = true) {
  if (quizTimer) clearInterval(quizTimer);

  // LUÔN hiển thị giải thích (bên dưới lựa chọn)
  quizExplainEl.textContent = (explanation && explanation.trim())
    ? explanation.trim()
    : "Không có giải thích.";

  // cập nhật ô/bàn + điểm/luật đội
  const { x, y } = pendingCell || {};
  pendingCell = null;
  if (x == null || y == null) return;

  const cell = board[y][x];
  cell.opened = true;

  if (success) {
    cell.defused = true;
    defusedCount += 1;
    defusedEl.textContent = String(defusedCount);
    mineCountEl.textContent = String(MINE_COUNT - defusedCount);

    if (team === "white") scoreWhite += 1; else scoreBlack += 1;
    updateTurnUI();
    switchTeam();

    checkBoardCleared();
  } else {
    setTimeout(() => { newBoard(); }, 150);
    switchTeam();
  }

  renderBoard();

  // ĐÃ xử lý xong câu hiện tại → chuyển sang câu tiếp theo
  qIndex += 1;

  // Nếu đã dùng hết câu hỏi → kết thúc game
  if (qIndex >= questions.length) {
    endGamePending = true;
    return;
  }

  // Giữ popup mở để xem giải thích; người chơi bấm Thoát để đóng
  if (!keepOpen) { quizBackdrop.style.display = "none"; inQuiz = false; }
}


// ----- Controls -----
function setMode(newMode) {
  mode = newMode;
  [modeOpenBtn, modeFlagBtn, modeUnflagBtn].forEach(el => el.classList.remove("primary"));
  if (mode === "open") modeOpenBtn.classList.add("primary");
  if (mode === "flag") modeFlagBtn.classList.add("primary");
  if (mode === "unflag") modeUnflagBtn.classList.add("primary");
}
modeOpenBtn.addEventListener("click", () => setMode("open"));
modeFlagBtn.addEventListener("click", () => setMode("flag"));
modeUnflagBtn.addEventListener("click", () => setMode("unflag"));
btnNewBoard.addEventListener("click", () => { if (!inQuiz) newBoard(); });

btnStart.addEventListener("click", startGame);

let questionsLoaded = false;
async function startGame() {
  
  if (running) return;
  if (!questionsLoaded) {
    try { await loadDefaultQuestions(); questionsLoaded = true; }
    catch (e) { console.error(e); alert("Không tải được bộ câu hỏi mặc định. Hãy chọn file .txt."); }
  }
  running = true;

  // Reset 2 đội & counters
  endGamePending = false;
  team = "white";
  scoreWhite = 0; scoreBlack = 0;
  defusedCount = 0;
  qIndex = 0;                 // <-- hỏi từ câu đầu tiên
  mineTotalEl.textContent = String(MINE_COUNT);

  updateTurnUI();

  newBoard();
}
