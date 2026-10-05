// ===================================================================================
//   Direct Download — os idiomas
//
//   O app ABRE EM INGLES. Ele vai para as maos de editores de qualquer lugar, e
//   ingles e o denominador comum nesse meio -- o proprio Resolve so existe em
//   ingles na interface de plugins.
//
//   COMO ISTO FUNCIONA: cada texto da interface tem uma chave, e o HTML marca
//   onde ela vai com data-i18n. Trocar de idioma reescreve so esses pontos.
//
//   POR QUE NAO ESPALHAR AS FRASES PELO CODIGO: porque no dia em que entrar um
//   quarto idioma, ou mudar uma palavra, ninguem vai lembrar de todos os
//   lugares. Aqui a lista inteira cabe numa tela.
// ===================================================================================

const IDIOMAS = {
  en: {
    _nome: "English",
    colar: "Paste the link (Cmd+V)",
    colarTitulo: "Paste a link", colarSub: "to start",
    seguirProjeto: "Follow the project folder",
    naTimeline: "Insert on the timeline",
    naTimelineNota: "Every download goes into the open timeline, at the playhead. You can also drag the green button there whenever you want.",
    baixarBt: "DOWNLOAD",
    /* O ROTULO DO ESTADO VERDE ANUNCIA A ACAO, E NAO O ESTADO  (2.3.1)

       Ele dizia DOWNLOADED / BAIXADO / DESCARGADO -- e o botao, naquele
       estado, ja e outra coisa: ele tem draggable=true, ganha uma alca
       (.alca-ar), troca o cursor e tem tooltip. Tres sinais ensinando o
       arraste, e a palavra ainda contando um estado que o VERDE ja conta.

       O NOME DA CHAVE MUDOU JUNTO. Ela se chamava `baixadoBt`, e um nome que
       diz "baixado" para um rotulo que diz "arrastar" e o comeco de uma sessao
       perdida -- e a mesma armadilha do comentario que envelhece, agora numa
       chave de dicionario.

       CURTO DE PROPOSITO. A barra "ja estava no limite" (o comentario do
       index.html diz isso), e ha uma armadilha de cascata registrada que
       deixou justamente este botao com 230px. As tres palavras novas sao mais
       CURTAS que as antigas -- DOWNLOADED tinha 10 letras, DRAG tem 4 --,
       entao a medida que a versao anterior fez em Chromium continua valendo
       com folga. Quem diz a frase inteira e o tooltip, logo abaixo. */
    arrastarBt: "DRAG",
    arrasteTimeline: "Drag to the Resolve timeline",
    /* 2.0.0 — o trecho pronto envelhece quando o In/Out muda */
    trechoMudou: "The stretch changed — download again to get this one",
    refazendo: "Re-cutting the stretch...",
    trechoPronto: "New stretch ready: ",
    /* A dica do campo de timecode. Ela diz a REGRA, que e o que nao se
       adivinha: os digitos encaixam da direita para a esquerda. */
    digiteTc: "Type the timecode \u2014 the digits fill in from the right (frames). Enter applies, Esc cancels.",
    mnAbrir: "Open the folder", mnEscolher: "Choose folder\u2026",
    disponivel: "available", oQueMudou: "What changed", fechar: "Close",
    updBaixar: "Download", updDepois: "Not now",
    pastaAgora: "Saving to: ", autoLigado: "Now following the project folder.",
    autoDesligado: "No longer following the project folder.",
    qualidade: "Video quality",
    qualidadeNota: "Prefers this height. If the video doesn't have it, downloads the best below.",
    naTrilha: "Inserted on track ",
    timelineNao: "Saved, but not inserted: ",
    autoOff: "Off \u2014 using the folder above.",
    autoSem: "No project open in Resolve.",
    autoFalhou: "Could not detect the project root \u2014 using the folder above.",
    autoCaiu: "Project root not found; saved to the folder from Settings.",
    analisandoTitulo: "Analyzing\u2026",
    atalhos: "Shortcuts", ajustes: "Settings", fixar: "Keep on top",
    /* A BUSCA  (1.8.8) */
    buscar: "Search YouTube", fechar: "Close", escolherDestino: "Choose the destination folder",
    buscarPh: "Search YouTube", buscarDica: "Type to search",
    buscando: "Searching…", buscaVazia: "Nothing found.",
    buscaErro: "Search failed: ",
    previaTocar: "Preview", previaPausar: "Pause",
    previaErro: "Couldn't play the preview: ",
    previaBuscando: "Finding the track…",
    videoPreparando: "Getting the picture…",
    videoErro: "Couldn't show the video: ",
    fmtAudio: "Audio", fmtVideo: "Video",
    trimDica: "Trim: download only between In and Out",
    autoplay: "Play on open",
    autoplayNota: "When the waveform is ready, the track starts. Turn this off if you usually open several links in a row.",
    cookies: "Browser cookies", cookiesNenhum: "None",
    abrirCookies: "Turn on browser cookies in Settings",
    bloqTitulo: "Unblock the download", destravar: "Unblock the download",
    bloqTexto: "YouTube asked to confirm you are not a bot. This is not a problem with the video: it blocks requests it does not recognise \u2014 usually because of a VPN, a shared network, or too many requests in a row.",
    bloqComCookies: "Use your browser session", bloqComUpdate: "Or update yt-dlp",
    bloqCookiesNota: "yt-dlp reads the cookies from your browser on this machine and sends them along. Nothing leaves your computer, and the panel never sees them.",
    bloqUpdateNota: "YouTube changes how extraction works often, and a yt-dlp from a couple of months ago simply stops working. About 35 MB.",
    bloqUsar: "Use", bloqAgoraNao: "Not now",
    bloqTentando: "Trying again...",
    cookiesNota: "Use this when YouTube asks you to confirm you are not a bot. Safari needs Full Disk Access for the plugin.",
    qualidadeAudio: "Audio format",
    qualidadeAudioNota: "WAVE is the clean path for editing. MP3 is for when the file has to be light.",
    aoVivo: "LIVE", semAoVivo: "A live stream has no end — pick a finished video.",
    audio: "Audio", video: "Video", tudo: "All",
    marcarIn: "Mark In (I)", marcarOut: "Mark Out (O)",
    moverPlayhead: "Drag to move the playhead",
    parar: "Stop (back to start)",
    tocar: "Play / pause (space)", voltar1: "Back 1s", frente1: "Forward 1s",
    aproximar: "Zoom in (=)", afastar: "Zoom out (−)", ajustar: "Fit all (0)",
    mudo: "Mute", abrirPasta: "Open folder",
    baixar: "DOWNLOAD",
    processando: "PROCESSING...",
    analisando: "ANALYZING...",
    // mensagens
    colePrimeiro: "Paste a link first.",
    consultando: "Reading the link...",
    baixandoAudio: "Downloading audio",
    lendoOnda: "Reading the waveform...",
    pronto: "Ready. Drag over the waveform to pick a section.",
    naoLi: "Couldn't read the link: ",
    semDuracao: "The link opened but has no duration (live stream?).",
    faltaBin: "Missing binaries: ",
    semOnda: "Audio is ready, but I couldn't draw the waveform: ",
    escolhaPasta: "Choose a destination folder in Settings.",
    sumiu: "The temporary audio is gone. Paste the link again.",
    cortando: "Trimming ",
    convertendo: "Converting...",
    baixandoVideo: "Downloading video...",
    importando: "Importing into the Media Pool...",
    noPool: "In the Media Pool: ",
    jaNoPool: "Already in the Media Pool: ",
    poolRecusou: ", but the Media Pool refused it: ",
    videoFalhou: "Audio saved, but the video failed: ",
    videoDepois: "The video isn't on disk yet — it will download now.",
    falhou: "Failed: ",
    baixando: "Downloading... ",
    // ajustes
    ondeSalvar: "Where to save", trocar: "Change",
    corDaOnda: "Waveform color", idioma: "Language",
    conexao: "Resolve connection", tentarDeNovo: "Try again",
    binarios: "Binaries", sobre: "About",
    conectado: "Connected", naoConectado: "Not connected",
    semProjeto: "no project open", projeto: "project: ",
    atualizaMotor: "Updates yt-dlp to the latest version",
    /* DUAS CHAVES PARA DOIS BOTOES  (2.3.3). O dos Ajustes perdeu o titulo
       "CORE ENGINE" que ficava em cima dele, entao o rotulo passou a dizer o
       que ele atualiza. O da janela de destravar continua "UPDATE": la o
       texto ao lado ja explica, e o botao divide a linha com outro. */
    update: "UPDATE", updateMotor: "UPDATE ENGINE",
    atualizando: "UPDATING...", atualizado: "UPDATED",
    // atalhos
    tAtalhos: "Shortcuts",
    tEspaco: "play / pause", tI: "mark In here", tO: "mark Out here",
    tSetas: "move one frame", tSetasShift: "skip 1 second", tA: "switch Trim on / off",
    tK: "stop, back to start",
    tZoom: "zoom in / out", tZero: "fit the whole waveform",
    tColar: "paste the link and load", tBaixar: "download",
    tEsc: "close this window",
    tDuploClique: "double-click", tTc: "type into the first three timecodes",
    tNota: "Shortcuts don't work while the cursor is in the link field — there the keys are text.",
  },

  pt: {
    _nome: "Português",
    colar: "Cole o link (Cmd+V)",
    colarTitulo: "Cole um link", colarSub: "para come\u00e7ar",
    seguirProjeto: "Seguir a pasta do projeto",
    naTimeline: "Inserir na timeline",
    naTimelineNota: "Cada download entra na timeline aberta, no playhead. Você também pode arrastar o botão verde para lá quando quiser.",
    baixarBt: "BAIXAR",
    arrastarBt: "ARRASTAR",
    arrasteTimeline: "Arraste para a timeline do Resolve",
    trechoMudou: "O trecho mudou — baixe de novo para levar este",
    refazendo: "Refazendo o trecho...",
    trechoPronto: "Trecho novo pronto: ",
    digiteTc: "Digite o timecode \u2014 os n\u00fameros encaixam da direita para a esquerda (quadros). Enter aplica, Esc desiste.",
    mnAbrir: "Abrir a pasta", mnEscolher: "Escolher pasta\u2026",
    disponivel: "dispon\u00edvel", oQueMudou: "O que mudou", fechar: "Fechar",
    updBaixar: "Baixar", updDepois: "Agora n\u00e3o",
    pastaAgora: "Salvando em: ", autoLigado: "Agora seguindo a pasta do projeto.",
    autoDesligado: "Nao segue mais a pasta do projeto.",
    qualidade: "Qualidade do v\u00eddeo",
    qualidadeNota: "Prioriza essa altura. Se o v\u00eddeo n\u00e3o tiver, baixa a melhor abaixo dela.",
    naTrilha: "Inserido na trilha ",
    timelineNao: "Salvo, mas nao inserido: ",
    autoOff: "Desligado \u2014 usando a pasta acima.",
    autoSem: "Nenhum projeto aberto no Resolve.",
    autoFalhou: "N\u00e3o deu para deduzir a raiz do projeto \u2014 usando a pasta acima.",
    autoCaiu: "Raiz do projeto n\u00e3o encontrada; salvei na pasta dos Ajustes.",
    analisandoTitulo: "Analisando\u2026",
    atalhos: "Atalhos", ajustes: "Ajustes", fixar: "Manter na frente",
    /* A BUSCA  (1.8.8) */
    buscar: "Buscar no YouTube", fechar: "Fechar", escolherDestino: "Escolher a pasta de destino",
    buscarPh: "Buscar no YouTube", buscarDica: "Digite para buscar",
    buscando: "Buscando…", buscaVazia: "Nada encontrado.",
    buscaErro: "A busca falhou: ",
    previaTocar: "Ouvir antes", previaPausar: "Pausar",
    previaErro: "Não consegui tocar a prévia: ",
    previaBuscando: "Buscando a faixa…",
    videoPreparando: "Buscando a imagem…",
    videoErro: "Não consegui mostrar o vídeo: ",
    fmtAudio: "Áudio", fmtVideo: "Vídeo",
    trimDica: "Trim: baixa só o trecho entre In e Out",
    autoplay: "Tocar sozinho ao abrir",
    autoplayNota: "Quando a onda fica pronta, a música já começa. Desligue se você costuma abrir vários links seguidos.",
    cookies: "Cookies do navegador", cookiesNenhum: "Nenhum",
    abrirCookies: "Ligar os cookies nos Ajustes",
    bloqTitulo: "Destravar o download", destravar: "Destravar o download",
    bloqTexto: "O YouTube pediu para confirmar que voc\u00ea n\u00e3o \u00e9 um rob\u00f4. N\u00e3o \u00e9 problema do v\u00eddeo: ele barra pedidos que n\u00e3o reconhece, normalmente por VPN, rede compartilhada, ou muitos pedidos seguidos.",
    bloqComCookies: "Usar a sua sess\u00e3o do navegador", bloqComUpdate: "Ou atualizar o yt-dlp",
    bloqCookiesNota: "O yt-dlp l\u00ea os cookies do seu navegador nesta m\u00e1quina e manda junto. Nada sai do seu computador, e o painel nunca os v\u00ea.",
    bloqUpdateNota: "O YouTube muda a extra\u00e7\u00e3o com frequ\u00eancia, e um yt-dlp de dois meses atr\u00e1s simplesmente para de baixar. S\u00e3o uns 35 MB.",
    bloqUsar: "Usar", bloqAgoraNao: "Agora n\u00e3o",
    bloqTentando: "Tentando de novo...",
    cookiesNota: "Use quando o YouTube pedir para confirmar que você não é um robô. O Safari exige Acesso Total ao Disco para o plugin.",
    qualidadeAudio: "Formato do áudio",
    qualidadeAudioNota: "O WAVE é o caminho limpo para editar. O MP3 serve quando o arquivo precisa ser leve.",
    aoVivo: "AO VIVO", semAoVivo: "Transmissão ao vivo não tem fim — escolha um vídeo terminado.",
    audio: "Áudio", video: "Vídeo", tudo: "Tudo",
    marcarIn: "Marcar In (I)", marcarOut: "Marcar Out (O)",
    moverPlayhead: "Arraste para mover o playhead",
    parar: "Parar (volta ao come\u00e7o)",
    tocar: "Tocar / pausar (espaço)", voltar1: "Voltar 1s", frente1: "Avançar 1s",
    aproximar: "Aproximar (=)", afastar: "Afastar (−)", ajustar: "Ajustar tudo (0)",
    mudo: "Mudo", abrirPasta: "Abrir a pasta",
    baixar: "BAIXAR",
    processando: "PROCESSANDO...",
    analisando: "ANALISANDO...",
    colePrimeiro: "Cole um link primeiro.",
    consultando: "Consultando o link...",
    baixandoAudio: "Baixando o áudio",
    lendoOnda: "Lendo a forma de onda...",
    pronto: "Pronto. Arraste sobre a onda para escolher o trecho.",
    naoLi: "Não consegui ler o link: ",
    semDuracao: "O link abriu mas não tem duração (transmissão ao vivo?).",
    faltaBin: "Faltam binários: ",
    semOnda: "Áudio pronto, mas não consegui desenhar a onda: ",
    escolhaPasta: "Escolha a pasta de destino em Ajustes.",
    sumiu: "O áudio temporário sumiu. Cole o link de novo.",
    cortando: "Cortando ",
    convertendo: "Convertendo...",
    baixandoVideo: "Baixando o vídeo...",
    importando: "Importando no Media Pool...",
    noPool: "No Media Pool: ",
    jaNoPool: "Ja estava no Media Pool: ",
    poolRecusou: ", mas o Media Pool recusou: ",
    videoFalhou: "Áudio salvo, mas o vídeo falhou: ",
    videoDepois: "O vídeo ainda não está no disco — vai baixar agora.",
    falhou: "Falhou: ",
    baixando: "Baixando... ",
    ondeSalvar: "Onde salvar", trocar: "Trocar",
    corDaOnda: "Cor da onda", idioma: "Idioma",
    conexao: "Conexão com o Resolve", tentarDeNovo: "Tentar de novo",
    binarios: "Binários", sobre: "Sobre",
    conectado: "Conectado", naoConectado: "Não conectado",
    semProjeto: "nenhum projeto aberto", projeto: "projeto: ",
    atualizaMotor: "Atualiza o yt-dlp para a versão mais recente",
    update: "ATUALIZAR", updateMotor: "ATUALIZAR ENGINE",
    atualizando: "ATUALIZANDO...", atualizado: "ATUALIZADO",
    tAtalhos: "Atalhos",
    tEspaco: "tocar / pausar", tI: "marcar In aqui", tO: "marcar Out aqui",
    tSetas: "anda um quadro", tSetasShift: "pula 1 segundo", tA: "liga e desliga o Trim",
    tK: "parar, volta ao come\u00e7o",
    tZoom: "aproximar / afastar", tZero: "ajustar a onda inteira",
    tColar: "colar o link e carregar", tBaixar: "baixar",
    tEsc: "fechar esta janela",
    tDuploClique: "duplo clique", tTc: "digitar nos tr\u00eas primeiros timecodes",
    tNota: "Os atalhos não funcionam com o cursor dentro do campo de link — ali as teclas são texto.",
  },

  es: {
    _nome: "Español",
    colar: "Pega el enlace (Cmd+V)",
    colarTitulo: "Pega un enlace", colarSub: "para empezar",
    seguirProjeto: "Seguir la carpeta del proyecto",
    naTimeline: "Insertar en la línea de tiempo",
    naTimelineNota: "Cada descarga entra en la línea de tiempo abierta, en el cabezal. También puedes arrastrar el botón verde hasta allí cuando quieras.",
    baixarBt: "DESCARGAR",
    arrastarBt: "ARRASTRAR",
    arrasteTimeline: "Arrastra a la l\u00ednea de tiempo de Resolve",
    trechoMudou: "El tramo cambi\u00f3 — desc\u00e1rgalo de nuevo para llevar este",
    refazendo: "Rehaciendo el tramo...",
    trechoPronto: "Tramo nuevo listo: ",
    digiteTc: "Escribe el timecode \u2014 los d\u00edgitos encajan de derecha a izquierda (cuadros). Enter aplica, Esc cancela.",
    mnAbrir: "Abrir la carpeta", mnEscolher: "Elegir carpeta\u2026",
    disponivel: "disponible", oQueMudou: "Qu\u00e9 cambi\u00f3", fechar: "Cerrar",
    updBaixar: "Descargar", updDepois: "Ahora no",
    pastaAgora: "Guardando en: ", autoLigado: "Ahora sigue la carpeta del proyecto.",
    autoDesligado: "Ya no sigue la carpeta del proyecto.",
    qualidade: "Calidad del video",
    qualidadeNota: "Prioriza esa altura. Si el video no la tiene, descarga la mejor por debajo.",
    naTrilha: "Insertado en la pista ",
    timelineNao: "Guardado, pero no insertado: ",
    autoOff: "Desactivado \u2014 usando la carpeta de arriba.",
    autoSem: "Ning\u00fan proyecto abierto en Resolve.",
    autoFalhou: "No se pudo deducir la ra\u00edz del proyecto \u2014 usando la carpeta de arriba.",
    autoCaiu: "Ra\u00edz del proyecto no encontrada; guardado en la carpeta de Ajustes.",
    analisandoTitulo: "Analizando\u2026",
    atalhos: "Atajos", ajustes: "Ajustes", fixar: "Mantener al frente",
    /* LA BUSQUEDA  (1.8.8) */
    buscar: "Buscar en YouTube", fechar: "Cerrar", escolherDestino: "Elegir la carpeta de destino",
    buscarPh: "Buscar en YouTube", buscarDica: "Escribe para buscar",
    buscando: "Buscando…", buscaVazia: "No se encontró nada.",
    buscaErro: "La búsqueda falló: ",
    previaTocar: "Escuchar antes", previaPausar: "Pausar",
    previaErro: "No pude reproducir la vista previa: ",
    previaBuscando: "Buscando la pista…",
    videoPreparando: "Buscando la imagen…",
    videoErro: "No pude mostrar el video: ",
    fmtAudio: "Audio", fmtVideo: "Video",
    trimDica: "Trim: descarga solo el tramo entre In y Out",
    autoplay: "Reproducir al abrir",
    autoplayNota: "Cuando la onda queda lista, la música ya empieza. Desactívalo si sueles abrir varios enlaces seguidos.",
    cookies: "Cookies del navegador", cookiesNenhum: "Ninguno",
    abrirCookies: "Activar las cookies en Ajustes",
    bloqTitulo: "Desbloquear la descarga", destravar: "Desbloquear la descarga",
    bloqTexto: "YouTube pidi\u00f3 confirmar que no eres un robot. No es problema del v\u00eddeo: bloquea peticiones que no reconoce, normalmente por VPN, red compartida, o demasiadas peticiones seguidas.",
    bloqComCookies: "Usar tu sesi\u00f3n del navegador", bloqComUpdate: "O actualizar yt-dlp",
    bloqCookiesNota: "yt-dlp lee las cookies de tu navegador en esta m\u00e1quina y las env\u00eda. Nada sale de tu ordenador, y el panel nunca las ve.",
    bloqUpdateNota: "YouTube cambia la extracci\u00f3n con frecuencia, y un yt-dlp de hace dos meses simplemente deja de funcionar. Son unos 35 MB.",
    bloqUsar: "Usar", bloqAgoraNao: "Ahora no",
    bloqTentando: "Intentando de nuevo...",
    cookiesNota: "Úsalo cuando YouTube pida confirmar que no eres un robot. Safari exige Acceso Total al Disco para el plugin.",
    qualidadeAudio: "Formato del audio",
    qualidadeAudioNota: "El WAVE es el camino limpio para editar. El MP3 sirve cuando el archivo debe ser liviano.",
    aoVivo: "EN VIVO", semAoVivo: "Una transmisión en vivo no tiene fin — elige un video terminado.",
    audio: "Audio", video: "Video", tudo: "Todo",
    marcarIn: "Marcar In (I)", marcarOut: "Marcar Out (O)",
    moverPlayhead: "Arrastra para mover el playhead",
    parar: "Parar (vuelve al inicio)",
    tocar: "Reproducir / pausar (espacio)", voltar1: "Atrás 1s", frente1: "Adelante 1s",
    aproximar: "Acercar (=)", afastar: "Alejar (−)", ajustar: "Ajustar todo (0)",
    mudo: "Silenciar", abrirPasta: "Abrir la carpeta",
    baixar: "DESCARGAR",
    processando: "PROCESANDO...",
    analisando: "ANALIZANDO...",
    colePrimeiro: "Pega un enlace primero.",
    consultando: "Consultando el enlace...",
    baixandoAudio: "Descargando el audio",
    lendoOnda: "Leyendo la forma de onda...",
    pronto: "Listo. Arrastra sobre la onda para elegir el fragmento.",
    naoLi: "No pude leer el enlace: ",
    semDuracao: "El enlace abrió pero no tiene duración (¿transmisión en vivo?).",
    faltaBin: "Faltan binarios: ",
    semOnda: "Audio listo, pero no pude dibujar la onda: ",
    escolhaPasta: "Elige una carpeta de destino en Ajustes.",
    sumiu: "El audio temporal desapareció. Pega el enlace de nuevo.",
    cortando: "Cortando ",
    convertendo: "Convirtiendo...",
    baixandoVideo: "Descargando el video...",
    importando: "Importando al Media Pool...",
    noPool: "En el Media Pool: ",
    jaNoPool: "Ya estaba en el Media Pool: ",
    poolRecusou: ", pero el Media Pool lo rechazó: ",
    videoFalhou: "Audio guardado, pero el video falló: ",
    videoDepois: "El video aún no está en disco — se descargará ahora.",
    falhou: "Falló: ",
    baixando: "Descargando... ",
    ondeSalvar: "Dónde guardar", trocar: "Cambiar",
    corDaOnda: "Color de la onda", idioma: "Idioma",
    conexao: "Conexión con Resolve", tentarDeNovo: "Intentar de nuevo",
    binarios: "Binarios", sobre: "Acerca de",
    conectado: "Conectado", naoConectado: "No conectado",
    semProjeto: "ningún proyecto abierto", projeto: "proyecto: ",
    atualizaMotor: "Actualiza yt-dlp a la versión más reciente",
    update: "ACTUALIZAR", updateMotor: "ACTUALIZAR ENGINE",
    atualizando: "ACTUALIZANDO...", atualizado: "ACTUALIZADO",
    tAtalhos: "Atajos",
    tEspaco: "reproducir / pausar", tI: "marcar In aquí", tO: "marcar Out aquí",
    tSetas: "avanza un cuadro", tSetasShift: "salta 1 segundo", tA: "activa y desactiva el Trim",
    tK: "parar, vuelve al inicio",
    tZoom: "acercar / alejar", tZero: "ajustar toda la onda",
    tColar: "pegar el enlace y cargar", tBaixar: "descargar",
    tEsc: "cerrar esta ventana",
    tDuploClique: "doble clic", tTc: "escribir en los tres primeros timecodes",
    tNota: "Los atajos no funcionan con el cursor dentro del campo de enlace — ahí las teclas son texto.",
  },
};

