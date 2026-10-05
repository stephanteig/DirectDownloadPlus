// ===================================================================================
//   Direct Download — o painel
//
//   Fluxo: cola link -> Analisar (consulta + baixa o audio + desenha a onda)
//   -> arrasta sobre a onda para escolher o trecho -> DOWNLOAD -> Media Pool.
//
//   POR QUE O AUDIO VEM NO "ANALISAR": nao existe forma de onda sem os dados do
//   audio. Ja que ele tem de vir, vem uma vez so e na melhor qualidade — e o
//   corte depois e LOCAL: instantaneo, exato no sample, e nada e baixado duas
//   vezes. Musica de 3 a 5 minutos da poucos MB.
//
//   Sem player. O painel do Resolve e um Chromium e o YouTube nao toca por URL
//   direta ali (o que sobrou dele sao segmentos DASH sem indice utilizavel — a
//   mesma razao que matou o AVPlayer no BlackSlice). Quem tem player e o
//   Resolve, e o clipe cai no Media Pool em segundos.
// ===================================================================================
const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");

/* TUDO QUE ACONTECE AQUI VAI PARA O LOG, e o erro tambem vai para a TELA.

   Sem isto, um erro no arranque produz o pior sintoma possivel: a janela abre,
   nenhum botao funciona, e nada explica o motivo. Foi exatamente o que
   aconteceu na 1.0.6. */
function log(txt) {
  try { ipcRenderer.send("dd-log", String(txt)); } catch (e) {}
}

window.addEventListener("error", (ev) => {
  const m = (ev.error && ev.error.stack) || ev.message || "erro sem mensagem";
  log("ERRO: " + m);
  mostraFalha(m);
});
window.addEventListener("unhandledrejection", (ev) => {
  log("PROMESSA REJEITADA: " + (ev.reason && ev.reason.stack || ev.reason));
});

// Escreve direto no DOM, sem depender de nada que ja possa ter quebrado.
function mostraFalha(msg) {
  try {
    const el = document.getElementById("estado");
    if (el) { el.textContent = "ERRO: " + String(msg).slice(0, 300); el.className = "estado erro"; }
  } catch (e) {}
}

/* O require RELATIVO NO RENDERER NAO E RELATIVO A ESTE ARQUIVO.

   Esta linha custou duas versoes e a mensagem enganava:

       Error: Cannot find module './ponte.js'

   ...com o ponte.js no disco, 644, ao lado do app.js. O motivo e que, no
   processo renderer do Electron, o require relativo resolve a partir do
   DOCUMENTO HTML, e nao do .js que o chama. Como o index.html mora na raiz do
   plugin e o script em js/, "./ponte.js" foi procurado na RAIZ.

   O sintoma foi o pior possivel: o require estourava no topo do arquivo, o
   app.js inteiro morria antes de registrar um unico listener, e o painel abria
   com todos os botoes mudos -- sem nada na tela dizendo por que.

   O BlackNote+ nunca bateu nisto porque tem um app.js unico, sem modulos
   locais. Por isso o padrao dele nao me protegeu aqui.

   A funcao abaixo tenta as tres formas e anota qual venceu, para o log dizer a
   verdade caso o Electron mude de ideia numa versao futura. */
function carregaModulo(nome) {
  const path = require("path");
  const tentativas = [
    path.join(__dirname, nome),   // absoluto: o que sempre deveria funcionar
    "./js/" + nome,               // relativo ao index.html
    "./" + nome,                  // relativo a este arquivo
  ];
  let ultimo = null;
  for (const t of tentativas) {
    try {
      const m = require(t);
      log("modulo " + nome + " carregado de: " + t);
      return m;
    } catch (e) { ultimo = e; }
  }
  log("ERRO: nao consegui carregar " + nome + " — " + (ultimo && ultimo.message));
  return null;
}

const ponte = carregaModulo("ponte.js");
const motor = carregaModulo("motor.js");
const i18n  = carregaModulo("idiomas.js");
const txt   = (c) => (i18n ? i18n.txt(c) : c);

/* SE UM DOS DOIS FALTA, O PAINEL TEM DE DIZER ISSO E PARAR.

   Sem esta guarda, a primeira funcao que tocasse em `ponte` estourava com
   "Cannot read properties of undefined" tres telas adiante do problema real --
   uma mensagem que aponta para o lugar errado. Proteger o require e deixar o
   resto do arquivo supondo que ele funcionou e protecao pela metade. */
function modulosOk() {
  if (ponte && motor) return true;
  const falta = [!ponte && "ponte.js", !motor && "motor.js"].filter(Boolean).join(" e ");
  mostraFalha("nao carreguei " + falta + " — veja ~/Library/Logs/DirectDownload.log");
  return false;
}

// ---------------------------------------------------------------------------
// estado
// ---------------------------------------------------------------------------
let VIDEO = null;        // { id, titulo, duracao, canal }
let AUDIO_TEMP = null;   // caminho do audio inteiro, no temporario
let PICOS = [];          // ~1500 picos da forma de onda
let F_IN = 0, F_OUT = 1; // fracoes 0..1 do trecho escolhido

/* O ARQUIVO QUE DA PARA ARRASTAR  (1.8.7)

   Guarda o .wav (ou .mp3) que o ultimo DOWNLOAD gerou, na pasta do projeto.
   Enquanto for null, a onda nao arrasta nada.

   POR QUE SO DEPOIS DO DOWNLOAD, e nao ja na analise: a pasta de destino nao
   e conhecida antes. Ela vem do projeto aberto no Resolve -- que a pessoa
   pode trocar com o painel aberto -- ou de uma escolha manual no menu do
   botao de pasta. Gerar antes seria adivinhar o destino e deixar arquivo
   orfao na pasta errada quando o palpite falhasse.

   E NAO PODE SER O TEMPORARIO. O que se arrasta vira um clipe no projeto da
   pessoa, apontando para aquele caminho. Um arquivo em /tmp e apagado pelo
   sistema, e o projeto abriria com o clipe OFFLINE dias depois, sem ninguem
   ligar uma coisa a outra. */
let ARQUIVO_PRONTO = null;

/* MODO_IO decide se o trecho marcado vale.

   F_IN e F_OUT continuam guardando a marcacao mesmo em "All" -- desligar o
   modo nao apaga o que voce marcou, e voltar para I/O devolve o trecho onde
   estava. Zerar seria mais simples de programar e pior de usar. */
/* A ponte para a linha "onde vai cair" da tela limpa (1.8.9).

   O pintaPastaPartida() mora dentro do bloco que tem o pastaReal() e o PASTA,
   e o partida() mora aqui fora. Guardar a funcao numa variavel deste nivel e o
   caminho mais curto entre os dois -- e nasce nula de proposito: se a tela
   limpa aparecer antes de a ligacao existir, ela simplesmente nao pinta a
   linha, em vez de estourar. */
let PINTA_PASTA_PARTIDA = null;

let MODO_IO = false;
/* O QUE VAI BAIXAR: "AUDIO" ou "VIDEO"  (1.9.8)

   Ate a 1.9.7 esta variavel guardava WAVE ou MP3 -- o FORMATO do audio -- e
   quem decidia se o video vinha junto era uma caixa ao lado. Eram duas
   perguntas na mesma linha. Agora ela guarda O QUE, e o formato do audio mora
   nos Ajustes, onde a altura do video ja morava.

   Ela manda tambem na imagem: em VIDEO a janela do player aparece. */
let FORMATO = "AUDIO";
let FMT_AUDIO = "WAVE";   /* WAVE ou MP3, dos Ajustes */
/* Tocar sozinho quando o painel fica pronto. Nasce ligado. */
let AUTOPLAY = true;
/* "max" = sem teto: baixa a melhor que existir, 4K inclusive. Os outros
   valores PRIORIZAM aquela altura -- se o video nao tiver, o yt-dlp desce para
   a melhor abaixo. Prometer 4K num video que so tem 1080 seria a interface
   mentindo. */
let ALTURA = "max";
let PASTA = null;

/* SEGUIR A PASTA DO PROJETO.

   Ligado, cada download procura a raiz do projeto aberto no Resolve e salva em
   <raiz>/AUDIO/Direct Download -- reaproveitando a pasta de audio que ja
   existir, mesmo escrita "Áudio" ou "audios".

   Nunca trava: se nao houver projeto, ou se a raiz nao puder ser deduzida, cai
   na pasta dos Ajustes e DIZ que caiu. Recusar o download seria mais seguro no
   papel e insuportavel no uso. */
let AUTO_PASTA = false;
let OCUPADO = false;
let AGORA = 0;          // posicao do playhead, em segundos
let TIMER = null;       // requestAnimationFrame do playhead
let ZOOM = 1;           // 1 = a musica inteira na tela
let OFF = 0;            // fracao 0..1 onde comeca a janela visivel

/* OS TEMAS DA FAIXA.

   No AZUL a onda e ESCURA sobre fundo claro, o contrario dos outros dois. Por
   isso o traco do meio e a grade nao podem ser um branco fixo: sobre o ciano
   eles sumiriam. Cada tema carrega os proprios. */
const TEMAS = {
  mono:  { fundo:"#2A2E33", onda:"#A0ADB7", traco:"rgba(255,255,255,.30)", grade:"rgba(255,255,255,.10)", veu:"rgba(10,12,15,.55)" },
  azul:  { fundo:"#027591", onda:"#06262E", traco:"rgba(0,0,0,.28)",       grade:"rgba(0,0,0,.14)",       veu:"rgba(2,30,38,.55)" },
  verde: { fundo:"#4A8F66", onda:"#C9E9D5", traco:"rgba(255,255,255,.30)", grade:"rgba(255,255,255,.10)", veu:"rgba(10,20,14,.55)" },
};
let TEMA = "mono";
const ALT_ROLAGEM = 7;

const SUBDIV = 4;        // subdivisoes da regua (BlackSub)
const MIN_LABEL = 64;    // px minimos entre rotulos (BlackSub)

/* FPS DO TIMECODE. O BlackSub tira do video; aqui nao ha video, entao 30 e uma
   convencao. Os frames existem para o numero casar com o que o Resolve mostra
   na timeline -- e o editor le timecode, nao segundo decimal. */
const FPS = 30;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// tempo
// ---------------------------------------------------------------------------
/* Mesmo formato do formatShortTime do BlackSub: mm:ss. Musica raramente passa
   de uma hora, e mm:ss e mais facil de ler de relance. */
function tc(seg) {
  const v = Math.floor(Math.abs(Number(seg) || 0));
  const m = String(Math.floor((v % 3600) / 60)).padStart(2, "0");
  const s = String(v % 60).padStart(2, "0");
  const h = Math.floor(v / 3600);
  return h > 0 ? h + ":" + m + ":" + s : m + ":" + s;
}

/* ACEITA "90", "1:30" e "01:02:03".
   Devolve null quando nao da para ler, e quem chama trata — NAO devolve 0.
   Zero e um tempo valido, e confundir "nao entendi" com "inicio" faria um
   campo apagado virar um corte a partir do zero sem avisar. */
function paraSegundos(txt) {
  if (txt === null || txt === undefined) return null;
  const t = String(txt).trim();
  if (!t) return null;
  const partes = t.split(":").map((p) => p.trim());
  if (partes.some((p) => p === "" || !/^\d+([.,]\d+)?$/.test(p))) return null;
  const n = partes.map((p) => parseFloat(p.replace(",", ".")));
  let seg;
  if (n.length === 1) seg = n[0];
  else if (n.length === 2) seg = n[0] * 60 + n[1];
  else if (n.length === 3) seg = n[0] * 3600 + n[1] * 60 + n[2];
  else return null;
  return Number.isFinite(seg) ? seg : null;
}

/* HH:MM:SS:FF, igual ao formatTimecode do BlackSub. */
function tcf(seg) {
  const s = Math.abs(Number(seg) || 0);
  const v = Math.floor(s);
  const f = Math.floor((s % 1) * FPS);
  return String(Math.floor(v / 3600)).padStart(2, "0") + ":" +
         String(Math.floor((v % 3600) / 60)).padStart(2, "0") + ":" +
         String(v % 60).padStart(2, "0") + ":" +
         String(f).padStart(2, "0");
}

/* O TIMECODE DIGITADO, DE VOLTA PARA SEGUNDOS  (1.9.14)

   UMA REGRA SO: joga fora tudo que nao e digito e ENCAIXA DA DIREITA PARA A
   ESQUERDA, em pares -- quadros, segundos, minutos, horas. E o que o Resolve
   faz nos campos de timecode dele, e o que a mao ja sabe fazer:

       25         ->  00:00:00:25
       130        ->  00:00:01:00   (1 seg e 30 quadros, que a 30fps e 2 seg)
       10425      ->  00:01:04:25
       1:04:25    ->  00:01:04:25   (os dois-pontos sao enfeite: contam os digitos)

   O BlackSlice faz o mesmo sem a casa dos quadros, porque la nao ha quadros.

   POR QUE NAO "90 = noventa segundos": porque ai a mesma tecla significaria
   coisas diferentes conforme o campo, e o campo mostra quadros. Alinhar pela
   direita e a unica regra que nao tem excecao.

   DEVOLVE null QUANDO NAO DA PARA LER, e nunca 0 -- zero e um tempo valido, e
   confundir "nao entendi" com "inicio" faria um campo apagado virar um corte a
   partir do zero sem avisar. Vale a mesma nota do paraSegundos() acima.

   O ESTOURO NORMALIZA sozinho: "90" quadros a 30fps viram 3 segundos, e
   "99" minutos viram 1h39. Recusar seria mais trabalho para um resultado
   pior -- quem digita 90 quadros quer 3 segundos. */
function tcParaSeg(txt) {
  const d = String(txt === null || txt === undefined ? "" : txt).replace(/\D/g, "");
  if (!d || d.length > 8) return null;
  const p = d.padStart(8, "0");
  return (+p.slice(0, 2)) * 3600 + (+p.slice(2, 4)) * 60 + (+p.slice(4, 6)) + (+p.slice(6, 8)) / FPS;
}

const limita = (v, a, b) => Math.max(a, Math.min(b, v));
/* Em "All" estas duas devolvem o arquivo inteiro, sem tocar em F_IN/F_OUT.
   E o unico lugar onde o modo entra na conta -- o download, o rotulo e a barra
   de timecode leem daqui, entao nenhum deles precisa saber do modo. */
const inicioSeg = () => (MODO_IO ? Math.min(F_IN, F_OUT) : 0) * (VIDEO ? VIDEO.duracao : 0);
const fimSeg    = () => (MODO_IO ? Math.max(F_IN, F_OUT) : 1) * (VIDEO ? VIDEO.duracao : 0);

// ---------------------------------------------------------------------------
// desenho
// ---------------------------------------------------------------------------
/* O PASSO DA REGUA ESCALA COM A DURACAO, e nao com o zoom.

   Copiado do getGridInterval() do BlackSub, incluindo a lista de candidatos:
   escolhe o primeiro intervalo "redondo" que deixe os rotulos a pelo menos
   64px de distancia. Sem isso, uma timeline longa enche a regua de numeros
   colados. */
function passoDaRegua(largura, segundosVisiveis) {
  const pxPorSeg = largura / Math.max(segundosVisiveis, 0.001);
  const cand = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  for (const c of cand) if (c * pxPorSeg >= MIN_LABEL) return c;
  return 3600;
}

/* Canvas em pixels do dispositivo. Sem o devicePixelRatio a onda sai borrada
   em tela Retina, e o defeito passa por "e assim mesmo". */
function preparaCanvas(cv, altura) {
  const r = cv.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.floor(r.width * dpr));
  cv.height = Math.max(1, Math.floor(altura * dpr));
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, altura);
  return { ctx, w: r.width, h: altura };
}

function janela() { return 1 / ZOOM; }
function limitaOff() { OFF = Math.max(0, Math.min(1 - janela(), OFF)); }
const paraTela = (f) => (f - OFF) / janela();

function desenha() {
  if (!VIDEO) return;
  const T = TEMAS[TEMA] || TEMAS.mono;
  const dur = Math.max(VIDEO.duracao, 1);
  const el = $("onda");
  el.style.background = T.fundo;
  el.style.setProperty("--veu", T.veu);

  const R = preparaCanvas($("cvRegua"), 22);
  const alturaTotal = el.clientHeight || 106;
  const W = preparaCanvas($("cvOnda"), alturaTotal);

  /* A onda e centrada NA AREA ACIMA DA ROLAGEM. Como ela encosta na base,
     centrar na altura inteira esconderia a metade de baixo do audio atras
     dela justamente quando se esta olhando de perto. */
  const util = alturaTotal - (ZOOM > 1.001 ? ALT_ROLAGEM : 0);
  const meio = util / 2;
  const v = janela();

  if (PICOS.length) {
    const i0 = Math.floor(OFF * PICOS.length);
    const i1 = Math.ceil((OFF + v) * PICOS.length);
    const qtd = Math.max(1, i1 - i0);
    const larg = W.w / qtd;
    W.ctx.fillStyle = T.onda;
    for (let i = i0; i < i1; i++) {
      const p = PICOS[Math.max(0, Math.min(PICOS.length - 1, i))];
      const h = p * (util * 0.44);
      W.ctx.fillRect((i - i0) * larg, meio - h, Math.max(1, larg * 0.9), h * 2);
    }
  }
  W.ctx.fillStyle = T.traco;
  W.ctx.fillRect(0, meio - 0.5, W.w, 1);

  /* O PASSO DA REGUA OLHA O QUE ESTA VISIVEL, e nao a duracao inteira. Sem
     isso, aproximar 20x deixaria um rotulo a cada tela. */
  const vi = OFF * dur, vf = (OFF + v) * dur;
  const passo = passoDaRegua(R.w, vf - vi);
  const sub = passo / SUBDIV;
  $("zRot").textContent = ZOOM.toFixed(1) + "x";

  R.ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
  R.ctx.textBaseline = "middle";
  R.ctx.textAlign = "left";

  for (let tt = Math.floor(vi / passo) * passo; tt <= vf + passo; tt += passo) {
    if (tt < 0) continue;
    const x = R.w * ((tt - vi) / (vf - vi));
    if (x < -30 || x > R.w + 30) continue;
    R.ctx.fillStyle = "rgba(255,255,255,.40)";
    R.ctx.fillRect(x, 10, 1, 12);
    R.ctx.fillStyle = "rgba(255,255,255,.55)";
    R.ctx.fillText(tc(tt), x + 2, 5);

    for (let s = 1; s < SUBDIV; s++) {
      const st = tt + sub * s;
      const sx = R.w * ((st - vi) / (vf - vi));
      if (sx < 0 || sx > R.w) continue;
      const sh = (s === SUBDIV / 2) ? 8 : 5;
      R.ctx.fillStyle = "rgba(255,255,255,.20)";
      R.ctx.fillRect(sx, 22 - sh, 0.5, sh);
    }
    W.ctx.fillStyle = T.grade;
    W.ctx.fillRect(x, 0, 1, util);
  }

  if (AGORA > 0 || tocando()) {
    W.ctx.fillStyle = "#FF4245";
    W.ctx.fillRect(W.w * paraTela(AGORA / dur), 0, 2, util);
  }

  /* A AGULHA ACOMPANHA (1.9.0).

     Ela e DOM e a linha e canvas, entao as duas sao posicionadas por contas
     diferentes -- e e por isso que a agulha e desenhada aqui dentro, no mesmo
     lugar e no mesmo instante em que a linha. Separar as duas atualizacoes e
     como as duas ficam 1px fora de registro quando o zoom muda.

     A linha aparece so quando AGORA > 0 ou tocando; a agulha aparece SEMPRE
     que ha video. Sem isso ela sumiria no comeco da faixa, que e justamente
     onde a pessoa vai procurar por ela para arrastar pela primeira vez. */
  pintaAgulha();

  $("rolagem").classList.toggle("oculto", ZOOM <= 1.001);
  $("polegar").style.left = (OFF * 100) + "%";
  $("polegar").style.width = (janela() * 100) + "%";
}

/* ONDE A AGULHA FICA.

   A mesma conta da linha vermelha no canvas: fracao do tempo -> fracao da
   janela visivel -> porcentagem. paraTela() ja resolve o zoom e a rolagem.

   Ela pode sair da janela quando se aproxima e rola para outro trecho -- e
   ai ela e escondida, em vez de ficar grudada na borda fingindo que o
   playhead esta ali. Um indicador que mente e pior que indicador nenhum. */
function pintaAgulha() {
  const ag = $("agulha");
  if (!ag) return;
  if (!VIDEO) { ag.classList.add("oculto"); return; }
  const t = paraTela(AGORA / Math.max(VIDEO.duracao, 1));
  ag.classList.toggle("oculto", t < -0.02 || t > 1.02);
  ag.style.left = (t * 100) + "%";
}

function pintaSelecao() {
  if (!VIDEO) return;
  const a = Math.min(F_IN, F_OUT), b = Math.max(F_IN, F_OUT);
  const ta = paraTela(a), tb = paraTela(b);
  $("veuE").style.width = (Math.max(0, Math.min(1, ta)) * 100) + "%";
  $("veuD").style.width = ((1 - Math.max(0, Math.min(1, tb))) * 100) + "%";
  // as quatro pecas usam a MESMA porcentagem; o alinhamento fino esta no CSS
  $("alcaI").style.left = (ta * 100) + "%";
  $("alcaO").style.left = (tb * 100) + "%";
  $("pegaI").style.left = (ta * 100) + "%";
  $("pegaO").style.left = (tb * 100) + "%";
  $("tcIn").textContent = tcf(inicioSeg());
  $("tcOut").textContent = tcf(fimSeg());
  confereTrecho();
  $("tcDur").textContent = tcf(fimSeg() - inicioSeg());
  pintaRotulo();
}

/* O ICONE SEGUE O TIPO, igual ao downloadIconName do BlackSlice:
   audio -> "waveform", audio+video -> "video.and.waveform". */
const IC_ONDA = '<g fill="currentColor">' +
  '<rect x="0" y="6" width="1.6" height="4" rx=".8"/>' +
  '<rect x="3" y="3.5" width="1.6" height="9" rx=".8"/>' +
  '<rect x="6" y="0" width="1.6" height="16" rx=".8"/>' +
  '<rect x="9" y="4.5" width="1.6" height="7" rx=".8"/>' +
  '<rect x="12" y="1.5" width="1.6" height="13" rx=".8"/>' +
  '<rect x="15" y="5" width="1.6" height="6" rx=".8"/>' +
  '<rect x="18" y="6.5" width="1.6" height="3" rx=".8"/></g>';

const IC_VIDEO_ONDA = '<g fill="currentColor">' +
  '<rect x="0" y="3" width="11" height="10" rx="2"/>' +
  '<path d="M12.4 6.6 17 4.1a.7.7 0 0 1 1 .6v6.6a.7.7 0 0 1-1 .6l-4.6-2.5z"/>' +
  '<rect x="19.4" y="6" width="1.4" height="4" rx=".7"/></g>';

/* O ROTULO E SO "DOWNLOAD". O formato continua dito pelo seletor WAVE/MP3,
   que fica a 60px daqui -- o botao repetia o vizinho e pagava por isso com
   largura. Quem carrega a informacao do tipo agora e o ICONE.

   DEPOIS DO DOWNLOAD ELE VIRA "BAIXADO", verde e arrastavel  (1.9.13).

   E UM ESTADO SO, e nao dois: o botao esta verde exatamente quando ha um
   arquivo no disco vindo deste link -- que e o mesmo ARQUIVO_PRONTO que
   libera o arraste. Guardar um "ja baixou" separado do "tem arquivo" daria
   duas verdades sobre a mesma coisa, e um dia elas discordariam. */
