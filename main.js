// ===================================================================================
//
//                                 Direct Download
//                            Developed by Jhaimes Filmes
//
//   Electron main process. O Resolve le o package.json, sobe este arquivo e nos
//   criamos a janela apontando para index.html. A logica (ponte com o Resolve,
//   yt-dlp, ffmpeg, Media Pool) roda no renderer -- mesmo modelo do BlackNote+,
//   do MetaClip e do Time Tracker.
//
//   O QUE ELE FAZ: cola link, mostra a forma de onda do audio, voce arrasta para
//   escolher o trecho, e o audio cortado cai no Media Pool do projeto aberto.
// ===================================================================================
const { app, BrowserWindow, ipcMain, shell, dialog, Menu, nativeImage } = require("electron");
const https = require("https");

/* O JSON fica no MESMO site do produto. Nao ha servidor de update: e um
   arquivo estatico de 200 bytes, editavel sem reempacotar plugin nenhum. */
const URL_VERSAO = "https://caixinhadoeditor.com/directdownload/versao.json";
const path = require("path");
const fs = require("fs");

const APP_VERSION = "2.3.8";
let win = null;

/* ---------------------------------------------------------------------------
   O LOG EM ARQUIVO — a licao que eu tinha lido e nao apliquei.

   A secao 2 do CLAUDE.md do BlackSlice diz, com todas as letras, que foi o log
   em arquivo que acabou com a adivinhacao naquele projeto. Este plugin nasceu
   sem ele, e o preco apareceu na primeira vez que "nao funciona nada": sem log,
   a unica coisa a fazer era supor -- e supor errou tres vezes seguidas.

   Aqui nao existe a saida facil de abrir pelo terminal para ver o stderr: quem
   sobe o plugin e o Resolve. Ou o programa escreve o que aconteceu, ou ninguem
   fica sabendo.

   O renderer manda as linhas dele por IPC ("dd-log"), para tudo cair no mesmo
   arquivo e na ordem certa.
--------------------------------------------------------------------------- */
/* ONDE O LOG MORA, EM CADA SISTEMA.

   Era ~/Library/Logs cravado -- caminho de macOS. No Windows isso criava
   C:\Users\<voce>\Library\Logs\, uma pasta que nao existe naquele sistema e
   que ninguem pensaria em abrir. O arquivo estava la o tempo todo durante o
   diagnostico do Direct Download no Windows, e so foi achado porque alguem
   leu esta linha do codigo.

   app.getPath("logs") resolve sozinho: ~/Library/Logs no mac e
   %APPDATA%\<app>\logs no Windows. O caminho e anunciado na primeira linha do
   proprio log, para a proxima pessoa nao precisar ler codigo para achar. */
const LOG = (() => {
  try { return path.join(app.getPath("logs"), "DirectDownload.log"); }
  catch (e) { return path.join(app.getPath("userData"), "DirectDownload.log"); }
})();

function anota(txt) {
  const linha = new Date().toISOString().slice(11, 23) + "  " + txt + "\n";
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    // 1 MB de teto: log que cresce sem limite vira um problema proprio
    try { if (fs.statSync(LOG).size > 1048576) fs.unlinkSync(LOG); } catch (e) {}
    fs.appendFileSync(LOG, linha);
  } catch (e) {}
  try { process.stderr.write(linha); } catch (e) {}
}

// Erro nao capturado no MAIN mata o plugin em silencio. Anotar antes de morrer
// e a diferenca entre "nao funciona nada" e uma linha dizendo o que foi.
process.on("uncaughtException", (e) => {
  anota("ERRO NAO CAPTURADO no main: " + (e && e.stack || e));
});

/* ---------------------------------------------------------------------------
   O PATH DO PROCESSO -- LEIA ANTES DE MEXER

   Esta e a licao mais cara do BlackSlice (secao 12 do CLAUDE.md dele), e ela
   vale AQUI COM MAIS FORCA, porque quem sobe este processo e o Resolve, e nao
   um shell.

   O yt-dlp precisa de um interpretador JS externo (o `deno`, que vai em bin/)
   para resolver o desafio de assinatura do YouTube. Quando nao acha o deno no
   PATH, ele NAO diz que faltou o deno. Ele falha na extracao, com uma mensagem
   que aponta para o lugar errado:

       ERROR: [youtube] <id>: This video is not available

   No BlackSlice isso produziu horas de diagnostico errado, porque o app aberto
   pelo terminal funcionava (herdava o PATH do zsh) e aberto por clique nao.
   Aqui nao existe a versao "pelo terminal": o Resolve sempre sobe o plugin com
   ambiente proprio. Sem esta funcao o plugin NUNCA funcionaria, e o erro
   pareceria ser do YouTube.
--------------------------------------------------------------------------- */
function pastaDosBinarios() {
  return path.join(__dirname, "bin", process.platform === "win32" ? "win" : "mac");
}

