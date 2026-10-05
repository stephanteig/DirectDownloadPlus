// ===================================================================================
//   Direct Download — a ponte com o DaVinci Resolve
//
//   ESTE ARQUIVO E QUASE IGUAL NOS QUATRO PLUGINS (BlackNote+, Time Tracker,
//   MetaClip, Direct Download). AO MEXER EM UM, OLHE OS OUTROS TRES.
//
//   Ele nao foi escrito aqui: e a versao 1.15.1 do BlackNote+, que so ficou
//   correta depois de uma versao que quebrou os tres plugins ao mesmo tempo.
//   Os comentarios vieram junto de proposito — sao eles que impedem alguem de
//   "simplificar" de volta para a versao quebrada.
// ===================================================================================
const path = require("path");
const fs = require("fs");

const PLUGIN_ID = "com.stephanteig.directdownloadplus";

let _wi = null;
let _resolve = null;
let WI_ACHADO = null;
let WI_TENTADOS = [];

/* PORTA DE TESTE. A suite precisa de uma timeline e de um Media Pool de
   mentira; sem isto ela so rodaria com o Resolve aberto -- ou seja, nunca
   rodaria. Em producao _DUBLE fica null e tudo passa pelo Resolve de verdade.

   FICA AQUI NO TOPO, e nao junto de __teste(), porque `let` tem zona morta
   temporal: mediaPool() e timelineAtual() leem _DUBLE, e ambas sao declaradas
   ANTES do ponto onde a variavel estava. Funcionava por sorte -- o modulo
   inteiro e avaliado antes de alguem chamar as funcoes --, mas bastava um
   require em ordem diferente para virar ReferenceError. */
let _DUBLE = null;

/* CARREGAR NAO E CONECTAR.

   A versao antiga dava o caminho por bom assim que o require funcionava:

       try { _wi = require(c); if (_wi) { return _wi; } }

   So que um .node que carrega pode ter o Initialize recusando. E, pior, ele
   ficava EM CACHE — entao as chamadas seguintes nem tentavam os outros
   caminhos. Um candidato ruim envenenava a sessao inteira, e a tela dizia
   "nao encontrado" para um arquivo que estava la.

   Um candidato so vence se atravessar os TRES passos: carregar, Initialize
   devolver verdadeiro, e GetResolve devolver objeto. Falhou em qualquer um,
   anota o motivo e passa para o proximo. */
function tentaPonte(caminho) {
  let mod;
  try { mod = require(caminho); }
  catch (e) { return { ok: false, erro: "nao carregou: " + String(e && e.message || e) }; }
  if (!mod || typeof mod.Initialize !== "function")
    return { ok: false, erro: "carregou, mas nao e a ponte (sem Initialize)" };
  let iniciou = false;
  try { iniciou = !!mod.Initialize(PLUGIN_ID); }
  catch (e) { return { ok: false, erro: "Initialize estourou: " + String(e && e.message || e) }; }
  if (!iniciou) return { ok: false, erro: "carregou, mas o Initialize recusou" };
  let r = null;
  try { r = mod.GetResolve(); }
  catch (e) { return { ok: false, erro: "GetResolve estourou: " + String(e && e.message || e) }; }
  if (!r) return { ok: false, erro: "conectou, mas GetResolve veio vazio (o Resolve esta aberto?)" };
  return { ok: true, wi: mod, resolve: r };
}

