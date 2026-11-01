import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ambienteLimpo, contextoDe } from './apoio.js';
import {
  ACOES,
  atualizarPerfil,
  criarPerfil,
  duplicarPerfil,
  excluirPerfil,
  exigirPermissao,
  filtrarCampos,
  garantirPerfisPadrao,
  listarPerfis,
  permissoesDoUsuario,
  permitido,
  PERFIL_EDICAO,
  PERFIL_LEITURA,
} from '../src/domain/acesso.js';
import {
  atualizarUsuario,
  criarUsuario,
  listarUsuarios,
  redefinirSenhaDeUsuario,
  removerAcesso,
} from '../src/domain/usuarios.js';
import { autenticar, verificarToken } from '../src/domain/auth.js';
import { pedirRedefinicao, redefinirSenha } from '../src/domain/senha.js';
import { criarEmpresa } from '../src/domain/empresas.js';
import { db } from '../src/db/index.js';
import type { Contexto } from '../src/domain/contexto.js';

/** Contexto de um usuário criado pelo administrador, neste cliente. */
function comoUsuario(ctx: Contexto, id: number): Contexto {
  const v = db()
    .prepare('SELECT papel FROM usuario_clientes WHERE usuario_id = ? AND cliente_id = ?')
    .get(id, ctx.clienteId) as { papel: string };
  return { ...ctx, usuarioId: id, papel: v.papel as Contexto['papel'] };
}

test('a empresa nasce com os dois perfis padrão', () => {
  const { ctx } = ambienteLimpo();
  const perfis = listarPerfis(ctx);
  assert.deepEqual(perfis.map((p) => p.nome).sort(), [PERFIL_EDICAO, PERFIL_LEITURA].sort());
  assert.equal(perfis.every((p) => p.padrao), true);
});

test('somente visualização vê o conteúdo e não escreve nada', () => {
  const { ctx } = ambienteLimpo();
  const leitura = listarPerfis(ctx).find((p) => p.nome === PERFIL_LEITURA)!;
  // Quem tem acesso, com que e-mail e papel, e o endereço de cada integração
  // são informação de ADMINISTRAÇÃO, e não conteúdo somente leitura.
  const administrativos = ['usuarios', 'integracoes'];
  for (const modulo of Object.keys(leitura.permissoes)) {
    const deveVer = !administrativos.includes(modulo);
    assert.equal(leitura.permissoes[modulo]?.view, deveVer, `${modulo}: view deveria ser ${deveVer}`);
    for (const acao of ACOES.filter((a) => a !== 'view')) {
      // Exportar é escrita nenhuma, mas é saída de dado: não entra no perfil
      // de leitura por engano.
      assert.equal(leitura.permissoes[modulo]?.[acao], false, `${modulo}/${acao} deveria ser negado`);
    }
  }
});

test('o perfil de edição não administra acessos', () => {
  const { ctx } = ambienteLimpo();
  const edicao = listarPerfis(ctx).find((p) => p.nome === PERFIL_EDICAO)!;
  assert.equal(edicao.permissoes.financeiro?.edit, true);
  // Dar permissão a si mesmo é o caminho mais curto para o perfil deixar de
  // significar alguma coisa.
  assert.equal(edicao.permissoes.usuarios?.view, false);
  assert.equal(edicao.permissoes.usuarios?.edit, false);
});

test('o leitor não cria, não edita, não exclui e não exporta', () => {
  const { ctx } = ambienteLimpo();
  const leitor = criarUsuario(ctx, {
    nome: 'Leitor', username: 'leitor', email: 'leitor@exemplo.com', senha: 'senha-forte-1', papel: 'leitor',
  });
  const dele = comoUsuario(ctx, leitor.id);

  assert.equal(permitido(dele, 'financeiro', 'view'), true);
  for (const acao of ACOES.filter((a) => a !== 'view')) {
    assert.equal(permitido(dele, 'financeiro', acao), false, `financeiro/${acao}`);
    assert.throws(() => exigirPermissao(dele, 'financeiro', acao), /perfil não permite/);
  }
});

test('a mensagem de recusa nomeia o módulo, e não o identificador interno', () => {
  const { ctx } = ambienteLimpo();
  const leitor = criarUsuario(ctx, {
    nome: 'Leitor', username: 'leitor2', email: 'l2@exemplo.com', senha: 'senha-forte-1', papel: 'leitor',
  });
  assert.throws(
    () => exigirPermissao(comoUsuario(ctx, leitor.id), 'suporte_ostick', 'edit'),
    /Suporte \(OStick\)/,
  );
});

