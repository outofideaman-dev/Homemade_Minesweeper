// Minesweeper-like Web Game — 5 Groups, no global timer, no leaderboard
const SIZE = 16;
const MINE_COUNT = 40;
const DEFUSE_SECONDS = 30;
const GROUPS = 5;
const groupNames = Array.from({ length: GROUPS }, (_, i) => `Group ${i + 1}`);

// Effect rates
const EFFECT_ON_OPEN_RATE = 1;        // 20% khi VỪA mở ô bom (quiz sắp hiện)
const EFFECT_ON_SUCCESS_RATE = 1; // 20% sau khi gỡ mìn thành công


// ----- DOM -----
const boardEl      = document.getElementById("board");
const mineTotalEl  = document.getElementById("mine-total");

// Scoreboard (5 ô)
const teamBoxes    = [...document.querySelectorAll('.scoreboard .team')];
const scoreEls     = [...document.querySelectorAll('[data-score]')];

// Tọa độ
const coordTopEl   = document.getElementById("coord-top");
const coordLeftEl  = document.getElementById("coord-left");

// Counters
const defusedEl    = document.getElementById("defused-count");
const mineCountEl  = document.getElementById("mine-count");

// Controls
const btnStart     = document.getElementById("btn-start");
const btnNewBoard  = document.getElementById("btn-new-board");
const modeOpenBtn  = document.getElementById("mode-open");
const modeFlagBtn  = document.getElementById("mode-flag");
const modeUnflagBtn= document.getElementById("mode-unflag");

// Questions / Quiz
const fileQuestions  = document.getElementById("file-questions");
const btnReloadQuestions = document.getElementById("btn-reload-questions");
const quizBackdrop   = document.getElementById("quiz-backdrop");
const quizContent    = document.getElementById("quiz-content");
const quizAnswers    = document.getElementById("quiz-answers");
const quizExplainEl  = document.getElementById("quiz-explanation");
const quizTimerEl    = document.getElementById("quiz-timer");
const quizCloseBtn   = document.getElementById("quiz-close-btn");

// ----- State -----
let mode = "open";
let running = false;

let board = null;
let defusedCount = 0;

let questions = [];
let inQuiz = false;
let quizTimer = null;
let pendingCell = null;
let suppressSuccessEffectThisTurn = false;


let scores = Array(GROUPS).fill(0); // điểm từng nhóm
let turn = 0;                       // 0..4 (Group 1 đi trước)

let qIndex = 0;             // hỏi lần lượt
let endGamePending = false; // chỉ alert khi bấm Thoát ở câu cuối

// ===== Hover highlight helpers =====
function getTileEl(x, y) {
  // renderBoard append theo thứ tự y (hàng) rồi x (cột)
  return boardEl.children[y * SIZE + x];
}

function clearHighlight() {
  boardEl.querySelectorAll('.hl').forEach(el => el.classList.remove('hl'));
  coordTopEl.querySelectorAll('.hl').forEach(el => el.classList.remove('hl'));
  coordLeftEl.querySelectorAll('.hl').forEach(el => el.classList.remove('hl'));
}

function highlightCross(x, y) {
  clearHighlight();
  // highlight cùng hàng
  for (let cx = 0; cx < SIZE; cx++) {
    const el = getTileEl(cx, y);
    if (el) el.classList.add('hl');
  }
  // highlight cùng cột
  for (let cy = 0; cy < SIZE; cy++) {
    const el = getTileEl(x, cy);
    if (el) el.classList.add('hl');
  }
  // highlight nhãn tọa độ
  const colLabel = coordTopEl.children[x];
  const rowLabel = coordLeftEl.children[y];
  if (colLabel) colLabel.classList.add('hl');
  if (rowLabel) rowLabel.classList.add('hl');
}

// ----- Helpers -----

function applyEffectOpenMineWithMsg() {
  if (Math.random() >= EFFECT_ON_OPEN_RATE) return "";

  const eff = randint(3) + 1;
  if (eff === 1) {
    const victim = pickAnyTeamIndex();
    const before = scores[victim];
    scores[victim] = Math.max(0, scores[victim] - 1);
    const after = scores[victim];
    updateTurnUI();
    return `Gắp lửa bỏ tay người\n- Trừ 1 điểm của ${groupNames[victim]} (${before} → ${after})`;
  } else if (eff === 2) {
    const before = scores[turn];
    scores[turn] += 2;
    const after = scores[turn];
    updateTurnUI();
    return `1 mũi tên trúng 2 đích\n- ${groupNames[turn]} +2 điểm (${before} → ${after})`;
  } else {
    const other = pickOtherTeamIndex(turn);
    const aName = groupNames[turn], bName = groupNames[other];
    const aBefore = scores[turn], bBefore = scores[other];
    const tmp = scores[turn]; scores[turn] = scores[other]; scores[other] = tmp;
    updateTurnUI();
    return `Bạn đi lạc\n- Đổi điểm giữa ${aName} và ${bName}\n  (trước: ${aName}=${aBefore}, ${bName}=${bBefore})`;
  }
}

