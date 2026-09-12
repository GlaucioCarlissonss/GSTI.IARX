import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo } from './apoio.js';
import {
  gravarChamado,
  listarChamados,
  normalizar,
  normalizarBitrix24,
  normalizarOstick,
  obterChamado,
  opcoesDeFiltro,
  validarChamado,
} from '../src/domain/suporte.js';
import { listarSetores, SETOR_NAO_CLASSIFICADO } from '../src/domain/cadastros.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { gravarUrlHelpdesk, listarTicketsSla } from '../src/domain/sla.js';

test('OStick e Bitrix24 caem no mesmo modelo, apesar dos nomes diferentes', () => {
  const ostick = normalizarOstick({
    ticket_id: '21734',
    subject: 'Erro ao emitir nota',
    body: 'A nota não sai desde ontem.',
    status: 'Em andamento',
    priority: 'Alta',
    department: 'Financeiro',
    staff: 'João Silva',
    user: 'Maria Souza',
    email: 'maria@empresa.com',
    created: '10/09/2026 08:30',
  });
  const bitrix = normalizarBitrix24({
    ID: 987,
    TITLE: 'Erro ao emitir nota',
    DESCRIPTION: 'A nota não sai desde ontem.',
    STAGE_ID: 'IN_PROGRESS',
    PRIORITY: 'high',
    DEPARTMENT: 'Financeiro',
    RESPONSIBLE_NAME: 'João Silva',
    CREATED_BY_NAME: 'Maria Souza',
    EMAIL: 'maria@empresa.com',
    DATE_CREATE: '2026-09-10T08:30:00Z',
  });

  // Tudo igual exceto a identidade da origem — que é justamente o ponto.
  for (const campo of ['title', 'description', 'status', 'priority', 'sector', 'attendant_name', 'requester_name', 'requester_email', 'opened_at'] as const) {
    assert.equal(ostick[campo], bitrix[campo], `campo "${campo}" divergiu entre os dois sistemas`);
  }
  assert.equal(ostick.status, 'in_progress');
  assert.equal(ostick.priority, 'high');
  assert.equal(ostick.external_id, '21734');
  assert.equal(bitrix.external_id, '987');
  assert.equal(ostick.opened_at, '2026-09-10T08:30Z');
});

test('status desconhecido vira "open", não "closed"', () => {
  // Um chamado de status incompreensível está em aberto até prova em
  // contrário: tratá-lo como fechado esconderia trabalho pendente.
  for (const bruto of ['', 'ZZZ', null, undefined, 'Aguardando terceiro']) {
    const c = normalizarOstick({ ticket_id: '1', subject: 'x', status: bruto });
    assert.ok(['open', 'in_progress'].includes(c.status), `"${bruto}" virou ${c.status}`);
  }
  assert.equal(normalizarOstick({ ticket_id: '1', subject: 'x', status: 'Encerrado' }).status, 'closed');
  assert.equal(normalizarOstick({ ticket_id: '1', subject: 'x', status: 'Resolvido' }).status, 'resolved');
});

test('payload sem external_id ou sem título é recusado, e a mensagem diz o que falta', () => {
  assert.throws(
    () => validarChamado(normalizar('OSTICK', { subject: 'sem id' })),
    /external_id/,
  );
  assert.throws(
    () => validarChamado(normalizar('BITRIX24', { ID: 5 })),
    /title/,
  );
});

test('reentrega do mesmo chamado atualiza, nunca duplica', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const payload = {
    ticket_id: '21734',
    subject: 'Impressora sem rede',
    status: 'Aberto',
    department: 'Enfermagem',
    user: 'Maria',
    staff: 'João',
    created: '01/08/2026 09:00',
    due_at: '03/08/2026 09:00',
  };

  const primeiro = gravarChamado(empresaId, normalizar('OSTICK', payload), payload);
  assert.equal(primeiro.criado, true);

  // Mesma entrega, de novo — é o que toda fila de integração pode fazer.
  const repetido = gravarChamado(empresaId, normalizar('OSTICK', payload), payload);
  assert.equal(repetido.criado, false);
  assert.equal(repetido.ticket_id, primeiro.ticket_id);
  assert.equal(listarChamados(empresaId).paginacao.total, 1);

  // Agora com o fechamento: o mesmo registro é atualizado.
  const fechado = { ...payload, status: 'Fechado', closed: '02/08/2026 10:00', hours: 25 };
  gravarChamado(empresaId, normalizar('OSTICK', fechado), fechado);
  const lista = listarChamados(empresaId);
  assert.equal(lista.paginacao.total, 1);
  assert.equal((lista.itens[0] as Record<string, unknown>).status, 'closed');
  assert.equal((lista.itens[0] as Record<string, unknown>).horas, 25);
  // Fechou dentro do prazo (02/08 < 03/08): conta como dentro do SLA.
  assert.equal(lista.resumo.dentro_sla, 1);
  assert.equal(lista.resumo.pct_dentro_sla, 100);

  // O mesmo id no OUTRO sistema é outro chamado: a chave é composta.
  const bitrix = { ID: '21734', TITLE: 'Outro assunto', DEPARTMENT: 'TI' };
  gravarChamado(empresaId, normalizar('BITRIX24', bitrix), bitrix);
  assert.equal(listarChamados(empresaId).paginacao.total, 2);
  assert.equal(listarChamados(empresaId, { sistemas: ['OSTICK'] }).paginacao.total, 1);
  assert.equal(listarChamados(empresaId, { sistemas: ['BITRIX24'] }).paginacao.total, 1);

  void ctx;
});

