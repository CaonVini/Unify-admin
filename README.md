# Unify Admin

Painel administrativo da Unify desenvolvido com Next.js, React, TypeScript e Zod.

## Configuração

Crie um arquivo `.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

## Desenvolvimento

```bash
npm install
npm run dev
```

Para usar outra porta:

```bash
npm run dev -- --port 3010
```

## Produção

```bash
npm run build
npm start
```
