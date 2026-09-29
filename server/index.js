import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 3001);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '123456';
const OPERATOR_USER = process.env.OPERATOR_USER || 'urna';
const OPERATOR_PASS = process.env.OPERATOR_PASS || '123456';
const VOTE_COOLDOWN_MS = 30_000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true }
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '3mb' }));

const state = {
  candidates: [],
  election: {
    status: 'not_started',
    startedAt: null,
    finalizedAt: null,
    totalVotes: 0,
    blankVotes: 0,
    nullVotes: 0,
    votes: {}
  },
  lastVoteAt: null
};

const sessions = new Map();

function publicState() {
  return JSON.parse(JSON.stringify({
    candidates: state.candidates,
    election: state.election,
    cooldown: state.lastVoteAt ? Math.max(0, VOTE_COOLDOWN_MS - (Date.now() - state.lastVoteAt)) : 0,
    cooldownMs: VOTE_COOLDOWN_MS
  }));
}

function broadcast() {
  io.emit('state:update', publicState());
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = token ? sessions.get(token) : null;
  if (!session) return res.status(401).json({ message: 'Sessão inválida.' });
  req.user = session;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ message: 'Acesso não autorizado.' });
    next();
  };
}

function resetElection() {
  state.election = {
    status: 'running',
    startedAt: new Date().toISOString(),
    finalizedAt: null,
    totalVotes: 0,
    blankVotes: 0,
    nullVotes: 0,
    votes: Object.fromEntries(state.candidates.map((candidate) => [candidate.number, 0]))
  };
  state.lastVoteAt = null;
}

function validateCandidate(input, currentId = null) {
  const name = String(input.name || '').trim();
  const number = String(input.number || '').replace(/\D/g, '');
  const photo = String(input.photo || '');

  if (!name) throw new Error('Informe o nome do candidato.');
  if (!number || number.length < 1 || number.length > 5) throw new Error('O número deve ter de 1 a 5 dígitos.');
  if (state.candidates.some((c) => c.number === number && c.id !== currentId)) throw new Error('Esse número já está cadastrado.');
  if (photo && !photo.startsWith('data:image/')) throw new Error('Foto inválida.');
  return { name, number, photo };
}

app.get('/api/state', auth, (req, res) => {
  res.json(publicState());
});

app.post('/api/login', (req, res) => {
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  let role = null;

  if (username === ADMIN_USER && password === ADMIN_PASS) role = 'admin';
  if (username === OPERATOR_USER && password === OPERATOR_PASS) role = 'operator';

  if (!role) return res.status(401).json({ message: 'Usuário ou senha inválidos.' });

  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { role, createdAt: Date.now() });
  res.json({ token, role });
});

app.post('/api/logout', auth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

app.post('/api/candidates', auth, requireRole('admin'), (req, res) => {
  try {
    const candidate = validateCandidate(req.body);
    const record = { id: crypto.randomUUID(), ...candidate };
    state.candidates.push(record);
    state.election.votes[record.number] = state.election.votes[record.number] || 0;
    broadcast();
    res.status(201).json(record);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.put('/api/candidates/:id', auth, requireRole('admin'), (req, res) => {
  try {
    const candidate = state.candidates.find((item) => item.id === req.params.id);
    if (!candidate) return res.status(404).json({ message: 'Candidato não encontrado.' });
    const data = validateCandidate(req.body, candidate.id);
    const oldNumber = candidate.number;
    Object.assign(candidate, data);
    if (oldNumber !== candidate.number) {
      state.election.votes[candidate.number] = state.election.votes[candidate.number] || 0;
      delete state.election.votes[oldNumber];
    }
    broadcast();
    res.json(candidate);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.delete('/api/candidates/:id', auth, requireRole('admin'), (req, res) => {
  if (state.election.status === 'running') return res.status(400).json({ message: 'Não altere candidatos durante a votação.' });
  state.candidates = state.candidates.filter((item) => item.id !== req.params.id);
  state.election.votes = Object.fromEntries(state.candidates.map((candidate) => [candidate.number, state.election.votes[candidate.number] || 0]));
  broadcast();
  res.json({ ok: true });
});

app.post('/api/election/start', auth, requireRole('operator'), (req, res) => {
  if (state.candidates.length === 0) return res.status(400).json({ message: 'Cadastre pelo menos um candidato antes de iniciar.' });
  if (state.election.status === 'running') return res.status(400).json({ message: 'A votação já está em andamento.' });
  if (state.election.status === 'finished') return res.status(400).json({ message: 'A eleição já foi finalizada. Cadastre uma nova rodada para reiniciar.' });
  resetElection();
  broadcast();
  res.json(publicState());
});

app.post('/api/vote', auth, requireRole('operator'), (req, res) => {
  try {
    if (state.election.status !== 'running') return res.status(400).json({ message: 'A votação não está em andamento.' });
    const remaining = state.lastVoteAt ? VOTE_COOLDOWN_MS - (Date.now() - state.lastVoteAt) : 0;
    if (remaining > 0) return res.status(429).json({ message: `Aguarde ${Math.ceil(remaining / 1000)} segundos para o próximo voto.` });

    const type = req.body?.type || 'candidate';
    if (type === 'candidate') {
      const number = String(req.body?.number || '').replace(/\D/g, '');
      const candidate = state.candidates.find((item) => item.number === number);
      if (!candidate) return res.status(400).json({ message: 'Número de candidato não encontrado.' });
      state.election.votes[number] = (state.election.votes[number] || 0) + 1;
    } else if (type === 'blank') {
      state.election.blankVotes += 1;
    } else {
      state.election.nullVotes += 1;
    }

    state.election.totalVotes += 1;
    state.lastVoteAt = Date.now();
    broadcast();
    res.json({ ok: true, cooldownMs: VOTE_COOLDOWN_MS, state: publicState() });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Erro ao registrar voto.' });
  }
});

app.post('/api/election/finalize', auth, requireRole('operator'), (req, res) => {
  if (state.election.status !== 'running') return res.status(400).json({ message: 'Não existe votação em andamento.' });
  state.election.status = 'finished';
  state.election.finalizedAt = new Date().toISOString();
  state.lastVoteAt = null;
  broadcast();
  res.json(publicState());
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const session = token ? sessions.get(token) : null;
  if (!session) return next(new Error('Sessão inválida.'));
  socket.user = session;
  next();
});

io.on('connection', (socket) => {
  socket.emit('state:update', publicState());
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor da urna ativo em http://localhost:${PORT}`);
});
