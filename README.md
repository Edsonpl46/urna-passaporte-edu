# Urna Passaporte Edu — Firebase + Vercel

Sistema de votação escolar para a Passaporte Edu Limoeiro.

## Arquitetura

- React + Vite no frontend.
- Firebase Authentication para login por e-mail e senha.
- Cloud Firestore para candidatos e apuração em tempo real.
- Vercel Functions em `/api` para iniciar/finalizar eleição e registrar votos.
- O intervalo de 30 segundos é validado no servidor, e não apenas no navegador.
- PDF de apuração gerado no navegador.
- Teclado da urna clicável por toque, mouse e teclado físico.
- Fotos são comprimidas no navegador e salvas no documento do candidato, evitando a necessidade de Storage nesta primeira versão.

## Estrutura de dados

### `users/{uid}`
```json
{
  "name": "Nome da pessoa",
  "role": "admin"
}
```
`role` pode ser `admin` ou `operator`.

### `candidates/{id}`
```json
{
  "name": "Candidato",
  "number": "12",
  "photo": "data:image/jpeg;base64,...",
  "votes": 0
}
```

### `election/current`
Guarda o estado da rodada: status, total de votos, brancos, nulos, datas e próximo horário liberado.

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha as variáveis do app Web Firebase.

No deploy da Vercel, configure também `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` como variáveis secretas da função.

**Nunca** coloque a chave privada dentro de `VITE_` nem comite um JSON de service account.

## Rodar localmente

```bash
npm install
npm run dev
```

O frontend abre em `http://localhost:5173`.

As funções `/api` são próprias do ambiente Vercel. Para testar localmente a integração completa com as Functions, use a CLI da Vercel (`vercel dev`) depois de configurar o projeto e as variáveis.

## Publicar na Vercel

1. Suba o projeto para o GitHub.
2. Importe o repositório na Vercel.
3. Configure as variáveis de ambiente.
4. Faça o deploy.
5. Cadastre o domínio do deploy também no Firebase Authentication em Authorized domains.

## Segurança

As regras do Firestore permitem leitura apenas para usuários autenticados e escrita de candidatos somente para `admin` quando a eleição não está em andamento.

As operações de iniciar/finalizar eleição e registrar voto passam por Vercel Functions com Firebase Admin SDK.

## Configuração para iniciantes

Veja `CONFIGURACAO_FIREBASE.md`. Ele explica desde a criação do projeto Firebase até as variáveis da Vercel e o cadastro das contas de Gestão e Operador.
