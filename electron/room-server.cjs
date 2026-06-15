const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('socket.io');

const participantTemplate = fs.readFileSync(path.join(__dirname, 'participant.html'), 'utf8');
const characterAssets = new Map([
  ['hedgehog', 'godori-storybook.png'],
  ['cat', 'character-cat.png'],
  ['hamster', 'character-hamster.png'],
  ['rabbit', 'character-rabbit.png'],
]);

function createRoomServer(port = 4317) {
  const rooms = new Map();
  const server = http.createServer((request, response) => {
    const forwardedProtocol = request.headers['x-forwarded-proto'];
    const protocol = forwardedProtocol || (request.socket.encrypted ? 'https' : 'http');
    const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
    const url = new URL(request.url || '/', `${protocol}://${host}`);

    if (url.pathname === '/' || url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: true, service: 'focus-pet-room-server' }));
      return;
    }

    const assetMatch = url.pathname.match(/^\/character\/(hedgehog|cat|hamster|rabbit)\.png$/);
    if (assetMatch) {
      const filename = characterAssets.get(assetMatch[1]);
      const assetPath = path.join(__dirname, '..', 'assets', filename);
      response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
      fs.createReadStream(assetPath).pipe(response);
      return;
    }

    const match = url.pathname.match(/^\/join\/([A-Z0-9]{6})\/?$/i);
    if (!match) {
      response.writeHead(404).end('Not found');
      return;
    }
    const room = match[1].toUpperCase();
    const serverUrl = `${protocol}://${host}`;
    const installerUrl = process.env.FOCUS_PET_INSTALLER_URL
      || 'https://github.com/seolhee-choi/focus-timer/releases/latest/download/Focus-Pet-Setup.exe';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(participantTemplate
      .replaceAll('__ROOM__', room)
      .replaceAll('__SERVER__', serverUrl)
      .replaceAll('__INSTALLER_URL__', installerUrl));
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
