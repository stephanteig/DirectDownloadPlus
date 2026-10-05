// ===================================================================================
//   Direct Download — o motor: yt-dlp e ffmpeg
//
//   Tudo o que fala com o mundo de fora mora aqui. O app.js cuida da tela; se
//   algo der errado, o erro sai daqui pronto para ser mostrado.
//
//   AS REGRAS ABAIXO VIERAM DO BlackSlice, e cada uma custou uma sessao de
//   diagnostico. Nao sao preferencia de estilo.
// ===================================================================================
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const https = require("https");
const providers = require("./providers");
const { MetadataCache } = require("./metadata-cache");

const RAIZ = path.join(__dirname, "..");
const EH_WIN = process.platform === "win32";
const BIN = path.join(RAIZ, "bin", EH_WIN ? "win" : "mac");

/* ONDE MORA O yt-dlp ATUALIZADO.

   O plugin instalado pertence ao root e esta em /Library — nao da para
   escrever nele sem sudo, e um app que pede sudo para se atualizar nao e um
   app que alguem usa. Entao a copia nova vai para o Application Support do
   USUARIO, e a busca olha la primeiro.

   E o mesmo desenho do BlackSlice, pelo mesmo motivo. */
function pastaDoUsuario() {
  const casa = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return EH_WIN
    ? path.join(process.env.APPDATA || path.join(casa, "AppData", "Roaming"), "DirectDownload")
    : path.join(casa, "Library", "Application Support", "DirectDownload");
}

const METADATA_CACHE = new MetadataCache(path.join(pastaDoUsuario(), "metadata-cache"));

/* ONDE ESTAO OS BINARIOS.

   Os nossos (bin/) vem primeiro porque sao os unicos que temos certeza de que
   combinam com o plugin -- o do sistema pode ser de meses atras e falhar com
   "Requested format is not available", que foi como o BlackSlice quebrou uma
   vez sem motivo aparente. */