function carregaWI() {
  /* _wi E _resolve ANDAM JUNTOS. Guardar so o modulo permitia um estado meio
     conectado: modulo em cache e Resolve nulo, e ai carregaWI devolvia o cache
     sem refazer a conexao. Exigir os dois faz qualquer limpeza de _resolve
     reabrir a busca inteira. */
  if (_wi && _resolve) return _wi;

  const pd = process.env["PROGRAMDATA"] || "C:\\ProgramData";
  const pf = process.env["PROGRAMFILES"] || "C:\\Program Files";
  const raiz = path.join(__dirname, "..");

  /* A COPIA DO RESOLVE VEM PRIMEIRO; A NOSSA E REDE E VEM POR ULTIMO.

     Inverter esta ordem quebrou os tres plugins de uma vez, em maquinas onde
     ja funcionavam. Ate a versao anterior a raiz do plugin guardava so o .node
     do macOS: no Windows o require nele falhava, a busca seguia e achava a
     copia do proprio Resolve. Quando o .node do WINDOWS passou a ser embarcado,
     ele virou o primeiro a carregar -- e carregar nao e conectar.

     A regra certa: quem manda e a copia que o proprio Resolve instalou, porque
     ela combina com a versao dele e mora junto das dependencias dela. A nossa
     e rede, e rede vem por ultimo.

     O caminho de Examples/SamplePlugin nao e capricho: e onde o README da
     Blackmagic diz que fica a copia mais recente. A lista antiga tinha quatro
     caminhos e nenhum era o certo num Resolve Studio legitimo. */
  const cand = [
    path.join(pd, "Blackmagic Design", "DaVinci Resolve", "Support", "Developer",
              "Workflow Integrations", "Examples", "SamplePlugin", "WorkflowIntegration.node"),
    path.join(pd, "Blackmagic Design", "DaVinci Resolve", "Support", "Developer",
              "Workflow Integrations", "WorkflowIntegration.node"),
    path.join(pf, "Blackmagic Design", "DaVinci Resolve", "Support", "Developer",
              "Workflow Integrations", "Examples", "SamplePlugin", "WorkflowIntegration.node"),
    path.join(pf, "Blackmagic Design", "DaVinci Resolve", "Developer",
              "Workflow Integrations", "WorkflowIntegration.node"),
    "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node",
    "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/WorkflowIntegration.node",
    "/opt/resolve/Developer/Workflow Integrations/WorkflowIntegration.node",
    // as nossas, por ultimo
    path.join(raiz, "win", "WorkflowIntegration.node"),
    path.join(raiz, "WorkflowIntegration.node"),
  ];

  WI_TENTADOS = [];
  for (const c of cand) {
    let existe = false;
    try { existe = fs.existsSync(c); } catch (e) {}
    WI_TENTADOS.push({ caminho: c, existe });
    if (!existe) continue;
    const r = tentaPonte(c);
    if (r.ok) { _wi = r.wi; _resolve = r.resolve; WI_ACHADO = c; return _wi; }
    WI_TENTADOS[WI_TENTADOS.length - 1].erro = r.erro;
  }
  return null;
}

function getResolve() {
  if (_wi && _resolve) return _resolve;
  carregaWI();
  return _resolve;
}

/* SEGURO: a API do Resolve devolve false calado com muita frequencia, e joga
   excecao de vez em quando. Envolver tudo evita que um erro derrube o painel
   -- MAS cuidado: engolir o `false` foi exatamente o que escondeu o bug de
   timecode do BlackNote+ por meses. Quem chama tem de olhar o retorno. */
function seguro(fn, padrao) {
  try {
    const v = fn();
    return (v === undefined || v === null) ? padrao : v;
  } catch (e) { return padrao; }
}

/* O PROJETO E O DE AGORA. Nao guarde referencia: a pessoa troca de projeto com
   o painel aberto, e uma referencia velha aponta para um projeto fechado -- a
   chamada nao estoura, so nao faz nada. */
function projetoAtual() {
  const r = getResolve();
  if (!r) return null;
  const pm = seguro(() => r.GetProjectManager(), null);
  if (!pm) return null;
  return seguro(() => pm.GetCurrentProject(), null);
}

function mediaPool() {
  /* A PORTA DE TESTE. _DUBLE.mediaPool deixa a suite exercitar a busca por
     caminho e a decisao de "ja estava la" sem o Resolve aberto -- que e a
     unica forma de ter teste para isso, ja que o bug so aparece no SEGUNDO
     download do mesmo link. */
  if (_DUBLE && _DUBLE.mediaPool) return _DUBLE.mediaPool;
  const p = projetoAtual();
  if (!p) return null;
  return seguro(() => p.GetMediaPool(), null);
}

/* COMPARAR DOIS CAMINHOS DE ARQUIVO.

   Nao e ===. Tres diferencas que nao mudam o arquivo, mas mudam a string:

     . o separador -- o Resolve devolve "C:/Users/..." onde o Node monta
       "C:\Users\...", e no Windows os dois apontam para o mesmo lugar
     . a caixa -- o sistema de arquivos do Windows e do macOS nao distingue
       maiuscula de minuscula
     . o acento -- o macOS guarda "Áudio" decomposto (A + acento) e outras
       camadas devolvem composto. Comparar sem normalizar acha que sao
       arquivos diferentes, e essa ja mordeu no ponte.js do Direct Download. */