function pintaRotulo() {
  if (OCUPADO) return;
  const feito = !!ARQUIVO_PRONTO;
  /* NO VERDE, O ICONE DIZ O QUE ESTA NO DISCO -- e nao o que o seletor mostra
     (2.3.3).

     Fora do verde o icone e uma PROMESSA: ele acompanha o seletor, e mudar de
     AUDIO para VIDEO muda o que vai ser baixado. No verde ele e um FATO: o
     arquivo ja existe, e trocar o seletor nao o transforma em outra coisa.

     Sem esta distincao, baixar o audio e depois clicar em VIDEO deixaria uma
     claquete num botao que arrasta um .wav -- e o arraste entregaria audio
     para quem viu um icone de video. O icone e a unica coisa na tela que diz
     o que vai cair na timeline. */
  const comVideo = feito ? PRONTO_VIDEO : (FORMATO === "VIDEO");
  const ic = $("icDownload");
  const bt = $("btDownload");

  /* O icone continua sendo pintado no estado verde, e quem o esconde e o CSS
     (.bt-download.feito .ic). Assim ele volta inteiro quando o verde sai, sem
     depender de esta funcao rodar de novo na ordem certa. */
  $("rotulo").textContent = feito ? txt("arrastarBt") : txt("baixarBt");
  if (ic) ic.innerHTML = comVideo ? IC_VIDEO_ONDA : IC_ONDA;
  if (!bt) return;
  bt.classList.toggle("feito", feito);
  bt.setAttribute("draggable", feito ? "true" : "false");
  bt.title = feito ? txt("arrasteTimeline") : "";
}

// ---------------------------------------------------------------------------
// reproducao
// ---------------------------------------------------------------------------
/* O AUDIO JA ESTA NO DISCO desde o Analisar, entao tocar sai de graca: um
   <audio> comum aponta para o arquivo temporario.

   O formato que vem do YouTube costuma ser m4a (AAC) ou webm (Opus), e o
   Chromium do Electron toca os dois. Se algum dia aparecer um que ele nao
   toque, o erro cai no log em vez de sumir. */
const som = () => $("som");
const tocando = () => { const s = som(); return s && !s.paused && !s.ended; };

function preparaSom(arquivo) {
  const s = som();
  try {
    s.src = motor.urlDeArquivo(arquivo);
    s.load();
    s.onerror = () => log("audio: nao consegui tocar " + arquivo + " — " + (s.error && s.error.code));
    s.onended = () => { paraRelogio(); pintaPlay(); };
    log("audio pronto: " + arquivo);
  } catch (e) { log("audio: " + e); }
}

/* Os dois desenhos do botao central, como o play.fill / pause.fill do
   BlackSlice. SVG e nao caractere: o triangulo em fonte muda de tamanho e de
   alinhamento conforme o sistema, e nunca fica centrado de verdade. */
const IC_PLAY  = '<path fill="currentColor" d="M3.5 2.2 13.4 7.6a.45.45 0 0 1 0 .8L3.5 13.8a.45.45 0 0 1-.7-.4V2.6a.45.45 0 0 1 .7-.4z"/>';
const IC_PAUSA = '<path fill="currentColor" d="M4 2.4h2.7v11.2H4zM9.3 2.4H12v11.2H9.3z"/>';

function pintaPlay() {
  const ic = document.querySelector("#btPlay .ic-play");
  if (ic) ic.innerHTML = tocando() ? IC_PAUSA : IC_PLAY;
}

/* O RELOGIO DO PLAYHEAD usa requestAnimationFrame, e nao setInterval.

   Com setInterval o desenho briga com o refresh da tela e o playhead treme.
   O rAF entrega no quadro certo e, de brinde, para sozinho quando a janela
   nao esta visivel -- que e o que se quer num painel dentro do Resolve. */
function tocaRelogio() {
  paraRelogio();
  const passo = () => {
    if (!tocando()) { paraRelogio(); pintaPlay(); return; }
    AGORA = som().currentTime;
    $("agora").textContent = tcf(AGORA);
    /* A DERIVA E CORRIGIDA AQUI, no laco que ja roda a cada quadro -- nao ha
       por que criar um segundo relogio para vigiar o primeiro. */
    if (comVideo()) { alinhaVideo(false); segueVideo(); }
    desenha();
    TIMER = requestAnimationFrame(passo);
  };
  TIMER = requestAnimationFrame(passo);
}
function paraRelogio() {
  if (TIMER) { cancelAnimationFrame(TIMER); TIMER = null; }
}

/* O ICONE DO VOLUME E O BOTAO DE MUTE, e os dois desenhos vem do BlackSlice:
   speaker.wave.2.fill quando ha som, speaker.slash.fill quando esta mudo. */
const IC_SOM  = '<path fill="currentColor" d="M7 2.5 3.8 5.2H1.6v5.6h2.2L7 13.5z"/>' +
                '<path fill="none" stroke="currentColor" stroke-width="1.2" d="M9.6 5.4a3.4 3.4 0 0 1 0 5.2M11.6 3.4a6 6 0 0 1 0 9.2"/>';
const IC_MUDO = '<path fill="currentColor" d="M7 2.5 3.8 5.2H1.6v5.6h2.2L7 13.5z"/>' +
                '<path fill="none" stroke="currentColor" stroke-width="1.3" d="M9.8 6.2l4 3.6M13.8 6.2l-4 3.6"/>';

let VOL_ANTES = 80;   // para o mute devolver o volume que estava

/* UM VOLUME SO, EM DOIS LUGARES  (1.9.0)

   O painel passou a ter dois tocadores: o da faixa baixada, embaixo, e o da
   previa da busca. Duas reguas independentes na mesma janela e o tipo de coisa
   que se descobre no dia em que uma esta no tres e a outra no dez -- e quem
   descobre acha que o som quebrou, nao que ha dois controles.

   Entao o valor e um, e as duas reguas o mostram. Mexer em qualquer uma move a
   outra, e os dois <audio> recebem juntos.

   E ELE PERSISTE. Antes nascia em 80 toda vez, o que era esquecivel com um
   tocador so; com a previa tocando a cada busca, um painel que volta alto
   depois de voce ter abaixado e um susto por sessao. */
const VOL_GUARDA = "dd_vol";

function pintaIconeVol(ic, bt, v) {
  if (ic) ic.innerHTML = v === 0 ? IC_MUDO : IC_SOM;
  if (bt) bt.classList.toggle("mudo", v === 0);
}

function poeVolume(valor) {
  const v = Math.max(0, Math.min(100, Math.round(Number(valor) || 0)));
  /* SO ESCREVE SE MUDOU. Escrever o mesmo numero num <input type=range> que
     esta sendo arrastado interrompe o arrasto no Chromium. */
  if ($("vol") && Number($("vol").value) !== v) $("vol").value = v;
  if ($("previaVol") && Number($("previaVol").value) !== v) $("previaVol").value = v;
  pintaIconeVol($("icVol"), $("btMute"), v);
  pintaIconeVol($("icPreviaVol"), $("btPreviaMudo"), v);
  try { som().volume = v / 100; } catch (e) {}
  try { previa().volume = v / 100; } catch (e) {}
  try { localStorage.setItem(VOL_GUARDA, String(v)); } catch (e) {}
}

function pintaVolume() { poeVolume($("vol") ? $("vol").value : 80); }

function alternaMudo() {
  const v = Number($("vol").value);
  if (v === 0) {
    // volta para onde estava, e nunca para zero -- senao o botao "desmutar"
    // nao faria nada e pareceria quebrado
    poeVolume(VOL_ANTES > 0 ? VOL_ANTES : 80);
  } else {
    VOL_ANTES = v;
    poeVolume(0);
  }
}

/* Silencia e zera, para receber outro link. Chamada tambem no comeco do
   analisar(), para o Enter no campo ter o mesmo comportamento do Cmd+V. */
function paraTudo() {
  try {
    const s = som();
    if (s) { s.pause(); s.removeAttribute("src"); s.load(); }
  } catch (e) {}
  paraRelogio();
  AGORA = 0;
  F_IN = 0; F_OUT = 1;
  ZOOM = 1; OFF = 0;
  PICOS = [];
  AUDIO_TEMP = null;
  /* O arquivo do link ANTERIOR nao serve para o proximo. Sem isto, colar um
     link novo e arrastar a onda entregaria a musica de antes -- e o nome no
     clipe so denunciaria o engano depois de estar na timeline. */
  poeArrastavel(null);
  /* A imagem sai junto: ela e do video ANTERIOR, e um retangulo com a cena
     errada e pior que retangulo nenhum. */
  poeVideo(false);
  pintaPlay();
  $("agora").textContent = tcf(0);
  /* A AGULHA SOME JUNTO. Ela e DOM, entao nao desaparece sozinha quando o
     canvas para de ser redesenhado -- ficaria pendurada na regua apontando
     para um audio que nao existe mais. desenha() nem chega a rodar aqui,
     porque VIDEO ja foi embora. */
  pintaAgulha();
  habilita(false);
}

function alternaPlay() {
  const s = som();
  if (!s.src) return;
  if (tocando()) { s.pause(); paraRelogio(); }
  else {
    // Tocar a partir do In quando ha trecho marcado: e o que se quer ouvir.
    const ini = inicioSeg(), fim = fimSeg();
    if (fim > ini && (AGORA < ini || AGORA >= fim)) AGORA = ini;
    s.currentTime = AGORA;
    s.play().then(tocaRelogio).catch((e) => { log("play: " + e); mostraFalha("nao consegui tocar: " + e); });
  }
  pintaPlay();
}

/* O BOTAO E UM INTERRUPTOR, e o rotulo e o estado.

   Um botao "All" que so zerava a selecao nao dizia em que estado voce estava:
   depois de clicar ele continuava escrito "All", e a unica pista de que havia
   ou nao um trecho eram as linhas na onda. */
function poeModo(v) {
  MODO_IO = !!v;
  document.body.classList.toggle("modo-tudo", !MODO_IO);
  const bt = $("btTudo");
  if (bt) {
    /* O ROTULO NAO TROCA MAIS. Ele alternava entre "All" e "I/O", e rotulo que
       troca obriga a ler para saber onde voce esta -- pior, "All" descrevia o
       estado CONTRARIO ao que estava ligado. Quem diz o estado e a lampada. */
    bt.textContent = "Trim";
    bt.classList.toggle("ligado", MODO_IO);
  }
  ["btIn","btOut"].forEach((id) => {
    const el = $(id);
    if (el) el.classList.toggle("mudo", !MODO_IO);
  });
  if (VIDEO) pintaSelecao();
}
function alternaModo() { poeModo(!MODO_IO); }

/* ZOOM ANCORADO. O ponto sob o cursor fica parado enquanto o resto se
   aproxima -- sem isso, aproximar joga a pessoa para outro lugar da musica e
   a sensacao e de que a onda fugiu. */
function poeZoom(novo, ancora) {
  const antes = OFF + ancora * janela();
  ZOOM = limita(novo, 1, 60);
  OFF = antes - ancora * janela();
  limitaOff();
  desenha();
  pintaSelecao();
}
function ajustaTudo() { ZOOM = 1; OFF = 0; desenha(); pintaSelecao(); }

function ligaZoom() {
  const el = $("onda");

  /* A ANCORA DOS BOTOES E O PLAYHEAD, e nao o meio da tela  (1.9.9)

     Com 0.5 o zoom girava em volta do centro do que estava visivel -- um ponto
     que nao quer dizer nada. Quem aproxima esta olhando para onde a agulha
     esta, e afastar/aproximar jogava justamente esse ponto para fora.

     A ancora e uma fracao de 0 a 1 DA JANELA VISIVEL, e o playhead esta em
     AGORA/duracao do arquivo inteiro -- por isso a conta desconta o OFF e
     divide pela janela. Com o playhead fora da vista, cai no meio: nao ha
     ponto de interesse na tela para segurar. */
  const ancoraPlayhead = () => {
    if (!VIDEO || !VIDEO.duracao) return 0.5;
    const t = (AGORA / VIDEO.duracao - OFF) / janela();
    return (t >= 0 && t <= 1) ? t : 0.5;
  };
  $("btZmais").addEventListener("click", (ev) => { ev.stopPropagation(); poeZoom(ZOOM * 1.5, ancoraPlayhead()); });
  $("btZmenos").addEventListener("click", (ev) => { ev.stopPropagation(); poeZoom(ZOOM / 1.5, ancoraPlayhead()); });
  $("btZfit").addEventListener("click", (ev) => { ev.stopPropagation(); ajustaTudo(); });

  /* Cmd (ou Ctrl) + roda aproxima; a roda sozinha rola, como em qualquer
     timeline. passive:false porque precisamos do preventDefault -- senao o
     painel inteiro rola junto. */
  el.addEventListener("wheel", (ev) => {
    if (!VIDEO) return;
    const r = el.getBoundingClientRect();
    const anc = (ev.clientX - r.left) / r.width;
    if (ev.metaKey || ev.ctrlKey) {
      ev.preventDefault();
      poeZoom(ZOOM * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), anc);
    } else if (ZOOM > 1.001) {
      ev.preventDefault();
      OFF += (ev.deltaX || ev.deltaY) / r.width * janela();
      limitaOff(); desenha(); pintaSelecao();
    }
  }, { passive: false });

  // a rolagem: clicar ou arrastar centra a janela no ponto
  const trilha = $("rolagem");
  let rolando = false;
  const move = (ev) => {
    const r = trilha.getBoundingClientRect();
    OFF = (ev.clientX - r.left) / r.width - janela() / 2;
    limitaOff(); desenha(); pintaSelecao();
  };
  trilha.addEventListener("mousedown", (ev) => { ev.stopPropagation(); rolando = true; move(ev); });
  document.addEventListener("mousemove", (ev) => { if (rolando) move(ev); });
  document.addEventListener("mouseup", () => { rolando = false; });
}

/* O TEMA DA FAIXA. Guardado no localStorage: a escolha e de quem usa, e
   perde-la a cada abertura seria pior que nao ter a opcao. */
function poeTema(nome) {
  if (!TEMAS[nome]) nome = "mono";
  TEMA = nome;
  try { localStorage.setItem("dd_tema", nome); } catch (e) {}
  document.querySelectorAll(".tema").forEach((o) => {
    o.classList.toggle("ligado", o.dataset.tema === nome);
  });
  desenha();
}

/* Marcar liga o modo. Sem isto, apertar I com o botao em "All" nao produzia
   efeito visivel nenhum -- e um atalho que parece quebrado e pior que um
   atalho que nao existe. */
/* PARAR = voltar ao comeco, e nao apenas pausar.

   Em I/O ele volta ao IN, e nao ao zero: com um trecho marcado, o "comeco"
   que interessa e o do trecho -- ouvir o pedaco de novo e o que se faz o tempo
   todo. Em All nao ha trecho, entao e o zero mesmo. */
function parar() {
  if (!VIDEO) return;
  const s = som();
  try { if (s) s.pause(); } catch (e) {}
  paraRelogio();
  AGORA = MODO_IO ? Math.min(F_IN, F_OUT) * VIDEO.duracao : 0;
  try { if (s && s.src) s.currentTime = AGORA; } catch (e) {}
  $("agora").textContent = tcf(AGORA);
  pintaPlay();
  desenha();
}

/* O SEGUNDO E OPCIONAL, e sem ele vale o playhead  (1.9.14).

   O botao [ , a tecla I e o timecode digitado passam pela MESMA funcao. Um
   caminho separado para o valor digitado precisaria repetir as duas regras
   daqui -- ligar o Trim e destravar a outra ponta -- e repeti-las e como elas
   se separam: um dia uma muda e a outra fica. */
/* =====================================================================
   O TRECHO PRONTO ENVELHECE QUANDO O In/Out MUDA  (2.0.0)

   Ficou pendente desde a 1.8.7, e o defeito era este: depois de baixar, mexer
   nas alças não mexia no arquivo. O botão continuava verde, a onda continuava
   arrastável, e o que caía na timeline era o trecho do download ANTERIOR --
   sem nenhum aviso de que o que estava na tela e o que estava no arquivo
   tinham deixado de ser a mesma coisa.

   A CONFERÊNCIA MORA NO pintaSelecao(), que é por onde TODAS as formas de
   mudar o trecho passam: as alças, o [ e o ], as teclas I e O, e os timecodes
   digitados. Espalhá-la por esses cinco caminhos seria esquecê-la num deles
   -- foi o que aconteceu com o `paraBusca` até a 1.8.9.

   EM ÁUDIO O TRECHO É REFEITO, porque o material inteiro já está baixado no
   temporário: é um corte local do ffmpeg, de segundos, sem tocar na rede. E o
   nome do arquivo carrega o trecho (`titulo_120-245.wav`), então o recorte
   novo NÃO sobrescreve o que já foi importado no projeto -- ele nasce ao
   lado.

   EM VÍDEO NÃO. Ali o trecho é pedido ao YouTube no próprio download
   (`--download-sections`), e refazê-lo é rede e minutos. Fazer isso sozinho
   porque alguém arrastou uma alça seria gastar o tempo da pessoa sem ela ter
   pedido. O arquivo apenas deixa de valer, e o botão volta a dizer DOWNLOAD.

   E ESPERA A MÃO PARAR: arrastar uma alça dispara dezenas de pintaSelecao().
   Sem os 600ms, seriam dezenas de ffmpeg contra o mesmo arquivo. */
function confereTrecho() {
  if (!ARQUIVO_PRONTO || !TRECHO_PRONTO || !VIDEO || OCUPADO) return;
  const ini = inicioSeg(), fim = fimSeg();
  const mudou = Math.abs(ini - TRECHO_PRONTO.ini) > 0.05
             || Math.abs(fim - TRECHO_PRONTO.fim) > 0.05;
  if (!mudou) return;

  /* O ARQUIVO PERDE A VALIDADE NA HORA, e não quando o recorte terminar. Entre
     uma coisa e outra existe uma janela de segundos em que arrastar entregaria
     o trecho velho -- que é exatamente o defeito que esta função conserta. */
  poeArrastavel(null);

  if (FORMATO === "VIDEO") { diz(txt("trechoMudou")); return; }

  clearTimeout(RECORTE_MARCADO);
  RECORTE_MARCADO = setTimeout(() => { refazTrecho().catch((e) => log("refazTrecho: " + e)); }, 600);
}

async function refazTrecho() {
  if (!VIDEO || !AUDIO_TEMP || OCUPADO || !modulosOk()) return;
  if (!fs.existsSync(AUDIO_TEMP)) { log("refazTrecho: o temporário sumiu"); return; }

  const dest = destinoDoDownload();
  if (!dest.pasta) return;

  const ini = inicioSeg(), fim = fimSeg();
  const temTrecho = (fim - ini) > 0.05 && (fim - ini) < VIDEO.duracao - 0.05;

  diz(txt("refazendo"));
  log("refazTrecho: " + ini.toFixed(2) + "-" + fim.toFixed(2) + " em " + dest.pasta);
  const c = await motor.corta(AUDIO_TEMP, temTrecho ? ini : null, temTrecho ? fim : null,
                              FMT_AUDIO, dest.pasta, VIDEO.titulo);
  if (!c.ok) { log("refazTrecho: FALHOU — " + c.erro); diz(txt("falhou") + c.erro, "erro"); return; }

  /* O In/Out pode ter mudado DE NOVO enquanto o ffmpeg trabalhava. Se mudou,
     este arquivo já nasceu velho: quem vale é o recorte que vem depois. */
  if (Math.abs(inicioSeg() - ini) > 0.05 || Math.abs(fimSeg() - fim) > 0.05) {
    log("refazTrecho: descartado, o trecho mudou no meio");
    return;
  }
  log("refazTrecho: ok — " + c.arquivo);
  poeArrastavel(c.arquivo);
  diz(txt("trechoPronto") + path.basename(c.arquivo), "ok");
}

function marcaIn(seg) {
  if (!VIDEO) return;
  if (!MODO_IO) poeModo(true);
  const t = (seg === undefined || seg === null) ? AGORA : limita(seg, 0, VIDEO.duracao);
  F_IN = t / VIDEO.duracao;
  if (F_OUT < F_IN) F_OUT = 1;
  pintaSelecao();
}
function marcaOut(seg) {
  if (!VIDEO) return;
  if (!MODO_IO) poeModo(true);
  const t = (seg === undefined || seg === null) ? AGORA : limita(seg, 0, VIDEO.duracao);
  F_OUT = t / VIDEO.duracao;
  if (F_IN > F_OUT) F_IN = 0;
  pintaSelecao();
}

/* =====================================================================
   OS TRES PRIMEIROS TIMECODES SE DIGITAM  (1.9.14)

   Portado do BlackSlice, onde o duplo clique no numero abre um campo. O que
   muda aqui e a casa dos quadros, que la nao existe.

   O CAMPO E IRMAO DO TEXTO, e nao um substituto. Trocar o <span> por um
   <input> com o mesmo id pararia o painel em silencio: o pintaSelecao() e o
   relogio escrevem em .textContent, e num <input> isso nao aparece na tela --
   o numero simplesmente congelaria, sem erro nenhum.

   ENTER APLICA, ESC E SAIR DESISTEM. Sair sem aplicar e o padrao de campo de
   timecode em editor: a pessoa clica fora porque mudou de ideia, e gravar ali
   seria decidir por ela.

   O stopPropagation NAO E DECORACAO: o Esc do painel (que descarrega o video e
   volta para a tela inicial) escuta no document, e sem ele digitar Esc aqui
   jogaria fora a musica inteira. Este listener esta no proprio campo, entao a
   bolha para antes de chegar la. Os atalhos de teclado ja se protegem sozinhos
   ignorando INPUT.
   ===================================================================== */
function ligaTcEditavel(idTexto, idCampo, aplica) {
  const sp = $(idTexto), inp = $(idCampo);
  if (!sp || !inp) return;

  const fecha = () => { inp.classList.add("oculto"); sp.classList.remove("oculto"); };
  const abre = () => {
    if (!VIDEO) return;          // sem audio carregado nao ha o que marcar
    inp.value = sp.textContent;
    sp.classList.add("oculto");
    inp.classList.remove("oculto");
    inp.focus();
    inp.select();
  };

  sp.addEventListener("dblclick", abre);
  inp.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") {
      ev.preventDefault();
      const t = tcParaSeg(inp.value);
      fecha();
      // null e "nao entendi": fecha e nao mexe em nada, deixando o valor antigo
      if (t !== null && VIDEO) aplica(limita(t, 0, VIDEO.duracao));
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      fecha();
    }
  });
  inp.addEventListener("blur", fecha);
}

function ligaTimecodes() {
  /* O PLAYHEAD VAI PARA O NUMERO DIGITADO. poeAgora() recebe fracao, e nao
     segundos -- e a mesma funcao que a regua usa, entao o video e a onda
     seguem pelo caminho ja testado. */
  ligaTcEditavel("agora", "edAgora", (t) => poeAgora(t / VIDEO.duracao));
  /* O IN LEVA O PLAYHEAD JUNTO, e o OUT nao. Nao e descuido: e o que o
     BlackSlice faz, e a assimetria tem motivo -- marcar o inicio e querer
     ouvir dali; marcar o fim e so dizer onde acaba. */
  ligaTcEditavel("tcIn", "edIn", (t) => { marcaIn(t); poeAgora(t / VIDEO.duracao); });
  ligaTcEditavel("tcOut", "edOut", (t) => marcaOut(t));
}