test('setor ausente vira "Não classificado" em vez de recusar o chamado', () => {
  const { ctx, empresaId } = ambienteLimpo();
  const semSetor = { ticket_id: '99', subject: 'Sem setor informado' };
  const gravado = gravarChamado(empresaId, normalizar('OSTICK', semSetor), semSetor);
  assert.equal(gravado.setor, SETOR_NAO_CLASSIFICADO);

  const comSetor = { ticket_id: '100', subject: 'Com setor', department: 'Faturamento' };
  assert.equal(gravarChamado(empresaId, normalizar('OSTICK', comSetor), comSetor).setor, 'Faturamento');

  // O setor novo entra no catálogo da empresa, como os demais cadastros.
  const nomes = (listarSetores(ctx) as Array<{ nome: string }>).map((s) => s.nome).sort();
  assert.deepEqual(nomes, [SETOR_NAO_CLASSIFICADO, 'Faturamento'].sort());
});

test('filtros recortam por setor, atendente, solicitante, status e busca', () => {
  const { empresaId } = ambienteLimpo();
  const entrar = (p: Record<string, unknown>) => gravarChamado(empresaId, normalizar('OSTICK', p), p);
  entrar({ ticket_id: '1', subject: 'Impressora travada', department: 'Enfermagem', staff: 'João', user: 'Maria', status: 'Aberto' });
  entrar({ ticket_id: '2', subject: 'VPN fora do ar', department: 'TI', staff: 'Ana', user: 'Carlos', status: 'Fechado', closed: '02/08/2026 10:00' });
  entrar({ ticket_id: '3', subject: 'Impressora sem toner', department: 'Enfermagem', staff: 'Ana', user: 'Maria', status: 'Aberto' });

  const opcoes = opcoesDeFiltro(empresaId);
  assert.deepEqual((opcoes.setores as Array<{ nome: string }>).map((s) => s.nome).sort(), ['Enfermagem', 'TI']);
  assert.deepEqual(opcoes.atendentes.sort(), ['Ana', 'João']);
  assert.deepEqual(opcoes.solicitantes.sort(), ['Carlos', 'Maria']);

  const enfermagem = (opcoes.setores as Array<{ id: number; nome: string }>).find((s) => s.nome === 'Enfermagem')!;
  assert.equal(listarChamados(empresaId, { setorIds: [enfermagem.id] }).paginacao.total, 2);
  assert.equal(listarChamados(empresaId, { atendentes: ['Ana'] }).paginacao.total, 2);
  assert.equal(listarChamados(empresaId, { solicitantes: ['Maria'] }).paginacao.total, 2);
  assert.equal(listarChamados(empresaId, { status: ['closed'] }).paginacao.total, 1);
  assert.equal(listarChamados(empresaId, { busca: 'impressora' }).paginacao.total, 2);
  assert.equal(listarChamados(empresaId, { busca: 'toner' }).paginacao.total, 1);

  // O resumo é do mesmo recorte: os números do detalhamento batem com o filtro.
  const soAna = listarChamados(empresaId, { atendentes: ['Ana'] });
  assert.equal(soAna.resumo.total, 2);
  assert.equal(soAna.resumo.em_aberto, 1);
});

test('o detalhe traz o payload como chegou, para reconferir contra a origem', () => {
  const { empresaId } = ambienteLimpo();
  const bruto = { ticket_id: '55', subject: 'Chamado com anexo', campo_exotico: { a: 1, b: [2, 3] } };
  const { ticket_id } = gravarChamado(empresaId, normalizar('OSTICK', bruto), bruto);
  const detalhe = obterChamado(empresaId, ticket_id) as Record<string, unknown>;
  assert.deepEqual(detalhe.raw_payload, bruto);
  assert.ok(detalhe.synced_at, 'o momento da sincronização fica registrado');
  assert.equal(detalhe.source_system, 'OSTICK');
});

