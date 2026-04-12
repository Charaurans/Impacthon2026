//Llama a la api y manda datos al viewer

const API_URL = "https://api-mock-cesga.onrender.com";
let viewer;
let viewerContainer;
let fullLog ="";
let currentPdbData = null;
let currentPdbId = "sintetica";
let proteinHistory = [];
let currentResults = null;
let currentAiSummary = "Analizando proteina...";

// --- NAVEGACIÓN SPA ---
const showSection = (sectionId) => {
    document.querySelectorAll('.spa-section').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    const target = document.getElementById(sectionId);
    target.classList.add('active');
    target.style.display = 'flex';
    
    // Si entramos al dashboard, inicializamos o redimensionamos el visor
    if (sectionId === 'sec-dashboard') {
        if (!viewer) {
            viewer = $3Dmol.createViewer(document.getElementById('viewer'), { backgroundColor: 'transparent' });
            viewerContainer =  document.getElementById('viewer');
        }
        viewer.resize();
    }
};

// Función principal
window.onload = () => {
    const btnLogin = document.getElementById('button-login');
    const btnGuest = document.getElementById('button-guest');
    const btnRun = document.getElementById('button-run');
    const fastaTextArea = document.getElementById('fasta');
    const dropZone = document.getElementById('drop-zone');

    btnLogin.onclick = () => {
        const userField = document.getElementById('username').value;
        const passField = document.getElementById('password').value;

        // CREDENCIALES ÚNICAS: Definimos el usuario y contraseña permitidos
        const USUARIO_VALIDO = "test";
        const PASS_VALIDO = "test";

        if (userField === USUARIO_VALIDO && passField === PASS_VALIDO) {
        console.log("Sesión iniciada");
        showSection('sec-dashboard');
        } else {
            alert("Nombre de usuario o contraseña incorrectos.");
            // Limpiamos los campos para seguridad
            document.getElementById('username').value = "";
            document.getElementById('password').value = "";
        }
    };

    // Si entra como invitado, entra al menu sin más
    btnGuest.onclick = () => showSection('sec-dashboard');

    // Manejo de Envío de Jobs
    btnRun.onclick = async () => {
    const fasta = fastaTextArea.value.trim();
    const overlay = document.getElementById('loading-overlay');
    const loadtext = document.getElementById('loading-subtext');
    const preset = document.getElementById('preset-select').value;
    let config = {};

    // 1. Configuración de Presets
    switch (preset) {
        case 'fast':
            config = { cpus: 4, gpus: 1, memory_gb: 16, max_runtime_seconds: 1800 };
            break;
        case 'high':
            config = { cpus: 16, gpus: 2, memory_gb: 64, max_runtime_seconds: 7200 };
            break;
        default:
            config = { cpus: 8, gpus: 1, memory_gb: 32, max_runtime_seconds: 3600 };
    }

    overlay.style.display = 'flex';

    try {
        addLog(`Configurando renderizado con preset: ${preset.toUpperCase()}`);

        // 2. Envío del Job
        const requestBody = {
            "fasta_filename": "protein_sequence.fasta",
            "fasta_sequence": fasta,
            "cpus": config.cpus,
            "gpus": config.gpus,
            "memory_gb": config.memory_gb,
            "max_runtime_seconds": config.max_runtime_seconds
        };

        const res = await fetch(`${API_URL}/jobs/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody) 
        });

        const { job_id } = await res.json();

        if (job_id === undefined) {
            addLog("Error: El servidor no devolvió un ID de Job. Revisa el FASTA.");
            return;
        }

        addLog(`Comienza el job con ID: ${job_id}`);

        // 3. Polling de Estado
        let jobReady = false;
        let lastStatus = "";

        while (!jobReady) {
            const poll = await fetch(`${API_URL}/jobs/${job_id}/status`);
            const data = await poll.json();
            const currentStatus = data.status;
            
            if (currentStatus !== lastStatus) {
                addLog("Estado del Job: " + currentStatus);
                lastStatus = currentStatus;
            }

            loadtext.innerText = `Estado: ${currentStatus.toUpperCase()}`;
            
            if (currentStatus === 'COMPLETED') {
                jobReady = true;
            } else if (currentStatus === 'FAILED') {
                throw new Error("Fallo en el clúster de computación");
            } else { 
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        addLog("Descargando resultados...");

        // Procesamos la salida del job
        const out = await fetch(`${API_URL}/jobs/${job_id}/outputs`);
        const results = await out.json();

        currentResults = results;

        // Limpiamos el resumen anterior de la ia
        currentAiSummary = "Analizando proteina...";

        // Mandamos el prompt a la ia
        if (!results?.protein_metadata?.protein_name) {
            currentAiSummary = "Esa proteína no se encuentra en nuestras bases de datos disponibles";
        }else{
            generateProteinSummary(currentResults);
        }
        addLog("La ia está generando una descripción de la proteína");

        // Extraemos referencias de los objetos principales
        const meta = results.protein_metadata;
        const structural = results.structural_data;
        const biological = results.biological_data;

        // Conseguimos los textos del html
        const nameText = document.getElementById('name');
        const organismText = document.getElementById('organism');
        const avgPlddtText = document.getElementById('avg-plddt');
        const solubilityText = document.getElementById('solubility');
        const weightText = document.getElementById('weightkda');

        if(results?.protein_metadata?.protein_name){
            // Extraemos los valores
            const nameValue = meta.protein_name;
            const organismV = meta.organism;
            const plddtAvg = structural.confidence.plddt_mean;
            const solubility = biological.solubility_score;
            const weight = biological.sequence_properties.molecular_weight_kda;

            // Asignamos los valores a los textos
            nameText.innerText = nameValue;
            organismText.innerText = organismV;
            avgPlddtText.innerText = plddtAvg.toFixed(2);
            solubilityText.innerText = solubility.toFixed(2);
            weightText.innerText = weight.toFixed(2);

        }

        // 5. Renderizado de Gráfico de Confianza (pLDDT por residuo)
        if (structural.confidence && structural.confidence.pae_matrix) {
            renderPAEHeatmap(structural.confidence.pae_matrix);
        } else {
            addLog("Aviso: No se encontraron datos de PAE.");
        }
        // 6. Configuración de Descargas
        currentPdbData = structural.pdb_file;
        
        if(!meta?.pdb_id){
            viewer.addModel(currentPdbData, "pdb");
            applyDefaultStyle();
            addLog("Proceso finalizado");
            return;
        }

        currentPdbId = meta.pdb_id;

        document.getElementById('btn-download-pdb').onclick = () => {
            if (!currentPdbData) return addLog("SISTEMA: No hay PDB disponible.");
            downloadFile(currentPdbData, `${currentPdbId}.pdb`);
        };

        document.getElementById('btn-download-logs').onclick = () => {
            if (!fullLog.trim()) return addLog("SISTEMA: Historial vacío.");
            downloadFile(`LOGS DE SESIÓN\n==========\n${fullLog}`, `logs_${Date.now()}.txt`);
        };

        // 7. Renderizado 3D
        renderProtein(currentPdbId, currentPdbData);

        // Guardar en historial después de cargar el 3D
        setTimeout(() => {
            if (viewer) {
                const snapshot = viewer.pngURI();
                addToHistory(currentPdbId, currentPdbData, snapshot, results);
            }
        }, 1200);

        addLog("Proceso finalizado con éxito.");

    } catch (err) {
        addLog("Ha ocurrido un error: " + err.message);
        console.error(err);
    } finally {
        overlay.style.display = 'none';
    }

    const btnAiPanel = document.getElementById('btn-ai-panel');
    const aiSlidingPanel = document.getElementById('ai-sliding-panel');
    const closeAiPanel = document.getElementById('close-ai-panel');

    // Abrir panel
    btnAiPanel.onclick = () => {
        aiSlidingPanel.classList.add('open');
    };
    // Cerrar panel
    closeAiPanel.onclick = () => {
        aiSlidingPanel.classList.remove('open');
    };
};

    dropZone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result;
                if (content.trim().startsWith('>')) {
                    fastaTextArea.value = content.trim();
                }
            };
            reader.readAsText(file);
        }
    });

    // --- LÓGICA DEL MENÚ DE COLORES ---
    const colorMenu = document.getElementById('color-menu');

    // Aplicar estilos a la proteína según el botón pulsado
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.onclick = (e) => {
            if (!viewer) return; // Si no hay visor cargado, no hace nada
            
            const scheme = e.target.getAttribute('data-scheme');
            let styleSpec = {};

            switch (scheme) {
                case 'plddt':
                    const residue = currentResults.structural_data.confidence.plddt_per_residue;
                    styleSpec = {
                        cartoon: {
                            colorfunc: (atom) => {
                                // Comparamos uno por uno los atomos para saber el plddt correspondiente
                                const confidence = residue[String(atom.resi)] || residue[atom.resi] || 0; 
                                
                                if (confidence >= 90) return "#0053D6";
                                if (confidence >= 70) return "#65CBFF";
                                if (confidence >= 50) return "#FFD321";
                                return "#FF7D45";
                            }
                        }
                    };
                break; 
                case 'amino':
                    // Colores por tipo de aminoácido
                    styleSpec = { sphere: { colorscheme: 'amino' } };
                    break;
                case 'ss':
                    // Colores por estructura secundaria (Hélices, láminas, etc.)
                    styleSpec = { cartoon: { colorscheme: 'ssPyMol' } };
                    break;
                case 'element':
                    // Colores estándar (átomos)
                    styleSpec = { stick: { colorscheme: 'Jmol' } };
                    break;
            }

            // Aplicar el nuevo estilo y renderizar
            viewer.setStyle({}, styleSpec);
            viewer.render();
            
            // Opcional: Ocultar el menú tras seleccionar un color
            colorMenu.classList.remove('show');
            updateLegendUI(scheme)
        };
    });

        // --- LÓGICA DRAG & DROP ---
    ['dragenter', 'dragover'].forEach(name => {
        dropZone.addEventListener(name, e => { 
            e.preventDefault(); 
            e.stopPropagation();
            dropZone.classList.add('dragging'); // Añade clase al entrar
        });
    });

    ['dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, e => { 
            e.preventDefault(); 
            e.stopPropagation();
            dropZone.classList.remove('dragging'); // Quita clase al salir o soltar
        });
    });

    // El evento 'drop' se mantiene igual, pero ahora limpia la clase al final
    dropZone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result;
                if (content.trim().startsWith('>')) {
                    document.getElementById('fasta').value = content.trim();
                }
            };
            reader.readAsText(file);
        }
    });

    updateHistoryUI();
};

// Función para renderizar una proteina
function renderProtein(pdbId, pdbData) {
    if (!viewer) return;

    viewer.clear(); // Limpiar siempre antes de cargar nueva

    if(!pdbId){
        // Caso: Datos crudos (LocalFold)
        viewer.addModel(pdbData, "pdb");
        applyDefaultStyle();
    } else {
        // Caso: Descarga de PDB
        $3Dmol.download(`pdb:${pdbId}`, viewer, {}, function() {
            applyDefaultStyle();
        });
    }
}

// Función auxiliar para no repetir código de estilo inicial
function applyDefaultStyle() {
    // 1. Verificación de seguridad
    if (!currentResults || !currentResults.structural_data) return;

    // 2. Extraemos los scores (el JSON que subiste usa .plddt directamente)
    const scores = currentResults.structural_data.confidence.plddt || 
                   currentResults.structural_data.confidence.plddt_per_residue;

    viewer.setStyle({}, {
        cartoon: {
            colorfunc: (atom) => {
                // Detectamos si es array (usar índice - 1) o si es objeto (usar clave directa)
                const confidence = Array.isArray(scores) 
                    ? scores[atom.resi - 1] 
                    : (scores[atom.resi] || scores[String(atom.resi)] || 0);
                                
                if (confidence >= 90) return "#0053D6"; // Azul (Muy alta)
                if (confidence >= 70) return "#65CBFF"; // Celeste (Alta)
                if (confidence >= 50) return "#FFD321"; // Amarillo (Baja)
                return "#FF7D45";                // Naranja (Muy baja)
            }
        },
    });

    // 3. Activamos la leyenda en modo pLDDT por defecto
    if (typeof updateLegendUI === 'function') {
        updateLegendUI('plddt');
    }

    // 4. Renderizado final
    viewer.zoomTo();
    viewer.render();
    viewer.spin(true);

    const sidePanels = document.querySelectorAll('#config, .left-box, #heat-map, #log-monitor, #history');

    // Función para esconder dashboard
    const hideDashboard = () => {
        sidePanels.forEach(panel => panel.classList.add('fade-out'));
        if (viewer) viewer.spin(false); // Detenemos el giro automático al interactuar
    };

    // Función para mostrar dashboard
    const showDashboard = () => {
        sidePanels.forEach(panel => panel.classList.remove('fade-out'));
    };

    // Eventos del ratón sobre el visor
    viewerContainer.addEventListener('mousedown', hideDashboard);
    
    // Al soltar el clic, o si el ratón sale del visor mientras arrastra
    window.addEventListener('mouseup', showDashboard);

    // Soporte para pantallas táctiles (móviles/tablets)
    viewerContainer.addEventListener('touchstart', hideDashboard);
    window.addEventListener('touchend', showDashboard);

    viewer.zoomTo();
    viewer.render();
    viewer.spin(true);
}

// Función para almacenar los logs
const addLog = (message) => {
    const logContent = document.getElementById('log-content');
    const timestamp = new Date().toLocaleTimeString();
    const newLine = document.createElement('div');
    
    // Mostramos los logs por pantalla
    newLine.innerHTML = timestamp + " ";
    newLine.append(message);
    logContent.appendChild(newLine);

    // Guardamos el log en el acumulador
    fullLog += timestamp + " " + message + "\n";

    // Auto-scroll hacia abajo
    document.getElementById('log-monitor').scrollTop = document.getElementById('log-monitor').scrollHeight;
};

// Función auxiliar para actualizar las imagenes de los recientes
const updateHistoryUI = () => {
    const container = document.getElementById('history-container');
    if (!container) return;
    
    container.innerHTML = proteinHistory.map((item, index) => `
        <div class="history-item" onclick="loadFromHistory(${index})">
            <img src="${item.img}" title="${item.name}">
        </div>
    `).join('') + '<div class="history-item empty">Vacío</div>'.repeat(Math.max(0, 3 - proteinHistory.length));
};

// Función auxiliar para añadir una proteína al historial
const addToHistory = (name, pdb, img, allData) => {
    proteinHistory.unshift({ name, pdb, img, allData });
    if (proteinHistory.length > 3) proteinHistory.pop();
    updateHistoryUI();
};

// Función auxiliar para cargar el historial
window.loadFromHistory = (index) => {
    const item = proteinHistory[index];
    currentPdbData = item.pdb;
    currentPdbId = item.name;
    updateStatsUI(item.allData)
    renderProtein(item.name, item.pdb);
    addLog(`Restaurada desde historial: ${item.name}`);
};

// Función genérica para descargar archivos
const downloadFile = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
};

function renderPLDDTChart(plddtArray) {
    if (!plddtArray || plddtArray.length === 0) return;

    const trace = {
        x: plddtArray.map((_, i) => i + 1), // Residuo 1, 2, 3...
        y: plddtArray,
        type: 'scatter',
        mode: 'lines',
        line: { color: '#4ade80', width: 2 },
        fill: 'tozeroy', // Relleno hasta el eje X para que parezca una montaña
        fillcolor: 'rgba(74, 222, 128, 0.1)',
        hovertemplate: 
            "<b>Residuo %{x}</b><br>" +
            "Confianza: %{y:.1f}%<br>" +
            "<extra></extra>"
    };

    const layout = {
        margin: { t: 10, r: 10, b: 40, l: 40 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#d1d5db', size: 10 },
        xaxis: { title: 'Posición del Residuo', gridcolor: '#334155' },
        yaxis: { title: 'pLDDT', range: [0, 105], gridcolor: '#334155' },
        shapes: [
            // Línea de referencia en 70 (Umbral de buena calidad)
            { type: 'line', x0: 0, x1: plddtArray.length, y0: 70, y1: 70, 
              line: { color: '#ffea00', width: 1, dash: 'dot' } }
        ]
    };

    Plotly.newPlot('plddt-plot', [trace], layout, { responsive: true, displayModeBar: false });
}

function renderPAEHeatmap(paeMatrix) {
    if (!paeMatrix || paeMatrix.length === 0) return;

    const data = [{
        z: paeMatrix,
        type: 'heatmap',
        colorscale: [
            [0, '#0053D6'],   // Azul (0 Å de error - Excelente)
            [0.2, '#65CBFF'], // Azul claro
            [0.5, '#f8fafc'], // Blanco (Error medio)
            [1, '#ffffff']    // Blanco puro (Error alto > 30 Å)
        ],
        showscale: true,
        colorbar: {
            title: 'Error (Å)',
            titleside: 'top',
            thickness: 10,
            len: 0.5
        },
        hovertemplate: 
            "<b>Relación de Confianza</b><br>" +
            "Residuo i: %{x}<br>" +
            "Residuo j: %{y}<br>" +
            "Error: %{z:.1f} Å<br>"
    }];

    const layout = {
        margin: { t: 5, r: 5, b: 40, l: 40 },
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        font: { color: '#d1d5db', size: 10 },
        xaxis: { title: 'Residuo i', gridcolor: '#334155' },
        yaxis: { 
            title: 'Residuo j', 
            gridcolor: '#334155',
            autorange: 'reversed' // Crucial para leer la matriz correctamente
        }
    };

    Plotly.newPlot('pae-plot', data, layout, { responsive: true, displayModeBar: false });
}

// 1. Definimos los diccionarios de la leyenda
const legendData = {
    plddt: {
        title: "Confianza (pLDDT)",
        items: [
            { color: "#0053D6", label: "Muy alta (>90)" },
            { color: "#65CBFF", label: "Alta (70-90)" },
            { color: "#FFD321", label: "Baja (50-70)" },
            { color: "#FF7D45", label: "Muy baja (<50)" }
        ]
    },
    ss: {
        title: "Estructura Secundaria",
        items: [
            { color: "#ff0000", label: "Hélice Alfa" },
            { color: "#ffff00", label: "Hoja Beta" },
            { color: "#00ff00", label: "Lazo / Giro" }
        ]
    },
    amino: {
        title: "Propiedades Aminoácidos",
        items: [
            { color: "#BEA06E", label: "Hidrofóbico" },
            { color: "#8282D2", label: "Positivo" },
            { color: "#E60A0A", label: "Negativo" },
            { color: "#00D1D1", label: "Polar" }
        ]
    },
    element: {
        title: "Elementos Químicos",
        items: [
            { color: "#909090", label: "Carbono (C)" },
            { color: "#3050F8", label: "Nitrógeno (N)" },
            { color: "#FF0D0D", label: "Oxígeno (O)" },
            { color: "#FFFF30", label: "Azufre (S)" }
        ]
    }
};

// 2. Función para pintar la leyenda
function updateLegendUI(scheme) {
    const container = document.getElementById('protein-legend');
    const data = legendData[scheme];
    
    if (!data) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    let html = `<strong>${data.title}</strong><br><br>`;
    data.items.forEach(item => {
        html += `
            <div class="legend-item">
                <div class="legend-color" style="background:${item.color}"></div>
                <span>${item.label}</span>
            </div>`;
    });
    container.innerHTML = html;
}

// 1. Importación del SDK de Google (vía web)
import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// 2. Configuración (Pon aquí tu clave real)
const API_KEY = "AIzaSyCozK-JzOmj_QO1sgcFJY8FTzIHCYMR-2c"; 
const genAI = new GoogleGenerativeAI(API_KEY);
const aiContentArea = document.getElementById("ai-content-area")

// --- FUNCIÓN IA DEFINITIVA (PLAN B) ---
async function generateProteinSummary(proteinData) {
    const FUNCTION_URL = "https://getprotsummary-ao2typf24a-uc.a.run.app/getProtSummary";
    try {
        const meta =  proteinData.protein_metadata;
        const structural = proteinData.structural_data;
        const biological = proteinData.biological_data;
        if (aiContentArea) aiContentArea.innerHTML = "<p>Generando análisis con IA...</p>";
        
        const response = await fetch(FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proteinName: meta.protein_name,
                organism: meta.organism,
                plddt: structural.confidence.plddt_mean,
                weight: biological.sequence_properties.molecular_weight_kda
            })
        });

        const data = await response.json();
        currentAiSummary = data.summary;
        const formattedText = currentAiSummary.split('\n')
            .map(line => line.trim() === "" ? "<br>" : `<p style="margin-bottom: 8px;">${line}</p>`).join('');

            aiContentArea.innerHTML = `<div>${formattedText}</div>`;
        if (currentAiSummary == ""){
            throw new Error("La IA no pudo responder a eso");
        }
        
    } catch (error) {
        console.error("Detalle del error:", error);
        aiContentArea.innerHTML = `
            <p style="color: #ef4444; text-align:center;">
                <strong>Error de Conexión</strong><br>
                <small>Verifica tu API KEY o la consola (F12)</small>
            </p>`;
    }
}

const updateStatsUI = (proteinData) => {
    const nameEl = document.getElementById('name');
    const organismEl = document.getElementById('organism');
    const plddtEl = document.getElementById('avg-plddt');
    const weightEl = document.getElementById('weightkda');
    const solEl = document.getElementById('solubility');

    // 2. Actualización de los textos
    if (nameEl) nameEl.innerText = proteinData.protein_metadata.protein_name;
    if (organismEl) organismEl.innerText = proteinData.protein_metadata.organism;
    
    if (plddtEl) {
        const plddt = proteinData.structural_data.confidence.plddt_mean;
        plddtEl.innerText = plddt.toFixed(2);
    }

    if (weightEl) {
        const weight = proteinData.biological_data.sequence_properties.molecular_weight_kda;
        weightEl.innerText = weight.toFixed(2);
    }

    if(solEl){
        const solubility = proteinData.biological_data.solubility_score;
        solEl.innerText = solubility.toFixed(2);
    }
};