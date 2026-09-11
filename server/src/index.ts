import { carregarAmbiente } from './lib/ambiente.js';

carregarAmbiente();

const { criarApp } = await import('./app.js');
const { db } = await import('./db/index.js');
const { segredoJwt } = await import('./domain/auth.js');

const porta = Number(process.env.PORT ?? 3333);

/**
 * Escuta apenas em loopback por padrão. A base guarda folha e contratos, e a
 * aplicação não termina TLS por conta própria: expor à rede é uma decisão
 * explícita, feita com HOST=0.0.0.0 e um proxy reverso na frente.
 */
const host = process.env.HOST ?? '127.0.0.1';

// Falha na partida, e não no primeiro login: subir sem segredo de sessão
// configurado é um erro de instalação que deve aparecer de imediato.
try {
  segredoJwt();
} catch (erro) {
  console.error(`\nGSTI.IARX não pode iniciar: ${erro instanceof Error ? erro.message : String(erro)}\n`);
  process.exit(1);
}

db(); // abre a conexão e aplica o schema antes de aceitar requisições

criarApp().listen(porta, host, () => {
  const alcance = host === '127.0.0.1' || host === 'localhost' ? 'somente nesta máquina' : `exposto em ${host}`;
  console.log(`GSTI.IARX — API ouvindo em http://localhost:${porta} (${alcance})`);
});