function runSuccessEffectAndGetMsg() {
  if (randint(2) === 0) {
    // mở 3 ô an toàn (không cộng điểm)
    const safes = [];
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const c = board[y][x];
      if (!c.opened && !c.flagged && !(c.mine && !c.defused)) safes.push([x, y]);
    }
    const openedCoords = [];
    const n = Math.min(3, safes.length);
    for (let i = 0; i < n; i++) {
      const k = randint(safes.length);
      const [x, y] = safes.splice(k, 1)[0];
      floodOpen(x, y);
      openedCoords.push(`${String.fromCharCode(65 + x)}${y + 1}`);
    }
    renderBoard();
    return `Vén màn bí mật\n- Lộ ${n} ô an toàn: ${openedCoords.join(", ")}`;
  } else {
    const before = scores[turn];
    const delta = randint(6) - 2; // -2..+3
    const after = Math.max(0, before + delta);
    scores[turn] = after;
    updateTurnUI();
    const sign = delta > 0 ? `+${delta}` : `${delta}`;
    return `Được ăn cả, ngã về không\n- ${groupNames[turn]} nhận ${sign} điểm (${before} → ${after})`;
  }
}

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
  for (let i = 0; i < GROUPS; i++) {
    if (scoreEls[i]) scoreEls[i].textContent = String(scores[i]);
    if (teamBoxes[i]) teamBoxes[i].classList.toggle('active', i === turn);
  }
}

function switchTeam() {
  turn = (turn + 1) % GROUPS;
  suppressSuccessEffectThisTurn = false; // reset sang lượt mới
  updateTurnUI();
}


function renderCoords() {
  const letters = Array.from({length: SIZE}, (_,i)=> String.fromCharCode(65+i)); // A..P
  coordTopEl.innerHTML  = letters.map(l => `<div class="coord-cell">${l}</div>`).join("");
  coordLeftEl.innerHTML = Array.from({length: SIZE}, (_,i)=> `<div class="coord-cell">${i+1}</div>`).join("");
}

function endGame() {
  running = false;
  inQuiz = false;
  quizBackdrop.style.display = "none";

  const max = Math.max(...scores);
  const winners = scores.map((s, i) => s === max ? groupNames[i] : null).filter(Boolean);

  let msg;
  if (winners.length === 1) msg = `Hết câu hỏi!\n${winners[0]} thắng với ${max} điểm.`;
  else msg = `Hết câu hỏi!\nHòa giữa ${winners.join(", ")} với ${max} điểm.`;
  alert(msg);
}

// ===== Effect helpers (20% on open bomb / 20% on detonation) =====
function pickOtherTeamIndex(cur) {
  // chọn 1 nhóm ngẫu nhiên khác với nhóm hiện tại cur (0..GROUPS-1)
  const r = randint(GROUPS - 1);
  return r >= cur ? r + 1 : r;
}

function pickAnyTeamIndex() {
  return randint(GROUPS); // 0..GROUPS-1, gồm cả nhóm hiện tại
}

// Mở tối đa 3 ô an toàn ngẫu nhiên (không cộng điểm)
function effectReveal3Safe() {
  const safes = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const c = board[y][x];
    if (!c.opened && !c.flagged && !(c.mine && !c.defused)) safes.push([x, y]);
  }

  const openedCoords = [];
  const n = Math.min(3, safes.length);
  for (let i = 0; i < n; i++) {
    const k = randint(safes.length);
    const [x, y] = safes.splice(k, 1)[0];
    floodOpen(x, y);
    openedCoords.push(`${String.fromCharCode(65 + x)}${y + 1}`);
  }

  renderBoard();
  alert(`Vén màn bí mật\n- Lộ ${n} ô an toàn: ${openedCoords.join(", ")}`);
}

// Bốc thăm điểm -2..+3 cho nhóm đang lượt (không âm)
// Bốc thăm điểm -2..+3 cho một team chỉ định (không âm)
function effectRandomDeltaNeg2to3(teamIdx = turn) {
  const before = scores[teamIdx];
  const delta = randint(6) - 2; // -2..+3
  const after = Math.max(0, before + delta);
  scores[teamIdx] = after;

  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  alert(
    `Được ăn cả, ngã về không\n` +
    `- ${groupNames[teamIdx]} nhận ${sign} điểm (${before} → ${after})`
  );
}