/* O idioma comeca em INGLES e nao adivinha pelo sistema. Adivinhar erraria
   justamente em quem tem o macOS em ingles e quer o app em portugues -- e a
   escolha fica guardada, entao o custo e um clique, uma vez. */
let LANG = "en";

function txt(chave) {
  const d = IDIOMAS[LANG] || IDIOMAS.en;
  return d[chave] !== undefined ? d[chave] : (IDIOMAS.en[chave] || chave);
}

/* ===========================================================================
   O TECLADO DO WINDOWS NAO TEM A TECLA COMMAND  (1.8.4)

   O painel mostrava o simbolo do Command em tres lugares, e no Windows os tres
   nomeavam uma tecla que a pessoa nao tem no teclado:

     . a frase da tela inicial ("⌘+V to start")   <- este ja era trocado
     . o placeholder do campo de link              <- vinha do dicionario
     . a lista de atalhos (⌘V e ⌘↵)               <- estava cravado no HTML

   Por que a correcao mora AQUI e nao no app.js: as tres cadeias sao reescritas
   por aplicaIdioma(), que roda a cada troca de idioma. Consertar em outro
   lugar funcionaria uma vez e seria desfeito no primeiro clique no seletor de
   idioma -- o tipo de defeito que so aparece para quem fala espanhol.

   O ATALHO EM SI SEMPRE FUNCIONOU nos dois sistemas: o app.js testa
   `ev.metaKey || ev.ctrlKey`. O que estava errado era so o rotulo.
   =========================================================================== */
