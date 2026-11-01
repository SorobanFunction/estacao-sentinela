
// ==========================================
// ELEMENTOS DO HTML
// ==========================================

const riskElement = document.getElementById("risk");
const riskStatus = document.getElementById("risk-status");
const riskDescription = document.getElementById("risk-description");
const riskCard = document.getElementById("risk-card");

const gasValue = document.getElementById("gas-value");
const gasStatus = document.getElementById("gas-status");

const pirValue = document.getElementById("pir-value");
const pirStatus = document.getElementById("pir-status");

const gasControl = document.getElementById("gas-control");
const gasControlValue = document.getElementById("gas-control-value");
const pirControl = document.getElementById("pir-control");

const lastUpdate = document.getElementById("last-update");
const eventList = document.getElementById("event-list");

const canvas = document.getElementById("risk-chart");
const ctx = canvas.getContext("2d");

// Elementos de conexão e modo

const connectionIndicator = document.getElementById("connection-indicator");
const connectionStatus = document.getElementById("connection-status");
const modeLabel = document.getElementById("mode-label");
const simulationPanel = document.getElementById("simulation-panel");
const footerMode = document.getElementById("footer-mode");

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const GAS_THRESHOLD = 2500;

const MAX_HISTORY = 30;
const MAX_EVENTS = 10;

const DEVICE_TIMEOUT = 5000;

// ==========================================
// CONFIGURAÇÕES MQTT
// ==========================================

const MQTT_BROKER = "wss://broker.emqx.io:8084/mqtt";

// Cada dispositivo possui seu próprio tópico.

const MQTT_TOPICS = {
    wokwi: "estacao-sentinela/wokwi/status",
    physical: "estacao-sentinela/fisica/status"
};

let mqttClient = null;

let mqttConectado = false;

let lastMessageAt = 0;

let modoAtual = null;

let topicoAtivo = null;

// ==========================================
// VARIÁVEIS DO SISTEMA
// ==========================================

let history = [];
let events = [];

let previousAlert = false;
let previousGasAnomaly = false;
let previousMovement = false;

// ==========================================
// IDENTIFICAÇÃO DOS MODOS
// ==========================================

function obterNomeModo(mode) {

    const nomes = {
        wokwi: "Demonstração — Wokwi",
        physical: "Real — ESP32 físico",
        manual: "Simulação manual"
    };

    return nomes[mode] || "Modo desconhecido";
}

function obterTopicoModo() {

    if (modoAtual === "wokwi") {
        return MQTT_TOPICS.wokwi;
    }

    if (modoAtual === "physical") {
        return MQTT_TOPICS.physical;
    }

    return null;
}

// ==========================================
// ESTADO DA CONEXÃO
// ==========================================

function setConnectionState(state, message) {

    connectionIndicator.classList.remove(
        "online",
        "offline",
        "connecting"
    );

    connectionIndicator.classList.add(state);

    connectionStatus.textContent = message;
}

// ==========================================
// IDENTIFICAÇÃO DE DADOS DESATUALIZADOS
// ==========================================

function marcarDadosDesatualizados() {

    if (!lastMessageAt || modoAtual === "manual") {
        return;
    }

    const segundos =
        Math.floor((Date.now() - lastMessageAt) / 1000);

    const ultimaLeitura =
        new Date(lastMessageAt).toLocaleTimeString("pt-BR");

    riskDescription.textContent =
        "DADOS DESATUALIZADOS — última leitura recebida há " +
        segundos +
        " segundos.";

    lastUpdate.textContent =
        "Última leitura: " +
        ultimaLeitura +
        " · Há " +
        segundos +
        " segundos";
}