function pula(seg) {
  const s = som();
  if (!s.src || !VIDEO) return;
  AGORA = limita(AGORA + seg, 0, VIDEO.duracao);
  s.currentTime = AGORA;
  $("agora").textContent = tcf(AGORA);
  desenha();
}

// ---------------------------------------------------------------------------
// interacao com a onda
// ---------------------------------------------------------------------------
/* ARRASTAR AS PEGAS.

   A conta e a mesma do clique na onda: a fracao vem da regua, que tem a
   largura da onda, e passa pelo OFF/janela() do zoom -- sem isso a pega
   andaria em passo diferente da onda assim que houvesse zoom.

   O listener de mousemove vai no DOCUMENTO e nao na pega: se ele ficasse na
   pega, sair dela com o botao apertado largaria o arrasto no meio. */
function ligaPegas() {
  const reg = document.querySelector(".regua");
  if (!reg) return;

  const fracao = (ev) => {
    const r = reg.getBoundingClientRect();
    return limita(OFF + ((ev.clientX - r.left) / r.width) * janela(), 0, 1);
  };

  let qual = null;
  const MIN = 0.002;   // nao deixa In e Out colarem um no outro

  const move = (ev) => {
    if (!qual || !VIDEO) return;
    const f = fracao(ev);
    if (qual === "i") F_IN  = Math.min(f, F_OUT - MIN);
    else              F_OUT = Math.max(f, F_IN  + MIN);
    pintaSelecao();
  };
  const solta = () => {
    qual = null;
    $("pegaI").classList.remove("pegando");
    $("pegaO").classList.remove("pegando");
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", solta);
  };
  const pega = (q) => (ev) => {
    if (!VIDEO || !MODO_IO) return;
    ev.preventDefault();
    ev.stopPropagation();          // senao o clique tambem move o playhead
    qual = q;
    $(q === "i" ? "pegaI" : "pegaO").classList.add("pegando");
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", solta);
  };

  $("pegaI").addEventListener("mousedown", pega("i"));
  $("pegaO").addEventListener("mousedown", pega("o"));
  // duplo clique devolve a pega ao extremo -- mais rapido que arrastar ate la
  $("pegaI").addEventListener("dblclick", () => { F_IN = 0;  pintaSelecao(); });
  $("pegaO").addEventListener("dblclick", () => { F_OUT = 1; pintaSelecao(); });
}

/* =====================================================================
   O PLAYHEAD SE MOVE PELA REGUA  (1.9.0)

   ATE A 1.8.6: clicar em qualquer ponto da ONDA levava o playhead para la.
   Funcionava, e ocupava o unico gesto que a onda tinha. Quando a onda passou
   a poder ser arrastada para a timeline do Resolve, os dois passaram a
   disputar o mesmo mousedown no mesmo pixel -- e nao ha como adivinhar qual
   dos dois a pessoa quis.

   A saida e a mesma de qualquer editor: dois territorios.

     REGUA        move o playhead. Clicar salta, arrastar acompanha.
     LINHA        continua arrastavel sobre a onda, para o ajuste fino sem
                  ter de subir o mouse ate a regua.
     CORPO DA     seleciona o audio e, depois do download, arrasta o arquivo
     ONDA         para fora.

   A LINHA CONTINUAR ARRASTAVEL NAO E LUXO: com zoom de 20x a regua fica com
   um rotulo a cada tela, e obrigar a subir o mouse para mover dois frames
   seria trocar precisao por distancia.
   ===================================================================== */

/* Quantos pixels em volta da linha ainda contam como "peguei a linha".

   6px de cada lado. Um alvo de 2px e o que produz "nao consigo pegar", e a
   propria pega do In/Out usa uma caixa de 24px pelo mesmo motivo. Acima de
   ~8px comeca a roubar cliques que eram para selecionar a onda. */
const PERTO_PLAYHEAD = 6;

function fracaoNaOnda(ev) {
  const r = $("onda").getBoundingClientRect();
  return limita(OFF + ((ev.clientX - r.left) / r.width) * janela(), 0, 1);
}

/* O ponteiro esta em cima da linha do playhead?

   A conta e a MESMA que desenha a linha no canvas, em desenha():
   paraTela(AGORA / duracao) * largura. Escrever de outro jeito aqui seria
   pedir para as duas divergirem no zoom -- o cursor mudaria num pixel e a
   linha estaria noutro. */
function emCimaDoPlayhead(ev) {
  if (!VIDEO) return false;
  const r = $("onda").getBoundingClientRect();
  const x = r.width * paraTela(AGORA / Math.max(VIDEO.duracao, 1));
  return Math.abs((ev.clientX - r.left) - x) <= PERTO_PLAYHEAD;
}

function poeAgora(fr) {
  if (!VIDEO) return;
  AGORA = fr * VIDEO.duracao;
  try { if (som().src) som().currentTime = AGORA; } catch (e) {}
  $("agora").textContent = tcf(AGORA);
  desenha();
}

function ligaRegua() {
  const regua = document.querySelector(".regua");
  const agulha = $("agulha");
  if (!regua) return;

  const fracaoNaRegua = (ev) => {
    const r = regua.getBoundingClientRect();
    return limita(OFF + ((ev.clientX - r.left) / r.width) * janela(), 0, 1);
  };

  let puxando = false;
  const comeca = (ev) => {
    if (!VIDEO) return;
    // as pegas de In e Out moram na mesma regua e tem gesto proprio
    if (ev.target.closest(".pega")) return;
    puxando = true;
    if (agulha) agulha.classList.add("pegando");
    poeAgora(fracaoNaRegua(ev));
    ev.preventDefault();
  };
  regua.addEventListener("mousedown", comeca);

  document.addEventListener("mousemove", (ev) => {
    if (puxando) poeAgora(fracaoNaRegua(ev));
  });
  document.addEventListener("mouseup", () => {
    puxando = false;
    if (agulha) agulha.classList.remove("pegando");
  });
}

function ligaOnda() {
  const el = $("onda");

  let puxandoLinha = false;
  el.addEventListener("mousedown", (ev) => {
    if (!VIDEO) return;
    if (ev.target.closest(".bt-z") || ev.target.closest("#rolagem")) return;
    /* SO a linha move o playhead aqui. Um clique no resto da onda nao mexe
       nele -- e a mudanca que libera a onda para o arraste. */
    if (!emCimaDoPlayhead(ev)) return;
    puxandoLinha = true;
    ev.preventDefault();
  });
  document.addEventListener("mousemove", (ev) => {
    if (puxandoLinha) poeAgora(fracaoNaOnda(ev));
  });
  document.addEventListener("mouseup", () => { puxandoLinha = false; });

  /* O CURSOR AVISA ONDE A LINHA ESTA.

     Sem isto a linha vira um alvo invisivel de 12px: quem nao souber que ela
     e arrastavel nunca descobre, e quem souber vai errar. O cursor muda
     sozinho ao passar por cima -- e a unica affordance que o gesto tem. */
  el.addEventListener("mousemove", (ev) => {
    if (puxandoLinha) return;
    el.classList.toggle("no-playhead", emCimaDoPlayhead(ev));
  });
  el.addEventListener("mouseleave", () => el.classList.remove("no-playhead"));

  /* ---------------------------------------------------------------
     CLICAR SELECIONA. ARRASTAR LEVA O ARQUIVO.  (1.8.7)
     --------------------------------------------------------------- */
  el.addEventListener("click", (ev) => {
    if (!ARQUIVO_PRONTO) return;
    if (ev.target.closest(".bt-z") || ev.target.closest("#rolagem")) return;
    if (emCimaDoPlayhead(ev)) return;   // ali o gesto e outro
    poeSelecao(true);
  });

  /* Clicar FORA da onda tira a selecao. No document, e nao num "blur": a onda
     e uma div, e div nao recebe foco nem perde. */
  document.addEventListener("mousedown", (ev) => {
    if (!ONDA_SEL) return;
    if (el.contains(ev.target)) return;
    poeSelecao(false);
  });

  el.addEventListener("dragstart", (ev) => {
    if (!ARQUIVO_PRONTO) { ev.preventDefault(); return; }
    /* preventDefault E OBRIGATORIO. O startDrag do Electron substitui o
       arraste do HTML; deixar os dois correrem juntos faz o sistema receber
       duas operacoes e, na pratica, nenhuma. */
    ev.preventDefault();
    log("arraste: pedindo " + ARQUIVO_PRONTO);
    try { ipcRenderer.send("dd-arrasta", ARQUIVO_PRONTO); } catch (e) { log("arraste: " + e); }
  });

  // As marcas sao posicionadas em porcentagem, mas a onda e desenhada em
  // pixels -- redimensionar exige redesenhar.
  window.addEventListener("resize", () => { desenha(); pintaSelecao(); });
}

/* O ESTADO VISUAL DA ONDA.

   Duas coisas diferentes, e confundi-las apaga uma delas:

     ARQUIVO_PRONTO  ha um arquivo no disco -> a onda PODE ser arrastada
     ONDA_SEL        a pessoa clicou nela   -> a onda ESTA selecionada

   O atributo draggable acompanha o primeiro; o contorno, o segundo. Ligar o
   draggable so quando selecionada obrigaria a clicar antes de arrastar, e
   ninguem faz isso -- num Finder da vida, arrastar um arquivo nao selecionado
   funciona. */
let ONDA_SEL = false;
function poeSelecao(v) {
  ONDA_SEL = !!v && !!ARQUIVO_PRONTO;
  const el = $("onda");
  if (el) el.classList.toggle("sel", ONDA_SEL);
}
/* QUAL TRECHO ESTA DENTRO DO ARQUIVO PRONTO  (2.0.0)

   Guardar o arquivo nao basta: e preciso saber a que In e Out ele corresponde,
   senao nao ha como perceber que ele envelheceu. */
let TRECHO_PRONTO = null;      // {ini, fim} em segundos, ou null
let RECORTE_MARCADO = null;    // o setTimeout do recorte, para poder cancelar

/* O QUE O ARQUIVO PRONTO E, e nao o que o seletor pede  (2.3.3)

   Ele e gravado no MOMENTO em que o arquivo passa a existir, porque e ali que
   a resposta e certa: o download acabou de acontecer com o FORMATO daquele
   instante. Deduzir isso depois -- pela extensao, pelo seletor -- seria uma
   segunda fonte para o mesmo dado, e um dia elas discordariam. */
let PRONTO_VIDEO = false;

function poeArrastavel(caminho) {
  ARQUIVO_PRONTO = caminho || null;
  if (caminho) PRONTO_VIDEO = (FORMATO === "VIDEO");
  TRECHO_PRONTO = caminho && VIDEO ? { ini: inicioSeg(), fim: fimSeg() } : null;
  /* O BOTAO ANDA JUNTO COM A ONDA, e por isso a pintura mora aqui e nao no
     fim do baixar(): sao os mesmos dois momentos -- ganhou arquivo, perdeu
     arquivo. Espalhar isso pelo baixar() deixaria o paraTudo() de fora, e o
     botao ficaria verde depois de colar outro link. */
  pintaRotulo();
  const el = $("onda");
  if (!el) return;
  el.classList.toggle("pronta", !!ARQUIVO_PRONTO);
  el.setAttribute("draggable", ARQUIVO_PRONTO ? "true" : "false");
  if (!ARQUIVO_PRONTO) poeSelecao(false);
}

/* O BOTAO DE DOWNLOAD TAMBEM SE ARRASTA  (1.9.13)

   O mesmo arquivo e o mesmo caminho da onda -- o startDrag do Electron, pelo
   dd-arrasta. Sao duas portas para o mesmo gesto, e isso e de proposito: o
   botao e onde a pessoa esta olhando quando o download termina; a onda e
   onde ela vai procurar depois, quando quiser so um pedaco.

   O CLIQUE CONTINUA SENDO O CLIQUE. O arraste so comeca depois de o ponteiro
   andar alguns pixels com o botao apertado; um clique parado baixa de novo,
   como sempre. Os dois convivem na onda desde a 1.8.7. */
function ligaArrasteBotao() {
  const bt = $("btDownload");
  if (!bt) return;
  bt.addEventListener("dragstart", (ev) => {
    if (!ARQUIVO_PRONTO) { ev.preventDefault(); return; }
    /* preventDefault E OBRIGATORIO: o startDrag do Electron substitui o
       arraste do HTML, e deixar os dois correrem juntos faz o sistema receber
       duas operacoes e, na pratica, nenhuma. */
    ev.preventDefault();
    log("arraste (botao): pedindo " + ARQUIVO_PRONTO);
    try { ipcRenderer.send("dd-arrasta", ARQUIVO_PRONTO); } catch (e) { log("arraste: " + e); }
  });
}

/* Os campos de tempo editaveis sairam junto com a barra antiga: In e Out agora
   se marcam com [ e ] onde o playhead esta, ou arrastando sobre a onda. Quem
   precisa de precisao usa as setas de 5s e depois o colchete. */

// ---------------------------------------------------------------------------
// tela
// ---------------------------------------------------------------------------
/* O ESTADO MORA NA LINHA DO CANAL.

   Uma barra dedicada ficaria ocupando espaco o tempo todo para, na maior parte
   dele, nao dizer nada. A linha sob o titulo ja existe e fica livre enquanto
   nao ha video carregado -- quando o trabalho termina, ela volta a ser o nome
   do canal. */
let CANAL = "";
function diz(txt, tipo) {
  const el = $("canal");
  if (!el) return;
  el.textContent = txt;
  el.className = "canal" + (tipo ? " " + tipo : "");
}
function devolveCanal() {
  const el = $("canal");
  if (el) { el.textContent = CANAL; el.className = "canal"; }
}

/* Liga e desliga os controles da barra conforme ha ou nao audio carregado.
   Chamada no arranque (tudo desligado) e no fim do analisar (tudo ligado). */
function habilita(v) {
  const ligado = !!v;
  ["btIn","btOut","btPlay","btStop","btVolta","btFrente","btTudo","btDownload"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = !ligado;
  });
  $("barraAcoes").classList.toggle("apagado", !ligado);
}

/* =====================================================================
   A TELA DE PARTIDA

   Tres modos:
     "vazio"      icone parado, "Paste a link", atalho visivel
     "analisando" icone acelerado, "Analyzing...", barra no lugar do atalho
     "fora"       some, e o painel aparece

   O "ANALYZING" NAO VAI MAIS PARA O BOTAO DE DOWNLOAD. Ele ia, e ficava
   vermelho: o botao anunciava um trabalho que nao era dele, no meio de uma
   barra de botoes toda desligada. Aqui o aviso mora onde a pessoa esta
   olhando -- no unico elemento da tela.

   A altura da janela acompanha: 186 na partida, 370 com o painel montado.
   Sem isso a tela limpa herdaria os 370 e ficaria com um vazio enorme. */
/* A SAIDA DO ERRO NA TELA INICIAL  (2.1.2)

   Recebe a `acao` que o motor devolveu -- e nao um pedaco da mensagem. A dica
   e texto para uma pessoa ler e muda com o idioma; decidir por regex nela
   amarraria o botao a uma frase em portugues.

   Hoje ha uma acao so, e mesmo assim ela passa por um mapa: a segunda vai
   chegar, e a alternativa seria um `if` que cresce. */
const ACOES_ERRO = {
  cookies: { i18n: "abrirCookies", faz: () => abreBloqueio(true) },
};

/* O DIALOGO DO BLOQUEIO  (2.1.2)
   ------------------------------
   Aparece sozinho na PRIMEIRA vez que o YouTube barra a maquina, e depois
   disso so a pedido.

   `BLOQ_CALADO` e a regra do "nao insiste", a mesma da faixa de atualizacao:
   quem disse "agora nao" nao e perguntado de novo. Mas o botao embaixo da
   mensagem continua na tela, entao mudar de ideia custa um clique -- calar nao
   e esconder.

   Ele mora numa variavel de sessao, e nao no disco, de proposito: a razao mais
   comum do bloqueio some sozinha (a VPN desliga, o IP roda, a rede muda), e
   gravar "nao pergunte mais" no disco calaria o painel para sempre por causa
   de uma tarde ruim. */
let BLOQ_CALADO = false;
let BLOQ_ULTIMO_LINK = "";

/* `porBloqueio` diz de ONDE a janela veio, e a diferenca aparece na tela: só
   quem chegou aqui por uma falha ve o paragrafo que explica o bloqueio. Aberta
   pelo botao da tela inicial, ela nao tem nada a relatar -- e uma janela que
   afirma o que nao aconteceu ensina a pessoa a nao ler o que ela diz. */
function abreBloqueio(porBloqueio) {
  const s = $("selCookiesBloq");
  /* Chega com o que JA estiver escolhido nos Ajustes: se a pessoa usa Firefox,
     oferecer Chrome seria perguntar de novo o que ela ja disse. Sem nada
     escolhido, fica o primeiro da lista -- o Chrome -- como sugestao. */
  if (s && $("selCookies") && $("selCookies").value) s.value = $("selCookies").value;
  pintaUsarCookies();
  $("bloqPorque").classList.toggle("oculto", !porBloqueio);
  $("statusBloq").textContent = "";
  $("statusBloq").className = "status";
  /* A versao do motor e perguntada AQUI, e nao so nos Ajustes: esta janela abre
     sem passar por eles, e o numero e o que responde "preciso atualizar?" antes
     de alguem apertar o botao. */
  mostraVersaoMotor();
  $("telaBloqueio").classList.remove("oculto");
}
function fechaBloqueio() { $("telaBloqueio").classList.add("oculto"); }

/* O BOTAO SO EXISTE QUANDO HA O QUE APLICAR.

   Sem ele a escolha nao teria como acontecer: o seletor abre ja em Chrome, e
   escolher Chrome de novo nao dispara `change` -- o evento compara com o valor
   do elemento, e ele ja era esse. A pessoa mexeria no seletor, veria o que
   queria, e nada teria mudado.

   E ele some quando o escolhido e o em uso sao o mesmo, entao numa janela ja
   configurada nao fica um botao sobrando pedindo para ser apertado. */
function pintaUsarCookies() {
  const bt = $("btUsarCookies"), s = $("selCookiesBloq");
  if (!bt || !s) return;
  const emUso = ($("selCookies") && $("selCookies").value) || "";
  bt.classList.toggle("oculto", s.value === emUso);
}

/* Tentar de novo NAO reimplementa a analise: chama o mesmo `analisar()` do
   Cmd+V e do botao. Um segundo caminho para o mesmo trabalho e um segundo
   caminho para dar defeito -- e seria o caminho que ninguem testa, porque so
   roda depois de um erro. */
async function tentaDeNovo() {
  const url = BLOQ_ULTIMO_LINK || $("link").value;
  if (!url) return;
  $("link").value = url;
  await analisar();
}
function poeAcaoErro(acao) {
  const bt = $("pAcaoErro");
  if (!bt) return;
  const a = ACOES_ERRO[acao || ""];
  bt.classList.toggle("oculto", !a);
  if (!a) { bt.onclick = null; return; }
  bt.textContent = txt(a.i18n);
  bt.onclick = a.faz;
}

function partida(modo, erro) {
  const b = document.body;
  const rail = $("pRail");

  if (modo === "fora") {
    b.classList.remove("na-partida", "analisando");
    if (rail) rail.classList.remove("medido");
    reAltura();
    return;
  }

  b.classList.add("na-partida");
  b.classList.toggle("analisando", modo === "analisando");
  reAltura();

  const tit = $("pTitulo");
  if (tit) tit.textContent = txt(modo === "analisando" ? "analisandoTitulo" : "colarTitulo");
  if ($("pSub"))  $("pSub").classList.toggle("oculto", modo === "analisando");
  if (rail) {
    rail.classList.toggle("oculto", modo !== "analisando");
    // volta ao laco: o proximo analisar comeca sem percentual nenhum
    rail.classList.remove("medido");
    if ($("pRailFill")) $("pRailFill").style.width = "";
  }
  const el = $("pErro");
  if (el) {
    el.textContent = erro || "";
    el.classList.toggle("oculto", !erro);
  }
  /* O BOTAO DE SAIDA SOME A CADA ENTRADA NA TELA, e quem o traz de volta e o
     poeAcaoErro logo depois. Escondê-lo aqui, e nao em cada chamador, e o que
     garante que a saida de uma falha ANTIGA nao fique pendurada embaixo da
     mensagem de outra -- o mesmo motivo da linha do destino, na 1.8.10. */
  poeAcaoErro("");

  /* A LINHA DO DESTINO SOME A CADA ENTRADA NA TELA LIMPA  (1.8.10).

     Na 1.8.9 esta chamada REPINTAVA a linha, e era por isso que ela vivia na
     tela. Agora ela so apaga: a linha e uma confirmacao do clique na pasta, e
     nao um rodape. Quem chegou aqui por Esc ou por um download terminado nao
     pediu para ver caminho nenhum. */
  if (PINTA_PASTA_PARTIDA) {
    try { PINTA_PASTA_PARTIDA(); } catch (e) { log("pasta na partida: " + e); }
  }
}

/* A barra da analise so vira "medida" quando ha um numero. Ate la ela desliza
   em laco, porque fingir 0% parado por vinte segundos e pior que nao mostrar
   percentual nenhum. */
function partidaProgresso(p) {
  const rail = $("pRail"), fill = $("pRailFill");
  if (!rail || !fill || rail.classList.contains("oculto")) return;
  rail.classList.add("medido");
  fill.style.width = Math.max(0, Math.min(100, p)).toFixed(1) + "%";
}

/* =====================================================================
   A BUSCA NO YOUTUBE  (1.8.8)

   A busca nao baixa nada e nao sabe baixar nada. Ela produz um LINK e entrega
   ao analisar(), que e o caminho que ja existia e ja esta provado. Um segundo
   caminho de download, comecando na lista, seria uma copia do primeiro que
   passaria a divergir dele na primeira correcao feita so de um lado.

   Por isso clicar num resultado faz exatamente o que colar faz: preenche o
   campo e chama analisar().
   ===================================================================== */

let BUSCA_ITENS = [];
let BUSCA_FOCO = -1;
/* O TOKEN DESCARTA RESPOSTA VELHA. Quem digita "beat", aperta Enter, muda de
   ideia e busca "jazz" pode ver a resposta de "beat" chegar DEPOIS -- o
   yt-dlp nao promete ordem entre duas chamadas. Sem o token, a lista mostraria
   o resultado da busca anterior sob o termo novo, e nada na tela diria isso. */
let BUSCA_TOKEN = 0;

/* BUSCAR ENQUANTO SE DIGITA  (1.8.9)

   TRES NUMEROS, e os tres tem motivo:

   BUSCA_ESPERA = 420ms depois da ULTIMA tecla. Digitacao normal tem intervalos
   de 100 a 250ms entre letras, entao 420 quase nunca dispara no meio de uma
   palavra, e ainda parece imediato quando a pessoa para. Abaixo de ~300 a
   busca dispara no meio de "toto" e a lista pisca resultados de "tot".

   BUSCA_MINIMO = 2 letras. Uma letra devolve os vinte videos mais vistos que
   comecam com ela -- ruido caro: uma chamada de rede para um resultado que
   ninguem vai usar.

   O ENTER CONTINUA VALENDO e nao espera nada. Quem digitou e ja sabe o que
   quer nao deve ficar olhando para 420ms de nada acontecendo. */