function mesmoArquivo(a, b) {
  const n = (s) => String(s || "")
    .normalize("NFC")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
  return n(a) !== "" && n(a) === n(b);
}

/* PROCURAR UM CLIPE NO MEDIA POOL PELO CAMINHO.

   Existe por causa de um erro que parecia do Windows e nao era: baixar duas
   vezes o mesmo link fazia o painel dizer "o Resolve recusou o arquivo". O
   Resolve nao recusava nada -- ele so nao adiciona de novo um clipe que ja
   esta la, e devolve LISTA VAZIA. Nosso codigo lia vazio como recusa.

   A busca comeca pela pasta ATUAL, que e onde o clipe teria caido no primeiro
   download, e so depois desce a arvore. Com teto: um Media Pool de serie tem
   milhares de clipes, e varrer tudo a cada download travaria o painel. */
function achaNoMediaPool(caminho) {
  const mp = mediaPool();
  if (!mp || !caminho) return null;

  const doClipe = (c) => seguro(() => c.GetClipProperty("File Path"), "")
                      || seguro(() => c.GetClipProperty("File Name"), "");

  const naPasta = (pasta) => {
    const clipes = seguro(() => pasta.GetClipList(), []) || [];
    for (const c of clipes) if (mesmoArquivo(doClipe(c), caminho)) return c;
    return null;
  };

  // 1. a pasta aberta agora -- o caso comum, e custa uma chamada
  const atual = seguro(() => mp.GetCurrentFolder(), null);
  if (atual) { const a = naPasta(atual); if (a) return a; }

  // 2. a arvore inteira, com limites
  const raiz = seguro(() => mp.GetRootFolder(), null);
  if (!raiz) return null;
  let vistas = 0;
  const desce = (pasta, nivel) => {
    if (!pasta || nivel > 6 || vistas > 400) return null;
    vistas++;
    const a = naPasta(pasta);
    if (a) return a;
    const subs = seguro(() => pasta.GetSubFolderList(), []) || [];
    for (const s of subs) { const r = desce(s, nivel + 1); if (r) return r; }
    return null;
  };
  return desce(raiz, 0);
}

/* IMPORTAR NO MEDIA POOL.

   Devolve { ok, erro, itens, jaEstava }. NAO devolve so booleano de proposito:
   quando falha, quem chama precisa dizer POR QUE na tela, senao vira o "nao
   funcionou" sem informacao que custou dias no BlackNote+.

   AddItemListToMediaPool devolve LISTA VAZIA em DOIS casos bem diferentes:

     1. o arquivo esta la e o Resolve nao consegue ler (codec, permissao,
        arquivo ainda sendo escrito)  -> isto e recusa de verdade
     2. o clipe JA ESTA no Media Pool -> nao e recusa nenhuma

   Tratar os dois como erro foi o bug: quem baixava sem "Timeline", marcava a
   caixa e baixava de novo levava "o Resolve recusou o arquivo" -- e, pior,
   a insercao na timeline nem era tentada, porque dependia de imp.ok.

   Por isso a procura vem ANTES da importacao. Achou, reusa; nao achou,
   importa; importou e voltou vazio, ai sim e recusa. */
function importaNoMediaPool(arquivos) {
  const lista = Array.isArray(arquivos) ? arquivos : [arquivos];
  const validos = lista.filter((a) => a && fs.existsSync(a));
  if (!validos.length) return { ok: false, erro: "nenhum arquivo no disco para importar" };

  /* O MEDIA POOL VEM ANTES DO getResolve().

     Nao e ordem por gosto: o MediaStorage so e necessario para IMPORTAR, e
     quando o clipe ja esta no pool nao ha importacao nenhuma. Exigir a
     conexao antes de procurar tornaria este caminho intestavel -- e foi
     exatamente o que aconteceu na primeira escrita deste bloco. */
  if (!mediaPool()) return { ok: false, erro: "nenhum projeto aberto no Resolve" };

  /* JA ESTAO LA? A ordem importa: procurar depois de importar nao ajudaria,
     porque a lista vazia nao diz qual dos dois casos aconteceu. */
  const achados = validos.map((a) => achaNoMediaPool(a));
  if (achados.every((x) => x)) {
    return { ok: true, itens: achados, jaEstava: true };
  }

  const r = getResolve();
  if (!r) return { ok: false, erro: "Resolve nao conectado" };
  const ms = seguro(() => r.GetMediaStorage(), null);
  if (!ms) return { ok: false, erro: "MediaStorage indisponivel" };

  const itens = seguro(() => ms.AddItemListToMediaPool(validos), null);
  if (itens && itens.length) return { ok: true, itens, jaEstava: false };

  /* Voltou vazio. Antes de chamar de recusa, procura de novo: pode ser que o
     Resolve tenha adicionado e devolvido vazio mesmo assim -- a API faz isso
     em algumas versoes -- ou que um dos arquivos ja estivesse la e a lista
     inteira tenha sido descartada por causa dele. */
  const depois = validos.map((a) => achaNoMediaPool(a)).filter((x) => x);
  if (depois.length) return { ok: true, itens: depois, jaEstava: true };

  return { ok: false, erro: "o Resolve recusou o arquivo (codec ou permissao)" };
}

