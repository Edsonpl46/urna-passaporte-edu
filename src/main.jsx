import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { auth, db, firebaseConfigured, firebaseMissingKeys } from './firebase';
import './styles.css';

const ELECTION_REF = doc(db, 'election', 'current');
const loginRoleStorage = 'passaporte-edu-login-role';

function go(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const listener = () => setPath(window.location.pathname);
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);
  return path;
}

function useAuth() {
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const profileStopRef = useRef(null);

  useEffect(() => {
    if (!firebaseConfigured) {
      setUser(null);
      return undefined;
    }

    const stopAuth = onAuthStateChanged(auth, (currentUser) => {
      profileStopRef.current?.();
      profileStopRef.current = null;
      setUser(currentUser);
      setProfile(null);
      setError('');
      if (!currentUser) return;
      profileStopRef.current = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
        if (snap.exists()) setProfile({ id: snap.id, ...snap.data() });
        else setError('Seu usuário existe no Firebase, mas ainda não possui um perfil de acesso na coleção users.');
      }, () => setError('Não foi possível carregar o perfil de acesso.'));
    });

    return () => {
      stopAuth();
      profileStopRef.current?.();
      profileStopRef.current = null;
    };
  }, []);

  return { user, profile, error };
}

function useElectionState(enabled = true) {
  const [election, setElection] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !firebaseConfigured) return undefined;
    const stopElection = onSnapshot(ELECTION_REF, (snap) => {
      setElection(snap.exists() ? normalizeElection(snap.data()) : defaultElection());
    }, (err) => setError(err.message));
    const candidatesQuery = query(collection(db, 'candidates'), orderBy('number', 'asc'));
    const stopCandidates = onSnapshot(candidatesQuery, (snap) => {
      setCandidates(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    }, (err) => setError(err.message));
    return () => {
      stopElection();
      stopCandidates();
    };
  }, [enabled]);

  return { election, candidates, error };
}

function defaultElection() {
  return {
    status: 'not_started',
    startedAt: null,
    finalizedAt: null,
    totalVotes: 0,
    blankVotes: 0,
    nullVotes: 0,
    nextVoteAt: null,
  };
}

function normalizeElection(data) {
  const toIso = (value) => value?.toDate ? value.toDate().toISOString() : value || null;
  return {
    ...defaultElection(),
    ...data,
    startedAt: toIso(data.startedAt),
    finalizedAt: toIso(data.finalizedAt),
    nextVoteAt: toIso(data.nextVoteAt),
  };
}

function App() {
  const path = usePath();
  const { user, profile, error: authError } = useAuth();

  if (!firebaseConfigured) {
    return <ConfigScreen missing={firebaseMissingKeys} />;
  }

  if (user === undefined) return <Loading text="Verificando acesso..." />;
  if (!user) return path !== '/login' ? <Login /> : <Login />;
  if (!profile) return <Loading text="Carregando perfil..." error={authError} />;

  const role = profile.role;
  if (path === '/login') return <Redirect role={role} />;
  if (path === '/admin' && role === 'admin') return <AdminDashboard profile={profile} />;
  if (path === '/operator' && role === 'operator') return <OperatorDashboard profile={profile} />;
  if (path === '/urna' && role === 'operator') return <Urna />;
  return <Redirect role={role} />;
}

function ConfigScreen({ missing }) {
  return <div className="center-screen config-screen">
    <div className="config-card">
      <div className="brand-large"><span>PE</span><div><strong>Passaporte Edu</strong><small>ELEIÇÕES • LIMOEIRO</small></div></div>
      <span className="eyebrow">CONFIGURAÇÃO DO PROJETO</span>
      <h1>Firebase ainda não configurado</h1>
      <p>Crie o arquivo <code>.env.local</code> usando o modelo <code>.env.example</code> e preencha as credenciais do seu app Web Firebase.</p>
      <pre>{missing.join('\n')}</pre>
    </div>
  </div>;
}

function Redirect({ role }) {
  useEffect(() => go(role === 'admin' ? '/admin' : '/operator'), [role]);
  return <Loading />;
}