function atualizarEstadoConexao() {

    // Simulação manual não depende de MQTT.

    if (modoAtual === "manual") {

        setConnectionState(
            "connecting",
            "Simulação local · MQTT não utilizado"
        );

        return;
    }

    if (!mqttConectado) {

        setConnectionState(
            mqttClient ? "offline" : "connecting",
            mqttClient
                ? "Broker desconectado"
                : "Conectando ao broker..."
        );

        marcarDadosDesatualizados();

        return;
    }

    if (!lastMessageAt) {

        setConnectionState(
            "connecting",
            modoAtual === "wokwi"
                ? "MQTT conectado · aguardando Wokwi"
                : "MQTT conectado · aguardando ESP32 físico"
        );

        return;
    }

    const tempoSemDados = Date.now() - lastMessageAt;

    if (tempoSemDados > DEVICE_TIMEOUT) {

        setConnectionState(
            "offline",
            modoAtual === "wokwi"
                ? "Wokwi sem comunicação"
                : "ESP32 físico sem comunicação"
        );

        marcarDadosDesatualizados();

        return;
    }

    setConnectionState(
        "online",
        modoAtual === "wokwi"
            ? "Wokwi enviando dados"
            : "ESP32 físico enviando dados"
    );
}

// ==========================================
// LIMPEZA DOS DADOS AO TROCAR DE MODO
// ==========================================

function limparDadosDoPainel() {

    history = [];
    events = [];

    previousAlert = false;
    previousGasAnomaly = false;
    previousMovement = false;

    gasControl.value = 0;
    gasControlValue.textContent = "0";
    pirControl.checked = false;

    updateDashboardValues(
        0,
        false,
        false,
        0,
        false
    );

    // Remove a leitura inicial do histórico.
    history = [];

    drawChart();

    renderEvents();

    lastUpdate.textContent = "Aguardando dados...";
}

// ==========================================
// ASSINATURA DOS TÓPICOS MQTT
// ==========================================

function assinarTopicoAtivo() {

    if (!mqttClient || !mqttConectado) {
        return;
    }

    const novoTopico = obterTopicoModo();

    // No modo manual, não assinamos nenhum tópico.

    if (!novoTopico) {

        if (topicoAtivo) {

            mqttClient.unsubscribe(topicoAtivo);

            topicoAtivo = null;
        }

        console.log("Modo manual: nenhum tópico MQTT ativo.");

        atualizarEstadoConexao();

        return;
    }

    if (topicoAtivo === novoTopico) {
        return;
    }

    // Cancela a assinatura anterior.

    if (topicoAtivo) {

        mqttClient.unsubscribe(topicoAtivo);

        console.log("Tópico anterior cancelado:", topicoAtivo);
    }

    topicoAtivo = novoTopico;

    mqttClient.subscribe(novoTopico, (error) => {

        if (error) {

            console.error("Erro ao assinar tópico:", error);

            registerEvent("Erro ao assinar tópico MQTT.");

            return;
        }

        console.log("Tópico MQTT ativo:", novoTopico);

        atualizarEstadoConexao();
    });
}

// ==========================================
// ALTERNÂNCIA DOS TRÊS MODOS
// ==========================================

function setMode(mode, registrarEvento = true) {

    if (!["wokwi", "physical", "manual"].includes(mode)) {

        console.error("Modo inválido:", mode);

        return;
    }

    if (modoAtual === mode) {
        return;
    }

    const modoAnterior = modoAtual;

    modoAtual = mode;

    // Reinicia os dados para impedir mistura de origens.

    lastMessageAt = 0;

    limparDadosDoPainel();

    // Exibe os controles apenas na simulação manual.

    const demonstracaoManual = mode === "manual";

    simulationPanel.classList.toggle(
        "hidden",
        !demonstracaoManual
    );

    // Atualiza o botão de seleção.

    const textos = {
        wokwi: "DEMO · WOKWI",
        physical: "MODO REAL · ESP32",
        manual: "SIMULAÇÃO MANUAL"
    };

    modeLabel.textContent = textos[mode];

    modeLabel.classList.toggle(
        "demo",
        mode !== "physical"
    );

    modeLabel.setAttribute(
        "aria-label",
        "Origem atual: " + obterNomeModo(mode) +
        ". Clique para alternar."
    );

    // Atualiza o rodapé.

    const descricoes = {
        wokwi:
            "Demonstração — dados do ESP32 virtual via Wokwi e MQTT.",

        physical:
            "Modo real — dados dos sensores físicos via ESP32 e MQTT.",

        manual:
            "Simulação manual — dados gerados localmente no aplicativo."
    };

    footerMode.textContent = descricoes[mode];

    // Atualiza o tópico MQTT.

    if (mqttConectado) {
        assinarTopicoAtivo();
    }

    // Atualiza a conexão.

    atualizarEstadoConexao();

    // No modo manual, apresenta os valores iniciais locais.

    if (mode === "manual") {
        updateDashboard();
    }

    console.log(
        "Modo alterado:",
        obterNomeModo(mode)
    );

    if (registrarEvento) {

        registerEvent(
            "Origem dos dados alterada: " +
            obterNomeModo(modoAnterior) +
            " → " +
            obterNomeModo(mode) +
            "."
        );
    }
}