function applyEffectOpenMine() {
  if (Math.random() >= EFFECT_ON_OPEN_RATE) return false;  // 80% không có gì

  const eff = randint(3) + 1; // 1..3

  if (eff === 1) {
    // Trừ 1 điểm của 1 nhóm NGẪU NHIÊN (CÓ THỂ trúng nhóm hiện tại)
    const victim = pickAnyTeamIndex(); // gồm cả nhóm đang lượt
    const before = scores[victim];
    scores[victim] = Math.max(0, scores[victim] - 1);
    const after = scores[victim];

    alert(
      "Gắp lửa bỏ tay người\n" +
      `- Trừ 1 điểm của ${groupNames[victim]} (${before} → ${after})`
    );

  } else if (eff === 2) {
    // +2 điểm cho nhóm hiện tại
    const before = scores[turn];
    scores[turn] += 2;
    const after = scores[turn];

    alert(
      "1 mũi tên trúng 2 đích\n" +
      `- ${groupNames[turn]} được +2 điểm (${before} → ${after})`
    );

  } else if (eff === 3) {
    // Đổi điểm với một nhóm KHÁC
    const other = pickOtherTeamIndex(turn);
    const aName = groupNames[turn];
    const bName = groupNames[other];
    const aBefore = scores[turn];
    const bBefore = scores[other];

    // Thông báo đổi điểm giữa 2 nhóm
    alert(
      "Bạn đi lạc\n" +
      `- Đổi điểm giữa ${aName} và ${bName}\n` +
      `  (trước: ${aName}=${aBefore}, ${bName}=${bBefore})`
    );

    // Thực hiện hoán đổi
    const tmp = scores[turn]; 
    scores[turn] = scores[other]; 
    scores[other] = tmp;

    // (tuỳ chọn) bạn có thể alert thêm điểm sau khi đổi:
    // alert(`Sau khi đổi: ${aName}=${scores[turn]}, ${bName}=${scores[other]}`);
  }

  updateTurnUI();
  return true;
}



// ----- Questions -----
async function loadDefaultQuestions() {
  const res = await fetch(`./assets/questions.txt`);
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
    tile.addEventListener("mouseenter", () => {
      // Cho phép hover cả khi đang quiz nếu muốn
      highlightCross(x, y);
    });
    tile.addEventListener("mouseleave", () => {
      clearHighlight();
    });

    boardEl.appendChild(tile);
  }
}

function onTileClick(e) {
  if (!running || inQuiz) return;
  const x = parseInt(e.currentTarget.dataset.x, 10);
  const y = parseInt(e.currentTarget.dataset.y, 10);

  if (mode === "open") {
    const res = openCell(x, y);
    renderBoard();

    // Mở ô thường (hoặc mìn đã gỡ) -> kết thúc lượt ngay
    if (res === "opened") {
      switchTeam();
    }
    // res === "quiz": chưa kết thúc ở đây; finishQuiz() sẽ tự switchTeam()
    // res === "noop": không làm gì, không kết thúc lượt
  } else if (mode === "flag") {
    setFlag(x, y, true);
    renderBoard();
  } else if (mode === "unflag") {
    setFlag(x, y, false);
    renderBoard();
  }
}

function toggleFlag(tileEl) {
  if (!running || inQuiz) return;
  const x = parseInt(tileEl.dataset.x, 10), y = parseInt(tileEl.dataset.y, 10);
  const cell = board[y][x]; if (cell.opened) return; cell.flagged = !cell.flagged; renderBoard();
}
function setFlag(x, y, val) { const cell = board[y][x]; if (cell.opened) return; cell.flagged = val; }

function openCell(x, y) {
  const cell = board[y][x];

  // Không làm gì -> không kết thúc lượt
  if (cell.opened || cell.flagged) return "noop";

  // Mìn chưa gỡ -> thử "effect khi vừa mở bom"
  if (cell.mine && !cell.defused) {
    // Thay vì gọi trực tiếp, để applyEffectOpenMine trả về message
    const msgOpen = applyEffectOpenMineWithMsg(); // <-- hàm mới bên dưới

    if (msgOpen) {
      suppressSuccessEffectThisTurn = true;
      // đánh dấu đã gỡ
      cell.defused = true;
      cell.opened = true;
      defusedCount += 1;
      defusedEl.textContent = String(defusedCount);
      mineCountEl.textContent = String(MINE_COUNT - defusedCount);

      // chạy on-success và ghép message

      alert(`Hiệu ứng khi mở bom:\n${msgOpen}${msgSuccess}`);

      checkBoardCleared();
      return "opened";
    }

    // không trúng effect → vào quiz
    inQuiz = true;
    pendingCell = { x, y };
    startQuiz(x, y);
    return "quiz";
  }


  // Mìn đã gỡ hoặc ô thường -> mở (có thể flood), sau đó kết thúc lượt
  if (cell.mine && cell.defused) {
    cell.opened = true;
  } else {
    floodOpen(x, y);
  }
  return "opened";
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
  }
}