const BUSCA_ESPERA = 420;
const BUSCA_MINIMO = 2;
let BUSCA_RELOGIO = null;
/* O termo da ULTIMA busca disparada. Sem ele, apagar uma letra e digitar a
   mesma de volta refaz a consulta identica: mesma rede, mesma resposta, mesma
   lista, e a lista PISCA no meio do caminho. */
let BUSCA_ULTIMO = "";

function buscaAberta() { return document.body.classList.contains("buscando"); }

/* A ULTIMA BUSCA SOBREVIVE AO PAINEL  (1.9.0)

   Fechar a lupa nunca limpou a lista -- mas fechar o PAINEL limpava, porque
   nada disso morava em disco. Quem escolhe uma trilha, baixa, edita por meia
   hora e volta para pegar a outra versao da mesma busca encontrava uma lista
   vazia e tinha de buscar de novo pelo mesmo termo.

   Vai no localStorage junto com as outras preferencias do painel. Sao uns 4 KB
   de titulo, canal, duracao e id -- e o id e o suficiente para remontar tudo,
   porque a URL do YouTube se monta a partir dele e a miniatura ja esta no
   disco com esse nome.

   NAO HA VALIDADE. A busca guardada e a resposta a uma pergunta que a pessoa
   fez; ela deixa de valer quando a proxima for feita, e nao quando o relogio
   virar. */
const BUSCA_GUARDA = "dd_busca";

function guardaBusca(termo, itens) {
  try {
    localStorage.setItem(BUSCA_GUARDA, JSON.stringify({ termo: termo, itens: itens }));
  } catch (e) { log("guardaBusca: " + e); }
}

function leBuscaGuardada() {
  try {
    const j = JSON.parse(localStorage.getItem(BUSCA_GUARDA) || "null");
    if (!j || !Array.isArray(j.itens) || !j.itens.length) return null;
    /* SO O QUE A LISTA DESENHA, e remontado item a item. O que sai do
       localStorage e texto de fora do programa: aceitar o objeto inteiro como
       veio faria a lista confiar num arquivo que qualquer coisa pode ter
       escrito. Titulo e canal viram string aqui, e o desenhaBusca ja usa
       textContent. */
    const itens = j.itens.filter((i) => i && i.id).map((i) => ({
      id: String(i.id),
      titulo: String(i.titulo || i.id),
      canal: String(i.canal || ""),
      duracao: Number(i.duracao) || 0,
      url: "https://www.youtube.com/watch?v=" + String(i.id),
      aoVivo: !!i.aoVivo,
    }));
    return itens.length ? { termo: String(j.termo || ""), itens: itens } : null;
  } catch (e) { return null; }
}

/* Cancelar e DUAS coisas, e esquecer uma delas deixa metade do trabalho vivo:
   o relogio que ainda vai disparar, e o yt-dlp que ja esta rodando. */
function cancelaBusca() {
  if (BUSCA_RELOGIO) { clearTimeout(BUSCA_RELOGIO); BUSCA_RELOGIO = null; }
  try { motor.paraBusca(); } catch (e) {}
}

function agendaBusca() {
  const campo = $("buscaCampo");
  if (!campo) return;
  const termo = campo.value.trim();

  if (BUSCA_RELOGIO) { clearTimeout(BUSCA_RELOGIO); BUSCA_RELOGIO = null; }

  /* CAMPO VAZIO LIMPA A LISTA. Deixar os resultados do termo anterior sob um
     campo em branco mostra uma resposta sem a pergunta. */
  if (!termo) {
    cancelaBusca();
    BUSCA_TOKEN++; BUSCA_ULTIMO = "";
    BUSCA_ITENS = []; BUSCA_FOCO = -1;
    $("buscaLista").innerHTML = "";
    /* APAGAR O CAMPO APAGA O QUE ESTAVA GUARDADO. Sem isto a lista sumiria da
       tela e voltaria sozinha na proxima vez que o painel abrisse -- limpar
       teria virado "limpar ate eu fechar". */
    try { localStorage.removeItem(BUSCA_GUARDA); } catch (e) {}
    buscaEstado(txt("buscarDica"), false);
    return;
  }

  if (termo.length < BUSCA_MINIMO) { buscaEstado(txt("buscarDica"), false); return; }
  if (termo === BUSCA_ULTIMO) return;

  BUSCA_RELOGIO = setTimeout(() => { BUSCA_RELOGIO = null; fazBusca(); }, BUSCA_ESPERA);
}

function abreBusca() {
  if (OCUPADO) return;
  document.body.classList.add("buscando");
  /* A LISTA VOLTA se ela estiver vazia -- ou seja, so quando o painel acabou
     de abrir. Restaurar por cima de uma lista que ja esta na tela trocaria o
     resultado de agora pelo de ontem. */
  if (!BUSCA_ITENS.length) restauraBusca();
  reAltura();
  const c = $("buscaCampo");
  if (c) { c.focus(); c.select(); }
}

function restauraBusca() {
  const g = leBuscaGuardada();
  if (!g) return;
  BUSCA_ITENS = g.itens;
  BUSCA_FOCO = -1;
  /* O TERMO VOLTA PARA O CAMPO, e o BUSCA_ULTIMO junto. Sem o segundo, digitar
     uma letra e apaga-la refaria a busca identica -- mesma rede, mesma
     resposta, e a lista piscando no caminho. */
  const c = $("buscaCampo");
  if (c) c.value = g.termo;
  BUSCA_ULTIMO = g.termo;
  desenhaBusca(g.itens);
  buscaEstado("", false);
  /* AS MINIATURAS JA ESTAO NO DISCO, com o id no nome. O baixaMiniaturas pula
     as que existem, entao isto e leitura de disco, e nao rede -- e o que
     faltar (temporario limpo pelo sistema) vem de novo, uma vez so. */
  motor.baixaMiniaturas(g.itens).then((capas) => {
    for (const it of g.itens) {
      if (!capas[it.id]) continue;
      const img = document.getElementById("bcapa_" + it.id);
      if (img) img.src = motor.urlDeArquivo(capas[it.id]);
    }
  }).catch((e) => log("miniaturas guardadas: " + e));
}

/* FECHAR NAO LIMPA A LISTA. Quem abre a lupa de novo costuma querer o segundo
   resultado da mesma busca -- refazer a consulta para mostrar o que ja estava
   ali seria dois segundos de espera para chegar ao mesmo lugar. */
/* FECHAR A BUSCA E DUAS COISAS DIFERENTES, e trata-las como uma so custou a
   passagem de bastao inteira.

   Quem fecha pelo X ou pelo Esc esta DESISTINDO: o som tem de parar, senao
   fica uma musica tocando atras do painel de download, sem nada na tela que
   explique de onde ela vem.

   Quem fecha porque ESCOLHEU uma faixa nao esta desistindo de nada -- e
   justamente essa musica que vai ser montada embaixo. Ali o som segue, e quem
   o passa para o tocador de baixo e o entregaPrevia, no fim do analisar.

   A 1.9.2 tinha o paraPrevia() dentro do fechaBusca, e o escolheBusca chama
   fechaBusca: o bastao nunca acontecia, e o sintoma era exatamente o que a
   1.9.1 dizia ter consertado -- a musica parando no "analisando".

   SAO DUAS FUNCOES, e nao um parametro. fechaBusca e usado direto como
   listener do botao X, e um parametro receberia o objeto do evento -- que e
   sempre truthy, e faria o X manter o som tocando. */
function saiDaBusca() {
  document.body.classList.remove("buscando");
  BUSCA_TOKEN++;          // resposta em voo nao desenha mais nada
  /* E o yt-dlp em voo MORRE. Fechar a busca e a pessoa dizendo que nao quer
     mais aquilo -- deixar o processo terminar seria trabalho contra o YouTube
     por uma resposta que ninguem vai ver. */
  cancelaBusca();
  reAltura();
}

function fechaBusca() {
  saiDaBusca();
  paraPrevia();
}

function buscaEstado(texto, erro) {
  const el = $("buscaEstado");
  if (!el) return;
  el.textContent = texto || "";
  el.classList.toggle("erro", !!erro);
  el.classList.toggle("oculto", !texto);
}

async function fazBusca() {
  const campo = $("buscaCampo");
  if (!campo) return;
  const termo = campo.value.trim();
  if (!termo) { buscaEstado(txt("buscarDica"), false); return; }

  const bins = motor.temBinarios();
  if (!bins.ok) { buscaEstado(txt("faltaBin") + bins.falta.join(", "), true); return; }

  /* O RELOGIO PENDENTE MORRE AQUI. Sem isto, quem digita "toto" e aperta Enter
     antes dos 420ms dispara a busca duas vezes: uma pelo Enter, e outra quando
     o relogio vence, meio segundo depois, sobre o mesmo termo. */
  if (BUSCA_RELOGIO) { clearTimeout(BUSCA_RELOGIO); BUSCA_RELOGIO = null; }
  BUSCA_ULTIMO = termo;

  const meu = ++BUSCA_TOKEN;
  buscaEstado(txt("buscando"), false);
  /* A LISTA ANTIGA FICA NA TELA ENQUANTO A NOVA NAO CHEGA (1.8.9).

     Ela era limpa aqui, e com a busca disparando a cada pausa isso virava um
     pisca-pisca: lista, vazio, lista, vazio. Manter a anterior por um segundo
     e melhor que mostrar nada -- ela ainda responde a uma pergunta parecida,
     e o "Buscando..." em cima ja diz que vem coisa nova.

     BUSCA_ITENS tambem NAO e zerado: se a pessoa clicar numa linha da lista
     velha nesse um segundo, o clique tem de funcionar. Uma lista visivel que
     nao responde ao clique e pior que uma lista ausente. */
  BUSCA_FOCO = -1;

  const tB = Date.now();
  const r = await motor.busca(termo, 20);
  /* SEM NUMERO, "esta lento" e opiniao -- e nao da para saber se melhorou.
     Este e o tempo do yt-dlp; o resto (desenhar vinte linhas) e microssegundos. */
  log("busca \"" + termo + "\": " + (Date.now() - tB) + " ms" +
      (r && r.ms ? " (yt-dlp " + r.ms + " ms)" : ""));
  if (meu !== BUSCA_TOKEN) return;                  // chegou tarde: alguem buscou de novo

  /* MORTA A PEDIDO NAO PINTA NADA DE VERMELHO. Aconteceria a cada letra. */
  if (r.cancelada) return;

  if (!r.ok)          { buscaEstado(txt("buscaErro") + r.erro, true); return; }
  /* AQUI a lista velha SAI. Manter resultados de "tot" sob a frase "nada
     encontrado" para "totoo" seria a tela dizendo duas coisas opostas. */
  if (!r.itens.length) {
    BUSCA_ITENS = []; BUSCA_FOCO = -1;
    $("buscaLista").innerHTML = "";
    buscaEstado(txt("buscaVazia"), false);
    return;
  }

  BUSCA_ITENS = r.itens;
  buscaEstado("", false);
  desenhaBusca(r.itens);
  guardaBusca(termo, r.itens);
  /* OS TRES PRIMEIROS, um de cada vez. Sao os mais clicados, e a fila e
     sequencial de proposito: tres yt-dlp ao mesmo tempo contra o YouTube e a
     receita que derrubou a busca em fila na 1.8.9. Cada um so comeca quando o
     anterior termina, e qualquer clique passa na frente -- o pedido de quem
     clicou mata a fila e assume. */
  /* SO O PRIMEIRO  (1.9.10). Eram tres, mais o hover, mais a seta -- e cada um
     desses e um pedido ao YouTube por uma faixa que talvez ninguem toque.
     Somado ao atalho, foi o que fez o painel bater na porta a ponto de ouvir
     "confirme que voce nao e um robo".

     O primeiro resultado e o mais clicado de todos, e um pedido a mais por
     busca e um custo que se justifica. Tres nao era. */
  if (r.itens[0] && !r.itens[0].aoVivo) preparaPrevia(r.itens[0].id);

  /* AS MINIATURAS CHEGAM DEPOIS, e a lista ja esta usavel sem elas. Esperar as
     vinte imagens para so entao mostrar os titulos seria segurar por um
     segundo a informacao que a pessoa veio ler. */
  const tM = Date.now();
  const capas = await motor.baixaMiniaturas(r.itens);
  log("miniaturas: " + (Date.now() - tM) + " ms");
  if (meu !== BUSCA_TOKEN) return;
  for (const it of r.itens) {
    if (!capas[it.id]) continue;
    const img = document.getElementById("bcapa_" + it.id);
    if (img) img.src = motor.urlDeArquivo(capas[it.id]);
  }
}



/* =====================================================================
   A IMAGEM DO VIDEO, COLADA NO PLAYHEAD  (1.9.5)

   Com a caixa "Video" marcada, a ficha da lugar a um <video> de 640x360 e a
   janela cresce. O video e MUDO e nao comanda nada: quem manda e o #som, o
   arquivo que ja esta em disco e que desenha a onda. O video so segue.

   POR QUE ISSO FUNCIONA SEM PLAYER NATIVO. O player do BlackSlice e libmpv
   porque o AVPlayer parou de abrir os segmentos DASH do YouTube. O Chromium
   abre. O unico problema de verdade era manter dois elementos juntos, e isso
   foi medido antes de escrever qualquer linha: 100ms de defasagem na partida,
   ~15ms depois de um alinhamento, sem deriva ao longo do tempo, e 76ms depois
   de um salto -- por isso ha um reajuste a cada `seeked`.

   COMO O VIDEO SEGUE, SEM TOCAR NOS CINCO LUGARES QUE MOVEM O PLAYHEAD.
   Todos eles terminam escrevendo em `som().currentTime`, e todos disparam
   `seeked` no #som. Ouvir esse evento pega os cinco de uma vez -- e pegaria
   tambem o sexto, no dia em que ele existir. Amarrar em cada um seria uma
   lista que envelhece calada.
   ===================================================================== */

const vid = () => $("videoEl");

/* 150ms e o limite para corrigir. Abaixo disso a correcao custa mais do que
   resolve: cada ajuste e um seek, e seek num fluxo remoto pisca a imagem. */
const VIDEO_LIMITE = 0.15;
/* A ALTURA DA IMAGEM, em um lugar so. O CSS anima ate ela e a janela e pedida
   com ela -- medir o offsetHeight aqui devolveria um valor DO MEIO DA
   TRANSICAO, e a janela pararia num tamanho que nao e o de nenhum dos dois
   estados. Sao 360 da caixa + 1 da borda de baixo. */
const ALTURA_VIDEO = 361;
let VIDEO_TOKEN = 0;
/* Ja tentamos sem atalho para ESTE video? Zera a cada video novo: a recusa e
   uma propriedade do endereco, e nao do painel. */
let VIDEO_SEM_ATALHO = false;

function comVideo() { return document.body.classList.contains("com-video"); }

function videoEstado(texto, erro) {
  const el = $("videoEstado");
  if (!el) return;
  el.textContent = texto || "";
  el.classList.toggle("erro", !!erro);
  el.classList.toggle("oculto", !texto);
}

/* Alinha a imagem ao som. `forca` ignora o limite -- e o que se usa depois de
   um salto, onde a diferenca e grande de propósito. */
function alinhaVideo(forca) {
  const v = vid(), s = som();
  if (!v || !v.src || !s || !s.src) return;
  if (!isFinite(v.duration) || v.duration <= 0) return;
  /* VIDEO PAUSADO NAO DERIVA, entao nao ha o que corrigir -- e corrigir mesmo
     assim era um impasse: o laco de sincronia dava seek a cada quadro, e seek
     constante nunca deixa o readyState chegar a HAVE_CURRENT_DATA, que e
     justamente a condicao para o play acontecer. O video ficava alinhado e
     parado para sempre, e so um stop/play manual o tirava dali.

     O alinhamento FORCADO continua valendo pausado: ele e o que recoloca a
     imagem no ponto depois de um salto ou de voltar do modo audio. */
  if (!forca && v.paused) return;
  const alvo = Math.max(0, Math.min(v.duration, s.currentTime));
  if (forca || Math.abs(v.currentTime - alvo) > VIDEO_LIMITE) {
    try { v.currentTime = alvo; } catch (e) {}
  }
}

/* O video imita o estado do som, e nunca o contrario.

   O PLAY E TENTADO DE NOVO, e nao uma vez so. Quando o video entra com o som
   JA tocando, o v.play() daquele instante e recusado -- o elemento acabou de
   receber o src e ainda nao tem dado nenhum. Como nenhum evento novo de `play`
   vem do som (ele nunca parou), o video ficava parado para sempre, e o que se
   via era um quadro congelado: a imagem certa, sem se mexer.

   Pior: o laco de sincronia continuava corrigindo a deriva de um video parado,
   entao ele saltava de vez em quando. Parecia miniatura, e nao video.

   Esta funcao e chamada tambem no `canplay` e a cada quadro pelo relogio, e
   por isso a tentativa recusada de agora vira a bem-sucedida de daqui a pouco. */
function segueVideo() {
  const v = vid(), s = som();
  if (!v || !v.src) return;
  if (s && !s.paused) {
    if (v.paused && v.readyState >= 2) {
      v.play().catch((e) => log("video play: " + e));
    }
  } else if (!v.paused) v.pause();
}

async function poeVideo(ligado, semAtalho) {
  const sec = $("video"), v = vid();
  VIDEO_TOKEN++;
  const meu = VIDEO_TOKEN;
  if (!semAtalho && !ligado) VIDEO_SEM_ATALHO = false;

  if (!ligado || !VIDEO) {
    document.body.classList.remove("com-video");
    if (sec) sec.classList.add("oculto");
    try { motor.paraVideo(); } catch (e) {}

    /* DESMARCAR NAO DESCARREGA A IMAGEM  (1.9.8)

       O src FICA. Quem desmarca a caixa quase sempre volta a marcar, e o que
       ele quer nesse instante e ver de novo -- nao esperar o endereco ser
       descoberto outra vez. Guardando o elemento carregado, voltar e imediato.

       MAS ELE PAUSA. Video escondido tocando e rede gasta com imagem que
       ninguem ve, e num fluxo de 720p isso nao e pouco. Pausado, o Chromium
       para de puxar bytes e o elemento continua pronto; ao voltar, o
       alinhaVideo(true) o recoloca no ponto do som, que e instantaneo.

       So o VIDEO TROCADO limpa de verdade -- e isso e o paraTudo que faz,
       chamando esta funcao com o VIDEO ja zerado. */
    try {
      if (v) {
        if (!VIDEO) { v.pause(); v.removeAttribute("src"); v.load(); }
        else v.pause();
      }
    } catch (e) {}
    videoEstado("", false);
    reAltura();
    return;
  }

  /* JA CARREGADO? Entao e so mostrar. E o caso de quem desmarcou e voltou. */
  if (v && v.getAttribute("src") && !semAtalho) {
    document.body.classList.add("com-video");
    sec.classList.remove("oculto");
    videoEstado("", false);
    reAltura();
    alinhaVideo(true);
    segueVideo();
    return;
  }

  /* A CAIXA APARECE ANTES DO ENDERECO, com o titulo e o aviso. Esperar o
     yt-dlp para so entao mostrar alguma coisa deixaria segundos em que marcar
     a caixa nao produziu nada na tela. */
  document.body.classList.add("com-video");
  sec.classList.remove("oculto");
  videoEstado(txt("videoPreparando"), false);
  reAltura();

  const r = await motor.urlVideo(VIDEO.id, !!semAtalho);
  if (meu !== VIDEO_TOKEN) return;            // a caixa foi desmarcada no meio
  if (r.cancelada) return;
  if (!r.ok) {
    log("urlVideo: " + r.erro);
    videoEstado(txt("videoErro") + r.erro, true);
    return;
  }
  log("urlVideo " + VIDEO.id + ": " + (r.doCache ? "do cache" : r.ms + " ms (" + r.caminho + ")"));
  /* O src NOVO tem de ser realmente novo: sem o load(), trocar o src de um
     elemento que ja falhou pode nao refazer a leitura. */
  try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {}

  v.src = r.url;
  try { v.load(); } catch (e) {}
  videoEstado("", false);
  alinhaVideo(true);
  segueVideo();
}

function ligaVideo() {
  const v = vid(), s = som();
  if (!v || !s) return;
  /* SEEKED NO SOM PEGA OS CINCO CAMINHOS que movem o playhead: o play a partir
     do In, o stop, o pulo das setas, o clique na regua e a passagem de bastao
     da previa. Todos escrevem em som().currentTime. */
  s.addEventListener("seeked", () => alinhaVideo(true));
  s.addEventListener("play",  segueVideo);
  s.addEventListener("pause", segueVideo);
  /* Quando a imagem termina antes do som (duracoes podem diferir por um
     quadro), ela para de existir na tela em vez de congelar no ultimo frame. */
  /* Quando a imagem finalmente tem dado, ela se alinha e entra tocando. Sem
     isto, marcar a caixa com o som ja tocando deixava o video congelado. */
  v.addEventListener("canplay", () => { alinhaVideo(true); segueVideo(); });
  v.addEventListener("loadeddata", () => { alinhaVideo(true); segueVideo(); });
  /* O <video> RECUSOU O QUE RECEBEU  (1.9.8)

     O endereco que o atalho devolve nem sempre vale fora do cliente que o
     pediu, e o Chromium responde com PIPELINE_ERROR_READ. O endereco existe, o
     painel o tem, e mesmo assim nao ha imagem.

     Entao a primeira recusa nao vira mensagem: vira um segundo pedido, sem
     atalho. So a segunda recusa e erro de verdade -- senao o painel entraria
     em laco pedindo para sempre. */
  v.addEventListener("error", () => {
    if (!comVideo()) return;
    /* SRC VAZIO NAO E RECUSA DO YOUTUBE: e o eco de um removeAttribute("src")
       seguido de load(), que o proprio painel faz antes de trocar a fonte. Sem
       esta guarda, o eco disparava a tentativa "sem atalho" -- o painel pedia
       o endereco de novo por um erro que ele mesmo tinha causado, e o video
       ficava parado no meio da troca. A previa ja tinha a mesma guarda; o
       video nasceu sem. */
    if (!v.getAttribute("src")) return;
    const msg = (v.error && v.error.message) || "video";
    if (!VIDEO_SEM_ATALHO) {
      log("video recusou (" + msg + "); pedindo sem atalho");
      VIDEO_SEM_ATALHO = true;
      videoEstado(txt("videoPreparando"), false);
      poeVideo(true, true);
      return;
    }
    videoEstado(txt("videoErro") + msg, true);
  });
}

/* =====================================================================
   A PREVIA DA BUSCA  (1.9.0)

   Ouvir o resultado antes de baixar. O <audio> toca a URL que o yt-dlp
   devolve, direto: nao ha arquivo em disco, nao ha pasta temporaria para
   limpar, e o que trafega e so o que a pessoa ouvir -- vinte segundos de
   escuta sao ~400 KB, contra os 3 MB de baixar a faixa (49 MB num mix de
   uma hora, que e justamente o tipo de resultado que se clica para conferir).

   Por isso nao ha onda aqui. Desenhar a faixa exige ter a faixa inteira, e a
   previa nunca tem. A regua diz ONDE voce esta; nao diz como a faixa e.

   O QUE ISSO CUSTOU esta escrito no index.html: o media-src da CSP ganhou
   https://*.googlevideo.com. E a unica abertura, e foi deliberada.
   ===================================================================== */

/* Os icones vem do <template> do index.html, clonados. Escreve-los aqui como
   string e joga-los com innerHTML seria HTML montado em JavaScript dentro da
   mesma funcao que trata titulo vindo da internet -- e a regra que protege
   essa funcao e "innerHTML aqui e apenas vazio", sem excecao. */