test('chamado de uma empresa não aparece na outra', () => {
  const { ctx, empresaId: empresaA } = ambienteLimpo();
  // Duas empresas no MESMO banco: é esse o estado em que um vazamento
  // apareceria, não o de dois bancos separados.
  const empresaB = criarEmpresa(ctx.usuarioId, { nome: 'Segunda Empresa' }).id;

  const p = { ticket_id: '777', subject: 'Só da empresa A', department: 'TI' };
  gravarChamado(empresaA, normalizar('OSTICK', p), p);
  assert.equal(listarChamados(empresaA).paginacao.total, 1);
  assert.equal(listarChamados(empresaB).paginacao.total, 0);

  // O mesmo id externo nas duas empresas são dois chamados distintos: elas
  // podem usar instâncias separadas do mesmo helpdesk.
  gravarChamado(empresaB, normalizar('OSTICK', p), p);
  assert.equal(listarChamados(empresaA).paginacao.total, 1);
  assert.equal(listarChamados(empresaB).paginacao.total, 1);

  // E o setor criado numa empresa não aparece no catálogo da outra.
  const setoresB = listarSetores({ ...ctx, empresaId: empresaB }) as Array<{ nome: string }>;
  assert.equal(setoresB.length, 1);
});

test('o endereço do chamado sai do servidor, pronto e igual em toda tela', () => {
  const { ctx } = ambienteLimpo();
  const bruto = {
    ticket_id: '21734', number: '21734', subject: 'Impressora sem toner', status: 'closed',
    created: '2026-08-01T09:00:00Z', closed: '2026-08-01T11:00:00Z',
    name: 'Maria', staff: 'Carlos', department: 'Enfermagem',
  };
  gravarChamado(ctx.empresaId, normalizarOstick(bruto), bruto);

  const daListagem = listarChamados(ctx.empresaId, {}).itens[0] as Record<string, unknown>;
  const url = daListagem.url_externa as string;
  assert.match(url, /21734$/);

  // Listagem, detalhe e o registro visto pelo módulo de SLA têm de apontar
  // para o mesmo lugar: telas que remontam a URL por conta própria divergem.
  const doDetalhe = obterChamado(ctx.empresaId, daListagem.id as number) as Record<string, unknown>;
  assert.equal(doDetalhe.url_externa, url);
  const doSla = listarTicketsSla(ctx).itens.find((r) => r.external_id === '21734');
  assert.equal(doSla?.url_externa, url);
});

test('chamado sem ticket_id ainda ganha endereço, pelo id de origem', () => {
  const { ctx } = ambienteLimpo();
  const bruto = { ticket_id: '900', subject: 'Chegou por webhook', status: 'open', created: '2026-08-02T09:00:00Z' };
  gravarChamado(ctx.empresaId, normalizarOstick(bruto), bruto);
  // O chamado que chega por webhook grava `external_id` e deixa `ticket_id`
  // nulo; usar só `ticket_id` deixava esses registros sem link nenhum.
  const linha = listarTicketsSla(ctx).itens.find((r) => r.external_id === '900');
  assert.equal(linha?.ticket_id, null);
  assert.match(String(linha?.url_externa), /id=900$/);
});

test('sem base configurada para a origem, não há link adivinhado', () => {
  const { ctx } = ambienteLimpo();
  const doBitrixBruto = { ID: '55', TITLE: 'Chamado do Bitrix', STAGE_ID: 'NEW', CREATED_TIME: '2026-08-03T09:00:00Z' };
  gravarChamado(ctx.empresaId, normalizarBitrix24(doBitrixBruto), doBitrixBruto);
  const doBitrix = listarChamados(ctx.empresaId, {}).itens[0] as Record<string, unknown>;
  // Só o osTicket tem endereço padrão. Um endereço inventado para o Bitrix24
  // levaria o gestor a uma página que não existe.
  assert.equal(doBitrix.url_externa, null);

  gravarUrlHelpdesk(ctx, 'https://helpdesk.exemplo.com/t/');
  const outroBruto = { ticket_id: '77', subject: 'x', status: 'open', created: '2026-08-04T09:00:00Z' };
  gravarChamado(ctx.empresaId, normalizarOstick(outroBruto), outroBruto);
  const comBaseTrocada = listarChamados(ctx.empresaId, { busca: 'x' }).itens[0] as Record<string, unknown>;
  assert.equal(comBaseTrocada.url_externa, 'https://helpdesk.exemplo.com/t/77');
});