/* =====================================================================
   ONDE FICA A RAIZ DO PROJETO

   Portado do get_bins.py do Resolve Link, que resolveu isto antes e resolveu
   melhor do que a ideia obvia. A ideia obvia -- "pega o prefixo comum dos
   caminhos" -- morre no primeiro clipe que veio do Desktop: o prefixo comum
   sobe ate /Users/voce e a raiz vira a pasta pessoal.

   O Resolve Link nao confia num sinal so. Roda DOIS detectores e elege o de
   maior pontuacao. Aqui isso importa mais ainda, porque este plugin existe
   justamente para JOGAR ARQUIVOS DE FORA no Media Pool -- a contaminacao que
   quebraria o prefixo comum e o nosso caso normal de uso.
   ===================================================================== */

/* Estrutura tipica de projeto. Cada uma que existir vale 5 pontos.
   E a mesma lista do Resolve Link, e ela e o coracao do metodo: uma pasta com
   AUDIO e VIDEOS dentro quase certamente e a raiz de um projeto; /Users/voce
   nao tem nenhuma. */
const ESTRUTURA = ["AUDIO", "AUDIOS", "IMAGEM", "VIDEO", "VIDEOS", "ASSETS",
                   "PROJETOS", "RENDER", "LOCUCAO", "FILMAGEM", "FOOTAGE",
                   "EXPORT", "GRADE", "SFX", "MUSIC"];

const soAlfaNum = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* Tira acento para comparar: no disco a pasta pode estar "ÁUDIO", e no macOS
   ela ainda pode vir decomposta (A + acento em dois code points). Normalizar
   para NFD e apagar as marcas resolve os dois casos de uma vez. */
const semAcento = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function pontuaPasta(caminho, nomeProjeto) {
  let pontos = 0;
  const nomePasta = soAlfaNum(semAcento(path.basename(caminho)));
  const proj = soAlfaNum(semAcento(nomeProjeto));
  // continencia nos DOIS sentidos: a pasta pode ser "26-03-09 - DASA" e o
  // projeto "26-03-09 - DASA - NTO DASA", ou o contrario
  if (nomePasta && proj && (nomePasta.includes(proj) || proj.includes(nomePasta))) pontos += 10;
  try {
    if (fs.statSync(caminho).isDirectory()) {
      const subs = fs.readdirSync(caminho)
        .filter((f) => { try { return fs.statSync(path.join(caminho, f)).isDirectory(); } catch (e) { return false; } })
        .map((f) => soAlfaNum(semAcento(f)));
      ESTRUTURA.forEach((e) => { if (subs.includes(e)) pontos += 5; });
    }
  } catch (e) {}
  return pontos;
}

/* Detector 1: parte do diretorio mais frequente e sobe a arvore. */
function raizPorFrequencia(caminhos, nomeProjeto) {
  if (!caminhos.length) return { caminho: null, pontos: -1 };
  const conta = {};
  caminhos.forEach((c) => { conta[c] = (conta[c] || 0) + 1; });
  let atual = Object.keys(conta).sort((a, b) => conta[b] - conta[a])[0];
  let melhor = atual, max = -1;
  while (atual && atual.length > 1) {
    const p = pontuaPasta(atual, nomeProjeto);
    if (p >= max) { max = p; melhor = atual; }
    if (p >= 15) break;                      // ja e bom o bastante
    const pai = path.dirname(atual);
    if (pai === atual) break;
    atual = pai;
  }
  return { caminho: melhor, pontos: max };
}