function iconesPrevia() {
  const t = $("tplPlayPrevia");
  return t ? t.content.cloneNode(true) : null;
}

const previa = () => $("previa");

/* PREPARAR O ENDERECO ANTES DO CLIQUE  (1.9.2)

   Dar play custa uma extracao inteira do yt-dlp -- ele busca a pagina do
   video e resolve o desafio do player antes de dizer onde o audio esta. Sao
   segundos, e nao ha flag que mude isso: o unico jeito de o clique parecer
   imediato e a resposta ja estar pronta quando ele chega.

   Entao o painel prepara em tres momentos, todos gratuitos do ponto de vista
   de quem usa: quando a lista chega (o primeiro resultado), quando uma linha
   ganha o foco pelo teclado, e quando o mouse PARA sobre uma linha.

   OS 260ms DO MOUSE existem para separar "passar por cima" de "olhar". Sem
   eles, arrastar o cursor da primeira linha ate a sexta dispararia seis
   preparos -- e uma fila de yt-dlp contra o YouTube nao vira lentidao, vira
   recusa, que foi o que a 1.8.9 aprendeu.

   E o preparo NUNCA atropela um clique: o motor desiste na hora se ja houver
   um pedido em andamento. */

function preparaPrevia(id) {
  if (!id) return;
  motor.urlAudio(id, true).then((r) => {
    if (r && r.ok && !r.doCache) log("previa preparada: " + id + " em " + r.ms + " ms");
  }).catch(() => {});
}

/* A FILA DO PREPARO. Um de cada vez, e ela se desfaz sozinha se alguem clicar
   -- o `ocupado` que o motor devolve e o sinal de que ha um pedido de verdade
   em andamento, e a fila espera a proxima busca em vez de insistir. */
let PREP_FILA = [];


/* O PREPARO PELO MOUSE SAIU  (1.9.10). Passar o cursor pela lista disparava
   um pedido por linha em que ele parasse -- e passar o cursor nao e pedir
   nada. Quem quer ouvir clica, e o clique reaproveita o que ja estiver em
   andamento desde a 1.9.6. */


/* O id do video que a BARRA representa -- tocando ou pausado. Vazio significa
   barra escondida. Guardar o indice da lista em vez do id seria errado: a
   lista se redesenha a cada busca, e o indice 3 passa a ser outra musica. */
let PREVIA_ID = "";
let PREVIA_TIT = "";
/* Descarta resposta velha: pedir a URL da faixa 3, mudar de ideia e pedir a da
   7 pode ter a da 3 chegando depois. Sem o token, o <audio> receberia a URL da
   3 com a barra escrita "7". */
let PREVIA_TOKEN = 0;
let PREVIA_SEM_ATALHO = false;

function pintaPreviaLinhas() {
  const ul = $("buscaLista");
  if (!ul) return;
  const s = previa();
  const tocando = !!(s && PREVIA_ID && !s.paused && s.src);
  [...ul.children].forEach((li, k) => {
    const it = BUSCA_ITENS[k];
    const meu = !!(it && PREVIA_ID && it.id === PREVIA_ID);
    li.classList.toggle("tocando", meu);
    const bt = li.querySelector(".pl-capa-bt");
    if (bt) {
      bt.classList.toggle("tocando", meu && tocando);
      bt.title = (meu && tocando) ? txt("previaPausar") : txt("previaTocar");
    }
  });
  const bt = $("btPrevia");
  if (bt) {
    bt.classList.toggle("tocando", tocando);
    bt.title = tocando ? txt("previaPausar") : txt("previaTocar");
  }
}

function pintaPreviaTempo() {
  const s = previa();
  if (!s) return;
  const dur = (isFinite(s.duration) && s.duration > 0) ? s.duration : 0;
  const t = Math.max(0, Math.min(dur || s.currentTime, s.currentTime));
  const f = dur ? (t / dur) : 0;
  $("previaCheio").style.width = (f * 100).toFixed(2) + "%";
  $("previaAlca").style.left   = (f * 100).toFixed(2) + "%";
  $("previaAgora").textContent = tc(t);
  $("previaTotal").textContent = dur ? tc(dur) : "--:--";
}

/* O QUE APARECE ENQUANTO O ENDERECO NAO CHEGA.

   Sem isto a barra mostrava o titulo com "00:00 / --:--" e uma regua apagada,
   parada. Quem olha nao ve "esta buscando": ve um tocador que nao toca -- e
   com a extracao do yt-dlp levando segundos, essa e a leitura mais natural.
   O texto entra no lugar do tempo, que naquele instante nao tem o que dizer. */
function previaCarregando(sim) {
  const t = $("previaTempo");
  if (t) t.classList.toggle("oculto", !!sim);
  const c = $("previaBuscando");
  if (c) {
    c.classList.toggle("oculto", !sim);
    if (sim) c.textContent = txt("previaBuscando");
  }
}

function mostraPreviaBarra(mostra, carregando) {
  const b = $("previaBarra");
  if (!b) return;
  const antes = b.classList.contains("oculto");
  b.classList.toggle("oculto", !mostra);
  b.classList.toggle("carregando", !!carregando);
  previaCarregando(!!carregando);
  /* APARECER E SUMIR MUDA A ALTURA DA JANELA, agora que ela vive fora da busca.
     Sem isto, dar play na tela limpa poria 48px de barra numa janela de 186 --
     e o que se veria seria a barra cortada pela borda de baixo. */
  if (antes !== b.classList.contains("oculto")) reAltura();
}

/* PARAR E LIMPAR. Chamada ao fechar a busca, ao escolher uma faixa e quando a
   previa falha.

   O removeAttribute("src") + load() e o mesmo par que o paraTudo() usa no
   #som: sem o load(), o Chromium mantem a conexao aberta e continua puxando
   bytes de uma musica que ninguem esta ouvindo. */
function paraPrevia() {
  PREVIA_TOKEN++;
  PREVIA_SEM_ATALHO = false;   /* a recusa e do endereco, nao do painel */
  try { motor.paraPrevia(); } catch (e) {}
  /* O ID SAI ANTES DE ENCOSTAR NO <audio>, e a ordem nao e estetica: tirar o
     src e chamar load() faz o Chromium disparar um evento "error", e o nosso
     ouvinte de error chama paraPrevia() de volta. Com o id ainda posto, isso
     e recursao -- e, pior, o error chega DEPOIS (eventos sao assincronos), ja
     com o id da faixa seguinte, matando a previa que acabou de comecar. */
  PREVIA_ID = ""; PREVIA_TIT = "";
  const s = previa();
  try { if (s) { s.pause(); s.removeAttribute("src"); s.load(); } } catch (e) {}
  mostraPreviaBarra(false, false);
  pintaPreviaLinhas();
}

async function alternaPrevia(i) {
  const it = BUSCA_ITENS[i];
  if (!it) return;

  /* AO VIVO nao vira previa pelo mesmo motivo que nao vira download: nao tem
     fim. O botao nem e desenhado, entao chegar aqui e o teclado ou um clique
     numa lista antiga -- responder com a frase que ja existe e melhor que
     ignorar em silencio. */
  if (it.aoVivo) { buscaEstado(txt("semAoVivo"), true); return; }

  const s = previa();
  if (!s) return;

  /* MESMA FAIXA: e um interruptor. Sem isto, clicar no play da faixa que ja
     esta tocando pediria a URL de novo e recomecaria do zero -- e do ponto de
     vista de quem clicou, o botao de pausa teria rebobinado a musica. */
  if (PREVIA_ID === it.id && s.src) {
    if (s.paused) { s.play().catch(() => {}); }
    else          { s.pause(); }
    pintaPreviaLinhas();
    return;
  }

  const bins = motor.temBinarios();
  if (!bins.ok) { buscaEstado(txt("faltaBin") + bins.falta.join(", "), true); return; }

  const meu = ++PREVIA_TOKEN;

  /* A BARRA APARECE ANTES DA URL, com o titulo e apagada. Esperar o yt-dlp
     para so entao mostrar alguma coisa deixaria um segundo inteiro em que o
     clique no play nao produziu nada na tela -- e um botao que nao responde
     parece um botao quebrado. */
  try { s.pause(); s.removeAttribute("src"); s.load(); } catch (e) {}
  PREVIA_ID = it.id; PREVIA_TIT = it.titulo;
  $("previaTit").textContent = it.titulo;
  $("previaAgora").textContent = tc(0);
  $("previaTotal").textContent = it.duracao ? tc(it.duracao) : "--:--";
  $("previaCheio").style.width = "0%";
  $("previaAlca").style.left = "0%";
  mostraPreviaBarra(true, true);
  pintaPreviaLinhas();

  const r = await motor.urlAudio(it.id, false, PREVIA_SEM_ATALHO);
  if (r && r.ok) log("previa " + it.id + ": " + (r.doCache ? "do cache" : r.ms + " ms"));
  if (meu !== PREVIA_TOKEN) return;          // chegou tarde: outra faixa ja pediu
  if (r.cancelada) return;
  if (!r.ok) {
    buscaEstado(txt("previaErro") + r.erro, true);
    paraPrevia();
    return;
  }

  s.src = r.url;
  mostraPreviaBarra(true, false);
  try { await s.play(); }
  catch (e) {
    log("previa: " + e);
    buscaEstado(txt("previaErro") + (e && e.message || e), true);
    paraPrevia();
    return;
  }
  pintaPreviaLinhas();
}

/* A PASSAGEM DE BASTAO  (1.9.0)

   A previa toca a URL do YouTube; o tocador de baixo toca o arquivo baixado.
   Sao a mesma musica, e o que esta funcao faz e trocar de um para o outro sem
   que quem ouve perceba: le a posicao da previa, poe o #som no mesmo ponto,
   cala a previa e da play.

   A ORDEM E SEEK -> RELE -> TROCA. O seek num arquivo local e rapido, mas nao
   e instantaneo, e a musica continua andando durante ele: cravar a posicao uma
   vez so entregaria o #som atrasado pelo tempo do proprio seek. Por isso a
   posicao e lida de novo no ultimo instante.

   CALA ANTES DE TOCAR, e nao depois. Duas copias da mesma faixa defasadas por
   alguns quadros nao soam como duas musicas: soam como uma musica com um
   filtro estranho, e o defeito seria descrito como "o som ficou metalico". Um
   vao de alguns milissegundos e mais honesto que isso.

   Devolve o segundo em que o #som entrou, ou 0 se nao havia o que passar. */
function esperaEvento(el, nome, ms) {
  return new Promise((ok) => {
    let feito = false;
    const fim = () => { if (feito) return; feito = true; el.removeEventListener(nome, fim); ok(); };
    el.addEventListener(nome, fim);
    setTimeout(fim, ms || 1500);   /* nunca pendura: um evento que nao vem nao pode travar o painel */
  });
}

async function entregaPrevia(id) {
  const pv = previa(), s = som();
  if (!pv || !s || !s.src) return 0;
  if (!PREVIA_ID || PREVIA_ID !== id || !pv.src || pv.paused) return 0;

  /* O arquivo local precisa estar decodificado o suficiente para aceitar seek.
     readyState >= 2 e HAVE_CURRENT_DATA. */
  if (s.readyState < 2) await esperaEvento(s, "loadeddata", 3000);

  try {
    s.currentTime = pv.currentTime;
    await esperaEvento(s, "seeked", 1200);
    const t = pv.currentTime;          /* a musica andou durante o seek */
    pv.pause();
    s.currentTime = t;
    await s.play();
    paraPrevia();                      /* solta a conexao e some com a barra */
    return t;
  } catch (e) {
    log("entregaPrevia: " + e);
    return 0;
  }
}

/* ARRASTAR NA REGUA. O ponteiro e capturado no elemento, e nao no document:
   com setPointerCapture o arrasto continua valendo quando o mouse sai da
   regua -- que e o que acontece sempre, porque ela tem 4px de altura. */
function ligaReguaPrevia() {
  const reg = $("previaRegua");
  if (!reg) return;
  let arrastando = false;

  const poe = (ev) => {
    const s = previa();
    if (!s || !s.src || !isFinite(s.duration) || s.duration <= 0) return;
    const r = reg.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / (r.width || 1)));
    s.currentTime = f * s.duration;
    pintaPreviaTempo();
  };

  reg.addEventListener("pointerdown", (ev) => {
    const s = previa();
    if (!s || !s.src) return;      // ainda carregando: nao ha onde arrastar
    arrastando = true;
    try { reg.setPointerCapture(ev.pointerId); } catch (e) {}
    poe(ev);
  });
  reg.addEventListener("pointermove", (ev) => { if (arrastando) poe(ev); });
  const solta = (ev) => {
    if (!arrastando) return;
    arrastando = false;
    try { reg.releasePointerCapture(ev.pointerId); } catch (e) {}
  };
  reg.addEventListener("pointerup", solta);
  reg.addEventListener("pointercancel", solta);
}

function ligaPrevia() {
  const s = previa();
  if (!s) return;
  /* timeupdate, e nao um requestAnimationFrame: ele dispara umas quatro vezes
     por segundo, que e de sobra para uma regua de 4px, e morre sozinho quando
     o audio para. O playhead da onda usa rAF porque la o passo precisa casar
     com o refresh da tela; aqui nao ha o que casar. */
  s.addEventListener("timeupdate", pintaPreviaTempo);
  s.addEventListener("loadedmetadata", pintaPreviaTempo);
  s.addEventListener("play",  pintaPreviaLinhas);
  s.addEventListener("pause", pintaPreviaLinhas);
  s.addEventListener("ended", () => { pintaPreviaLinhas(); pintaPreviaTempo(); });
  /* URL VENCIDA NAO DA ERRO CLARO: da um <audio> que simplesmente nao toca.
     Sem esta mensagem, o sintoma seria uma barra parada em 0:00 sem explicacao. */
  s.addEventListener("error", () => {
    if (!PREVIA_ID) return;
    /* Mesma historia do video: o endereco do atalho pode nao tocar. A primeira
       recusa vira um segundo pedido, sem atalho. */
    if (!PREVIA_SEM_ATALHO && s.getAttribute("src")) {
      log("previa recusou; pedindo sem atalho");
      PREVIA_SEM_ATALHO = true;
      const id = PREVIA_ID;
      const i = BUSCA_ITENS.findIndex((x) => x && x.id === id);
      if (i >= 0) { PREVIA_ID = ""; alternaPrevia(i); return; }
    }
    /* SRC VAZIO NAO E FALHA DE REDE: e o eco de um removeAttribute("src") que
       acabou de acontecer. Sem esta linha, trocar de faixa pintaria "nao
       consegui tocar" em vermelho toda vez, sobre uma previa que esta
       comecando bem. */
    if (!s.getAttribute("src")) return;
    buscaEstado(txt("previaErro") + (s.error && s.error.message || "audio"), true);
    paraPrevia();
  });
  const bt = $("btPrevia");
  if (bt) bt.addEventListener("click", () => {
    if (!PREVIA_ID || !s.src) return;
    if (s.paused) s.play().catch(() => {}); else s.pause();
    pintaPreviaLinhas();
  });
  ligaReguaPrevia();
}

/* createElement e textContent do inicio ao fim. Titulo e canal vem da internet,
   e o analisar() ja trata o titulo do video assim -- aqui sao vinte titulos de
   uma vez, vindos de uma busca, o que so aumenta o motivo. innerHTML aqui seria
   executar HTML de terceiros dentro do painel. */
function desenhaBusca(itens) {
  const ul = $("buscaLista");
  ul.innerHTML = "";

  itens.forEach((it, i) => {
    const li = document.createElement("li");
    li.className = "busca-item";

    const caixa = document.createElement("div");
    caixa.className = "busca-capa";
    const img = document.createElement("img");
    img.id = "bcapa_" + it.id;      // o id do YouTube e unico dentro da lista
    img.alt = "";
    caixa.appendChild(img);

    /* O PLAY DA PREVIA  (1.9.0)

       Os dois desenhos entram juntos e o CSS decide qual aparece. Trocar o
       innerHTML a cada play remontaria HTML quatro vezes por minuto para
       mostrar o mesmo par de icones.

       AO VIVO NAO GANHA BOTAO: uma transmissao nao tem fim e a regua nao teria
       o que medir. A linha continua na lista, com o rotulo, como ja era. */
    if (!it.aoVivo) {
      const bt = document.createElement("button");
      bt.className = "pl-capa-bt";
      bt.type = "button";
      bt.title = txt("previaTocar");
      const ic = iconesPrevia();
      if (ic) bt.appendChild(ic);
      /* O CLIQUE NO PLAY NAO ESCOLHE A FAIXA. O <li> tem o seu proprio
         listener, e sem esta guarda dar play carregaria o video e fecharia a
         busca -- o oposto do que o botao promete. A guarda esta no listener do
         <li>, e nao num stopPropagation aqui: guarda explicita e visivel de
         dentro de quem ela protege. */
      bt.addEventListener("click", () => alternaPrevia(i));
      caixa.appendChild(bt);
    }

    const txtb = document.createElement("div");
    txtb.className = "busca-txt";
    const t = document.createElement("div");
    t.className = "busca-tit";
    t.textContent = it.titulo;
    const s = document.createElement("div");
    s.className = "busca-sub";
    s.textContent = it.canal;
    txtb.appendChild(t); txtb.appendChild(s);

    const d = document.createElement("div");
    d.className = "busca-dur" + (it.aoVivo ? " vivo" : "");
    d.textContent = it.aoVivo ? txt("aoVivo") : (it.duracao ? tc(it.duracao) : "—");

    li.appendChild(caixa); li.appendChild(txtb); li.appendChild(d);
    li.addEventListener("click", (ev) => {
      /* O play mora DENTRO da linha, entao o clique nele chega aqui tambem.
         closest() e nao target: o clique cai no <svg> ou no <path>, nunca no
         <button>, e comparar com o alvo direto deixaria passar. */
      if (ev.target && ev.target.closest && ev.target.closest(".pl-capa-bt")) return;
      escolheBusca(i);
    });
    ul.appendChild(li);
  });

  /* A LISTA FOI REDESENHADA e a previa nao parou junto -- ela e da faixa, nao
     da lista. Se a faixa que toca ainda estiver entre os resultados novos, a
     linha dela volta a aparecer marcada; se nao estiver, o som continua e a
     barra continua dizendo qual e. */
  pintaPreviaLinhas();
}

function focaBusca(i) {
  const ul = $("buscaLista");
  if (!ul || !BUSCA_ITENS.length) return;
  BUSCA_FOCO = Math.max(0, Math.min(BUSCA_ITENS.length - 1, i));
  [...ul.children].forEach((li, k) => li.classList.toggle("foco", k === BUSCA_FOCO));
  const alvo = ul.children[BUSCA_FOCO];
  /* O teste do scrollIntoView nao e paranoia com o Chromium -- ele sempre tem.
     E para o jsdom, que NAO implementa esse metodo: sem o teste, qualquer teste
     futuro que monte a lista e desca uma linha estoura aqui, e o erro fala de
     scroll num teste que nao tem tela nenhuma. */
  if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ block: "nearest" });
  /* Descer com a seta e dizer que aquela linha interessa. */
  const it = BUSCA_ITENS[BUSCA_FOCO];
  if (it && !it.aoVivo) preparaPrevia(it.id);
}

/* AO VIVO NAO PASSA. Uma transmissao nao tem fim, e o yt-dlp baixaria ate
   alguem parar -- o painel ficaria "analisando" para sempre, sem erro nenhum
   para mostrar. Recusar aqui, com o motivo escrito, e melhor que deixar seguir
   e travar depois. */
function escolheBusca(i) {
  const it = BUSCA_ITENS[i];
  if (!it) return;
  if (it.aoVivo) { buscaEstado(txt("semAoVivo"), true); return; }

  /* A PREVIA DA MESMA FAIXA CONTINUA TOCANDO  (1.9.0)

     Escolher e mandar montar a musica que voce ESTA ouvindo. Calar o som para
     depois devolve-lo montado, do inicio, e cortar justamente o que a escolha
     tinha de continuo -- e a espera vira silencio no meio de uma musica.

     O som segue pela previa durante o download e a onda, e la no fim do
     analisar() o entregaPrevia() passa o bastao para o tocador de baixo, no
     mesmo segundo em que ela parou.

     OUTRA FAIXA E OUTRO CASO: clicar na 7 enquanto a 3 toca e dizer que a 3
     nao interessa mais. Essa morre aqui. */
  if (PREVIA_ID !== it.id) paraPrevia();
  $("link").value = it.url;
  /* saiDaBusca, e nao fechaBusca: este e o caminho que NAO cala o som. */
  saiDaBusca();
  /* A busca ja sabe titulo, canal, duracao e id -- o analisar nao precisa
     perguntar de novo ao YouTube o que acabou de ser respondido. */
  analisar({ id: it.id, titulo: it.titulo, canal: it.canal, duracao: it.duracao });
}

/* =====================================================================
   VERSAO NOVA  (portado do BlackNote+ 1.12.0 / 1.15.0)

   Tres regras, e as tres vieram de uso e nao de projeto:

   1. FALHA CALADO. Sem internet, servidor fora, JSON torto -- nada aparece.
      Um verificador que reclama quando voce esta offline e pior que nao ter.
   2. NAO INSISTE. "Agora nao" grava o numero dispensado; aquela versao nao
      pergunta de novo. Sem isso a pessoa desliga o recurso na terceira vez.
   3. NAO BLOQUEIA. Faixa, e nao janela modal.
   ===================================================================== */

/* COMPARACAO NUMERO A NUMERO, e nao de texto.

   "1.9.0" > "1.11.0" e VERDADEIRO comparando string, porque "9" vem depois de
   "1". Um verificador escrito com > direto anunciaria "atualizado" para sempre
   a partir da decima versao menor -- e o erro so apareceria meses depois,
   quando ninguem mais lembra de olhar para ca. */
