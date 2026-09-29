import { Timestamp } from 'firebase-admin/firestore';
import { adminDb, requireRole, HttpError, sendJson } from './_firebaseAdmin.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { message: 'Método não permitido.' });
    await requireRole(req, 'operator');
    const action = new URL(req.url, 'http://localhost').searchParams.get('action');
    const db = adminDb();
    const electionRef = db.collection('election').doc('current');
    const electionSnap = await electionRef.get();
    const current = electionSnap.exists ? electionSnap.data() : null;
    const now = Timestamp.now();

    const candidatesSnap = await db.collection('candidates').get();
    if (action === 'start') {
      if (candidatesSnap.empty) throw new HttpError(400, 'Cadastre pelo menos um candidato antes de iniciar.');
      if (current?.status === 'running') throw new HttpError(400, 'A eleição já está em andamento.');
      const batch = db.batch();
      candidatesSnap.docs.forEach((candidate) => batch.update(candidate.ref, { votes: 0, updatedAt: now }));
      const election = {
        status: 'running',
        startedAt: now,
        finalizedAt: null,
        totalVotes: 0,
        blankVotes: 0,
        nullVotes: 0,
        nextVoteAt: null,
        updatedAt: now,
      };
      batch.set(electionRef, election);
      await batch.commit();
      return sendJson(res, 200, { ok: true, election: serializeElection(election) });
    }

    if (action === 'finalize') {
      if (!current || current.status !== 'running') throw new HttpError(400, 'Não existe uma votação em andamento.');
      await electionRef.update({ status: 'finished', finalizedAt: now, nextVoteAt: null, updatedAt: now });
      return sendJson(res, 200, { ok: true, election: serializeElection({ ...current, status: 'finished', finalizedAt: now, nextVoteAt: null }) });
    }

    throw new HttpError(400, 'Ação inválida.');
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return sendJson(res, status, { message: error.message || 'Falha ao atualizar a eleição.' });
  }
}

function serializeElection(election) {
  return {
    ...election,
    startedAt: election.startedAt?.toDate?.().toISOString?.() || null,
    finalizedAt: election.finalizedAt?.toDate?.().toISOString?.() || null,
    nextVoteAt: election.nextVoteAt?.toDate?.().toISOString?.() || null,
  };
}