function acha(nome) {
  const exe = EH_WIN ? nome + ".exe" : nome;
  // O ATUALIZADO VEM PRIMEIRO. Sem esta ordem, apertar UPDATE baixaria a versao
  // nova e o plugin continuaria usando a embarcada -- o botao pareceria nao
  // fazer nada, que e a pior forma de um recurso falhar.
  const cand = [path.join(pastaDoUsuario(), exe), path.join(BIN, exe)];
  if (!EH_WIN) cand.push("/opt/homebrew/bin/" + nome, "/usr/local/bin/" + nome);
  for (const c of cand) {
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  return exe; // ultima esperanca: o PATH resolve
}

function temBinarios() {
  const falta = [];
  for (const n of ["yt-dlp", "ffmpeg", "deno"]) {
    if (!path.isAbsolute(acha(n))) falta.push(n);
  }
  return { ok: falta.length === 0, falta, pasta: BIN };
}

/* =========================================================================
   O yt-dlp DEIXA DE SER UM EXECUTAVEL DE 35 MB  (2.2.0)

   ESTA E A MAIOR CORRECAO DE VELOCIDADE QUE O PAINEL JA TEVE, e ela nao muda
   uma linha de logica: muda QUEM executa o yt-dlp.

   O QUE FOI MEDIDO, tres execucoes de --version cada, na maquina do Jhaimes:

       yt-dlp EMBARCADO (bin/mac)      10.683 /  9.834 /  9.893 ms
       yt-dlp do Homebrew                 280 /    189 /    190 ms

   Dez segundos para dizer a propria versao, e sempre -- as tres medidas batem,
   entao nao e cache frio. O yt-dlp oficial de macOS e um PyInstaller ONEFILE:
   ele carrega um Python inteiro dentro de si e DESCOMPACTA esse Python para
   uma pasta temporaria A CADA EXECUCAO. Os dez segundos sao isso, e nada mais.
   O do Homebrew e um pacote Python normal, e por isso responde em 190 ms.

   NO ANALYZING, 87% DA ESPERA ERA ARRANQUE. O log media a consulta em 11.439
   ms; dez mil deles eram o binario abrindo. O trabalho de verdade -- falar com
   o YouTube e devolver o JSON -- custava um segundo e meio.

   A SAIDA E A MESMA QUE O HOMEBREW USA, e ela cabe dentro do plugin: o yt-dlp
   tambem e publicado como ZIPAPP -- um unico arquivo .pyz de 3 MB, que e um
   zip com o codigo Python dentro. Ele nao descompacta nada; so precisa de um
   Python para roda-lo. Entao o Python vai junto, embarcado, uma vez.

       antes    bin/mac/yt-dlp              36.930.736 bytes, ~10.000 ms
       agora    bin/mac/yt-dlp.pyz           3.000.000 bytes,    ~350 ms
                bin/mac/python/<arch>/         (o interpretador, ~111 MB)

   O PRECO ESTA ESCRITO, e foi aceito de propria vontade: o instalador triplica
   de tamanho. Nao ha atalho -- o macOS nao garante um python3 utilizavel, e
   contar com o do sistema seria o app funcionar na maquina de quem desenvolve
   e falhar na dos outros, que e exatamente o bug da 2.0.0 de volta.

   O CAMINHO DO PYTHON VAI ABSOLUTO, e nunca por PATH. E a regra que a 2.0.0
   deixou escrita com sangue: o ambiente que o renderer monta nao e o que o
   main montou, e uma variavel de ambiente e um lugar a mais para a coisa
   falhar calada.

   A RESERVA E O COMPORTAMENTO DA 2.1.5 INTEIRO. Se o Python nao estiver la --
   instalacao antiga, arquivo que nao veio, pasta sem permissao --, o painel
   volta a executar o binario de sempre, com a escolha por versao e velocidade
   que a 2.1.5 construiu. Nada e perdido; so deixa de ser rapido. */
const PY_RAIZ = path.join(BIN, "python");

/* A ARQUITETURA IMPORTA NO MAC, e o instalador leva as duas. Um Python de
   arm64 num Mac Intel nao executa -- e o erro dele nao diz "arquitetura
   errada", diz que o arquivo nao pode ser aberto. */
function pastaPythonDaMaquina() {
  if (EH_WIN) return PY_RAIZ;
  return path.join(PY_RAIZ, process.arch === "arm64" ? "arm64" : "x64");
}

/* O interpretador, se ele existir de verdade. Devolve "" quando nao ha -- e
   quem chama tem de tratar isso como o caso normal, e nao como erro. */
function achaPython() {
  const base = pastaPythonDaMaquina();
  const cand = EH_WIN
    ? [path.join(base, "python.exe"), path.join(base, "bin", "python.exe")]
    : [path.join(base, "bin", "python3"), path.join(base, "bin", "python3.13"),
       path.join(base, "bin", "python")];
  for (const c of cand) {
    try { if (fs.statSync(c).isFile()) return c; } catch (e) {}
  }
  return "";
}

/* O ZIPAPP, com a mesma ordem do acha(): o atualizado do usuario vem primeiro.
   E por isso que o UPDATE passou a baixar o .pyz de 3 MB em vez do executavel
   de 35 -- ele fica mais leve de baixar E mais rapido de rodar. */
function achaZipapp() {
  const cand = [path.join(pastaDoUsuario(), "yt-dlp.pyz"), path.join(BIN, "yt-dlp.pyz")];
  for (const c of cand) {
    try { if (fs.statSync(c).isFile()) return c; } catch (e) {}
  }
  return "";
}

/* O COMANDO DE VERDADE, num lugar so.

   Devolve { exe, antes } -- e o "antes" sao os argumentos que precedem os do
   yt-dlp. Com o par completo isso e [caminho do .pyz]; sem ele e [], e o exe
   volta a ser o binario que a 2.1.5 escolheria.

   POR QUE NAO DUAS FUNCOES SEPARADAS: porque a decisao "com Python ou sem" tem
   de ser tomada UMA vez por chamada. Perguntar "tem Python?" num lugar e "qual
   o zipapp?" noutro abre a porta para um responder sim e o outro nao. */
function comandoYt() {
  const py = achaPython();
  const pyz = py ? achaZipapp() : "";
  if (py && pyz) return { exe: py, antes: [pyz], viaPython: true };
  return { exe: achaYtJa(), antes: [], viaPython: false };
}

/* RODAR UM PROCESSO E DEVOLVER TUDO O QUE ELE DISSE.

   spawn e nao exec: o exec junta a saida num buffer com limite e, passando do
   limite, MATA o processo -- e o yt-dlp fala muito durante um download.

   Ler as duas saidas continuamente tambem nao e opcional. Um pipe sem leitor
   enche e trava o filho; no BlackSlice foi assim que o app pendurou em
   PROCESSING, e o sintoma era a AUSENCIA de uma linha no log, nao um erro. */
/* O QUARTO ARGUMENTO, aoNascer, entrega o processo filho a quem chamou (1.8.9).

   Existe por causa da busca enquanto se digita: sem uma referencia ao filho nao
   ha como MATA-LO, e descartar a resposta nao para o processo. Quem digita
   "toto brasil" deixaria uma fila de yt-dlp falando com o YouTube ao mesmo
   tempo -- e o preco disso nao seria a busca ficar lenta, seria o YouTube
   comecar a recusar, o que derruba o DOWNLOAD junto. */
/* O PATH TEM DE SER MONTADO AQUI, e nao no main.js  (2.0.0)

   Esta e a lição mais cara desta versão, e ela custou um chamado inteiro de
   diagnóstico com o erro apontando para o lugar errado.

   O main.js tem um alinhaPATH() que põe bin/mac na frente do PATH -- e o
   comentário dele explica direitinho por que isso é vital: sem o `deno` no
   PATH, o yt-dlp NÃO diz que faltou o deno, ele falha na extração com

       ERROR: [youtube] <id>: This video is not available

   O que ninguém tinha notado é que o alinhaPATH mexe em `process.env.PATH`
   do processo MAIN, e quem executa o yt-dlp é ESTE arquivo, que roda no
   RENDERER -- outro processo. O Chromium captura o ambiente cedo, e a
   alteração feita depois no main não desce para ele. O painel montava um PATH
   que ninguém usava.

   Funcionava na máquina de quem desenvolve porque lá existe um
   /opt/homebrew/bin/deno, achado pelo PATH normal do sistema. Quem só tem o
   deno de dentro do plugin -- ou seja, quase todo mundo -- nunca conseguiu
   extrair nada, e a mensagem culpava o YouTube.

   Então o PATH passa a ser montado no processo que faz o spawn. O alinhaPATH
   do main continua lá: ele ainda vale para o que o main roda, e duas defesas
   para o mesmo buraco é o que se quer depois de cair nele. */
function ambiente() {
  const sep = EH_WIN ? ";" : ":";
  const partes = [pastaDoUsuario(), BIN];
  if (EH_WIN) partes.push("C:\\Windows\\System32");
  else partes.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
  /* O PATH DE ANTES ENTRA PEDACO A PEDACO, e nao como um bloco so: empurrado
     inteiro, o de-duplicador abaixo nao consegue olhar dentro dele, e
     /usr/bin apareceria duas vezes. Nao quebra nada -- ganha quem vem
     primeiro -- mas um PATH com repeticao e mais um lugar onde alguem para
     para pensar. */
  const atual = process.env.PATH || "";
  if (atual) for (const p of atual.split(sep)) partes.push(p);

  const vistos = new Set();
  const caminho = partes.filter((p) => {
    if (!p || vistos.has(p)) return false;
    vistos.add(p);
    return true;
  }).join(sep);

  return Object.assign({}, process.env, { PATH: caminho });
}

function roda(exe, args, aoProgresso, aoNascer) {
  return new Promise((resolve) => {
    let saida = "", erro = "", p;
    try { p = spawn(exe, args, { env: ambiente(), windowsHide: true }); }
    catch (e) { return resolve({ code: -1, saida: "", erro: String(e && e.message || e) }); }
    if (aoNascer) { try { aoNascer(p); } catch (e) {} }
    p.stdout.on("data", (d) => {
      const s = String(d);
      saida += s;
      if (aoProgresso) { try { aoProgresso(s); } catch (e) {} }
    });
    p.stderr.on("data", (d) => {
      const s = String(d);
      erro += s;
      if (aoProgresso) { try { aoProgresso(s); } catch (e) {} }
    });
    p.on("error", (e) => resolve({ code: -1, saida, erro: String(e && e.message || e) }));
    p.on("close", (code) => resolve({ code, saida, erro }));
  });
}

/* O ATALHO, E POR QUE ELE NAO E CONFIAVEL PARA TOCAR  (1.9.8)

   O que demora numa extracao e o DESAFIO DO PLAYER: para o cliente `web` o
   yt-dlp busca a pagina do video, baixa o base.js (mais de 2 MB) e interpreta
   o JavaScript dele para assinar o endereco. Os clientes de TV e de celular
   entregam o endereco ja assinado, e por isso sao segundos mais rapidos.

   SO QUE ESSE ENDERECO NEM SEMPRE VALE FORA DAQUELE CLIENTE. Ele carrega
   parametros amarrados ao contexto de quem pediu, e quando o Chromium tenta
   ler o fluxo o YouTube recusa. Na tela isso aparece como

       PIPELINE_ERROR_READ: FFmpegDemuxer: data source error

   -- que foi o que apareceu no uso. O endereco EXISTE, o painel o recebeu, e
   mesmo assim nao ha imagem.

   Por isso o atalho continua sendo tentado, mas deixou de ser a palavra final:
   quando o <video> ou o <audio> recusa o que recebeu, o painel pede DE NOVO
   sem atalho e troca a fonte. Custa a espera de sempre, uma vez, e so para
   quem caiu no caso ruim.

   PARA BUSCAR o atalho e seguro sem ressalva: ali nao se toca nada, so se le
   titulo, canal e duracao. */
/* O ATALHO FOI DESLIGADO  (1.9.10)

   Ele pedia o endereco como se o painel fosse uma TV ou um celular -- clientes
   que recebem a URL ja assinada e por isso dispensam o desafio do player. Era
   para ser segundos mais rapido.

   Nao foi. Sao justamente esses clientes que o YouTube passou a barrar, e o
   preco apareceu em tres sintomas seguidos:

     . PIPELINE_ERROR_READ -- o endereco vinha, e nao tocava
     . cada faixa virava DOIS pedidos: o atalho falhava e o normal ia atras
     . e no fim "Sign in to confirm you're not a bot"

   Nao houve nenhuma medicao mostrando que ele economizava tempo -- so a
   suspeita de que economizaria. Contra isso, tres defeitos observados. Fica
   escrito aqui em vez de sumir do arquivo: quem for tentar de novo precisa
   saber que ja foi tentado, e como terminou. */
const ATALHO = [];

/* OS COOKIES DO NAVEGADOR  (1.9.10)

   E a saida que o proprio yt-dlp indica na mensagem de bloqueio: com a sua
   sessao, o pedido deixa de parecer um robo. Nada sai da maquina -- o yt-dlp
   le os cookies localmente e usa direto.

   Nasce em "nenhum": ler o navegador de alguem sem que a pessoa tenha pedido
   nao e uma escolha que um programa faz sozinho. */
let COOKIES = "";

function poeCookies(nav) {
  COOKIES = String(nav || "").trim();
}

function argsCookies() {
  return COOKIES ? ["--cookies-from-browser", COOKIES] : [];
}

/* O MOTOR JS, DITO PELO CAMINHO ABSOLUTO  (2.0.0)

   Depender do PATH é depender de uma variável que atravessa três processos --
   o Resolve sobe o plugin, o Electron sobe o renderer, o renderer sobe o
   yt-dlp -- e foi exatamente aí que ela se perdeu. O yt-dlp aceita receber o
   caminho do runtime na mão:

       --js-runtimes deno:/caminho/absoluto/do/deno

   Com isso a classe inteira do problema desaparece, inclusive o caso do
   yt-dlp ATUALIZADO, que mora noutra pasta e não tem o deno ao lado.

   MAS A OPÇÃO NÃO É ANTIGA, e o acha() pode devolver um yt-dlp do sistema,
   instalado pelo Homebrew meses atrás. Passar uma opção que ele não conhece
   não degrada nada: ele SAI COM ERRO, e o painel inteiro para de funcionar
   para essa pessoa. Por isso o painel pergunta uma vez -- e só uma, a
   resposta fica guardada -- se este yt-dlp conhece a opção. */

/* =========================================================================
   QUAL yt-dlp USAR, E POR QUE ISSO PASSOU A SER UMA DECISÃO  (2.1.3)

   MEDIDO na máquina do Jhaimes, três execuções de `--version` cada:

       yt-dlp BAIXADO (pelo UPDATE)   10.423 / 10.022 /  9.892 ms
       yt-dlp EMBARCADO (bin/mac)     10.683 /  9.834 /  9.893 ms
       yt-dlp do Homebrew                280 /    189 /    190 ms
       deno                               48 /     49 /     32 ms
       ffmpeg                             59 /     49 /     48 ms

   DEZ SEGUNDOS PARA DIZER A PRÓPRIA VERSÃO, e é assim toda vez -- as três
   medidas batem, então não é cache frio. O yt-dlp oficial de macOS é um
   PyInstaller "onefile" de 35 MB: ele descompacta um Python inteiro em
   /var/folders a cada execução. O do Homebrew é um pacote Python normal, e
   por isso custa cinquenta vezes menos.

   Isso explicou o painel inteiro. O log da 2.1.2 registrava:

       consulta: 11.439 a 41.089 ms      (o -J de verdade leva ~4 s)
       urlVideo adiantado: ~25.000 ms
       baixaAudio: 19.165 a 31.416 ms
       fichaDosBinarios: 20 a 63 s       (só pergunta versão a três binários!)

   Cada linha dessas é o arranque somado ao trabalho.

   A ESCOLHA É POR MEDIDA, E NÃO POR ORDEM FIXA. Um yt-dlp que responde em
   200 ms vale mais que um "mais novo" que custa 10 s por chamada -- e são
   quatro chamadas por link colado.

   OS CANDIDATOS SÃO TESTADOS DO MENOR PARA O MAIOR, e o tamanho é uma boa
   pista de graça: o onefile tem 35 MB, o pacote normal tem poucos. Testar o
   pequeno primeiro faz o caso comum custar UMA chamada de 200 ms.

   E O TESTE É O MESMO `--help` QUE JÁ EXISTIA: uma chamada responde as duas
   perguntas -- quanto ele custa, e se conhece o --js-runtimes. Quem não
   conhece está fora, seja rápido ou não: essa opção é o que impede o bug da
   2.0.0 de voltar.

   O RESULTADO FICA GUARDADO EM DISCO, com a assinatura (tamanho + data) de
   cada candidato. Trocar o yt-dlp -- pelo UPDATE, pelo Homebrew, por
   reinstalar o plugin -- muda a assinatura e refaz a medida sozinho. Sem
   isso, o UPDATE baixaria uma versão nova e o painel continuaria usando a
   velha, que é a pior forma de um botão falhar. */

const CACHE_YT = path.join(pastaDoUsuario(), "yt-escolhido.json");
let YT = null;             // { caminho, ms, jsRuntimes } — a escolha desta sessão

function candidatosYt() {
  const exe = EH_WIN ? "yt-dlp.exe" : "yt-dlp";
  const c = [path.join(pastaDoUsuario(), exe), path.join(BIN, exe)];
  if (!EH_WIN) c.push("/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp");
  const vivos = [];
  for (const p of c) {
    try {
      const st = fs.statSync(p);
      if (st.isFile()) vivos.push({ caminho: p, tam: st.size, mtime: Math.round(st.mtimeMs) });
    } catch (e) {}
  }
  return vivos;
}

/* A ASSINATURA DE TODOS OS CANDIDATOS, e não só do escolhido: instalar um
   yt-dlp NOVO num lugar que antes estava vazio tem de refazer a escolha, e
   olhar só o escolhido não veria isso acontecer. */
function assinaturaYt(lista) {
  return lista.map((c) => c.caminho + ":" + c.tam + ":" + c.mtime).join("|");
}

function leCacheYt() {
  try { return JSON.parse(fs.readFileSync(CACHE_YT, "utf8")); } catch (e) { return null; }
}
function gravaCacheYt(obj) {
  try {
    fs.mkdirSync(path.dirname(CACHE_YT), { recursive: true });
    fs.writeFileSync(CACHE_YT, JSON.stringify(obj, null, 2));
  } catch (e) {}
}

/* A VERSÃO DO yt-dlp, COMO NÚMERO COMPARÁVEL  (2.1.4)

   O yt-dlp se versiona por data: "2026.08.19". Vira 20260819, e a comparação
   passa a ser aritmética -- comparar as strings daria certo por acidente neste
   formato, e erraria no dia em que aparecesse um "2026.8.19" ou um sufixo. */
function verNum(v) {
  const m = String(v || "").trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!m) return 0;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

/* Duas chamadas, e a ORDEM entre elas é o que as torna baratas: a versão vem
   primeiro, e quem não passa no corte de versão nem chega a ser perguntado
   sobre o --js-runtimes. */
async function provaYt(caminho) {
  const t0 = Date.now();
  let v;
  try { v = await roda(caminho, ["--version"]); } catch (e) { v = { code: 1 }; }
  const ms = Date.now() - t0;
  const versao = v.code === 0 ? String(v.saida || "").trim().split(/\s+/)[0] : "";
  return { caminho, ms, ok: v.code === 0, versao, ver: verNum(versao), jsRuntimes: null };
}

/* O --js-runtimes, perguntado só a quem passou no corte de versão. */
async function confereRuntimes(p) {
  let r;
  try { r = await roda(p.caminho, ["--help"]); } catch (e) { r = { code: 1 }; }
  const txt = String(r.saida || "") + String(r.erro || "");
  p.jsRuntimes = /--js-runtimes/.test(txt);
  return p;
}

/* O YT_BOM SAIU NA 2.1.4, e vale saber por quê.

   Ele era o "rápido o bastante para parar de procurar", e foi ele que fez a
   2.1.3 escolher errado: a busca parava no primeiro candidato veloz e nunca
   chegava a comparar as versões. Um limiar de velocidade só faz sentido depois
   que a versão já decidiu quem está apto -- e aí não sobra o que apressar,
   porque os aptos já são poucos. */

async function escolheYt(aoAnotar) {
  if (YT) return YT;
  const cand = candidatosYt();
  if (!cand.length) { YT = { caminho: EH_WIN ? "yt-dlp.exe" : "yt-dlp", ms: -1, jsRuntimes: false }; return YT; }

  const assin = assinaturaYt(cand);
  const cache = leCacheYt();
  if (cache && cache.assinatura === assin && cache.escolhido) {
    YT = cache.escolhido;
    if (aoAnotar) aoAnotar("yt-dlp: escolha em cache — " + YT.caminho + " (" + YT.ms + " ms)");
    return YT;
  }

  /* TODOS SAO PERGUNTADOS PELA VERSAO, e nao só até achar um bom  (2.1.4)

     A 2.1.3 parava no primeiro candidato rápido que conhecesse a opção, e isso
     custou um painel quebrado: na máquina do Jhaimes ela escolheu o yt-dlp do
     Homebrew, de 2026.03.03, quando o embarcado era de 2026.08.19. CINCO MESES
     mais velho. O YouTube muda toda semana, e um yt-dlp de março responde
     "HTTP Error 403: Forbidden" e "The downloaded file is empty" a tudo.

     O --js-runtimes não protegeu porque a opção já existia em março. Ela diz
     se o binário sabe FALAR com o motor JS -- não se ele sabe falar com o
     YouTube de hoje.

     Sair perguntando a versão a todos custa uma chamada por candidato. É o
     preço de não escolher errado, e o cache faz disso uma vez só. */
  const fila = cand.slice().sort((a, b) => a.tam - b.tam);
  const provas = [];
  for (const c of fila) {
    const p = await provaYt(c.caminho);
    provas.push(p);
    if (aoAnotar) aoAnotar("yt-dlp candidato: " + p.caminho + " — " + p.ms + " ms, " +
                           (p.ok ? "versao " + p.versao : "NAO responde"));
  }

  /* A VERSAO MANDA, E A VELOCIDADE SO DESEMPATA.

     Este é o coração da correção. Um yt-dlp que responde em 200 ms e não baixa
     nada não vale coisa alguma; a velocidade só passa a importar entre
     binários que funcionam.

     O CORTE É A VERSAO MAIS NOVA QUE EXISTE NA MAQUINA, e não uma data
     cravada: cravar uma data faria o painel envelhecer sozinho, recusando em
     dezembro o binário que ele mesmo embarcou. O embarcado é sempre um dos
     candidatos, então o corte nunca fica acima do que o plugin trouxe. */
  const respondem = provas.filter((p) => p.ok && p.ver > 0);
  const maisNova = respondem.reduce((m, p) => Math.max(m, p.ver), 0);
  const novos = respondem.filter((p) => p.ver === maisNova);
  if (aoAnotar && respondem.length > novos.length) {
    for (const p of respondem.filter((x) => x.ver < maisNova))
      aoAnotar("yt-dlp DESCARTADO por ser antigo: " + p.caminho + " (" + p.versao + ")");
  }

  /* SÓ AGORA a pergunta do --js-runtimes, e só a quem passou no corte. Do mais
     rápido para o mais lento, parando no primeiro que sirva: quem passou pela
     versão já está apto, e o que resta é escolher entre iguais. */
  novos.sort((a, b) => a.ms - b.ms);
  let escolhido = null;
  for (const p of novos) {
    await confereRuntimes(p);
    if (aoAnotar) aoAnotar("yt-dlp " + p.caminho + ": " +
                           (p.jsRuntimes ? "conhece --js-runtimes" : "NAO conhece --js-runtimes"));
    if (p.jsRuntimes) { escolhido = p; break; }
  }

  /* SEM NENHUM CAPAZ, vale o mais novo que ao menos RESPONDE. O --js-runtimes
     deixa de ser passado (o argsMotorJS já trata disso), e o painel volta a
     depender do PATH -- que é a 1.9.x de volta, ruim, mas melhor que não
     baixar nada.

     A RESERVA E O PRIMEIRO CANDIDATO DA LISTA, e nao um acha("yt-dlp") aqui:
     o t17 guarda a regra de que nenhuma chamada crua ao yt-dlp mora fora das
     funções autorizadas. */
  if (!escolhido) {
    escolhido = novos[0] || provas.find((p) => p.ok) ||
                { caminho: cand[0].caminho, ms: -1, versao: "", jsRuntimes: false };
  }

  YT = { caminho: escolhido.caminho, ms: escolhido.ms,
         versao: escolhido.versao || "", jsRuntimes: !!escolhido.jsRuntimes };
  gravaCacheYt({ assinatura: assin, escolhido: YT, quando: new Date().toISOString() });
  if (aoAnotar) aoAnotar("yt-dlp escolhido: " + YT.caminho +
                         " (versao " + (YT.versao || "?") + ", " + YT.ms + " ms)");
  return YT;
}

/* O UPDATE troca o binário; a escolha tem de ser refeita. Não basta apagar o
   arquivo de cache: a decisão desta sessão está em memória. */
function esqueceEscolhaYt() {
  YT = null; ACEITA = null; MEDINDO = null;
  try { fs.unlinkSync(CACHE_YT); } catch (e) {}
}

/* =========================================================================
   A ESCOLHA NUNCA BLOQUEIA  (2.1.5)

   A 2.1.4 pôs a escolha no caminho crítico: colar um link esperava por ela.
   Na máquina do Jhaimes isso custou quase um minuto, e a conta é direta --
   dois candidatos de dez segundos cada para o --version, mais o --help no
   escolhido. Trinta segundos antes de olhar para o link.

   Foi a terceira versão seguida a tropeçar no mesmo lugar, e o padrão agora
   está claro: QUALQUER coisa que execute o yt-dlp fora do trabalho pedido tem
   de sair do caminho de quem está esperando. Foi assim com a ficha dos
   binários (2.1.3), com o urlVideo adiantado (2.1.3), e agora com a escolha.

   O DESENHO QUE RESOLVE A CLASSE INTEIRA:

     . se há escolha no cache, ela vale, e custa a leitura de um arquivo
     . se não há, o painel usa a ordem do acha() -- que é o comportamento da
       2.1.2, o último que se sabe bom -- e devolve NA HORA
     . a medida acontece em segundo plano, e o resultado só vale da PRÓXIMA
       abertura em diante

   Ou seja: a primeira sessão numa máquina nova é exatamente a 2.1.2, sem
   regressão nenhuma; as seguintes ganham o yt-dlp rápido, se houver um bom.
   O preço é a escolha demorar uma sessão para valer, e isso não aparece na
   tela de ninguém. */
let MEDINDO = null;      // a promessa da medida em curso, para não haver duas

function achaYtJa() {
  /* SÍNCRONO, e é isso que importa: quem pergunta está com um link na mão. */
  if (YT) return YT.caminho;
  const c = leCacheYt();
  const cand = candidatosYt();
  if (c && c.escolhido && cand.length && c.assinatura === assinaturaYt(cand)) {
    YT = c.escolhido;
    return YT.caminho;
  }
  return acha("yt-dlp");
}

/* Dispara a medida sem esperar por ela. Chamada quando o painel está parado. */
/* COM O PYTHON EMBARCADO NAO HA O QUE MEDIR, E MEDIR CUSTA CARO  (2.2.0)

   A medida existe para escolher entre executaveis de yt-dlp. Com o par
   Python + .pyz montado, a escolha ja aconteceu por construcao: o .pyz e o
   nosso, o UPDATE o mantem novo, e ele abre em 350 ms.

   Deixar a medida rodar assim mesmo nao seria inofensivo -- ela EXECUTA o
   onefile de 35 MB duas vezes para perguntar coisas cuja resposta nao vai
   usar. Sao vinte segundos de CPU que a maquina de quem edita nao deve.

   Ela continua de pe para quem cair na reserva, que e onde ela serve. */
function mediraDepois(aoAnotar) {
  if (comandoYt().viaPython) {
    if (aoAnotar) aoAnotar("escolha do yt-dlp dispensada: o painel roda pelo Python embarcado");
    return null;
  }
  if (YT || MEDINDO) return MEDINDO;
  MEDINDO = escolheYt(aoAnotar)
    .then((r) => { MEDINDO = null; return r; })
    .catch((e) => { MEDINDO = null; if (aoAnotar) aoAnotar("escolha do yt-dlp falhou: " + e); });
  return MEDINDO;
}

async function achaYt() { return achaYtJa(); }

/* O --js-runtimes, sem esperar pela escolha.

   Com a escolha pronta, a resposta vem dela. Sem ela, pergunta ao binário que
   o achaYtJa() devolveu -- UMA chamada, guardada, que é exatamente o que a
   2.1.2 fazia. Não passar a opção quebraria quem não tem deno no PATH; passar
   a opção a um yt-dlp que não a conhece quebraria todo mundo. É a única das
   três perguntas que não dá para adiar. */
let ACEITA = null;

/* A PERGUNTA TEM DE IR AO BINARIO QUE VAI RODAR, e nao ao que rodaria.

   Com o Python embarcado, perguntar ao achaYtJa() responderia sobre o
   executavel de 35 MB enquanto quem trabalha e o .pyz -- e os dois podem ser
   de versoes diferentes, porque o UPDATE atualiza um so. Uma resposta certa
   sobre o binario errado e o tipo de erro que sobrevive a muitas leituras. */
async function aceitaJsRuntimes() {
  const c = comandoYt();
  if (!c.viaPython && YT && YT.jsRuntimes !== null && YT.jsRuntimes !== undefined) {
    return YT.jsRuntimes;
  }
  if (ACEITA !== null) return ACEITA;
  let r;
  try { r = await roda(c.exe, c.antes.concat(["--help"])); } catch (e) { r = { code: 1 }; }
  ACEITA = /--js-runtimes/.test(String(r.saida || "") + String(r.erro || ""));
  return ACEITA;
}

async function argsMotorJS() {
  const d = acha("deno");
  if (!path.isAbsolute(d)) return [];      // sem deno nosso, resta o PATH
  if (!(await aceitaJsRuntimes())) return [];
  return ["--js-runtimes", "deno:" + d];
}

/* TODA CHAMADA AO yt-dlp PASSA POR AQUI. Se uma delas montar os argumentos por
   fora, ela fica sem o motor JS -- e volta a falhar com a mensagem errada. */
/* E DESDE A 2.2.0 O "exe" PODE NAO SER O yt-dlp: com o Python embarcado, quem
   e executado e o interpretador, e o .pyz vai como primeiro argumento. Por
   isso o comandoYt() e chamado UMA vez e as duas partes dele viajam juntas. */
async function rodaYt(args, aoProgresso, aoNascer) {
  const c = comandoYt();
  return roda(c.exe, c.antes.concat(await argsMotorJS(), args), aoProgresso, aoNascer);
}

async function rodaYtComTeto(args, ms, aoNascer) {
  const c = comandoYt();
  return rodaComTeto(c.exe, c.antes.concat(await argsMotorJS(), args), ms, aoNascer);
}

/* O QUE O LOG PRECISA SABER ANTES DE QUALQUER DIAGNÓSTICO  (2.0.0)

   O log registrava a versão do app, o sistema e o PATH -- e nada sobre os
   binários. Quando veio o relato de bug, o log não tinha uma linha sobre qual
   yt-dlp rodou nem sobre o deno, e o diagnóstico virou adivinhação por três
   mensagens. */
/* ELA CUSTAVA DE 20 A 63 SEGUNDOS, A CADA ABERTURA  (medido, 2.1.3)

   Seis aberturas no log da 2.1.2 mediram isso. A função não baixa nada e não
   consulta nada -- pergunta a versão a três binários. O custo era todo do
   arranque do yt-dlp, dez segundos por chamada, e ela fazia duas (a versão e
   o --help do aceitaJsRuntimes).

   PIOR QUE O CUSTO ERA A HORA. Ela é agendada 1,2 s depois do boot, que é
   exatamente quando alguém cola o primeiro link -- e aí três processos
   yt-dlp disputavam CPU e rede. A consulta que costuma levar 14 s levou 41
   naquela sessão. Os picos do log são as horas em que eles se atropelaram.

   AGORA VAI PARA DISCO, com a assinatura dos binários. Ela é diagnóstico:
   a versão do yt-dlp só muda quando alguém aperta UPDATE ou reinstala, e
   as duas coisas mudam a assinatura e refazem a ficha sozinhas.

   O CAMINHO NÃO ENTRA NA ASSINATURA POR ACASO: se a escolha do achaYt()
   mudar -- porque um yt-dlp novo apareceu no sistema --, a ficha do binário
   antigo não serve mais, e a assinatura muda junto. */
const CACHE_FICHA = path.join(pastaDoUsuario(), "ficha-binarios.json");

function assinaturaFicha(yt, dn, ff) {
  const marca = (p) => {
    try { const st = fs.statSync(p); return p + ":" + st.size + ":" + Math.round(st.mtimeMs); }
    catch (e) { return p + ":ausente"; }
  };
  return [marca(yt), marca(dn), marca(ff)].join("|");
}

async function fichaDosBinarios() {
  /* A FICHA TEM DE DESCREVER QUEM TRABALHA. Ela e o primeiro lugar onde se
     olha num diagnostico, e a 2.2.0 abriu a chance de ela mentir: se ela
     perguntasse ao achaYtJa(), diria a versao do executavel de 35 MB numa
     maquina onde quem roda e o .pyz. Um log que descreve o binario errado
     custa a sessao inteira de quem o le. */
  const cmd = comandoYt();
  const yt = cmd.viaPython ? cmd.antes[0] : cmd.exe;
  const dn = acha("deno"), ff = acha("ffmpeg");
  const assin = assinaturaFicha(yt, dn, ff);

  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FICHA, "utf8"));
    if (c && c.assinatura === assin && c.ficha) return Object.assign({}, c.ficha, { doCache: true });
  } catch (e) {}

  const v = async (exe, antes) => {
    if (!path.isAbsolute(exe)) return "não achei";
    const r = await roda(exe, (antes || []).concat(["--version"]));
    return r.code === 0 ? String(r.saida || "").trim().split(/\s+/).slice(0, 2).join(" ") : "não roda";
  };
  const ficha = {
    ytdlp: { caminho: yt, versao: await v(cmd.exe, cmd.antes),
             viaPython: cmd.viaPython, python: cmd.viaPython ? cmd.exe : "" },
    deno: { caminho: dn, versao: await v(dn) },
    ffmpeg: { caminho: ff },
    jsRuntimes: await aceitaJsRuntimes(),
  };
  try {
    fs.mkdirSync(path.dirname(CACHE_FICHA), { recursive: true });
    fs.writeFileSync(CACHE_FICHA, JSON.stringify({ assinatura: assin, ficha,
                                                   quando: new Date().toISOString() }, null, 2));
  } catch (e) {}
  return Object.assign({}, ficha, { doCache: false });
}

