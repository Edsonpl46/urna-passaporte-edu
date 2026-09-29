import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb, requireRole, HttpError, sendJson } from './_firebaseAdmin.js';

const COOLDOWN_MS = 30_000;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { message: 'Método não permitido.' });
    await requireRole(req, 'operator');
    const db = adminDb();
    const electionRef = db.collection('election').doc('current');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const type = body.type;
    const number = String(body.number || '').replace(/\D/g, '');

    let nextVoteAt;
    await db.runTransaction(async (transaction) => {
      const electionSnap = await transaction.get(electionRef);
      if (!electionSnap.exists) throw new HttpError(400, 'A eleição ainda não foi inicializada.');
      const election = electionSnap.data();
      if (election.status !== 'running') throw new HttpError(400, 'A votação não está em andamento.');

      const now = Timestamp.now();
      if (election.nextVoteAt) {
        const remaining = election.nextVoteAt.toMillis() - now.toMillis();
        if (remaining > 0) throw new HttpError(429, `Aguarde ${Math.ceil(remaining / 1000)} segundos para o próximo voto.`);
      }

      const patch = {
        totalVotes: Number(election.totalVotes || 0) + 1,
        nextVoteAt: Timestamp.fromMillis(now.toMillis() + COOLDOWN_MS),
        updatedAt: now,
      };

      if (type === 'candidate') {
        if (!number) throw new HttpError(400, 'Número do candidato não informado.');
        const querySnap = await db.collection('candidates').where('number', '==', number).limit(1).get();
        if (querySnap.empty) throw new HttpError(400, 'Número de candidato não encontrado.');
        const candidateRef = querySnap.docs[0].ref;
        const candidate = querySnap.docs[0].data();
        const newVotes = Number(candidate.votes || 0) + 1;
        transaction.update(candidateRef, { votes: newVotes, updatedAt: now });
      } else if (type === 'blank') {
        patch.blankVotes = Number(election.blankVotes || 0) + 1;
      } else if (type === 'null') {
        patch.nullVotes = Number(election.nullVotes || 0) + 1;
      } else {
        throw new HttpError(400, 'Tipo de voto inválido.');
      }

      transaction.update(electionRef, patch);
      nextVoteAt = patch.nextVoteAt;
      transaction.set(electionRef.collection('votes').doc(), {
        type,
        number: type === 'candidate' ? number : null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return sendJson(res, 200, { ok: true, cooldownMs: COOLDOWN_MS, nextVoteAt: nextVoteAt.toDate().toISOString() });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return sendJson(res, status, { message: error.message || 'Não foi possível registrar o voto.' });
  }
}