function alinhaPATH() {
  const sep = process.platform === "win32" ? ";" : ":";
  const partes = [pastaDosBinarios()];

  if (process.platform === "win32") {
    partes.push("C:\\Windows\\System32");
  } else {
    partes.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
  }

  const atual = process.env.PATH || "";
  if (atual) partes.push(atual);

  const vistos = new Set();
  process.env.PATH = partes.filter((p) => {
    if (!p || vistos.has(p)) return false;
    vistos.add(p);
    return true;
  }).join(sep);
}

function createWindow() {
  win = new BrowserWindow({
    width: 640,
    // 470 deixava ~100px de vazio abaixo do credito. 370 e a soma real do
    // conteudo montado: link 44 + canal 56 + regua e onda 137 + transporte 24
    // + acoes 54 + credito 26, com os respiros entre eles. useContentSize
    // acima e o que faz este numero valer o conteudo, e nao a janela com a
    // barra de titulo junto.
    height: 370,
    minWidth: 600,
    // 186 e a altura da TELA DE PARTIDA. Estava 430 -- maior que a propria
    // altura inicial de 370 -- e nesse estado o minimo vence: a janela nunca
    // conseguiria encolher para a tela limpa, e o setContentSize seria
    // silenciosamente ignorado.
    minHeight: 186,
    useContentSize: true,
    resizable: true,
    title: "Direct Download",
    backgroundColor: "#1E1E1E",
    // O ICONE SO ENTRA SE EXISTIR. Apontar para um arquivo que nao esta la faz
    // o Electron reclamar no arranque se o arquivo faltar.
    ...(function () {
      const ic = path.join(__dirname, process.platform === "win32" ? "icon.ico" : "icon.png");
      try { return fs.existsSync(ic) ? { icon: ic } : {}; } catch (e) { return {}; }
    })(),
    webPreferences: {
      // O renderer PRECISA do Node: e ele que carrega o WorkflowIntegration.node
      // e roda o yt-dlp/ffmpeg. Sem isto o painel abre e nao faz nada.
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: false,
    },
  });
  win.setMenu(null);

  /* O QUE O RENDERER DISSER, VAI PARA O LOG.

     'console-message' pega TUDO que o painel escreve no console -- inclusive o
     erro de sintaxe que impede o app.js de rodar. E justamente esse caso que
     produz o sintoma "a janela abre e nenhum botao funciona": o HTML desenha,
     o script morre antes de registrar um listener sequer, e nada na tela conta
     o que houve. */
  win.webContents.on("console-message", (e, nivel, msg, linha, fonte) => {
    const tipo = ["log", "AVISO", "ERRO"][nivel] || "log";
    anota(`[renderer ${tipo}] ${msg}  (${String(fonte).split("/").pop()}:${linha})`);
  });
  win.webContents.on("render-process-gone", (e, d) => {
    anota("renderer morreu: " + JSON.stringify(d));
  });
  win.webContents.on("did-fail-load", (e, cod, desc) => {
    anota("did-fail-load: " + cod + " " + desc);
  });

  /* DevTools SOB DEMANDA: crie um arquivo chamado DEBUG na pasta do plugin e
     o painel abre com as ferramentas do Chromium do lado. Sem o arquivo, nada
     muda para quem so quer usar. */
  try {
    if (fs.existsSync(path.join(__dirname, "DEBUG"))) {
      anota("arquivo DEBUG encontrado — abrindo DevTools");
      win.webContents.openDevTools({ mode: "detach" });
    }
  } catch (e) {}

  win.loadFile(path.join(__dirname, "index.html"));
  win.on("closed", () => { win = null; });
}

// ---------------------------------------------------------------------------
// O que so o main consegue fazer
// ---------------------------------------------------------------------------