/* Detector 2: cada clipe vota em TODOS os seus ancestrais.

   O limite de 5 pontos de estrutura e o que torna este metodo imune ao clipe
   solto: /Users/voce recebe o voto, mas nao tem AUDIO nem VIDEOS dentro, entao
   nao passa do corte. */
function raizPorVotacao(caminhos, nomeProjeto) {
  if (!caminhos.length) return { caminho: null, pontos: -1 };
  const votos = {};
  caminhos.forEach((c) => {
    let atual = c, prof = 0;
    while (atual && atual.length > 3 && prof < 8) {
      votos[atual] = (votos[atual] || 0) + 1;
      const pai = path.dirname(atual);
      if (pai === atual) break;
      atual = pai; prof++;
    }
  });
  let melhor = null, max = -1;
  Object.keys(votos).forEach((c) => {
    const estrut = pontuaPasta(c, nomeProjeto);
    if (estrut < 5) return;
    const total = estrut + votos[c];
    if (total > max) { max = total; melhor = c; }
  });
  if (melhor) return { caminho: melhor, pontos: max };
  // sem ninguem acima do corte, aceita o melhor entre os mais votados
  Object.keys(votos).sort((a, b) => votos[b] - votos[a]).slice(0, 10).forEach((c) => {
    const p = pontuaPasta(c, nomeProjeto);
    if (p > max) { max = p; melhor = c; }
  });
  return { caminho: melhor, pontos: max };
}

function todosOsClipes(pasta, saida) {
  saida = saida || [];
  const lista = seguro(() => pasta.GetClipList(), []) || [];
  lista.forEach((c) => saida.push(c));
  const subs = seguro(() => pasta.GetSubFolderList(), []) || [];
  subs.forEach((s) => todosOsClipes(s, saida));
  return saida;
}

/* Devolve { ok, raiz, pontos, clipes, erro }. */
function raizDoProjeto() {
  const mp = mediaPool();
  if (!mp) return { ok: false, erro: "nenhum projeto aberto no Resolve" };
  const raizPool = seguro(() => mp.GetRootFolder(), null);
  if (!raizPool) return { ok: false, erro: "Media Pool indisponivel" };

  const clipes = todosOsClipes(raizPool);
  const dirs = [];
  clipes.forEach((c) => {
    const fp = seguro(() => c.GetClipProperty("File Path"), "") || "";
    // Timelines e geradores NAO tem File Path. Sem este filtro eles entrariam
    // como string vazia e o dirname viraria "." -- um candidato que vence a
    // votacao por acumular voto de todo clipe sintetico do projeto.
    if (fp) dirs.push(path.dirname(fp));
  });
  if (!dirs.length) return { ok: false, erro: "o projeto nao tem nenhum clipe com arquivo no disco" };

  const nome = nomeDoProjeto() || "";
  const a = raizPorFrequencia(dirs, nome);
  const b = raizPorVotacao(dirs, nome);
  const venc = (b.caminho && b.pontos >= a.pontos) ? b : (a.caminho ? a : null);
  if (!venc || !venc.caminho) return { ok: false, erro: "nao consegui deduzir a raiz do projeto" };

  return { ok: true, raiz: venc.caminho, pontos: venc.pontos, clipes: dirs.length,
           metodo: venc === b ? "votacao" : "frequencia" };
}

/* A PASTA DE DESTINO, criada se preciso.

   Procura uma subpasta de audio ja existente comparando SEM acento e SEM
   maiuscula -- "Áudio", "AUDIO" e "audios" sao a mesma coisa para quem
   organiza o projeto, e criar uma segunda ao lado seria justamente o oposto do
   que este recurso serve. */
const NOMES_AUDIO = ["AUDIO", "AUDIOS"];
const NOMES_VIDEO = ["VIDEO", "VIDEOS"];

