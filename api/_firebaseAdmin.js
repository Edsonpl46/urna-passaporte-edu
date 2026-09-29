import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !privateKey) {
    throw new Error('As variáveis do Firebase Admin não estão configuradas na Vercel.');
  }
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

export function adminAuth() { return getAuth(getAdminApp()); }
export function adminDb() { return getFirestore(getAdminApp()); }

export async function requireRole(req, role) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Sessão não enviada.');
  const decoded = await adminAuth().verifyIdToken(token);
  const userSnap = await adminDb().collection('users').doc(decoded.uid).get();
  const user = userSnap.exists ? userSnap.data() : null;
  if (!user || user.role !== role) throw new HttpError(403, 'Acesso não autorizado para este perfil.');
  return { ...decoded, profile: user };
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function sendJson(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