ipcMain.on("dd-version", (e) => { e.returnValue = APP_VERSION; });

/* A ALTURA VEM DO PAINEL, porque so ele sabe em que estado esta: 186 na tela
   de partida, 370 com a interface montada.

   getContentSize preserva a largura -- se a pessoa alargou a janela, ela
   continua alargada. E o `true` no fim anima a mudanca no macOS; no Windows o
   Electron ignora o parametro, sem erro. */
ipcMain.on("dd-altura", (e, h) => {
  try {
    if (!win || win.isDestroyed()) return;
    const alvo = Number(h);
    if (!Number.isFinite(alvo) || alvo < 120 || alvo > 2000) return;
    const [w, atual] = win.getContentSize();
    if (atual === alvo) return;
    win.setContentSize(w, alvo, true);
  } catch (err) { anota("dd-altura: " + err); }
});

ipcMain.on("dd-log", (e, txt) => { anota("[painel] " + txt); });

ipcMain.on("dd-pin", (e, on) => {
  try { if (win) win.setAlwaysOnTop(!!on, "floating"); } catch (err) {}
});

ipcMain.on("dd-reveal", (e, pasta) => {
  try {
    if (pasta && !fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
    shell.openPath(pasta);
  } catch (err) {}
});

/* ONDE OS ARQUIVOS PODEM FICAR, PERGUNTADO A QUEM SABE.

   Mesma razao do BlackNote+: caminho de pasta pessoal montado na mao erra no
   Windows, e erra em SILENCIO -- criaria uma pasta "Library/Application
   Support" dentro do perfil do usuario, o que o sistema permite e esta errado
   em todos os outros sentidos. O Electron sabe o caminho certo de cada
   sistema, e app.getPath mora aqui no main.

   'downloads' respeita inclusive a pasta REDIRECIONADA -- Downloads apontando
   para o OneDrive e comum no Windows corporativo. */
ipcMain.on("dd-pastas", (e) => {
  const r = {};
  try { r.downloads = app.getPath("downloads"); } catch (err) { r.downloads = null; }
  try { r.musica = app.getPath("music"); } catch (err) { r.musica = null; }
  try { r.temp = app.getPath("temp"); } catch (err) { r.temp = null; }
  e.returnValue = r;
});

/* VERIFICADOR DE VERSAO (portado do BlackNote+ 1.12.0)

   Um GET de alguns bytes. O TIMEOUT curto e o que impede o painel de esperar
   por um servidor fora do ar -- 6s e muito para um arquivo de 200 bytes, e
   quem estiver numa rede pior simplesmente nao ve o aviso hoje.

   Nada aqui decide se ha versao nova: o main so entrega o que leu. A
   comparacao mora no painel, junto do numero da versao instalada. */
ipcMain.handle("dd-check-version", () => new Promise((ok) => {
  let fim = false;
  const pronto = (v) => { if (!fim) { fim = true; ok(v); } };
  try {
    const req = https.get(URL_VERSAO, { timeout: 6000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return pronto(null); }
      let buf = "";
      // TETO DE 64 KB: sem ele, um servidor trocado por engano poderia mandar
      // um arquivo infinito e encher a memoria do Resolve.
      res.on("data", (d) => { buf += d; if (buf.length > 65536) { req.destroy(); pronto(null); } });
      res.on("end", () => { try { pronto(JSON.parse(buf)); } catch (e) { pronto(null); } });
    });
    req.on("timeout", () => { req.destroy(); pronto(null); });
    req.on("error", () => pronto(null));
  } catch (e) { pronto(null); }
}));

/* ===========================================================================
   ARRASTAR O ARQUIVO PARA FORA DO PAINEL  (1.8.7)

   startDrag entrega o arquivo ao SISTEMA OPERACIONAL, e nao ao Resolve. E o
   mesmo mecanismo de arrastar do Finder ou do Explorador: quem decide o que
   fazer com ele e o aplicativo onde a pessoa soltar.

   TRES COISAS QUE O ELECTRON EXIGE, e cada uma derruba o arraste em silencio:

   1. O ICONE E OBRIGATORIO. Sem ele o startDrag simplesmente nao acontece --
      nao lanca erro, nao avisa, o mouse solta e nada foi arrastado.
   2. TEM DE SER CHAMADO DENTRO DO dragstart. Adiar por um await, ou esperar
      qualquer resposta, e perder a janela em que o sistema aceita iniciar o
      arraste. Por isso este handler nao converte nada: o arquivo ja tem de
      existir quando a pessoa comeca a arrastar.
   3. O CAMINHO PRECISA EXISTIR AGORA. Um caminho morto nao da erro; da um
      arraste que nao leva nada.

   O renderer manda so o caminho; a conferencia de que o arquivo esta la mora
   AQUI, porque quem tem o poder de entregar e quem deve conferir -- a mesma
   razao de dd-open-external checar o protocolo. */