function pastaDeDestino(raiz, tipo, subpasta) {
  const alvos = tipo === "video" ? NOMES_VIDEO : NOMES_AUDIO;
  let dentro = null;
  try {
    const itens = fs.readdirSync(raiz);
    for (const f of itens) {
      const cheio = path.join(raiz, f);
      try { if (!fs.statSync(cheio).isDirectory()) continue; } catch (e) { continue; }
      if (alvos.includes(soAlfaNum(semAcento(f)))) { dentro = cheio; break; }
    }
  } catch (e) {
    return { ok: false, erro: "nao consegui ler a pasta do projeto: " + e.message };
  }

  const criou = [];
  if (!dentro) {
    dentro = path.join(raiz, alvos[0]);
    try { fs.mkdirSync(dentro, { recursive: true }); criou.push(dentro); }
    catch (e) { return { ok: false, erro: "nao consegui criar " + dentro + ": " + e.message }; }
  }

  const fim = path.join(dentro, subpasta || "Direct Download");
  try {
    if (!fs.existsSync(fim)) { fs.mkdirSync(fim, { recursive: true }); criou.push(fim); }
  } catch (e) {
    return { ok: false, erro: "nao consegui criar " + fim + ": " + e.message };
  }

  // Escrever e o unico teste que vale: a pasta pode existir e estar num disco
  // somente-leitura, ou pertencer a outro usuario. Descobrir isso agora e
  // melhor que descobrir depois de baixar 40 MB.
  try {
    const t = path.join(fim, ".dd-teste");
    fs.writeFileSync(t, "x");
    fs.unlinkSync(t);
  } catch (e) {
    return { ok: false, erro: "sem permissao de escrita em " + fim };
  }

  return { ok: true, pasta: fim, paiAudio: dentro, criou };
}

function __teste(d) { _DUBLE = d; }

/* =====================================================================
   INSERIR NA TIMELINE

   Portado do reimportOne() do Edyta (src/app.ts) e das funcoes de track do
   src/resolve.ts. Nao reescreva por conta: cada numero aqui foi aferido la e
   tres deles nao sao obvios.
   ===================================================================== */

function timelineAtual() {
  if (_DUBLE) return _DUBLE.timeline;
  const p = projetoAtual();
  if (!p) return null;
  return seguro(() => p.GetCurrentTimeline(), null);
}

function fpsDaTimeline() {
  if (_DUBLE) return _DUBLE.fps || 24;
  const p = projetoAtual();
  if (!p) return 24;
  const s = seguro(() => p.GetSetting("timelineFrameRate"), null);
  const f = parseFloat(String(s));
  return (isFinite(f) && f > 0) ? f : 24;
}

/* O PLAYHEAD EM FRAME ABSOLUTO.

   Nao basta converter o timecode atual: numa timeline que comeca em
   01:00:00:00 -- padrao de boa parte dos projetos -- o timecode traz a hora
   junto. A conta do Edyta subtrai o timecode INICIAL e soma o GetStartFrame(),
   e e a unica que da certo nos dois casos. E a mesma armadilha da secao 3 do
   CLAUDE.md do BlackNote+, que custou meses la. */
function playheadFrame() {
  const tl = timelineAtual();
  if (!tl) return 0;
  const rf = Math.max(1, Math.round(fpsDaTimeline()));
  const emFrames = (tc) => {
    const p = String(tc || "0:0:0:0").replace(/;/g, ":").split(":").map((x) => parseInt(x, 10) || 0);
    return ((p[0] * 60 + p[1]) * 60 + p[2]) * rf + (p[3] || 0);
  };
  const cur  = seguro(() => String(tl.GetCurrentTimecode()), "");
  const ini  = seguro(() => String(tl.GetStartTimecode()), "");
  const base = seguro(() => Number(tl.GetStartFrame()), 0) || 0;
  return base + (emFrames(cur) - emFrames(ini));
}

const lista = (x) => Array.isArray(x) ? x : (x && typeof x === "object" ? Object.values(x) : []);

function contaTrilhas(tl, tipo) {
  return seguro(() => Number(tl.GetTrackCount(tipo)), 0) || 0;
}

/* ESTA TRILHA ESTA LIVRE NO INTERVALO [vs, ve)?

   O teste de sobreposicao e `!(fim <= vs || inicio >= ve)` -- dois clipes so
   nao se tocam quando um termina antes do outro comecar.

   TRILHA QUE NAO EXISTE CONTA COMO LIVRE, e isso e de proposito: o Resolve
   cria a que faltar na hora de inserir. Negar isso deixaria o clipe sem
   nenhuma trilha para onde subir quando todas as existentes estao ocupadas. */