const NO_WINDOWS = (typeof process !== "undefined" && process.platform === "win32");

/* No Mac, o Return na lista de atalhos aparece como simbolo; no Windows a
   tecla se chama Enter e nao tem simbolo consagrado. */
const MOD_TXT = NO_WINDOWS ? "Ctrl" : "⌘";      // Ctrl  /  ⌘
const MOD_KBD = NO_WINDOWS ? "Ctrl+" : "⌘";     // "Ctrl+V"  /  "⌘V"
const ENTER_KBD = NO_WINDOWS ? "Enter" : "↵";   // Enter  /  ↵

function ajustaTeclas() {
  // a frase da tela inicial: "<span id=pMod>⌘</span>+V to start"
  const m = document.getElementById("pMod");
  if (m) m.textContent = MOD_TXT;
  // a lista de atalhos
  const kV = document.getElementById("kColar");
  if (kV) kV.textContent = MOD_KBD + "V";
  const kE = document.getElementById("kBaixar");
  if (kE) kE.textContent = MOD_KBD + ENTER_KBD;
  // o placeholder do campo: o dicionario escreve "(Cmd+V)" nos tres idiomas,
  // e so o modificador muda
  if (NO_WINDOWS) {
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      if (el.placeholder) el.placeholder = el.placeholder.replace(/Cmd\+/g, "Ctrl+");
    });
  }
}

/* Reescreve tudo que estiver marcado no HTML. `data-i18n` troca o texto,
   `data-i18n-title` troca a dica que aparece ao parar o mouse, e
   `data-i18n-ph` o placeholder do campo. */
function aplicaIdioma(nome) {
  if (!IDIOMAS[nome]) nome = "en";
  LANG = nome;
  try { localStorage.setItem("dd_lang", nome); } catch (e) {}

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = txt(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = txt(el.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = txt(el.dataset.i18nPh);
  });
  const sel = document.getElementById("selIdioma");
  if (sel) sel.value = nome;

  // POR ULTIMO, e dentro desta funcao: os tres pontos acabaram de ser
  // reescritos com o texto do dicionario, que fala em Cmd.
  ajustaTeclas();
}

module.exports = { IDIOMAS, txt, aplicaIdioma, ajustaTeclas, NO_WINDOWS, get LANG() { return LANG; } };
