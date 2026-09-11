# Instalação na sua máquina

Guia do zero até a base carregada. Vale para Windows, macOS e Linux; onde os
comandos diferem, ambos estão indicados.

## 1. Instalar o Node.js

A aplicação precisa do **Node.js 22 ou superior**. Para verificar se já existe:

```bash
node -v
```

Se o comando não for reconhecido, ou se a versão for menor que `v22`, baixe a
versão **LTS** em <https://nodejs.org> e instale com as opções padrão. No
Windows, feche e reabra o terminal depois de instalar.

Nada mais precisa ser instalado — o banco é um arquivo, não um serviço.

## 2. Obter o projeto

Com Git:

```bash
git clone https://github.com/GlaucioCarlissonss/GSTI.IARX.git
cd GSTI.IARX
```

Sem Git: abra o repositório no navegador, use **Code → Download ZIP**,
descompacte e entre na pasta pelo terminal.

## 3. Instalar e subir

```bash
npm ci
npm run iniciar
```

`npm run iniciar` faz três coisas: cria o arquivo `.env` com um segredo de
sessão aleatório, compila o servidor e a interface, e sobe a aplicação. A
última linha do terminal será:

```
GSTI.IARX — API ouvindo em http://localhost:3333
```

Abra <http://localhost:3333> no navegador. **Deixe o terminal aberto** — fechá-lo
encerra a aplicação.

> O `.env` guarda o `JWT_SECRET`. Trocá-lo não apaga dado algum, mas desconecta
> todas as sessões abertas. Vale copiá-lo junto com o backup.

## 4. Primeiro acesso

1. A tela abre no **cadastro do gestor**. Preencha nome, e-mail e uma senha de
   ao menos 8 caracteres. Essa é a primeira conta do ambiente.
2. Em seguida, cadastre a **primeira empresa**. Ela nasce com os nove tipos de
   despesa padrão e com você como gestor.

Assim que a primeira conta existe, o auto-cadastro se fecha: novos usuários
passam a entrar por convite, em *Cadastros → acessos da empresa*. Para permitir
auto-cadastro contínuo, troque `REGISTRO_ABERTO=false` por `true` no `.env` e
reinicie.

## 5. Carregar as bases

Você recebeu uma planilha por empresa (`gsti-base-alianca.xlsx`,
`gsti-base-milagres.xlsx`, `gsti-base-residencial.xlsx`, `gsti-base-union.xlsx`
e `gsti-base-moove.xlsx`). Para cada uma:

1. Cadastre a empresa com o mesmo nome (ALIANÇA, MILAGRES, RESIDENCIAL, UNION,
   MOOVE). A primeira já foi criada no passo anterior; as demais entram pelo
   seletor **Empresa** no topo, ou saindo e criando outra.
2. Vá em **Importar / Exportar**, escolha o módulo **Base completa**, selecione
   o arquivo da empresa em contexto e clique em **Importar**.

O relatório mostra quantas linhas entraram, quantas eram duplicadas e quais
falharam, com o motivo de cada uma. Se preferir conferir antes, use **Validar
sem gravar**: ele roda a importação inteira e desfaz ao final.

Cada arquivo traz filiais, tipos de despesa, cenários de projeção, lançamentos
(com as séries de parcelas religadas), projetos, tarefas e envolvidos. A
importação é idempotente: reenviar o mesmo arquivo não duplica nada.

## 6. Uso no dia a dia

Depois da primeira vez, o projeto já está compilado e basta:

```bash
npm start
```

Para parar, `Ctrl+C` no terminal.

### Deixar rodando sozinho

**Windows** — crie um arquivo `iniciar.bat` na pasta do projeto:

```bat
@echo off
cd /d "%~dp0"
npm start
```

Um atalho para ele na pasta *Inicializar* sobe a aplicação com o Windows.

**Linux (systemd)** — em `/etc/systemd/system/gsti.service`, ajustando o caminho
e o usuário:

```ini
[Unit]
Description=GSTI.IARX
After=network.target

[Service]
WorkingDirectory=/caminho/para/GSTI.IARX
ExecStart=/usr/bin/npm start
Restart=on-failure
User=seu-usuario

[Install]
WantedBy=multi-user.target
```

Depois: `sudo systemctl enable --now gsti`.

## 7. Backup

Todos os dados ficam em **um arquivo**: `data/gsti.sqlite` (mais os auxiliares
`-wal` e `-shm`). Há duas formas de guardar uma cópia:

- **Pela aplicação** (recomendado, e funciona com ela no ar): *Importar /
  Exportar* → **Base — Base completa**, para cada empresa. São os mesmos
  arquivos que servem para restaurar ou migrar de máquina.
- **Pelo arquivo**: pare a aplicação (`Ctrl+C`) e copie a pasta `data/` inteira.
  Copiar com a aplicação rodando pode capturar um estado incompleto.

Para restaurar em outra máquina, repita os passos 1 a 4 e importe as planilhas
exportadas.

## 8. Se algo der errado

| Sintoma | O que fazer |
| --- | --- |
| `node: command not found` | O Node não está instalado ou o terminal não foi reaberto após a instalação. |
| `EADDRINUSE` / porta 3333 ocupada | Outra coisa usa a porta. Rode com outra: `PORT=3334 npm start` (Windows PowerShell: `$env:PORT=3334; npm start`). O endereço passa a ser `http://localhost:3334`. |
| A página não abre | Confira se o terminal ainda mostra "API ouvindo". Se fechou, rode `npm start` de novo. |
| Esqueci a senha do gestor | Não há recuperação por e-mail. Com outra conta de gestor, conceda acesso; sem nenhuma, apague `data/gsti.sqlite` para recomeçar (perde os dados — restaure pelas planilhas exportadas). |
| `JWT_SECRET é obrigatório em produção` | Rode `npm run configurar`, que gera o segredo no `.env`. |
| Erro ao compilar o `better-sqlite3` | Rode `npm ci` novamente com a internet disponível; ele baixa um binário pronto para a sua plataforma. |

## 9. Acesso de outras máquinas da rede

A aplicação escuta apenas em `127.0.0.1`, ou seja, só responde no próprio
computador — nem o firewall precisa entrar na conta. Abrir à rede é uma decisão
explícita: `HOST=0.0.0.0` no `.env`.

**Não faça isso sem um proxy reverso com HTTPS na frente.** A base contém
salários e valores contratuais, e a aplicação não termina TLS por conta
própria: em HTTP simples, a senha do login e todos os dados trafegam em texto
claro pela rede. O caminho adequado é manter `HOST=127.0.0.1` e pôr nginx ou
Caddy escutando em 443, encaminhando para a porta local.

Exemplo mínimo com Caddy, que resolve o certificado sozinho:

```
gsti.suaempresa.com.br {
    reverse_proxy 127.0.0.1:3333
}
```

## 10. Notas de segurança

- **O `.env` guarda o segredo das sessões.** Ele é gerado por
  `npm run configurar` e a aplicação se recusa a subir sem ele — não há valor
  padrão embutido, justamente porque um segredo publicado permitiria forjar
  sessões de gestor. Trocá-lo desconecta todo mundo, mas não apaga dado algum.
- **A carga inicial não tem senha fixa.** Sem `SEED_SENHA` definida,
  `npm run seed` sorteia uma senha e a imprime uma única vez no terminal.
  Anote-a na hora.
- **Sessões duram 12 horas** e deixam de valer se a conta for desativada.
- **Crie uma segunda conta de gestor** como reserva: não há recuperação de
  senha por e-mail, e perder a única conta de gestor significa recomeçar do
  backup.