function trilhaLivreEm(tl, tipo, t, vs, ve) {
  if (seguro(() => tl.GetIsTrackLocked(tipo, t), false) === true) return false;
  for (const it of lista(seguro(() => tl.GetItemListInTrack(tipo, t), []))) {
    const s = seguro(() => Number(it.GetStart()), 0);
    const e = seguro(() => Number(it.GetEnd()), 0);
    if (!(e <= vs || s >= ve)) return false;
  }
  return true;
}

/* A PRIMEIRA TRILHA LIVRE NO INTERVALO, ou uma nova.

   E isto que faz o clipe "subir" em vez de sobrescrever: varre da 1 para cima,
   pula as travadas, e para na primeira sem sobreposicao. Se nenhuma estiver
   livre, cria uma. */
function trilhaLivre(tipo, vs, ve) {
  const tl = timelineAtual();
  if (!tl) return 0;
  const n = contaTrilhas(tl, tipo);
  for (let t = 1; t <= n; t++) if (trilhaLivreEm(tl, tipo, t, vs, ve)) return t;
  seguro(() => tl.AddTrack(tipo), null);
  return contaTrilhas(tl, tipo);
}
function trilhaLivreAudio(vs, ve) { return trilhaLivre("audio", vs, ve); }

/* =====================================================================
   O PAR DE TRILHAS PARA UM CLIPE COM VIDEO E AUDIO  (1.9.13)

   AFERIDO NO RESOLVE STUDIO 21, e nao deduzido -- as tres coisas abaixo nao
   estao na documentacao e a segunda e perigosa:

     1. sem mediaType, o AppendToTimeline poe o video em V<n> e o audio em
        A<n>, o MESMO indice. Nao ha como pedir indices diferentes.
     2. se A<n> estiver PARCIALMENTE ocupada, o audio entra CORTADO no espaco
        que sobrou -- e a chamada devolve sucesso. Num teste, um clipe de 96
        frames virou um de 20, com os primeiros 76 sumidos e nenhum aviso.
     3. se A<n> estiver TOTALMENTE ocupada, a insercao inteira falha: nem o
        video entra.

   Por isso aqui a pergunta e por PAR: o indice so serve se as DUAS estiverem
   livres. Procurar so a trilha de video livre e o caminho para o caso 2, que
   e o pior dos tres porque nao parece erro nenhum.

   As trilhas que faltarem sao criadas AQUI, uma a uma. O Resolve cria sozinho
   a trilha do indice pedido, mas so foi aferido um passo alem da ultima --
   pedir um indice tres acima e uma aposta que nao precisa ser feita. */
function parLivreAV(vs, ve) {
  const tl = timelineAtual();
  if (!tl) return 0;
  const n = Math.max(contaTrilhas(tl, "video"), contaTrilhas(tl, "audio"));

  let alvo = 0;
  for (let t = 1; t <= n; t++) {
    if (trilhaLivreEm(tl, "video", t, vs, ve) && trilhaLivreEm(tl, "audio", t, vs, ve)) { alvo = t; break; }
  }
  if (!alvo) alvo = n + 1;

  for (let i = contaTrilhas(tl, "video"); i < alvo; i++) seguro(() => tl.AddTrack("video"), null);
  for (let i = contaTrilhas(tl, "audio"); i < alvo; i++) seguro(() => tl.AddTrack("audio"), null);

  // criar pode falhar (timeline travada, por exemplo). Sem as duas, nao insere.
  if (contaTrilhas(tl, "video") < alvo || contaTrilhas(tl, "audio") < alvo) return 0;
  return alvo;
}

/* Este arquivo, neste tempo, ja esta na timeline? Guarda anti-duplicata: sem
   ela, baixar duas vezes o mesmo trecho empilha dois clipes iguais.

   O TIPO DE TRILHA VEM DE FORA. Procurar o video nas trilhas de audio nao
   acha nada -- e "nao achei" aqui significa "pode inserir de novo", entao o
   engano nao apareceria como erro, e sim como clipe duplicado. */
function jaEstaNaTimeline(nome, vs, ve, tipo) {
  const tl = timelineAtual();
  if (!tl) return 0;
  const t0 = tipo || "audio";
  const n = contaTrilhas(tl, t0);
  for (let t = 1; t <= n; t++) {
    for (const it of lista(seguro(() => tl.GetItemListInTrack(t0, t), []))) {
      const s = seguro(() => Number(it.GetStart()), 0);
      const e = seguro(() => Number(it.GetEnd()), 0);
      if (e <= vs || s >= ve) continue;
      if (String(seguro(() => it.GetName(), "")) === nome) return t;
    }
  }
  return 0;
}

