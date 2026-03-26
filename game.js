(() => {
  // =============================
  // Load assets
  // =============================
  const ASSETS = {
    player: './73F05081-9F04-4B35-BAAB-B9B2264F2C0B.png',
    logo: './Value-Logo.png',
    road: './EEC65DAE-6D07-4C4D-890F-12783BE4814A.png',
    coins: {
      heart: './coin_heart.png',
      wink: './coin_wink.png',
      token: './coin_token.png',
      card: './coin_card.png'
    }
  };

  // =============================
  // Game variables
  // =============================
  const CONFIG = {
    width: 960,
    height: 540,
    laneCount: 3,
    horizonY: 78,
    roadTopW: 250,
    roadBottomW: 860,
    playerY: 472,
    speedStart: 320,
    speedRamp: 4.5,
    maxSpeed: 860,
    spawnCooldownMin: 0.65,
    spawnCooldownMax: 1.4,
    invulnDuration: 1.1
  };

  const COIN_TYPES = [
    { kind: 'heart', value: 10, weight: 58 },
    { kind: 'wink', value: 30, weight: 24 },
    { kind: 'card', value: 50, weight: 13 },
    { kind: 'token', value: 100, weight: 5 }
  ];

  const OBSTACLE_TYPES = [
    { kind: 'car', width: 128, height: 78, color: '#ef5f17', weight: 48 },
    { kind: 'bus', width: 142, height: 120, color: '#57beb1', weight: 24 },
    { kind: 'cone', width: 74, height: 84, color: '#f4a261', weight: 28 }
  ];

  const state = {
    mode: 'start',
    muted: false,
    score: 0,
    distance: 0,
    lives: 3,
    speed: CONFIG.speedStart,
    bestScore: Number(localStorage.getItem('sparkieRushBest') || 0),
    newBest: false,
    playerName: localStorage.getItem('sparkieRushName') || 'Sparkie Runner',
    player: null,
    obstacles: [],
    collectibles: [],
    particles: [],
    spawnTimer: 0,
    elapsed: 0,
    countdown: 0,
    backgroundOffset: 0,
    hitFlash: 0,
    raf: 0,
    lastTs: 0
  };

  const elements = {
    startScreen: document.getElementById('start-screen'),
    gameScreen: document.getElementById('game-screen'),
    overScreen: document.getElementById('game-over-screen'),
    startBtn: document.getElementById('start-btn'),
    restartBtn: document.getElementById('restart-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    muteBtn: document.getElementById('mute-btn'),
    score: document.getElementById('score'),
    distance: document.getElementById('distance'),
    lives: document.getElementById('lives'),
    bestStart: document.getElementById('best-score-start'),
    playerNameInput: document.getElementById('player-name'),
    hudPlayer: document.getElementById('hud-player'),
    finalScore: document.getElementById('final-score'),
    finalDistance: document.getElementById('final-distance'),
    finalPlayer: document.getElementById('final-player'),
    bestOver: document.getElementById('best-score-over'),
    newBest: document.getElementById('new-best'),
    countdown: document.getElementById('countdown'),
    pauseOverlay: document.getElementById('pause-overlay'),
    canvas: document.getElementById('game-canvas'),
    touchLeft: document.getElementById('touch-left'),
    touchRight: document.getElementById('touch-right'),
    touchUp: document.getElementById('touch-up'),
    touchDown: document.getElementById('touch-down'),
    homeBtn: document.getElementById('home-btn')
  };

  const ctx = elements.canvas.getContext('2d');
  const images = {};
  const audioCtx = window.AudioContext ? new AudioContext() : null;

  function switchScreen(target) {
    [elements.startScreen, elements.gameScreen, elements.overScreen].forEach((el) => el.classList.remove('active'));
    target.classList.add('active');
  }

  function preloadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ ok: true, img });
      img.onerror = () => resolve({ ok: false, img: null });
      img.src = src;
    });
  }

  async function loadAssets() {
    const refs = [
      ['player', ASSETS.player],
      ['road', ASSETS.road],
      ['coin-heart', ASSETS.coins.heart],
      ['coin-wink', ASSETS.coins.wink],
      ['coin-token', ASSETS.coins.token],
      ['coin-card', ASSETS.coins.card]
    ];

    for (const [key, src] of refs) {
      images[key] = await preloadImage(src);
    }
  }

  function weightedPick(entries) {
    const sum = entries.reduce((acc, e) => acc + e.weight, 0);
    let n = Math.random() * sum;
    for (const e of entries) {
      n -= e.weight;
      if (n <= 0) return e;
    }
    return entries[0];
  }

  function refreshHud() {
    elements.score.textContent = Math.floor(state.score);
    elements.distance.textContent = `${Math.floor(state.distance)}m`;
    elements.lives.textContent = String(state.lives);
    elements.bestStart.textContent = String(state.bestScore);
  }

  function laneCenterAtY(lane, y) {
    const t = Math.max(0, Math.min(1, (y - CONFIG.horizonY) / (CONFIG.height - CONFIG.horizonY)));
    const roadWidth = CONFIG.roadTopW + (CONFIG.roadBottomW - CONFIG.roadTopW) * t;
    const left = CONFIG.width / 2 - roadWidth / 2;
    return left + ((lane + 0.5) / CONFIG.laneCount) * roadWidth;
  }

  function scaleForY(y) {
    const t = Math.max(0, Math.min(1, (y - CONFIG.horizonY) / (CONFIG.height - CONFIG.horizonY)));
    return 0.4 + t * 1.05;
  }

  function resetRun() {
    state.score = 0;
    state.distance = 0;
    state.lives = 3;
    state.speed = CONFIG.speedStart;
    state.newBest = false;
    state.elapsed = 0;
    state.spawnTimer = 1;
    state.backgroundOffset = 0;
    state.hitFlash = 0;
    state.obstacles = [];
    state.collectibles = [];
    state.particles = [];
    state.player = {
      lane: 1,
      targetLane: 1,
      x: laneCenterAtY(1, CONFIG.playerY),
      width: 128,
      height: 188,
      invuln: 0,
      runAnim: 0
    };
    refreshHud();
  }

  function playBeep(type = 'pickup') {
    if (state.muted || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type === 'hit' ? 'square' : 'triangle';
    osc.frequency.value = type === 'hit' ? 180 : type === 'over' ? 120 : 680;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    gain.gain.exponentialRampToValueAtTime(type === 'hit' ? 0.11 : 0.07, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  function spawnPattern() {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const difficulty = Math.min(1, state.elapsed / 130);
    const obstacleCount = Math.random() < 0.16 + difficulty * 0.34 ? 2 : 1;

    for (let i = 0; i < obstacleCount; i += 1) {
      const lane = lanes[i];
      const type = weightedPick(OBSTACLE_TYPES);
      state.obstacles.push({
        lane,
        y: -100 - i * 140,
        width: type.width,
        height: type.height,
        color: type.color,
        kind: type.kind,
        hit: false
      });
    }

    const coinLane = lanes[(obstacleCount + ((Math.random() * 2) | 0)) % 3];
    const coinType = weightedPick(COIN_TYPES);
    state.collectibles.push({
      lane: coinLane,
      y: -130,
      width: 52,
      height: 52,
      kind: coinType.kind,
      value: coinType.value,
      phase: Math.random() * Math.PI * 2,
      collected: false
    });
  }

  // =============================
  // Background scrolling
  // =============================
  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, CONFIG.height);
    sky.addColorStop(0, '#0f172a');
    sky.addColorStop(1, '#020617');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);

    const roadSprite = images.road;
    const h = CONFIG.height;
    const y1 = state.backgroundOffset - h;
    const y2 = state.backgroundOffset;

    if (roadSprite?.ok) {
      ctx.drawImage(roadSprite.img, 0, y1, CONFIG.width, h);
      ctx.drawImage(roadSprite.img, 0, y2, CONFIG.width, h);
    } else {
      const fallback = ctx.createLinearGradient(0, 0, 0, CONFIG.height);
      fallback.addColorStop(0, '#1f2937');
      fallback.addColorStop(1, '#111827');
      ctx.fillStyle = fallback;
      ctx.fillRect(0, y1, CONFIG.width, h);
      ctx.fillRect(0, y2, CONFIG.width, h);
    }

    // subtle lane guides on top of road image
    for (let l = 1; l < CONFIG.laneCount; l += 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 2;
      for (let y = CONFIG.horizonY; y < CONFIG.height; y += 52) {
        const y2Dash = Math.min(CONFIG.height, y + 24);
        const x1 = laneCenterAtY(l - 0.5, y);
        const x2 = laneCenterAtY(l - 0.5, y2Dash);
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y2Dash);
        ctx.stroke();
      }
    }
  }

  // =============================
  // Lane system
  // =============================
  function moveLane(dir) {
    if (state.mode !== 'playing' && state.mode !== 'countdown') return;
    const p = state.player;
    p.targetLane = Math.max(0, Math.min(2, p.targetLane + dir));
  }

  // =============================
  // Object movement + drawing
  // =============================
  function drawPlayer(dt) {
    const p = state.player;
    p.runAnim += dt * 10;
    const targetX = laneCenterAtY(p.targetLane, CONFIG.playerY);
    p.x += (targetX - p.x) * Math.min(1, dt * 14);
    p.lane = Math.round((p.x - laneCenterAtY(0, CONFIG.playerY)) / (laneCenterAtY(2, CONFIG.playerY) - laneCenterAtY(0, CONFIG.playerY)) * 2);
    p.lane = Math.max(0, Math.min(2, p.lane));

    if (p.invuln > 0) p.invuln -= dt;

    const scale = 1.03;
    const w = p.width * scale;
    const h = p.height * scale;
    const stride = Math.sin(p.runAnim * 9.5);
    const bob = Math.sin(p.runAnim * 5.6) * 6;
    const y = CONFIG.playerY - h + bob;

    if (state.mode === 'playing' && Math.random() < 0.55) {
      state.particles.push({
        x: p.x + stride * 10,
        y: CONFIG.playerY - 2,
        vx: -40 + Math.random() * 80,
        vy: -20 - Math.random() * 40,
        life: 0.2,
        color: '#cbd5e1'
      });
    }

    ctx.save();
    const blink = p.invuln > 0 && Math.floor(p.invuln * 14) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.55;

    const sprite = images.player;
    ctx.shadowColor = 'rgba(239,95,23,0.35)';
    ctx.shadowBlur = 18;
    if (sprite?.ok) {
      ctx.translate(p.x, y + h * 0.5);
      ctx.scale(1 + stride * 0.015, 1 - Math.abs(stride) * 0.03);
      ctx.drawImage(sprite.img, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = '#ef5f17';
      ctx.fillRect(p.x - w / 2, y, w, h);
    }
    ctx.restore();

    return { x: p.x, y: y + h * 0.5, w: w * 0.5, h: h * 0.86 };
  }

  function drawObstacle(ob) {
    const scale = scaleForY(ob.y);
    const w = ob.width * scale;
    const h = ob.height * scale;
    const x = laneCenterAtY(ob.lane, ob.y);
    const y = ob.y - h;

    ctx.save();
    if (ob.kind === 'car') {
      ctx.fillStyle = ob.color;
      ctx.fillRect(x - w / 2, y + h * 0.24, w, h * 0.76);
      ctx.fillStyle = '#111827';
      ctx.fillRect(x - w * 0.24, y + h * 0.08, w * 0.48, h * 0.35);
    } else if (ob.kind === 'bus') {
      ctx.fillStyle = ob.color;
      ctx.fillRect(x - w / 2, y, w, h);
      ctx.fillStyle = '#111827';
      ctx.fillRect(x - w * 0.4, y + h * 0.2, w * 0.8, h * 0.2);
      ctx.fillRect(x - w * 0.4, y + h * 0.5, w * 0.8, h * 0.16);
    } else {
      ctx.fillStyle = ob.color;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - w * 0.5, y + h);
      ctx.lineTo(x + w * 0.5, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff7ed';
      ctx.fillRect(x - w * 0.17, y + h * 0.42, w * 0.34, h * 0.18);
    }
    ctx.restore();

    ob.screen = { x, y: y + h * 0.5, w: w * 0.8, h: h * 0.8 };
  }

  function drawCoin(coin, dt) {
    coin.phase += dt * 3.9;
    const scale = scaleForY(coin.y) * 0.7;
    const x = laneCenterAtY(coin.lane, coin.y);
    const y = coin.y - Math.sin(coin.phase) * 6;
    const size = coin.width * scale;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(Math.abs(Math.cos(coin.phase * 1.5)), 1);
    const sprite = images[`coin-${coin.kind}`];
    if (sprite?.ok) {
      ctx.drawImage(sprite.img, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    coin.screen = { x, y, w: size * 0.64, h: size * 0.64 };
  }

  function spawnPickupParticles(x, y, color) {
    for (let i = 0; i < 10; i += 1) {
      state.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 220,
        vy: -100 - Math.random() * 120,
        life: 0.55 + Math.random() * 0.35,
        color
      });
    }
  }

  function updateParticles(dt) {
    for (const p of state.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 380 * dt;
      const alphaHex = Math.max(0, Math.min(255, Math.floor((p.life / 0.9) * 255))).toString(16).padStart(2, '0');
      ctx.fillStyle = `${p.color}${alphaHex}`;
      ctx.fillRect(p.x, p.y, 4, 4);
    }
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  // =============================
  // Collision detection
  // =============================
  function overlaps(a, b) {
    return Math.abs(a.x - b.x) < (a.w + b.w) * 0.5 && Math.abs(a.y - b.y) < (a.h + b.h) * 0.5;
  }

  // =============================
  // Game loop
  // =============================
  function updateGame(dt) {
    if (state.mode !== 'playing') return;

    state.elapsed += dt;
    state.speed = Math.min(CONFIG.maxSpeed, CONFIG.speedStart + state.elapsed * CONFIG.speedRamp);
    state.distance += (state.speed * dt) / 22;
    state.score += dt * 12 + state.speed * dt * 0.065;

    state.backgroundOffset = 0;

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const difficulty = Math.min(1, state.elapsed / 120);
      spawnPattern();
      const minCooldown = CONFIG.spawnCooldownMin - difficulty * 0.22;
      const maxCooldown = CONFIG.spawnCooldownMax - difficulty * 0.36;
      state.spawnTimer = minCooldown + Math.random() * Math.max(0.24, maxCooldown - minCooldown);
    }

    for (const ob of state.obstacles) ob.y += state.speed * dt * 0.62;
    for (const c of state.collectibles) c.y += state.speed * dt * 0.62;
    state.obstacles = state.obstacles.filter((o) => o.y < CONFIG.height + 160);
    state.collectibles = state.collectibles.filter((c) => c.y < CONFIG.height + 140 && !c.collected);

    drawBackground();
    const playerBox = drawPlayer(dt);

    const items = [...state.obstacles, ...state.collectibles].sort((a, b) => a.y - b.y);
    for (const item of items) {
      if ('value' in item) drawCoin(item, dt);
      else drawObstacle(item);
    }

    for (const coin of state.collectibles) {
      if (!coin.screen || coin.collected) continue;
      if (!overlaps(playerBox, coin.screen)) continue;
      coin.collected = true;
      state.score += coin.value;
      spawnPickupParticles(coin.screen.x, coin.screen.y, '#57beb1');
      playBeep('pickup');
    }

    for (const ob of state.obstacles) {
      if (!ob.screen || ob.hit) continue;
      if (!overlaps(playerBox, ob.screen)) continue;
      if (state.player.invuln > 0) continue;
      ob.hit = true;
      state.lives -= 1;
      state.player.invuln = CONFIG.invulnDuration;
      state.hitFlash = 0.25;
      playBeep('hit');

      if (state.lives <= 0) {
        refreshHud();
        endRun();
        return;
      }
    }

    updateParticles(dt);

    if (state.hitFlash > 0) {
      state.hitFlash -= dt;
      ctx.fillStyle = 'rgba(239,95,23,0.25)';
      ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
    }

    refreshHud();
  }

  function gameLoop(ts) {
    const dt = Math.min((ts - state.lastTs) / 1000 || 0.016, 0.033);
    state.lastTs = ts;

    if (state.mode === 'playing') {
      updateGame(dt);
    } else if (state.mode === 'countdown' || state.mode === 'paused') {
      state.backgroundOffset = 0;
      drawBackground();
      drawPlayer(dt);
    }

    state.raf = requestAnimationFrame(gameLoop);
  }

  function beginCountdown() {
    state.countdown = 3;
    elements.countdown.classList.remove('hidden');
    elements.countdown.textContent = '3';
    const interval = setInterval(() => {
      state.countdown -= 1;
      if (state.countdown > 0) {
        elements.countdown.textContent = String(state.countdown);
      } else if (state.countdown === 0) {
        elements.countdown.textContent = 'GO!';
      } else {
        clearInterval(interval);
        elements.countdown.classList.add('hidden');
        state.mode = 'playing';
      }
    }, 650);
  }

  function startGame() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    const inputName = (elements.playerNameInput.value || '').trim();
    state.playerName = inputName || state.playerName || 'Sparkie Runner';
    localStorage.setItem('sparkieRushName', state.playerName);
    elements.hudPlayer.textContent = state.playerName;

    resetRun();
    state.mode = 'countdown';
    switchScreen(elements.gameScreen);
    beginCountdown();
  }

  function endRun() {
    state.mode = 'over';
    cancelAnimationFrame(state.raf);
    playBeep('over');

    if (state.score > state.bestScore) {
      state.bestScore = Math.floor(state.score);
      localStorage.setItem('sparkieRushBest', String(state.bestScore));
      state.newBest = true;
    }

    elements.finalScore.textContent = Math.floor(state.score);
    elements.finalDistance.textContent = `${Math.floor(state.distance)}m`;
    elements.finalPlayer.textContent = state.playerName;
    elements.bestOver.textContent = String(state.bestScore);
    elements.bestStart.textContent = String(state.bestScore);
    elements.newBest.classList.toggle('hidden', !state.newBest);
    switchScreen(elements.overScreen);
  }

  function togglePause() {
    if (state.mode !== 'playing' && state.mode !== 'paused') return;
    if (state.mode === 'paused') {
      state.mode = 'playing';
      elements.pauseOverlay.classList.add('hidden');
      elements.pauseBtn.textContent = 'Pause';
    } else {
      state.mode = 'paused';
      elements.pauseOverlay.classList.remove('hidden');
      elements.pauseBtn.textContent = 'Resume';
    }
  }

  function onKey(e) {
    const key = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'a', 'd', 'p'].includes(key)) e.preventDefault();

    if (key === 'arrowleft' || key === 'a') moveLane(-1);
    if (key === 'arrowright' || key === 'd') moveLane(1);
    if (key === 'p') togglePause();
  }

  function bindTouchGestures() {
    let startX = 0;
    let startY = 0;
    let touchActive = false;
    const threshold = 32;

    elements.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      touchActive = true;
      startX = e.clientX;
      startY = e.clientY;
    });

    elements.canvas.addEventListener('pointerup', (e) => {
      if (!touchActive || e.pointerType !== 'touch') return;
      touchActive = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) moveLane(1);
        else moveLane(-1);
      }
    });
  }

  function init() {
    elements.bestStart.textContent = String(state.bestScore);
    elements.bestOver.textContent = String(state.bestScore);
    elements.playerNameInput.value = state.playerName;
    elements.hudPlayer.textContent = state.playerName;

    elements.startBtn.addEventListener('click', startGame);
    elements.restartBtn.addEventListener('click', startGame);
    elements.homeBtn.addEventListener('click', () => {
      state.mode = 'start';
      switchScreen(elements.startScreen);
    });
    elements.pauseBtn.addEventListener('click', togglePause);
    elements.muteBtn.addEventListener('click', () => {
      state.muted = !state.muted;
      elements.muteBtn.textContent = state.muted ? 'Unmute' : 'Mute';
    });

    elements.touchLeft.addEventListener('click', () => moveLane(-1));
    elements.touchRight.addEventListener('click', () => moveLane(1));
    elements.touchUp.addEventListener('click', () => {});
    elements.touchDown.addEventListener('click', () => {});

    window.addEventListener('keydown', onKey);
    bindTouchGestures();

    loadAssets().then(() => {
      resetRun();
      drawBackground();
      drawPlayer(0.016);
      state.lastTs = performance.now();
      state.raf = requestAnimationFrame(gameLoop);
    });
  }

  init();
})();
