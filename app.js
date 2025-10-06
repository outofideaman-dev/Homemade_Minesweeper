// Minesweeper-like Web Game — 5 Groups, no global timer, no leaderboard
const SIZE = 16;
const MINE_COUNT = 40;
const DEFUSE_SECONDS = 30;
const GROUPS = 5;
const groupNames = Array.from({ length: GROUPS }, (_, i) => `Group ${i + 1}`);

// Effect rates
const EFFECT_ON_OPEN_RATE = 0.3;   // Xác suất hiệu ứng NGAY KHI mở phải bom (trước quiz)
const EFFECT_ON_SUCCESS_RATE = 0.3; // Xác suất hiệu ứng SAU KHI gỡ thành công (sau quiz)

// ===== Wheel DOM & state =====
let inSpin = false;                 // chặn thao tác khi đang quay
let suppressSuccessEffectThisTurn = false; // nếu effect "mở bom" xảy ra thì không chạy effect "sau-quiz"
const quizEffectBtn = document.getElementById("quiz-effect-btn");

let __wheel; // cache DOM phần wheel để không truy vấn lại mỗi lần
function getWheelEls() {
  if (__wheel && __wheel.backdrop && __wheel.canvas && __wheel.spinBtn) return __wheel;
  const backdrop = document.getElementById("wheel-backdrop");
  const title    = document.getElementById("wheel-title");
  const canvas   = document.getElementById("wheel-canvas");
  const label    = document.getElementById("wheel-label");
  const spinBtn  = document.getElementById("wheel-spin-btn"); // NEW
  const ctx      = canvas ? canvas.getContext("2d") : null;
  __wheel = { backdrop, title, canvas, label, spinBtn, ctx };
  return __wheel;
}
let pendingEffect = null;

// Tạo pending effect cho CASE "mở mìn" (trước quiz). Trả về true/false có effect hay không.
async function prepareEffectOnOpenMine() {
  if (Math.random() >= EFFECT_ON_OPEN_RATE) return false;

  const eff = randint(3) + 1;

  if (eff === 1) {
    // Chọn đội bị trừ 1 điểm → cần quay team
    pendingEffect = {
      type: "open:minus1",
      desc: "Chọn đội bị trừ 1 điểm",
      requiresSpin: true,
      run: async () => {
        // chạy sau khi đã quay
        const victim = await spinTeamWheel("Chọn đội bị trừ 1 điểm"); // quay thật tại thời điểm SPIN
        const before = scores[victim];
        scores[victim] = Math.max(0, scores[victim] - 1);
        updateTurnUI();
        alert(`Gắp lửa bỏ tay người\n- Trừ 1 điểm của ${groupNames[victim]} (${before} → ${scores[victim]})`);
      }
    };
  } else if (eff === 2) {
    // +2 cho đội hiện tại → không cần quay, nhưng vẫn bắt bấm "Spin" để xác nhận áp dụng
    pendingEffect = {
      type: "open:+2current",
      desc: "Tặng +2 điểm cho đội đang lượt",
      requiresSpin: false,
      run: async () => {
        const before = scores[turn];
        scores[turn] = before + 2;
        updateTurnUI();
        alert(`1 mũi tên trúng 2 đích\n- ${groupNames[turn]} +2 điểm (${before} → ${scores[turn]})`);
      }
    };
  } else {
    // Đổi điểm với đội khác → cần quay team (tránh tự động re-spin; nếu trúng chính mình thì lấy đội kế)
    pendingEffect = {
      type: "open:swap",
      desc: "Chọn đội để đổi điểm với đội hiện tại",
      requiresSpin: true,
      run: async () => {
        let other = await spinTeamWheel("Chọn đội để đổi điểm với đội hiện tại");
        if (other === turn) other = (turn + 1) % GROUPS; // tránh no-op
        const aName = groupNames[turn], bName = groupNames[other];
        const aBefore = scores[turn], bBefore = scores[other];
        [scores[turn], scores[other]] = [scores[other], scores[turn]];
        updateTurnUI();
        alert(`Bạn đi lạc\n- Đổi điểm giữa ${aName} và ${bName}\n  (trước: ${aName}=${aBefore}, ${bName}=${bBefore})`);
      }
    };
  }

  return true;
}