ipcMain.on("dd-arrasta", (e, caminho) => {
  try {
    const p = String(caminho || "");
    if (!p || !fs.existsSync(p)) { anota("arraste: caminho nao existe — " + p); return; }
    const ic = path.join(__dirname, "icon.png");
    const icone = fs.existsSync(ic)
      ? nativeImage.createFromPath(ic).resize({ width: 64, height: 64 })
      : nativeImage.createEmpty();
    anota("arraste: " + p);
    e.sender.startDrag({ file: p, icon: icone });
  } catch (err) { anota("arraste: " + err); }
});

/* ABRIR NO NAVEGADOR, com o protocolo conferido AQUI.

   shell.openExternal entrega a URL ao sistema, e o sistema abre o que for --
   um file:///... roda o que estiver naquele caminho. A URL vem de um JSON da
   rede; quem tem o poder de abrir confere sozinho, em vez de confiar em quem
   pediu. */
ipcMain.on("dd-open-external", (e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    shell.openExternal(u.href);
  } catch (err) { anota("open-external: " + err); }
});

/* OS ICONES DA ARVORE DE CAMINHO.

   32px com scaleFactor 2 -> 16px logicos e NITIDOS no Retina. Gerando em 16px
   direto, o macOS mostraria a imagem borrada em telas 2x; e createFromDataURL
   nao aceita scaleFactor, so createFromBuffer. Por isso o base64 passa por
   Buffer.from em vez de virar data URL.

   Criados UMA VEZ, no carregamento: nativeImage decodifica o PNG a cada
   chamada, e o menu abre toda vez que se clica no botao. */
const IC_PASTA_B64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAfUlEQVR42mNgGAWjYKQDRmTOzp37/pOi2d3diZFSBzCRazm5enA6YMCjgBq+ISfqBiQEkD07YFEAcwQLsqCbm6MpvRywa9f+04MiEbJgcxU9wYCHwKgDRh0AzwUXL14ajYJRB4xwB5SVFTDS02KYfUzYBOll+SgYBQwMDAwA+3Aj05y6qgEAAAAASUVORK5CYII=";
const IC_DISCO_B64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAg0lEQVR42u2WMQ7AIAwDAeWhnXhUJn5Kd5SmFU2cqsqNDNg4RlBKkiTBVGmReUwPsd6PqhrwEtaM0FOnFqgHZB4TkcCqQ9uOjVJrFuJv+tOsTrSbAHlsapIACkK0Xku0ocSviho+gn8bWGcudcC9hHdXOXwE0AdJ2p+QH5JP/oiSJDkBmTRD8WbTxIoAAAAASUVORK5CYII=";
const icPasta = (() => {
  try { return nativeImage.createFromBuffer(Buffer.from(IC_PASTA_B64, "base64"), { scaleFactor: 2 }); }
  catch (e) { anota("icone pasta: " + e); return null; }
})();
const icDisco = (() => {
  try { return nativeImage.createFromBuffer(Buffer.from(IC_DISCO_B64, "base64"), { scaleFactor: 2 }); }
  catch (e) { anota("icone disco: " + e); return null; }
})();

/* QUEBRA O CAMINHO EM NIVEIS, do volume ate a pasta final.

   O primeiro nivel e o DISCO, e nao a primeira pasta:
     macOS   /Volumes/SSD_4TB_01/UCLEC/...  ->  SSD_4TB_01 (disco), UCLEC, ...
     Windows D:\projetos\fulano\...        ->  D: (disco), projetos, ...
   Um caminho dentro de /Users nao passa por /Volumes -- ali o primeiro nivel e
   a propria pasta, e o icone de disco nao aparece.

   Caminho MUITO fundo vira volume + "..." + os tres ultimos. Sem esse corte um
   projeto aninhado deixaria o menu mais alto que a janela. */
