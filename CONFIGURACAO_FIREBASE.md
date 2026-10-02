# Configuração do Firebase — passo a passo

Este guia foi feito para quem está começando no Firebase.

## 1. Criar o projeto

1. Entre em https://console.firebase.google.com/
2. Clique em **Adicionar projeto**.
3. Use um nome como `urna-passaporte-edu`.
4. Conclua a criação.

## 2. Cadastrar o aplicativo Web

1. Dentro do projeto, abra **Configurações do projeto**.
2. Na seção **Seus aplicativos**, clique no ícone **Web `</>`**.
3. Dê um apelido, por exemplo `urna-web`.
4. Registre o aplicativo.
5. O Firebase mostrará um objeto `firebaseConfig`.

Pegue os valores e preencha `.env.local` assim:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Não precisa esconder o `apiKey` do Firebase Web. O controle de acesso deste projeto vem da autenticação e das Security Rules. **A chave privada do Admin SDK, por outro lado, é secreta.**

## 3. Ativar login por e-mail e senha

1. Abra **Build → Authentication**.
2. Clique em **Começar**, caso ainda não tenha ativado o Authentication.
3. Entre em **Método de login**.
4. Ative **E-mail/senha**.
5. Salve.

## 4. Criar os usuários

No Authentication, abra a aba **Usuários** e use **Adicionar usuário**.

Crie pelo menos dois usuários, por exemplo:

- Gestão: um e-mail para quem vai cadastrar candidatos e acompanhar a apuração.
- Operador: um e-mail para quem vai controlar a urna.

Exemplo:

```text
gestao@passaporteedu.com
operador@passaporteedu.com
```

Use as senhas que você escolher. O sistema não deixa senha pronta na tela.

## 5. Criar o banco Firestore

1. Abra **Build → Firestore Database**.
2. Clique em **Criar banco de dados**.
3. Escolha a edição **Standard**.
4. Escolha a região mais adequada para o seu público.
5. Como o projeto já possui regras, você pode começar pelo modo de produção e depois publicar as regras do arquivo `firestore.rules`.

## 6. Criar os perfis dos usuários

Agora precisamos dizer ao sistema qual é o perfil de cada conta.

No Firestore, crie uma coleção:

```text
users
```

Depois crie um documento com o **UID exato** do usuário criado no Authentication.

### Usuário de Gestão

Documento:

```text
users/UID_DA_CONTA_DE_GESTAO
```

Campos:

```text
name = Gestão
role = admin
```

### Usuário Operador

Documento:

```text
users/UID_DA_CONTA_DO_OPERADOR
```

Campos:

```text
name = Operador
role = operator
```

Para descobrir o UID:

**Authentication → Usuários → clique no usuário → copie o UID.**

## 7. Publicar as regras do Firestore

O projeto já possui o arquivo:

```text
firestore.rules
```

Você pode colar esse conteúdo em **Firestore Database → Regras** e publicar.

As regras fazem o seguinte:

- usuário autenticado pode ler candidatos e apuração;
- usuário só pode ler o próprio documento de perfil;
- somente `admin` pode cadastrar/editar/excluir candidatos;
- candidatos não podem ser alterados enquanto a eleição está em andamento;
- clientes não podem alterar diretamente a apuração;
- votos são registrados pela função de servidor da Vercel.

## 8. Criar a Service Account para a Vercel

Essa parte é a mais importante para não colocar segredo no frontend.

1. Abra **Configurações do projeto**.
2. Entre em **Contas de serviço**.
3. Clique em **Gerar nova chave privada**.
4. O Firebase baixará um arquivo JSON.
5. **Não envie esse arquivo para o GitHub.**

Dentro do JSON existirão campos parecidos com:

```json
{
  "project_id": "seu-projeto",
  "client_email": "firebase-adminsdk-xxxx@seu-projeto.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n"
}
```

Você vai copiar:

```text
project_id    → FIREBASE_PROJECT_ID
client_email  → FIREBASE_CLIENT_EMAIL
private_key   → FIREBASE_PRIVATE_KEY
```

## 9. Subir para o GitHub

Antes de enviar:

```bash
npm install
npm run build
```

O `.gitignore` do projeto já impede o envio de `.env.local` e de arquivos de service account.

Depois:

```bash
git init
git add .
git commit -m "Sistema de urna Passaporte Edu com Firebase"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

## 10. Criar o projeto na Vercel

1. Abra https://vercel.com/
2. Entre com sua conta.
3. Clique em **Add New → Project**.
4. Importe o repositório do GitHub.
5. O framework deve ser reconhecido como Vite.
6. O build será:

```text
npm run build
```

7. Publique o projeto.

## 11. Configurar as variáveis da Vercel

Na Vercel:

**Project → Settings → Environment Variables**

Cadastre todas estas:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

Os seis `VITE_...` vêm do `firebaseConfig` do aplicativo Web.

As três últimas vêm da Service Account.

Marque pelo menos **Production** e, durante os testes, também **Preview**.

## 12. Autorizar o domínio da Vercel no Firebase Auth

Depois do primeiro deploy você terá algo semelhante a:

```text
https://urna-passaporte-edu.vercel.app
```

No Firebase:

**Authentication → Settings → Authorized domains**

Adicione o domínio da Vercel.

Para testar localmente, se necessário, adicione também `localhost` nessa lista.

## 13. Redeploy

Depois de adicionar as variáveis na Vercel:

**Deployments → último deploy → Redeploy**

A aplicação vai inicializar o Firebase com as variáveis da Vercel.

## 14. Primeiro teste

Faça nesta ordem:

1. Entre como Gestão.
2. Cadastre dois candidatos.
3. Saia.
4. Entre como Operador.
5. Clique em **Inicializar votação**.
6. Abra a urna.
7. Digite o número tocando na tela.
8. Clique em **CONFIRMA**.
9. Abra o dashboard de Gestão em outro computador ou navegador.
10. O voto deve aparecer automaticamente.
11. Tente registrar outro voto imediatamente: a urna deve bloquear por 15 segundos.
12. Depois, finalize a eleição pelo perfil Operador.
13. Exporte o PDF.

## 15. Problemas comuns

### “Permission denied” ou “Missing permissions” no Firestore
Confira se você publicou o `firestore.rules` e se o usuário tem documento em `users/{UID}` com a role correta.

### “Seu usuário existe no Firebase, mas ainda não possui um perfil”
A conta foi criada no Authentication, mas faltou criar o documento correspondente na coleção `users`.

### Login funciona localmente, mas não funciona na Vercel
Confira **Authentication → Settings → Authorized domains** e adicione o domínio do deploy da Vercel.

### API de voto retorna erro de Firebase Admin
Confira na Vercel as três variáveis:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

Não coloque a chave privada dentro de `VITE_`.

### A tela do tablet não responde bem ao toque
A urna usa `pointerdown`, `touch-action: manipulation` e botões grandes. Atualize o navegador do tablet e use a página em tela cheia.