// Alterna entre Wokwi, físico e manual.

function alternarModo() {

    const ordemModos = [
        "wokwi",
        "physical",
        "manual"
    ];

    const indiceAtual = ordemModos.indexOf(modoAtual);

    const proximoIndice =
        (indiceAtual + 1) % ordemModos.length;

    setMode(ordemModos[proximoIndice]);
}

modeLabel.addEventListener("click", alternarModo);

// ==========================================
// CÁLCULO DO ÍNDICE
// SIMULAÇÃO MANUAL
// ==========================================

function calculateRisk(gas, pir) {

    const gasAnormal = gas >= GAS_THRESHOLD;

    let risk = 0;

    if (gasAnormal) {
        risk += 35;
    }

    if (pir) {
        risk += 25;
    }

    if (gasAnormal && pir) {
        risk = 85;
    }

    return {
        risk: Math.min(risk, 100),
        gasAnormal
    };
}

// ==========================================
// ATUALIZAÇÃO DO PAINEL
// SIMULAÇÃO MANUAL
// ==========================================

function updateDashboard() {

    if (modoAtual !== "manual") {
        return;
    }

    const gas = Number(gasControl.value);
    const pir = pirControl.checked;

    const result = calculateRisk(gas, pir);

    const risk = result.risk;
    const gasAnormal = result.gasAnormal;

    updateDashboardValues(
        gas,
        pir,
        gasAnormal,
        risk
    );
}

// ==========================================
// ATUALIZAÇÃO DO PAINEL
// DADOS DOS DISPOSITIVOS
// ==========================================

function updateDashboardFromDevice(data) {

    const gas = Number(data.gas);
    const pir = data.pir;
    const gasAnormal = data.gasAnormal;
    const risk = Number(data.risk);

    if (
        !Number.isFinite(gas) ||
        !Number.isFinite(risk) ||
        gas < 0 ||
        gas > 4095 ||
        risk < 0 ||
        risk > 100 ||
        typeof pir !== "boolean" ||
        typeof gasAnormal !== "boolean"
    ) {

        console.warn("Dados MQTT inválidos:", data);
        return false;
    }

    // Verifica a consistência entre os indicadores e o risco.
    const riscoEsperado = gasAnormal
        ? (pir ? 85 : 35)
        : (pir ? 25 : 0);

    if (risk !== riscoEsperado) {
        console.warn(
            "Risco inconsistente com os indicadores:",
            {
                recebido: risk,
                esperado: riscoEsperado,
                gas,
                pir,
                gasAnormal
            }
        );

        return false;
    }

    // Verifica a consistência do alerta combinado.
const alertaEsperado = gasAnormal && pir;

if (
    typeof data.alert !== "boolean" ||
    data.alert !== alertaEsperado
) {
    console.warn(
        "Alerta inconsistente com os indicadores:",
        {
            recebido: data.alert,
            esperado: alertaEsperado,
            gasAnormal,
            pir
        }
    );

    return false;
}

    // O risco é recebido do firmware.
    // Não recalculamos o índice no aplicativo.
    updateDashboardValues(gas, pir, gasAnormal, risk);

    return true;
}

// ==========================================
// ATUALIZAÇÃO COMPARTILHADA
// ==========================================