function cmpVersao(a, b) {
  const pa = String(a || "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

let NOVA_INFO = null;
let UPD_DISPENSADA = "";

/* A LISTA DO QUE MUDOU vem do MESMO versao.json que o verificador ja baixa --
   sem requisicao a mais e sem pagina nova para manter em tres idiomas. O campo
   e OPCIONAL: um versao.json sem "mudancas" faz a faixa funcionar como antes.

   Cada item entra com textContent, NUNCA innerHTML: e texto vindo da rede, e
   este painel roda com acesso ao sistema de arquivos. */
function pintaMudancas(info) {
  const bt = $("upd-ver"), ul = $("upd-lista");
  if (!bt || !ul) return;
  ul.textContent = "";
  ul.hidden = true;
  const itens = Array.isArray(info.mudancas)
    ? info.mudancas.filter((x) => typeof x === "string" && x.trim()).slice(0, 12)
    : [];
  bt.hidden = itens.length === 0;
  itens.forEach((x) => {
    const li = document.createElement("li");
    li.textContent = x.trim();
    ul.appendChild(li);
  });
}

function mostraNova(info) {
  const faixa = $("upd");
  if (!faixa) return;
  NOVA_INFO = info;
  if ($("upd-v"))    $("upd-v").textContent = info.versao + " " + txt("disponivel");
  if ($("upd-nota")) $("upd-nota").textContent = info.nota ? "— " + info.nota : "";
  pintaMudancas(info);
  faixa.hidden = false;
  reAltura();
}

function fechaFaixa() {
  if ($("upd")) $("upd").hidden = true;
  if ($("upd-lista")) $("upd-lista").hidden = true;
  reAltura();
}

async function verificaVersao() {
  let info = null;
  try { info = await ipcRenderer.invoke("dd-check-version"); } catch (e) { return; }
  if (!info || !info.versao) return;                   // offline, 404, JSON torto

  const atual = ipcRenderer.sendSync("dd-version") || "";
  // sem saber a versao instalada nao da para comparar, e chutar "ha novidade"
  // seria pior que ficar calado
  if (!/^\d/.test(atual)) return;
  if (cmpVersao(info.versao, atual) <= 0) return;      // igual ou mais velha
  if (info.versao === UPD_DISPENSADA) return;          // ja disse "agora nao"

  log("versao nova no site: " + info.versao + " (instalada " + atual + ")");
  mostraNova(info);
}

/* A FAIXA MUDA A ALTURA DA JANELA.

   Sem isto ela empurraria o conteudo para fora: a janela tem altura fixa, e a
   faixa nasce depois. reAltura() refaz a conta com o estado atual, e por isso
   e chamada tambem ao fechar a faixa e ao abrir a lista. */
function reAltura() {
  const faixa = $("upd"), ul = $("upd-lista");
  let extra = 0;
  if (faixa && !faixa.hidden) extra += faixa.offsetHeight || 34;
  if (ul && !ul.hidden)       extra += Math.min(ul.scrollHeight || 0, 150);
  /* A BUSCA VEM PRIMEIRO NA CONTA, e nao por capricho de ordem: ela pode estar
     aberta COM .na-partida ligada (a lupa da tela limpa nao desliga a partida,
     para que fechar devolva a tela limpa). Perguntar por .na-partida antes
     daria 186px a uma lista de vinte resultados. */
  /* A BARRA DA PREVIA ENTRA NA CONTA fora da busca. Ela virou filha do body
     para poder continuar visivel durante o "analisando" -- e os 186px da tela
     limpa foram medidos quando ela nao existia. Sem isto, a barra apareceria
     cortada pela borda de baixo da janela.

     Na busca nao: os 430px ja a contemplam, porque ela sempre esteve ali. */
  const barra = $("previaBarra");
  const buscando = document.body.classList.contains("buscando");
  /* offsetHeight, e nao a classe .oculto: desde a 1.9.4 a barra tambem some
     por CSS enquanto o painel analisa, e a classe continua la. Perguntar pela
     classe daria 48px de janela vazia embaixo do "Analisando...". Altura zero
     e a resposta certa para qualquer motivo de estar escondida. */
  if (!buscando && barra && barra.offsetHeight > 0) extra += barra.offsetHeight;
  /* A IMAGEM DO VIDEO MUDA A JANELA. Ela SOMA a altura, sem descontar nada:
     desde a 1.9.10 a ficha continua na tela junto com o video.

     E a altura vem da CONSTANTE, e nao do offsetHeight: desde a 1.9.12 a secao
     anima, e medi-la no meio da transicao pediria uma janela do tamanho de um
     instante que ja passou. */
  const sec = $("video");
  if (!buscando && comVideo() && sec && !sec.classList.contains("oculto")) {
    extra += ALTURA_VIDEO;
  }
  const base = buscando ? 430
             : document.body.classList.contains("na-partida") ? 186
             : 370;
  alturaJanela(base + extra);
}

function alturaJanela(h) {
  try { ipcRenderer.send("dd-altura", h); } catch (e) { log("altura: " + e); }
}

function ocupa(v, rotulo) {
  OCUPADO = !!v;
  $("btDownload").disabled = OCUPADO;
  $("btDownload").classList.toggle("ocupado", OCUPADO);
  /* O VERDE SAI DE CENA ENQUANTO TRABALHA, e nao por estetica: o vermelho do
     .ocupado e o verde do .feito sao a mesma propriedade, e quem ganha e quem
     estiver declarada por ultimo na folha -- baixar de novo depois de um
     download pintaria o botao de verde no meio do trabalho. O arraste sai
     junto: durante o download o arquivo esta sendo reescrito.
     Quando termina, o pintaRotulo() do else devolve os dois. */
  if (OCUPADO) {
    $("btDownload").classList.remove("feito");
    $("btDownload").setAttribute("draggable", "false");
  }
  $("barraFora").classList.toggle("oculto", !OCUPADO);
  if (OCUPADO) $("rotulo").textContent = rotulo || txt("processando");
  else { $("barra").style.width = "0%"; pintaRotulo(); }
}

function progresso(linha) {
  const p = motor.leProgresso(linha);
  if (p === null) return;
  pintaProgresso(p);
}

/* QUEM PINTA E UM SO, e as duas rotas chegam aqui  (2.3.0)

   O yt-dlp sabe a porcentagem e a escreve; o ffmpeg nao sabe e escreve o
   instante. Sao duas leituras diferentes -- mas o que acontece na TELA e
   identico, e por isso ele mora fora das duas. Duas funcoes pintando a mesma
   barra e o comeco de um dia procurando por que uma delas ficou para tras. */
function pintaProgresso(p) {
  $("barra").style.width = p + "%";
  partidaProgresso(p);          // durante a analise, quem mostra e a tela limpa
  diz(txt("baixando") + p.toFixed(1) + "%");
}

/* A LEITURA DO ffmpeg PRECISA DA DURACAO, e por isso ela vem num fecho: o
   roda() entrega texto cru e nao sabe de que video se trata. */
function progressoFf(duracao) {
  return (texto) => {
    const p = motor.leProgressoFf(texto, duracao);
    if (p === null) return;
    pintaProgresso(p);
  };
}

/* AS DUAS ROTAS DO AUDIO, E QUEM ESCOLHE ENTRE ELAS  (2.3.0)

   A rota DIRETA usa o endereco que a consulta ja trouxe e puxa os bytes com o
   ffmpeg -- o yt-dlp nao e chamado. A RESERVA e o baixaAudio() de sempre, sem
   uma linha alterada.

   A ESCOLHA E FEITA AQUI, NUM LUGAR SO. E a mesma licao do comandoYt(): se um
   lugar perguntasse "tem endereco?" e outro "posso usar o ffmpeg?", um dia um
   responderia sim e o outro nao.

   E A RESERVA NAO E CONDICIONAL. Qualquer falha da rota direta -- endereco
   vencido, formato que nao entra no container, ffmpeg sem https -- cai no
   baixaAudio(). Nao existe caminho em que esta funcao devolva erro sem ter
   tentado o que funcionava ontem.

   O LOG DIZ POR ONDE FOI, e isso e requisito. Sem essa linha, o dia em que a
   rota direta parar de funcionar em silencio sera um dia de "o painel voltou a
   ficar lento e ninguem sabe por que" -- que e exatamente a forma de falhar que
   o log da 2.0.0 existe para acabar. */
async function pegaAudio(url, info) {
  if (info && info.direct && info.kind === "audio") {
    const ext = info.formats && info.formats[0] && info.formats[0].ext || "m4a";
    const direct = await motor.baixaAudioDireto({ url: info.sourceUrl || url, ext }, info.id,
                                                info.duracao || 0, progressoFf(info.duracao));
    if (direct && direct.ok) {
      log("baixaAudio: rota DIRECT FILE (" + ext + ", " + direct.bytes + " bytes)");
      return direct;
    }
    if (direct && direct.bruto) log("direct-file (bruto): " + direct.bruto);
    return { ok: false, erro: (direct && direct.erro) || "direct file download failed" };
  }
  if (info && info.direct && info.kind === "video") {
    const direct = await motor.baixaAudioDireto({ url: info.sourceUrl || url, ext: "m4a", reencode: true }, info.id,
                                                info.duracao || 0, progressoFf(info.duracao));
    if (direct && direct.ok) return direct;
    return { ok: false, erro: (direct && direct.erro) || "kunne ikke hente lydsporet fra direkte video" };
  }
  if (info && info.audio && info.audio.url) {
    const t0 = Date.now();
    const d = await motor.baixaAudioDireto(info.audio, info.id, info.duracao,
                                           progressoFf(info.duracao));
    if (d && d.ok) {
      log("baixaAudio: " + (Date.now() - t0) + " ms — rota DIRETA (ffmpeg, " +
          info.audio.ext + ", " + d.bytes + " bytes)");
      return d;
    }
    log("rota direta falhou em " + (Date.now() - t0) + " ms, indo pela reserva: " +
        ((d && d.erro) || "sem erro"));
    /* O BRUTO INTEIRO, e nao a ultima linha. Foi jogar fora o resto do stderr
       que fez o chamado do "This video is not available" custar tres rodadas. */
    if (d && d.bruto) log("ffmpeg (bruto): " + d.bruto);
    /* A BARRA VOLTA A ZERO. Ela parou onde a rota direta desistiu, e deixa-la
       ali faria o download da reserva parecer comecar pela metade. */
    $("barra").style.width = "0%";
  } else {
    log("rota direta indisponivel para este link — indo pela reserva");
  }

  const t1 = Date.now();
  const a = await motor.baixaAudio(url, info.id, progresso);
  log("baixaAudio: " + (Date.now() - t1) + " ms — RESERVA (yt-dlp)");
  return a;
}

/* A onda so aparece depois que o audio chega; enquanto isso, a faixa fica
   visivel e vazia para a barra de progresso ter onde morar. */
function mostraPista() {
  $("linha").classList.remove("oculto");
  $("ficha").classList.remove("oculto");
}

// ---------------------------------------------------------------------------
// analisar
// ---------------------------------------------------------------------------
/* `jaSei` chega quando o link veio da BUSCA, e economiza uma extracao inteira.

   Escolher um resultado custava DUAS chamadas de yt-dlp para o mesmo video: a
   consulta(), para descobrir titulo e duracao, e o baixaAudio() logo depois.
   Sao segundos cada uma -- e a busca ja tinha entregue titulo, canal, duracao
   e id de todos os vinte resultados, na mesma resposta.

   A capa e o unico dado que a consulta trazia e a busca nao: ela vem do
   endereco padrao do YouTube, montado pelo MOTOR a partir do id -- o painel
   nao escreve endereco do ytimg em lugar nenhum, e ha teste para isso. Se nao existir, o painel
   segue sem capa, como ja seguia quando o download dela falhava.

   COLAR UM LINK CONTINUA PASSANDO PELA CONSULTA. Ali nao ha o que reaproveitar
   -- e ela tambem e quem recusa um link que nao e video. */
async function analisar(jaSei) {
  if (!modulosOk()) return;
  paraTudo();
  const url = $("link").value.trim();
  if (!url) { diz(txt("colePrimeiro"), "erro"); return; }

  const bins = motor.temBinarios();
  if (!bins.ok) {
    diz(txt("faltaBin") + bins.falta.join(", "), "erro");
    return;
  }

  partida("analisando");

  let info;
  if (jaSei && jaSei.id && jaSei.duracao > 0) {
    info = { ok: true, id: jaSei.id, titulo: jaSei.titulo || jaSei.id,
             canal: jaSei.canal || "", duracao: Number(jaSei.duracao) || 0,
             thumb: motor.urlDaCapa(jaSei.id) };
    log("analisar: sem consulta, os dados vieram da busca (" + jaSei.id + ")");
  } else {
    const t0 = Date.now();
    info = await motor.consulta(url);
    log("consulta: " + (Date.now() - t0) + " ms" +
      (info && info.provider ? " provider=" + info.provider : "") +
      (info && info.doCache ? " cache=hit" : " cache=miss"));
  }
  /* O ERRO INTEIRO VAI PARA O LOG, e não só a linha que cabe na tela.  (2.0.0)

     A tela mostra uma linha porque é uma linha que cabe. O log não tem esse
     limite, e foi a falta dele que fez o chamado do "This video is not
     available" custar três rodadas: a mensagem que importava era um AVISO
     duas linhas acima, e o limpaErro joga fora tudo o que não é a última
     linha de ERROR. */
  if (!info.ok) {
    if (info.bruto) log("yt-dlp falhou:\n" + info.bruto);
    if (info.dica) log("provável causa: " + info.dica);
    if (info.providerError) log("provider-feiltype: " + info.providerError);
    partida("vazio", txt("naoLi") + info.erro + (info.dica ? " — " + info.dica : ""));
    poeAcaoErro(info.acao);
    /* O DIALOGO SE OFERECE SOZINHO, uma vez. Guarda o link porque o campo e
       limpo em alguns caminhos de volta a tela inicial, e sem ele o "tentar de
       novo" nao teria o que tentar. */
    if (info.acao === "cookies") {
      BLOQ_ULTIMO_LINK = url;
      if (!BLOQ_CALADO) abreBloqueio(true);
    }
    return;
  }
  if (!info.duracao && !info.direct) {
    partida("vazio", txt("semDuracao"));
    return;
  }

  VIDEO = info;
  const caps = info.capabilities || {};
  /* Capabilities affect only affordances; the existing layout and controls
     remain in place. Trim is enabled again after duration is recovered. */
  const trimSupported = caps.supportsTrim !== false && !!info.duracao;
  ["btTudo", "pegaI", "pegaO"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.disabled = !trimSupported;
    el.title = trimSupported ? "" : txt("semDuracao");
  });
  // textContent e nao innerHTML: titulo vem da internet e pode conter
  // qualquer coisa. Aqui isso nunca vira HTML.
  $("titulo").textContent = info.titulo;
  CANAL = info.canal;

  // a capa e conveniencia: se nao vier, o painel segue sem ela
  $("capa").classList.add("oculto");
  if (info.thumb) {
    motor.baixaCapa(info.thumb, info.id).then((arq) => {
      if (!arq) return;
      $("capaImg").src = motor.urlDeArquivo(arq);
      $("capa").classList.remove("oculto");
    }).catch((e) => log("capa: " + e));
  }
  $("duracao").textContent = tc(info.duracao);
  $("ficha").classList.remove("oculto");

  // a pista NAO aparece aqui: ate a onda existir, quem esta na tela e a
  // tela de partida, e mostrar uma faixa vazia atras dela nao serve a nada
  /* SE A CAIXA VIDEO JA ESTA MARCADA, o endereco da imagem comeca a ser
     descoberto AGORA, em paralelo com o download do audio -- que leva
     segundos de qualquer jeito. Quando o painel abrir, o poeVideo encontra a
     URL no cache e a imagem aparece junto com a onda, em vez de comecar a ser
     buscada so depois de tudo pronto.

     Sao dois processos ao mesmo tempo, e nao vinte: a fila que derrubou a
     busca na 1.8.9 tinha um por resultado da lista. */
  /* O ENDERECO DA IMAGEM SO E DESCOBERTO EM MODO VIDEO  (2.1.3)

     Ate a 2.1.2 ele era descoberto SEMPRE, marcada a caixa ou nao, e o
     argumento escrito aqui era que "a espera some dentro da que ja existia,
     porque o audio leva segundos de qualquer jeito". O log desmentiu:

         urlVideo adiantado: 23.908 a 26.483 ms

     Nao e uma espera que some dentro de outra -- e um segundo processo
     yt-dlp, com o mesmo arranque de dez segundos, disputando CPU e rede
     com o download que a pessoa esta olhando. Na sessao em que ele rodou
     junto com a ficha dos binarios, a consulta foi de 14 s para 41 s.

     O ARGUMENTO CONTINUA VALENDO PARA QUEM ESTA EM VIDEO, e por isso ele
     nao foi removido: ali a imagem vai ser pedida de qualquer forma, e
     adiantar de fato economiza a espera. O que nao se justifica e cobrar
     isso de quem so quer o audio -- que e o uso comum do painel.

     Quem marcar VIDEO depois paga a descoberta naquele momento, pelo
     poeVideo(). E uma espera a mais para quem escolheu, em vez de uma
     espera fixa para todos.

     Nada e BAIXADO por causa disso: descobrir o endereco nao puxa video. Os
     bytes so comecam a correr quando o <video> recebe o src, e isso so
     acontece quando voce marca. */
  /* O ENDERECO DA IMAGEM VOLTA A SER DESCOBERTO SEMPRE  (2.4.0)

     A 2.1.3 pos esta chamada atras de um `if (FORMATO === "VIDEO")`, e o
     motivo estava medido: `urlVideo adiantado: 23.908 a 26.483 ms` -- um
     segundo processo yt-dlp, com o arranque de dez segundos daquela epoca,
     disputando CPU e rede com o download que a pessoa estava olhando.

     O QUE MUDOU FOI O PRECO, e nao a ideia. A 2.2.0 trocou o executavel de
     35 MB pelo par Python+zipapp, e o arranque caiu de ~10.000 ms para ~350.
     O que custava vinte e cinco segundos passou a custar poucos.

     E O QUE SE COMPRA COM ELE E O FIM DO "Getting the picture...". Sem esta
     chamada, marcar VIDEO depois de ouvir o audio abria uma extracao inteira
     na cara de quem achava que so ia trocar de aba -- e o painel ficava
     esperando, com uma mensagem, por algo que ele podia ter na mao.

     NADA E BAIXADO POR ISTO. Descobrir o endereco nao puxa video: o <video>
     nasce com preload="metadata", e os bytes de imagem so correm quando o
     elemento toca -- o que so acontece quando voce escolhe VIDEO.

     DE BRINDE, o audio da faixa entra no PREVIA_CACHE junto: o urlVideo pede
     `bv*+ba` e o yt-dlp imprime as duas linhas. Voltar a lista e tocar aquela
     mesma faixa deixa de custar outra extracao. */
  motor.urlVideo(info.id).then((r) => {
    if (!r || !r.ok) return;
    log("urlVideo adiantado: " + (r.doCache ? "cache" : r.ms + " ms"));
    /* A FONTE ENTRA NO ELEMENTO AGORA, escondida e pausada  (1.9.8)

       E a ideia que resolve de vez o "ouvi em audio, mudei para video e nao
       tocou": a fonte NUNCA e trocada no meio do caminho -- ela e posta uma
       vez, aqui, e o seletor so mostra ou esconde a janela.

       Com preload="metadata" isto custa o cabecalho do arquivo, e nao o
       video: os bytes de imagem so comecam a correr quando o elemento toca, e
       ele so toca quando voce escolhe VIDEO. */
    const v = vid();
    if (!v || !VIDEO || VIDEO.id !== info.id) return;
    try { v.src = r.url; v.load(); } catch (e) { log("video src: " + e); }
  }).catch(() => {});

  diz(txt("baixandoAudio") + " (" + tc(info.duracao) + ")...");
  const aud = await pegaAudio(url, info);
  if (!aud.ok) { partida("vazio", txt("naoLi") + aud.erro); return; }
  AUDIO_TEMP = aud.arquivo;
  if (!info.duracao && info.direct) {
    const probed = await motor.ffprobeDuracao(AUDIO_TEMP);
    if (probed > 0) {
      info.duracao = probed;
      VIDEO.duracao = probed;
      if (info.capabilities) info.capabilities.supportsTrim = true;
      ["btTudo", "pegaI", "pegaO"].forEach((id) => { const el = $(id); if (el) { el.disabled = false; el.title = ""; } });
      $("duracao").textContent = tc(probed);
      log("direct-file duration: ffprobe " + probed + "s");
    } else {
      log("direct-file duration: unavailable; trim disabled");
    }
  }
  preparaSom(AUDIO_TEMP);
  AGORA = 0;

  diz(txt("lendoOnda"));
  const onda = await motor.geraOnda(AUDIO_TEMP, info.duracao, 1500);
  if (!onda.ok) {
    // A onda e conveniencia, nao requisito: sem ela ainda da para cortar pelos
    // campos de tempo. Avisar e seguir e melhor que travar o fluxo.
    PICOS = [];
    diz(txt("semOnda") + onda.erro, "erro");
  } else {
    PICOS = onda.picos;
    diz(txt("pronto"), "ok");
  }

  F_IN = 0; F_OUT = 1;
  poeModo(false);   // video novo comeca inteiro
  $("linha").classList.remove("oculto");
  $("credito").classList.remove("oculto");

  partida("fora");
  ocupa(false);
  habilita(true);

  /* O BASTAO PASSA AQUI, com o painel ja montado na tela. Passar antes, logo
     depois do preparaSom, deixaria o som tocando durante a leitura da onda com
     a tela ainda no "analisando" -- e a barra da previa ja teria sumido, de
     novo sem nenhum botao para calar. */
  /* A caixa ja estava marcada quando voce mandou analisar? Entao a imagem
     entra agora, sem voce ter de desmarcar e marcar de novo. */
  if (FORMATO === "VIDEO") poeVideo(true);

  const daPrevia = await entregaPrevia(info.id);
  if (daPrevia > 0) {
    AGORA = daPrevia;
    $("agora").textContent = tcf(AGORA);
    tocaRelogio();
    pintaPlay();
  } else if (AUTOPLAY) {
    /* TOCAR SOZINHO  (1.9.11)

       So quando NAO houve passagem de bastao: se a previa estava tocando, o
       som ja esta correndo e mandar tocar de novo seria alternar o play --
       ou seja, PARAR a musica que acabou de ser entregue.

       Passa pelo alternaPlay, e nao por som().play() na mao: e ele quem sabe
       comecar do In quando ha trecho marcado, e quem acende o botao. Um
       segundo caminho para tocar seria um segundo lugar para esquecer disso. */
    try { alternaPlay(); } catch (e) { log("autoplay: " + e); }
  }

  desenha();
  pintaSelecao();
  // depois de dois segundos a linha volta a ser o canal: a confirmacao ja foi
  // lida, e o nome do artista e mais util dali em diante
  setTimeout(devolveCanal, 2200);
}

/* Devolve { pasta, aviso }. `aviso` vem preenchido quando o automatico nao
   deu certo e o download foi para a pasta manual -- silenciar isso faria o
   arquivo aparecer num lugar diferente do prometido, sem explicacao. */
function destinoDoDownload() {
  if (!AUTO_PASTA) return { pasta: PASTA, aviso: "" };
  if (!ponte)      return { pasta: PASTA, aviso: txt("autoCaiu") };

  const r = ponte.raizDoProjeto();
  if (!r.ok) { log("auto: " + r.erro); return { pasta: PASTA, aviso: txt("autoCaiu") }; }

  const d = ponte.pastaDeDestino(r.raiz, "audio", "Direct Download");
  if (!d.ok) { log("auto: " + d.erro); return { pasta: PASTA, aviso: txt("autoCaiu") }; }

  if (d.criou.length) log("auto: criei " + d.criou.join(" e "));
  log("auto: raiz " + r.raiz + " (" + r.metodo + ", " + r.pontos + " pontos, " + r.clipes + " clipes)");
  return { pasta: d.pasta, aviso: "" };
}

/* O que a tela de Ajustes mostra abaixo da caixa. Roda ao abrir e ao marcar,
   e nao no download: e ali que a pessoa quer conferir ANTES. */
function pintaAlvoAuto() {
  const el = $("autoAlvo");
  if (!el) return;
  const poe = (txto, cls) => { el.textContent = txto; el.className = "auto-alvo" + (cls ? " " + cls : ""); };

  if (!AUTO_PASTA)  return poe(txt("autoOff"), "");
  if (!ponte)       return poe(txt("autoSem"), "err");

  const r = ponte.raizDoProjeto();
  if (!r.ok)  return poe(txt("autoFalhou") + " (" + r.erro + ")", "err");

  // AQUI NAO SE CRIA NADA. A tela de Ajustes e para olhar; criar pasta a cada
  // vez que alguem abre os Ajustes encheria o projeto de pastas vazias.
  const alvos = ["AUDIO", "AUDIOS"];
  let achou = null;
  try {
    for (const f of fs.readdirSync(r.raiz)) {
      const cheio = path.join(r.raiz, f);
      try { if (!fs.statSync(cheio).isDirectory()) continue; } catch (e) { continue; }
      const norm = f.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (alvos.includes(norm)) { achou = cheio; break; }
    }
  } catch (e) {}
  const base = achou || path.join(r.raiz, "AUDIO");
  poe(path.join(base, "Direct Download") + (achou ? "" : "   (a criar)"), "ok");
}

// ---------------------------------------------------------------------------
// baixar
// ---------------------------------------------------------------------------
async function baixar() {
  if (!modulosOk()) return;
  if (!VIDEO || !AUDIO_TEMP) { diz(txt("colePrimeiro"), "erro"); return; }
  const dest = destinoDoDownload();
  if (!dest.pasta) { diz(txt("escolhaPasta"), "erro"); return; }
  if (!fs.existsSync(AUDIO_TEMP)) {
    diz(txt("sumiu"), "erro");
    return;
  }

  const ini = inicioSeg(), fim = fimSeg();
  const temTrecho = (fim - ini) > 0.05 && (fim - ini) < VIDEO.duracao - 0.05;
  const gerados = [];

  ocupa(true, txt("processando"));
  diz(temTrecho ? "Cortando " + tc(ini) + " a " + tc(fim) + "..." : "Convertendo...");

  /* O DOWNLOAD PASSA A DEIXAR RASTRO.

     Este bloco tinha treze diz() -- que escrevem na TELA -- e um unico log().
     Quando chegou o relato do Windows dizendo "o Resolve recusou o arquivo",
     o log nao tinha uma linha sequer sobre o download: nem o destino, nem o
     arquivo gerado, nem o que o Resolve respondeu. O diagnostico virou
     adivinhacao, e so saiu porque o bug foi reproduzido no mac.

     A regra que fica: o que aparece na tela e para a pessoa; o que vai para o
     log e para quem for consertar. Sao publicos diferentes e nao se
     substituem. */
  log("baixar: destino=" + dest.pasta + (dest.criou ? " (recem-criada)" : "")
      + "  baixando=" + FORMATO + " (" + FMT_AUDIO + ")"
      + (temTrecho ? "  trecho=" + ini.toFixed(2) + "-" + fim.toFixed(2) : "  inteiro"));

  /* EM VIDEO, O AUDIO SEPARADO NAO E GERADO  (1.9.9)

     O arquivo de video ja tem o som dentro. Exportar um WAVE junto colocava
     DOIS clipes no Media Pool para o mesmo material, e o segundo so atrapalha:
     na hora de arrastar para a timeline sao duas linhas parecidas, e escolher
     a errada so aparece depois.

     Em AUDIO nada muda -- e o caminho de sempre. */
  const soVideo = FORMATO === "VIDEO";
  const corte = soVideo ? { ok: true, arquivo: "" } : await motor.corta(
    AUDIO_TEMP,
    temTrecho ? ini : null,
    temTrecho ? fim : null,
    FMT_AUDIO, dest.pasta, VIDEO.titulo
  );
  if (!corte.ok) {
    ocupa(false);
    log("corta: FALHOU — " + corte.erro);
    diz(txt("falhou") + corte.erro, "erro");
    return;
  }
  /* O TAMANHO VAI JUNTO. Um arquivo de zero byte e o sintoma de um ffmpeg que
     "terminou bem" sem escrever nada -- e ai o Resolve recusa sem explicar o
     porque, e a culpa parece ser dele. */
  let tamGerado = "?";
  if (!soVideo) {
    try { tamGerado = fs.statSync(corte.arquivo).size + " bytes"; } catch (e) {}
    log("corta: ok — " + corte.arquivo + "  (" + tamGerado + ")");
    gerados.push(corte.arquivo);
  } else {
    log("corta: pulado — em VIDEO o som ja vai dentro do arquivo de video");
  }

  /* A ONDA VIRA ARRASTAVEL AQUI (1.8.7), e nao depois da importacao.

     O arquivo existe no disco, com o trecho ja aplicado -- e isso basta para
     arrastar. Amarrar ao Media Pool deixaria o gesto de fora justamente
     quando ele mais serve: se o Resolve recusar a importacao, arrastar a mao
     e a saida que sobra. */
  if (!soVideo) poeArrastavel(corte.arquivo);

  if (soVideo) {
    diz(txt("baixandoVideo"));
    const vid = VIDEO.direct
      ? await motor.baixaVideoDireto(VIDEO.sourceUrl, VIDEO.id, temTrecho ? ini : null,
          temTrecho ? fim : null, dest.pasta, VIDEO.titulo, progresso)
      : await motor.baixaVideo($("link").value.trim(), temTrecho ? ini : null,
          temTrecho ? fim : null, ALTURA, dest.pasta, VIDEO.titulo, progresso);
    if (vid.ok) {
      gerados.push(vid.arquivo);
      /* O QUE SE ARRASTA E O VIDEO. Em VIDEO nao ha WAVE, e deixar o arraste
         apontando para o arquivo anterior entregaria outra musica na timeline
         -- e o mesmo motivo do poeArrastavel(null) dentro do paraTudo. */
      poeArrastavel(vid.arquivo);
    } else {
      /* Aqui NAO ha audio salvo para consolar: em VIDEO o video E o resultado.
         Falhando ele, nada foi gerado. */
      diz(txt("videoFalhou") + vid.erro, "erro");
    }
  }

  diz(txt("importando"));
  log("importaNoMediaPool: entregando " + gerados.length + " arquivo(s): " + gerados.join(" | "));
  const imp = ponte.importaNoMediaPool(gerados);
  log("importaNoMediaPool: ok=" + imp.ok
      + "  jaEstava=" + (imp.jaEstava === true)
      + "  itens=" + (imp.itens ? imp.itens.length : 0)
      + (imp.erro ? "  erro=" + imp.erro : ""));
  ocupa(false);

  const nomes = gerados.map((g) => path.basename(g)).join(", ");
  /* TRES DESFECHOS, e nao dois. O terceiro -- "ja estava la" -- era tratado
     como erro e dizia "o Resolve recusou o arquivo". Agora ele tem frase
     propria: a pessoa precisa saber que nada foi duplicado no projeto dela. */
  if (imp.ok && imp.jaEstava) diz(txt("jaNoPool") + nomes, "ok");
  else if (imp.ok) diz(txt("noPool") + nomes, "ok");
  else diz(nomes + txt("poolRecusou") + imp.erro, "erro");

  /* INSERIR NA TIMELINE, se pedido.

     So depois de o Media Pool aceitar: sem MediaPoolItem nao ha o que inserir.

     O QUE ENTRA E O QUE FOI BAIXADO, e nao "o audio".  (1.9.13)

     Ate a 1.9.12 esta chamada era de audio nos dois modos, em dois lugares ao
     mesmo tempo: o mediaType: 2 la na ponte, e o nome vindo do corte.arquivo
     -- que em VIDEO e string vazia. O resultado era um mp4 entrando na
     timeline como faixa de audio, e sem guarda anti-duplicata: basename("")
     nunca casa com nome de clipe nenhum. Um bug, dois defeitos. */
  if (imp.ok && imp.itens && imp.itens.length && $("chkTimeline") && $("chkTimeline").checked) {
    const dur = fimSeg() - inicioSeg();
    const arqTL = soVideo ? (gerados[0] || "") : corte.arquivo;
    const ins = ponte.insereNaTimeline(imp.itens[0], dur, path.basename(arqTL), soVideo);
    if (ins.ok) {
      log("timeline: inserido na trilha " + ins.rot + ins.trilha);
      setTimeout(() => diz(txt("naTrilha") + ins.rot + ins.trilha, "ok"), 900);
    } else {
      // NAO e falha do download: o arquivo esta salvo e no Media Pool. Dizer
      // so "falhou" faria a pessoa repetir tudo por nada.
      log("timeline: " + ins.erro);
      setTimeout(() => diz(txt("timelineNao") + ins.erro, "erro"), 900);
    }
  }
  // o aviso vem DEPOIS e fica: saber onde o arquivo caiu vale mais que a
  // confirmacao de que ele foi importado, que voce ja ve no Media Pool
  if (dest.aviso) setTimeout(() => diz(dest.aviso, "erro"), 2400);

  atualizaProjeto();
}

// ---------------------------------------------------------------------------
// ajustes
// ---------------------------------------------------------------------------
function abreAjustes() {
  // A tela de Ajustes abre SEMPRE, mesmo com modulo faltando: e justamente
  // nela que se descobre o que faltou.
  $("telaAjustes").classList.remove("oculto");
  try { pintaDiagnostico(); } catch (e) { log("pintaDiagnostico: " + e); }
  try { pintaBinarios(); }   catch (e) { log("pintaBinarios: " + e); }
  try { pintaAlvoAuto(); }   catch (e) { log("pintaAlvoAuto: " + e); }
  mostraVersaoMotor();
}

function pintaDiagnostico() {
  if (!ponte) {
    const st = $("statusResolve");
    st.textContent = "ponte.js nao carregou — o plugin nao consegue falar com o Resolve";
    st.className = "status erro";
    return;
  }
  ponte.carregaWI();
  const d = ponte.diagnostico();
  const st = $("statusResolve");
  if (d.conectado) {
    st.textContent = txt("conectado") + " — " + (d.projeto ? txt("projeto") + d.projeto : txt("semProjeto"));
    st.className = "status ok";
  } else {
    st.textContent = txt("naoConectado");
    st.className = "status erro";
  }

  /* A LISTA DOS CAMINHOS separa tres problemas que na tela pareciam o mesmo:
       nao existe            -> Resolve gratuito, ou caminho fora da lista
       existe e nao carregou -> binario de outra plataforma
       carregou e recusou    -> Resolve fechado, ou recusou o plugin */
  const cx = $("caminhosWI");
  cx.textContent = "";
  for (const t of d.tentados) {
    const div = document.createElement("div");
    if (t.erro)        { div.className = "falhou"; div.textContent = "x " + t.caminho + "  — " + t.erro; }
    else if (t.existe) { div.className = "sim";    div.textContent = "v " + t.caminho; }
    else               { div.className = "nao";    div.textContent = ". " + t.caminho; }
    cx.appendChild(div);
  }
}

function pintaBinarios() {
  const st = $("statusBin");
  if (!motor) {
    st.textContent = "motor.js nao carregou — sem yt-dlp e sem ffmpeg";
    st.className = "status erro";
    return;
  }
  const t = motor.temBinarios();
  if (t.ok) {
    st.textContent = "yt-dlp, ffmpeg e deno encontrados em " + t.pasta;
    st.className = "status ok";
  } else {
    st.textContent = "Faltando: " + t.falta.join(", ") + " — rode o PREPARAR_BINARIOS";
    st.className = "status erro";
  }
}

/* A barra de status saiu, entao o nome do projeto nao tem mais onde aparecer
   de forma permanente. Ele continua sendo consultado na tela de Ajustes, que
   e onde alguem vai procurar quando desconfiar da conexao. */
function atualizaProjeto() { /* sem barra de status: nada a pintar */ }

/* CORE ENGINE — o mesmo mecanismo do BlackSlice.

   O botao muda de cor como la: azul enquanto trabalha, verde quando termina
   bem. E o texto conta o passo, porque um download de 30 MB com o botao mudo
   parece travado. */
/* O ROTULO MORA NUM <span>, E NAO NO BOTAO  (2.1.2).

   O botao ganhou o icone do BlackSlice ao lado do texto. `bt.textContent = x`
   substitui TODOS os filhos -- o <svg> junto -- e o icone sumiria no primeiro
   passo do update, para nunca mais voltar naquela sessao. Escrever no span
   deixa o irmao em paz. */
function rotuloUpdate(bt, texto) {
  const alvo = bt.querySelector("span") || bt;
  alvo.textContent = texto;
}

/* UM SO CAMINHO PARA OS DOIS BOTOES  (2.1.2). O update existe nos Ajustes e na
   janela de destravar, e sao o mesmo trabalho: um segundo corpo de funcao seria
   o que envelhece sozinho quando um dos dois for mexido. */
async function atualizaMotor(idBt, idSt, aoTerminar) {
  if (!motor) return;
  const bt = $(idBt || "btUpdate");
  const st = $(idSt || "statusUpdate");
  bt.disabled = true;
  bt.classList.remove("pronto");
  rotuloUpdate(bt, txt("atualizando"));
  st.textContent = "";
  st.className = "status";

  const r = await motor.atualizaMotor((passo) => {
    rotuloUpdate(bt, passo.toUpperCase());
    log("update: " + passo);
  });

  bt.disabled = false;
  if (r.ok) {
    rotuloUpdate(bt, txt("atualizado"));
    bt.classList.add("pronto");
    /* OS DOIS LUGARES QUE MOSTRAM A VERSAO sao repintados juntos. Se so um
       fosse, abrir o outro depois do update mostraria a versao velha -- e a
       pessoa concluiria que o update nao funcionou. */
    $("verMotor").textContent = "v" + r.versao;
    if ($("verMotorBloq")) $("verMotorBloq").textContent = "v" + r.versao;
    st.textContent = "yt-dlp " + r.versao + " em " + r.caminho;
    st.className = "status ok";
    log("update ok: " + r.versao + " -> " + r.caminho);
    if (aoTerminar) await aoTerminar();
  } else {
    /* O ROTULO VOLTA A SER O DELE, e nao um "UPDATE" para os dois  (2.3.3).

       Os dois botoes chamam esta funcao, e desde a 2.3.3 eles dizem coisas
       diferentes: nos Ajustes e "UPDATE ENGINE", porque o titulo que explicava
       o que se atualiza saiu de cima dele; na janela de destravar continua
       "UPDATE", porque ali o texto ao lado ja diz.

       Sem esta linha, um update que falhasse renomearia o botao dos Ajustes
       para "UPDATE" e ele ficaria assim ate a proxima abertura -- um botao que
       muda de nome sozinho, e so depois de um erro. */
    rotuloUpdate(bt, txt(bt.dataset.rotulo || "update"));
    st.textContent = r.erro;
    st.className = "status erro";
    log("update falhou: " + r.erro);
  }
}

/* A versao aparece ANTES de alguem apertar o botao: e ela que responde a
   pergunta "preciso atualizar?". Perguntar ao binario custa uns milissegundos
   e e a unica fonte que nao mente. */
async function mostraVersaoMotor() {
  if (!motor) return;
  try {
    const v = await motor.versaoDoMotor();
    const t = v ? "v" + v : "nao achei o yt-dlp";
    $("verMotor").textContent = t;
    // a janela de destravar mostra a mesma linha, e pelo mesmo motivo: e ela
    // que responde "preciso atualizar?" antes de alguem apertar o botao
    if ($("verMotorBloq")) $("verMotorBloq").textContent = t;
  } catch (e) { log("versaoDoMotor: " + e); }
}

// ---------------------------------------------------------------------------
// arranque
// ---------------------------------------------------------------------------
function inicia() {
  $("versao").textContent = ipcRenderer.sendSync("dd-version");

  const pastas = ipcRenderer.sendSync("dd-pastas");
  PASTA = pastas.musica || pastas.downloads || null;
  try { AUTO_PASTA = localStorage.getItem("dd_auto") === "1"; } catch (e) {}
  if ($("chkAuto")) $("chkAuto").checked = AUTO_PASTA;
  try { ALTURA = localStorage.getItem("dd_qualidade") || "max"; } catch (e) {}
  if ($("selQualidade")) $("selQualidade").value = ALTURA;
  /* Os cookies entram no motor ANTES de qualquer chamada: se a primeira
     consulta sair sem eles, ela ja leva o bloqueio que a opcao existe para
     evitar. */
  try { AUTOPLAY = localStorage.getItem("dd_auto_play") !== "0"; } catch (e) {}
  if ($("chkAutoPlay")) {
    $("chkAutoPlay").checked = AUTOPLAY;
    $("chkAutoPlay").addEventListener("change", (ev) => {
      AUTOPLAY = !!ev.target.checked;
      try { localStorage.setItem("dd_auto_play", AUTOPLAY ? "1" : "0"); } catch (e) {}
    });
  }

  let cook = "";
  try { cook = localStorage.getItem("dd_cookies") || ""; } catch (e) {}
  try { motor.poeCookies(cook); } catch (e) {}
  if ($("selCookies")) {
    $("selCookies").value = cook;
    $("selCookies").addEventListener("change", (ev) => {
      const v = ev.target.value || "";
      try { motor.poeCookies(v); } catch (e) {}
      try { localStorage.setItem("dd_cookies", v); } catch (e) {}
      log("cookies do navegador: " + (v || "nenhum"));
    });
  }
  try { FMT_AUDIO = localStorage.getItem("dd_fmt_audio") || "WAVE"; } catch (e) {}
  if (FMT_AUDIO !== "MP3") FMT_AUDIO = "WAVE";
  if ($("selFormatoAudio")) {
    $("selFormatoAudio").value = FMT_AUDIO;
    $("selFormatoAudio").addEventListener("change", (ev) => {
      FMT_AUDIO = ev.target.value === "MP3" ? "MP3" : "WAVE";
      try { localStorage.setItem("dd_fmt_audio", FMT_AUDIO); } catch (e) {}
      pintaRotulo();
    });
  }
  try { if ($("chkTimeline")) $("chkTimeline").checked = localStorage.getItem("dd_tl") === "1"; } catch (e) {}
  $("pastaDestino").value = PASTA || "(escolha uma pasta)";

  /* COLAR CARREGA. Sem botao Analisar.

     O listener e no DOCUMENTO, e nao no campo: assim o Cmd+V funciona com o
     foco em qualquer lugar do painel, que e como a pessoa usa -- copia o link
     no navegador, clica no painel e cola.

     Quando o foco JA esta no campo, o navegador tambem faz a colagem dele.
     Por isso o texto vem do proprio evento e e escrito no campo por nos: fazer
     os dois caminhos convergirem evita o link entrar duplicado. */
  document.addEventListener("paste", (ev) => {
    if (OCUPADO) return;
    let txt = "";
    try { txt = (ev.clipboardData || window.clipboardData).getData("text") || ""; } catch (e) {}
    txt = txt.trim();
    if (!txt) return;
    if (!/^https?:\/\//i.test(txt)) return;   // so link; texto solto nao dispara
    ev.preventDefault();
    /* COLAR UM LINK COM A BUSCA ABERTA FECHA A BUSCA (1.8.8).

       Este teste nao e um detalhe de arrumacao: sem ele o analisar() liga
       .na-partida enquanto .buscando continua ligada, e o CSS da busca esconde
       a tela de partida -- o painel ficaria numa janela sem nada dentro,
       analisando um video que a pessoa nao ve.

       O filtro de https:// logo acima ja garante que termo de busca digitado ou
       colado nao chega ate aqui. So link chega, e link nao e busca. */
    if (buscaAberta()) fechaBusca();
    $("link").value = txt;
    log("colado: " + txt.slice(0, 80));
    // PARAR ANTES DE TROCAR. Sem isto o audio anterior continua tocando por
    // cima do carregamento do novo -- e, pior, o arquivo temporario que ele
    // esta lendo e justamente o que pode ser apagado no meio do caminho.
    paraTudo();
    analisar();
  });

  // Enter no campo tambem serve, para quem digitar ou editar o link.
  $("link").addEventListener("keydown", (ev) => { if (ev.key === "Enter") analisar(); });
  $("btDownload").addEventListener("click", baixar);
  $("btTudo").addEventListener("click", alternaModo);
  $("btStop").addEventListener("click", parar);

  /* ---- a faixa de versao nova ---- */
  try { UPD_DISPENSADA = localStorage.getItem("dd_upd_nao") || ""; } catch (e) {}
  $("upd-ver").addEventListener("click", () => {
    const ul = $("upd-lista");
    ul.hidden = !ul.hidden;
    $("upd-ver").textContent = ul.hidden ? txt("oQueMudou") : txt("fechar");
    reAltura();
  });
  $("upd-baixar").addEventListener("click", () => {
    /* Abre a pagina DO SISTEMA da pessoa, que ja dispara o download e ja
       explica o aviso de "app nao assinado". Mandar para a pagina do produto
       obrigaria a escolher a plataforma que o proprio plugin conhece. */
    const base = (NOVA_INFO && NOVA_INFO.pagina) || "https://caixinhadoeditor.com/directdownload/";
    const win = process.platform === "win32";
    ipcRenderer.send("dd-open-external", base.replace(/\/?$/, "/") + (win ? "windows/" : "macos/"));
    fechaFaixa();
  });
  $("upd-depois").addEventListener("click", () => {
    UPD_DISPENSADA = (NOVA_INFO && NOVA_INFO.versao) || "";
    try { localStorage.setItem("dd_upd_nao", UPD_DISPENSADA); } catch (e) {}
    fechaFaixa();
  });

  /* Depois do painel montar, e nao junto: a rede nao pode atrasar o boot. */
  setTimeout(() => { verificaVersao().catch((e) => log("verificaVersao: " + e)); }, 2500);
  $("chkTimeline").addEventListener("change", (ev) => {
    try { localStorage.setItem("dd_tl", ev.target.checked ? "1" : "0"); } catch (e) {}
  });

  $("btPlay").addEventListener("click", alternaPlay);
  $("vol").addEventListener("input", () => poeVolume($("vol").value));
  $("btMute").addEventListener("click", alternaMudo);
  if ($("previaVol")) $("previaVol").addEventListener("input", () => poeVolume($("previaVol").value));
  if ($("btPreviaMudo")) $("btPreviaMudo").addEventListener("click", alternaMudo);
  /* O volume guardado entra ANTES do primeiro pintaVolume, senao o painel
     abriria em 80 e so mudaria quando alguem encostasse na regua. */
  try {
    const g = localStorage.getItem(VOL_GUARDA);
    if (g !== null && g !== "") { $("vol").value = String(Math.max(0, Math.min(100, Number(g) || 0))); }
  } catch (e) {}
  pintaVolume();
  // As setas com barra pulam 1s (o stepFrame do BlackSlice anda um quadro; em
  // audio o equivalente util e o segundo). Os grupos de -10/-5/-1 e +1/+5/+10
  // vem do data-pula, para nao repetir seis listeners quase iguais.
  $("btVolta").addEventListener("click", () => pula(-1));
  $("btFrente").addEventListener("click", () => pula(1));
  document.querySelectorAll("[data-pula]").forEach((b) => {
    b.addEventListener("click", () => pula(Number(b.dataset.pula)));
  });
  // Botao e tecla chamam a MESMA funcao: dois caminhos para a mesma acao e
  // como um deles fica para tras numa correcao futura.
  $("btIn").addEventListener("click", marcaIn);
  $("btOut").addEventListener("click", marcaOut);

  /* ATALHOS.

     Todos ignorados quando o cursor esta num campo de texto: ali as teclas sao
     texto, e roubar o "i" de quem digita um link seria pior que nao ter
     atalho nenhum. A lista completa vive na tela do icone de teclado. */
  document.addEventListener("keydown", (ev) => {
    const alvo = ev.target && ev.target.tagName;
    if (alvo === "INPUT" || alvo === "TEXTAREA") return;

    // Cmd+Enter baixa, e vale mesmo sem video para dar a mensagem certa.
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); baixar(); return; }
    if (ev.metaKey || ev.ctrlKey) return;   // o resto e do sistema (Cmd+V etc)
    if (!VIDEO) return;

    switch (ev.code) {
      case "Space":      ev.preventDefault(); alternaPlay(); break;
      case "KeyI":       ev.preventDefault(); marcaIn(); break;
      case "KeyO":       ev.preventDefault(); marcaOut(); break;
      /* AS SETAS ANDAM QUADRO A QUADRO; COM SHIFT, DE SEGUNDO EM SEGUNDO
         (1.9.12)

         E a mao de quem edita: a seta sozinha e o ajuste fino -- achar o
         ataque exato de uma nota, o quadro em que a palavra comeca -- e o
         Shift e o passo largo, para percorrer.

         Elas andavam 1 segundo as duas, e ai nao havia ajuste fino nenhum
         pelo teclado: para mover menos que um segundo so arrastando na onda,
         com a mira que o arraste tem.

         O QUADRO E 1/30, e nao a taxa do video: o painel nao sabe a taxa
         real -- o yt-dlp nao a entrega na consulta -- e o timecode da tela ja
         conta em 30 desde sempre. Se as setas andassem por uma taxa e o
         timecode contasse por outra, o numero na tela pularia de dois em dois
         ou repetiria, e a culpa pareceria do timecode. Melhor um passo que
         casa com o que se le. */
      case "ArrowLeft":  ev.preventDefault(); pula(ev.shiftKey ? -1 : -1 / FPS); break;
      case "ArrowRight": ev.preventDefault(); pula(ev.shiftKey ?  1 :  1 / FPS); break;
      /* A alterna o modo, como o botao. Aqui chamava selecionaTudo(), que
         deixou de existir quando o botao virou interruptor -- e a chamada
         morta so estourava quando alguem apertava a tecla, dentro de um
         handler, sem nada na tela. node --check nao pega isto: e sintaxe
         valida. Ver a verificacao em testes/t3.js. */
      case "KeyA":       ev.preventDefault(); alternaModo(); break;
      case "KeyK":       ev.preventDefault(); parar(); break;
      case "Equal":      ev.preventDefault(); poeZoom(ZOOM * 1.5, 0.5); break;
      case "Minus":      ev.preventDefault(); poeZoom(ZOOM / 1.5, 0.5); break;
      case "Digit0":     ev.preventDefault(); ajustaTudo(); break;
    }
  });

  document.querySelectorAll(".seletor").forEach((sel) => {
    sel.querySelectorAll(".op").forEach((op) => {
      op.addEventListener("click", () => {
        sel.querySelectorAll(".op").forEach((o) => o.classList.toggle("op-on", o === op));
        if (op.dataset.fmt) {
          FORMATO = op.dataset.fmt;
          /* A IMAGEM SEGUE O SELETOR, e a fonte do video NAO e trocada aqui:
             ela ja foi carregada quando o endereco chegou. Isto e mostrar ou
             esconder, e e imediato. */
          poeVideo(FORMATO === "VIDEO");
          pintaRotulo();
        }
        if (op.dataset.alt) ALTURA = op.dataset.alt;
        pintaRotulo();
      });
    });
  });

  /* O listener da caixa "Video" saiu com ela: quem responde agora e o
     seletor AUDIO|VIDEO, tratado no bloco do #selFormato acima. */

  /* O PIN NASCE LIGADO.

     O painel vive dentro do Resolve, e o gesto normal e clicar na timeline
     para procurar o ponto e voltar aqui. Sem o "sempre no topo" ele some
     atras da janela do Resolve no primeiro clique, e a pessoa acha que
     fechou. A escolha fica guardada -- desligar uma vez basta.

     O send() inicial NAO e opcional: a classe visual e o estado real da
     janela sao duas coisas, e pintar o botao sem avisar o main deixaria o
     botao aceso com a janela solta. */
  let fixado = true;
  try { fixado = localStorage.getItem("dd_pin") !== "0"; } catch (e) {}
  ipcRenderer.send("dd-pin", fixado);
  $("btPin").classList.toggle("ligado", fixado);

  $("btPin").addEventListener("click", () => {
    fixado = !fixado;
    ipcRenderer.send("dd-pin", fixado);
    $("btPin").classList.toggle("ligado", fixado);
    try { localStorage.setItem("dd_pin", fixado ? "1" : "0"); } catch (e) {}
  });

  /* O BOTAO DA PASTA: clique abre, botao direito configura.

     Ele abre ONDE O ARQUIVO FOI PARAR, e nao a pasta dos Ajustes. Com o
     automatico ligado os dois sao lugares diferentes, e abrir o errado e o
     mesmo que nao abrir nada. */
  function pastaReal() {
    if (!AUTO_PASTA || !ponte) return PASTA;
    const r = ponte.raizDoProjeto();
    if (!r.ok) return PASTA;
    const d = ponte.pastaDeDestino(r.raiz, "audio", "Direct Download");
    return d.ok ? d.pasta : PASTA;
  }

  async function menuDaPasta() {
    const alvo = pastaReal();
    const acao = await ipcRenderer.invoke("dd-menu-pasta", {
      abrir: txt("mnAbrir"),
      escolher: txt("mnEscolher"),
      seguir: txt("seguirProjeto"),
      auto: AUTO_PASTA,
      alvo: alvo || "",
    });
    if (acao === "abrir") { ipcRenderer.send("dd-reveal", alvo); return; }
    if (acao === "auto") {
      AUTO_PASTA = !AUTO_PASTA;
      try { localStorage.setItem("dd_auto", AUTO_PASTA ? "1" : "0"); } catch (e) {}
      if ($("chkAuto")) $("chkAuto").checked = AUTO_PASTA;
      pintaAlvoAuto();
      diz(AUTO_PASTA ? txt("autoLigado") : txt("autoDesligado"), "ok");
      return;
    }
    if (acao === "escolher") await escolhePasta();
  }

  /* ESCOLHER A PASTA — UM LUGAR SO  (1.8.9)

     Isto morava dentro do menuDaPasta, e saiu de la quando a tela limpa ganhou
     o proprio botao de pasta. Copiar as onze linhas para o botao novo seria o
     comeco de duas versoes da mesma coisa: a proxima correcao entraria numa
     so, e o outro caminho seguiria com o defeito. */
  async function escolhePasta() {
    const p = await ipcRenderer.invoke("dd-escolher-pasta");
    if (!p) return null;
    PASTA = p;
    if ($("pastaDestino")) $("pastaDestino").value = p;
    /* ESCOLHER A MAO DESLIGA O AUTOMATICO. Sem isto a pessoa aponta uma
       pasta, o arquivo cai noutra, e a escolha parece nao ter funcionado --
       a interface teria aceitado uma ordem que nao ia cumprir. */
    if (AUTO_PASTA) {
      AUTO_PASTA = false;
      try { localStorage.setItem("dd_auto", "0"); } catch (e) {}
      if ($("chkAuto")) $("chkAuto").checked = false;
      pintaAlvoAuto();
    }
    diz(txt("pastaAgora") + p, "ok");
    pintaPastaPartida();
    return p;
  }

  /* A LINHA "ONDE VAI CAIR" APARECE E SOME  (1.8.10)

     Na 1.8.9 ela ficava na tela o tempo todo, e sujava a tela limpa: um caminho
     de projeto tem oitenta caracteres e disputava atencao com as tres coisas
     que a tela existe para dizer -- o icone, o "Cole um link" e a dica.

     TIRA-LA POR COMPLETO SERIA PIOR, e por um motivo concreto: o aviso de
     "pasta agora e X" vai para a linha do canal, que mora dentro da #ficha e
     esta ESCONDIDA na tela limpa. Sem esta linha, clicar na pasta, escolher uma
     e voltar nao mudaria NADA na tela -- e um botao que nao responde parece um
     botao quebrado.

     Entao ela aparece por quatro segundos e sai. Confirma a escolha, e nao fica
     morando ali.

     Le do pastaReal(), e nao da variavel PASTA: com o "seguir o projeto"
     ligado, o destino de verdade e a pasta do projeto aberto no Resolve, e nao
     a dos Ajustes. Mostrar PASTA ali seria a tela anunciando um caminho e o
     arquivo caindo noutro. */
  let RELOGIO_PASTA = null;

  function escondePastaPartida() {
    if (RELOGIO_PASTA) { clearTimeout(RELOGIO_PASTA); RELOGIO_PASTA = null; }
    if ($("pPasta")) $("pPasta").classList.add("oculto");
  }

  function pintaPastaPartida() {
    const linha = $("pPasta"), txto = $("pPastaTxt");
    if (!linha || !txto) return;
    let alvo = "";
    try { alvo = pastaReal() || ""; } catch (e) { alvo = PASTA || ""; }
    if (!alvo) { escondePastaPartida(); return; }

    txto.textContent = alvo;
    linha.classList.remove("oculto");

    /* O relogio anterior morre antes de comecar o novo. Escolher duas pastas
       seguidas deixaria dois relogios: o primeiro venceria no meio da segunda
       confirmacao e apagaria a linha antes da hora. */
    if (RELOGIO_PASTA) clearTimeout(RELOGIO_PASTA);
    RELOGIO_PASTA = setTimeout(() => {
      RELOGIO_PASTA = null;
      if ($("pPasta")) $("pPasta").classList.add("oculto");
    }, 4000);
  }
  PINTA_PASTA_PARTIDA = escondePastaPartida;

  $("btPasta").addEventListener("click", () => ipcRenderer.send("dd-reveal", pastaReal()));
  $("btPasta").addEventListener("contextmenu", (ev) => { ev.preventDefault(); menuDaPasta(); });

  /* A PASTA DA TELA LIMPA  (1.8.9)

     O botao direito abre O MESMO menu da barra de baixo -- de proposito: um
     icone que abre menus diferentes em dois lugares e pior que um icone a
     mais. So o clique ESQUERDO difere, e isso tem motivo: la embaixo ja existe
     um arquivo baixado, e abrir a pasta e o que se quer; aqui ainda nao ha
     nada, e o que se quer e apontar onde vai cair. */
  $("btPastaPartida").addEventListener("click", () => { escolhePasta(); });
  $("btPastaPartida").addEventListener("contextmenu", (ev) => { ev.preventDefault(); menuDaPasta(); });

  /* SEGURAR TAMBEM ABRE O MENU. E o gesto do macOS, e serve a quem usa trackpad
     sem clique secundario configurado. O timer morre no mouseup e no mouseleave
     -- sem o segundo, arrastar o cursor para fora abriria o menu do mesmo jeito,
     meio segundo depois, sem nada sob o dedo. */
  (function () {
    let t = null;
    const cancela = () => { if (t) { clearTimeout(t); t = null; } };
    $("btPasta").addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      cancela();
      t = setTimeout(() => { t = null; menuDaPasta(); }, 500);
    });
    ["mouseup", "mouseleave"].forEach((e) => $("btPasta").addEventListener(e, cancela));
  })();

  $("selQualidade").addEventListener("change", (ev) => {
    ALTURA = ev.target.value || "max";
    try { localStorage.setItem("dd_qualidade", ALTURA); } catch (e) {}
  });

  $("chkAuto").addEventListener("change", (ev) => {
    AUTO_PASTA = !!ev.target.checked;
    try { localStorage.setItem("dd_auto", AUTO_PASTA ? "1" : "0"); } catch (e) {}
    pintaAlvoAuto();
  });
  /* AS DUAS LUPAS CHAMAM A MESMA FUNCAO. Sao dois botoes porque sao dois
     lugares na tela, e nao dois comportamentos. */
  $("btLupa").addEventListener("click", abreBusca);
  $("btLupaPartida").addEventListener("click", abreBusca);
  $("btBuscaFechar").addEventListener("click", fechaBusca);
  ligaPrevia();
  ligaVideo();
  /* UM LISTENER SO para as tres teclas.

     Enter faz duas coisas, e qual delas depende de haver uma linha em foco:
     sem foco ele BUSCA, com foco ele ESCOLHE. A seta para baixo e o que move
     esse foco, entao a ordem e sempre buscar -> descer -> escolher.

     Escrever isso como dois addEventListener (um deles em captura) foi a
     primeira versao, e estava errada: preventDefault nao para a propagacao, os
     dois rodavam, e Enter com foco escolhia o video E refazia a busca. */
  $("buscaCampo").addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); focaBusca(BUSCA_FOCO + 1); return; }
    if (ev.key === "ArrowUp")   { ev.preventDefault(); focaBusca(BUSCA_FOCO - 1); return; }
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    if (BUSCA_FOCO >= 0) escolheBusca(BUSCA_FOCO);
    else                 fazBusca();
  });

  /* Digitar solta o foco da lista E agenda a busca (1.8.9).

     Soltar o foco vem primeiro, e nao e detalhe: sem isto, quem desce ate o
     quinto resultado, muda o termo e aperta Enter abriria o quinto resultado
     da busca ANTERIOR -- e o campo na tela mostraria outra coisa. */
  $("buscaCampo").addEventListener("input", () => {
    if (BUSCA_FOCO >= 0) {
      BUSCA_FOCO = -1;
      [...$("buscaLista").children].forEach((li) => li.classList.remove("foco"));
    }
    agendaBusca();
  });

  $("btAtalhos").addEventListener("click", () => $("telaAtalhos").classList.remove("oculto"));
  $("btFecharAtalhos").addEventListener("click", () => $("telaAtalhos").classList.add("oculto"));
  /* O `() =>` NAO e enfeite: passar `abreAjustes` direto entrega o EVENTO como
     primeiro argumento, e o parametro `secao` receberia um MouseEvent. Hoje
     isso so falharia no `=== "cookies"`, mas e a classe de bug que aparece
     meses depois, quando alguem acrescenta um segundo uso do parametro. */
  $("btAjustes").addEventListener("click", () => abreAjustes());
  /* DESTRAVAR, na tela inicial (2.1.2). Abre a MESMA janela que aparece
     sozinha no bloqueio -- sem o paragrafo do que aconteceu, porque aqui nao
     aconteceu nada. */
  $("btDestrava").addEventListener("click", () => abreBloqueio(false));

  /* OS BOTOES DO DIALOGO DO BLOQUEIO  (2.1.2) */
  $("btFecharBloq").addEventListener("click", fechaBloqueio);
  $("btAgoraNao").addEventListener("click", () => { BLOQ_CALADO = true; fechaBloqueio(); });

  $("btFecharAjustes").addEventListener("click", () => $("telaAjustes").classList.add("oculto"));
  $("btUpdate").addEventListener("click", () => atualizaMotor());

  /* Mexer no seletor NAO aplica sozinho: quem aplica e o botao ao lado, que
     aparece justamente quando ha diferenca entre o escolhido e o em uso. */
  $("selCookiesBloq").addEventListener("change", pintaUsarCookies);

  $("btUsarCookies").addEventListener("click", async () => {
    const nav = $("selCookiesBloq").value;
    /* ESCREVE NO CAMPO DOS AJUSTES E DISPARA O MESMO EVENTO DA ESCOLHA A MAO.

       Escrever em `.value` nao avisa ninguem: quem grava no localStorage e
       avisa o motor e o listener de `change` do outro seletor, e ele nao roda
       sozinho. Sem o dispatch, o painel usaria os cookies nesta sessao e
       esqueceria tudo ao fechar -- e os Ajustes mostrariam "Nenhum" enquanto o
       download funcionava. */
    $("selCookies").value = nav;
    $("selCookies").dispatchEvent(new Event("change"));
    log("destravar: cookies do " + (nav || "nenhum"));
    pintaUsarCookies();
    if (!BLOQ_ULTIMO_LINK && !$("link").value) return;   // aberta sem link: so grava
    fechaBloqueio();
    partida("analisando");
    await tentaDeNovo();
  });

  $("btUpdateBloq").addEventListener("click", () =>
    atualizaMotor("btUpdateBloq", "statusBloq", async () => {
      /* Só depois de dar certo, e só se houver o que tentar. */
      if (!BLOQ_ULTIMO_LINK && !$("link").value) return;
      fechaBloqueio();
      partida("analisando");
      await tentaDeNovo();
    }));

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!buscaAberta()) return;
    fechaBusca();
  });
  /* NAO ha stopPropagation aqui, e a tentacao de por um foi real. Ele nao
     funcionaria: os tres listeners estao no MESMO document, e entre listeners
     do mesmo elemento so o stopImmediatePropagation corta. Quem protege sao os
     `if (buscaAberta()) return` nos outros dois -- explicitos, e visiveis de
     dentro do listener que eles protegem. */

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    /* QUEM ESTA DIGITANDO NAO ESTA DESISTINDO DO PAINEL. Sem esta linha, Esc
       dentro do campo do link -- ou de um timecode -- descarregava a musica
       inteira. Os campos de timecode ja param a bolha, mas a guarda vale para
       qualquer campo, inclusive os que ainda nao existem. */
    const alvo = ev.target && ev.target.tagName;
    if (alvo === "INPUT" || alvo === "TEXTAREA") return;
    if (OCUPADO) return;
    if (buscaAberta()) return;
    if (document.querySelector(".tela:not(.oculto)")) return;   // ha janela aberta: ela tem prioridade
    if (document.body.classList.contains("na-partida")) return;
    paraTudo();
    /* O paraTudo() cuida do #som. A previa e outro <audio>, e sem esta linha
       ela continuaria tocando numa tela limpa, sem barra e sem botao. */
    paraPrevia();
    VIDEO = null; PICOS = []; AUDIO_TEMP = "";
    $("link").value = "";
    habilita(false);
    partida("vazio");
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    $("telaAtalhos").classList.add("oculto");
    $("telaAjustes").classList.add("oculto");
    /* Esc no dialogo do bloqueio CALA como o "agora nao". Fechar com Esc e
       recusar; se ele voltasse a aparecer no proximo erro, a tecla que a
       pessoa usou para se livrar dele nao teria servido para nada. */
    if (!$("telaBloqueio").classList.contains("oculto")) {
      BLOQ_CALADO = true;
      fechaBloqueio();
    }
  });

  $("btTrocarPasta").addEventListener("click", async () => {
    const p = await ipcRenderer.invoke("dd-escolher-pasta");
    if (p) { PASTA = p; $("pastaDestino").value = p; }
  });

  // Limpar os dois obriga a busca inteira a ser refeita — guardar so o modulo
  // deixaria um estado meio conectado que o botao nao desfaria.
  $("btReconectar").addEventListener("click", () => {
    if (!ponte) return;
    ponte.esqueceConexao();
    pintaDiagnostico();
    atualizaProjeto();
  });

  habilita(false);
  poeModo(false);
  partida("vazio");
  /* A TROCA DE Cmd POR Ctrl SAIU DAQUI (1.8.4).

     Esta linha consertava um dos tres lugares, e so na abertura. O
     placeholder e a lista de atalhos continuavam falando em Command no
     Windows, e qualquer troca de idioma reescrevia tudo com o texto do
     dicionario -- desfazendo ate o que estava certo.

     Agora quem cuida disso e ajustaTeclas(), chamada no fim de
     aplicaIdioma(), em js/idiomas.js. Um lugar so, e roda de novo a cada
     troca de idioma. */
  ligaRegua();
  ligaOnda();
  ligaPegas();
  ligaZoom();
  ligaArrasteBotao();
  ligaTimecodes();
  document.querySelectorAll(".tema").forEach((el) => {
    el.addEventListener("click", () => poeTema(el.dataset.tema));
  });
  let salvo = "mono";
  try { salvo = localStorage.getItem("dd_tema") || "mono"; } catch (e) {}
  poeTema(salvo);

  /* O IDIOMA COMECA EM INGLES e nao adivinha pelo sistema: adivinhar erraria
     em quem tem o macOS em ingles e quer o painel em portugues. A escolha fica
     guardada, entao o custo e um clique, uma vez. */
  if (i18n) {
    let li = "en";
    try { li = localStorage.getItem("dd_lang") || "en"; } catch (e) {}
    i18n.aplicaIdioma(li);
    $("selIdioma").addEventListener("change", (ev) => {
      i18n.aplicaIdioma(ev.target.value);
      pintaRotulo();          // o botao de download tem texto proprio
      if (VIDEO) pintaSelecao();
    });
  }
  pintaPlay();
  atualizaProjeto();
}

