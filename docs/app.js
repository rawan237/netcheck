// ===== Settings =====
const API = "https://r-netcheck.duckdns.org";
const PING_COUNT = 10;     // how many pings to send
const DOWNLOAD_MB = 5;     // size of each download
const DOWNLOAD_RUNS = 4;   // first run is a warm-up and is thrown away
const UPLOAD_MB = 2;
const UPLOAD_RUNS = 3;

const $ = (id) => document.getElementById(id);

// Bytes and seconds -> megabits per second
function toMbps(bytes, seconds) {
  return (bytes * 8) / seconds / 1_000_000;
}

function average(list) {
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// A unique query string so the browser never serves an old answer from cache
const fresh = () => `t=${Date.now()}-${Math.random()}`;

// ===== 1. Ping and jitter =====
async function measurePing() {
  const times = [];
  for (let i = 0; i < PING_COUNT; i++) {
    const start = performance.now();
    await fetch(`${API}/ping?${fresh()}`, { cache: "no-store" });
    times.push(performance.now() - start);
    setProgress(((i + 1) / PING_COUNT) * 20);
  }
  times.shift(); // the first ping also opens the connection, so it is slower

  let diffs = 0;
  for (let i = 1; i < times.length; i++) diffs += Math.abs(times[i] - times[i - 1]);

  return { ping: median(times), jitter: diffs / (times.length - 1) };
}

// ===== 2. Download speed =====
async function measureDownload() {
  const speeds = [];
  for (let i = 0; i < DOWNLOAD_RUNS; i++) {
    const start = performance.now();
    const res = await fetch(`${API}/download?mb=${DOWNLOAD_MB}&${fresh()}`, { cache: "no-store" });
    const data = await res.arrayBuffer(); // wait until every byte has arrived
    const seconds = (performance.now() - start) / 1000;
    speeds.push(toMbps(data.byteLength, seconds));
    setProgress(20 + ((i + 1) / DOWNLOAD_RUNS) * 50);
  }
  speeds.shift(); // warm-up run (TCP slow start)
  return average(speeds);
}

// ===== 3. Upload speed =====
function randomBlob(mb) {
  const bytes = new Uint8Array(mb * 1024 * 1024);
  for (let i = 0; i < bytes.length; i += 65536) {
    crypto.getRandomValues(bytes.subarray(i, i + 65536)); // max 64 KB per call
  }
  return new Blob([bytes]);
}

async function measureUpload() {
  const blob = randomBlob(UPLOAD_MB);
  const speeds = [];
  for (let i = 0; i < UPLOAD_RUNS; i++) {
    const start = performance.now();
    const res = await fetch(`${API}/upload?${fresh()}`, { method: "POST", body: blob });
    const { received_bytes } = await res.json();
    const seconds = (performance.now() - start) / 1000;
    speeds.push(toMbps(received_bytes, seconds));
    setProgress(70 + ((i + 1) / UPLOAD_RUNS) * 30);
  }
  return average(speeds);
}

// ===== What the numbers mean for the user =====
function verdict({ ping, jitter, down }) {
  if (down >= 25 && ping < 50 && jitter < 15) return "Great: 4K streaming, gaming and video calls all work well.";
  if (down >= 10 && ping < 100) return "Good: HD streaming and video calls should be smooth.";
  if (down >= 3) return "OK for browsing and SD video. Video calls may stutter.";
  return "Slow: basic browsing and messaging only.";
}

// ===== History (saved in this browser) =====
function loadHistory() {
  try { return JSON.parse(localStorage.getItem("netcheck-history")) || []; }
  catch { return []; }
}

function saveResult(result) {
  const history = loadHistory();
  history.push({ ...result, time: new Date().toISOString() });
  try { localStorage.setItem("netcheck-history", JSON.stringify(history.slice(-20))); } catch {}
}

let chart;
function drawHistory() {
  const history = loadHistory();
  $("empty").hidden = history.length > 0;
  if (!window.Chart) return;
  const labels = history.map((r) => new Date(r.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
  const data = {
    labels,
    datasets: [
      { label: "Download (Mbps)", data: history.map((r) => r.down), borderColor: "#e60000", tension: 0.3 },
      { label: "Upload (Mbps)", data: history.map((r) => r.up), borderColor: "#3b6fd8", tension: 0.3 },
    ],
  };
  if (chart) { chart.data = data; chart.update(); return; }
  chart = new Chart($("chart"), { type: "line", data, options: { scales: { y: { beginAtZero: true } } } });
}

// ===== Page wiring =====
function setProgress(percent) { $("progress").style.width = percent + "%"; }
function show(id, value) { $(id).textContent = value.toFixed(id === "ping" || id === "jitter" ? 0 : 1); }

async function runTest() {
  $("start").disabled = true;
  ["ping", "jitter", "down", "up"].forEach((id) => ($(id).textContent = "–"));
  $("verdict").textContent = "";
  setProgress(0);
  try {
    $("status").textContent = "Measuring ping…";
    const { ping, jitter } = await measurePing();
    show("ping", ping); show("jitter", jitter);

    $("status").textContent = "Measuring download…";
    const down = await measureDownload();
    show("down", down);

    $("status").textContent = "Measuring upload…";
    const up = await measureUpload();
    show("up", up);

    const result = { ping, jitter, down, up };
    $("verdict").textContent = verdict(result);
    $("status").textContent = "Done.";
    saveResult(result);
    drawHistory();
  } catch (err) {
    $("status").textContent = "Could not reach the test server. Check that it is running and try again.";
    console.error(err);
  } finally {
    $("start").disabled = false;
  }
}

$("start").addEventListener("click", runTest);
$("clear").addEventListener("click", () => {
  try { localStorage.removeItem("netcheck-history"); } catch {}
  if (chart) { chart.destroy(); chart = null; }
  drawHistory();
});

// Connection type (Chrome/Edge/Android only)
if (navigator.connection && navigator.connection.effectiveType) {
 $("conn").textContent = `Browser speed class: ${navigator.connection.effectiveType} (a browser estimate, not your network type)`;
}
drawHistory();
