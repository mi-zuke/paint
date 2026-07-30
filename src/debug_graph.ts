let containerEl: HTMLDivElement | null = null;
let canvasEl: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

const HISTORY_LEN = 120;
const history: { recvd: number; drawn: number }[] = [];

let currentRecvd = 0;
let currentDrawn = 0;

export function addReceivedPointsCount(count = 1) {
  currentRecvd += count;
}

export function addDrawnPointsCount(count = 1) {
  currentDrawn += count;
}

export function initDebugGraph() {
  if (containerEl) return;

  containerEl = document.createElement('div');
  containerEl.id = 'debug-points-graph';
  containerEl.style.cssText = `
    position: fixed;
    right: 16px;
    top: 64px;
    z-index: 99999;
    background: rgba(15, 23, 42, 0.88);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 6px;
    padding: 8px;
    pointer-events: none;
    font-family: monospace;
    font-size: 11px;
    color: #fff;
    box-shadow: 0 4px 12px rgba(0,0,0,0.6);
  `;

  canvasEl = document.createElement('canvas');
  canvasEl.width = 200;
  canvasEl.height = 100;
  canvasEl.style.cssText = 'display: block; width: 200px; height: 100px;';

  containerEl.appendChild(canvasEl);

  document.body.appendChild(containerEl);

  ctx = canvasEl.getContext('2d');

  for (let i = 0; i < HISTORY_LEN; i++) {
    history.push({ recvd: 0, drawn: 0 });
  }

  requestAnimationFrame(tickGraph);
}

function tickGraph() {
  history.push({ recvd: currentRecvd, drawn: currentDrawn });
  if (history.length > HISTORY_LEN) {
    history.shift();
  }

  const lastRecvd = currentRecvd;
  const lastDrawn = currentDrawn;

  currentRecvd = 0;
  currentDrawn = 0;

  drawGraph(lastRecvd, lastDrawn);

  requestAnimationFrame(tickGraph);
}

function drawGraph(lastRecvd: number, lastDrawn: number) {
  if (!ctx || !canvasEl) return;
  const w = canvasEl.width;
  const h = canvasEl.height;

  // Clear background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, w, h);

  // Find max Y scale (minimum 10 for visibility)
  let maxVal = 10;
  for (const item of history) {
    if (item.recvd > maxVal) maxVal = item.recvd;
    if (item.drawn > maxVal) maxVal = item.drawn;
  }
  maxVal = Math.ceil(maxVal * 1.15);

  // Draw horizontal center grid line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  // Draw Received line (Green)
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < history.length; i++) {
    const x = (i / (HISTORY_LEN - 1)) * w;
    const y = h - (history[i].recvd / maxVal) * (h - 20) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw Drawn line (Red)
  ctx.strokeStyle = '#f87171';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < history.length; i++) {
    const x = (i / (HISTORY_LEN - 1)) * w;
    const y = h - (history[i].drawn / maxVal) * (h - 20) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw legends & text
  ctx.fillStyle = '#4ade80';
  ctx.fillText(`Recv: ${lastRecvd}`, 6, 14);

  ctx.fillStyle = '#f87171';
  ctx.fillText(`Drawn: ${lastDrawn}`, 80, 14);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(`Max:${maxVal}`, 150, 14);
}