/* O try/catch aqui NAO e decoracao. Se o inicia() estourar no meio, os
   listeners registrados antes da linha do erro funcionam e os de depois nao --
   e a pessoa fica com metade do painel viva, sem nenhuma pista. Melhor uma
   mensagem no rodape e o motivo no log. */
document.addEventListener("DOMContentLoaded", () => {
  try {
    log("DOM pronto — iniciando");
    inicia();
    log("inicia() terminou sem erro");
  } catch (e) {
    log("ERRO no inicia(): " + (e && e.stack || e));
    mostraFalha(e && e.message || e);
  }
  registraBinarios();
  escolheMotorQuandoDer();
});

/* A FICHA DOS BINÁRIOS, NO LOG  (2.0.0)

   O log registrava a versão do app, o sistema e o PATH -- e nada sobre quem
   faz o trabalho. Quando veio o relato "This video is not available" de outra
   máquina, o log não tinha uma linha sobre qual yt-dlp rodou nem sobre o
   deno, e o diagnóstico levou três rodadas de perguntas até alguém rodar o
   yt-dlp na mão. Uma linha aqui teria respondido na primeira.

   DEPOIS do painel montar, e não junto: perguntar a versão a três binários
   custa alguns milissegundos, e o boot não deve nada a isso. */
function registraBinarios() {
  if (!motor || !motor.fichaDosBinarios) { log("motor sem fichaDosBinarios"); return; }
  setTimeout(() => {
    motor.fichaDosBinarios().then((f) => {
      /* O "(do cache)" NAO E ENFEITE: sem ele, uma ficha que voltou do disco
         em 2 ms e uma que custou 20 s de execucao produzem linhas de log
         identicas -- e a proxima pessoa a investigar lentidao nao teria como
         saber qual das duas aconteceu. */
      log("yt-dlp: " + f.ytdlp.versao + "  em " + f.ytdlp.caminho + (f.doCache ? "  (do cache)" : ""));
      log("deno: " + f.deno.versao + "  em " + f.deno.caminho);
      log("ffmpeg: " + f.ffmpeg.caminho);
      log("--js-runtimes: " + (f.jsRuntimes ? "aceito" : "este yt-dlp não conhece"));
    }).catch((e) => log("fichaDosBinarios: " + e));
  }, 1200);
}

