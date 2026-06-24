// server.js
const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 静的ファイルサーバーの設定（index.htmlを配信）
const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': filePath.endsWith('.html') ? 'text/html' : 'text/javascript' });
        res.end(fs.readFileSync(filePath));
    } else {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocketServer({ server });

// ★ 物理演算・ゲームルールの定数を最適化
const GRAVITY = 0.12;          // 適度な重力
const PROXIMITY_RADIUS = 40;  // 近接信管の作動半径
const BLAST_RADIUS = 60;      // 爆風の最大判定半径
const BULLET_SPEED = 18;      // 画面上空へしっかり届き、かつタイムラグを感じる速度

// ゲームの状態管理
let gameState = {
    target: { x: 0, y: 100, vx: 6, size: 20, alive: true }, // 高速化した敵機
    bullets: [],
    explosions: [], // 爆風配列
    gun: { x: 400, y: 550, angle: -Math.PI / 2 }
};

// メインゲームループ (60 FPS)
setInterval(() => {
    // 1. 敵機の移動
    if (gameState.target.alive) {
        gameState.target.x += gameState.target.vx;
        if (gameState.target.x > 800) gameState.target.x = 0; // 画面端でループ
    }

    // 2. 弾の移動と近接信管の判定
    gameState.bullets.forEach((bullet, index) => {
        // 重力を垂直速度（vy）に加算
        bullet.vy += GRAVITY;
        
        // 座標の更新
        bullet.x += bullet.vx;
        bullet.y += bullet.vy;

        // 近接信管（FLAK）の判定
        if (gameState.target.alive) {
            const dist = Math.hypot(bullet.x - gameState.target.x, bullet.y - gameState.target.y);
            
            // 敵機の中心から作動半径内に入ったら空中炸裂
            if (dist < PROXIMITY_RADIUS) {
                gameState.explosions.push({
                    x: bullet.x,
                    y: bullet.y,
                    radius: 10,
                    maxRadius: BLAST_RADIUS,
                    life: 20 // 20フレーム間存在
                });
                gameState.bullets.splice(index, 1); // 弾は消滅
                return;
            }
        }

        // ★ 画面外判定の修正：上空（y < -300）まで弾が消えずに進めるように変更
        // 地面に落ちた場合（y > 600）も削除判定から外し、より自由な弾道にします
        if (bullet.y < -300 || bullet.x < -100 || bullet.x > 900) {
            gameState.bullets.splice(index, 1);
        }
    });

    // 3. 爆風の更新と敵機へのダメージ判定
    gameState.explosions.forEach((exp, index) => {
        // 爆風の広がりを計算（イージング効果）
        exp.radius += (exp.maxRadius - exp.radius) * 0.1;
        exp.life--;

        // 爆風が敵機に触れているか判定
        if (gameState.target.alive) {
            const dist = Math.hypot(exp.x - gameState.target.x, exp.y - gameState.target.y);
            if (dist < exp.radius + gameState.target.size) {
                gameState.target.alive = false; // 撃墜
                // 2秒後にリスポーン
                setTimeout(() => { 
                    gameState.target.alive = true; 
                    gameState.target.x = 0; 
                }, 2000);
            }
        }

        // 寿命が尽きた爆風を削除
        if (exp.life <= 0) {
            gameState.explosions.splice(index, 1);
        }
    });

    // 最新のゲーム状態を全クライアントへ送信
    const data = JSON.stringify(gameState);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(data);
    });
}, 1000 / 60);

// クライアントからの操作の受信
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const command = JSON.parse(message);
        
        // 砲台の角度更新
        if (command.type === 'MOVE_GUN') {
            gameState.gun.angle = command.angle;
        }
        // 弾の発射
        if (command.type === 'FIRE') {
            gameState.bullets.push({
                x: gameState.gun.x + Math.cos(gameState.gun.angle) * 30,
                y: gameState.gun.y + Math.sin(gameState.gun.angle) * 30,
                vx: Math.cos(gameState.gun.angle) * BULLET_SPEED,
                vy: Math.sin(gameState.gun.angle) * BULLET_SPEED
            });
        }
    });
});

server.listen(3000, () => {
    console.log('シミュレーターサーバーが起動しました: http://localhost:3000');
});