/* TETO DE TEMPO, PARA O QUE NAO PODE PENDURAR  (1.9.7)

   O roda() resolve quando o processo FECHA. Se ele nao fechar -- e o yt-dlp tem
   por onde: um cliente que passou a exigir token e fica reintentando, ou uma
   conexao muda que o --socket-timeout nao cobre porque o tempo esta indo embora
   no desafio do player -- a promessa nunca resolve. Quem esperava espera para
   sempre, e na tela isso e um "Buscando..." eterno: nem imagem, nem erro, nem
   caminho de volta.

   Vale para DESCOBRIR ENDERECO, que e trabalho de segundos. NAO vale para
   download, que legitimamente leva minutos -- por isso o teto e explicito em
   cada chamada, e nao uma regra do roda(). */
async function rodaComTeto(exe, args, ms, aoNascer) {
  let filho = null, estourou = false;
  const p = roda(exe, args, null, (c) => { filho = c; if (aoNascer) aoNascer(c); });
  const relogio = setTimeout(() => {
    estourou = true;
    try { if (filho) filho.kill(); } catch (e) {}
  }, ms);
  const r = await p;
  clearTimeout(relogio);
  if (estourou) return { code: -2, saida: r.saida, erro: "demorou demais (" + ms + " ms)", estourou: true };
  return r;
}

/* A MENSAGEM QUE VAI PARA A TELA.
   O yt-dlp escreve varias linhas; a que interessa e a do ERROR. Mostrar o
   despejo inteiro faz a pessoa nao ler nada -- e mostrar so "falhou" faz ela
   nao ter o que reportar. */
function limpaErro(texto) {
  if (!texto) return "";
  const linhas = String(texto).split(/\r?\n/).filter((l) => l.trim());
  const err = linhas.filter((l) => /^ERROR/i.test(l.trim()));
  if (err.length) return err[err.length - 1].replace(/^ERROR:\s*/i, "").trim();
  return linhas[linhas.length - 1] || "";
}

/* CAMINHO DE ARQUIVO -> URL QUE O CHROMIUM ACEITA.

   Existe por causa de um bug que deixou o Play MUDO no Windows desde sempre,
   e ninguem viu porque a forma de onda continuava desenhando normalmente.

   O codigo antigo era:

       "file://" + encodeURI(caminho)

   No macOS o caminho ja comeca com "/", entao "file://" + "/Users/..." vira
   "file:///Users/..." e funciona por acidente. No Windows o caminho e
   "C:\Users\..." e o resultado e:

       file://C:%5CUsers%5CBOBMON~1%5Cdd.webm

   O Chromium le o que vem depois de "file://" e antes da primeira barra como
   NOME DE HOST. Ou seja: ele procurou um computador chamado "C:" na rede. O
   log do Windows registrou o erro 4 (src not supported) em 100% das sessoes,
   com quatro videos diferentes -- nao era codec, era isto.

   As tres regras que a funcao aplica:
     . barra invertida vira barra normal
     . caminho que nao comeca com "/" ganha uma (o "/C:/..." obrigatorio)
     . cada pedaco e codificado, MENOS a letra da unidade -- "C:" codificado
       viraria "C%3A" e o Windows deixaria de reconhecer

   Nao usa pathToFileURL do Node de proposito: ele decide pela plataforma onde
   ESTA RODANDO, e ai a suite no macOS nunca conseguiria exercitar o caso do
   Windows. Esta versao trata os dois formatos em qualquer sistema, e o t9
   compara o resultado com o do proprio Node para garantir que nao divergem. */
function urlDeArquivo(p) {
  let s = String(p || "").replace(/\\/g, "/");
  if (!s.startsWith("/")) s = "/" + s;
  return "file://" + s.split("/").map((seg, i) => {
    // i === 1 e o primeiro pedaco depois da barra inicial: "C:", "Users"...
    if (i === 1 && /^[A-Za-z]:$/.test(seg)) return seg;
    return encodeURIComponent(seg);
  }).join("/");
}