/* INSERE O CLIPE NA TIMELINE, na posicao do playhead.

   Devolve { ok, trilha, erro }.

   O `+ 1` no endFrame NAO e engano: o GetSourceEndFrame do Resolve e
   INCLUSIVO e o endFrame do AppendToTimeline e EXCLUSIVO. Aferido no Edyta --
   sem ele o audio entra UM FRAME mais curto, e esse bug esteve em todo
   round-trip daquele projeto ate a v0.10.0. */
function insereNaTimeline(mpi, duracaoSeg, nome, comVideo) {
  const tl = timelineAtual();
  if (!tl)  return { ok: false, erro: "nenhuma timeline aberta" };
  if (!mpi) return { ok: false, erro: "o clipe nao chegou ao Media Pool" };

  const fps = fpsDaTimeline();
  const dur = Math.max(1, Math.round(duracaoSeg * fps));
  const vs  = playheadFrame();
  const ve  = vs + dur;

  /* O TIPO DA TRILHA E O ROTULO ANDAM JUNTOS. "A3" e "V3" sao trilhas
     diferentes, e a frase que a pessoa le e a mesma que o log guarda. */
  const rot = comVideo ? "V" : "A";

  const dup = jaEstaNaTimeline(nome, vs, ve, comVideo ? "video" : "audio");
  if (dup) return { ok: false, erro: "esse clipe ja esta em " + rot + dup + ", nesse mesmo ponto" };

  const trilha = comVideo ? parLivreAV(vs, ve) : trilhaLivre("audio", vs, ve);
  if (!trilha) return { ok: false, erro: comVideo
    ? "nao consegui um par de trilhas de video e audio livres"
    : "nao consegui uma trilha de audio" };

  const mp = mediaPool();
  if (!mp) return { ok: false, erro: "Media Pool indisponivel" };

  /* EM VIDEO O mediaType NAO VAI.

     1 e "so video" e 2 e "so audio" -- NAO EXISTE valor para "os dois". Quem
     entrega video e audio ligados e a AUSENCIA do campo, e foi o mediaType: 2
     cravado aqui que fez o mp4 chegar na timeline como uma faixa de audio
     sozinha, ate a 1.9.12. */
  const info = {
    mediaPoolItem: mpi,
    startFrame: 0,
    endFrame: dur,          // exclusivo: 0..dur-1 sao os frames usados
    recordFrame: vs,
    trackIndex: trilha,
  };
  if (!comVideo) info.mediaType = 2;

  const item = seguro(() => mp.AppendToTimeline([info]), null);

  // AppendToTimeline devolve LISTA VAZIA quando recusa, e nao excecao -- a
  // mesma armadilha do AddItemListToMediaPool.
  const entrou = Array.isArray(item) ? item.length > 0 : !!item;
  if (!entrou) return { ok: false, erro: "o Resolve recusou a insercao" };
  return { ok: true, trilha, rot };
}

function nomeDoProjeto() {
  const p = projetoAtual();
  if (!p) return null;
  return seguro(() => p.GetName(), null);
}

function diagnostico() {
  return {
    achado: WI_ACHADO,
    tentados: WI_TENTADOS.slice(),
    conectado: !!(_wi && _resolve),
    projeto: nomeDoProjeto(),
  };
}

/* Forca a proxima chamada a refazer a busca inteira. A tela de Ajustes usa
   isto no botao "tentar de novo" -- sem limpar os dois, o cache devolveria o
   mesmo estado meio conectado e o botao pareceria nao fazer nada. */
function esqueceConexao() {
  _wi = null;
  _resolve = null;
}

module.exports = {
  PLUGIN_ID,
  carregaWI, getResolve, seguro,
  projetoAtual, mediaPool, importaNoMediaPool,
  nomeDoProjeto, diagnostico, esqueceConexao,
  raizDoProjeto, pastaDeDestino, pontuaPasta,
  raizPorFrequencia, raizPorVotacao,
  timelineAtual, fpsDaTimeline, playheadFrame, __teste,
  trilhaLivre, trilhaLivreAudio, parLivreAV, jaEstaNaTimeline, insereNaTimeline,
};
