# Mixiwise — regras para o agente

App para dividir despesas entre amigos e grupos. Next.js 14 (App Router, Server Actions), Clerk (login), Neon (Postgres via `@neondatabase/serverless`), shadcn/ui, Tailwind, TypeScript.

## Mapa rápido
- `app/` — rotas (`groups`, `group`, `expense`, `import`, `sign-in`, `sign-up`) e `actions.ts` (Server Actions: onde ficam as escritas no banco).
- `lib/currency.ts` — conversão e formatação de moeda. Todo cálculo de dinheiro passa por aqui.
- `middleware.ts` — proteção de rotas pelo Clerk.
- `migrations/` e scripts soltos na raiz (`migrate_receipts.js`, `query_*.js`, `import_csv_data.js`) — mexem direto no banco. Trate como perigosos.
- Variáveis: `CLERK_SECRET_KEY`, `DATABASE_URL` etc. ficam em `.env.local` (fora do git). Modelo em `.env.example`.

## Como verificar (sempre antes de dizer que terminou)
1. `npm run lint`
2. `npm run build` (o build do Next também checa os tipos)
3. Se mexeu em tela, rode `npm run dev` e descreva o que testou. Se não conseguiu abrir, diga que não testou.

Este projeto **não tem testes automatizados**. Para regra de dinheiro, crie um teste ou mostre a conta feita à mão com números reais.

## Regras que não se quebram
- **Dinheiro**: nunca use `number` com ponto flutuante para somar ou dividir. Use centavos inteiros ou a função de `lib/currency.ts`. Em divisão, o resto de centavos precisa ir para alguém; a soma das partes tem que ser igual ao total. Mostre essa conferência.
- **Acesso a dados**: toda Server Action e toda consulta deve (1) pegar o usuário pelo Clerk no servidor, nunca de um parâmetro vindo do cliente, e (2) confirmar que ele **pertence ao grupo** daquele dado. Antes de entregar, pergunte-se: "um usuário logado consegue ler ou alterar o grupo de outra pessoa trocando um ID?"
- **SQL**: sempre com parâmetros (`sql\`... ${valor}\``), nunca montando texto com concatenação.
- **Segredos**: nunca no código nem em arquivo versionado. Nunca escreva chave do Clerk ou `DATABASE_URL` em exemplo, log ou resposta.
- **Scripts de banco da raiz** (`migrate_*`, `import_*`, `query_*`): não rode contra o banco real sem eu pedir. Mostre antes o que vão alterar e proponha um teste com `BEGIN ... ROLLBACK`.
- **Migrations**: só adicionam (coluna, tabela, índice). Nada de `DROP`/`DELETE`/`TRUNCATE` sem confirmação explícita minha.
- Não use `any`. Não desligue uma regra do ESLint para fazer passar.

## Skills (use sem eu pedir)
- Mexeu em login, grupo, permissão, banco, importação ou qualquer dado pessoal: rode `revisao-de-seguranca` antes de me entregar.
- Vou publicar uma versão: rode `auditoria-pre-release`.
- Algo está lento (lista de gastos, cálculo de saldo): use `otimizacao-medida`.

## Como trabalhar
- Mudança mínima: não refatore nem renomeie o que não foi pedido.
- Procure se já existe um componente ou função antes de criar outro (`components/`, `hooks/`, `lib/`).
- Causa raiz, não sintoma. Se a função é usada em vários lugares, ache todos os chamadores antes de mudar.
- Não faça commit nem push sem eu pedir.

## Como responder
Português, frases curtas, sem jargão. Termine sempre com: o que mudou, em quais arquivos, o que você rodou (e o resultado), e o que eu devo testar.