function nomeSeguro(s) {
  return String(s || "audio")
    .replace(/[\/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/* CONSULTAR O LINK: titulo e duracao.

   --no-playlist e obrigatorio: link do YouTube costuma trazer `&list=RD...`
   (uma mix), e sem isso o yt-dlp resolve a lista inteira antes de olhar o
   video -- quando nao desiste.

   OS COOKIES SO ENTRAM SE A PESSOA PEDIR, e este comentario ja disse outra
   coisa. Ate a 1.9.10 ele dizia "NAO passa --cookies-from-browser", e a razao
   era boa: no BlackSlice o cookie de navegador aberto fez o MESMO video que
   funcionava passar a falhar com "The page needs to be reloaded" -- cookie e
   sessao viva, e o YouTube rotaciona.

   O que a 1.9.10 fez foi seguir a segunda metade daquela regra: "se um dia for
   preciso, o padrao certo e tentar SEM primeiro". E o que acontece. O COOKIES
   nasce vazio, o argsCookies() devolve lista vazia, e so quem escolheu um
   navegador nos Ajustes manda cookie -- em TODAS as chamadas, inclusive esta.

   Ficou aqui como estava por quatro versoes, dizendo o contrario do que o
   codigo tres linhas abaixo faz. Comentario que envelhece engana melhor que
   codigo sem comentario nenhum. */
/* O ERRO DO yt-dlp APONTA PARA O LUGAR ERRADO, E ISSO TEM CONSERTO  (2.0.0)

   Sem um motor JS que funcione, a extração falha assim:

       ERROR: [youtube] <id>: This video is not available

   -- e a frase acusa o YouTube por um problema que é da máquina de quem está
   lendo. Foi ela que mandou um chamado inteiro procurar vídeo removido,
   região bloqueada e conta banida, com o vídeo público o tempo todo.

   Então, quando o texto do yt-dlp for um dos dois que essa falha produz, o
   painel PERGUNTA AO DENO se ele está de pé -- e responde o que achou. A
   pergunta custa um `deno --version`, e só acontece quando algo já deu
   errado. */
/* O BLOQUEIO DE ROBO, E POR QUE ELE MERECE TRATAMENTO PROPRIO  (2.1.2)

   O YouTube responde assim quando o pedido veio de um IP marcado (VPN, rede
   compartilhada, datacenter), quando vieram pedidos demais, ou quando o
   cliente que o yt-dlp usa naquela semana deixou de passar:

       ERROR: [youtube] <id>: Sign in to confirm you're not a bot. Use
       --cookies-from-browser or --cookies for the authentication. See
       https://github.com/yt-dlp/... Also see https://github.com/yt-dlp/...

   Nao e defeito do plugin nem do video. E a mensagem, do jeito que chega, e
   inutil para quem esta olhando um painel: fala de duas opcoes de linha de
   comando e manda ler duas paginas de wiki.

   A saida ja existe no painel desde a 1.9.10 -- Ajustes > Cookies do navegador
   -- e o chamado que motivou esta versao morreu porque ela estava atras de um
   botao que a tela inicial nao mostra. */
const RX_BOT = /Sign in to confirm you.{0,3}re not a bot|confirm you.{0,3}re not a bot|not a bot/i;

function ehBloqueioBot(bruto) {
  return RX_BOT.test(String(bruto || ""));
}

/* A MENSAGEM ENXUTA, e SO para este caso.

   Corta a partir do "Use --cookies..." -- dali para a frente e instrucao de
   linha de comando e endereco de wiki, que na tela inicial vira um paragrafo
   vermelho de tres linhas sem uma acao dentro.

   O bruto NAO se perde: ele vai inteiro para o log, como desde a 2.0.0. Foi
   justamente jogar fora o resto do stderr que fez o chamado do "This video is
   not available" custar tres rodadas.

   So corta quando reconhece o padrao. Enxugar todo erro por regra seria
   apagar, no proximo chamado, exatamente a linha que explicava tudo. */
function enxugaBloqueio(erro) {
  const t = String(erro || "").trim();
  if (!ehBloqueioBot(t)) return t;
  const corte = t.search(/\s*(Use --cookies|See https?:|Also see)/i);
  return (corte > 0 ? t.slice(0, corte) : t).trim();
}

async function explicaFalha(bruto) {
  const t = String(bruto || "");
  if (ehBloqueioBot(t)) {
    return COOKIES
      ? "o YouTube barrou esta máquina mesmo com os cookies do " + COOKIES +
        " — tente outro navegador, ou desligue a VPN e espere alguns minutos"
      : "o YouTube quer confirmar que você não é um robô — ligue os cookies do "
        + "navegador nos Ajustes";
  }
  const semRuntime = /No supported JavaScript runtime/i.test(t);
  const indisponivel = /This video is not available/i.test(t);
  if (!semRuntime && !indisponivel) return "";

  const d = acha("deno");
  if (!path.isAbsolute(d)) {
    return "o motor JS (deno) não foi encontrado — reinstale o plugin";
  }
  const r = await roda(d, ["--version"]);
  if (r.code !== 0) {
    return "o motor JS (deno) não está rodando nesta máquina: " + d;
  }
  /* O deno responde e mesmo assim o yt-dlp reclamou dele: isso é o yt-dlp não
     achando o que existe -- caminho, permissão ou versão. Dizer QUAL é o
     caminho poupa a próxima meia hora. */
  if (semRuntime) return "o yt-dlp não achou o motor JS, que está em " + d;
  return "";
}

/* =========================================================================
   A CONSULTA PASSA A TRAZER O ENDERECO DO AUDIO  (2.3.0)

   O DEFEITO, e ele estava no analisar() desde sempre: colar um link custava
   DUAS extracoes do mesmo video. A consulta() rodava o yt-dlp com -J para
   descobrir titulo e duracao; o baixaAudio(), logo abaixo, rodava o yt-dlp DE
   NOVO para trazer os bytes. Cada uma paga o desafio do player inteiro.

   Vindo da BUSCA o `jaSei` ja poupava a primeira. Colado, nao.

   O QUE MUDA: um `-f ba/b` nesta linha. O yt-dlp passa a fazer a escolha de
   formato durante a consulta -- que e trabalho LOCAL, sem rede -- e o JSON que
   ja chegava passa a trazer tambem o endereco do formato escolhido.

   CONFERIDO DENTRO DO NOSSO PROPRIO .pyz (2026.08.19), e nao de memoria:

     YoutubeDL.py:3132  downloaded_formats.append(new_info) acontece ANTES do
                        process_info -- entao a lista existe mesmo em
                        simulacao, que e o modo do -J
     YoutubeDL.py:3700  o -J imprime com sanitize_info() SEM remove_private_keys
                        -> o campo requested_downloads VAI na saida

   Ou seja: este endereco ja estava chegando e sendo jogado fora.

   POR QUE `ba/b` E NAO OUTRO SELETOR: porque e exatamente o que o baixaAudio()
   usa em producao desde sempre. O `/b` no fim garante que sempre casa algum
   formato -- e por isso esta linha nao pode passar a falhar com "Requested
   format is not available" num link onde hoje ela funciona. Trocar o seletor
   aqui sem trocar la seria pedir o endereco de um formato e baixar outro. */
async function consulta(url) {
  const valid = providers.validHttpUrl(url);
  if (!valid) {
    return { ok: false, erro: "lenken må være en http- eller https-URL", bruto: "invalid URL", providerError: "invalid-url" };
  }
  let direct = providers.directFileProvider(valid.href);
  if (!direct) {
    const contentType = await contentTypeForUrl(valid);
    direct = providers.directFileProvider(valid.href, contentType);
  }
  if (direct) {
    /* Direct files are deliberately returned without a guessed duration. The
       caller can offer download immediately and may fill duration with
       ffprobe after the file is available; an unknown duration is not a live
       stream. */
    return Object.assign({ ok: true, id: direct.sourceUrl, titulo: direct.title,
      canal: "", duracao: 0, thumb: "", audio: null, direct: true }, direct);
  }
  const cacheRequest = { provider: "yt-dlp", sourceUrl: valid.href, format: "analysis" };
  const cached = METADATA_CACHE.get(cacheRequest);
  if (cached.hit && cached.metadata && cached.metadata.kind !== "collection") {
    const metadata = cached.metadata;
    return Object.assign({ ok: true, id: metadata.id || metadata.sourceUrl,
      titulo: metadata.title, canal: metadata.author, duracao: metadata.duration || 0,
      thumb: metadata.thumbnail || "", audio: null, doCache: true }, metadata);
  }
  const r = await rodaYt(argsCookies().concat([
    "--no-warnings", "--no-playlist", "--socket-timeout", "20",
    "-f", "ba/b",
    "-J", "--", url,
  ]));
  if (r.code !== 0) {
    /* O BRUTO VAI JUNTO, para o app.js poder mandá-lo INTEIRO para o log. O
       limpaErro fica com a última linha de ERROR e joga fora o resto -- e o
       resto é onde estava o aviso do runtime. */
    return {
      ok: false,
      erro: enxugaBloqueio(limpaErro(r.erro)) || "yt-dlp saiu com codigo " + r.code,
      bruto: String(r.erro || "").trim(),
      dica: await explicaFalha(r.erro),
      providerError: providers.classifyProviderError(r.erro),
      /* A ACAO diz ao app.js que esta falha TEM saida, e qual. Um campo
         proprio, e nao um regex na dica: a dica e texto para uma pessoa ler e
         muda com o idioma; decidir botao por ela seria amarrar o comportamento
         a uma frase. */
      acao: ehBloqueioBot(r.erro) ? "cookies" : "",
    };
  }

  let j;
  try { j = JSON.parse(r.saida); }
  catch (e) { return { ok: false, erro: "resposta do yt-dlp nao era JSON" }; }
  if (!j || !j.id) return { ok: false, erro: "o link nao devolveu uma fonte de mídia", providerError: "incomplete-metadata" };

  const normalized = providers.normalizeYTDLP(j, url);
  if (normalized.kind === "collection") {
    return {
      ok: false,
      erro: "lenken inneholder en samling/spilleliste; velg ett element før nedlasting",
      providerError: "collection-detected",
      collection: normalized,
    };
  }
  if (normalized.liveStatus === "is_live" || normalized.liveStatus === "is_upcoming") {
    return {
      ok: false,
      erro: normalized.liveStatus === "is_upcoming"
        ? "kilden er en kommende livestream"
        : "aktiv livestream støttes ikke i trim-/nedlastingsflyten",
      providerError: "active-livestream",
      liveStatus: normalized.liveStatus,
      metadata: normalized,
    };
  }
  if (!normalized.duration) {
    const candidates = [];
    if (Array.isArray(j.requested_formats)) candidates.push(...j.requested_formats);
    if (Array.isArray(j.formats)) candidates.push(...j.formats);
    const source = candidates.find((f) => f && f.url && f.vcodec !== "none") || candidates.find((f) => f && f.url);
    if (source && source.url) {
      const probed = await ffprobeKilde(source.url);
      if (probed > 0) normalized.duration = probed;
    }
  }
  try { METADATA_CACHE.set(cacheRequest, Object.assign({ id: j.id }, normalized)); }
  catch (_) { /* Cache is an optimization; a read-only profile must still download. */ }
  return Object.assign({
    ok: true,
    id: j.id,
    titulo: j.title || j.id,
    duracao: Number(j.duration) || 0,
    canal: j.uploader || j.channel || "",
    thumb: j.thumbnail || "",
    /* null quando nao da para ir pelo caminho curto, e ai o app.js usa o
       baixaAudio() de sempre. Nunca undefined: quem le tem de poder perguntar
       `if (info.audio)` sem se preocupar com a diferenca. */
    audio: audioDoJson(j),
  }, normalized, {
    /* Keep the old names consumed by app.js until the UI migration is complete. */
    id: j.id,
    titulo: normalized.title,
    canal: normalized.author,
    duracao: normalized.duration,
    thumb: normalized.thumbnail,
    audio: audioDoJson(j),
  });
}

function contentTypeForUrl(url) {
  return new Promise((resolve) => {
    const transport = url.protocol === "https:" ? https : http;
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value || ""); } };
    let req;
    try {
      req = transport.request(url, { method: "HEAD", timeout: 8000, headers: { "User-Agent": "DirectDownloadPlus/0.1" } }, (res) => {
        const type = String(res.headers["content-type"] || "");
        res.resume();
        finish(type);
      });
      req.on("timeout", () => { req.destroy(); finish(""); });
      req.on("error", () => finish(""));
      req.end();
    } catch (_) { finish(""); }
  });
}

/* O ENDERECO DO AUDIO, LIDO DO JSON DA CONSULTA  (2.3.0)

   Devolve null sempre que houver qualquer duvida. Esta funcao decide se o
   painel pode pular uma extracao -- e o custo de ela errar para o lado
   otimista e um download que falha; o custo de errar para o lado pessimista e
   o painel ficar tao rapido quanto era ontem. Os dois nao se comparam.

   AS QUATRO RECUSAS, e cada uma tem motivo proprio:

   . SEM URL, ou url que nao e https. Formato de manifesto (HLS/DASH) as vezes
     vem sem `url`, e um fragmento solto nao se baixa com um -i.

   . FORMATO COM VIDEO DENTRO. O `ba/b` cai no `b` quando o video nao tem faixa
     de audio separada, e ai o endereco e do arquivo inteiro. Da para extrair o
     audio dele, mas seria puxar dezenas de MB de imagem que ninguem vai ver --
     o yt-dlp faz isso melhor, e e o que a reserva ja faz.

   . FORMATO COMBINADO (requested_formats com mais de um). Sao dois enderecos
     para juntar, e juntar e trabalho do yt-dlp.

   . SEM EXTENSAO UTIL. O nome do arquivo temporario sai daqui, e um `ext` vindo
     da internet nao entra num caminho de disco sem ser lavado. */
function audioDoJson(j) {
  const lista = (j && Array.isArray(j.requested_downloads)) ? j.requested_downloads : [];
  const d = lista[0];
  if (!d || typeof d !== "object") return null;
  if (Array.isArray(d.requested_formats) && d.requested_formats.length > 1) return null;
  if (typeof d.url !== "string" || !/^https:\/\//.test(d.url)) return null;
  if (d.vcodec && String(d.vcodec) !== "none") return null;
  const ext = String(d.ext || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase();
  if (!ext) return null;
  return {
    url: d.url,
    ext,
    /* O yt-dlp diz de que cabecalhos aquele endereco precisa. Levar os dele e
       melhor que inventar os nossos: e o mesmo dado que ele usaria para baixar. */
    cabecalhos: (d.http_headers && typeof d.http_headers === "object") ? d.http_headers : null,
  };
}

/* OS CABECALHOS, TRADUZIDOS PARA O ffmpeg.

   O User-Agent tem opcao propria (`-user_agent`); o resto vai num `-headers`
   so, separado por CRLF, e os dois precisam vir ANTES do -i para valerem para
   a entrada.

   A GUARDA DO \r\n NAO E ENFEITE. O valor vem de um JSON que veio da internet.
   Um valor com quebra de linha dentro emendaria cabecalhos inventados no
   pedido -- e quem os receberia e o Google, com a nossa cara. Vale mais
   descartar o cabecalho torto que confiar em quem o escreveu. */
function argsCabecalho(h) {
  if (!h || typeof h !== "object") return [];
  const args = [];
  const linhas = [];
  for (const k of Object.keys(h)) {
    const v = h[k] == null ? "" : String(h[k]);
    if (!v) continue;
    if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) continue;
    if (String(k).toLowerCase() === "user-agent") { args.push("-user_agent", v); continue; }
    linhas.push(k + ": " + v);
  }
  if (linhas.length) args.push("-headers", linhas.join("\r\n") + "\r\n");
  return args;
}

/* O PROGRESSO DO ffmpeg, QUE NAO E O DO yt-dlp.

   O yt-dlp escreve "[download]  42.7% of ..." -- ele sabe a porcentagem. O
   ffmpeg nao sabe: com `-progress pipe:1` ele escreve blocos de `chave=valor`,
   e o que serve e o `out_time`, que e o instante do audio ja escrito. A conta
   precisa da duracao, e por isso ela entra como parametro.

   A ULTIMA OCORRENCIA, E NAO A PRIMEIRA. Um chunk de stdout costuma trazer
   varios blocos, e o primeiro deles e o mais VELHO. Ler o primeiro faria a
   barra andar atrasada, e num download curto ela pararia antes do fim. E a
   mesma armadilha da linha [0] do rastro que o t20 ja pegou uma vez.

   `out_time=` e nao `out_time_ms=`: o out_time_ms do ffmpeg vem em
   MICROssegundos apesar do nome, e um dia alguem vai consertar isso. O
   out_time e HH:MM:SS.mmm e nao tem essa ambiguidade.

   TETO EM 99,9%: o 100% quem da e o processo fechando com o arquivo no disco.
   Uma barra que chega a 100 e continua rodando e uma barra que mente. */
function leProgressoFf(texto, duracao) {
  const d = Number(duracao) || 0;
  if (d <= 0) return null;
  const todas = String(texto || "").match(/out_time=\d+:\d\d:\d\d(?:\.\d+)?/g);
  if (!todas || !todas.length) return null;
  const m = /out_time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(todas[todas.length - 1]);
  if (!m) return null;
  const seg = Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]);
  if (!Number.isFinite(seg) || seg < 0) return null;
  return Math.max(0, Math.min(seg / d * 100, 99.9));
}

