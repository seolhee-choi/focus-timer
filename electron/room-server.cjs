const http = require('node:http');
const { Server } = require('socket.io');

function createRoomServer(port = 4317) {
  const rooms = new Map();
  const server = http.createServer((request, response) => {
    const match = request.url?.match(/^\/join\/([A-Z0-9]{6})$/i);
    if (!match) {
      response.writeHead(404).end('Not found');
      return;
    }
    const room = match[1].toUpperCase();
    const serverUrl = `http://${request.headers.host}`;
    const deepLink = `focuspet://join?room=${room}&server=${encodeURIComponent(serverUrl)}`;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><meta charset="utf-8"><title>포커스 펫 초대</title><style>body{font-family:sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fffaf2;color:#342a25}.card{padding:28px;border-radius:18px;background:white;box-shadow:0 12px 40px #342a2520;text-align:center}a{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:10px;background:#df725f;color:white;text-decoration:none}</style><div class="card"><h2>포커스 펫 집중방</h2><p>방 코드: <strong>${room}</strong></p><a href="${deepLink}">앱으로 참여하기</a><p><small>포커스 펫 앱이 설치되어 있어야 합니다.</small></p></div>`);
  });
  const io = new Server(server, { cors: { origin: '*' } });

  function emitMembers(room) {
    const members = [...(rooms.get(room)?.values() || [])];
    io.to(room).emit('room:members', members);
  }

  io.on('connection', socket => {
    socket.on('room:join', ({ room, member }) => {
      const roomId = String(room || '').toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(roomId)) return;
      socket.join(roomId);
      socket.data.room = roomId;
      socket.data.memberId = member.id;
      if (!rooms.has(roomId)) rooms.set(roomId, new Map());
      rooms.get(roomId).set(member.id, member);
      emitMembers(roomId);
    });
    socket.on('member:update', member => {
      const room = socket.data.room;
      if (!room || !member?.id) return;
      rooms.get(room)?.set(member.id, member);
      emitMembers(room);
    });
    socket.on('disconnect', () => {
      const { room, memberId } = socket.data;
      if (!room || !memberId) return;
      rooms.get(room)?.delete(memberId);
      if (rooms.get(room)?.size === 0) rooms.delete(room);
      else emitMembers(room);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve({ server, io, port }));
  });
}

module.exports = { createRoomServer };

if (require.main === module) {
  const port = Number(process.env.PORT) || 4317;
  createRoomServer(port)
    .then(() => console.log(`Focus Pet room server listening on ${port}`))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
