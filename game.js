(() => {
  const ASSETS = {
    player: './sparkie_player.png',
    logo: './Value-Logo.png',
    coins: {
      heart: './coin_heart.png',
      wink: './coin_wink.png',
      token: './coin_token.png',
      card: './coin_card.png'
    }
  };

  const CONFIG = {
    width: 960,
    height: 540,
    laneCount: 3,
    groundY: 430,
    laneWidth: 170,
    laneStartX: 480 - 170,
    gravity: 2400,
    jumpVelocity: -900,
    speedStart: 320,
    speedRamp: 3.6,
    maxSpeed: 760,
    spawnCooldownMin: 0.75,
    spawnCooldownMax: 1.6,
    invulnDuration: 1.1,
    slideDuration: 0.65
  };

  const COIN_TYPES = [
    { kind: 'heart', value: 10, weight: 58 },
    { kind: 'wink', value: 30, weight: 24 },
    { kind: 'card', value: 50, weight: 13 },
    { kind: 'token', value: 100, weight: 5 }
  ];

  const OBSTACLE_TYPES = [
    { kind: 'block', style: 'standard', height: 90, width: 100, yOffset: 0 },
    { kind: 'barrier-low', style: 'jump', height: 48, width: 130, yOffset: 0 },
    { kind: 'barrier-high', style: 'slide', height: 130, width: 110, yOffset: 0 },
    { kind: 'car', style: 'car', height: 75, width: 140, yOffset: 0 }
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
    player: null,
    obstacles: [],
    collectibles: [],
    particles: [],
    hitFlash: 0,
    lanePulse: 0,
    spawnTimer: 0,
    elapsed: 0,
    countdown: 0,
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
    finalScore: document.getElementById('final-score'),
    finalDistance: document.getElementById('final-distance'),
    bestOver: document.getElementById('best-score-over'),
    newBest: document.getElementById('new-best'),
    countdown: document.getElementById('countdown'),
    pauseOverlay: document.getElementById('pause-overlay'),
    canvas: document.getElementById('game-canvas'),
    touchLeft: document.getElementById('touch-left'),
    touchRight: document.getElementById('touch-right'),
    touchUp: document.getElementById('touch-up'),
    touchDown: document.getElementById('touch-down')
  };

  const ctx = elements.canvas.getContext('2d');

  const audioCtx = window.AudioContext ? new AudioContext() : null;
  const images = {};

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
      ['coin-heart', ASSETS.coins.heart],
      ['coin-wink', ASSETS.coins.wink],
      ['coin-token', ASSETS.coins.token],
      ['coin-card', ASSETS.coins.card]
    ];

    for (const [key, src] of refs) {
      images[key] = await preloadImage(src);
    }
  }

  function laneX(lane) {
    return CONFIG.laneStartX + lane * CONFIG.laneWidth;
  }

  function resetRun() {
    state.score = 0;
    state.distance = 0;
    state.lives = 3;
    state.speed = CONFIG.speedStart;
    state.newBest = false;
    state.elapsed = 0;
    state.spawnTimer = 1.2;
    state.hitFlash = 0;
    state.lanePulse = 0;
    state.obstacles = [];
    state.collectibles = [];
    state.particles = [];
    state.player = {
      lane: 1,
      x: laneX(1),
      y: CONFIG.groundY,
      vy: 0,
      width: 112,
      height: 132,
      targetLaneX: laneX(1),
      isSliding: false,
      slideTimer: 0,
      invuln: 0,
      runAnim: 0,
      stepTimer: 0
    };
    refreshHud();
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

  function spawnPattern() {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    const difficulty = Math.min(1, state.elapsed / 120);
    const multiObstacleChance = 0.1 + difficulty * 0.35;
    const obstacleCount = Math.random() < multiObstacleChance ? 2 : 1;

    for (let i = 0; i < obstacleCount; i += 1) {
      const lane = lanes[i];
      const type = OBSTACLE_TYPES[(Math.random() * OBSTACLE_TYPES.length) | 0];
      state.obstacles.push({
        lane,
        x: laneX(lane),
        z: -320 - i * 140,
        width: type.width,
        height: type.height,
        style: type.style,
        kind: type.kind,
        hit: false
      });
    }

    const coinLane = lanes[(obstacleCount + ((Math.random() * 2) | 0)) % 3];
    const coinType = weightedPick(COIN_TYPES);
    state.collectibles.push({
      lane: coinLane,
      x: laneX(coinLane),
      z: -260,
      yOffset: 45 + Math.random() * 120,
      kind: coinType.kind,
      value: coinType.value,
      phase: Math.random() * Math.PI * 2,
      collected: false
    });
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
    elements.bestOver.textContent = String(state.bestScore);
    elements.bestStart.textContent = String(state.bestScore);
    elements.newBest.classList.toggle('hidden', !state.newBest);
    switchScreen(elements.overScreen);
  }

  function refreshHud() {
    elements.score.textContent = Math.floor(state.score);
    elements.distance.textContent = `${Math.floor(state.distance)}m`;
    elements.lives.textContent = String(state.lives);
    elements.bestStart.textContent = String(state.bestScore);
  }

  function drawBackground(time) {
    const g = ctx.createLinearGradient(0, 0, 0, CONFIG.height);
    g.addColorStop(0, '#121821');
    g.addColorStop(0.55, '#161616');
    g.addColorStop(1, '#0f0f0f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);

    for (let i = 0; i < 18; i += 1) {
      const x = (i * 120 + (time * 20) % 1200) % 1200 - 100;
      const h = 80 + ((i * 31) % 180);
      ctx.fillStyle = i % 2 ? 'rgba(87,190,177,0.10)' : 'rgba(239,95,23,0.08)';
      ctx.fillRect(x, 150 - h * 0.3, 50, h);
    }

    const roadTopW = 250;
    const roadBottomW = 820;
    const topY = 150;
    const bottomY = CONFIG.height;
    const center = CONFIG.width / 2;

    ctx.beginPath();
    ctx.moveTo(center - roadTopW / 2, topY);
    ctx.lineTo(center + roadTopW / 2, topY);
    ctx.lineTo(center + roadBottomW / 2, bottomY);
    ctx.lineTo(center - roadBottomW / 2, bottomY);
    ctx.closePath();
    const road = ctx.createLinearGradient(0, topY, 0, bottomY);
    road.addColorStop(0, '#2c2c2c');
    road.addColorStop(1, '#191919');
    ctx.fillStyle = road;
    ctx.fill();

    const laneDashSpeed = (state.distance * 2.4) % 70;
    for (let l = 1; l < CONFIG.laneCount; l += 1) {
      const ratio = l / CONFIG.laneCount;
      const topX = center - roadTopW / 2 + roadTopW * ratio;
      const bottomX = center - roadBottomW / 2 + roadBottomW * ratio;
      ctx.strokeStyle = 'rgba(87,190,177,0.35)';
      ctx.lineWidth = 2;
      for (let y = topY + laneDashSpeed; y < bottomY; y += 70) {
        const y2 = Math.min(y + 35, bottomY);
        const t1 = (y - topY) / (bottomY - topY);
        const t2 = (y2 - topY) / (bottomY - topY);
        const x1 = topX + (bottomX - topX) * t1;
        const x2 = topX + (bottomX - topX) * t2;
        ctx.beginPath();
        ctx.moveTo(x1, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    for (let i = 0; i < 16; i += 1) {
      const sideY = ((i * 68 + state.distance * 5) % 700) - 120;
      const alpha = 0.25 + (i % 3) * 0.1;
      ctx.fillStyle = `rgba(239,95,23,${alpha})`;
      ctx.fillRect(40 + (i % 3) * 15, sideY, 10, 40);
      ctx.fillRect(CONFIG.width - 50 - (i % 3) * 15, sideY, 10, 40);
    }
  }

  function project(z, lane, size = 100) {
    const topY = 140;
    const bottomY = CONFIG.height;
    const t = Math.max(0, Math.min(1, z / CONFIG.height));
    const perspective = t * t;
    const roadTopW = 250;
    const roadBottomW = 820;
    const center = CONFIG.width / 2;
    const y = topY + (bottomY - topY) * perspective;
    const laneCenterTop = center - roadTopW / 2 + ((lane + 0.5) / 3) * roadTopW;
    const laneCenterBottom = center - roadBottomW / 2 + ((lane + 0.5) / 3) * roadBottomW;
    const x = laneCenterTop + (laneCenterBottom - laneCenterTop) * perspective;
    const scale = 0.35 + perspective * 1.4;
    return { x, y, scale, size: size * scale };
  }

  function drawPlayer(dt) {
    const p = state.player;
    p.runAnim += dt * 8;
    p.x += (p.targetLaneX - p.x) * Math.min(1, dt * 12);
    p.vy += CONFIG.gravity * dt;
    p.y += p.vy * dt;
    if (p.y >= CONFIG.groundY) {
      p.y = CONFIG.groundY;
      p.vy = 0;
    }

    if (p.isSliding) {
      p.slideTimer -= dt;
      if (p.slideTimer <= 0) p.isSliding = false;
    }

    if (p.invuln > 0) p.invuln -= dt;

    const bounce = Math.sin(p.runAnim * 2.5) * 6;
    const tilt = (p.targetLaneX - p.x) * 0.0009 + (p.y < CONFIG.groundY ? -0.08 : 0.06);
    const h = p.isSliding ? p.height * 0.62 : p.height;
    const y = p.y - h + bounce;
    const stride = Math.sin(p.runAnim * 5.8);

    if (state.mode === 'playing' && p.y >= CONFIG.groundY - 1 && !p.isSliding) {
      p.stepTimer -= dt;
      if (p.stepTimer <= 0) {
        p.stepTimer = 0.085;
        state.particles.push({
          x: p.x + stride * 12,
          y: p.y + 2,
          vx: (Math.random() - 0.5) * 60,
          vy: -20 - Math.random() * 30,
          life: 0.18,
          color: '#ef5f17'
        });
      }
    }

    ctx.save();
    ctx.translate(p.x, y + h * 0.5);
    ctx.rotate(tilt);
    const blink = p.invuln > 0 && Math.floor(p.invuln * 15) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.55;

    const sprite = images.player;
    ctx.globalAlpha *= 0.24;
    ctx.fillStyle = '#57beb1';
    ctx.fillRect(-p.width * 0.22, h * 0.28, p.width * 0.44, 10);
    ctx.globalAlpha /= 0.24;
    if (sprite?.ok) {
      const squeezeY = p.isSliding ? 0.9 : 0.96 + Math.abs(stride) * 0.08;
      const stretchX = p.isSliding ? 1.08 : 1.01 - Math.abs(stride) * 0.08;
      ctx.scale(stretchX, squeezeY);
      ctx.drawImage(sprite.img, -p.width / 2, -h / 2, p.width, h);
    } else {
      ctx.fillStyle = '#ef5f17';
      ctx.fillRect(-p.width / 2, -h / 2, p.width, h);
      ctx.strokeStyle = '#fff';
      ctx.strokeRect(-p.width / 2, -h / 2, p.width, h);
    }
    ctx.restore();

    return { x: p.x, y: y + h * 0.45, w: p.width * 0.6, h: h * 0.9 };
  }

  function drawObstacle(ob) {
    const pr = project(ob.z, ob.lane, ob.width);
    const w = ob.width * pr.scale;
    const h = ob.height * pr.scale;
    const y = pr.y - h;

    ctx.save();
    if (ob.kind === 'car') {
      ctx.fillStyle = '#ef5f17';
      ctx.fillRect(pr.x - w / 2, y + h * 0.2, w, h * 0.8);
      ctx.fillStyle = '#57beb1';
      ctx.fillRect(pr.x - w * 0.28, y, w * 0.56, h * 0.35);
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(pr.x - w * 0.28, y + h * 0.95, h * 0.13, 0, Math.PI * 2);
      ctx.arc(pr.x + w * 0.28, y + h * 0.95, h * 0.13, 0, Math.PI * 2);
      ctx.fill();
    } else if (ob.style === 'slide') {
      ctx.fillStyle = '#57beb1';
      ctx.fillRect(pr.x - w / 2, y, w, h);
      ctx.fillStyle = 'rgba(30,30,30,0.8)';
      ctx.fillRect(pr.x - w / 2 + 8, y + 12, w - 16, h - 24);
    } else if (ob.style === 'jump') {
      ctx.fillStyle = '#ef5f17';
      ctx.fillRect(pr.x - w / 2, y + h * 0.55, w, h * 0.45);
      ctx.fillStyle = '#111';
      ctx.fillRect(pr.x - w / 2 + 8, y + h * 0.65, w - 16, h * 0.18);
    } else {
      ctx.fillStyle = '#303030';
      ctx.fillRect(pr.x - w / 2, y, w, h);
      ctx.strokeStyle = '#57beb1';
      ctx.strokeRect(pr.x - w / 2 + 2, y + 2, w - 4, h - 4);
    }
    ctx.restore();

    ob.screen = { x: pr.x, y: y + h * 0.5, w, h };
  }

  function drawCoin(coin, dt) {
    coin.phase += dt * 3.7;
    const pr = project(coin.z, coin.lane, 60);
    const lift = Math.sin(coin.phase) * 7;
    const size = pr.size * 0.72;
    const y = pr.y - coin.yOffset * pr.scale - lift;

    ctx.save();
    ctx.translate(pr.x, y);
    ctx.scale(Math.abs(Math.cos(coin.phase * 1.4)), 1);
    const key = `coin-${coin.kind}`;
    const sprite = images[key];
    if (sprite?.ok) {
      ctx.drawImage(sprite.img, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = '#ef5f17';
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    coin.screen = { x: pr.x, y, w: size * 0.7, h: size * 0.7 };
  }

  function spawnPickupParticles(x, y, color) {
    for (let i = 0; i < 10; i += 1) {
      state.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 220,
        vy: -90 - Math.random() * 140,
        life: 0.6 + Math.random() * 0.4,
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
      ctx.fillStyle = `${p.color}${Math.max(0, Math.min(255, Math.floor((p.life / 0.9) * 255))).toString(16).padStart(2, '0')}`;
      ctx.fillRect(p.x, p.y, 4, 4);
    }
    state.particles = state.particles.filter((p) => p.life > 0);
  }

  function overlaps(a, b) {
    return Math.abs(a.x - b.x) < (a.w + b.w) * 0.5 && Math.abs(a.y - b.y) < (a.h + b.h) * 0.5;
  }

  function updateGame(dt, ts) {
    if (state.mode !== 'playing') return;

    state.elapsed += dt;
    state.speed = Math.min(CONFIG.maxSpeed, CONFIG.speedStart + state.elapsed * CONFIG.speedRamp);
    state.distance += (state.speed * dt) / 22;
    state.score += dt * 11 + state.speed * dt * 0.06;

    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const difficulty = Math.min(1, state.elapsed / 120);
      spawnPattern();
      const minCooldown = CONFIG.spawnCooldownMin - difficulty * 0.25;
      const maxCooldown = CONFIG.spawnCooldownMax - difficulty * 0.45;
      state.spawnTimer = minCooldown + Math.random() * Math.max(0.25, (maxCooldown - minCooldown));
    }

    for (const ob of state.obstacles) ob.z += state.speed * dt;
    for (const c of state.collectibles) c.z += state.speed * dt;
    state.obstacles = state.obstacles.filter((o) => o.z < CONFIG.height + 260);
    state.collectibles = state.collectibles.filter((c) => c.z < CONFIG.height + 220 && !c.collected);

    drawBackground(ts / 1000);
    const playerBox = drawPlayer(dt);

    const items = [...state.obstacles, ...state.collectibles].sort((a, b) => a.z - b.z);
    for (const item of items) {
      if ('value' in item) drawCoin(item, dt);
      else drawObstacle(item);
    }

    const interactMinZ = CONFIG.height * 0.45;
    const interactMaxZ = CONFIG.height + 20;

    for (const coin of state.collectibles) {
      if (!coin.screen || coin.collected) continue;
      if (coin.z < interactMinZ || coin.z > interactMaxZ) continue;
      if (overlaps(playerBox, coin.screen)) {
        coin.collected = true;
        state.score += coin.value;
        spawnPickupParticles(coin.screen.x, coin.screen.y, '#57beb1');
        playBeep('pickup');
      }
    }

    for (const ob of state.obstacles) {
      if (!ob.screen || ob.hit) continue;
      if (ob.z < interactMinZ || ob.z > interactMaxZ) continue;
      const playerIsAirborne = state.player.y < CONFIG.groundY - 26;
      const jumpClearsObstacle = ob.style === 'jump' && playerIsAirborne;
      const slideClearsObstacle = ob.style === 'slide' && state.player.isSliding;
      if (jumpClearsObstacle || slideClearsObstacle) continue;
      if (overlaps(playerBox, ob.screen) && state.player.invuln <= 0) {
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
    if (state.mode === 'playing') updateGame(dt, ts);
    else if (state.mode === 'countdown' || state.mode === 'paused') {
      drawBackground(ts / 1000);
      drawPlayer(dt);
    }
    state.raf = requestAnimationFrame(gameLoop);
  }

  function moveLane(dir) {
    if (state.mode !== 'playing' && state.mode !== 'countdown') return;
    const p = state.player;
    p.lane = Math.max(0, Math.min(2, p.lane + dir));
    p.targetLaneX = laneX(p.lane);
  }

  function jump() {
    if (state.mode !== 'playing') return;
    const p = state.player;
    if (p.y >= CONFIG.groundY - 1) {
      p.vy = CONFIG.jumpVelocity;
      p.isSliding = false;
    }
  }

  function slide() {
    if (state.mode !== 'playing') return;
    const p = state.player;
    if (p.y >= CONFIG.groundY - 2) {
      p.isSliding = true;
      p.slideTimer = CONFIG.slideDuration;
    }
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
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's', 'p'].includes(key)) e.preventDefault();

    if (key === 'arrowleft' || key === 'a') moveLane(-1);
    if (key === 'arrowright' || key === 'd') moveLane(1);
    if (key === 'arrowup' || key === 'w') jump();
    if (key === 'arrowdown' || key === 's') slide();
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
      } else if (dy < 0) jump();
      else slide();
    });
  }

  function init() {
    elements.bestStart.textContent = String(state.bestScore);
    elements.bestOver.textContent = String(state.bestScore);
    elements.startBtn.addEventListener('click', startGame);
    elements.restartBtn.addEventListener('click', startGame);
    elements.pauseBtn.addEventListener('click', togglePause);
    elements.muteBtn.addEventListener('click', () => {
      state.muted = !state.muted;
      elements.muteBtn.textContent = state.muted ? 'Unmute' : 'Mute';
    });
    elements.touchLeft.addEventListener('click', () => moveLane(-1));
    elements.touchRight.addEventListener('click', () => moveLane(1));
    elements.touchUp.addEventListener('click', jump);
    elements.touchDown.addEventListener('click', slide);
    window.addEventListener('keydown', onKey);
    bindTouchGestures();

    loadAssets().then(() => {
      resetRun();
      drawBackground(0);
      drawPlayer(0.016);
      state.lastTs = performance.now();
      state.raf = requestAnimationFrame(gameLoop);
    });
  }

  init();
})();