function updateDashboardValues(
    gas,
    pir,
    gasAnormal,
    risk,
    atualizarHorario = true
) {

    riskElement.textContent = risk;

    gasValue.textContent = gas;

    pirValue.textContent = pir
        ? "Detectado"
        : "Não detectado";

    gasControlValue.textContent = gas;

    gasStatus.textContent = gasAnormal
        ? "Alteração detectada"
        : "Normal";

    pirStatus.textContent = pir
        ? "Movimento detectado"
        : "Sem movimento";

    updateRiskStatus(risk);

    if (atualizarHorario) {

        lastUpdate.textContent =
            new Date().toLocaleTimeString("pt-BR");
    }

    registerChanges(gasAnormal, pir);

    history.push(risk);

    if (history.length > MAX_HISTORY) {
        history.shift();
    }

    drawChart();
}

// ==========================================
// ESTADO DO ÍNDICE DE RISCO
// ==========================================

function updateRiskStatus(risk) {

    riskCard.classList.remove(
        "status-normal",
        "status-warning",
        "status-danger"
    );

    if (risk >= 70) {

        riskCard.classList.add("status-danger");

        riskStatus.textContent = "Atenção elevada";

        riskDescription.textContent =
            "Dois indicadores apresentam alterações simultâneas.";

    } else if (risk >= 30) {

        riskCard.classList.add("status-warning");

        riskStatus.textContent = "Alteração identificada";

        riskDescription.textContent =
            "Um dos indicadores apresenta uma alteração.";

    } else {

        riskCard.classList.add("status-normal");

        riskStatus.textContent = "Condições normais";

        riskDescription.textContent =
            "Nenhuma alteração relevante detectada.";
    }
}

// ==========================================
// REGISTRO DE EVENTOS
// ==========================================

function registerChanges(gasAnormal, pir) {

    const alert = gasAnormal && pir;

    if (gasAnormal && !previousGasAnomaly) {

        registerEvent("Alteração no indicador de gás.");
    }

    if (pir && !previousMovement) {

        registerEvent("Movimento detectado.");
    }

    if (alert && !previousAlert) {

        registerEvent(
            "Alerta: alterações simultâneas nos dois indicadores."
        );
    }

    if (!gasAnormal && previousGasAnomaly) {

        registerEvent(
            "Indicador de gás voltou à faixa normal."
        );
    }

    if (!pir && previousMovement) {

        registerEvent(
            "Movimento deixou de ser detectado."
        );
    }

    previousGasAnomaly = gasAnormal;
    previousMovement = pir;
    previousAlert = alert;
}

function registerEvent(message) {

    const time = new Date().toLocaleTimeString("pt-BR");

    events.unshift({
        message,
        time
    });

    if (events.length > MAX_EVENTS) {
        events.pop();
    }

    renderEvents();
}

function renderEvents() {

    eventList.innerHTML = "";

    if (events.length === 0) {

        eventList.innerHTML =
            '<p class="empty">Nenhum evento registrado.</p>';

        return;
    }

    events.forEach(event => {

        const item = document.createElement("div");
        const message = document.createElement("span");
        const time = document.createElement("span");

        item.className = "event";
        time.className = "event-time";

        message.textContent = event.message;
        time.textContent = event.time;

        item.appendChild(message);
        item.appendChild(time);

        eventList.appendChild(item);
    });
}

// ==========================================
// GRÁFICO
// ==========================================