function Loading({ text = 'Carregando...', error = '' }) {
  return <div className="center-screen"><div className="loading-card"><div className="spinner" /><strong>{error || text}</strong></div></div>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(localStorage.getItem(loginRoleStorage) || 'admin');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function changeRole(next) {
    setRole(next);
    localStorage.setItem(loginRoleStorage, next);
    setEmail('');
    setPassword('');
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const profileSnap = await getDoc(doc(db, 'users', credential.user.uid));
      if (!profileSnap.exists()) throw new Error('Conta autenticada, mas sem perfil de acesso cadastrado. Crie o documento do usuário na coleção users.');
      const actualRole = profileSnap.data().role;
      if (actualRole !== role) {
        await signOut(auth);
        throw new Error(`Esta conta pertence ao perfil ${actualRole === 'admin' ? 'Gestão' : 'Operador'}. Selecione o perfil correto.`);
      }
      go(role === 'admin' ? '/admin' : '/operator');
    } catch (err) {
      setError(readableAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  return <div className="auth-shell">
    <div className="auth-glow glow-one" />
    <div className="auth-glow glow-two" />
    <div className="auth-grid-pattern" />
    <div className="auth-layout">
      <section className="auth-hero">
        <div className="hero-brand"><span className="brand-symbol">P</span><div><strong>Passaporte <em>Edu</em></strong><small>ELEIÇÕES • LIMOEIRO</small></div></div>
        <div className="hero-copy">
          <span className="eyebrow eyebrow-yellow">PLATAFORMA DE VOTAÇÃO</span>
          <h1>Uma experiência de eleição pensada para a sua escola.</h1>
          <p>Gestão, operação da urna e apuração em tempo real em um único sistema.</p>
        </div>
        <div className="hero-pills"><span>⚡ Tempo real</span><span>🔐 Acesso por perfil</span><span>📱 Tablet</span></div>
      </section>

      <section className="auth-card">
        <div className="mobile-brand"><span className="brand-symbol">P</span><strong>Passaporte <em>Edu</em></strong></div>
        <div className="auth-copy">
          <span className="eyebrow">ACESSO RESTRITO</span>
          <h2>Entrar no sistema</h2>
          <p>Use seu e-mail e senha cadastrados.</p>
        </div>
        <div className="role-switch" aria-label="Tipo de acesso">
          <button type="button" className={role === 'admin' ? 'active' : ''} onClick={() => changeRole('admin')}>
            <span className="role-icon">▦</span><span><b>Gestão</b><small>Candidatos e apuração</small></span>
          </button>
          <button type="button" className={role === 'operator' ? 'active' : ''} onClick={() => changeRole('operator')}>
            <span className="role-icon">⌨</span><span><b>Operador</b><small>Controle da urna</small></span>
          </button>
        </div>
        <form onSubmit={submit} className="stack auth-form">
          <label>E-mail
            <span className="input-wrap"><span className="input-icon">@</span><input autoComplete="username" inputMode="email" placeholder="Digite seu e-mail" value={email} onChange={(e) => setEmail(e.target.value)} /></span>
          </label>
          <label>Senha
            <span className="input-wrap"><span className="input-icon">●</span><input autoComplete="current-password" placeholder="Digite sua senha" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} /><button className="password-toggle" type="button" onClick={() => setShowPassword((v) => !v)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button></span>
          </label>
          {error && <div className="alert error">{error}</div>}
          <button className="primary large login-button" disabled={loading || !email || !password}>{loading ? 'Entrando...' : 'Acessar sistema'}<span>→</span></button>
        </form>
        <div className="auth-footer"><span className="live-dot" />  • Autenticação Ativa</div>
      </section>
    </div>
  </div>;
}

function Shell({ title, subtitle, children, role }) {
  async function logout() {
    await signOut(auth);
    go('/login');
  }
  const is = (route) => window.location.pathname === route;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-line"><span className="brand-mini">PE</span><div><strong>Passaporte Edu</strong><small>Urna eletrônica</small></div></div>
      <div className="sidebar-label">MENU</div>
      <nav>
        {role === 'admin' && <button onClick={() => go('/admin')} className={is('/admin') ? 'nav-active' : ''}><span>◈</span> Apuração</button>}
        {role === 'operator' && <>
          <button onClick={() => go('/operator')} className={is('/operator') ? 'nav-active' : ''}><span>◫</span> Controle da eleição</button>
          <button onClick={() => go('/urna')} className={is('/urna') ? 'nav-active' : ''}><span>⌨</span> Abrir urna</button>
        </>}
      </nav>
      <div className="sidebar-bottom"><span className="sidebar-role">{role === 'admin' ? 'GESTÃO' : 'OPERADOR'}</span><button className="logout" onClick={logout}>Sair</button></div>
    </aside>
    <main className="main-area">
      <header className="page-head"><div><span className="eyebrow">PASSAPORTE EDU</span><h2>{title}</h2><p>{subtitle}</p></div><div className="status-dot"><span /> conexão ativa</div></header>
      {children}
    </main>
  </div>;
}

function AdminDashboard() {
  const { election, candidates, error } = useElectionState(true);
  const [form, setForm] = useState({ id: '', name: '', number: '', photo: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  if (!election) return <Loading text="Sincronizando apuração..." error={error} />;
  const results = getSortedResults(election, candidates);

  async function saveCandidate(event) {
    event.preventDefault();
    setSaving(true); setMessage('');
    try {
      const name = form.name.trim();
      const number = form.number.replace(/\D/g, '');
      if (!name) throw new Error('Informe o nome do candidato.');
      if (!number || number.length > 5) throw new Error('O número deve ter de 1 a 5 dígitos.');
      const duplicate = candidates.find((c) => c.number === number && c.id !== form.id);
      if (duplicate) throw new Error('Esse número já está cadastrado.');
      const payload = { name, number, photo: form.photo || '' };
      const ref = form.id ? doc(db, 'candidates', form.id) : doc(collection(db, 'candidates'));
      if (form.id) await updateDoc(ref, payload); else await setDoc(ref, { ...payload, votes: 0 });
      setForm({ id: '', name: '', number: '', photo: '' });
      setMessage(form.id ? 'Candidato atualizado.' : 'Candidato cadastrado.');
    } catch (err) { setMessage(err.message); }
    finally { setSaving(false); }
  }

  async function removeCandidate(id) {
    if (!window.confirm('Remover este candidato?')) return;
    try { await deleteDoc(doc(db, 'candidates', id)); setMessage('Candidato removido.'); }
    catch (err) { setMessage(err.message); }
  }

  function editCandidate(candidate) {
    setForm({ id: candidate.id, name: candidate.name, number: candidate.number, photo: candidate.photo || '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return <Shell role="admin" title="Dashboard de apuração" subtitle="Acompanhe os votos recebidos em tempo real.">
    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert">{message}</div>}
    <div className="metric-grid">
      <Metric label="Status" value={statusLabel(election.status)} tone={election.status === 'running' ? 'green' : ''} />
      <Metric label="Total de votos" value={election.totalVotes} />
      <Metric label="Brancos" value={election.blankVotes} />
      <Metric label="Nulos" value={election.nullVotes} />
    </div>

    <div className="content-grid admin-grid">
      <section className="panel candidate-panel">
        <div className="panel-head"><div><span className="section-kicker">CADASTRO</span><h3>{form.id ? 'Editar candidato' : 'Cadastrar candidato'}</h3><p>O número será usado diretamente na urna.</p></div></div>
        <form onSubmit={saveCandidate} className="candidate-form">
          <label>Nome<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome completo" /></label>
          <label>Número<input required maxLength={5} inputMode="numeric" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value.replace(/\D/g, '') })} placeholder="Ex.: 12" /></label>
          <label className="full">Foto<input type="file" accept="image/*" onChange={(e) => compressImage(e.target.files?.[0]).then((photo) => setForm({ ...form, photo }))} />{form.photo && <span className="file-preview"><img src={form.photo} alt="Prévia" /> Foto selecionada</span>}</label>
          <div className="form-actions full"><button className="primary" disabled={saving}>{saving ? 'Salvando...' : (form.id ? 'Salvar alterações' : 'Cadastrar candidato')}</button>{form.id && <button type="button" className="secondary" onClick={() => setForm({ id: '', name: '', number: '', photo: '' })}>Cancelar</button>}</div>
        </form>
        <div className="candidate-list">
          {candidates.length === 0 ? <EmptyState text="Nenhum candidato cadastrado." /> : candidates.map((candidate) => <div className="candidate-item" key={candidate.id}><div className="mini-photo">{candidate.photo ? <img src={candidate.photo} alt="" /> : candidate.name[0]}</div><div className="candidate-main"><strong>{candidate.name}</strong><span>Número {candidate.number}</span></div><div className="row-actions"><button onClick={() => editCandidate(candidate)}>Editar</button><button className="danger-text" onClick={() => removeCandidate(candidate.id)}>Excluir</button></div></div>)}
        </div>
      </section>

      <section className="panel results-panel">
        <div className="panel-head"><div><span className="section-kicker">AO VIVO</span><h3>Apuração</h3><p>Atualização automática pelo Firestore.</p></div><span className={`live-badge ${election.status}`}>{statusLabel(election.status)}</span></div>
        {results.length === 0 ? <EmptyState text="Cadastre os candidatos para acompanhar a apuração." /> : <div className="results-list">
          {results.map((item, index) => <div className="result-row" key={item.id}>
            <div className="position">{index + 1}</div><div className="result-photo">{item.photo ? <img src={item.photo} alt="" /> : <span>{item.name.slice(0, 1)}</span>}</div><div className="result-name"><strong>{item.name}</strong><span>nº {item.number}</span></div><div className="result-bar"><span style={{ width: `${Math.min(100, Number(percent(item.votes, election.totalVotes)))}%` }} /></div><div className="result-votes"><strong>{item.votes}</strong><span>{percent(item.votes, election.totalVotes)}%</span></div>
          </div>)}
          <div className="special-grid"><div className="special-result"><span>Brancos</span><strong>{election.blankVotes}</strong></div><div className="special-result"><span>Nulos</span><strong>{election.nullVotes}</strong></div></div>
        </div>}
        <button className="secondary full-width" onClick={() => exportPdf(election, candidates)}>Exportar apuração em PDF</button>
      </section>
    </div>
  </Shell>;
}

function OperatorDashboard() {
  const { election, candidates, error } = useElectionState(true);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  if (!election) return <Loading text="Sincronizando eleição..." error={error} />;

  async function callElection(action) {
    setLoading(true); setMessage('');
    try {
      const token = await auth.currentUser.getIdToken(true);
      const response = await fetch(`/api/election?action=${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; }
      catch {
        throw new Error(`A API da Vercel respondeu com ${response.status} (${response.statusText}) em vez de JSON.`);
      }
      if (!response.ok) throw new Error(data.message || `Falha ao atualizar a eleição (HTTP ${response.status}).`);
      if (action === 'start') go('/urna');
      if (action === 'finalize') await exportPdf(normalizeElection(data.election), candidates);
    } catch (err) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  return <Shell role="operator" title="Controle da eleição" subtitle="Inicialize a urna, acompanhe o estado e encerre a apuração.">
    {error && <div className="alert error">{error}</div>}
    {message && <div className="alert error">{message}</div>}
    <div className="operator-hero panel">
      <div className="operator-status"><span className={`big-status ${election.status}`} /><div><span className="section-kicker">STATUS DA ELEIÇÃO</span><h3>{statusLabel(election.status)}</h3><p>{election.totalVotes} voto(s) registrado(s).</p></div></div>
      <div className="operator-actions">
        {election.status !== 'running' && <button className="primary large" disabled={loading || candidates.length === 0} onClick={() => callElection('start')}>{loading ? 'Inicializando...' : election.status === 'finished' ? 'Iniciar nova eleição' : 'Inicializar votação'}</button>}
        {election.status === 'running' && <><button className="primary large" onClick={() => go('/urna')}>Abrir urna</button><button className="danger large" disabled={loading} onClick={() => { if (window.confirm('Finalizar a eleição agora? Depois disso não haverá novos votos até uma nova rodada.')) callElection('finalize'); }}>{loading ? 'Finalizando...' : 'Finalizar eleição'}</button></>}
        {election.status === 'finished' && <button className="secondary large" onClick={() => exportPdf(election, candidates)}>Exportar apuração</button>}
      </div>
    </div>
    {candidates.length === 0 && <div className="alert warning">Nenhum candidato cadastrado. Entre no perfil de Gestão para cadastrar os candidatos antes de iniciar.</div>}
    <section className="panel"><div className="panel-head"><div><span className="section-kicker">OPERAÇÃO</span><h3>Resumo da rodada</h3><p>O próximo voto fica bloqueado por 15 segundos após cada confirmação.</p></div></div><div className="metric-grid"><Metric label="Candidatos" value={candidates.length} /><Metric label="Votos" value={election.totalVotes} /><Metric label="Brancos" value={election.blankVotes} /><Metric label="Nulos" value={election.nullVotes} /></div></section>
  </Shell>;
}

function Urna() {
  const { election, candidates, error } = useElectionState(true);
  const [number, setNumber] = useState('');
  const [selection, setSelection] = useState(null);
  const [toast, setToast] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    function handleKeydown(event) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (/^\d$/.test(event.key)) pressKey(event.key);
      if (event.key === 'Enter') confirmVote();
      if (event.key === 'Backspace' || event.key === 'Delete') pressKey('corrige');
      if (event.key.toLowerCase() === 'b') pressKey('branco');
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  useEffect(() => {
    updateCooldown();
    clearInterval(timerRef.current);
    timerRef.current = setInterval(updateCooldown, 250);
    return () => clearInterval(timerRef.current);
  }, [election?.nextVoteAt]);

  function updateCooldown() {
    if (!election?.nextVoteAt) return setCooldown(0);
    const remaining = Math.max(0, new Date(election.nextVoteAt).getTime() - Date.now());
    setCooldown(Math.ceil(remaining / 1000));
  }

  if (!election) return <Loading text="Conectando à urna..." error={error} />;
  if (election.status !== 'running') return <div className="urna-screen"><div className="urna-ended"><div className="ended-icon">✓</div><span className="eyebrow">PASSAPORTE EDU</span><h1>{election.status === 'finished' ? 'ELEIÇÃO FINALIZADA' : 'VOTAÇÃO NÃO INICIADA'}</h1><p>O operador precisa iniciar uma rodada para liberar a urna.</p><button onClick={() => go('/operator')} className="primary large">Voltar ao controle</button></div></div>;

  const candidate = number ? candidates.find((item) => item.number === number) : null;
  const canAct = cooldown === 0 && !busy;

  function pressKey(value) {
    if (!canAct) return;
    setToast('');
    if (value === 'corrige') { setNumber(''); setSelection(null); return; }
    if (value === 'branco') { setNumber(''); setSelection({ type: 'blank' }); beep('blank'); return; }
    if (selection?.type === 'blank') setSelection(null);
    if (number.length >= 5) return;
    const next = `${number}${value}`;
    setNumber(next);
    const found = candidates.find((item) => item.number === next);
    setSelection(found ? { type: 'candidate', candidate: found } : null);
  }

  async function confirmVote() {
    if (!canAct) return;
    const type = selection?.type || (candidate ? 'candidate' : null);
    if (!type) { setToast('Digite um número válido ou selecione BRANCO.'); beep('error'); return; }
    setBusy(true); setToast('');
    try {
      const token = await auth.currentUser.getIdToken(true);
      const body = type === 'candidate' ? { type, number: candidate.number } : { type };
      const response = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const raw = await response.text();
      let data = {};
      try { data = raw ? JSON.parse(raw) : {}; }
      catch {
        throw new Error(`A API da Vercel respondeu com ${response.status} (${response.statusText}) em vez de JSON.`);
      }
      if (!response.ok) throw new Error(data.message || `Não foi possível registrar o voto (HTTP ${response.status}).`);
      beep('confirm');
      setNumber(''); setSelection(null); setConfirmed(true);
      setTimeout(() => setConfirmed(false), 1600);
    } catch (err) { setToast(err.message); beep('error'); }
    finally { setBusy(false); }
  }

  function beep(kind) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      const settings = kind === 'confirm' ? { frequency: 740, duration: 0.22 } : kind === 'blank' ? { frequency: 520, duration: 0.11 } : { frequency: 210, duration: 0.18 };
      osc.frequency.value = settings.frequency; gain.gain.value = 0.06; osc.start(); osc.stop(ctx.currentTime + settings.duration);
    } catch {}
  }

  return <div className="urna-screen">
    <div className="urna-topbar"><div className="urna-logo"><span>PE</span><div><strong>PASSAPORTE EDU</strong><small>SIMULAÇÃO ESCOLAR</small></div></div><button className="urna-exit" onClick={() => go('/operator')}>Controle</button></div>
    <div className="urna-machine">
      <div className="urna-body">
        <div className="display-wrap">
          <div className="display">
            <div className="display-top"><span>SEU VOTO</span><span>ELEIÇÃO PASSAPORTE EDU</span></div>
            {selection?.type === 'blank' ? <><div className="blank-title">VOTO EM BRANCO</div><div className="display-question">Pressione CONFIRMA para votar em branco.</div></> : <>
              <div className="number-line">{number.split('').map((digit, i) => <span key={i}>{digit}</span>)}{Array.from({ length: Math.max(0, 5 - number.length) }).map((_, i) => <span className="empty-digit" key={`e${i}`}>_</span>)}</div>
              {candidate ? <div className="candidate-preview"><div className="preview-photo">{candidate.photo ? <img src={candidate.photo} alt="" /> : candidate.name.slice(0, 1)}</div><div><small>CANDIDATO(A)</small><strong>{candidate.name}</strong><span>NÚMERO {candidate.number}</span></div></div> : <div className="display-question">Digite o número do candidato.</div>}
            </>}
            {toast && <div className="display-error">{toast}</div>}
            {confirmed && <div className="confirmed"><span>✓</span> VOTO CONFIRMADO</div>}
            {cooldown > 0 && <div className="cooldown"><span>PRÓXIMO VOTO</span><strong>{cooldown}s</strong></div>}
          </div>
        </div>
        <div className="keyboard-wrap">
          <div className="keyboard-heading"><span>TECLADO NUMÉRICO</span><small>Toque ou pressione as teclas do teclado físico</small></div>
          <div className="keyboard">
            <div className="keys numbers">{'1234567890'.split('').map((digit) => <button className="num-key" key={digit} onPointerDown={() => pressKey(digit)} disabled={!canAct}>{digit}</button>)}</div>
            <div className="action-keys"><button className="white-key" onPointerDown={() => pressKey('branco')} disabled={!canAct}>BRANCO</button><button className="orange-key" onPointerDown={() => pressKey('corrige')} disabled={!canAct}>CORRIGE</button><button className="green-key" onPointerDown={confirmVote} disabled={!canAct}>CONFIRMA</button></div>
          </div>
        </div>
      </div>
    </div>
    <div className="urna-footnote">Os dados são atualizados em tempo real. Intervalo obrigatório entre votos: 15 segundos.</div>
  </div>;
}

function Metric({ label, value, tone = '' }) { return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }
function EmptyState({ text }) { return <div className="empty-state"><div>○</div><span>{text}</span></div>; }
function statusLabel(status) { return ({ not_started: 'Não iniciada', running: 'Em votação', finished: 'Finalizada' })[status] || status; }
function percent(votes, total) { return total ? ((votes / total) * 100).toFixed(1).replace('.', ',') : '0,0'; }
function getSortedResults(election, candidates) { return candidates.map((c) => ({ ...c, votes: Number(c.votes || 0) })).sort((a, b) => b.votes - a.votes || String(a.number).localeCompare(String(b.number))); }
function readableAuthError(error) { return ({ 'auth/invalid-credential': 'E-mail ou senha inválidos.', 'auth/user-not-found': 'E-mail ou senha inválidos.', 'auth/wrong-password': 'E-mail ou senha inválidos.', 'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.', 'auth/invalid-email': 'Digite um e-mail válido.' })[error?.code] || error?.message || 'Não foi possível entrar.'; }
function compressImage(file) {
  return new Promise((resolve) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 480;
        const ratio = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * ratio));
        canvas.height = Math.max(1, Math.round(img.height * ratio));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      img.src = reader.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function exportPdf(election, candidates) {
  const docPdf = new jsPDF();
  docPdf.setFillColor(13, 27, 66); docPdf.rect(0, 0, 210, 30, 'F');
  docPdf.setTextColor(255, 255, 255); docPdf.setFontSize(18); docPdf.text('Passaporte Edu • Apuração', 14, 18);
  docPdf.setFontSize(10); docPdf.text(`Status: ${statusLabel(election.status)}`, 14, 38); docPdf.text(`Total de votos: ${election.totalVotes}`, 14, 44);
  const rows = getSortedResults(election, candidates).map((c, i) => [i + 1, c.name, c.number, c.votes, `${percent(c.votes, election.totalVotes)}%`]);
  autoTable(docPdf, { startY: 50, head: [['Pos.', 'Candidato', 'Número', 'Votos', '%']], body: rows, headStyles: { fillColor: [20, 48, 116] } });
  const y = docPdf.lastAutoTable?.finalY || 62;
  autoTable(docPdf, { startY: y + 7, head: [['Tipo', 'Quantidade']], body: [['Brancos', election.blankVotes], ['Nulos', election.nullVotes]], headStyles: { fillColor: [242, 185, 32] }, theme: 'grid' });
  docPdf.setFontSize(8); docPdf.setTextColor(100, 100, 100); docPdf.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, 288);
  docPdf.save(`apuracao-passaporte-edu-${new Date().toISOString().slice(0, 10)}.pdf`);
}

createRoot(document.getElementById('root')).render(<App />);
