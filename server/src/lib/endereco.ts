/**
 * O endereço público do sistema — o link único de acesso.
 *
 * Todo cliente entra pelo MESMO endereço: o contratante é escolhido dentro do
 * sistema, depois de entrar. Um endereço por cliente exigiria uma instalação
 * por cliente, e a camada de cliente existe justamente para evitar isso.
 *
 * O endereço é CONFIGURADO, e não deduzido da requisição. O cabeçalho `Host`
 * vem de quem chama: um pedido de redefinição de senha com `Host: exemplo-
 * falso.com` produziria um e-mail, para o endereço real da pessoa, com um
 * link válido apontando para o site de quem pediu. Sem `APP_URL`, o endereço
 * da requisição ainda é usado — é o caso do desenvolvimento local, onde não há
 * proxy nem domínio —, e o aviso ao iniciar diz que isso está acontecendo.
 */
import type { Request } from 'express';

/** O endereço configurado, normalizado e sem barra final. `null` se não houver. */
export function enderecoConfigurado(): string | null {
  const bruto = String(process.env.APP_URL ?? '').trim();
  if (!bruto) return null;
  try {
    const url = new URL(bruto);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * A base para montar um link que sai do sistema (e-mail, por exemplo).
 *
 * Com `APP_URL` definido, é ele — sempre, e sem consultar a requisição.
 */
export function baseDeLink(req: Request): string {
  const configurado = enderecoConfigurado();
  if (configurado) return configurado;
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

/**
 * Deve confiar nos cabeçalhos `X-Forwarded-*`?
 *
 * Só atrás de um proxy reverso, e por opção explícita: confiar sem proxy deixa
 * qualquer requisição forjar o próprio IP, e é o IP que o bloqueio por
 * tentativas de senha usa para contar.
 */
export function confiaNoProxy(): boolean {
  const v = String(process.env.TRUST_PROXY ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'sim';
}