test('perfil personalizado controla módulo a módulo', () => {
  const { ctx } = ambienteLimpo();
  const perfil = criarPerfil(ctx, {
    nome: 'Só financeiro',
    tipo: 'EDIT',
    permissoes: {
      financeiro: { view: true, create: true, edit: true, export: true },
      projetos: { view: true },
      suporte_ostick: {},
    },
  });
  const usuario = criarUsuario(ctx, {
    nome: 'Fin', username: 'fin', email: 'fin@exemplo.com', senha: 'senha-forte-1',
    papel: 'leitor', perfil_id: perfil.id,
  });
  const dele = comoUsuario(ctx, usuario.id);

  assert.equal(permitido(dele, 'financeiro', 'create'), true);
  assert.equal(permitido(dele, 'financeiro', 'delete'), false);
  assert.equal(permitido(dele, 'projetos', 'view'), true);
  assert.equal(permitido(dele, 'projetos', 'edit'), false);
  assert.equal(permitido(dele, 'suporte_ostick', 'view'), false);
});

test('ação marcada sem o módulo visível não vale', () => {
  const { ctx } = ambienteLimpo();
  // Sem ver o módulo não há o que criar nele: deixar as duas coisas
  // desencontradas daria uma matriz que mente.
  const perfil = criarPerfil(ctx, {
    nome: 'Contraditório', tipo: 'EDIT', permissoes: { financeiro: { view: false, create: true, edit: true } },
  });
  assert.equal(perfil.permissoes.financeiro?.create, false);
  assert.equal(perfil.permissoes.financeiro?.edit, false);
});

test('campos bloqueados são retirados da alteração, e a tela fica sabendo', () => {
  const { ctx } = ambienteLimpo();
  const perfil = criarPerfil(ctx, {
    nome: 'Edita sem valor', tipo: 'EDIT',
    permissoes: { financeiro: { view: true, edit: true } },
    campos_bloqueados: { financeiro: ['valor', 'competencia'] },
  });
  const usuario = criarUsuario(ctx, {
    nome: 'Sem valor', username: 'semvalor', email: 'sv@exemplo.com', senha: 'senha-forte-1',
    papel: 'leitor', perfil_id: perfil.id,
  });
  const dele = comoUsuario(ctx, usuario.id);

  const r = filtrarCampos(dele, 'financeiro', { descricao: 'nova', valor: 999, competencia: '01/2027' });
  assert.deepEqual(r.dados, { descricao: 'nova' });
  // A tela precisa dizer o que não foi salvo, em vez de fingir que salvou tudo.
  assert.deepEqual(r.bloqueados.sort(), ['competencia', 'valor']);

  // Sem nenhuma linha para o módulo, valem todos os campos.
  assert.deepEqual(filtrarCampos(dele, 'projetos', { nome: 'x' }).dados, { nome: 'x' });
});

test('o gestor administra acessos mesmo sem o perfil permitir', () => {
  const { ctx } = ambienteLimpo();
  // Fosse preciso um perfil para isso, uma configuração errada trancaria todo
  // mundo para fora da própria tela de acessos.
  assert.equal(permitido(ctx, 'usuarios', 'view'), true);
  assert.equal(permitido(ctx, 'usuarios', 'create'), true);
});

test('duplicar leva a matriz junto, e o padrão não se renomeia nem se exclui', () => {
  const { ctx } = ambienteLimpo();
  const leitura = listarPerfis(ctx).find((p) => p.nome === PERFIL_LEITURA)!;

  const copia = duplicarPerfil(ctx, leitura.id, 'Leitura do financeiro');
  assert.equal(copia.nome, 'Leitura do financeiro');
  assert.deepEqual(copia.permissoes, leitura.permissoes);
  assert.equal(copia.padrao, false);

  assert.throws(() => atualizarPerfil(ctx, leitura.id, { nome: 'Outro nome' }), /não podem ser renomeados/);
  assert.throws(() => excluirPerfil(ctx, leitura.id), /não podem ser excluídos/);

  // O duplicado, sim, muda e some.
  atualizarPerfil(ctx, copia.id, { nome: 'Leitura FIN' });
  assert.equal(excluirPerfil(ctx, copia.id).excluido, true);
});

test('perfil em uso não é excluído em silêncio', () => {
  const { ctx } = ambienteLimpo();
  const perfil = criarPerfil(ctx, { nome: 'Em uso', tipo: 'EDIT', permissoes: { projetos: { view: true } } });
  criarUsuario(ctx, {
    nome: 'Alguém', username: 'alguem', email: 'a@exemplo.com', senha: 'senha-forte-1', perfil_id: perfil.id,
  });
  assert.throws(() => excluirPerfil(ctx, perfil.id), /em uso por 1 usuário/);
});

