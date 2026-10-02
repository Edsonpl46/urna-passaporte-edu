export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, message: 'Método não permitido.' });
    }

    const env = {
      FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
      FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
      FIREBASE_PRIVATE_KEY: Boolean(process.env.FIREBASE_PRIVATE_KEY),
    };

    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
      return res.status(500).json({
        ok: false,
        stage: 'environment',
        message: 'Variáveis do Firebase Admin ausentes na Vercel.',
        env,
      });
    }

    // Importação dinâmica para que erros de carregamento do SDK também sejam exibidos como JSON.
    const { adminDb } = await import('./_firebaseAdmin.js');
    await adminDb().collection('election').doc('current').get();

    return res.status(200).json({
      ok: true,
      message: 'Vercel Function + Firebase Admin funcionando.',
      env,
      node: process.version,
    });
  } catch (error) {
    console.error('HEALTH_ERROR', error);
    return res.status(500).json({
      ok: false,
      stage: 'firebase-or-runtime',
      errorName: error?.name || 'Error',
      message: error?.message || 'Falha ao inicializar o Firebase Admin.',
      node: process.version,
    });
  }
}
