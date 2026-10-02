# Correção do erro ERR_REQUIRE_ESM na Vercel

O projeto estava usando `firebase-admin` 14.x, cuja cadeia de dependências pode instalar `jwks-rsa` 4.x + `jose` 6.x. Em funções CommonJS/serverless isso pode gerar:

`Error [ERR_REQUIRE_ESM]: require() of ES Module ... jose ... from ... jwks-rsa ... not supported`

Nesta versão o `firebase-admin` foi fixado em `13.10.0`, uma linha anterior que usa a cadeia compatível com CommonJS e evita esse conflito.

## Depois de substituir os arquivos

No PowerShell, dentro do projeto:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item package-lock.json -ErrorAction SilentlyContinue
npm install
npm run build
```

Confira:

```powershell
npm ls firebase-admin jwks-rsa jose
```

O `firebase-admin` deve aparecer como `13.10.0`.

Depois:

```powershell
git add package.json
git commit -m "corrigir firebase admin para Vercel"
git push origin main
```

Faça um novo deploy na Vercel. Não altere `FIREBASE_PRIVATE_KEY` por causa desse erro; o problema mostrado nos logs é de dependência ESM/CJS.
