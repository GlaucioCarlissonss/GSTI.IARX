import 'dotenv/config';
import { criarApp } from './app.js';
import { db } from './db/index.js';

const porta = Number(process.env.PORT ?? 3333);

db(); // abre a conexão e aplica o schema antes de aceitar requisições

criarApp().listen(porta, () => {
  console.log(`GSTI.IARX — API ouvindo em http://localhost:${porta}`);
});
