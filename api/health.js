import { adminDb, sendJson } from './_firebaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, message: 'Método não permitido.' });
  try {
    await adminDb().collection('election').doc('current').get();
    return sendJson(res, 200, { ok: true, message: 'Vercel Function + Firebase Admin funcionando.' });
  } catch (error) {
    return sendJson(res, 500, { ok: false, message: error.message || 'Falha ao inicializar o Firebase Admin.' });
  }
}
