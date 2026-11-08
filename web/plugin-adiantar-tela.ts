/**
 * ADIANTA O ARQUIVO DA TELA que está sendo aberta.
 *
 * ## O problema que ele resolve
 *
 * Dividir as rotas cortou o pacote inicial de 554 kB para 299 kB, mas criou
 * uma FILA: o navegador só descobre de que arquivo a tela precisa depois de
 * baixar E executar o pacote principal. São duas viagens em sequência onde
 * antes havia uma.
 *
 * Medido, antes deste plugin, com a rede estrangulada:
 *
 *   rede 4g  — pacote único 1031 ms · dividido 1307 ms  (PIOR, apesar de -40% de bytes)
 *   rede 3g  — pacote único 4014 ms · dividido 3283 ms  (melhor)
 *
 * Isto é o esperado: onde a banda é larga, os bytes poupados não custavam
 * nada e a viagem extra custa; onde a banda é estreita, os bytes mandam.
 * Entregar assim seria trocar uma piora no caso comum por uma melhora no caso
 * ruim — e o caso comum é o do gestor no escritório.
 *
 * ## O que ele faz
 *
 * Escreve no `index.html`, dentro do `<head>`, um script minúsculo e SÍNCRONO
 * com o mapa `rota → arquivos`. Ele roda enquanto o HTML ainda está sendo
 * lido, antes de o pacote principal terminar de chegar, e injeta
 * `<link rel="modulepreload">` para os arquivos daquela rota. As duas viagens
 * passam a acontecer LADO A LADO em vez de uma depois da outra.
 *
 * Preload é uma dica, não uma obrigação: se a rota não estiver no mapa — uma
 * URL desconhecida, um link antigo — o script não faz nada e a aplicação
 * segue pelo caminho normal, só sem o adiantamento.
 *
 * ## Por que o mapa é EXTRAÍDO de `rotas.ts`
 *
 * Uma segunda lista de rotas, escrita à mão aqui, divergiria da primeira na
 * próxima tela que alguém acrescentasse — e divergir aqui não quebra nada
 * visível: só faz o adiantamento buscar a tela errada, em silêncio, para
 * sempre. Por isso o mapa sai do PRÓPRIO `rotas.ts`, e a extração falha a
 * compilação se não reconhecer o que leu. Um plugin de desempenho que se cala
 * ao quebrar é pior do que nenhum: ele faz a medição mentir.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * A raiz do app. `__dirname` não existe quando o Vite carrega a configuração
 * como módulo ESM, e `process.cwd()` é onde o `npm run build` roda — que é
 * sempre `web/`, porque é lá que mora o `package.json` que define o script.
 */
const RAIZ = process.cwd();

/** `painelExecutivo: { rota: '/', de: () => import('./pages/X'), ... }` */
const ENTRADA = /^\s*(\w+):\s*\{\s*rota:\s*'([^']+)',\s*de:\s*\(\)\s*=>\s*import\('([^']+)'\)/gm;

/** Quantas telas `rotas.ts` deve ter. Serve de trava contra extração parcial. */
const MINIMO_DE_TELAS = 20;

export function adiantarTela(): Plugin {
  // rota -> caminho do arquivo de página, como `rotas.ts` o escreve
  const rotaParaPagina = new Map<string, string>();

  return {
    name: 'gsti-adiantar-tela',
    apply: 'build',
    // DEPOIS do plugin de HTML do próprio Vite: é ele que cria `index.html`
    // no pacote, e sem esperar por isso não há onde escrever.
    enforce: 'post',

    buildStart() {
      const fonte = readFileSync(resolve(RAIZ, 'src/rotas.ts'), 'utf8');
      rotaParaPagina.clear();
      for (const m of fonte.matchAll(ENTRADA)) rotaParaPagina.set(m[2]!, m[3]!);
      if (rotaParaPagina.size < MINIMO_DE_TELAS) {
        // Falhar aqui é deliberado. Se o formato de `rotas.ts` mudar, o
        // silêncio produziria um build que PARECE otimizado e não está.
        this.error(
          `adiantar-tela: li ${rotaParaPagina.size} telas em src/rotas.ts, esperava pelo menos `
          + `${MINIMO_DE_TELAS}. O formato das entradas mudou — ajuste a expressão ENTRADA neste plugin.`,
        );
      }
    },

    generateBundle(_opcoes, pacote) {
      // Arquivo de origem -> arquivo gerado. O Rollup já resolveu cada
      // `import()` dinâmico num pedaço próprio; `facadeModuleId` é o elo.
      const geradoDe = new Map<string, string>();
      for (const [arquivo, item] of Object.entries(pacote)) {
        if (item.type !== 'chunk' || !item.facadeModuleId) continue;
        geradoDe.set(item.facadeModuleId.replace(/\\/g, '/'), arquivo);
      }

      /** O pedaço da tela MAIS tudo de que ele depende, sem repetir. */
      const comDependencias = (arquivo: string): string[] => {
        const vistos = new Set<string>();
        const fila = [arquivo];
        while (fila.length) {
          const a = fila.pop()!;
          if (vistos.has(a)) continue;
          vistos.add(a);
          const item = pacote[a];
          if (item && item.type === 'chunk') fila.push(...item.imports);
        }
        // O pacote principal sai da lista: o `<script type="module">` do HTML
        // já o está buscando, e repeti-lo como preload não adianta nada.
        return [...vistos].filter((a) => {
          const item = pacote[a];
          return !(item && item.type === 'chunk' && item.isEntry);
        });
      };

      const mapa: Record<string, string[]> = {};
      for (const [rota, pagina] of rotaParaPagina) {
        // `./pages/Financeiro` em `rotas.ts` é `<raiz>/src/pages/Financeiro.tsx` aqui.
        const absoluto = resolve(RAIZ, 'src', pagina.replace(/^\.\//, '')).replace(/\\/g, '/');
        const arquivo = geradoDe.get(`${absoluto}.tsx`) ?? geradoDe.get(`${absoluto}.ts`);
        // Telas que dividem arquivo (Sla, Suporte, Administracao) apontam para
        // o mesmo pedaço; é correto, e a rota de cada uma precisa dele.
        if (arquivo) mapa[rota] = comDependencias(arquivo);
      }

      const html = pacote['index.html'];
      if (!html || html.type !== 'asset') return;

      if (Object.keys(mapa).length === 0) {
        this.error('adiantar-tela: nenhuma rota casou com um pedaço do pacote. '
          + 'O adiantamento ficaria inerte e a medição mentiria.');
      }

      const script =
        '<script>(function(){'
        + `var m=${JSON.stringify(mapa)},a=m[location.pathname];`
        + 'if(!a)return;'
        + 'for(var i=0;i<a.length;i++){'
        + "var l=document.createElement('link');"
        + "l.rel='modulepreload';l.href='/'+a[i];l.crossOrigin='';"
        + 'document.head.appendChild(l);}'
        + '})();</script>';

      const fonte = String(html.source);
      // Logo após a abertura do <head>: quanto mais cedo o script roda, mais
      // cedo o pedido parte, que é o ponto inteiro deste plugin.
      html.source = fonte.includes('<head>')
        ? fonte.replace('<head>', `<head>${script}`)
        : fonte.replace('<title', `${script}<title`);
    },
  };
}