test('o administrador não se desativa nem se rebaixa', () => {
  const { ctx } = ambienteLimpo();
  assert.throws(() => atualizarUsuario(ctx, ctx.usuarioId, { ativo: false }), /própria conta/);
  assert.throws(() => atualizarUsuario(ctx, ctx.usuarioId, { papel: 'leitor' }), /próprio papel/);
  assert.throws(() => removerAcesso(ctx, ctx.usuarioId), /próprio acesso/);
});

test('a última conta de gestor não é removida', () => {
  const { ctx } = ambienteLimpo();
  const outro = criarUsuario(ctx, {
    nome: 'Outro gestor', username: 'outrog', email: 'og@exemplo.com', senha: 'senha-forte-1', papel: 'gestor',
  });
  // Com dois gestores, dá para remover um.
  assert.equal(removerAcesso(comoUsuario(ctx, outro.id), ctx.usuarioId).removido, true);
  // Sobrou um: a empresa não pode ficar sem quem conceda acesso de volta.
  const soUm = comoUsuario(ctx, outro.id);
  const terceiro = criarUsuario(soUm, {
    nome: 'Leitor', username: 'leitor3', email: 'l3@exemplo.com', senha: 'senha-forte-1', papel: 'leitor',
  });
  assert.throws(() => removerAcesso(comoUsuario(soUm, terceiro.id), outro.id), /última conta.*gestor/i);
});

test('usuário de outro cliente não aparece nem é alterável', () => {
  const { ctx } = ambienteLimpo();
  const daqui = criarUsuario(ctx, {
    nome: 'Daqui', username: 'daqui', email: 'd@exemplo.com', senha: 'senha-forte-1',
  });
  // Um cliente de verdade, e não um id inventado: sem `clienteId`, `criarEmpresa`
  // abre um contratante novo — o segundo cliente tem os próprios perfis, e é
  // isso que o isolamento precisa exercitar. (Duas matrizes do MESMO cliente já
  // compartilham usuários e perfis por regra — não há mais isolamento entre
  // elas; ver `escopo.test.ts`.)
  const outraEmpresa = criarEmpresa(ctx.usuarioId, { nome: 'Outro cliente' }) as { id: number };
  const outra: Contexto = contextoDe(ctx, outraEmpresa.id);

  assert.equal(listarUsuarios(outra).some((u) => u.id === daqui.id), false);
  // Responder "não está neste cliente" já contaria que a conta existe.
  assert.throws(() => atualizarUsuario(outra, daqui.id, { nome: 'X' }), /não encontrado/);

  // E os perfis de um não valem no outro.
  const perfilDaqui = listarPerfis(ctx).find((p) => p.nome === PERFIL_EDICAO)!;
  assert.throws(
    () => criarUsuario(outra, {
      nome: 'X', username: 'xoutra', email: 'x@outra.com', senha: 'senha-forte-1',
      perfil_id: perfilDaqui.id,
    }),
    /não existe neste cliente/,
  );
});

test('redefinir a senha derruba as sessões abertas', () => {
  const { ctx } = ambienteLimpo();
  const usuario = criarUsuario(ctx, {
    nome: 'Alvo', username: 'alvo', email: 'alvo@exemplo.com', senha: 'senha-antiga-1',
  });
  const { token } = autenticar('alvo', 'senha-antiga-1');
  assert.equal(verificarToken(token).usuarioId, usuario.id);

  redefinirSenhaDeUsuario(ctx, usuario.id, 'senha-nova-2');
  // Trocar a senha sem expulsar quem está dentro não troca nada de fato.
  assert.throws(() => verificarToken(token), /Sessão inválida/);
  assert.ok(autenticar('alvo', 'senha-nova-2').token);
});

test('o pedido de redefinição responde o mesmo com e sem conta', async () => {
  const { ctx } = ambienteLimpo();
  criarUsuario(ctx, { nome: 'Alvo', username: 'alvo2', email: 'alvo2@exemplo.com', senha: 'senha-antiga-1' });
  const comConta = await pedirRedefinicao('alvo2@exemplo.com', 'http://local');
  const semConta = await pedirRedefinicao('ninguem@exemplo.com', 'http://local');
  // Dizer "não há usuário com esse e-mail" entrega a lista de cadastrados.
  assert.equal(comConta.aviso, semConta.aviso);
});