/* BAIXAR O AUDIO PELO ENDERECO QUE A CONSULTA JA TROUXE  (2.3.0)

   O yt-dlp nao e chamado aqui. O endereco veio da consulta, e quem puxa os
   bytes e o ffmpeg -- que ja esta embarcado, ja e chamado pelo geraOnda e pelo
   corta, e sabe dizer onde esta.

   `-c:a copy` E NAO REENCODE, e isso e requisito e nao preferencia: o arquivo
   temporario que sai daqui e lido pelo geraOnda e cortado pelo corta(), e e o
   corta() quem escolhe a qualidade final. Converter aqui seria uma perda a mais
   antes daquela decisao, sem ninguem ter pedido.

   `-vn` mesmo sendo faixa de audio: o audioDoJson ja recusou formato com video,
   entao aqui ele nao tira nada. Fica como cinto -- se um dia aquela recusa
   afrouxar, o que sai daqui continua sendo audio.

   O QUE ELE NAO FAZ, e esta escrito para nao ser descoberto num chamado: o
   ffmpeg nao RETOMA um download interrompido do jeito que o yt-dlp retoma.
   Queda de rede no meio significa comecar de novo. Para musica de quatro
   minutos isso e aceitavel; se aparecer relato de arquivo grande, a saida e
   cair na reserva por tamanho, e nao remendar aqui.

   E ELE FALHA PARA A RESERVA, SEMPRE. Endereco vencido, formato que nao entra
   naquele container, ffmpeg sem o protocolo https: em qualquer um desses o
   app.js chama o baixaAudio() de sempre. Nao existe caso em que esta funcao
   deixe alguem sem baixar -- ela so deixa de ser rapida. */
async function baixaAudioDireto(audio, id, duracao, aoProgresso, aoNascer) {
  if (!audio || !audio.url || !audio.ext) return { ok: false, erro: "sem endereco de audio" };

  const ff = acha("ffmpeg");
  if (!path.isAbsolute(ff)) return { ok: false, erro: "nao achei o ffmpeg" };

  const pasta = path.join(os.tmpdir(), "DirectDownload");
  try { fs.mkdirSync(pasta, { recursive: true }); }
  catch (e) { return { ok: false, erro: "nao consegui criar a pasta temporaria" }; }

  /* O MESMO PREFIXO DO baixaAudio(), de proposito: as duas rotas escrevem o
     mesmo arquivo para o mesmo id, e o limpaTemporarios de uma varre o que a
     outra deixou. Dois prefixos diferentes acumulariam dois arquivos por
     video, e o achaArquivo() pegaria o mais recente -- que as vezes seria o
     da rota que falhou. */
  const base = "dd_" + nomeSeguro(id);
  limpaTemporarios(pasta, base);
  const saida = path.join(pasta, base + "." + audio.ext);

  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:1"]
    .concat(argsCabecalho(audio.cabecalhos), ["-i", audio.url, "-vn", "-c:a",
      audio.reencode ? "aac" : "copy", saida]);

  const r = await roda(ff, args, aoProgresso, aoNascer);
  if (r.code !== 0) {
    /* O ERRO INTEIRO VAI NO CAMPO, e nao so a ultima linha. Quem le isto e o
       log, que precisa saber POR QUE a rota rapida caiu -- e foi justamente
       jogar fora o resto do stderr que fez o chamado do "This video is not
       available" custar tres rodadas na 2.0.0. */
    return { ok: false, erro: limpaErro(r.erro) || "ffmpeg saiu com codigo " + r.code,
             bruto: String(r.erro || "").trim() };
  }

  /* ARQUIVO NO LUGAR CERTO E TAMANHO ZERO E UM CASO REAL: o ffmpeg cria a
     saida antes de escrever nela, e um 403 no meio do caminho deixa o arquivo
     ali, vazio, com codigo de saida que nem sempre denuncia. Perguntar ao
     disco custa uma chamada e fecha esse buraco. */
  let tam = 0;
  try { tam = fs.statSync(saida).size; } catch (e) { tam = 0; }
  if (tam < 1024) {
    try { fs.unlinkSync(saida); } catch (e) {}
    return { ok: false, erro: "o ffmpeg terminou, mas o arquivo saiu vazio" };
  }
  return { ok: true, arquivo: saida, bytes: tam };
}

async function baixaVideoDireto(url, id, inicio, fim, destino, titulo, aoProgresso, aoNascer) {
  const ff = acha("ffmpeg");
  if (!path.isAbsolute(ff) || !/^https?:\/\//i.test(String(url || ""))) {
    return { ok: false, erro: "direct-file krever en gyldig URL og FFmpeg" };
  }
  try { fs.mkdirSync(destino, { recursive: true }); } catch (_) {
    return { ok: false, erro: "klarte ikke å opprette målmappe" };
  }
  const sufixo = Number.isFinite(inicio) && Number.isFinite(fim) && fim > inicio
    ? "_" + Math.floor(inicio) + "-" + Math.floor(fim) : "";
  const output = path.join(destino, nomeSeguro(titulo || id || "video") + sufixo + ".mp4");
  const args = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:1"];
  if (Number.isFinite(inicio) && inicio > 0) args.push("-ss", String(inicio));
  args.push("-i", String(url));
  if (Number.isFinite(inicio) && Number.isFinite(fim) && fim > inicio) args.push("-t", String(fim - inicio));
  args.push("-c", "copy", output);
  const r = await roda(ff, args, aoProgresso, aoNascer);
  if (r.code !== 0) return { ok: false, erro: limpaErro(r.erro) || "FFmpeg kunne ikke laste ned direkte video", bruto: String(r.erro || "") };
  try { if (fs.statSync(output).size < 1024) return { ok: false, erro: "direkte videofil ble tom" }; }
  catch (_) { return { ok: false, erro: "direkte videofil ble ikke opprettet" }; }
  return { ok: true, arquivo: output };
}