function drawChart() {

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (width === 0 || height === 0) {
        return;
    }

    const ratio = window.devicePixelRatio || 1;

    canvas.width = width * ratio;
    canvas.height = height * ratio;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "#26364d";
    ctx.lineWidth = 1;

    for (let value = 0; value <= 100; value += 25) {

        const y = height - (value / 100) * height;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    if (history.length < 2) {
        return;
    }

    ctx.beginPath();

    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    history.forEach((value, index) => {

        const x = (index / (MAX_HISTORY - 1)) * width;
        const y = height - (value / 100) * height;

        if (index === 0) {

            ctx.moveTo(x, y);

        } else {

            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();
}

// ==========================================
// CONTROLES MANUAIS
// ==========================================

// ==========================================
// CONTROLES MANUAIS
// ==========================================

function ativarModoManual() {

    if (modoAtual !== "manual") {

        setMode("manual");
    }
}

gasControl.addEventListener("input", () => {

    const valorSelecionado = gasControl.value;

    ativarModoManual();

    gasControl.value = valorSelecionado;

    updateDashboard();
});

pirControl.addEventListener("change", () => {

    const movimentoDetectado = pirControl.checked;

    ativarModoManual();

    pirControl.checked = movimentoDetectado;

    updateDashboard();
});

// ==========================================
// CENÁRIOS DE TESTE
// ==========================================

document.querySelectorAll("[data-preset]").forEach(button => {

    button.addEventListener("click", () => {

        ativarModoManual();

        const preset = button.dataset.preset;

        switch (preset) {

            case "normal":

                gasControl.value = 500;
                pirControl.checked = false;

                break;

            case "gas":

                gasControl.value = 3000;
                pirControl.checked = false;

                break;

            case "motion":

                gasControl.value = 500;
                pirControl.checked = true;

                break;

            case "combined":

                gasControl.value = 3000;
                pirControl.checked = true;

                break;
        }

        updateDashboard();
    });
});

// ==========================================
// CONEXÃO MQTT
// ==========================================

function conectarMQTT() {

    if (typeof mqtt === "undefined") {

        console.error("Biblioteca MQTT.js não foi carregada.");

        setConnectionState(
            "offline",
            "Biblioteca MQTT indisponível"
        );

        registerEvent("Erro: biblioteca MQTT indisponível.");

        return;
    }

    console.log("Conectando ao broker MQTT...");

    setConnectionState(
        "connecting",
        "Conectando ao broker..."
    );

    mqttClient = mqtt.connect(MQTT_BROKER, {

        clientId: "sentinela_web_" +
            Math.random().toString(16).slice(2),

        clean: true,

        connectTimeout: 10000,

        reconnectPeriod: 2000
    });

    mqttClient.on("connect", () => {

        mqttConectado = true;

        console.log("APLICATIVO CONECTADO AO MQTT!");

        assinarTopicoAtivo();

        atualizarEstadoConexao();
    });

    mqttClient.on("message", (topic, payload) => {

        // Ignora qualquer tópico que não seja o selecionado.

        if (topic !== obterTopicoModo()) {
            return;
        }

        if (modoAtual === "manual") {
            return;
        }

        try {

            const data = JSON.parse(payload.toString());

            console.log(
                "Dados recebidos:",
                obterNomeModo(modoAtual),
                data
            );

            const dadosValidos =
                updateDashboardFromDevice(data);

            if (dadosValidos) {

                lastMessageAt = Date.now();

                atualizarEstadoConexao();
            }

        } catch (error) {

            console.error(
                "Erro ao interpretar mensagem MQTT:",
                error
            );
        }
    });

    mqttClient.on("reconnect", () => {

        mqttConectado = false;

        console.log("Tentando reconectar ao MQTT...");

        atualizarEstadoConexao();
    });

    mqttClient.on("offline", () => {

        mqttConectado = false;

        console.warn("Aplicativo offline em relação ao MQTT.");

        atualizarEstadoConexao();
    });

    mqttClient.on("close", () => {

        mqttConectado = false;

        topicoAtivo = null;

        console.warn("Conexão MQTT encerrada.");

        atualizarEstadoConexao();
    });

    mqttClient.on("error", (error) => {

        console.error("Erro MQTT:", error);
    });
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================

// Inicializa os controles.

gasControl.value = 0;
pirControl.checked = false;

// Inicializa o painel.

updateDashboardValues(
    0,
    false,
    false,
    0,
    false
);

// Limpa o histórico inicial.

history = [];

drawChart();

lastUpdate.textContent = "Aguardando dados...";

// Inicializa o modo Wokwi.

setMode("wokwi", false);

// Inicializa o indicador de conexão.

setConnectionState(
    "connecting",
    "Conectando ao broker..."
);

// Inicia a conexão MQTT.

conectarMQTT();

// Verifica periodicamente a comunicação.

setInterval(() => {

    atualizarEstadoConexao();

}, 1000);

// Atualiza o gráfico ao redimensionar a janela.

window.addEventListener("resize", drawChart);