// ----- Quiz (Defuse) -----
quizCloseBtn.onclick = () => {
  quizBackdrop.style.display = "none";
  inQuiz = false;
  if (endGamePending) {
    endGamePending = false;
    endGame(); // chỉ công bố khi bấm Thoát ở câu cuối
  }
};

function startQuiz(x, y) {
  if (!questions.length) { alert("Chưa có bộ câu hỏi. Hãy tải file .txt hoặc dùng mặc định."); return; }
  if (qIndex >= questions.length) { endGame(); return; } // phòng trường hợp click sau khi hết câu

  // inQuiz & pendingCell đã set trong openCell trước khi gọi tới đây (để effect mở bom chạy trước).
  // Nhưng nếu gọi trực tiếp (trường hợp khác), đảm bảo set:
  if (!inQuiz) inQuiz = true;
  if (!pendingCell) pendingCell = { x, y };

  const q = questions[qIndex]; // tuần tự
  const letters = ["A","B","C","D"];
  const optsArr = letters
    .map(L => ({ label: L, text: (q.options?.[L] || "").trim(), correct: (L === q.answer) }))
    .filter(o => o.text.length > 0);

  // shuffle vị trí lựa chọn (tuỳ bạn có thể bỏ)
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

      const allBtns = [...quizAnswers.children];
      allBtns.forEach(b => b.disabled = true);

      if (btn.dataset.correct === "1") {
        btn.classList.add("correct");           // đúng: xanh
        resultKnown = true;
        finishQuiz(true, q.explanation, /*keepOpen*/ true);
      } else {
        btn.classList.add("wrong");             // sai: đỏ
        const correctBtn = allBtns.find(b => b.dataset.correct === "1");
        if (correctBtn) correctBtn.classList.add("correct"); // bôi xanh đáp án đúng
        resultKnown = true;
        finishQuiz(false, q.explanation, /*keepOpen*/ true);
      }
    });

    quizAnswers.appendChild(btn);
  });

  // Mở popup
  quizBackdrop.style.display = "flex";

  // Timer
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
        // Hết giờ: khóa nút & tô xanh đáp án đúng
        const allBtns = [...quizAnswers.children];
        allBtns.forEach(b => b.disabled = true);
        const correctBtn = allBtns.find(b => b.dataset.correct === "1");
        if (correctBtn) correctBtn.classList.add("correct");

        resultKnown = true;
        finishQuiz(false, q.explanation, /*keepOpen*/ true);
      }
    }
  }, 200);
}

function finishQuiz(success, explanation, keepOpen = true) {
  if (quizTimer) clearInterval(quizTimer);

  // luôn hiển thị giải thích
  quizExplainEl.textContent = (explanation && explanation.trim())
    ? explanation.trim()
    : "Không có giải thích.";

  // cập nhật ô/bàn + điểm/luật nhóm
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

    // +1 cho nhóm đang đi
    // +1 cho nhóm đang đi
    scores[turn] += 1;
    updateTurnUI();

    // ✅ Áp hiệu ứng sau khi gỡ (dùng hàm trả về message để HIỂN THỊ TRONG POPUP)
    let msgSuccess = "";
    if (!suppressSuccessEffectThisTurn && Math.random() < EFFECT_ON_SUCCESS_RATE) {
      const m = runSuccessEffectAndGetMsg(); // thực thi hiệu ứng & trả về mô tả
      if (m) {
        // nối message vào phần giải thích để người chơi thấy ngay
        const extra = `\n\nHiệu ứng sau khi gỡ:\n${m}`;
        // giữ lại giải thích cũ rồi nối thêm
        quizExplainEl.textContent = (quizExplainEl.textContent || "") + extra;
      }
    }

    // rồi CHUYỂN LƯỢT
    switchTeam();


    checkBoardCleared();
  } else {
    setTimeout(() => { newBoard(); }, 150);
    switchTeam();
  }



  renderBoard();

  // ĐÃ xử lý xong câu hiện tại → sang câu tiếp theo
  qIndex += 1;

  // Hết câu → không alert ngay; chờ bấm Thoát
  if (qIndex >= questions.length) {
    endGamePending = true;
    return;
  }

  // (Tuỳ chọn) tự đóng nếu muốn
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
    catch (e) { console.error(e); alert("Không tải được bộ câu hỏi mặc định. Hãy chọn file .txt."); return; }
  }

  running = true;

  // Reset nhóm & counters
  scores = Array(GROUPS).fill(0);
  turn = 0;                 // Group 1 đi trước
  defusedCount = 0;
  qIndex = 0;
  endGamePending = false;

  mineTotalEl.textContent = String(MINE_COUNT);
  updateTurnUI();

  newBoard();
}