async function ffprobeDuracao(arquivo) {
  const probe = acha("ffprobe");
  if (!path.isAbsolute(probe) || !arquivo) return 0;
  const r = await roda(probe, ["-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", arquivo]);
  if (r.code !== 0) return 0;
  const n = Number(String(r.saida || "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function ffprobeKilde(url) {
  if (!url || !/^https?:\/\//i.test(String(url))) return 0;
  const probe = acha("ffprobe");
  if (!path.isAbsolute(probe)) return 0;
  const r = await rodaComTeto(probe, ["-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", String(url)], 20000);
  const n = Number(String(r.saida || "").trim());
  return r.code === 0 && Number.isFinite(n) && n > 0 ? n : 0;
}

/* BUSCAR NO YOUTUBE  (1.8.8)

   QUEM BUSCA E O yt-dlp, e nao a API do YouTube. Nao e economia de trabalho,
   e a unica opcao que funciona: o `search.list` da API oficial custa 100
   unidades da cota diaria de 10.000. Sao 100 buscas por dia somando TODOS os
   painteis instalados -- nao por pessoa. Morreria no primeiro dia, e com uma
   chave nossa embutida no instalador para qualquer um extrair.

   O `ytsearchN:` resolve isso sem chave, sem conta e sem cota.

   --flat-playlist E OBRIGATORIO, pelo mesmo motivo que o --no-playlist e
   obrigatorio na consulta() logo acima. Sem ele o yt-dlp RESOLVE os vinte
   videos, um por um, antes de responder: 30 segundos em vez de 2. Com ele, um
   pedido so, e cada entrada ja traz o que a lista precisa mostrar.

   O TITULO VEM DA INTERNET. Quem desenha a lista tem de usar textContent, como
   o analisar() ja faz com o titulo do video. */
/* UMA BUSCA POR VEZ  (1.8.9)

   Com a busca disparando enquanto se digita, a busca anterior tem de MORRER, e
   nao apenas ser ignorada. Descartar a resposta e barato para quem espera e
   caro para o YouTube: o processo continua baixando a pagina de resultados de
   um termo que ninguem quer mais.

   O sinal e guardado aqui, no motor, e nao no app.js. Quem sabe que ha um
   processo vivo e quem o criou. */
let BUSCA_PROC = null;

function paraBusca() {
  if (!BUSCA_PROC) return;
  try { BUSCA_PROC.kill(); } catch (e) { /* ja morreu sozinho */ }
  BUSCA_PROC = null;
}

async function busca(termo, quantos) {
  const t = String(termo || "").trim();
  if (!t) { paraBusca(); return { ok: false, erro: "termo vazio" }; }

  const n = Math.min(Math.max(Number(quantos) || 20, 1), 50);

  paraBusca();
  let meu = null;

  /* O termo entra depois de "ytsearchN:" e vai como UM argumento, via spawn
     sem shell -- entao nao ha o que escapar. O "--" antes fecha a lista de
     opcoes: sem ele, um termo comecando com "-" viraria flag do yt-dlp. */
  /* O ATALHO VALE AQUI, e sem ressalva: a busca le titulo, canal e duracao --
     ela nao produz endereco para tocar, entao o problema de o endereco nao
     valer fora do cliente nao existe. O `--flat-playlist` ja evitava resolver
     os vinte videos um a um; o atalho tira tambem o desafio do player da
     propria consulta. */
  const tBusca = Date.now();
  const r = await rodaYt(argsCookies().concat(ATALHO, [
    "--no-warnings", "--flat-playlist", "--socket-timeout", "20",
    "-J", "--", "ytsearch" + n + ":" + t,
  ]), null, (p) => { meu = p; BUSCA_PROC = p; });

  if (BUSCA_PROC === meu) BUSCA_PROC = null;

  /* MORTO A PEDIDO NAO E ERRO, e a diferenca importa na tela: um processo que
     recebeu kill sai com code null (ou 143). Tratar isso como falha faria a
     faixa piscar "a busca falhou" a cada letra digitada -- um erro vermelho
     causado justamente por a pessoa estar digitando bem. */
  if (r.code === null || r.code === 143) return { ok: false, cancelada: true, erro: "" };

  if (r.code !== 0) return { ok: false, erro: limpaErro(r.erro) || "yt-dlp saiu com codigo " + r.code };

  let j;
  try { j = JSON.parse(r.saida); }
  catch (e) { return { ok: false, erro: "resposta do yt-dlp nao era JSON" }; }

  const entradas = (j && Array.isArray(j.entries)) ? j.entries : [];

  /* Entrada sem id e lixo do yt-dlp (canal, playlist, resultado retirado), e
     sem id nao ha link para montar. Some em silencio -- avisar "3 dos 20
     resultados eram invalidos" nao ajuda ninguem a escolher uma musica. */
  const itens = entradas.filter((e) => e && e.id).map((e) => ({
    id: e.id,
    titulo: e.title || e.id,
    canal: e.uploader || e.channel || "",
    duracao: Number(e.duration) || 0,
    /* MONTADO AQUI, e nao lido do e.url. Com --flat-playlist o yt-dlp as vezes
       devolve url e as vezes nao, e quando devolve o formato varia. O id
       sempre vem, e a URL canonica a partir dele e sempre a mesma. */
    url: "https://www.youtube.com/watch?v=" + e.id,
    /* AO VIVO nao tem duracao e nao serve para virar trilha. Nao e filtrado
       aqui: quem desenha decide se mostra, e mostrar com um rotulo e melhor
       que sumir com o resultado que a pessoa procurava. */
    aoVivo: !!(e.live_status && e.live_status !== "not_live" && e.live_status !== "was_live"),
  }));

  return { ok: true, itens, ms: Date.now() - tBusca };
}

/* AS MINIATURAS DA BUSCA  (1.8.8)

   PELO MESMO CAMINHO DA CAPA, e de proposito: curl num processo separado, para
   um arquivo em disco, e o painel carrega por file:// -- que a CSP ja permite
   em img-src. O comentario da capa, no index.html, explica a regra: o painel
   nao fala com a internet, quem fala e um processo separado. Vinte miniaturas
   nao sao motivo para abrir a CSP nem para inventar uma segunda regra.

   UM curl SO, com varios pares -o/url. Vinte processos curl paralelos seriam
   vinte handshakes TLS com o mesmo host; um processo reaproveita a conexao.

   mqdefault: 320x180, ~10 KB. A hqdefault tem 480x360 e vem com tarja preta em
   cima e embaixo em video 16:9 -- o corte dela e 4:3. */
async function baixaMiniaturas(itens) {
  const lista = (itens || []).filter((i) => i && i.id);
  if (!lista.length) return {};

  const pasta = path.join(os.tmpdir(), "DirectDownload", "miniaturas");
  try { fs.mkdirSync(pasta, { recursive: true }); } catch (e) { return {}; }

  const args = ["-fsL", "--max-time", "20", "--parallel"];
  const destinos = {};
  let pedir = 0;
  for (const it of lista) {
    const dest = path.join(pasta, "mini_" + nomeSeguro(it.id) + ".jpg");
    destinos[it.id] = dest;
    /* JA ESTA NO DISCO? ENTAO NAO PEDE DE NOVO  (1.9.0)

       A miniatura de um id nunca muda. Isso importa desde que a busca passou a
       ser LEMBRADA entre uma sessao e outra: reabrir o painel redesenha os
       vinte resultados, e sem esta guarda cada reabertura seria mais um curl
       com vinte imagens que ja estao ali do lado.

       O corte de 200 bytes e o mesmo que decide la embaixo o que "chegou":
       um arquivo truncado nao conta como pronto e volta a ser pedido. */
    try { if (fs.statSync(dest).size > 200) continue; } catch (e) { /* nao existe */ }
    pedir++;
    args.push("-o", dest, "https://i.ytimg.com/vi/" + encodeURIComponent(it.id) + "/mqdefault.jpg");
  }

  /* O codigo de saida do curl NAO decide nada aqui. Com -fsL e varias URLs, um
     404 numa delas derruba o codigo de saida inteiro -- e as outras dezenove
     chegaram bem. Quem decide e o disco, arquivo por arquivo.

     Miniatura que falta nao e erro: a linha aparece sem imagem. Um resultado
     sem capa continua clicavel, e o titulo e o que a pessoa le de verdade. */
  /* Nenhuma faltando: nao ha por que acordar o curl so para ele nao fazer
     nada -- e um curl sem nenhum par -o/URL e um erro de uso, nao um no-op. */
  if (pedir) await roda("curl", args);

  const prontas = {};
  for (const id of Object.keys(destinos)) {
    try { if (fs.statSync(destinos[id]).size > 200) prontas[id] = destinos[id]; }
    catch (e) { /* nao chegou; a linha fica sem imagem */ }
  }
  return prontas;
}

/* BAIXAR O AUDIO INTEIRO, NA MELHOR QUALIDADE, PARA UMA PASTA TEMPORARIA.

   POR QUE INTEIRO E NA HORA DO "ANALISAR": nao existe forma de onda sem os
   dados do audio. E, ja que ele vai ter de vir, vem uma vez so e na melhor
   qualidade -- assim o corte depois e LOCAL: instantaneo, exato no sample, e
   nada e baixado duas vezes. Musica de 3 a 5 minutos da poucos MB.

   `-f ba/b` pega a melhor faixa de audio SEM converter. A conversao (WAVE ou
   MP3) acontece so no corte, e so no trecho escolhido.

   ATENCAO ETERNA: nunca acrescente --print a esta linha. `--print` liga o modo
   simulacao: o yt-dlp sai com CODIGO 0 e a pasta fica vazia. Foi um dos bugs
   mais confusos do BlackSlice -- sucesso aparente, nada no disco. */
async function baixaAudio(url, id, aoProgresso) {
  const pasta = path.join(os.tmpdir(), "DirectDownload");
  try { fs.mkdirSync(pasta, { recursive: true }); }
  catch (e) { return { ok: false, erro: "nao consegui criar a pasta temporaria" }; }

  const base = "dd_" + nomeSeguro(id);
  limpaTemporarios(pasta, base);

  const r = await rodaYt(argsCookies().concat([
    "--no-warnings", "--no-playlist", "--newline", "--progress",
    "--socket-timeout", "20",
    "-f", "ba/b",
    "-o", path.join(pasta, base + ".%(ext)s"),
    "--", url,
  ]), aoProgresso);

  if (r.code !== 0) return { ok: false, erro: limpaErro(r.erro) || "yt-dlp saiu com codigo " + r.code };

  /* ACHAR O ARQUIVO PELO DISCO, e nao pelo nome que planejamos. O yt-dlp
     decide a extensao no fim (m4a, webm, opus...). Confiar no nome previsto
     foi como o BlackSlice "baixou com sucesso" e nao achou nada depois. */
  const arq = achaArquivo(pasta, base);
  if (!arq) return { ok: false, erro: "o yt-dlp terminou, mas nao achei o arquivo em " + pasta };
  return { ok: true, arquivo: arq };
}

function limpaTemporarios(pasta, prefixo) {
  try {
    for (const f of fs.readdirSync(pasta)) {
      if (f.startsWith(prefixo)) { try { fs.unlinkSync(path.join(pasta, f)); } catch (e) {} }
    }
  } catch (e) {}
}

function achaArquivo(pasta, prefixo) {
  let lista;
  try { lista = fs.readdirSync(pasta); } catch (e) { return null; }
  const c = lista
    .filter((f) => f.startsWith(prefixo) && !f.endsWith(".part"))
    .map((f) => {
      const p = path.join(pasta, f);
      let m = 0;
      try { m = fs.statSync(p).mtimeMs; } catch (e) {}
      return { p, m };
    })
    .sort((a, b) => b.m - a.m);
  return c.length ? c[0].p : null;
}

/* BAIXAR A CAPA.

   Vai para o mesmo temporario do audio. Sao ~20 KB e serve para o painel poder
   manter a CSP fechada: quem fala com a rede continua sendo so um processo
   externo, e o <img> aponta para um arquivo local.

   Falhar aqui NAO e erro: a capa e conveniencia. Devolve string vazia e o
   painel simplesmente nao mostra nada. */
/* O ENDERECO PADRAO DA CAPA, montado a partir do id.

   Ele vive AQUI, e nao no app.js, e a regra tem teste: o painel nao pode ter
   um endereco do ytimg em lugar nenhum, porque a CSP recusa https em img-src e
   o defeito seria mudo -- um quadrado vazio, sem erro. Quem fala com a
   internet e o motor, num processo separado, e quem entrega ao painel e o
   caminho do arquivo em disco. A miniatura da lista ja seguia essa regra.

   hqdefault e o maior tamanho que existe para todo video. */
function urlDaCapa(id) {
  return "https://i.ytimg.com/vi/" + encodeURIComponent(String(id || "")) + "/hqdefault.jpg";
}

async function baixaCapa(url, id) {
  if (!url) return "";
  const pasta = path.join(os.tmpdir(), "DirectDownload");
  try { fs.mkdirSync(pasta, { recursive: true }); } catch (e) { return ""; }
  const dest = path.join(pasta, "capa_" + nomeSeguro(id) + ".jpg");
  const r = await roda("curl", ["-fsL", "--max-time", "15", "-o", dest, url]);
  if (r.code !== 0) return "";
  try { if (fs.statSync(dest).size < 200) return ""; } catch (e) { return ""; }
  return dest;
}

/* A FORMA DE ONDA.

   O BlackSub faz isto em Swift com AVAssetReader; aqui e o ffmpeg despejando
   PCM cru na saida padrao e o Node acumulando os picos. A LOGICA e a mesma, e
   o comentario dele vale igual:

     "Antes, TODAS as amostras PCM eram acumuladas num array antes de comprimir:
      1h de audio 48kHz estereo ~ 340M floats ~ 1,4 GB de RAM. Agora o pico e
      calculado em streaming e so os ~1500 baldes ficam em memoria."

   Por isso pedimos ao ffmpeg 8 kHz MONO: para desenhar picos numa barra de
   ~600 px, 8000 amostras por segundo ja e muito mais do que o suficiente, e
   corta o volume de dados por 12 em relacao a 48 kHz estereo.

   s16le = inteiros de 16 bits, little-endian. Cada amostra sao 2 bytes -- e um
   chunk pode terminar no MEIO de uma amostra, por isso o byte que sobra e
   guardado para o proximo. Sem isso a onda ganha ruido a cada fronteira de
   chunk, e o defeito e sutil o bastante para passar despercebido. */
function geraOnda(arquivo, duracao, baldes) {
  return new Promise((resolve) => {
    const N = baldes || 1500;
    const TAXA = 8000;
    const totalAmostras = Math.max(N, Math.floor((duracao || 1) * TAXA));
    const porBalde = Math.max(1, Math.floor(totalAmostras / N));

    let p;
    try {
      p = spawn(acha("ffmpeg"), [
        "-v", "quiet", "-i", arquivo,
        "-f", "s16le", "-ac", "1", "-ar", String(TAXA), "-",
      ], { env: process.env, windowsHide: true });
    } catch (e) { return resolve({ ok: false, erro: String(e && e.message || e) }); }

    const picos = [];
    let pico = 0, conta = 0, sobra = null;

    p.stdout.on("data", (chunk) => {
      let buf = chunk;
      if (sobra) { buf = Buffer.concat([sobra, chunk]); sobra = null; }
      const n = buf.length >> 1;              // quantas amostras inteiras cabem
      if (buf.length & 1) sobra = buf.slice(buf.length - 1);

      for (let i = 0; i < n; i++) {
        const v = Math.abs(buf.readInt16LE(i * 2)) / 32768;
        if (v > pico) pico = v;
        if (++conta >= porBalde) { picos.push(pico); pico = 0; conta = 0; }
      }
    });

    // stderr precisa de leitor mesmo com -v quiet: pipe sem leitor trava.
    p.stderr.on("data", () => {});
    p.on("error", (e) => resolve({ ok: false, erro: String(e && e.message || e) }));
    p.on("close", () => {
      if (conta > 0) picos.push(pico);
      if (!picos.length) return resolve({ ok: false, erro: "o ffmpeg nao devolveu audio" });
      resolve({ ok: true, picos });
    });
  });
}

/* CORTAR E CONVERTER — local, sem tocar na rede.

   -ss antes do -i e seek rapido; -t depois e a duracao. Com o arquivo ja no
   disco, o corte e exato no sample: nao ha o arredondamento por keyframe que
   o --download-sections do yt-dlp impoe.

   WAVE sai em PCM 24 bits / 48 kHz, que e o que o Resolve prefere e evita
   redecodificar a cada scrub na timeline.

   MP3 a 320k. Vale lembrar que o audio do YouTube JA e comprimido: o MP3 aqui
   e perda sobre perda. Para levar ao Media Pool o WAVE e o caminho limpo; o
   MP3 serve para quando o arquivo precisa ser leve. */
async function corta(origem, inicio, fim, formato, destino, titulo) {
  const dur = (Number.isFinite(inicio) && Number.isFinite(fim) && fim > inicio)
    ? (fim - inicio) : null;

  const base = nomeSeguro(titulo);
  const sufixo = dur ? "_" + Math.floor(inicio) + "-" + Math.floor(fim) : "";
  const ext = (formato === "MP3") ? ".mp3" : ".wav";
  const saida = path.join(destino, base + sufixo + ext);

  const args = ["-y", "-v", "error"];
  if (dur) args.push("-ss", String(inicio), "-t", String(dur));
  args.push("-i", origem);

  /* SEMPRE NA MELHOR QUALIDADE QUE CADA FORMATO PERMITE.

     A origem ja e a melhor possivel: o baixaAudio usa `-f ba/b`, que pega a
     faixa de audio de maior qualidade que o YouTube oferece, SEM converter.
     O que se decide aqui e so como ela vira arquivo.

     WAVE -> PCM 24 bits. Nao ha "qualidade" a escolher em PCM: ele e sem
     perda. 24 bits em vez de 16 dao margem para o audio apanhar na edicao
     (ganho, normalizacao, compressao) sem chegar no ruido de quantizacao.

     MP3 -> 320 kbps constante, que e o teto do formato. Vale saber: o audio do
     YouTube JA e comprimido, entao o MP3 aqui e perda sobre perda. Para
     editar, o WAVE e o caminho limpo; o MP3 serve quando o arquivo precisa ser
     leve para mandar para alguem.

     -compression_level 0 no LAME e o esforco MAXIMO do codificador (a escala e
     invertida: 0 e o mais caprichoso, 9 o mais apressado). Custa alguns
     segundos a mais e melhora o resultado no mesmo bitrate.

     O RESAMPLER, quando ha conversao: musica costuma vir a 44.1 kHz e o video
     trabalha a 48. Sem dizer nada, o ffmpeg usa um reamostrador rapido e
     mediano; o soxr e o de alta qualidade, e a diferenca aparece justamente em
     material musical. Se a origem ja estiver em 48 kHz, ele nao faz nada. */
  const RESAMPLE = "aresample=resampler=soxr:precision=28:osf=s32";

  if (formato === "MP3") {
    args.push("-vn", "-c:a", "libmp3lame",
              "-b:a", "320k", "-compression_level", "0",
              "-af", RESAMPLE, "-ar", "48000");
  } else {
    args.push("-vn", "-c:a", "pcm_s24le",
              "-af", RESAMPLE, "-ar", "48000");
  }

  args.push(saida);

  let r = await roda(acha("ffmpeg"), args);

  /* O soxr e opcional no ffmpeg. Uma compilacao minima nao o tem, e ai o
     comando falha inteiro por causa de um detalhe de qualidade -- trocar um
     arquivo bom por nenhum arquivo. Se for esse o caso, refaz sem o filtro. */
  if (r.code !== 0 && /soxr|aresample|No such filter/i.test(String(r.erro))) {
    const semSoxr = args.filter((a, i) => a !== "-af" && args[i - 1] !== "-af");
    r = await roda(acha("ffmpeg"), semSoxr);
    if (r.code === 0) { /* seguiu sem o resampler de alta qualidade */ }
  }

  if (r.code !== 0) return { ok: false, erro: limpaErro(r.erro) || "ffmpeg saiu com codigo " + r.code };
  if (!fs.existsSync(saida)) return { ok: false, erro: "o ffmpeg terminou, mas o arquivo nao esta la" };
  return { ok: true, arquivo: saida };
}

/* O VIDEO E OPCIONAL, E BAIXA NA HORA.

   Diferente do audio, o video NAO vem no Analisar -- seria baixar dezenas de
   MB que talvez ninguem use. Por isso a tela avisa que marcar "Video" dispara
   um download de verdade.

   avc1 primeiro: e o que o Resolve abre sem pensar. O YouTube entrega AV1 por
   padrao, e AV1 pesa na timeline e nem toda maquina decodifica por hardware.

   Aqui SIM usamos --download-sections, porque baixar o video inteiro para
   cortar depois seria desperdicio. O preco e o corte cair no keyframe mais
   proximo -- aceitavel para video de apoio, e por isso o audio (que e o
   produto principal) segue sendo cortado localmente. */
async function baixaVideo(url, inicio, fim, altura, destino, titulo, aoProgresso) {
  const temTrecho = Number.isFinite(inicio) && Number.isFinite(fim) && fim > inicio;
  const base = nomeSeguro(titulo);
  const sufixo = temTrecho ? "_" + Math.floor(inicio) + "-" + Math.floor(fim) : "";
  const modelo = path.join(destino, base + sufixo + ".%(ext)s");
  /* "max" = SEM TETO. Precisa de um seletor diferente, e nao de h="max":
     `height<=max` nao e filtro valido -- o yt-dlp aceita a linha, nao casa
     formato nenhum e cai no fallback, entregando qualquer coisa. */
  const h = String(altura || "max");
  const semTeto = (h === "max");

  const ff = acha("ffmpeg");
  const args = argsCookies().concat([
    "--no-warnings", "--no-playlist", "--newline", "--progress",
    "--socket-timeout", "20",
    "-f", semTeto
      ? "bv*[vcodec^=avc1]+ba/bv*+ba/b"
      : "bv*[vcodec^=avc1][height<=" + h + "]+ba/bv*[height<=" + h + "]+ba/b[height<=" + h + "]/b",
    "--merge-output-format", "mp4",
    "-o", modelo,
  ]);
  if (path.isAbsolute(ff)) args.push("--ffmpeg-location", path.dirname(ff));
  if (temTrecho) {
    args.push("--download-sections", "*" + inicio + "-" + fim);
    args.push("--force-keyframes-at-cuts");
  }
  args.push("--", url);

  const r = await rodaYt(args, aoProgresso);
  if (r.code !== 0) return { ok: false, erro: limpaErro(r.erro) || "yt-dlp saiu com codigo " + r.code };

  const arq = achaArquivo(destino, base + sufixo);
  if (!arq) return { ok: false, erro: "o yt-dlp terminou, mas nao achei o video em " + destino };
  return { ok: true, arquivo: arq };
}

/* O PERCENTUAL, LIDO DA LINHA DO yt-dlp.
   Ele escreve "[download]  42.7% of ..." e, com --newline, uma linha por
   atualizacao. Devolve null quando a linha nao e de progresso. */
function leProgresso(linha) {
  const m = /\[download\]\s+([\d.]+)%/.exec(String(linha));
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}


/* =====================================================================
   A PREVIA DA BUSCA  (1.9.0)

   O painel toca o resultado ANTES de baixar, e a unica coisa que o motor
   faz por isso e descobrir a URL direta do audio. Quem toca e o <audio>
   do painel, direto do YouTube -- nao ha arquivo, nao ha pasta temporaria
   para limpar, e o que trafega e so o que a pessoa ouvir.

   ISSO CUSTOU A CSP, e a decisao foi tomada de olho aberto: ate a 1.8.10 o
   painel nao falava com a internet, e as miniaturas passavam por um curl
   justamente para manter essa garantia. Aqui o que se compra e maior --
   ouvir qualquer faixa em cerca de um segundo, inclusive um mix de uma
   hora, sem baixar os 49 MB dele. O `media-src` do index.html ganhou
   `https://*.googlevideo.com`, e SO ele: nem `img-src`, nem `connect-src`,
   nem um `https:` solto.

   UMA PREVIA POR VEZ, pelo mesmo motivo da busca: pedir a URL da faixa 3 e
   depois a da faixa 7 deixaria dois yt-dlp vivos, e o da 3 ainda entregaria
   uma resposta que ninguem quer. Descartar a resposta nao para o processo.

   -f bestaudio: audio puro, sem video. O <audio> do Chromium toca tanto o
   webm/opus quanto o m4a/aac que o YouTube devolve, entao nao ha por que
   pedir um formato especifico e arriscar nao haver.

   AS URLS EXPIRAM. Sao assinadas e presas ao IP, e valem algumas horas --
   por isso o cache guarda o instante e devolve como se nao tivesse nada
   depois de PREVIA_VALE. Uma URL vencida nao da erro claro: da um <audio>
   que simplesmente nao toca.
   ===================================================================== */
let PREVIA_PROC = null;
const PREVIA_CACHE = new Map();

/* O PEDIDO EM VOO, e para qual id.

   Sem isto o preparo do mouse VIRAVA PREJUIZO: voce pousa o cursor na linha,
   o painel comeca a descobrir o endereco, voce clica meio segundo depois --
   e o clique matava esse processo para comecar o mesmo trabalho do zero. O
   hover deixava o play mais LENTO do que se nao existisse.

   Agora dois pedidos para o mesmo id sao um pedido so: quem chega depois
   recebe a mesma promessa e espera o que ja esta correndo. Pedido para OUTRO
   id continua matando o anterior -- ali o trabalho antigo virou lixo mesmo. */
let PREVIA_VOO = null;   /* { id, promessa } */
const PREVIA_VALE = 2 * 60 * 60 * 1000;   /* 2h, folgado dentro das ~6h */

function paraPrevia() {
  if (!PREVIA_PROC) return;
  try { PREVIA_PROC.kill(); } catch (e) { /* ja morreu sozinho */ }
  PREVIA_PROC = null;
}

/* DESCOBRIR O ENDERECO CUSTA UMA EXTRACAO INTEIRA, e e AQUI que mora a espera
   do play: o yt-dlp busca a pagina do video, resolve o desafio do player e so
   entao imprime a URL. Sao segundos, nao milissegundos, e nao ha flag que
   torne isso instantaneo -- o jeito de o clique parecer imediato e a resposta
   ja estar pronta quando ele acontece.

   Por isso o `silencioso`: com ele, esta funcao PREPARA um endereco por
   antecipacao e desiste na hora se ja houver um pedido em andamento. Um
   preparo nunca rouba a vez de um clique de verdade, e nunca enfileira
   processos contra o YouTube -- que foi o que derrubou a busca em fila na
   1.8.9.

   O tempo gasto volta no resultado. Sem numero, "esta lento" e opiniao. */
async function urlAudio(id, silencioso, semAtalho) {
  const alvo = String(id || "").trim();
  /* Sem atalho e outro pedido: nao pode ser respondido pelo voo em andamento,
     que pode ser justamente o do atalho. */
  if (semAtalho && PREVIA_VOO && PREVIA_VOO.id === alvo) PREVIA_VOO = null;
  const r = buscaUrlAudio(alvo, silencioso, semAtalho);
  /* So registra o que virou trabalho de verdade: cache e "ocupado" resolvem na
     hora e nao precisam de vaga. */
  if (r && typeof r.then === "function" && alvo) {
    PREVIA_VOO = { id: alvo, promessa: r };
    r.then(() => { if (PREVIA_VOO && PREVIA_VOO.promessa === r) PREVIA_VOO = null; },
           () => { if (PREVIA_VOO && PREVIA_VOO.promessa === r) PREVIA_VOO = null; });
  }
  return r;
}

async function buscaUrlAudio(id, silencioso, semAtalho) {
  const v = String(id || "").trim();
  if (!v) return { ok: false, erro: "sem id" };

  /* Pedido SEM ATALHO ignora o guardado: o guardado veio justamente do atalho
     que nao tocou. */
  if (semAtalho) PREVIA_CACHE.delete(v);
  const guardado = PREVIA_CACHE.get(v);
  if (guardado && Date.now() - guardado.quando < PREVIA_VALE) {
    return { ok: true, url: guardado.url, doCache: true, ms: 0 };
  }

  /* O MESMO ID JA ESTA SENDO BUSCADO? Entao espera aquele, em vez de matar e
     recomecar. E o caso do hover seguido de clique, que e o caso comum. */
  if (PREVIA_VOO && PREVIA_VOO.id === v) return PREVIA_VOO.promessa;

  /* Preparo NAO atropela: se ha processo vivo, ele e de OUTRO id (o caso acima
     ja saiu), e quem o pediu esta esperando. */
  if (silencioso && PREVIA_PROC) return { ok: false, ocupado: true, erro: "" };

  paraPrevia();
  let meu = null;
  const t0 = Date.now();

  /* DUAS TENTATIVAS, DA MAIS RAPIDA PARA A MAIS CERTA.

     O que demora numa extracao do YouTube nao e baixar: e o DESAFIO DO PLAYER.
     Para o cliente `web`, o yt-dlp precisa buscar a pagina do video (cerca de
     1 MB de HTML), achar o base.js, baixa-lo (mais de 2 MB) e INTERPRETAR o
     JavaScript dele para assinar o endereco. Sao segundos, e a maior parte
     deles e trabalho de CPU sobre um script de terceiros.

     Os clientes de TV e de celular entregam o endereco ja assinado, e
     `player_skip=webpage,configs` dispensa a pagina. Quando funciona, some
     quase toda a espera.

     POR QUE HA A SEGUNDA TENTATIVA: o YouTube mexe nessas portas com
     frequencia -- um cliente que responde hoje passa a exigir token amanha, e
     isso nao avisa. Entao a rapida e uma TENTATIVA, e a lenta e a garantia. Ao
     contrario de escolher um cliente fixo, isto nao quebra no dia da mudanca:
     volta a ficar lento, e o log diz que voltou.

     Argumento de extrator que o yt-dlp nao conhece vira aviso, e nao erro --
     com --no-warnings ele passa em silencio e a chamada segue pelo caminho
     normal. Ou seja: o pior caso desta tentativa e ela nao ajudar. */
  const ARGS_BASE = ["--no-warnings", "--no-playlist", "--socket-timeout", "20",
                     "-f", "bestaudio", "-g", "--"];
  const ALVO = "https://www.youtube.com/watch?v=" + v;
  const RAPIDO = ATALHO;

  /* 9s no atalho, 30s no caminho certo. O atalho existe para ser rapido: se
     ele nao respondeu em 9 segundos, ele deixou de ser atalho. */
  const pede = (extra, teto) => rodaYtComTeto(argsCookies().concat(extra, ARGS_BASE, [ALVO]),
                                              teto, (p) => { meu = p; PREVIA_PROC = p; });

  /* SEM ATALHO NAO HA DUAS TENTATIVAS A FAZER  (2.3.2)
     ...e isso custava NOVE SEGUNDOS por prevista nos dias ruins.

     O ATALHO esta vazio desde a 1.9.10. Com ele vazio, `pede(RAPIDO, 9000)` e
     `pede([], 30000)` sao a MESMA chamada -- os mesmos argumentos, o mesmo
     yt-dlp, o mesmo trabalho. A unica diferenca e o teto.

     Ou seja: quando a extracao legitimamente passava de 9 segundos, o painel
     matava o processo, jogava fora o trabalho todo e recomecava do zero. Num
     dia bom a primeira responde em 2,3 s e ninguem ve; num dia ruim, paga-se
     duas vezes. O log do Jhaimes registrou exatamente isso:

         urlVideo: 19.779 ms (normal (o rapido pendurou em 9013 ms))

     Nove segundos gastos para chegar a lugar nenhum, e a resposta de verdade
     custava os ~10.700 seguintes.

     A ESTRUTURA DAS DUAS TENTATIVAS FICA, e nao e sentimentalismo: ela e o
     desenho certo PARA QUANDO houver atalho. O dia em que alguem repovoar o
     ATALHO, a rapida volta a ser uma tentativa de verdade e a lenta volta a
     ser a garantia. O que muda aqui e so parar de pagar por ela enquanto ela
     nao existe. */
  const temAtalho = RAPIDO.length > 0;
  let r = (semAtalho || !temAtalho) ? { code: 1, saida: "", erro: "" }
                                    : await pede(RAPIDO, 9000);
  let caminho = semAtalho ? "normal (a pedido)"
              : temAtalho ? "rapido"
              : "normal (sem atalho a tentar)";
  const msRapido = Date.now() - t0;

  /* Morto a pedido nao tenta de novo: quem matou foi outra faixa. */
  const morto = (x) => x.code === null || x.code === 143;
  if (!morto(r) && (r.code !== 0 || !/https:\/\//.test(String(r.saida || "")))) {
    /* O RECADO E SOBRE A PRIMEIRA TENTATIVA, entao ele e montado ANTES de a
       segunda sobrescrever o r. Lido depois, ele contaria o que aconteceu com
       a normal e diria "o rapido pendurou" quando quem pendurou foi a outra. */
    const rapPendurou = !!(r && r.estourou);
    r = await pede([], 30000);
    /* SO CONTA A HISTORIA DO RAPIDO SE ELE EXISTIU. Sem esta guarda o log
       escrevia "o rapido falhou em 0 ms" quando rapido nenhum tinha rodado --
       e foi o que apareceu no log de 27/08, logo depois de um "pedindo sem
       atalho". Uma linha de log que descreve o que nao aconteceu custa a
       proxima meia hora de quem a le. */
    if (temAtalho && !semAtalho) {
      caminho = "normal (o rapido " + (rapPendurou ? "pendurou" : "falhou") + " em " + msRapido + " ms)";
    }
  }
  const ms = Date.now() - t0;

  if (PREVIA_PROC === meu) PREVIA_PROC = null;

  /* ESTOURAR O TETO NAO E CANCELAMENTO. Cancelado nao pinta nada na tela, de
     proposito -- acontece a cada troca de faixa. Estourado TEM de pintar,
     senao o painel fica com o "Buscando..." para sempre e sem explicacao, que
     e justamente o defeito que este teto existe para acabar. */
  if (r.estourou) return { ok: false, erro: r.erro };
  if (r.code === null || r.code === 143) return { ok: false, cancelada: true, erro: "" };
  if (r.code !== 0) return { ok: false, erro: limpaErro(r.erro) || "yt-dlp saiu com codigo " + r.code };

  /* A ULTIMA LINHA NAO VAZIA, e nao a primeira. Com um formato so o yt-dlp
     imprime uma URL -- mas se um dia ele resolver imprimir video e audio, a
     de audio e a segunda, e pegar a primeira daria um <audio> mudo tocando
     a trilha de um arquivo de video. */
  const linhas = String(r.saida || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const url = linhas[linhas.length - 1] || "";
  if (!/^https:\/\//.test(url)) return { ok: false, erro: "yt-dlp nao devolveu URL" };

  PREVIA_CACHE.set(v, { url, quando: Date.now() });
  return { ok: true, url, ms, caminho };
}


/* =====================================================================
   A IMAGEM DO VIDEO, PARA VER ENQUANTO MARCA  (1.9.5)

   Devolve a URL do fluxo de VIDEO PURO, sem audio. O painel toca isso num
   <video> mudo, colado no playhead do audio que ja esta em disco -- e assim
   da para marcar In e Out vendo a cena, sem baixar o video antes.

   POR QUE SEPARADO DO AUDIO, e nao um formato so: o YouTube entrega video e
   audio em fluxos distintos, e um formato combinado (o antigo 18) nem sempre
   existe e quando existe e 360p. Pedir os dois separados da 720p de imagem
   com o audio que o painel ja tem.

   NAO E PRECISO mpv NEM dash.js. O player do BlackSlice e libmpv porque o
   AVPlayer parou de abrir os segmentos DASH do YouTube; o Chromium abre. O
   unico problema real era manter dois elementos juntos, e isso foi medido:
   ~15ms depois de um alinhamento, sem deriva.

   ATE 720p de proposito: o painel tem 640 de largura, entao 1080p seria
   baixar o dobro de bytes para desenhar o mesmo tamanho na tela. Quem baixa
   de verdade continua escolhendo a qualidade nos Ajustes.
   ===================================================================== */
let VIDEO_PROC = null;
const VIDEO_CACHE = new Map();

function paraVideo() {
  if (!VIDEO_PROC) return;
  try { VIDEO_PROC.kill(); } catch (e) { /* ja morreu sozinho */ }
  VIDEO_PROC = null;
}

async function urlVideo(id, semAtalho) {
  const v = String(id || "").trim();
  if (!v) return { ok: false, erro: "sem id" };

  if (semAtalho) VIDEO_CACHE.delete(v);
  const guardado = VIDEO_CACHE.get(v);
  if (guardado && Date.now() - guardado.quando < PREVIA_VALE) {
    return { ok: true, url: guardado.url, doCache: true, ms: 0 };
  }

  paraVideo();
  let meu = null;
  const t0 = Date.now();

  /* O mesmo par de tentativas do audio: a rapida dispensa o desafio do player,
     e a normal e a garantia para o dia em que o YouTube fechar aquela porta. */
  /* O avc1 VEM NA FRENTE  (2.4.0), e isso e um conserto de bug.

     O seletor daqui pedia `bv*[height<=720]`, que e "o melhor video ate 720p"
     -- e o melhor, no YouTube, e quase sempre AV1 ou VP9. O <video> do painel
     recusava, e o que aparecia na tela era:

         Couldn't show the video: MEDIA_ELEMENT_ERROR: Format error

     O DOWNLOAD JA TINHA APRENDIDO ISSO, e o comentario dele esta escrito la
     desde a 1.9.x: "avc1 primeiro: e o que o Resolve abre sem pensar. O
     YouTube entrega AV1 por padrao". A previa ficou de fora daquela correcao,
     e o defeito sobreviveu por versoes porque em muitos videos o melhor ate
     720p CALHA de ser H.264 -- entao funcionava, menos quando nao funcionava.

     A CADEIA DE RESERVA CONTINUA: sem H.264 ate 720, pega o melhor ate 720;
     sem isso, o melhor que houver. Um video que so exista em AV1 volta a
     falhar como antes -- mas ai a culpa nao e da escolha. */
  const BASE = ["--no-warnings", "--no-playlist", "--socket-timeout", "20",
                "-f", "bv*[vcodec^=avc1][height<=720]+ba/bv*[height<=720]+ba/bv*+ba/b",
                "-g", "--"];
  const ALVO = "https://www.youtube.com/watch?v=" + v;
  const RAPIDO = ATALHO;
  const pede = (extra, teto) => rodaYtComTeto(argsCookies().concat(extra, BASE, [ALVO]),
                                              teto, (p) => { meu = p; VIDEO_PROC = p; });

  /* A MESMA CORRECAO DO urlAudio  (2.3.2): com o ATALHO vazio, a tentativa de
     9 segundos e a chamada de 30 sao identicas, e a primeira so serve para
     jogar fora 9 segundos de trabalho quando a extracao demora. Ver o
     comentario por extenso no buscaUrlAudio, logo acima.

     AQUI ELA CUSTAVA MAIS CARO QUE LA, porque o video passa por este caminho
     duas vezes quando o Chromium recusa o primeiro endereco -- que foi o que
     aconteceu no log de 27/08: 19.779 ms numa, 11.438 ms na outra. */
  const temAtalho = RAPIDO.length > 0;
  let r = (semAtalho || !temAtalho) ? { code: 1, saida: "", erro: "" }
                                    : await pede(RAPIDO, 9000);
  const msRapido = Date.now() - t0;
  let caminho = semAtalho ? "normal (a pedido)"
              : temAtalho ? "rapido"
              : "normal (sem atalho a tentar)";
  const morto = (x) => x.code === null || x.code === 143;
  if (!morto(r) && (r.code !== 0 || !/https:\/\//.test(String(r.saida || "")))) {
    /* O RECADO E SOBRE A PRIMEIRA TENTATIVA, entao ele e montado ANTES de a
       segunda sobrescrever o r. Lido depois, ele contaria o que aconteceu com
       a normal e diria "o rapido pendurou" quando quem pendurou foi a outra. */
    const rapPendurou = !!(r && r.estourou);
    r = await pede([], 30000);
    /* SO CONTA A HISTORIA DO RAPIDO SE ELE EXISTIU. Sem esta guarda o log
       escrevia "o rapido falhou em 0 ms" quando rapido nenhum tinha rodado --
       e foi o que apareceu no log de 27/08, logo depois de um "pedindo sem
       atalho". Uma linha de log que descreve o que nao aconteceu custa a
       proxima meia hora de quem a le. */
    if (temAtalho && !semAtalho) {
      caminho = "normal (o rapido " + (rapPendurou ? "pendurou" : "falhou") + " em " + msRapido + " ms)";
    }
  }
  const ms = Date.now() - t0;

  if (VIDEO_PROC === meu) VIDEO_PROC = null;
  if (r.estourou) return { ok: false, erro: r.erro };
  if (morto(r)) return { ok: false, cancelada: true, erro: "" };
  if (r.code !== 0) return { ok: false, erro: limpaErro(r.erro) || "yt-dlp saiu com codigo " + r.code };

  /* UMA EXTRACAO, DUAS URLS.

     Pedindo "bv*+ba" o yt-dlp imprime DUAS linhas: video primeiro, audio
     depois. E a mesma extracao que o urlAudio faria sozinho -- o que custa
     segundos e o desafio do player, nao a escolha do formato -- entao pedir os
     dois de uma vez faz a segunda vir de graca.

     Isso importa porque marcar a caixa Video, depois de ja ter ouvido a faixa,
     fazia o painel descobrir o MESMO video duas vezes. Agora a primeira das
     duas ja deixa a outra pronta no cache. */
  const linhas = String(r.saida || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const url = linhas[0] || "";
  if (!/^https:\/\//.test(url)) return { ok: false, erro: "yt-dlp nao devolveu URL de video" };

  VIDEO_CACHE.set(v, { url, quando: Date.now() });
  if (linhas.length > 1 && /^https:\/\//.test(linhas[linhas.length - 1])) {
    PREVIA_CACHE.set(v, { url: linhas[linhas.length - 1], quando: Date.now() });
  }
  /* A segunda linha e o audio. Com formato combinado (uma linha so) nao ha o
     que guardar aqui: aquela URL tem video junto, e o <audio> da previa tocaria
     um arquivo de video -- funciona, mas baixa imagem que ninguem ve. */
  return { ok: true, url, ms, caminho };
}


module.exports = {
  acha, temBinarios, consulta, contentTypeForUrl, busca, paraBusca, urlAudio, paraPrevia, poeCookies, urlVideo, paraVideo, baixaMiniaturas, urlDaCapa, baixaAudio, baixaCapa, geraOnda, corta, baixaVideo,
  leProgresso, limpaErro, nomeSeguro, urlDeArquivo, ehBloqueioBot, enxugaBloqueio, explicaFalha,
  /* A ROTA DIRETA (2.3.0). As tres saem exportadas porque as tres sao
     decisoes, e nao detalhe: o audioDoJson decide SE ha atalho, o argsCabecalho
     decide o que vai no pedido, e o leProgressoFf decide o que a barra mostra.
     Uma decisao que nenhum teste consegue chamar e uma decisao que ninguem
     conferiu. */
  baixaAudioDireto, baixaVideoDireto, ffprobeDuracao, ffprobeKilde, audioDoJson, argsCabecalho, leProgressoFf,
  providers,
  atualizaMotor, versaoDoMotor, pastaDoUsuario,
  fichaDosBinarios, argsMotorJS, ambiente,
  achaYt, achaYtJa, escolheYt, esqueceEscolhaYt, mediraDepois,
  /* O rodaYt sai exportado desde a 2.2.0 para que o t20 possa provar QUEM
     nasce quando ele e chamado. Um teste que so olhasse o comandoYt provaria
     a intencao e nao o ato -- e e exatamente essa distancia que tres
     sabotagens desta semana atravessaram sem serem vistas. */
  comandoYt, achaPython, achaZipapp, rodaYt,
  explicaFalha,
};


/* ATUALIZAR O yt-dlp — portado do upgradeYTDLP do BlackSlice.

   Por que isto existe: o YouTube muda a extracao com frequencia, e um yt-dlp
   de dois meses atras simplesmente para de baixar. Sem este botao, a unica
   saida seria gerar um instalador novo a cada mudanca deles.

   O PASSO QUE PARECE PARANOIA E NAO E: conferir com `file` que o que chegou e
   um Mach-O (ou PE32+ no Windows) ANTES de trocar o binario que funciona. Um
   download interrompido, ou uma pagina de erro HTML salva com o nome certo,
   substituiria um yt-dlp bom por lixo -- e o plugin so descobriria na proxima
   vez que alguem tentasse baixar algo. */
async function atualizaMotor(aoPasso) {
  const diz = (s) => { if (aoPasso) { try { aoPasso(s); } catch (e) {} } };
  const destinoDir = pastaDoUsuario();
  try { fs.mkdirSync(destinoDir, { recursive: true }); }
  catch (e) { return { ok: false, erro: "nao consegui criar " + destinoDir }; }

  /* COM PYTHON EMBARCADO O UPDATE BAIXA O ZIPAPP, e ele e doze vezes menor
     (2.2.0)

     O asset `yt-dlp` do release -- sem extensao nenhuma -- e o mesmo programa
     que o executavel de 35 MB, empacotado como zipapp: um zip com o codigo
     Python dentro, precedido de um shebang. Tres megabytes.

     Nao e so a economia de banda. O que vinha antes era um PyInstaller
     onefile, e trocar um binario rapido por um lento seria o UPDATE piorando
     o painel toda vez que alguem o apertasse. Aqui ele o mantem rapido. */
  const viaPython = comandoYt().viaPython;
  const nomeRemoto = viaPython ? "yt-dlp" : (EH_WIN ? "yt-dlp.exe" : "yt-dlp_macos");
  const nomeLocal = viaPython ? "yt-dlp.pyz" : (EH_WIN ? "yt-dlp.exe" : "yt-dlp");
  const url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/" + nomeRemoto;
  const tmp = path.join(os.tmpdir(), "dd_ytdlp_update");

  diz("Baixando yt-dlp...");
  try { fs.unlinkSync(tmp); } catch (e) {}

  const r = await roda("curl", [
    "-fSL", "--connect-timeout", "15", "--max-time", "300", "-o", tmp, url,
  ]);
  if (r.code !== 0 || !fs.existsSync(tmp)) {
    return { ok: false, erro: "download falhou (" + (limpaErro(r.erro) || "codigo " + r.code) + ")" };
  }

  /* A CONFERENCIA MUDA COM O FORMATO, e ela nao e paranoia: uma pagina de erro
     salva com o nome certo substituiria um yt-dlp que funciona por lixo, e o
     plugin so descobriria na proxima vez que alguem tentasse baixar algo.

     O zipapp nao e Mach-O nem PE32 -- e um zip. O `file` o descreve como "Zip
     archive data" ou como "Python script", dependendo de ele olhar o shebang
     ou o PK; por isso os dois valem, e ha ainda a prova de rodar mais abaixo,
     que e a que decide. */
  diz("Conferindo o arquivo...");
  const tipo = await roda("file", ["-b", tmp]);
  const desc = String(tipo.saida || "");
  const valido = viaPython
    ? /(Zip archive|Python script|a \/usr\/bin\/env python)/i.test(desc)
    : (EH_WIN ? /PE32/.test(desc) : /(Mach-O|executable)/.test(desc));
  if (!valido) {
    try { fs.unlinkSync(tmp); } catch (e) {}
    return { ok: false, erro: "o que baixou nao serve: " + desc.slice(0, 60) };
  }

  diz("Instalando...");
  const destino = path.join(destinoDir, nomeLocal);
  try {
    try { fs.unlinkSync(destino); } catch (e) {}
    fs.renameSync(tmp, destino);
  } catch (e) {
    // renomear entre discos diferentes falha; copiar sempre funciona
    try { fs.copyFileSync(tmp, destino); fs.unlinkSync(tmp); }
    catch (e2) { return { ok: false, erro: "nao consegui gravar em " + destino }; }
  }
  try { fs.chmodSync(destino, 0o755); } catch (e) {}

  /* No macOS o binario baixado vem sem assinatura e o Gatekeeper barra.

     O ZIPAPP NAO PRECISA DE codesign, e assina-lo seria pior que inutil: quem
     executa e o Python embarcado, que ja tem a propria assinatura, e o .pyz e
     dado a ele como ARGUMENTO -- o Gatekeeper nao olha argumentos. O xattr
     continua, porque a marca de quarentena atrapalha a leitura do arquivo. */
  if (!EH_WIN) {
    diz("Assinando...");
    await roda("xattr", ["-cr", destino]);
    if (!viaPython) await roda("codesign", ["--force", "--sign", "-", destino]);
  }

  /* A PROVA E RODAR. Arquivo no lugar certo, com o tamanho certo, e ainda
     assim pode nao executar. Perguntar a versao e o unico teste que vale --
     e de brinde e ela que o painel mostra.

     E A PROVA TEM DE PASSAR PELO MESMO CAMINHO DO USO: com Python embarcado,
     rodar o .pyz direto testaria o shebang `#!/usr/bin/env python3`, que
     procura um python3 no PATH do sistema. Numa maquina sem ele, o teste
     reprovaria um arquivo perfeito; noutra, aprovaria via um Python que o
     painel nunca vai usar. */
  diz("Conferindo...");
  const provaCmd = viaPython
    ? { exe: achaPython(), antes: [destino] }
    : { exe: destino, antes: [] };
  const v = await roda(provaCmd.exe, provaCmd.antes.concat(["--version"]));
  const versao = String(v.saida || "").trim().split(/\s+/)[0] || "";
  if (v.code !== 0 || !versao) {
    return { ok: false, erro: "instalou mas nao roda" };
  }
  /* A ESCOLHA CAI AQUI, e nao no proximo boot: o binario acabou de mudar, e
     quem continuar com a escolha velha usaria o antigo ate reabrir o painel --
     o mesmo "o botao nao fez nada" que a ordem do acha() existe para evitar. */
  esqueceEscolhaYt();
  return { ok: true, versao, caminho: destino };
}

/* A versao que esta rodando agora, para a tela mostrar antes de atualizar.

   PELO achaYt(), e nao pelo acha(): desde a 2.1.3 o painel pode estar usando
   um yt-dlp diferente do primeiro da lista, e mostrar a versao de um binario
   que nao e o que roda seria mentir na tela dos Ajustes. */
/* E PELO comandoYt() DESDE A 2.2.0, pelo mesmo motivo levado um passo adiante:
   agora quem roda pode nem ser um yt-dlp, e sim o Python com o .pyz na mao. */
async function versaoDoMotor() {
  const c = comandoYt();
  const r = await roda(c.exe, c.antes.concat(["--version"]));
  if (r.code !== 0) return "";
  return String(r.saida || "").trim().split(/\s+/)[0] || "";
}