/* A ESCOLHA DO yt-dlp, LONGE DE QUEM ESTA ESPERANDO  (2.1.5)

   Ela custa uma execucao por candidato, e nesta maquina cada execucao do
   yt-dlp custa dez segundos. Na 2.1.4 isso ficava no caminho do link colado e
   somava quase um minuto -- a terceira versao seguida a tropecar no mesmo
   lugar, depois da ficha dos binarios e do urlVideo adiantado.

   ENTAO ELA SO ACONTECE COM O PAINEL PARADO, e o resultado vale da proxima
   abertura em diante. Ate la o painel usa a ordem do acha(), que e o
   comportamento da 2.1.2.

   TRINTA SEGUNDOS DEPOIS DO BOOT, e nao 1,2 s como a ficha: quem abre o painel
   para colar um link ja colou nesse tempo, e a analise dele nao disputa com
   isto. Se estiver ocupado na hora, ADIA de novo -- e por isso o teste do
   ocupa() esta dentro do laco, e nao antes dele. */
function escolheMotorQuandoDer() {
  if (!motor || !motor.mediraDepois) return;
  const tenta = () => {
    if (OCUPADO) { setTimeout(tenta, 15000); return; }
    motor.mediraDepois((l) => log(l));
  };
  setTimeout(tenta, 30000);
}