test('o token de redefinição é de uso único, expira e invalida o anterior', async () => {
  const { ctx } = ambienteLimpo();
  const usuario = criarUsuario(ctx, {
    nome: 'Alvo', username: 'alvo3', email: 'alvo3@exemplo.com', senha: 'senha-antiga-1',
  });

  /** O token em claro só existe na mensagem: é de lá que o teste o lê. */
  const ultimoToken = () => {
    const email = db()
      .prepare('SELECT corpo FROM emails_enviados ORDER BY id DESC LIMIT 1')
      .get() as { corpo: string };
    return decodeURIComponent(email.corpo.match(/token=([^\s]+)/)![1]!);
  };

  await pedirRedefinicao('alvo3@exemplo.com', 'http://local');
  const primeiro = ultimoToken();
  await pedirRedefinicao('alvo3@exemplo.com', 'http://local');
  const segundo = ultimoToken();

  // Dois links válidos ao mesmo tempo dobram a janela de quem interceptar um.
  assert.throws(() => redefinirSenha(primeiro, 'senha-nova-2'), /não vale mais/);
  assert.equal(redefinirSenha(segundo, 'senha-nova-2').redefinida, true);
  // Uso único.
  assert.throws(() => redefinirSenha(segundo, 'outra-senha-3'), /não vale mais/);
  assert.ok(autenticar('alvo3', 'senha-nova-2').token);

  db().prepare(`UPDATE tokens_redefinicao SET usado_em = NULL, expira_em = '2020-01-01T00:00:00.000Z'`).run();
  assert.throws(() => redefinirSenha(segundo, 'mais-uma-4'), /não vale mais/);
  void usuario;
});

test('o token vencido, usado e inexistente dão a mesma recusa', async () => {
  const { ctx } = ambienteLimpo();
  criarUsuario(ctx, { nome: 'Alvo', username: 'alvo4', email: 'alvo4@exemplo.com', senha: 'senha-antiga-1' });
  const inexistente = (() => {
    try { redefinirSenha('nao-existe', 'senha-nova-2'); } catch (e) { return (e as Error).message; }
  })();
  await pedirRedefinicao('alvo4@exemplo.com', 'http://local');
  const email = db().prepare('SELECT corpo FROM emails_enviados ORDER BY id DESC LIMIT 1').get() as { corpo: string };
  const token = decodeURIComponent(email.corpo.match(/token=([^\s]+)/)![1]!);
  redefinirSenha(token, 'senha-nova-2');
  const usado = (() => {
    try { redefinirSenha(token, 'outra-5'); } catch (e) { return (e as Error).message; }
  })();
  // Distinguir os três contaria a quem tenta adivinhar quão perto chegou.
  assert.equal(inexistente, usado);
});

test('sem SMTP o sistema não diz que enviou', async () => {
  const { ctx } = ambienteLimpo();
  criarUsuario(ctx, { nome: 'Alvo', username: 'alvo5', email: 'alvo5@exemplo.com', senha: 'senha-antiga-1' });
  const r = await pedirRedefinicao('alvo5@exemplo.com', 'http://local');
  // Dizer que enviou sem ter enviado é pior do que não enviar: a mensagem fica
  // registrada, com o motivo, e o aviso ao usuário segue genérico.
  assert.equal(r.enviado, false);
  assert.match(String(r.motivo), /SMTP/);
  const registrado = db().prepare('SELECT enviado, erro FROM emails_enviados ORDER BY id DESC LIMIT 1').get() as
    { enviado: number; erro: string };
  assert.equal(registrado.enviado, 0);
  assert.match(registrado.erro, /SMTP/);
});

test('o corpo do e-mail não vaza no log estruturado', async () => {
  const { ctx } = ambienteLimpo();
  criarUsuario(ctx, { nome: 'Alvo', username: 'alvo6', email: 'alvo6@exemplo.com', senha: 'senha-antiga-1' });
  const original = console.log;
  const linhas: string[] = [];
  console.log = (...a: unknown[]) => { linhas.push(a.map(String).join(' ')); };
  try {
    await pedirRedefinicao('alvo6@exemplo.com', 'http://local');
  } finally {
    console.log = original;
  }
  const doEmail = linhas.find((l) => l.includes('"evento":"email"'));
  assert.ok(doEmail, 'o envio precisa deixar uma linha de log');
  // O corpo carrega o link de redefinição: ele não entra no log.
  assert.equal(doEmail!.includes('token='), false);
});

test('as permissões do usuário acompanham o cliente em foco', () => {
  const { ctx } = ambienteLimpo();
  garantirPerfisPadrao(ctx.clienteId!);
  const p = permissoesDoUsuario(ctx.usuarioId, ctx.clienteId!);
  assert.equal(p.papel, 'gestor');
  // Sem perfil atribuído, o papel antigo responde: a migração não pode tirar
  // acesso de quem já tinha.
  assert.equal(p.perfil?.nome, PERFIL_EDICAO);
  assert.equal(p.permissoes.financeiro?.edit, true);
});