function arvoreDoCaminho(caminho) {
  if (!caminho) return [];
  const sep = caminho.indexOf("\\") >= 0 && caminho.indexOf("/") < 0 ? "\\" : "/";
  let partes = caminho.split(/[\\/]+/).filter(Boolean);
  let disco = false;

  if (sep === "\\" || /^[A-Za-z]:$/.test(partes[0] || "")) {
    disco = true;                                  // Windows: "D:"
  } else if (partes[0] === "Volumes" && partes.length > 1) {
    partes = partes.slice(1);                      // macOS: tira o /Volumes
    disco = true;
  }

  if (partes.length > 5) {
    partes = [partes[0], "\u2026"].concat(partes.slice(-3));
  }
  return partes.map((n, i) => ({ nome: n, disco: disco && i === 0, corte: n === "\u2026" }));
}

/* MENU DE CONTEXTO DO BOTAO DA PASTA.

   Menu NATIVO e nao um <div> em HTML. Tres razoes, e nenhuma e estetica:
   ele nao e recortado pela janela, fecha sozinho ao clicar fora ou apertar
   Esc, e ja vem com a aparencia do macOS e do Windows -- as tres coisas
   custariam CSS e listeners para reimplementar mal.

   Devolve a acao escolhida, ou null se a pessoa fechou sem escolher. O
   `resolvido` existe porque o callback do popup dispara TAMBEM quando houve
   clique, e sem a trava ele sobrescreveria a escolha com null. */
ipcMain.handle("dd-menu-pasta", async (e, info) => {
  info = info || {};
  return new Promise((resolve) => {
    let resolvido = false;
    const escolhe = (o) => () => { resolvido = true; resolve(o); };
    const itens = [
      { label: info.abrir    || "Abrir a pasta",       click: escolhe("abrir") },
      { label: info.escolher || "Escolher pasta\u2026", click: escolhe("escolher") },
      { type: "separator" },
      { label: info.seguir || "Seguir a pasta do projeto",
        type: "checkbox", checked: !!info.auto, click: escolhe("auto") },
    ];
    // O CAMINHO REAL do proximo download, e nao a pasta dos Ajustes. Com o
    // automatico ligado os dois sao lugares diferentes, e um menu que deixa
    // escolher uma pasta sem dizer que o arquivo vai para outra e uma armadilha.
    const arvore = arvoreDoCaminho(info.alvo);
    if (arvore.length) {
      itens.push({ type: "separator" });
      arvore.forEach((n, i) => {
        // O RECUO E ESPACO NO ROTULO. O menu nativo nao tem indentacao propria,
        // e o icone do MenuItem fica sempre colado ao texto -- entao o recuo
        // precisa vir antes dele, no label.
        const item = { label: " ".repeat(i * 3) + n.nome, enabled: false };
        if (!n.corte) {
          const ic = n.disco ? icDisco : icPasta;
          if (ic) item.icon = ic;
        }
        itens.push(item);
      });
    }
    try {
      Menu.buildFromTemplate(itens).popup({
        window: win,
        callback: () => { if (!resolvido) resolve(null); },
      });
    } catch (err) { anota("dd-menu-pasta: " + err); resolve(null); }
  });
});

ipcMain.handle("dd-escolher-pasta", async () => {
  try {
    const r = await dialog.showOpenDialog(win, {
      title: "Onde salvar os arquivos",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return null;
    return r.filePaths[0];
  } catch (err) { return null; }
});

app.whenReady().then(() => {
  anota("===== abriu — versao " + APP_VERSION + " =====");
  // o caminho do proprio log, para quem for pedir o arquivo nao ter de
  // descobrir onde ele esta em cada sistema
  anota("log: " + LOG);
  anota("sistema: " + process.platform + " " + process.arch);
  alinhaPATH();
  anota("PATH: " + String(process.env.PATH).slice(0, 200));
  createWindow();
  // No macOS o icone do dock ignora o atributo `icon` da janela -- tem de ser
  // no app. O MetaClip 1.1.0 saiu com o icone generico do Electron por isso.
  if (process.platform === "darwin" && app.dock) {
    try {
      const ic = path.join(__dirname, "icon.png");
      if (fs.existsSync(ic)) app.dock.setIcon(ic);
    } catch (e) {}
  }
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!win) createWindow(); });