// Tạo pending effect cho CASE "sau khi gỡ thành công"
async function makeSuccessPendingEffect() {
  if (randint(2) === 0) {
    // Mở 3 ô an toàn (không cộng điểm) — không cần quay nhưng vẫn vào flow "Spin" để người chơi tự áp dụng
    return {
      type: "success:reveal",
      desc: "Vén màn bí mật — Lộ tối đa 3 ô an toàn",
      requiresSpin: false,
      run: async () => {
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
    };
  } else {
    // Δ điểm -2..+3 cho đội hiện tại → quay delta
    return {
      type: "success:delta",
      desc: "Bốc điểm (-2 .. +3)",
      requiresSpin: true,
      run: async () => {
        const delta = await spinDeltaWheel();
        const before = scores[turn];
        const after = Math.max(0, before + delta);
        scores[turn] = after;
        updateTurnUI();
        const sign = delta > 0 ? `+${delta}` : `${delta}`;
        alert(`Được ăn cả, ngã về không\n- ${groupNames[turn]} nhận ${sign} điểm (${before} → ${after})`);
      }
    };
  }
}
quizEffectBtn?.addEventListener("click", () => {
  if (!pendingEffect) return;
  const { backdrop, title, label, spinBtn, ctx } = getWheelEls();
  if (!backdrop) return;

  // Set mô tả/tiêu đề
  title.textContent = "Vòng quay";
  label.textContent = pendingEffect.desc || "";

  // Hiện overlay wheel nhưng KHÔNG quay
  backdrop.style.display = "flex";
  inSpin = true;

  // Reset canvas hiển thị lúc đầu
  if (ctx) drawWheel(ctx, ["1","2","3","4","5","6"], 0); // vẽ placeholder; không quan trọng

  // Chuẩn bị nút Spin
  if (spinBtn) {
    spinBtn.disabled = false;
    spinBtn.textContent = "Spin";
    spinBtn.onclick = async () => {
      // Sau khi bấm Spin: chạy effect (tự gọi spin* bên trong nếu cần)
      spinBtn.disabled = true;
      await pendingEffect.run(); // sẽ gọi spinTeamWheel/spinDeltaWheel nếu requiresSpin

      // đổi sang Exit
      spinBtn.disabled = false;
      spinBtn.textContent = "Exit";
      // Bấm Exit: tắt cả 2 popup (quiz + wheel) và clear pending
      spinBtn.onclick = () => {
        backdrop.style.display = "none";
        inSpin = false;

        // ẩn nút “You got smthg”
        if (quizEffectBtn) quizEffectBtn.style.display = "none";

        // đóng luôn popup quiz
        quizBackdrop.style.display = "none";
        inQuiz = false;

        pendingEffect = null;
      };
    };
  }
});


const TWO_PI = Math.PI * 2;

function drawWheel(ctx, labels, rotation = 0) {
  if (!ctx) return;
  const { width, height } = ctx.canvas;
  const r = Math.min(width, height) * 0.5 - 4;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(rotation);

  const n = labels.length;
  const seg = TWO_PI / n;

  // Miếng
  for (let i = 0; i < n; i++) {
    const a0 = i * seg, a1 = (i + 1) * seg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a0, a1);
    ctx.closePath();
    ctx.fillStyle = `hsl(${(i * 360 / n) | 0} 85% 45%)`;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.stroke();
  }

  // Nhãn
  ctx.fillStyle = "#fff";
  ctx.font = "bold 16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) * seg;
    const tx = Math.cos(a) * (r * 0.65);
    const ty = Math.sin(a) * (r * 0.65);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(a);
    ctx.fillText(String(labels[i]), 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

/** Quay wheel trong `durationMs` và trả về index trúng. */
function spinWheel({ labels, title: modalTitle, durationMs = 5000 }) {
  return new Promise((resolve) => {
    const { backdrop, title, label, ctx } = getWheelEls();
    if (!backdrop || !ctx) {
      console.warn("[wheel] DOM chưa sẵn sàng"); // Không có wheel → trả về 0 để không vỡ app
      return resolve(0);
    }

    inSpin = true;
    title.textContent = modalTitle || "Vòng quay";
    label.textContent = "";
    backdrop.style.display = "flex";

    const n = labels.length;
    const seg = TWO_PI / n;

    // Mục tiêu ngẫu nhiên
    const targetIndex = Math.floor(Math.random() * n);

    // canh sao cho tâm segment target nằm ở đỉnh (3π/2)
    const targetAngle = targetIndex * seg + seg / 2;
    let align = (1.5 * Math.PI - targetAngle);
    align = (align % TWO_PI + TWO_PI) % TWO_PI;

    const extraTurns = 4 + Math.random() * 2; // 4 → 6 vòng
    const finalAngle = align + TWO_PI * extraTurns;

    const t0 = performance.now();
    let rafId;
    const tick = (tNow) => {
      const t = Math.min(1, (tNow - t0) / durationMs);
      const angle = finalAngle * easeOutCubic(t);
      drawWheel(ctx, labels, angle);
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(rafId);
        setTimeout(() => {
          inSpin = false;
          //backdrop.style.display = "none";
          resolve(targetIndex);
        }, 250);
      }
    };

    drawWheel(ctx, labels, 0);
    requestAnimationFrame(tick);
  });
}

// Vòng quay 5 team
function spinTeamWheel(purposeText) {
  const labels = groupNames.map(n => n.replace("Group ", "T")); // "T1", "T2", ...
  return spinWheel({ labels, title: purposeText || "Chọn đội", durationMs: 5000 })
    .then(idx => idx); // 0..4
}

// Vòng quay delta -2..+3
function spinDeltaWheel() {
  const labels = ["-2", "-1", "0", "+1", "+2", "+3"];
  return spinWheel({ labels, title: "Bốc điểm (-2 .. +3)", durationMs: 5000 })
    .then(idx => parseInt(labels[idx], 10));
}

// ===== DOM =====
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

// ===== State =====
let mode = "open";
let running = false;

let board = null;
let defusedCount = 0;

let questions = [];
let inQuiz = false;
let quizTimer = null;
let pendingCell = null;

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

// ===== Helpers =====
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

// ===== Effect helpers =====
function pickOtherTeamIndex(cur) {
  const r = randint(GROUPS - 1);
  return r >= cur ? r + 1 : r;
}
function pickAnyTeamIndex() { return randint(GROUPS); }

// Mở tối đa 3 ô an toàn ngẫu nhiên (không cộng điểm) – dùng trong “sau khi gỡ”
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

// Bốc điểm -2..+3 cho team chỉ định (không âm) – (bản dùng alert trực tiếp)
function effectRandomDeltaNeg2to3(teamIdx = turn) {
  const before = scores[teamIdx];
  const delta = randint(6) - 2; // -2..+3
  const after = Math.max(0, before + delta);
  scores[teamIdx] = after;
  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  alert(`Được ăn cả, ngã về không\n- ${groupNames[teamIdx]} nhận ${sign} điểm (${before} → ${after})`);
}

// ===== Vòng quay + áp dụng effect (dùng Promise) =====
async function applyEffectOpenMineWithMsg() {
  if (Math.random() >= EFFECT_ON_OPEN_RATE) return "";

  const eff = randint(3) + 1;

  if (eff === 1) {
    // 🔁 Quay để chọn đội bị trừ 1 điểm (gồm cả đội đang lượt)
    const victim = await spinTeamWheel("Chọn đội bị trừ 1 điểm");
    const before = scores[victim];
    scores[victim] = Math.max(0, scores[victim] - 1);
    const after = scores[victim];
    updateTurnUI();
    return `Gắp lửa bỏ tay người\n- Trừ 1 điểm của ${groupNames[victim]} (${before} → ${after})`;

  } else if (eff === 2) {
    // +2 điểm cho đội đang lượt (không cần quay)
    const before = scores[turn];
    scores[turn] += 2;
    const after = scores[turn];
    updateTurnUI();
    return `1 mũi tên trúng 2 đích\n- ${groupNames[turn]} +2 điểm (${before} → ${after})`;

  } else {
    // 🔁 Quay để chọn đội đổi điểm (khác đội hiện tại)
    let other = await spinTeamWheel("Chọn đội để đổi điểm với đội hiện tại");
    if (other === turn) {
      other = await spinTeamWheel("Trúng đội hiện tại! Quay lại để chọn đội khác");
      if (other === turn) other = (turn + 1) % GROUPS; // fallback để không kẹt
    }
    const aName = groupNames[turn], bName = groupNames[other];
    const aBefore = scores[turn], bBefore = scores[other];

    const tmp = scores[turn]; scores[turn] = scores[other]; scores[other] = tmp;
    updateTurnUI();

    return `Bạn đi lạc\n- Đổi điểm giữa ${aName} và ${bName}\n  (trước: ${aName}=${aBefore}, ${bName}=${bBefore})`;
  }
}

async function runSuccessEffectAndGetMsg() {
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
    // 🔁 Vòng quay delta -2..+3
    const delta = await spinDeltaWheel();
    const before = scores[turn];
    const after = Math.max(0, before + delta);
    scores[turn] = after;
    updateTurnUI();
    const sign = delta > 0 ? `+${delta}` : `${delta}`;
    return `Được ăn cả, ngã về không\n- ${groupNames[turn]} nhận ${sign} điểm (${before} → ${after})`;
  }
}

// ===== Board =====
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
    tile.addEventListener("mouseenter", () => { highlightCross(x, y); });
    tile.addEventListener("mouseleave", () => { clearHighlight(); });

    boardEl.appendChild(tile);
  }
}

async function onTileClick(e) {
  if (!running || inQuiz || inSpin) return;
  const x = parseInt(e.currentTarget.dataset.x, 10);
  const y = parseInt(e.currentTarget.dataset.y, 10);

  if (mode === "open") {
    const res = await openCell(x, y);
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

async function openCell(x, y) {
  const cell = board[y][x];
  if (cell.opened || cell.flagged) return "noop";

  // Mìn chưa gỡ → thử effect "khi mở bom"
  if (cell.mine && !cell.defused) {
    const got = await prepareEffectOnOpenMine(); // NEW: tạo pendingEffect nếu có
    if (got) {
      suppressSuccessEffectThisTurn = true;

      // đánh dấu đã gỡ (KHÔNG cộng điểm) như cũ
      cell.defused = true;
      cell.opened = true;
      defusedCount += 1;
      defusedEl.textContent = String(defusedCount);
      mineCountEl.textContent = String(MINE_COUNT - defusedCount);

      // Cho hiện nút "You got smthg"
      if (quizEffectBtn) quizEffectBtn.style.display = "inline-flex";

      checkBoardCleared();
      return "opened"; // để đổi lượt như cũ
    }


    // Không trúng effect mở bom → vào quiz
    inQuiz = true;
    pendingCell = { x, y };
    startQuiz(x, y);
    return "quiz";
  }

  // Mìn đã gỡ hoặc ô thường
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

// ===== Quiz (Defuse) =====
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
  if (qIndex >= questions.length) { endGame(); return; }

  if (!inQuiz) inQuiz = true;
  if (!pendingCell) pendingCell = { x, y };

  const q = questions[qIndex]; // tuần tự
  const letters = ["A","B","C","D"];
  const optsArr = letters
    .map(L => ({ label: L, text: (q.options?.[L] || "").trim(), correct: (L === q.answer) }))
    .filter(o => o.text.length > 0);

  // shuffle vị trí
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

    btn.addEventListener("click", async () => {
      if (answered) return;
      answered = true;

      const allBtns = [...quizAnswers.children];
      allBtns.forEach(b => b.disabled = true);

      if (btn.dataset.correct === "1") {
        btn.classList.add("correct");
        resultKnown = true;
        finishQuiz(true, q.explanation, /*keepOpen*/ true);
      } else {
        btn.classList.add("wrong");
        const correctBtn = allBtns.find(b => b.dataset.correct === "1");
        if (correctBtn) correctBtn.classList.add("correct");
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

async function finishQuiz(success, explanation, keepOpen = true) {
  if (quizTimer) clearInterval(quizTimer);

  quizExplainEl.textContent = (explanation && explanation.trim())
    ? explanation.trim()
    : "Không có giải thích.";

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
    scores[turn] += 1;
    updateTurnUI();

    // Nếu CHƯA có effect “mở bom” thì mới xét effect “sau khi gỡ”
    if (!suppressSuccessEffectThisTurn && Math.random() < EFFECT_ON_SUCCESS_RATE) {
      pendingEffect = await makeSuccessPendingEffect(); // NEW
      if (quizEffectBtn) quizEffectBtn.style.display = "inline-flex";
    }


    // đổi lượt
    switchTeam();
    checkBoardCleared();
  } else {
    setTimeout(() => { newBoard(); }, 150);
    switchTeam();
  }

  renderBoard();

  // sang câu tiếp theo
  qIndex += 1;
  if (qIndex >= questions.length) {
    endGamePending = true;
    return;
  }

  if (!keepOpen) { quizBackdrop.style.display = "none"; inQuiz = false; }
}

// ===== Controls =====
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
btnNewBoard.addEventListener("click", () => { if (!inQuiz && !inSpin) newBoard(); });

btnStart.addEventListener("click", startGame);

let questionsLoaded = false;
async function loadDefaultQuestions() {
  const res = await fetch(`./assets/questions.txt`);
  if (!res.ok) throw new Error("Không tải được ./assets/questions.txt");
  const text = await res.text();
  questions = parseQuestions(text);
}
btnReloadQuestions.addEventListener("click", loadDefaultQuestions);

fileQuestions.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  questions = parseQuestions(text);
  alert(`Đã nạp ${questions.length} câu hỏi từ file.`);
});

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


